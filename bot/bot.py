"""Бот @digtunnelbot для игры «Докопаться до Америки».

Нагрузка: сама игра раздаётся с GitHub Pages (CDN) и живёт в телефоне игрока,
бот отвечает только на /start, inline-шаринг и пару админ-команд.
"""
import asyncio
import logging
import os
import sqlite3
import time
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.exceptions import TelegramRetryAfter, TelegramForbiddenError, TelegramBadRequest
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    FSInputFile, InlineKeyboardButton, InlineKeyboardMarkup, InlineQuery,
    InlineQueryResultPhoto, LabeledPrice, MenuButtonWebApp, Message, PreCheckoutQuery, WebAppInfo,
)
import json

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
PROMO_URL = GAME_URL + "assets/promo.jpg"
PROMO_FILE = BASE.parent / "assets" / "promo.jpg"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("dig")

TITLES = ["Стажёр бура", "Бригадир мерзлоты", "Подводный прораб", "Почти американец",
          "Алмазный отвлекатор", "Мастер эвакуации", "Соединитель континентов"]
DISTRACT = ["почти никогда", "иногда", "постоянно"]

# ---------- статистика (SQLite, WAL — выдерживает тысячи записей в секунду) ----------
db = sqlite3.connect(BASE / "stats.db", check_same_thread=False, isolation_level=None)
db.execute("PRAGMA journal_mode=WAL")
db.execute("PRAGMA synchronous=NORMAL")
db.execute("CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, first REAL, ref TEXT)")
db.execute("CREATE TABLE IF NOT EXISTS events(t REAL, uid INTEGER, ev TEXT)")
db.execute("CREATE TABLE IF NOT EXISTS purchases(charge TEXT PRIMARY KEY, uid INTEGER, item TEXT, stars INTEGER, t REAL, refunded INTEGER DEFAULT 0)")

# Товары лавки (должны совпадать с CFG.SHOP в config.js)
PRODUCTS = {
    "skin_gold": ("Золотой бур", "Позолоченная буровая с искрами. Чистая косметика.", 25),
    "cat": ("Кот-прораб", "Кот в каске на крыше буровой. Комментирует стройку.", 15),
    "tank_plus": ("Бак миллиардера", "+30% к объёму бака навсегда.", 49),
    "lift": ("Ракетный подъёмник", "Подъём по шахтам без топлива и вдвое быстрее.", 39),
    "insurance": ("Страховка «Каско-бур»", "При аварии добыча не теряется. Навсегда.", 59),
    "coins": ("Премия бригаде", "+400 игровых монет.", 29),
    "estimate": ("Срочная поставка", "Для текущего сегмента нужно вдвое меньше железа и меди.", 35),
}


def remember(uid: int, ref: str = ""):
    try:
        db.execute("INSERT OR IGNORE INTO users(id, first, ref) VALUES(?,?,?)", (uid, time.time(), ref))
    except Exception as e:  # статистика не должна ронять бота
        log.warning("db: %s", e)


def event(uid: int, ev: str):
    try:
        db.execute("INSERT INTO events(t, uid, ev) VALUES(?,?,?)", (time.time(), uid, ev))
    except Exception as e:
        log.warning("db: %s", e)


def app_link(start: str = "") -> str:
    if APP_SHORT:
        return f"https://t.me/{BOT_USERNAME}/{APP_SHORT}" + (f"?startapp={start}" if start else "")
    return f"https://t.me/{BOT_USERNAME}" + (f"?start={start}" if start else "")


def play_kb_private() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="⛏ Копать до Америки", web_app=WebAppInfo(url=GAME_URL))]])


def play_kb_link(start: str = "") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="⛏ Копать до Америки", url=app_link(start))]])


bot = Bot(TOKEN)
dp = Dispatcher()
promo_file_id: str | None = None


async def send_safe(coro_factory):
    """Повтор при флуд-лимите Telegram, чтобы при наплыве никто не остался без ответа."""
    for _ in range(3):
        try:
            return await coro_factory()
        except TelegramRetryAfter as e:
            await asyncio.sleep(e.retry_after + 0.5)
        except (TelegramForbiddenError, TelegramBadRequest) as e:
            log.info("send skipped: %s", e)
            return None


START_TEXT = (
    "🚇 <b>Докопаться до Америки</b>\n\n"
    "Пока все обсуждают тоннель между Россией и США — ты копаешь.\n"
    "Веди буровую от Чукотки до Аляски, добывай золото и алмазы, "
    "чини протечки и не взорвись на газе.\n\n"
    "<i>Сатира. Все персонажи и события вымышлены.</i>"
)


@dp.message(CommandStart())
async def start(m: Message, command: CommandObject):
    global promo_file_id
    ref = (command.args or "")[:32]
    remember(m.from_user.id, ref)
    event(m.from_user.id, "start")
    photo = promo_file_id or (FSInputFile(PROMO_FILE) if PROMO_FILE.exists() else PROMO_URL)
    res = await send_safe(lambda: m.answer_photo(photo, caption=START_TEXT, parse_mode="HTML", reply_markup=play_kb_private()))
    if res and res.photo and not promo_file_id:
        promo_file_id = res.photo[-1].file_id


@dp.inline_query()
async def inline(q: InlineQuery):
    parts = (q.query or "").split()
    uid = q.from_user.id
    remember(uid)
    caption = "🚇 Докопаться до Америки. Пока все обсуждают — ты копаешь."
    title = "Позвать копать тоннель"
    if len(parts) >= 6 and parts[0] == "r":
        try:
            p, d, a, ti, wi = (int(x) for x in parts[1:6])
            p = max(0, min(100, p))
            t = TITLES[ti] if 0 <= ti < len(TITLES) else TITLES[0]
            w = DISTRACT[wi] if 0 <= wi < len(DISTRACT) else DISTRACT[1]
            if p >= 100:
                caption = f"🚇 Я докопался до Америки! Чукотка и Аляска соединены.\n💎 Алмазов: {d}. Аварий: {a}.\n🏅 Звание: «{t}»"
            else:
                caption = (f"⛏ До Аляски осталось {100 - p}%.\n💎 Алмазов найдено: {d}.\n"
                           f"🙈 От основной задачи отвлекался: {w}.\n🏅 Звание: «{t}»")
            caption += "\n\nА ты докопаешься быстрее?"
            title = f"Мой тоннель: {p}% · «{t}»"
            event(uid, "share")
        except ValueError:
            pass
    result = InlineQueryResultPhoto(
        id=str(abs(hash(q.query)) % 10**12), photo_url=PROMO_URL, thumbnail_url=PROMO_URL,
        photo_width=1280, photo_height=720, title=title, description="Карточка с результатом и кнопкой «Играть»",
        caption=caption, reply_markup=play_kb_link(f"r{uid}"),
    )
    await send_safe(lambda: q.answer([result], cache_time=30, is_personal=True))


# ---------- Telegram Stars ----------
@dp.message(Command("links"), F.from_user.id.in_(ADMINS))
async def links(m: Message):
    """Создаёт многоразовые ссылки на счета для лавки и выдаёт готовый shop-links.js."""
    out = {}
    for pid, (title, desc, stars) in PRODUCTS.items():
        out[pid] = await bot.create_invoice_link(
            title=title, description=desc, payload=f"shop:{pid}", currency="XTR",
            prices=[LabeledPrice(label=title, amount=stars)],
        )
    js = "window.DIG_SHOP = " + json.dumps(out, ensure_ascii=False, indent=1) + ";"
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


@dp.message(Command("refund"), F.from_user.id.in_(ADMINS))
async def refund(m: Message, command: CommandObject):
    """/refund <user_id> <charge_id>"""
    try:
        uid, charge = (command.args or "").split()
        await bot.refund_star_payment(user_id=int(uid), telegram_payment_charge_id=charge)
        db.execute("UPDATE purchases SET refunded=1 WHERE charge=?", (charge,))
        await m.answer("✅ Возврат выполнен")
    except Exception as e:
        await m.answer(f"❌ {e}\nФормат: /refund <user_id> <charge_id>")


@dp.message(Command("stats"), F.from_user.id.in_(ADMINS))
async def stats(m: Message):
    day = time.time() - 86400
    hour = time.time() - 3600
    users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    new24 = db.execute("SELECT COUNT(*) FROM users WHERE first>?", (day,)).fetchone()[0]
    new1h = db.execute("SELECT COUNT(*) FROM users WHERE first>?", (hour,)).fetchone()[0]
    shares = db.execute("SELECT COUNT(*) FROM events WHERE ev='share'").fetchone()[0]
    shares24 = db.execute("SELECT COUNT(*) FROM events WHERE ev='share' AND t>?", (day,)).fetchone()[0]
    refs = db.execute("SELECT COUNT(*) FROM users WHERE ref LIKE 'r%'").fetchone()[0]
    buys, stars_sum = db.execute("SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases WHERE refunded=0").fetchone()
    top = db.execute("SELECT item, COUNT(*) FROM purchases WHERE refunded=0 GROUP BY item ORDER BY 2 DESC LIMIT 7").fetchall()
    await m.answer(
        f"📊 Пользователи бота: {users}\n• за 24 ч: {new24}\n• за час: {new1h}\n"
        f"📣 Шаринги карточки: {shares} (за 24 ч: {shares24})\n🔗 Пришли по приглашению: {refs}\n"
        f"⭐ Покупки: {buys} на {stars_sum} звёзд" + ("".join(f"\n  • {PRODUCTS.get(i, (i,))[0]}: {n}" for i, n in top)) + "\n\n"
        f"Игроков, открывших Mini App по прямой ссылке, смотри в BotFather → Bot Settings → Statistics "
        f"(или @BotFather /mybots → Statistics)."
    )


@dp.message(Command("post"), F.from_user.id.in_(ADMINS))
async def post(m: Message, command: CommandObject):
    """/post @channel — опубликовать промо-пост с кнопкой (бот должен быть админом канала)."""
    target = (command.args or "").strip()
    if not target:
        await m.answer("Использование: /post @канал\nСначала добавь бота администратором канала с правом публикации.")
        return
    text = (
        "🚇 <b>Тоннель Россия — США? Копаем сами!</b>\n\n"
        "Пока все обсуждают — ты копаешь. Веди буровую от Чукотки до Аляски, "
        "добывай алмазы, спасай тоннель от протечек и посмотри, кто из друзей докопается первым.\n\n"
        "👇 Игра открывается прямо в Telegram"
    )
    photo = promo_file_id or (FSInputFile(PROMO_FILE) if PROMO_FILE.exists() else PROMO_URL)
    try:
        await bot.send_photo(target, photo, caption=text, parse_mode="HTML", reply_markup=play_kb_link("ch"))
        await m.answer("✅ Опубликовано в " + target)
    except Exception as e:
        await m.answer(f"❌ Не получилось: {e}\nПроверь, что бот — админ канала с правом публикации.")


@dp.message(Command("preview"), F.from_user.id.in_(ADMINS))
async def preview(m: Message):
    text = ("🚇 <b>Тоннель Россия — США? Копаем сами!</b>\n\nПока все обсуждают — ты копаешь…\n\n"
            "👇 Игра открывается прямо в Telegram")
    photo = promo_file_id or (FSInputFile(PROMO_FILE) if PROMO_FILE.exists() else PROMO_URL)
    await m.answer_photo(photo, caption=text, parse_mode="HTML", reply_markup=play_kb_link("ch"))


@dp.message()
async def other(m: Message):
    await send_safe(lambda: m.answer("Жми кнопку — и копаем 👇", reply_markup=play_kb_private()))


async def main():
    try:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Играть", web_app=WebAppInfo(url=GAME_URL)))
    except Exception as e:
        log.warning("menu button: %s", e)
    me = await bot.get_me()
    log.info("bot @%s started, game %s", me.username, GAME_URL)
    await dp.start_polling(bot, allowed_updates=["message", "inline_query", "pre_checkout_query"])


if __name__ == "__main__":
    asyncio.run(main())
