"""Бот @digtunnelbot для игры «Докопаться до Америки».

Архитектура под пиковую нагрузку:
- игра раздаётся с GitHub Pages (CDN) и считается в телефоне игрока;
- этот процесс: Telegram-бот (long polling) + маленький HTTP API на 127.0.0.1:8090
  для статистики (за nginx с HTTPS и лимитами). События копятся в памяти и пишутся
  в SQLite пачкой раз в 2 секунды — тысячи событий в секунду не нагружают диск.
"""
import asyncio
import csv
import hashlib
import hmac
import io
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from urllib.parse import parse_qsl

from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    BufferedInputFile, CallbackQuery, FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup,
    InlineQuery, InlineQueryResultPhoto, LabeledPrice, MenuButtonWebApp, Message, PreCheckoutQuery, WebAppInfo,
)

BASE = Path(__file__).resolve().parent


def load_env():
    env = BASE / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()
TOKEN = os.environ["BOT_TOKEN"]
GAME_URL = os.environ.get("GAME_URL", "https://andywknd.github.io/-/").rstrip("/") + "/"
APP_SHORT = os.environ.get("APP_SHORT", "play").strip()
ADMINS = {int(x) for x in os.environ.get("ADMINS", "643643").replace(" ", "").split(",") if x}
BOT_USERNAME = os.environ.get("BOT_USERNAME", "digtunnelbot")
API_URL = os.environ.get("API_URL", "").rstrip("/")
API_PORT = int(os.environ.get("API_PORT", "8090"))
PROMO_URL = GAME_URL + "assets/promo.jpg"
PROMO_FILE = BASE.parent / "assets" / "promo.jpg"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dig")

TITLES = ["Стажёр бура", "Бригадир мерзлоты", "Подводный прораб", "Почти американец",
          "Алмазный отвлекатор", "Мастер эвакуации", "Соединитель континентов"]
DISTRACT = ["почти никогда", "иногда", "постоянно"]
TITLES_EN = ["Drill Intern", "Permafrost Foreman", "Undersea Supervisor", "Almost American",
             "Diamond Distraction", "Evacuation Master", "Continent Connector"]
DISTRACT_EN = ["almost never", "sometimes", "all the time"]

PRODUCTS = {
    "skin_gold": ("Золотой бур", "Позолоченная буровая с искрами. Чистая косметика.", 25),
    "cat": ("Кот-прораб", "Кот в каске на крыше буровой. Комментирует стройку.", 15),
    "tank_plus": ("Бак миллиардера", "+30% к объёму бака навсегда.", 49),
    "lift": ("Ракетный подъёмник", "Подъём по шахтам без топлива и вдвое быстрее.", 39),
    "insurance": ("Страховка «Каско-бур»", "При аварии добыча не теряется. Навсегда.", 59),
    "coins": ("Премия бригаде", "+400 игровых монет.", 29),
    "estimate": ("Турбо-смена", "3 минуты бур копает вдвое быстрее и не греется.", 35),
}

# ---------- база ----------
db = sqlite3.connect(BASE / "stats.db", check_same_thread=False, isolation_level=None)
db.execute("PRAGMA journal_mode=WAL")
db.execute("PRAGMA synchronous=NORMAL")
db.execute("PRAGMA busy_timeout=5000")
db.executescript("""
CREATE TABLE IF NOT EXISTS players(
  uid INTEGER PRIMARY KEY, first REAL, last REAL, name TEXT, username TEXT, lang TEXT, premium INTEGER DEFAULT 0,
  ref TEXT DEFAULT '', started INTEGER DEFAULT 0, can_write INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0,
  sessions INTEGER DEFAULT 0, built INTEGER DEFAULT 0, diamonds INTEGER DEFAULT 0, coins INTEGER DEFAULT 0,
  play INTEGER DEFAULT 0, done INTEGER DEFAULT 0, buys INTEGER DEFAULT 0, shares INTEGER DEFAULT 0, tut INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS events(t REAL, uid INTEGER, ev TEXT, d TEXT);
CREATE INDEX IF NOT EXISTS ev_t ON events(t);
CREATE INDEX IF NOT EXISTS ev_ev ON events(ev);
CREATE INDEX IF NOT EXISTS pl_last ON players(last);
CREATE TABLE IF NOT EXISTS segtimes(seg INTEGER, uid INTEGER, t REAL, PRIMARY KEY(seg, uid));
CREATE INDEX IF NOT EXISTS seg_t ON segtimes(seg, t);
CREATE TABLE IF NOT EXISTS purchases(charge TEXT PRIMARY KEY, uid INTEGER, item TEXT, stars INTEGER, t REAL, refunded INTEGER DEFAULT 0);
""")
# миграция: в базах первой версии у events нет колонки d, а в players могут не хватать полей
def _ensure_cols(table, cols):
    have = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
    for name, decl in cols:
        if name not in have:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")
            log.warning("migrated: %s.%s added", table, name)


_ensure_cols("events", [("d", "TEXT")])
_ensure_cols("players", [(c, "TEXT") for c in ("name", "username", "lang")] + [("ref", "TEXT DEFAULT ''")] +
             [(c, "INTEGER DEFAULT 0") for c in ("premium", "started", "can_write", "blocked", "sessions", "built", "diamonds",
                                                 "coins", "play", "done", "buys", "shares", "tut")] + [("first", "REAL"), ("last", "REAL")])
# перенос из старой таблицы users (первая версия бота)
try:
    db.execute("INSERT OR IGNORE INTO players(uid, first, last, ref, started) SELECT id, first, first, ref, 1 FROM users")
except sqlite3.OperationalError:
    pass

# буферы для пакетной записи
EV_BUF: list[tuple] = []
PL_BUF: dict[int, dict] = {}


def touch_player(uid: int, **f):
    p = PL_BUF.setdefault(uid, {})
    for k, v in f.items():
        if k in ("sessions_inc", "shares_inc"):
            p[k] = p.get(k, 0) + v
        elif v is not None:
            p[k] = v


def add_event(uid: int, ev: str, d=None, t=None):
    EV_BUF.append((t or time.time(), uid, ev[:40], json.dumps(d, ensure_ascii=False)[:500] if d else None))


def flush():
    global EV_BUF, PL_BUF
    if not EV_BUF and not PL_BUF:
        return
    evs, pls = EV_BUF, PL_BUF
    EV_BUF, PL_BUF = [], {}
    now = time.time()
    try:
        db.execute("BEGIN")
        if evs:
            db.executemany("INSERT INTO events(t, uid, ev, d) VALUES(?,?,?,?)", evs)
        for uid, p in pls.items():
            db.execute("INSERT OR IGNORE INTO players(uid, first, last) VALUES(?,?,?)", (uid, now, now))
            sets, vals = ["last=?"], [now]
            for k in ("name", "username", "lang", "premium", "built", "diamonds", "coins", "play", "done", "buys", "tut"):
                if k in p:
                    sets.append(f"{k}=MAX({k}, ?)" if k in ("built", "play", "done", "buys", "diamonds", "tut") else f"{k}=?")
                    vals.append(p[k])
            for k in ("started", "can_write"):
                if p.get(k):
                    sets.append(f"{k}=1")
            if p.get("ref"):
                sets.append("ref=CASE WHEN ref='' OR ref IS NULL THEN ? ELSE ref END")
                vals.append(p["ref"])
            if p.get("sessions_inc"):
                sets.append("sessions=sessions+?")
                vals.append(p["sessions_inc"])
            if p.get("shares_inc"):
                sets.append("shares=shares+?")
                vals.append(p["shares_inc"])
            if p.get("unblock"):
                sets.append("blocked=0")
            vals.append(uid)
            db.execute(f"UPDATE players SET {', '.join(sets)} WHERE uid=?", vals)
        db.execute("COMMIT")
    except Exception as e:
        log.warning("flush: %s", e)
        try:
            db.execute("ROLLBACK")
        except Exception:
            pass


async def flusher():
    while True:
        await asyncio.sleep(2)
        flush()


# ---------- проверка initData от Telegram ----------
SECRET = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()


def check_init(init: str) -> dict | None:
    try:
        data = dict(parse_qsl(init, strict_parsing=True))
        h = data.pop("hash", "")
        dcs = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
        calc = hmac.new(SECRET, dcs.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(calc, h):
            return None
        if time.time() - int(data.get("auth_date", 0)) > 7 * 86400:
            return None
        user = json.loads(data.get("user", "{}"))
        if not user.get("id"):
            return None
        user["_start"] = data.get("start_param", "")
        return user
    except Exception:
        return None


# ---------- HTTP API ----------
LAST_HIT: dict[int, float] = {}
ALLOWED_EV = {"open", "tutorial_start", "tutorial_done", "sortie", "sortie_end", "first_diamond_found",
              "diamond_delivered", "sale", "upgrade", "accident", "segment", "chapter", "finale",
              "share_card", "buy_open", "buy_paid", "tip_ore", "brand_click", "write_access", "hide"}


def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
    return resp


async def api_events(req: web.Request):
    if req.method == "OPTIONS":
        return cors(web.Response(status=204))
    if req.content_length and req.content_length > 16384:
        return cors(web.Response(status=413))
    try:
        body = json.loads(await req.text())
    except Exception:
        return cors(web.Response(status=400))
    user = check_init(body.get("init", ""))
    if not user:
        return cors(web.Response(status=403))
    uid = int(user["id"])
    now = time.time()
    if now - LAST_HIT.get(uid, 0) < 2:  # не чаще раза в 2 секунды на игрока
        return cors(web.Response(status=429))
    LAST_HIT[uid] = now
    s = body.get("s") or {}
    evs = body.get("ev") or []
    fields = dict(name=((user.get("first_name") or "") + " " + (user.get("last_name") or "")).strip()[:64],
                  username=(user.get("username") or "")[:32], lang=(user.get("language_code") or "")[:8],
                  premium=1 if user.get("is_premium") else 0, ref=(user.get("_start") or "")[:32] or None)
    if user.get("allows_write_to_pm"):
        fields["can_write"] = 1
    for k in ("built", "diamonds", "coins", "play", "done", "buys", "tut"):
        try:
            if k in s:
                fields[k] = int(s[k])
        except (TypeError, ValueError):
            pass
    n_open = n_share = 0
    for e in evs[:50]:
        try:
            ev = str(e[0])
            if ev not in ALLOWED_EV:
                continue
            d = e[1] if len(e) > 1 and isinstance(e[1], dict) else None
            add_event(uid, ev, d)
            if ev == "open":
                n_open += 1
            elif ev == "share_card":
                n_share += 1
            elif ev == "write_access" and d and d.get("ok"):
                fields["can_write"] = 1
        except Exception:
            continue
    touch_player(uid, sessions_inc=n_open, shares_inc=n_share, **fields)
    return cors(web.Response(status=204))


LAST_ME: dict[int, float] = {}


async def api_me(req: web.Request):
    if req.method == "OPTIONS":
        return cors(web.Response(status=204))
    try:
        body = json.loads(await req.text())
    except Exception:
        return cors(web.Response(status=400))
    user = check_init(body.get("init", ""))
    if not user:
        return cors(web.Response(status=403))
    uid = int(user["id"])
    now = time.time()
    if now - LAST_ME.get(uid, 0) < 10:
        return cors(web.Response(status=429))
    LAST_ME[uid] = now
    n = db.execute("SELECT COUNT(*) FROM players WHERE ref=? AND uid!=? AND sessions>0", (f"r{uid}", uid)).fetchone()[0]
    return cors(web.json_response({"refs": n}))


LAST_SEG: dict[int, float] = {}


async def api_seg(req: web.Request):
    """Игрок прошёл участок: сохраняем лучшее время и отвечаем, быстрее скольких процентов игроков."""
    if req.method == "OPTIONS":
        return cors(web.Response(status=204))
    try:
        body = json.loads(await req.text())
        n, t = int(body.get("n")), float(body.get("t"))
    except Exception:
        return cors(web.Response(status=400))
    user = check_init(body.get("init", ""))
    if not user:
        return cors(web.Response(status=403))
    if not (0 <= n < 20 and 5 <= t <= 86400):
        return cors(web.Response(status=400))
    uid = int(user["id"])
    now = time.time()
    if now - LAST_SEG.get(uid, 0) < 3:
        return cors(web.Response(status=429))
    LAST_SEG[uid] = now
    db.execute("INSERT INTO segtimes(seg, uid, t) VALUES(?,?,?) ON CONFLICT(seg, uid) DO UPDATE SET t=MIN(t, excluded.t)", (n, uid, t))
    total = db.execute("SELECT COUNT(*) FROM segtimes WHERE seg=? AND uid!=?", (n, uid)).fetchone()[0]
    slower = db.execute("SELECT COUNT(*) FROM segtimes WHERE seg=? AND uid!=? AND t>?", (n, uid, t)).fetchone()[0]
    med = db.execute("SELECT t FROM segtimes WHERE seg=? ORDER BY t LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM segtimes WHERE seg=?)", (n, n)).fetchone()
    faster = round(100 * slower / total) if total else 100
    return cors(web.json_response({"faster": faster, "total": total, "med": round(med[0]) if med else round(t)}))


async def api_health(req):
    return web.json_response({"ok": True, "buffer": len(EV_BUF)})


async def start_api():
    app = web.Application(client_max_size=32 * 1024)
    app.router.add_route("*", "/api/e", api_events)
    app.router.add_get("/api/health", api_health)
    app.router.add_route("*", "/api/me", api_me)
    app.router.add_route("*", "/api/seg", api_seg)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", API_PORT, backlog=2048).start()
    log.info("API on 127.0.0.1:%s (%s)", API_PORT, API_URL or "без публичного адреса")


# ---------- бот ----------
def app_link(start: str = "") -> str:
    if APP_SHORT:
        return f"https://t.me/{BOT_USERNAME}/{APP_SHORT}" + (f"?startapp={start}" if start else "")
    return f"https://t.me/{BOT_USERNAME}" + (f"?start={start}" if start else "")


def invite_url(uid: int) -> str:
    from urllib.parse import quote
    link = app_link(f"r{uid}")
    text = "Копаю тоннель от Чукотки до Аляски ⛏ Присоединяйся — посмотрим, кто докопается первым!"
    return f"https://t.me/share/url?url={quote(link, safe='')}&text={quote(text, safe='')}"


def start_kb(ref: str = "ch") -> InlineKeyboardMarkup:
    """Кнопка под постом в канале: ведёт в бота через START — так человек попадает в базу рассылки."""
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="⛏ Играть", url=f"https://t.me/{BOT_USERNAME}?start={ref}")]])


RU_LANGS = ("ru", "uk", "be", "kk", "ky", "uz", "tg", "hy", "az", "ka", "ro")


def is_en(user) -> bool:
    lc = (getattr(user, "language_code", None) or "ru").lower()
    return not lc.startswith(RU_LANGS)


def play_kb_private(en: bool = False) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="⛏ Dig to America" if en else "⛏ Копать до Америки", web_app=WebAppInfo(url=GAME_URL))]])


def play_kb_link(start: str = "", en: bool = False) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="⛏ Dig to America" if en else "⛏ Копать до Америки", url=app_link(start))]])


bot = Bot(TOKEN)
dp = Dispatcher()
promo_file_id: str | None = None
is_admin = F.from_user.id.in_(ADMINS)


async def send_safe(coro_factory):
    for _ in range(3):
        try:
            return await coro_factory()
        except TelegramRetryAfter as e:
            await asyncio.sleep(e.retry_after + 0.5)
        except (TelegramForbiddenError, TelegramBadRequest) as e:
            log.info("send skipped: %s", e)
            return None


def promo_photo():
    return promo_file_id or (FSInputFile(PROMO_FILE) if PROMO_FILE.exists() else PROMO_URL)


START_TEXT = (
    "🚇 <b>Докопаться до Америки</b>\n\n"
    "Пока все обсуждают тоннель между Россией и США — ты копаешь!\n\n"
    "⛏ Веди буровую от Чукотки до Аляски и открывай станции\n"
    "💎 Сворачивай за золотом и алмазами — они превращаются в монеты\n"
    "⚙️ Прокачивай бур, бак и отсек\n"
    "👥 {invite} — за каждого бесплатное улучшение\n\n"
    "<i>Игра от <a href=\"https://t.me/moscowmap\">«Новостей Москвы»</a>. Все персонажи и события вымышлены.</i>"
)
START_TEXT_EN = (
    "🚇 <b>Dig to America</b>\n\n"
    "While everyone is talking about a tunnel between Russia and the USA — you're digging it!\n\n"
    "⛏ Drive the rig from Chukotka to Alaska and open new stations\n"
    "💎 Turn off the route for gold and diamonds — they turn into coins\n"
    "⚙️ Upgrade your drill, tank and cargo hold\n"
    "👥 {invite} — a free upgrade for each one\n\n"
    "<i>A game by <a href=\"https://t.me/moscowmap\">«Moscow News»</a>. All characters and events are fictional.</i>"
)


@dp.message(CommandStart())
async def start(m: Message, command: CommandObject):
    global promo_file_id
    u = m.from_user
    touch_player(u.id, started=1, unblock=1, name=(u.full_name or "")[:64], username=(u.username or "")[:32],
                 lang=(u.language_code or "")[:8], premium=1 if u.is_premium else 0, ref=(command.args or "")[:32] or None)
    add_event(u.id, "bot_start", {"ref": command.args} if command.args else None)
    share = invite_url(u.id)
    en = is_en(u)
    text = (START_TEXT_EN if en else START_TEXT).replace("{invite}", f'<a href="{share}">{"Invite friends" if en else "Зови друзей"}</a>')
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="⛏ Dig to America" if en else "⛏ Копать до Америки", web_app=WebAppInfo(url=GAME_URL))],
        [InlineKeyboardButton(text="👥 Invite a friend" if en else "👥 Пригласить друга", url=share)]])
    res = await send_safe(lambda: m.answer_photo(promo_photo(), caption=text, parse_mode="HTML", reply_markup=kb))
    if res and res.photo and not promo_file_id:
        promo_file_id = res.photo[-1].file_id


@dp.inline_query()
async def inline(q: InlineQuery):
    parts = (q.query or "").split()
    uid = q.from_user.id
    en = is_en(q.from_user)
    caption = "🚇 Dig to America. While everyone talks — you dig." if en else "🚇 Докопаться до Америки. Пока все обсуждают — ты копаешь."
    title = "Invite to dig the tunnel" if en else "Позвать копать тоннель"
    if len(parts) >= 6 and parts[0] == "r":
        try:
            p, d, a, ti, wi = (int(x) for x in parts[1:6])
            p = max(0, min(100, p))
            TT, DD = (TITLES_EN, DISTRACT_EN) if en else (TITLES, DISTRACT)
            t = TT[ti] if 0 <= ti < len(TT) else TT[0]
            w = DD[wi] if 0 <= wi < len(DD) else DD[1]
            if en:
                if p >= 100:
                    caption = f"🚇 I dug all the way to America! Chukotka and Alaska are connected.\n💎 Diamonds: {d}. Crashes: {a}.\n🏅 Rank: «{t}»"
                else:
                    caption = (f"⛏ Left to dig to Alaska: {100 - p}%.\n💎 Diamonds found: {d}.\n"
                               f"🙈 Got distracted from the main task: {w}.\n🏅 Rank: «{t}»")
                caption += "\n\nCan you dig through faster?"
                title = f"My tunnel: {p}% · «{t}»"
            elif p >= 100:
                caption = f"🚇 Я докопался до Америки! Чукотка и Аляска соединены.\n💎 Алмазов: {d}. Аварий: {a}.\n🏅 Звание: «{t}»"
            else:
                caption = (f"⛏ До Аляски осталось {100 - p}%.\n💎 Алмазов найдено: {d}.\n"
                           f"🙈 От основной задачи отвлекался: {w}.\n🏅 Звание: «{t}»")
            if not en:
                caption += "\n\nА ты докопаешься быстрее?"
                title = f"Мой тоннель: {p}% · «{t}»"
        except ValueError:
            pass
    result = InlineQueryResultPhoto(
        id=str(abs(hash(q.query)) % 10**12), photo_url=PROMO_URL, thumbnail_url=PROMO_URL,
        photo_width=1280, photo_height=720, title=title,
        description="Result card with a Play button" if en else "Карточка с результатом и кнопкой «Играть»",
        caption=caption, reply_markup=play_kb_link(f"r{uid}", en),
    )
    await send_safe(lambda: q.answer([result], cache_time=30, is_personal=True))


@dp.chosen_inline_result()
async def chosen(r):
    touch_player(r.from_user.id, shares_inc=1)
    add_event(r.from_user.id, "share_sent")


# ---------- Telegram Stars ----------
@dp.message(Command("links"), is_admin)
async def links(m: Message):
    out = {}
    for pid, (title, desc, stars) in PRODUCTS.items():
        out[pid] = await bot.create_invoice_link(
            title=title, description=desc, payload=f"shop:{pid}", currency="XTR",
            prices=[LabeledPrice(label=title, amount=stars)],
        )
    js = "window.DIG_SHOP = " + json.dumps(out, ensure_ascii=False, indent=1) + ";"
    if API_URL:
        js += f'\nwindow.DIG_API = "{API_URL}";'
    await m.answer("Скопируй всё сообщение ниже и пришли Claude:")
    await m.answer(js)


@dp.pre_checkout_query()
async def pre_checkout(q: PreCheckoutQuery):
    pid = (q.invoice_payload or "").removeprefix("shop:")
    ok = pid in PRODUCTS and q.currency == "XTR" and q.total_amount == PRODUCTS[pid][2]
    await q.answer(ok=ok, error_message=None if ok else "Товар не найден, попробуй ещё раз из игры.")


@dp.message(F.successful_payment)
async def paid(m: Message):
    sp = m.successful_payment
    pid = (sp.invoice_payload or "").removeprefix("shop:")
    try:
        db.execute("INSERT OR IGNORE INTO purchases(charge, uid, item, stars, t) VALUES(?,?,?,?,?)",
                   (sp.telegram_payment_charge_id, m.from_user.id, pid, sp.total_amount, time.time()))
    except Exception as e:
        log.warning("db purchase: %s", e)
    add_event(m.from_user.id, "paid", {"item": pid, "stars": sp.total_amount})
    name = PRODUCTS.get(pid, ("покупка",))[0]
    await send_safe(lambda: m.answer(f"⭐ Спасибо! «{name}» уже в игре. Возвращайся копать 👇", reply_markup=play_kb_private()))


@dp.message(Command("paysupport"))
async def paysupport(m: Message):
    await m.answer("Вопросы по оплате звёздами: опиши проблему одним сообщением и укажи дату покупки — "
                   "мы проверим и при необходимости вернём звёзды. Покупки применяются сразу в игре; "
                   "если что-то не появилось — перезапусти игру.")
    for a in ADMINS:
        await send_safe(lambda a=a: bot.send_message(a, f"🆘 /paysupport от {m.from_user.id} (@{m.from_user.username})"))


@dp.message(Command("terms"))
async def terms(m: Message):
    await m.answer("Условия: покупки в игре «Докопаться до Америки» — цифровые внутриигровые улучшения за Telegram Stars. "
                   "Игра полностью проходится без покупок. Возврат — через /paysupport.")


@dp.message(Command("refund"), is_admin)
async def refund(m: Message, command: CommandObject):
    try:
        uid, charge = (command.args or "").split()
        await bot.refund_star_payment(user_id=int(uid), telegram_payment_charge_id=charge)
        db.execute("UPDATE purchases SET refunded=1 WHERE charge=?", (charge,))
        await m.answer("✅ Возврат выполнен")
    except Exception as e:
        await m.answer(f"❌ {e}\nФормат: /refund <user_id> <charge_id>")


# ---------- статистика ----------
def q1(sql, *a):
    return db.execute(sql, a).fetchone()[0] or 0


def pct(a, b):
    return f"{(100 * a / b):.0f}%" if b else "—"


@dp.message(Command("stats"), is_admin)
async def stats(m: Message):
    try:
        await _stats(m)
    except Exception as e:
        log.exception("stats")
        await m.answer(f"⚠️ Не удалось собрать статистику: {type(e).__name__}: {str(e)[:200]}")


async def _stats(m: Message):
    flush()
    now = time.time()
    h1, d1, d2 = now - 3600, now - 86400, now - 2 * 86400
    total = q1("SELECT COUNT(*) FROM players")
    players = q1("SELECT COUNT(*) FROM players WHERE sessions>0")
    new1h = q1("SELECT COUNT(*) FROM players WHERE first>?", h1)
    new24 = q1("SELECT COUNT(*) FROM players WHERE first>?", d1)
    online = q1("SELECT COUNT(*) FROM players WHERE last>?", now - 300)
    act1h = q1("SELECT COUNT(*) FROM players WHERE last>?", h1)
    act24 = q1("SELECT COUNT(*) FROM players WHERE last>?", d1)
    started = q1("SELECT COUNT(*) FROM players WHERE started=1")
    reach = q1("SELECT COUNT(*) FROM players WHERE (started=1 OR can_write=1) AND blocked=0")
    tut = q1("SELECT COUNT(DISTINCT uid) FROM events WHERE ev='tutorial_done'")
    b = [q1("SELECT COUNT(*) FROM players WHERE built>=?", n) for n in (1, 3, 5, 8, 10)]
    sessions = q1("SELECT SUM(sessions) FROM players")
    avg_play = q1("SELECT AVG(play) FROM players WHERE sessions>0")
    cohort = q1("SELECT COUNT(*) FROM players WHERE first BETWEEN ? AND ?", d2, d1)
    ret = q1("SELECT COUNT(*) FROM players WHERE first BETWEEN ? AND ? AND last > first + 72000", d2, d1)
    shares = q1("SELECT SUM(shares) FROM players")
    refs = q1("SELECT COUNT(*) FROM players WHERE ref LIKE 'r%'")
    from_ch = q1("SELECT COUNT(*) FROM players WHERE ref='ch'")
    premium = q1("SELECT COUNT(*) FROM players WHERE premium=1")
    buys, stars_sum = db.execute("SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases WHERE refunded=0").fetchone()
    payers = q1("SELECT COUNT(DISTINCT uid) FROM purchases WHERE refunded=0")
    top = db.execute("SELECT item, COUNT(*) FROM purchases WHERE refunded=0 GROUP BY item ORDER BY 2 DESC LIMIT 7").fetchall()
    acc = db.execute("SELECT json_extract(d,'$.cause'), COUNT(*) FROM events WHERE ev='accident' GROUP BY 1 ORDER BY 2 DESC LIMIT 4").fetchall()
    langs = db.execute("SELECT lang, COUNT(*) FROM players WHERE lang!='' GROUP BY lang ORDER BY 2 DESC LIMIT 4").fetchall()
    cause = {"fuel": "топливо", "hull": "корпус", "leak": "протечка", "sos": "SOS"}
    txt = (
        f"📊 <b>Статистика «Докопаться до Америки»</b>\n\n"
        f"👥 <b>Игроки</b>\n"
        f"• всего открыли игру: <b>{players}</b> (+ только бот: {total - players})\n"
        f"• новых за час / 24 ч: {new1h} / {new24}\n"
        f"• сейчас онлайн (5 мин): <b>{online}</b>\n"
        f"• активных за час / 24 ч: {act1h} / {act24}\n"
        f"• сессий всего: {sessions}, среднее время в игре: {int(avg_play // 60)} мин\n"
        f"• вернулись на следующий день: {pct(ret, cohort)} (из {cohort})\n"
        f"• Premium: {premium}\n\n"
        f"🪜 <b>Воронка</b>\n"
        f"• прошли обучение: {tut} ({pct(tut, players)})\n"
        f"• построили 1 / 3 / 5 / 8 участков: {b[0]} / {b[1]} / {b[2]} / {b[3]}\n"
        f"• докопались до Америки: <b>{b[4]}</b> ({pct(b[4], players)})\n\n"
        f"📣 <b>Вирусность</b>\n"
        f"• отправлено карточек: {shares}\n"
        f"• пришли по приглашению друга: {refs}\n"
        f"• пришли из поста в канале: {from_ch}\n\n"
        f"⭐ <b>Звёзды</b>\n"
        f"• покупок: {buys} на <b>{stars_sum}</b> ⭐, платящих: {payers} ({pct(payers, players)})"
        + "".join(f"\n  · {PRODUCTS.get(i, (i,))[0]}: {n}" for i, n in top) + "\n\n"
        f"💥 Аварии: " + (", ".join(f"{cause.get(c, c)} {n}" for c, n in acc) or "нет") + "\n"
        f"🌍 Языки: " + (", ".join(f"{l} {n}" for l, n in langs) or "—") + "\n\n"
        f"📨 Доступно для рассылки: <b>{reach}</b> (нажали Start: {started})\n"
        f"Выгрузка всех игроков: /export"
    )
    await m.answer(txt, parse_mode="HTML")


@dp.message(Command("export"), is_admin)
async def export(m: Message):
    flush()
    cur = db.execute("SELECT uid, name, username, lang, premium, ref, started, can_write, blocked, sessions, built, done, "
                     "diamonds, coins, play, buys, shares, datetime(first,'unixepoch'), datetime(last,'unixepoch') FROM players ORDER BY first")
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow(["id", "имя", "username", "язык", "premium", "откуда", "нажал_start", "можно_писать", "заблокировал",
                "сессий", "участков", "прошёл", "алмазов", "монет", "сек_в_игре", "покупок", "шарингов", "первый_вход_UTC", "последний_UTC"])
    w.writerows(cur.fetchall())
    data = ("﻿" + buf.getvalue()).encode("utf-8")
    await m.answer_document(BufferedInputFile(data, filename=f"players_{time.strftime('%Y%m%d_%H%M')}.csv"),
                            caption="Все игроки (открывается в Excel / Google Таблицах)")


# ---------- рассылка ----------
BC_STATE: dict[int, dict] = {}
BC_RUNNING = {"on": False, "stop": False}


def bc_recipients():
    return [r[0] for r in db.execute("SELECT uid FROM players WHERE (started=1 OR can_write=1) AND blocked=0")]


@dp.message(Command("broadcast"), is_admin)
async def bc_begin(m: Message):
    if BC_RUNNING["on"]:
        await m.answer("Рассылка уже идёт. Остановить: /stopbroadcast")
        return
    BC_STATE[m.from_user.id] = {"step": "wait"}
    flush()
    await m.answer(f"📨 Пришли сообщение для рассылки — текст, фото, видео или пост с подписью.\n"
                   f"Получателей сейчас: <b>{len(bc_recipients())}</b>.\nОтмена: /cancel", parse_mode="HTML")


@dp.message(Command("cancel"), is_admin)
async def bc_cancel(m: Message):
    BC_STATE.pop(m.from_user.id, None)
    await m.answer("Отменено.")


@dp.message(Command("stopbroadcast"), is_admin)
async def bc_stop(m: Message):
    BC_RUNNING["stop"] = True
    await m.answer("Останавливаю рассылку…")


@dp.message(is_admin, lambda m: BC_STATE.get(m.from_user.id, {}).get("step") == "wait")
async def bc_got(m: Message):
    BC_STATE[m.from_user.id] = {"step": "confirm", "chat": m.chat.id, "msg": m.message_id, "btn": True}
    await bot.copy_message(m.chat.id, m.chat.id, m.message_id, reply_markup=play_kb_private())
    await m.answer(f"☝️ Так увидят игроки (с кнопкой «Копать»). Отправить <b>{len(bc_recipients())}</b> получателям?",
                   parse_mode="HTML", reply_markup=bc_kb(True))


def bc_kb(btn: bool):
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Отправить всем", callback_data="bc:go")],
        [InlineKeyboardButton(text=("☑️ С кнопкой «Копать»" if btn else "⬜ Без кнопки"), callback_data="bc:btn")],
        [InlineKeyboardButton(text="❌ Отмена", callback_data="bc:no")],
    ])


@dp.callback_query(F.data.startswith("bc:"), is_admin)
async def bc_cb(c: CallbackQuery):
    st = BC_STATE.get(c.from_user.id)
    if not st or st.get("step") != "confirm":
        await c.answer("Нет черновика. Начни с /broadcast", show_alert=True)
        return
    if c.data == "bc:no":
        BC_STATE.pop(c.from_user.id, None)
        await c.message.edit_text("Рассылка отменена.")
    elif c.data == "bc:btn":
        st["btn"] = not st["btn"]
        await c.message.edit_reply_markup(reply_markup=bc_kb(st["btn"]))
    elif c.data == "bc:go":
        BC_STATE.pop(c.from_user.id, None)
        await c.message.edit_text("🚀 Рассылка запущена. Прогресс будет здесь. Остановить: /stopbroadcast")
        asyncio.create_task(bc_run(c.message.chat.id, st))
    await c.answer()


async def bc_run(admin_chat: int, st: dict):
    BC_RUNNING.update(on=True, stop=False)
    flush()
    ids = bc_recipients()
    ok = fail = blocked = 0
    started = time.time()
    status = await bot.send_message(admin_chat, f"📨 0 / {len(ids)}")
    kb = play_kb_private() if st["btn"] else None
    for i, uid in enumerate(ids, 1):
        if BC_RUNNING["stop"]:
            break
        for _ in range(3):
            try:
                await bot.copy_message(uid, st["chat"], st["msg"], reply_markup=kb)
                ok += 1
                break
            except TelegramRetryAfter as e:
                await asyncio.sleep(e.retry_after + 1)
            except TelegramForbiddenError:
                blocked += 1
                db.execute("UPDATE players SET blocked=1 WHERE uid=?", (uid,))
                break
            except Exception:
                fail += 1
                break
        await asyncio.sleep(0.04)  # ≈25 сообщений/с — ниже лимита Telegram (30/с)
        if i % 300 == 0:
            try:
                await status.edit_text(f"📨 {i} / {len(ids)} · доставлено {ok} · заблокировали бота {blocked}")
            except Exception:
                pass
    BC_RUNNING["on"] = False
    took = int(time.time() - started)
    await bot.send_message(admin_chat, f"✅ Рассылка {'остановлена' if BC_RUNNING['stop'] else 'завершена'} за {took // 60} мин {took % 60} с\n"
                                       f"Доставлено: {ok}\nЗаблокировали бота: {blocked}\nОшибки: {fail}")


# ---------- посты в канал ----------
POST_TEXT = (
    "🚇 <b>Тоннель Россия — США? Копаем сами!</b>\n\n"
    "Пока все обсуждают — ты копаешь. Веди буровую от Чукотки до Аляски, "
    "добывай алмазы, спасай тоннель от протечек и посмотри, кто из друзей докопается первым.\n\n"
    "👇 Игра открывается прямо в Telegram\n"
    "<i>Игра от <a href=\"https://t.me/moscowmap\">«Новостей Москвы»</a></i>"
)


@dp.message(Command("post"), is_admin)
async def post(m: Message, command: CommandObject):
    target = (command.args or "").strip()
    if not target:
        await m.answer("Использование: /post @канал\nСначала добавь бота администратором канала с правом публикации.")
        return
    try:
        await bot.send_photo(target, promo_photo(), caption=POST_TEXT, parse_mode="HTML", reply_markup=start_kb("ch"))
        await m.answer("✅ Опубликовано в " + target)
    except Exception as e:
        await m.answer(f"❌ Не получилось: {e}\nПроверь, что бот — админ канала с правом публикации.")


@dp.message(Command("preview"), is_admin)
async def preview(m: Message):
    await m.answer_photo(promo_photo(), caption=POST_TEXT, parse_mode="HTML", reply_markup=start_kb("ch"))


@dp.message(Command("admin"), is_admin)
async def admin_help(m: Message):
    await m.answer(
        "🛠 Команды админа:\n"
        "/stats — полная статистика\n/export — все игроки в CSV\n"
        "/broadcast — рассылка по игрокам\n/stopbroadcast — остановить рассылку\n"
        "/preview — показать пост для канала\n/post @канал — опубликовать пост\n"
        "/links — ссылки на оплату для лавки\n/refund id charge — вернуть звёзды")


@dp.message()
async def other(m: Message):
    en = is_en(m.from_user)
    await send_safe(lambda: m.answer("Press the button and let's dig 👇" if en else "Жми кнопку — и копаем 👇", reply_markup=play_kb_private(en)))


async def main():
    await start_api()
    asyncio.create_task(flusher())
    try:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Играть", web_app=WebAppInfo(url=GAME_URL)))
    except Exception as e:
        log.warning("menu button: %s", e)
    me = await bot.get_me()
    log.info("bot @%s started, game %s", me.username, GAME_URL)
    try:
        await dp.start_polling(bot, allowed_updates=["message", "inline_query", "chosen_inline_result",
                                                     "pre_checkout_query", "callback_query"])
    finally:
        flush()


if __name__ == "__main__":
    asyncio.run(main())
