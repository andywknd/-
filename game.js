/* «Докопаться до Америки» — Telegram Mini App. Один файл логики, без сборки. */
(() => {
'use strict';
const C = window.CFG;
const tg = window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initData !== undefined ? window.Telegram.WebApp : null;
const inTG = !!(tg && tg.initData);
const BOT = 'digtunnelbot';
const APP_LINK = 'https://t.me/' + BOT + '/play';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- Мир ----------
const SEG = C.SEG, NCH = C.CHAPTERS, H = C.H, SURF = C.SURFACE, CT = C.CT, CB = C.CB;
// Длины участков: последние два — длинные (финал можно долго и интересно копать).
// Старые сохранения, где уже дошли до 9-го участка, остаются на прежней геометрии.
// Геометрия карты по версиям сохранений: 1 — все по 22; 2 — длинный финал; 3 — каждый участок длиннее (текущая)
const GEOS = { 1: Array(NCH).fill(SEG), 2: [22, 22, 22, 22, 22, 22, 22, 22, 40, 48], 3: [20, 22, 24, 26, 28, 30, 32, 34, 42, 50], 4: [24, 27, 30, 33, 36, 39, 42, 45, 52, 60], 5: C.SEGL || Array(NCH).fill(SEG) };
const GEO_CUR = 5;
let SEGL = GEOS[GEO_CUR], BXS = [], W = 0, N = 0;
function setGeo(v) {
  SEGL = GEOS[v] || GEOS[GEO_CUR]; BXS = [3]; for (let i = 0; i < NCH; i++) BXS.push(BXS[i] + SEGL[i]);
  W = BXS[NCH] + 7; N = W * H;
}
setGeo(GEO_CUR);
const bx = i => BXS[clamp(i, 0, NCH)];
const segLen = i => SEGL[clamp(i, 0, NCH - 1)];
const idx = (x, y) => y * W + x;
const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

let grid, ore, oreId, haz, dmg, exp, rf, dug, baseAt, decor = [];
let distField = null;

function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function chapterOfX(x) { for (let c = NCH - 1; c > 0; c--) if (x >= BXS[c]) return c; return 0; }

function generate(seed) {
  const R = mulberry(seed);
  grid = new Uint8Array(N); ore = new Uint8Array(N); oreId = new Uint8Array(N); haz = new Uint8Array(N);
  dmg = new Float32Array(N); exp = new Uint8Array(N); rf = new Uint8Array(N); dug = new Uint8Array(N);
  baseAt = new Int8Array(N).fill(-1); decor = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = idx(x, y);
    if (y < SURF - 1) { grid[k] = 7; continue; }
    if (y === SURF - 1) { grid[k] = 7; continue; }
    if (y === H - 1 || x === 0 || x === W - 1) { grid[k] = 6; continue; }
    const d = y - SURF;
    let h = d < 5 ? 1 : d < 14 ? 2 : d < 26 ? 3 : d < 38 ? 4 : 5;
    const v = vnoise(x / 5, y / 4, seed % 9973);
    if (v > 0.7) h++; else if (v < 0.3) h--;
    h = clamp(h, 1, 5);
    const c = chapterOfX(x);
    if (y >= CT - 2 && y <= CB + 2) h = clamp(h, 1, C.corridorHard[c] - (R() < 0.6 ? 1 : 0));
    if (c === 0 && y >= CT - 3 && y <= CB + 8) h = Math.min(h, R() < 0.8 ? 1 : 2);
    grid[k] = h;
  }
  // стены, требующие нужного бура (обязательный маршрут)
  for (let c = 1; c < NCH; c++) {
    const nw = Math.max(1, Math.round(segLen(c) / 18));   // в длинных участках — несколько стен
    for (let w = 1; w <= nw; w++) { const wx = bx(c) + Math.floor(segLen(c) * w / (nw + 1));
      const th = c >= 3 ? 2 : 1;   // с 4-го участка стены толще
      for (let dx = 0; dx < th; dx++) for (let y = SURF; y <= H - 2; y++) grid[idx(wx + dx, y)] = Math.max(grid[idx(wx + dx, y)], C.corridorHard[c]); }   // стена на всю высоту — не обойти
  }
  // базы
  for (let i = 0; i <= NCH; i++) {
    for (let y = CT; y <= CB; y++) for (let x = bx(i) - 1; x <= bx(i) + 1; x++) { const k = idx(x, y); grid[k] = 0; baseAt[k] = i; }
    for (let x = bx(i) - 1; x <= bx(i) + 1; x++) grid[idx(x, CB + 1)] = 6; // пол станции
  }
  const vein = (t, x, y, n, id) => {
    for (let s = 0; s < n; s++) {
      if (inb(x, y) && grid[idx(x, y)] > 0 && grid[idx(x, y)] < 6 && baseAt[idx(x, y)] < 0) { ore[idx(x, y)] = t; if (id !== undefined) oreId[idx(x, y)] = id; }
      const r = R(); if (r < .25) x++; else if (r < .5) x--; else if (r < .75) y++; else y--;
    }
  };
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  for (let c = 0; c < NCH; c++) {
    const x0 = bx(c) + 2, x1 = bx(c + 1) - 2, sm = segLen(c) / SEG;
    for (let i = 0; i < 7 * sm; i++) vein(1, ri(x0, x1), ri(CT - 3, CB + 4), ri(3, 5));
    for (let i = 0; i < 4 * sm; i++) vein(1, ri(x0, x1), ri(CB + 4, CB + 14), ri(3, 6));
    for (let i = 0; i < 5 * sm; i++) vein(2, ri(x0, x1), ri(CB + 1, CB + 12), ri(3, 5));
    for (let i = 0; i < 2; i++) vein(2, ri(x0, x1), ri(CT - 2, CB + 1), ri(2, 4));
    for (let i = 0; i < 5 * sm; i++) vein(3, ri(x0, x1), ri(CB + 6, H - 6), ri(2, 4));
    const nd = (3 + Math.floor(c / 3) + (c === 2 ? 3 : 0)) * sm;
    for (let i = 0; i < nd; i++) vein(4, ri(x0, x1), ri(SURF + 20, H - 3), ri(1, 3));
    // цветной алмаз — фиксированный тайник
    { const x = ri(x0, x1), y = ri(32, H - 4); const k = idx(x, y); grid[k] = Math.max(grid[k], 4); ore[k] = 5; oreId[k] = c; }
    // гарантия ресурсов для сегмента
    const req = C.segReq(c);
    const count = (t, ya, yb) => { let n = 0; for (let y = ya; y <= yb; y++) for (let x = bx(c); x <= bx(c + 1); x++) if (ore[idx(x, y)] === t) n++; return n; };
    let guard = 0;
    while (count(1, CT - 4, CB + 6) < req.iron * 1.6 && guard++ < 40) vein(1, ri(x0, x1), ri(CT - 3, CB + 5), 4);
    guard = 0;
    while (count(2, CT, CB + 14) < req.copper * 1.6 && guard++ < 40) vein(2, ri(x0, x1), ri(CB + 1, CB + 12), 4);
    // опасности
    if (c >= 3) {
      const nw = c === 3 ? 3 : 1 + (R() < .5 ? 1 : 0);
      for (let i = 0; i < nw; i++) { const x = ri(x0 + 2, x1 - 2), y = ri(CT, CB); if (grid[idx(x, y)] < 6) haz[idx(x, y)] = 1; }
      for (let i = 0; i < 4; i++) { const x = ri(x0, x1), y = ri(CB + 3, H - 4); haz[idx(x, y)] = 1; }
    }
    if (c >= 5) {
      for (let i = 0; i < 4; i++) {
        let x = ri(x0, x1), y = i === 0 ? ri(CT, CB) : ri(CT - 3, H - 5);
        for (let s = 0; s < ri(2, 3); s++) { if (inb(x, y) && grid[idx(x, y)] > 0 && grid[idx(x, y)] < 6 && baseAt[idx(x, y)] < 0) haz[idx(x, y)] = 2; x += R() < .5 ? 1 : -1; }
      }
    }
    if (c >= 8) {
      for (let x = x0; x <= x1; x++) for (let y = CT - 3; y < CT; y++) if (R() < .35) { grid[idx(x, y)] = 9; ore[idx(x, y)] = 0; }
    }
    for (let i = 0; i < 6 + c; i++) { const x = ri(x0, x1), y = ri(CB + 8, H - 3); if (c >= 4 && grid[idx(x, y)] < 6) { grid[idx(x, y)] = 9; ore[idx(x, y)] = 0; } }
  }
  // артефакты в секретных полостях
  const artCh = [0, 1, 4, 5, 6, 8];
  artCh.forEach((c, a) => {
    const x = ri(bx(c) + 4, bx(c + 1) - 4), y = c === 0 ? 24 : ri(26, H - 6);
    for (let yy = y - 1; yy <= y; yy++) for (let xx = x - 1; xx <= x + 1; xx++) { const k = idx(xx, yy); grid[k] = 0; ore[k] = 0; haz[k] = 0; }
    const k = idx(x, y + 1); grid[k] = 2; ore[k] = 6; oreId[k] = a; haz[k] = 0;
  });
  // обучение: небольшой алмаз рядом со стартом
  { const k = idx(bx(0) + 7, CB + 6); grid[k] = 1; ore[k] = 4; }
  decor.push({ t: 'mammoth', x: bx(1) + 8, y: CB + 3 });
  decor.push({ t: 'oil', x: bx(8) + 12, y: H - 8 });
  decor.push({ t: 'doc', x: bx(4) + 10, y: CB + 4 });
  // коридор: убираем газ/воду из стен станций
  for (let i = 0; i <= NCH; i++) for (let y = CT - 1; y <= CB + 1; y++) for (let x = bx(i) - 2; x <= bx(i) + 2; x++) haz[idx(x, y)] = 0;
}

// ---------- Состояние ----------
let S = null;
const defaultState = () => ({
  v: 1, wv: 5, seed: (Math.random() * 1e9) | 0, coins: C.START_COINS,
  fuel: C.UPGRADES.tank.vals[0], hull: C.UPGRADES.hull.vals[0], heat: 0,
  x: bx(0), y: CB, dir: 'r',
  cargo: [], wh: { iron: 0, copper: 0, gold: 0, diamond: 0, colored: [] },
  up: { drill: 1, tank: 1, cooling: 1, hull: 1, cargo: 1, scanner: 1, drive: 1 },
  cons: { can: 1, rep: 0, cool: 1 }, built: 0, lastBase: 0, visited: [0], fill: [], drops: [], conts: [], pins: [],
  quests: {}, coll: { colored: [], art: [] }, ach: [],
  stats: { diamonds: 0, accidents: 0, sorties: 0, delivered: 0, earned: 0, playTime: 0, distract: 0, started: Date.now(), finishedAt: 0, maxDepth: 0, segEvac: 0 },
  set: { sound: true, jokes: true, vibro: true, calm: false },
  tut: { intro: false, firstOre: false, back: false, returned: false, scan: false, upgr: false },
  proto: false, done: false, t: 0, chIntro: -1, completions: 0, shop: {}, turboUntil: 0, buys: 0, refs: { n: 0, tokens: 0, big: false }, tr: { t: 0, got: [] }, segT0: 0,
});

const upv = k => C.UPGRADES[k].vals[S.up[k] - 1];
const tankMax = () => Math.round(upv('tank') * (S.shop && S.shop.tank_plus ? 1.3 : 1));
const hullMax = () => upv('hull');
const cargoMax = () => upv('cargo');
const consCap = () => 1 + (S.up.cargo >= 3 ? 1 : 0) + (S.up.cargo >= 5 ? 1 : 0);
const drillCap = () => S.up.drill + 1 + (S.proto ? 1 : 0) + (S.legend ? 1 : 0);
const drillDps = () => upv('drill') * (S.proto ? 1.7 : 1) * (S.legend ? 1.3 : 1) * (S.turboUntil > S.stats.playTime ? 2 : 1);
const fenceX = () => S.built >= NCH ? W : bx(S.built + 1) + 2;
const isOpenBase = k => baseAt[k] >= 0 && baseAt[k] <= S.built;
// Один процент везде: доля прокопанной длины тоннеля (учитывает длинные финальные участки)
const pct = () => { if (S.built >= NCH) return 100; const L = bx(NCH) - bx(0), cur = clamp(1 - segGap / segLen(S.built), 0, 1) * segLen(S.built); return Math.min(99, Math.round((bx(S.built) - bx(0) + cur) / L * 100)); };
// Постепенное раскрытие механик: сначала «просто копай», дальше — по главе за раз
const F = {
  get simple() { return S.built < 1; },
  get heat() { return S.built >= 1; },
  get scan() { return S.built >= 2; },
  get hull() { return S.built >= 3; },
  get quests() { return S.built >= 2; },
  get shop() { return S.built >= 1 && shopReady(); },
  cons(k) { return k === 'cool' ? S.built >= 1 : k === 'can' ? S.built >= 2 : S.built >= 3; },
  up(k) { return ['drill', 'tank', 'cargo'].includes(k) || (k === 'cooling' && S.built >= 1) || (k === 'scanner' && S.built >= 2) || ((k === 'hull' || k === 'drive') && S.built >= 3); },
  item(id) { return ['cat', 'skin_gold', 'coins'].includes(id) ? S.built >= 1 : ['lift', 'tank_plus'].includes(id) ? S.built >= 3 : S.built >= 4; },
};

function applyStateToMap() {
  // wv: 2 — новая геометрия; 1 — старая; нет — сохранение до обновления
  let oldW = 0;
  // Переезд на новую геометрию: пока не построена ни одна станция — сразу на текущую;
  // иначе остаёмся на своей (станции уже стоят на своих местах). Старые без версии -> 2 (первые 8 участков совпадают).
  const from = S.wv || 1;
  let to = from;
  if (S.built === 0) to = GEO_CUR; else if (from === 1 && S.built < 9) to = 2;
  if (to !== from) { setGeo(from); oldW = W; S.wv = to; } else S.wv = from;
  setGeo(S.wv);
  generate(S.seed);
  const dec = (str, arr) => { if (!str) return; const p = str.split(','); let pos = 0, val = 0; for (const s of p) { const n = +s; if (val) arr.fill(1, pos, pos + n); pos += n; val ^= 1; } };
  if (oldW && oldW !== W) {
    const remap = k => { const x = k % oldW, y = (k / oldW) | 0; return idx(x, y); };
    const decR = (str, arr) => { if (!str) return; const tmp = new Uint8Array(oldW * H); dec(str, tmp); for (let k = 0; k < tmp.length; k++) if (tmp[k]) arr[remap(k)] = 1; };
    decR(S._dug, dug); decR(S._exp, exp); decR(S._rf, rf);
    S.fill = S.fill.map(remap); S.pins = S.pins.map(remap);
  } else { dec(S._dug, dug); dec(S._exp, exp); dec(S._rf, rf); }
  for (let k = 0; k < N; k++) if (dug[k]) { grid[k] = 0; ore[k] = 0; haz[k] = 0; }
  for (const k of S.fill) { if (!rf[k]) { grid[k] = 8; ore[k] = 0; } }
  delete S._dug; delete S._exp; delete S._rf;
  computeDist();
}
const enc = arr => { const out = []; let val = 0, run = 0; for (let k = 0; k < arr.length; k++) { const b = arr[k] ? 1 : 0; if (b === val) run++; else { out.push(run); run = 1; val = b; } } out.push(run); return out.join(','); };

// ---------- Сохранение ----------
let dirty = false, lastSave = 0;
function serialize() {
  const o = Object.assign({}, S); o._dug = enc(dug); o._exp = enc(exp); o._rf = enc(rf); o.t = Date.now();
  return JSON.stringify(o);
}
function save(force) {
  if (!S) return;
  const now = performance.now();
  if (!force && (!dirty || now - lastSave < 10000)) return;
  lastSave = now; dirty = false;
  const str = serialize();
  try { localStorage.setItem('dig_save', str); } catch (e) {}
  if (inTG && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) {
    const parts = []; for (let i = 0; i < str.length; i += 3800) parts.push(str.slice(i, i + 3800));
    try {
      parts.forEach((p, i) => tg.CloudStorage.setItem('g' + i, p, () => {}));
      tg.CloudStorage.setItem('gmeta', JSON.stringify({ n: parts.length, t: Date.now() }), () => {});
    } catch (e) {}
  }
}
function loadAll(cb) {
  let local = null;
  try { const s = localStorage.getItem('dig_save'); if (s) local = JSON.parse(s); } catch (e) {}
  if (!(inTG && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9'))) return cb(local);
  let done = false; const fin = v => { if (!done) { done = true; cb(v); } };
  setTimeout(() => fin(local), 2500);
  try {
    tg.CloudStorage.getItem('gmeta', (err, m) => {
      if (err || !m) return fin(local);
      let meta; try { meta = JSON.parse(m); } catch (e) { return fin(local); }
      if (local && local.t >= meta.t) return fin(local);
      const keys = []; for (let i = 0; i < meta.n; i++) keys.push('g' + i);
      tg.CloudStorage.getItems(keys, (e2, vals) => {
        if (e2 || !vals) return fin(local);
        try { const cloud = JSON.parse(keys.map(k => vals[k] || '').join('')); fin(cloud && (!local || cloud.t > local.t) ? cloud : local); } catch (e) { fin(local); }
      });
    });
  } catch (e) { fin(local); }
}

// ---------- Аналитика ----------
// События копятся и уходят пачкой раз в 15 с (и при сворачивании) — так сервер выдерживает пики
let evQ = [], evT = null;
function track(ev, d) {
  if (!inTG || !window.DIG_API) return;
  evQ.push([ev, d || null]); if (evQ.length > 40) evQ.shift();
  if (!evT) evT = setTimeout(sendEvents, ev === 'open' ? 1500 : 15000);
}
function sendEvents(beacon) {
  clearTimeout(evT); evT = null;
  if (!evQ.length || !inTG || !window.DIG_API) return;
  const s = S ? { built: S.built, diamonds: S.stats.diamonds, coins: Math.floor(S.coins), play: Math.floor(S.stats.playTime), done: S.done ? 1 : 0, buys: S.buys || 0, tut: S.tut.returned ? 1 : 0 } : {};
  const body = JSON.stringify({ init: tg.initData, ev: evQ.splice(0, 40), s });
  const url = window.DIG_API + '/e';
  try {
    if (beacon && navigator.sendBeacon) navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }));
    else fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body, keepalive: true }).catch(() => {});
  } catch (e) {}
}

// ---------- Звук и вибрация ----------
let AC = null, noiseBuf = null;
function audio() {
  if (!S || !S.set.sound) return null;
  if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); const len = AC.sampleRate * 0.3; noiseBuf = AC.createBuffer(1, len, AC.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; } catch (e) { return null; } }
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(f, dur, type, vol, slide) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(); o.type = type || 'sine'; o.frequency.value = f;
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, a.currentTime + dur);
  g.gain.setValueAtTime(vol || .12, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + dur);
  o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}
function noise(dur, freq, vol) {
  const a = audio(); if (!a) return;
  const s = a.createBufferSource(); s.buffer = noiseBuf; const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = a.createGain(); g.gain.setValueAtTime(vol || .15, a.currentTime); g.gain.exponentialRampToValueAtTime(.001, a.currentTime + dur);
  s.connect(f); f.connect(g); g.connect(a.destination); s.start(); s.stop(a.currentTime + dur);
}
const SFX = {
  drill: h => noise(.11, 180 + h * 120, .07),
  break: () => noise(.12, 420, .1),
  pick: () => { tone(880, .12, 'triangle', .1); setTimeout(() => tone(1320, .15, 'triangle', .08), 70); },
  gem: () => { [988, 1319, 1760].forEach((f, i) => setTimeout(() => tone(f, .25, 'sine', .09), i * 80)); },
  warn: () => tone(520, .18, 'square', .05),
  boom: () => { noise(.6, 90, .35); tone(70, .5, 'sawtooth', .12, 30); },
  coin: () => { tone(1200, .08, 'square', .05); setTimeout(() => tone(1600, .12, 'square', .05), 60); },
  build: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .35, 'triangle', .09), i * 110)); },
};
function haptic(kind) {
  if (!S || !S.set.vibro) return;
  try {
    if (inTG && tg.HapticFeedback) {
      if (kind === 'light' || kind === 'medium' || kind === 'heavy') tg.HapticFeedback.impactOccurred(kind);
      else tg.HapticFeedback.notificationOccurred(kind);
    } else if (navigator.vibrate) navigator.vibrate(kind === 'heavy' || kind === 'error' ? 60 : 15);
  } catch (e) {}
}

// ---------- Ассеты ----------
const IMG = {};
['drill', 'drill_2', 'drill_3', 'drill_4', 'drill_5', 'att/tank', 'att/cool', 'att/radar', 'att/cargo', 'att/armor', 'att/turbo', 'station', 'petrovich', 'alya', 'bob', 'billionaire', 'train', 'drill_gold', 'cat_sit', 'i_tank', 'i_rocket', 'i_ins'].forEach(n => {
  const i = new Image(); i.src = 'assets/' + n + '.webp'; IMG[n] = i;
});
const ok = i => i && i.complete && i.naturalWidth > 0;
// ---------- Нарисованные иконки вместо эмодзи ----------
const ICON_FILE = { scanner: 'up_scanner', hull: 'up_hull', drill: 'drill', cat: 'shop_cat', lift: 'shop_lift', train: 'train' };
const upImg = (k, n) => n > 1 ? `assets/up/${k}_${n}.webp` : `assets/up_${k}.webp`;
const icSrc = n => 'assets/' + (ICON_FILE[n] || 'i/' + n) + '.webp';
const ICI = {};
function drawIc(n, x, y, size) {
  let im = ICI[n]; if (!im) { im = ICI[n] = new Image(); im.src = icSrc(n); }
  if (!ok(im)) return; const w = size, h = size * im.naturalHeight / im.naturalWidth;
  cx.drawImage(im, x - w / 2, y - h / 2, w, h);
}
const EMO = { '🧭': 'trmap', '🌊': 'pump', '🪙': 'coin', '💰': 'coin', '⛽': 'fuel', '📦': 'cargo', '🎒': 'cargo', '🌡': 'heat', '🛡': 'hull', '🪨': 'iron', '🟠': 'copper', '🟡': 'gold',
  '💎': 'diamond', '✨': 'diamond', '💗': 'pinkgem', '🏁': 'flag', '🎯': 'flag', '🏔': 'mountain', '👥': 'friends', '🙂': 'friends', '🎁': 'gift', '🎟': 'ticket',
  '📨': 'envelope', '⚙': 'gear', '🏠': 'home', '🚨': 'siren', '⭐': 'star', '🔧': 'repair', '❄': 'coolant', '🚰': 'pump', '🧰': 'container', '📍': 'pin', '☁': 'gas',
  '🦣': 'mammoth', '🛢': 'oil', '📄': 'doc', '📋': 'doc', '⛏': 'pickaxe', '👆': 'hand', '🏆': 'trophy', '📣': 'megaphone', '📲': 'megaphone', '⚡': 'bolt',
  '📡': 'scanner', '🚜': 'drill', '🐈': 'cat', '🚀': 'lift', '🚃': 'train', '🚇': 'train', '🚂': 'train' };
const EMO_TXT = { '✕': '×', '✖': '×', '▶': '›', '✅': '✓', '✔': '✓', '➡': '→', '⬆': '↑', '⬇': '↓', '➕': '+' };
const EMO_RE = /(\p{Extended_Pictographic}|[\u2700-\u27BF\u2B06\u2B07\u2B50])(\uFE0F|\u200D\p{Extended_Pictographic}\uFE0F?)*/gu;
function iconizeText(node) {
  const t = node.nodeValue; if (!t || !EMO_RE.test(t)) return; EMO_RE.lastIndex = 0;
  const frag = document.createDocumentFragment(); let last = 0, m;
  while ((m = EMO_RE.exec(t))) {
    if (m.index > last) frag.appendChild(document.createTextNode(t.slice(last, m.index)));
    const base = m[0].replace(/\uFE0F|\u200D.*/gu, ''), n = EMO[base];
    if (n) { const im = document.createElement('img'); im.className = 'ic'; im.src = icSrc(n); im.alt = ''; frag.appendChild(im); }
    else if (EMO_TXT[base]) frag.appendChild(document.createTextNode(EMO_TXT[base]));
    last = m.index + m[0].length;
  }
  if (last < t.length) frag.appendChild(document.createTextNode(t.slice(last)));
  node.parentNode && node.parentNode.replaceChild(frag, node);
}
function iconizeDom(root) {
  if (!root) return;
  if (root.nodeType === 3) return iconizeText(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const list = [];
  while (w.nextNode()) list.push(w.currentNode);
  list.forEach(iconizeText);
}
iconizeDom(document.body);
new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') iconizeText(m.target); else m.addedNodes.forEach(iconizeDom); } })
  .observe(document.body, { childList: true, subtree: true, characterData: true });
let goldC = null;
function goldSprite() {
  if (goldC) return goldC; if (!ok(IMG.drill)) return IMG.drill;
  const c = document.createElement('canvas'); c.width = IMG.drill.naturalWidth; c.height = IMG.drill.naturalHeight; const g = c.getContext('2d');
  g.drawImage(IMG.drill, 0, 0); g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, 0, c.width, c.height); gr.addColorStop(0, 'rgba(255,236,140,.75)'); gr.addColorStop(.5, 'rgba(230,170,30,.65)'); gr.addColorStop(1, 'rgba(255,240,170,.75)');
  g.fillStyle = gr; g.fillRect(0, 0, c.width, c.height); goldC = c; return c;
}

// ---------- Canvas ----------
const cv = $('game'), cx = cv.getContext('2d');
const light = document.createElement('canvas'), lx = light.getContext('2d');
let VW = 0, VH = 0, DPR = 1, TS = 40, tiles = {};
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = window.innerWidth; VH = window.innerHeight;
  cv.width = VW * DPR; cv.height = VH * DPR;
  light.width = Math.ceil(VW / 2); light.height = Math.ceil(VH / 2);
  TS = Math.round(Math.max(30, Math.min(VW / 9.2, VH / 14)));
  buildTiles();
}
const PAL = {
  1: ['#8a5a34', '#6c4226', '#a06c42'], 2: ['#8c8a9a', '#6d6c7d', '#c8e4f2'], 3: ['#6b6f78', '#545862', '#868a93'],
  4: ['#8c7a80', '#6b5b62', '#a8959b'], 5: ['#3d414d', '#2c2f39', '#545967'], 6: ['#1c1d24', '#121318', '#2a2b33'],
  7: ['#2c5c63', '#1f454b', '#3b7680'], 8: ['#7b6a5a', '#5f5144', '#93806d'], 9: ['#8a5a34', '#6c4226', '#a06c42'],
};
function buildTiles() {
  tiles = {};
  const px = Math.ceil(TS * DPR);
  const mk = (draw) => { const c = document.createElement('canvas'); c.width = c.height = px; const g = c.getContext('2d'); draw(g, px); return c; };
  for (const t in PAL) {
    tiles[t] = [];
    for (let v = 0; v < 3; v++) {
      const R = mulberry(t * 100 + v);
      tiles[t].push(mk((g, s) => {
        const [a, b, c] = PAL[t];
        g.fillStyle = a; g.fillRect(0, 0, s, s);
        for (let i = 0; i < 9; i++) { g.fillStyle = R() < .5 ? b : c; const r = s * (0.05 + R() * 0.1); g.beginPath(); g.ellipse(R() * s, R() * s, r, r * (0.6 + R() * .5), R() * 3, 0, 7); g.fill(); }
        if (t == 2) { g.fillStyle = 'rgba(210,240,255,.55)'; for (let i = 0; i < 6; i++) g.fillRect(R() * s, R() * s, s * .07, s * .03); }
        if (t == 9) { g.strokeStyle = '#2a1508'; g.lineWidth = s * .05; g.beginPath(); g.moveTo(s * .2, 0); g.lineTo(s * .45, s * .4); g.lineTo(s * .3, s * .7); g.lineTo(s * .55, s); g.moveTo(s * .45, s * .4); g.lineTo(s * .85, s * .55); g.stroke(); }
        if (t == 6) { g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = s * .04; g.strokeRect(s * .05, s * .05, s * .9, s * .9); }
        g.fillStyle = 'rgba(255,255,255,.07)'; g.fillRect(0, 0, s, s * .08);
        g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, s * .92, s, s * .08);
      }));
    }
  }
  tiles.unk = [0, 1, 2].map(v => mk((g, s) => { const R = mulberry(900 + v); g.fillStyle = '#17120f'; g.fillRect(0, 0, s, s); g.fillStyle = '#1f1914'; for (let i = 0; i < 5; i++) g.fillRect(R() * s, R() * s, s * .15, s * .1); }));
  tiles.empty = [0, 1].map(v => mk((g, s) => { const R = mulberry(700 + v); g.fillStyle = '#2b2019'; g.fillRect(0, 0, s, s); g.fillStyle = '#241a14'; for (let i = 0; i < 6; i++) g.fillRect(R() * s, R() * s, s * .2, s * .08); }));
  tiles.rf = [mk((g, s) => {
    g.fillStyle = '#4b525c'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#5a626d'; g.fillRect(0, 0, s, s * .12); g.fillRect(0, s * .5, s, s * .04);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = s * .03; g.strokeRect(0, 0, s / 2, s * .5); g.strokeRect(s / 2, 0, s / 2, s * .5);
    g.fillStyle = '#3a2a1c'; for (let i = 0; i < 3; i++) g.fillRect(i * s / 3 + s * .05, s * .86, s * .2, s * .07);
    g.fillStyle = '#b8c0c8'; g.fillRect(0, s * .82, s, s * .05);
  })];
}

// ---------- Ввод ----------
const keys = {};
let joyDir = null, joyId = null, joyO = null;
const KEYMAP = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r' };
window.addEventListener('keydown', e => { if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = 1; e.preventDefault(); if (typeof hideHint === 'function') hideHint(); } if (e.code === 'Space') { useScan(); e.preventDefault(); } if (e.code === 'KeyE' && atBase >= 0) openBase(); });
window.addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = 0; });
const jz = $('joyzone'), joy = $('joy'), knob = $('knob');
function hideHint() { $('tapHint').classList.add('hidden'); if (S && !S.tut.moved) { S.tut.moved = true; dirty = true; } }
// Управление: (1) зажми палец рядом с буровой — она едет в ту сторону; (2) или веди пальцем как джойстиком.
let joyMode = 'point', fingerX = 0, fingerY = 0;
jz.addEventListener('pointerdown', e => {
  audio(); hideHint(); if (joyId !== null) return; joyId = e.pointerId; joyO = { x: e.clientX, y: e.clientY };
  fingerX = e.clientX; fingerY = e.clientY; joyMode = 'point'; joyDir = null;
  joy.style.left = e.clientX + 'px'; joy.style.top = e.clientY + 'px'; knob.style.transform = '';
  try { jz.setPointerCapture(e.pointerId); } catch (er) {}
  e.preventDefault();
});
jz.addEventListener('pointermove', e => {
  if (e.pointerId !== joyId) return;
  fingerX = e.clientX; fingerY = e.clientY;
  let dx = e.clientX - joyO.x, dy = e.clientY - joyO.y; const L = Math.hypot(dx, dy);
  if (joyMode === 'point' && L > 22) { joyMode = 'joy'; joy.classList.remove('hidden'); }
  if (joyMode !== 'joy') return;
  const m = Math.min(L, 44); const kx = L ? dx / L * m : 0, ky = L ? dy / L * m : 0;
  knob.style.transform = `translate(${kx}px,${ky}px)`;
  if (L < 14) joyDir = null; else joyDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u');
});
const joyEnd = e => { if (e.pointerId !== joyId) return; joyId = null; joyDir = null; joyMode = 'point'; joy.classList.add('hidden'); };
jz.addEventListener('pointerup', joyEnd); jz.addEventListener('pointercancel', joyEnd); jz.addEventListener('lostpointercapture', joyEnd);
function pointDir() {
  // направление от буровой к пальцу
  const mx = M.rx * TS - camX + TS / 2, my = M.ry * TS - camY + TS / 2;
  const dx = fingerX - mx, dy = fingerY - my;
  if (Math.abs(dx) < TS * .6 && Math.abs(dy) < TS * .6) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'r' : 'l') : (dy > 0 ? 'd' : 'u');
}
const inputDir = () => (joyId !== null ? (joyMode === 'joy' ? joyDir : pointDir()) : null) || (keys.r ? 'r' : keys.l ? 'l' : keys.u ? 'u' : keys.d ? 'd' : null);
const DIRS = { r: [1, 0], l: [-1, 0], u: [0, -1], d: [0, 1] };

// ---------- Машина ----------
const M = { x: 0, y: 0, rx: 0, ry: 0, st: 'idle', fx: 0, fy: 0, t: 0, dur: 0, drillK: -1, drillT: 0, shake: 0 };
let atBase = -1, paused = true, scan = null, scanCD = 0, leak = null, collapses = [], particles = [], trail = [];
let run = null, lastTip = 0, flash = 0, shakeT = 0, sayCD = 0, ambientT = 60, branchJoked = false, warnState = '';
let saidOnce = {};

function passable(x, y) { if (!inb(x, y) || y < SURF) return false; if (x >= fenceX()) return false; return grid[idx(x, y)] === 0; }
function hardAt(x, y) { if (!inb(x, y) || y < SURF) return 99; if (x >= fenceX()) return 99; return C.BLOCKS[grid[idx(x, y)]].hard; }

function startMove(tx, ty, dur, kind) { M.fx = M.x; M.fy = M.y; M.x = tx; M.y = ty; M.t = 0; M.dur = dur; M.st = kind || 'move'; }

function reveal(x0, y0, r) {
  for (let y = y0 - r; y <= y0 + r; y++) for (let x = x0 - r; x <= x0 + r; x++) if (inb(x, y) && (x - x0) ** 2 + (y - y0) ** 2 <= r * r + 1) exp[idx(x, y)] = 1;
}

function computeDist() {
  if (S) try { updGap(); } catch (e) {}
  distField = new Int16Array(N).fill(-1);
  const q = new Int32Array(N); let h = 0, t = 0;
  for (let k = 0; k < N; k++) if (isOpenBase(k)) { distField[k] = 0; q[t++] = k; }
  const fx = fenceX();
  while (h < t) {
    const k = q[h++]; const x = k % W, y = (k / W) | 0;
    const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [a, b] of nb) { if (a < 0 || b < SURF || a >= fx || b >= H) continue; const j = idx(a, b); if (grid[j] === 0 && distField[j] < 0) { distField[j] = distField[k] + 1; q[t++] = j; } }
  }
}

function fuelNeed() { const d = distField ? distField[idx(M.x, M.y)] : -1; if (d < 0) return 999; return d * 0.42 + 1; }

function collect(k, x, y) {
  const t = ore[k]; if (!t) return;
  ore[k] = 0;
  const item = { t }; if (t >= 5) item.id = oreId[k];
  if (S.cargo.length < cargoMax()) {
    S.cargo.push(item); floater(x, y, '+' + C.ORES[t].name, t >= 4 ? '#7fe9ff' : t === 3 ? '#ffd84a' : '#fff');
    if (t >= 4) { SFX.gem(); haptic('success'); } else SFX.pick();
    if (t === 4 && !S.quests._firstFind) { S.quests._firstFind = 1; track('first_diamond_found'); }
    if (!S.tut.firstOre) { S.tut.firstOre = true; say('petrovich', t === 1 ? 'Железо! На укрепление пойдёт. Отсек не резиновый — следи за 📦.' : 'Ценная находка! Довези до базы — тогда это деньги.'); }
    if (S.cargo.length >= cargoMax()) say('alya', 'Отсек полон. Дальше добыча останется лежать на месте — вернёшься за ней.', true);
  } else {
    S.drops.push({ x, y, t, id: item.id }); floater(x, y, 'Отсек полон', '#ff8a8a'); SFX.warn();
  }
}

function breakCell(x, y) {
  const k = idx(x, y);
  collect(k, x, y);
  const hz = haz[k]; haz[k] = 0;
  grid[k] = 0; dug[k] = 1; dmg[k] = 0; dirty = true;
  const fi = S.fill.indexOf(k); if (fi >= 0) S.fill.splice(fi, 1);
  S.pins = S.pins.filter(p => p !== k);
  SFX.break(); haptic('light');
  for (let i = 0; i < 6; i++) particles.push({ x: x + .5, y: y + .5, vx: rnd(-3, 3), vy: rnd(-4, 1), life: rnd(.3, .6), c: PAL[grid[k] || 1] ? PAL[1][0] : '#888' });
  // нестабильный грунт сверху
  for (let yy = y - 1; yy >= SURF && grid[idx(x, yy)] === 9; yy--) collapses.push({ x, y: yy, t: 1.0 + (y - 1 - yy) * 0.25 });
  if (hz === 1) startLeak(x, y);
  if (hz === 2) gasEvent(x, y);
  computeDist();
}

function gasEvent(x, y) {
  if (S.heat >= 40) {
    SFX.boom(); haptic('error'); flash = S.set.calm ? 0 : .6; shakeT = S.set.calm ? 0 : .5;
    S.hull -= hullMax() * 0.35; floater(x, y, 'БУМ! Газ', '#ff5a3a');
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      if (!inb(xx, yy) || yy < SURF || xx >= fenceX()) continue; const j = idx(xx, yy);
      if (grid[j] > 0 && grid[j] < 6 && !rf[j] && baseAt[j] < 0) { if (ore[j]) S.drops.push({ x: xx, y: yy, t: ore[j], id: ore[j] >= 5 ? oreId[j] : undefined }); ore[j] = 0; grid[j] = 0; dug[j] = 1; haz[j] = 0; }
    }
    say('alya', 'Горячий бур + газ = вот это. Подходи к зелёным пятнам холодным ❄️', true);
  } else { floater(x, y, 'Газ стравлен безопасно', '#9dff8a'); }
}

function startLeak(x, y) {
  if (leak) return;
  let p = null;
  for (let i = trail.length - 8; i >= 0 && i >= trail.length - 14; i--) { const c = trail[i]; if (c && (Math.abs(c[0] - x) + Math.abs(c[1] - y)) >= 3) { p = c; break; } }
  if (!p) p = trail[0] || [bx(S.lastBase), CB];
  leak = { x, y, t: 22, T: 22, px: p[0], py: p[1] };
  SFX.warn(); haptic('warning');
  say('alya', 'Протечка! Быстро к помпе 🚰 — она отмечена. У тебя 22 секунды!', true);
}

function evacuate(cause) {
  paused = true;
  const lost = [], kept = [], uniq = [];
  S.cargo.forEach(it => (it.t >= 5 ? uniq : (!S.shop.insurance && Math.random() < .5 ? lost : kept)).push(it));
  const showCause = { fuel: 'Топливо закончилось', hull: 'Машина разрушена', leak: 'Помпу не успели включить' }[cause] || 'Авария';
  modal(`<h2>🚨 ${showCause}</h2>
    <p>Бригада эвакуирует машину на станцию ${S.lastBase === 0 ? '«Чукотка»' : '№' + S.lastBase}.</p>
    <p>${S.shop.insurance ? '• 📄 Страховка «Каско-бур»: добыча сохраняется полностью.' : '• Теряется ~половина обычной добычи (<b>' + lost.length + '</b> из ' + (lost.length + kept.length) + ').'}<br>
    ${uniq.length ? `• Уникальные находки (${uniq.length}) останутся в аварийном контейнере на месте поломки.<br>` : ''}
    • Тоннель, улучшения, монеты и коллекция сохраняются.<br>• Базовый ремонт и топливо — бесплатно.</p>`,
    [{ t: 'Эвакуировать', cls: 'btn', fn: () => {
      if (uniq.length) S.conts.push({ x: M.x, y: M.y, items: uniq });
      S.cargo = kept; S.stats.accidents++; S.stats.segEvac++;
      track('accident', { cause, ch: S.built });
      leak = null; collapses = [];
      teleport(S.lastBase);
      S.fuel = Math.max(S.fuel, tankMax() * .5); S.hull = Math.max(S.hull, hullMax() * .5); S.heat = 0;
      dirty = true; save(true); paused = false;
      setTimeout(() => say('petrovich', ['Ничего, бывает. Главное — каска цела.', 'Зато проверили систему эвакуации. Работает!', 'Машину вытащили. Гордость — пока нет.'][S.stats.accidents % 3], true), 400); catSay('evac');
      onArriveBase(S.lastBase, true);
    } }]);
}

let seaT = 0, seaWarned = false, seaFrame = false;
function flood() {
  paused = true; SFX.warn(); haptic('error'); track('flood', { ch: S.built });
  const f = $('flood'); f.classList.remove('hidden'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  setTimeout(() => {
    const uniq = S.cargo.filter(it => it.t >= 5), lost = S.cargo.length - uniq.length;
    modal(`<div class="fldimg">🌊</div><h2 style="text-align:center">Тоннель затопило!</h2>
      <p style="text-align:center">Бур пробил дно пролива — вода хлынула внутрь. Насосы всё откачали, но вылазку придётся начать заново со станции.</p>
      <p style="text-align:center;color:#9db4c2;font-size:13px">${lost ? 'Обычная добыча утонула (' + lost + ' шт.). ' : ''}Тоннель, улучшения и монеты на месте.<br>Совет: копай под морем, а не в него ↑</p>`,
      [{ t: 'Начать заново', cls: 'btn', fn: () => {
        f.classList.add('hidden'); f.classList.remove('go');
        S.cargo = uniq; S.stats.floods = (S.stats.floods || 0) + 1; S.stats.segEvac++;
        leak = null; collapses = []; teleport(S.lastBase);
        S.fuel = Math.max(S.fuel, tankMax() * .5); S.hull = Math.max(S.hull, hullMax() * .5); S.heat = 0;
        dirty = true; save(true); paused = false;
        setTimeout(() => say('petrovich', 'Вода — штука мокрая. Под дном копаем, а не сквозь него!', true), 400); catSay('flood');
        onArriveBase(S.lastBase, true);
      } }]);
  }, 1500);
}

function teleport(b) { M.x = bx(b); M.y = CB; M.rx = M.x; M.ry = M.y; M.st = 'idle'; S.x = M.x; S.y = M.y; reveal(M.x, M.y, 3); atBase = b; trail = []; }

function arrive() {
  S.x = M.x; S.y = M.y;
  reveal(M.x, M.y, 3);
  trail.push([M.x, M.y]); if (trail.length > 40) trail.shift();
  if (M.y > S.stats.maxDepth) S.stats.maxDepth = M.y;
  if (M.y >= H - 3) achieve('core');
  // подбор
  for (let i = S.drops.length - 1; i >= 0; i--) { const d = S.drops[i]; if (d.x === M.x && d.y === M.y && S.cargo.length < cargoMax()) { S.cargo.push({ t: d.t, id: d.id }); S.drops.splice(i, 1); floater(M.x, M.y, '+' + C.ORES[d.t].name, '#fff'); SFX.pick(); } }
  for (let i = S.conts.length - 1; i >= 0; i--) { const c = S.conts[i]; if (c.x === M.x && c.y === M.y) { while (c.items.length && S.cargo.length < cargoMax()) S.cargo.push(c.items.pop()); if (!c.items.length) { S.conts.splice(i, 1); floater(M.x, M.y, 'Контейнер подобран', '#7fe9ff'); SFX.gem(); } } }
  trCheck();
  if (leak && M.x === leak.px && M.y === leak.py) {
    leak = null; S.coins += 40; floater(M.x, M.y, 'Помпа включена! +40', '#7fd0ff'); SFX.build(); haptic('success');
    questDone('leak'); achieve('noleak'); say('alya', 'Откачали! Тоннель снова тоннель, а не аквапарк.', true);
  }
  const k = idx(M.x, M.y);
  const b = isOpenBase(k) ? baseAt[k] : -1;
  if (b >= 0 && atBase < 0) onArriveBase(b, false);
  if (b < 0 && atBase >= 0) onLeaveBase();
  atBase = b;
  dirty = true;
}

function onLeaveBase() {
  run = { fuel0: S.fuel, maxHeat: S.heat, away: 0 };
  S.stats.sorties++; branchJoked = false;
  track('sortie', { ch: S.built });
}

let baseSummary = null;
// Бесконечный режим: после финала руда и алмазы появляются снова
function respawnOres() {
  let n = 0;
  for (let tries = 0; tries < 900 && n < 45; tries++) {
    let x = 3 + Math.floor(Math.random() * (W - 7)), y = SURF + 2 + Math.floor(Math.random() * (H - SURF - 4));
    const r = Math.random(), t = r < .32 ? 1 : r < .6 ? 2 : r < .84 ? 3 : 4;
    const len = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < len; i++) {
      if (!inb(x, y)) break; const k = idx(x, y);
      if (grid[k] >= 1 && grid[k] <= 5 && !ore[k] && !rf[k] && baseAt[k] < 0) { ore[k] = t; n++; }
      if (Math.random() < .5) x += Math.random() < .5 ? 1 : -1; else y += Math.random() < .5 ? 1 : -1;
    }
  }
  return n;
}
// ---------- Бесконечный режим: три древних сокровища, разбитых на осколки ----------
const TREASURES = [
  { id: 'amber', name: 'Янтарный мамонт', piece: 'осколок янтаря', reward: 1500, text: 'Древний янтарь с крошечным мамонтом внутри. Ему около сорока тысяч лет — он старше любой сметы.' },
  { id: 'compass', name: 'Компас первопроходцев', piece: 'деталь компаса', reward: 2500, text: 'Старинный компас из семи деталей. Говорят, он всегда показывает на ближайший обед.' },
  { id: 'meteor', name: 'Звёздный метеорит', piece: 'кристалл метеорита', reward: 4000, text: 'Упал сюда задолго до первого бура. Светится, когда рядом кто-то копает.' },
];
const TR_N = 7;
const trOn = () => S.done && S.tr && S.tr.t < TREASURES.length;
let trCache = null;
function trPieces() {
  const t = S.tr.t; if (trCache && trCache.t === t && trCache.seed === S.seed && trCache.W === W) return trCache.p;
  const R = mulberry((S.seed ^ ((t + 1) * 40503)) | 0), L = bx(NCH) - bx(0), p = [];
  for (let j = 0; j < TR_N; j++) {
    // по всей длине пролива и очень глубоко (каждое следующее сокровище — ещё глубже)
    let x = clamp(Math.round(bx(0) + (j + .15 + R() * .7) / TR_N * L), 4, W - 5);
    let y = H - 3 - Math.floor(R() * Math.max(2, 10 - t * 3));
    if (baseAt[idx(x, y)] >= 0) x += 3;
    p.push({ x, y });
  }
  trCache = { t, seed: S.seed, W, p }; return p;
}
function trLeft() { const got = S.tr.got; return trPieces().map((q, j) => ({ ...q, j })).filter(q => got.indexOf(q.j) < 0); }
function trNearest() { let best = null, bd = 1e9; for (const q of trLeft()) { const d = Math.hypot(q.x - M.x, q.y - M.y); if (d < bd) { bd = d; best = q; } } return best ? { q: best, d: Math.round(bd) } : null; }
function trCheck() {
  if (!trOn()) return;
  const q = trLeft().find(q => q.x === M.x && q.y === M.y); if (!q) return;
  const T = TREASURES[S.tr.t]; S.tr.got.push(q.j); dirty = true; save(true);
  SFX.gem(); haptic('success'); track('tr_piece', { t: S.tr.t, n: S.tr.got.length });
  floater(M.x, M.y, `${T.piece} ${S.tr.got.length}/${TR_N}`, '#ffd84a');
  if (S.tr.got.length >= TR_N) setTimeout(trComplete, 700);
  else if (S.tr.got.length === 1) say('alya', `Первый ${T.piece}! Осталось ${TR_N - 1}. Стрелка у буровой покажет следующий.`, true);
  else if (S.tr.got.length === TR_N - 1) say('petrovich', 'Последний остался! Где-то совсем глубоко…', true);
}
function trFx(id, done) {
  const f = $('trfx'); f.querySelector('.trimg').src = 'assets/i/tr_' + id + '.webp';
  const cf = f.querySelector('.conf'); cf.innerHTML = '';
  const cols = ['#ffd84a', '#ff6b9a', '#6fd8ff', '#7dff6a', '#b06bff', '#ff9d2e'];
  for (let i = 0; i < 46; i++) { const e = document.createElement('i'); e.style.left = (Math.random() * 100) + '%'; e.style.background = cols[i % cols.length]; e.style.animationDelay = (Math.random() * .9) + 's'; e.style.animationDuration = (1.6 + Math.random() * 1.2) + 's'; e.style.transform = `rotate(${Math.random() * 360}deg)`; cf.appendChild(e); }
  for (let i = 0; i < 6; i++) { const e = document.createElement('img'); e.src = 'assets/fin/firework.webp'; e.className = 'fw'; e.style.left = (8 + Math.random() * 74) + '%'; e.style.top = (6 + Math.random() * 40) + '%'; e.style.animationDelay = (i * .32) + 's'; cf.appendChild(e); }
  f.classList.remove('hidden', 'go'); void f.offsetWidth; f.classList.add('go');
  SFX.build(); setTimeout(() => SFX.gem(), 300); setTimeout(() => SFX.gem(), 700); haptic('success');
  setTimeout(() => { f.classList.add('hidden'); f.classList.remove('go'); done(); }, 2800);
}
function trComplete() {
  const T0 = TREASURES[S.tr.t]; paused = true;
  trFx(T0.id, trCompleteModal);
}
function trCompleteModal() {
  const T = TREASURES[S.tr.t]; S.coins += T.reward; S.coll.tr = S.coll.tr || []; if (S.coll.tr.indexOf(T.id) < 0) S.coll.tr.push(T.id);
  track('tr_done', { t: S.tr.t }); S.tr = { t: S.tr.t + 1, got: [] }; trCache = null; dirty = true; save(true);
  const next = TREASURES[S.tr.t];
  modal(`<div style="text-align:center"><img src="assets/i/tr_${T.id}.webp" alt="" style="width:120px;height:120px;object-fit:contain;filter:drop-shadow(0 0 18px rgba(255,210,90,.6))"></div>
    <h2 style="text-align:center">Сокровище собрано: «${T.name}»!</h2><p style="text-align:center">${T.text}</p>
    <p style="text-align:center;font-size:20px;font-weight:900;color:#ffcf4a">+${T.reward} 🪙</p>
    <p style="text-align:center;color:#9db4c2;font-size:13px">${next ? `Следующее: «${next.name}» — его осколки спрятаны ещё глубже.` : 'Это было последнее сокровище Берингова пролива. Ты нашёл всё!'}</p>`,
    [{ t: '📣 Похвастаться', cls: 'btn good', fn: () => { paused = false; shareChat('treasure'); } }, { t: next ? 'Искать дальше' : 'Ура!', cls: 'btn' }]);
}
function drawTreasure(ts, ox, oy) {
  if (!trOn()) return;
  const T = TREASURES[S.tr.t], pulse = 1 + Math.sin(time * 4) * .08;
  for (const q of trLeft()) {
    if (!exp[idx(q.x, q.y)]) continue;
    const px = q.x * ts - ox + ts / 2, py = q.y * ts - oy + ts / 2; if (px < -ts || px > VW + ts || py < -ts || py > VH + ts) continue;
    cx.save(); cx.shadowColor = '#ffd84a'; cx.shadowBlur = 16; drawIc('tr_' + T.id + '_f', px, py, ts * .8 * pulse); cx.restore();
  }
  if (atBase >= 0 && M.st !== 'idle') return;
  const n = trNearest(); if (!n) return;
  const mx = M.rx * ts - ox + ts / 2, my = M.ry * ts - oy + ts / 2;
  const ang = Math.atan2(n.q.y - M.ry, n.q.x - M.rx), r = ts * 1.35;
  const ax = mx + Math.cos(ang) * r, ay = my + Math.sin(ang) * r;
  cx.save(); cx.translate(ax, ay); cx.rotate(ang); cx.globalAlpha = .9;
  const im = IMG['i/trarrow']; if (ok(im)) { const w = ts * .75, h = w * im.naturalHeight / im.naturalWidth; cx.drawImage(im, -w * .3, -h / 2, w, h); }
  cx.restore();
  cx.font = `900 ${Math.round(ts * .3)}px sans-serif`; cx.textAlign = 'center'; cx.fillStyle = '#ffd84a'; cx.strokeStyle = 'rgba(0,0,0,.75)'; cx.lineWidth = 3;
  const tx = mx + Math.cos(ang) * (r + ts * .55), ty = my + Math.sin(ang) * (r + ts * .55) + 4;
  cx.strokeText(n.d + ' кл', tx, ty); cx.fillText(n.d + ' кл', tx, ty);
}
function trCard() {
  if (!trOn()) return `<div class="goal" style="margin-top:12px"><div class="trh">🏆 Все сокровища Берингова пролива найдены!</div><div class="trall">${TREASURES.map(T => `<img src="assets/i/tr_${T.id}.webp" alt="">`).join('')}</div>${routeBar()}<button class="btn good wide big" id="goBtn">Копать дальше →</button></div>`;
  const T = TREASURES[S.tr.t], got = S.tr.got.length, n = trNearest();
  const slots = Array.from({ length: TR_N }, (_, j) => `<img class="${S.tr.got.indexOf(j) >= 0 ? 'on' : ''}" src="assets/i/tr_${T.id}_f.webp" alt="">`).join('');
  return `<div class="goal" style="margin-top:12px"><div class="trtop"><img src="assets/i/tr_${T.id}.webp" alt=""><div><div class="trh">Сокровище ${S.tr.t + 1}/${TREASURES.length}: «${T.name}»</div><div class="trs">Собрано осколков: <b>${got}/${TR_N}</b> · награда <b>${T.reward} 🪙</b></div></div></div>
    <div class="trslots">${slots}</div>
    <div class="gnext">Осколки спрятаны очень глубоко и по всей длине пролива.${n ? ` До ближайшего: <b>${n.d} кл.</b>` : ''}</div>
    <button class="btn good wide big" id="goBtn">Искать сокровище →</button>
    <div class="bonus">Золотая стрелка у буровой всегда показывает на ближайший осколок</div></div>`;
}
function onArriveBase(b, evac, noOpen) {
  if (S.built >= NCH && S.done && !evac) respawnOres();
  const first = S.visited.indexOf(b) < 0;
  if (first) { S.visited.push(b); if (b > 0) setTimeout(() => say('petrovich', C.JOKES.station), 600); }
  S.lastBase = b; atBase = b;
  const items = S.cargo.slice(); S.cargo = [];
  const cnt = {}; const extra = []; let gain = 0, gems = false;
  for (const it of items) {
    cnt[it.t] = (cnt[it.t] || 0) + 1;
    if (it.t <= 5) gain += C.ORES[it.t].price;
    if (it.t >= 4) gems = true;
    if (it.t === 4) { if (S.stats.diamonds % 3 === 0) catSay('diamond'); S.stats.diamonds++; questDone('diamond'); if (S.stats.diamonds >= 10) achieve('distract'); track('diamond_delivered'); }
    if (it.t === 5 && S.coll.colored.indexOf(it.id) < 0) { S.coll.colored.push(it.id); gain += 100; extra.push(['💗', C.COLORED[it.id].name]); }
    if (it.t === 6 && S.coll.art.indexOf(it.id) < 0) { S.coll.art.push(it.id); gain += 150; extra.push(['📦', C.ARTIFACTS[it.id].name]); if (it.id === 1) questDone('blueprint'); }
  }
  // добыча сама превращается в монеты
  if (gain) { S.coins += gain; S.stats.earned += gain; SFX.coin(); track('sale', { gain }); if (gems) setTimeout(() => say('alya', C.JOKES.bigSale), 900); }
  S.stats.delivered += items.length;
  // заправка и ремонт — автоматически
  let service = 0, free = false;
  if (F.simple) { S.fuel = tankMax(); S.hull = hullMax(); free = true; }
  else {
    const fNeed = (tankMax() - S.fuel) * C.FUEL_PRICE, hNeed = (hullMax() - S.hull) * C.REPAIR_PRICE;
    const pay = Math.min(S.coins, fNeed + hNeed);
    if (pay >= fNeed + hNeed) { S.fuel = tankMax(); S.hull = hullMax(); }
    else { const fp = Math.min(pay, fNeed); S.fuel += fp / C.FUEL_PRICE; S.hull += Math.max(0, pay - fp) / C.REPAIR_PRICE; if (S.fuel < tankMax() * .5 || S.hull < hullMax() * .5) { S.fuel = Math.max(S.fuel, tankMax() * .5); S.hull = Math.max(S.hull, hullMax() * .5); free = true; } }
    service = Math.ceil(pay); S.coins = Math.max(0, Math.floor(S.coins - pay));
  }
  if (!evac && run) {
    if (items.length >= cargoMax()) questDone('full');
    if (items.length && run.maxHeat < 75) questDone('cool');
    if (S.fuel < tankMax() * .05) achieve('lastdrop');
    if (!noOpen && !items.length && run.fuel0 - S.fuel > 6) setTimeout(() => say('petrovich', C.JOKES.empty), 500);
    track('sortie_end', { items: items.length });
  }
  baseSummary = (items.length || service || extra.length) ? { cnt, gain, service, free, extra } : null;
  run = null;
  if (!S.tut.returned) { S.tut.returned = true; track('tutorial_done'); setTimeout(askWrite, 6000); setTimeout(() => say('alya', 'Добыча сама превратилась в монеты 🪙. Купи улучшение — и копай дальше вправо, к Аляске!', true), 300); }
  S.heat = 0;
  dirty = true; save(true);
  if (noOpen) { if (gain) toast('🪙 +' + gain); return; }
  if (items.length || first || extra.length) setTimeout(openBase, evac ? 50 : 350);
}

// ---------- Квесты/достижения ----------
function questDone(id) {
  if (S.quests[id]) return; const q = C.QUESTS.find(q => q.id === id); if (!q) return;
  if (!activeQuests().some(a => a.id === id)) return;
  S.quests[id] = 1; S.coins += q.reward; toast('✅ Задание: ' + q.text + ' (+' + q.reward + ')'); SFX.coin(); dirty = true;
}
function activeQuests() {
  return C.QUESTS.filter(q => !S.quests[q.id] && (q.id !== 'leak' || S.built >= 3) && (q.id !== 'blueprint' || S.built >= 1)).slice(0, 2);
}
function achieve(id) {
  if (S.ach.indexOf(id) >= 0) return; S.ach.push(id); toast('🏆 ' + C.ACH[id].name); SFX.gem(); dirty = true;
}

const CAT_LINES = [
  'Мяу. (Перевод: «где моя миска?».)',
  'Мур. Проверил грунт — тёплый. Объявляю перерыв на сон.',
  'Мяу! Там алмаз. Или мышь. Копай, разберёмся.',
  'Кот-прораб одобряет этот тоннель. Подпись: лапа.',
  'Я не сплю. Я провожу инспекцию с закрытыми глазами.',
  'Если бур такой умный, пусть сам ловит мышей.',
  'Мяу. Требую отдельный тоннель до миски. Короткий.',
  'Сидеть на тёплом моторе — это тоже работа. Очень ответственная.',
  'Опять копаем? А можно хотя бы копать в сторону холодильника?',
  'Мур-р. Этот звук — не мотор. Это я доволен.',
  'Мяу! Я уронил гаечный ключ в тоннель. Специально. Проверял глубину.',
  'По моим расчётам до Аляски ещё три миски и один сон.',
  'Ваш бур рычит. Я тоже умею. Но я делаю это красиво.',
  'Пыль в усах — признак настоящего профессионала.',
  'Мяу. Нашёл камень. Лизнул. Не алмаз.',
  'Мне сказали «каска обязательна». Я в коробке — это считается.',
  'Если что — я не испугался. Я просто резко ушёл под сиденье.',
  'Я лежу на кнопке «Стоп». Совпадение? Не думаю.',
  'Мур. Предлагаю назвать тоннель «Котопровод». Голосование окончено: я за.',
  'Мяу! В Аляске, говорят, рыба размером с меня. Копай быстрее!',
];
const CAT_EVENT = {
  diamond: ['Мяу! Блестит! Я первый увидел — значит, моё.', 'Алмаз? Отлично. Обменяем на тонну корма.', 'Мур-р… Этот камушек идеально подойдёт к моим глазам.'],
  station: ['Новая станция! Срочно проверю, где тут тёплое место.', 'Мяу! Ещё одна станция — ещё одна коробка, чтобы в ней сидеть.', 'Я лично утверждаю эту станцию. Пометил… то есть подписал.'],
  flood: ['МЯУ! Я же говорил: вода — это не моё!', 'Мокрый кот — злой кот. Запомните это.', 'Я на крыше. Я всегда на крыше. Вода меня не достанет.'],
  evac: ['Ничего страшного. Я тоже иногда падаю со шкафа.', 'Мяу. Машина уснула. Я её понимаю.'],
};
function catSay(ev) { if (!catOn() || !S.set.jokes) return; const a = CAT_EVENT[ev]; if (a) setTimeout(() => say('cat', a[(Math.random() * a.length) | 0], true), 2200); }
let oreTipT = 0;
function showOreTip() { oreTipShownAt = performance.now(); S.tut.oreTip = true; dirty = true; oreTipT = 10; $('oreTip').classList.remove('off'); haptic('light'); SFX.pick(); track('tip_ore'); }
function hideOreTip() { oreTipT = 0; $('oreTip').classList.add('off'); }
$('oreTip').addEventListener('pointerdown', hideOreTip);
let oreTipShownAt = 0;
// любое касание экрана (тап, свайп в любую сторону) убирает подсказки, если их уже успели увидеть
document.addEventListener('pointerdown', e => {
  if (oreTipT > 0 && performance.now() - oreTipShownAt > 1200) hideOreTip();
}, true);
// Не пробивается — предложение улучшить бур прямо у машины
let offerT = 0;
function doUpgrade(k, free) {
  const cost = upCost(k); if (cost === null) return false;
  if (free) { if (!S.refs.tokens) return false; S.refs.tokens--; } else { if (S.coins < cost) return false; S.coins -= cost; }
  const fr = S.fuel / tankMax(), hr = S.hull / hullMax();
  S.up[k]++; if (k === 'tank') S.fuel = fr * tankMax(); if (k === 'hull') S.hull = hr * hullMax();
  SFX.build(); haptic('success'); track('upgrade', { k, lvl: S.up[k], free: free ? 1 : 0, field: 1 }); dirty = true; save(true);
  return true;
}
function showDrillOffer(need) {
  const el = $('upNow'), cost = upCost('drill');
  const mx = M.rx * TS - camX + TS / 2, my = M.ry * TS - camY;
  el.style.left = clamp(mx, 120, VW - 120) + 'px'; el.style.top = Math.max(110, my - 120) + 'px';
  let h = `${cost !== null ? `<img class="unimg" src="${upImg('drill', S.up.drill + 1)}" alt="">` : ''}<div class="ut">🪨 Слишком твёрдо!</div><div class="us">Нужен бур уровня ${need} · сейчас ${S.up.drill}</div>`;
  if (cost === null) h += `<div class="us">Обойди этот камень сверху или снизу</div>`;
  else if (S.refs.tokens) h += `<button class="btn good" data-act="free">🎟 Улучшить бур бесплатно</button>`;
  else if (S.coins >= cost) h += `<button class="btn" data-act="buy">⬆️ Улучшить бур · ${cost} 🪙</button>`;
  else {
    h += `<div class="un2">Нужно <b>${cost} 🪙</b>, у тебя ${Math.floor(S.coins)}.<br>Собирай руду 🪨🟠🟡 вверху и внизу — на базе она станет монетами. Или обойди камень.</div>`;
    if (F.shop && F.item('coins')) h += `<button class="btn good" data-act="stars" style="margin-top:6px">⭐ Премия бригаде: +400 🪙</button>`;
  }
  el.innerHTML = h; el.classList.remove('hidden'); offerT = 5;
  const b = el.querySelector('[data-act]');
  if (b && b.dataset.act === 'stars') b.onclick = e => { e.stopPropagation(); el.classList.add('hidden'); offerT = 0; track('offer_click', { id: 'coins_wall' }); buy('coins'); };
  else if (b) b.onclick = e => { e.stopPropagation(); if (doUpgrade('drill', b.dataset.act === 'free')) { toast('⛏ Бур → уровень ' + S.up.drill + '!'); el.classList.add('hidden'); offerT = 0; } };
}
['pointerdown', 'pointerup'].forEach(t => $('upNow').addEventListener(t, e => e.stopPropagation()));

// ---------- Обновление ----------
let lastT = performance.now(), sayTimer = 0;
function update(dt) {
  S.stats.playTime += dt;
  if (sayTimer > 0) { sayTimer -= dt; if (sayTimer <= 0) $('say').classList.add('off'); }
  if (sayCD > 0) sayCD -= dt;
  if (offerT > 0) { offerT -= dt; if (offerT <= 0) $('upNow').classList.add('hidden'); }
  if (scanCD > 0) scanCD -= dt;
  if (scan) { scan.t -= dt; if (scan.t <= 0) scan = null; }
  if (flash > 0) flash -= dt; if (shakeT > 0) shakeT -= dt;
  particles = particles.filter(p => (p.life -= dt) > 0); particles.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 9 * dt; });
  const hot = M.y >= C.HOT_FROM;
  const cool = upv('cooling') * (hot ? .5 : 1);
  let drilling = false;
  // обвалы
  for (let i = collapses.length - 1; i >= 0; i--) {
    const c = collapses[i]; c.t -= dt; if (c.t > 0) continue; collapses.splice(i, 1);
    const k = idx(c.x, c.y), kb = idx(c.x, c.y + 1);
    if (grid[k] !== 9 || grid[kb] !== 0 || rf[kb] || baseAt[kb] >= 0) continue;
    grid[k] = 0; dug[k] = 1; SFX.break(); shakeT = S.set.calm ? 0 : .25;
    if (M.x === c.x && M.y === c.y + 1) { S.hull -= hullMax() * .2; floater(M.x, M.y, 'Обвал! −корпус', '#ff8a5a'); haptic('error'); }
    else { grid[kb] = 8; S.fill.push(kb); }
    computeDist(); dirty = true;
  }
  if (leak) { leak.t -= dt; if (leak.t <= 0) { leak = null; S.hull -= hullMax() * .4; floater(M.x, M.y, 'Затопило!', '#5ab0ff'); if (S.hull > 0) evacuate('leak'); } }

  const dir = inputDir();
  if (M.st === 'move' || M.st === 'fall') {
    M.t += dt / M.dur;
    if (M.t >= 1) { M.st = 'idle'; arrive(); }
  }
  if (M.st === 'idle' && !paused) {
    const below = passable(M.x, M.y + 1);
    // в шахте можно «зацепиться» и уйти вбок — иначе из вертикального ответвления не выбраться
    const sideOk = (dir === 'l' || dir === 'r') && (passable(M.x + DIRS[dir][0], M.y) || hardAt(M.x + DIRS[dir][0], M.y) <= drillCap());
    if (below && dir !== 'u' && !sideOk) startMove(M.x, M.y + 1, 0.09, 'fall');
    else if (dir) {
      S.dir = dir; const [dx, dy] = DIRS[dir]; const tx = M.x + dx, ty = M.y + dy;
      const speed = upv('drive') * (leak && Math.abs(M.x - leak.x) + Math.abs(M.y - leak.y) < 6 ? .75 : 1);
      if (S.fuel <= 0) { /* стоим */ }
      else if (passable(tx, ty)) {
        const kk = idx(tx, ty), r = rf[kk] && rf[idx(M.x, M.y)];
        const lift = dy < 0 && S.shop.lift;
        const cost = dy < 0 ? (lift ? 0 : .7) : r ? .12 : .35;
        S.fuel -= cost; startMove(tx, ty, (r ? .11 : .21) / speed / (lift ? 2 : 1));
      } else {
        const h = hardAt(tx, ty);
        if (h < 99 && h <= drillCap()) {
          drilling = true; const k = idx(tx, ty);
          if (M.drillK !== k) { M.drillK = k; }
          const eff = S.heat > 75 ? .5 : 1;
          dmg[k] += drillDps() * eff * dt;
          if (F.heat && !(S.turboUntil > S.stats.playTime)) S.heat += (5 + h * 3) * (S.proto ? 2 : 1) * dt;
          S.fuel -= .8 * dt;
          M.drillT += dt; if (M.drillT > .12) { M.drillT = 0; SFX.drill(h); particles.push({ x: tx + .5 - dx * .45, y: ty + .5 - dy * .45, vx: rnd(-2, 2) - dx * 2, vy: rnd(-3, 0), life: .4, c: PAL[grid[k]] ? PAL[grid[k]][2] : '#aaa' }); }
          if (dmg[k] >= h) { breakCell(tx, ty); S.fuel -= .2; startMove(tx, ty, .16 / speed); }
        } else if (ty < SURF && inb(tx, ty) && tx < fenceX()) {
          // бурим вверх в дно пролива — если не отпустить, тоннель затопит
          drilling = true; seaT += dt; seaFrame = true;
          if (Math.random() < .5) particles.push({ x: tx + .5 + rnd(-.4, .4), y: ty + 1, vx: rnd(-1.5, 1.5), vy: rnd(.5, 2.5), life: .5, c: '#7cc8ff' });
          if (seaT > .15 && !seaWarned) { seaWarned = true; floater(tx, ty + 1, 'Стой! Сверху море — отпусти!', '#9fd8ff'); SFX.warn(); haptic('warning'); }
          if (seaT > 1.3) { seaT = 0; flood(); }
        } else if (performance.now() - lastTip > 2500) {
          lastTip = performance.now();
          if (tx >= fenceX() && ty >= SURF) floater(tx, ty, 'Дальше пока закрыто 🚧 Сначала построй этот участок', '#ffd27a');
          else if (h < 99) { showDrillOffer(h - 1); SFX.warn(); }
          else if (ty <= SURF - 1) floater(tx, ty, 'Выше — море. Копаем под дном!', '#9fd8ff');
        }
      }
    }
  }
  if (!seaFrame && seaT > 0) { seaT = Math.max(0, seaT - dt * 2); if (!seaT) seaWarned = false; }
  seaFrame = false;
  if (!drilling) { M.drillK = -1; S.heat -= cool * dt; } else S.heat -= cool * .35 * dt;
  S.heat = clamp(S.heat, 0, 100);
  if (S.heat >= 100) S.hull -= 5 * dt;
  if (run) { run.maxHeat = Math.max(run.maxHeat, S.heat); if (Math.abs(M.y - CB) > 6) { run.away += dt; S.stats.distract += dt; if (run.away > 75 && !branchJoked) { branchJoked = true; say('petrovich', C.JOKES.branches); } } }
  // обучение: не допускать аварий до объяснения возврата
  if (!S.tut.returned) {
    if (S.fuel < tankMax() * .45 && !S.tut.back) { S.tut.back = true; say('petrovich', 'Топливо на исходе! Едь влево к базе — продадим добычу и заправимся.', true); }
    S.fuel = Math.max(S.fuel, 4); S.hull = Math.max(S.hull, 6);
  }
  if (S.fuel <= 0 && M.st === 'idle' && atBase < 0 && !paused) { S.fuel = 0; evacuate('fuel'); }
  if (S.hull <= 0 && !paused) { S.hull = 0; evacuate('hull'); }
  if (atBase >= 0) S.heat = Math.max(0, S.heat - 30 * dt);
  // амбиент-реплики
  if (run && S.set.jokes) { ambientT -= dt; if (ambientT <= 0) { ambientT = rnd(80, 130); if (catOn() && Math.random() < .5) say('cat', CAT_LINES[(Math.random() * CAT_LINES.length) | 0]); else say(Math.random() < .5 ? 'petrovich' : 'alya', C.JOKES.ambient[(Math.random() * C.JOKES.ambient.length) | 0]); } }
  if (S.coins >= 1000) achieve('budget');
  // подсказка про ответвления: один раз, после первых метров тоннеля
  if (!S.tut.oreTip && run && !paused && (M.x >= bx(0) + 5 || S.stats.playTime > 25)) showOreTip();
  if (oreTipT > 0) { oreTipT -= dt; if (oreTipT <= 0) hideOreTip(); }
  // визуальная позиция
  if (M.st === 'move' || M.st === 'fall') { const t = Math.min(M.t, 1); M.rx = M.fx + (M.x - M.fx) * t; M.ry = M.fy + (M.y - M.fy) * t; }
  else { M.rx = M.x; M.ry = M.y; }
  M.shake = drilling ? 1 : 0;
}

// ---------- Отрисовка ----------
let camX = 0, camY = 0, time = 0;
function render() {
  const ts = TS;
  const tx = M.rx * ts + ts / 2 - VW / 2, ty = M.ry * ts + ts / 2 - VH * .5;
  camX += (tx - camX) * .18; camY += (ty - camY) * .18;
  camX = clamp(camX, 0, W * ts - VW); camY = clamp(camY, -ts * 1.5, H * ts - VH);
  let ox = camX, oy = camY;
  if (shakeT > 0) { ox += rnd(-4, 4); oy += rnd(-4, 4); }
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  // небо и море
  const skyH = (SURF - 1) * ts - oy;
  const sky = cx.createLinearGradient(0, -oy, 0, skyH);
  sky.addColorStop(0, '#5fa8e8'); sky.addColorStop(.35, '#a8d4f0'); sky.addColorStop(.4, '#2a7a92'); sky.addColorStop(1, '#0e4659');
  cx.fillStyle = sky; cx.fillRect(0, 0, VW, Math.max(0, skyH));
  if (skyH > 0) drawSurface(ts, ox, oy);
  // клетки
  const x0 = Math.max(0, Math.floor(ox / ts)), x1 = Math.min(W - 1, Math.ceil((ox + VW) / ts));
  const y0 = Math.max(SURF - 1, Math.floor(oy / ts)), y1 = Math.min(H - 1, Math.ceil((oy + VH) / ts));
  const fx = fenceX();
  const st = ts + .5;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const k = idx(x, y), g = grid[k], px = x * ts - ox, py = y * ts - oy, v = (x * 7 + y * 13) % 3;
    if (g === 0) {
      if (baseAt[k] >= 0) { cx.fillStyle = baseAt[k] <= S.built ? '#3b3530' : '#241e1a'; cx.fillRect(px, py, st, st); }
      else if (rf[k]) cx.drawImage(tiles.rf[0], px, py, st, st);
      else if (exp[k]) cx.drawImage(tiles.empty[v % 2], px, py, st, st);
      else cx.drawImage(tiles.unk[v], px, py, st, st);
      continue;
    }
    if (x >= fx && y >= SURF) { cx.drawImage(tiles.unk[v], px, py, st, st); continue; }
    if (!exp[k] && g !== 7 && g !== 6) { cx.drawImage(tiles.unk[v], px, py, st, st); continue; }
    cx.drawImage(tiles[g][v], px, py, st, st);
    if (y >= C.HOT_FROM && g < 6) { cx.fillStyle = 'rgba(255,70,20,.13)'; cx.fillRect(px, py, st, st); }
    if (haz[k] === 2) { cx.fillStyle = 'rgba(110,255,90,.28)'; cx.fillRect(px, py, st, st); cx.fillStyle = 'rgba(180,255,160,.7)'; for (let i = 0; i < 3; i++) { cx.beginPath(); cx.arc(px + ts * (.25 + i * .25), py + ts * (.5 + Math.sin(time * 3 + i + x) * .2), ts * .07, 0, 7); cx.fill(); } }
    if (haz[k] === 1) { cx.fillStyle = 'rgba(80,170,255,.75)'; for (let i = 0; i < 3; i++) { const yy = (time * .6 + i * .33 + x * .1) % 1; cx.beginPath(); cx.ellipse(px + ts * (.2 + i * .3), py + ts * yy, ts * .05, ts * .08, 0, 0, 7); cx.fill(); } }
    if (ore[k]) drawOre(ore[k], oreId[k], px, py, ts);
    if (dmg[k] > 0) { const h = C.BLOCKS[g].hard; const p = clamp(dmg[k] / h, 0, 1); cx.strokeStyle = 'rgba(0,0,0,.6)'; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(px + ts * .5, py + ts * .5); cx.lineTo(px + ts * (.5 - .4 * p), py + ts * (.5 - .3 * p)); cx.moveTo(px + ts * .5, py + ts * .5); cx.lineTo(px + ts * (.5 + .35 * p), py + ts * (.5 + .4 * p)); cx.moveTo(px + ts * .5, py + ts * .5); cx.lineTo(px + ts * (.5 + .4 * p), py + ts * (.5 - .35 * p)); cx.stroke(); }
  }
  // коридор
  const cLeft = 0, cRight = Math.min(fx, W) * ts - ox;
  cx.save(); cx.setLineDash([ts * .3, ts * .2]); cx.lineWidth = 2;
  cx.strokeStyle = 'rgba(255,210,80,.55)';
  cx.beginPath(); cx.moveTo(cLeft, CT * ts - oy); cx.lineTo(cRight, CT * ts - oy); cx.moveTo(cLeft, (CB + 1) * ts - oy); cx.lineTo(cRight, (CB + 1) * ts - oy); cx.stroke();
  if (S.built < NCH) { cx.fillStyle = 'rgba(255,200,60,.07)'; cx.fillRect(bx(S.built) * ts - ox, CT * ts - oy, (bx(S.built + 1) - bx(S.built)) * ts, (CB - CT + 1) * ts); }
  cx.restore();
  // декор
  for (const d of decor) if (exp[idx(d.x, d.y)]) { const px = d.x * ts - ox, py = d.y * ts - oy; drawIc(d.t === 'mammoth' ? 'mammoth' : d.t === 'oil' ? 'oil' : 'doc', px + ts / 2, py + ts / 2, ts * .9); if (d.t === 'mammoth' && !saidOnce.mam) { saidOnce.mam = 1; say('petrovich', C.CHAPTERS_DATA[1].joke); } if (d.t === 'oil' && !saidOnce.oil) { saidOnce.oil = 1; say('petrovich', C.CHAPTERS_DATA[8].joke); } if (d.t === 'doc' && !saidOnce.doc) { saidOnce.doc = 1; say('alya', C.CHAPTERS_DATA[4].joke); } }
  // станции
  for (let i = 0; i <= NCH; i++) {
    const px = (bx(i) - 1) * ts - ox, py = CT * ts - oy;
    if (px > VW + ts * 3 || px < -ts * 4) continue;
    const open = i <= S.built;
    if (ok(IMG.station)) { cx.globalAlpha = open ? 1 : .35; cx.drawImage(IMG.station, px - ts * .2, py + ts * .4, ts * 3.4, ts * 2.6); cx.globalAlpha = 1; }
    cx.fillStyle = open ? '#ffcf4a' : '#aaa'; cx.font = `bold ${Math.round(ts * .32)}px sans-serif`; cx.textAlign = 'center';
    const name = i === 0 ? 'ЧУКОТКА' : i === NCH ? 'АЛЯСКА' : 'СТАНЦИЯ ' + i;
    cx.fillText(open ? name : '🚧 ' + name, px + ts * 1.5, py + ts * .3);
  }
  // забор
  if (fx < W) { const px = fx * ts - ox; for (let y = Math.max(SURF, y0); y <= y1; y++) { const py = y * ts - oy; cx.fillStyle = (y % 2) ? '#ffcf4a' : '#222'; cx.fillRect(px, py, ts * .25, ts); } }
  // выпавшее и контейнеры
  drawTreasure(ts, ox, oy);
  for (const d of S.drops) { const px = d.x * ts - ox, py = d.y * ts - oy; if (px < -ts || px > VW || py < -ts || py > VH) continue; drawOre(d.t, d.id, px, py, ts, true); }
  for (const c of S.conts) { const px = c.x * ts - ox, py = c.y * ts - oy; drawIc('container', px + ts / 2, py + ts / 2, ts * .8); }
  for (const k of S.pins) { const x = k % W, y = (k / W) | 0, px = x * ts - ox, py = y * ts - oy; drawIc('pin', px + ts * .8, py + ts * .25, ts * .45); }
  // протечка
  if (leak) {
    const r = (1 - leak.t / leak.T) * 6 + 1;
    for (let y = leak.y - 7; y <= leak.y + 7; y++) for (let x = leak.x - 7; x <= leak.x + 7; x++) { if (!inb(x, y) || grid[idx(x, y)] !== 0) continue; if (Math.abs(x - leak.x) + Math.abs(y - leak.y) <= r) { cx.fillStyle = 'rgba(60,150,255,.38)'; cx.fillRect(x * ts - ox, y * ts - oy + ts * (.15 + Math.sin(time * 4 + x) * .05), st, ts * .85); } }
    const px = leak.px * ts - ox, py = leak.py * ts - oy, pulse = 1 + Math.sin(time * 8) * .12;
    cx.strokeStyle = '#7fd0ff'; cx.lineWidth = 3; cx.beginPath(); cx.arc(px + ts / 2, py + ts / 2, ts * .55 * pulse, 0, 7); cx.stroke();
    drawIc('pump', px + ts / 2, py + ts / 2, ts * .75);
  }
  // машина
  drawMachine(ts, ox, oy);
  if (oreTipT > 0) {
    const mx = M.rx * ts - ox + ts / 2, my = M.ry * ts - oy + ts / 2, b = Math.sin(time * 6) * ts * .12;
    cx.font = `bold ${ts * .7}px sans-serif`; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillStyle = '#ffcf4a';
    cx.shadowColor = '#000'; cx.shadowBlur = 6; cx.fillText('▲', mx, my - ts * 1.25 - b); cx.fillText('▼', mx, my + ts * 1.25 + b); cx.shadowBlur = 0;
  }
  for (const p of particles) { cx.fillStyle = p.c; cx.fillRect(p.x * ts - ox - 2, p.y * ts - oy - 2, 4, 4); }
  // свет
  drawLight(ts, ox, oy);
  // сканер
  if (scan) drawScan(ts, ox, oy);
  if (flash > 0) { cx.fillStyle = `rgba(255,200,120,${flash})`; cx.fillRect(0, 0, VW, VH); }
}

function drawSurface(ts, ox, oy) {
  const seaTop = 2 * ts - oy, seaBot = (SURF - 1) * ts - oy;
  // берега
  cx.fillStyle = '#e8f2f7';
  const shore = (xa, xb, left) => { cx.beginPath(); const a = xa * ts - ox, b = xb * ts - ox; cx.moveTo(a, seaBot); for (let i = 0; i <= 10; i++) { const x = a + (b - a) * i / 10; const hgt = ts * (1.2 + Math.sin(i * 1.3 + (left ? 0 : 2)) * .5 + (left ? (10 - i) : i) * .12); cx.lineTo(x, seaTop - hgt + ts * 1.6); } cx.lineTo(b, seaBot); cx.closePath(); cx.fill(); cx.fillStyle = '#7b6a5a'; cx.fillRect(a, seaTop + ts * 1.6, b - a, seaBot - seaTop - ts * 1.6); cx.fillStyle = '#e8f2f7'; };
  shore(0, 8, true); shore(W - 9, W, false);
  // острова Диомида
  const mid = bx(4) + segLen(4) / 2;
  [[mid - 6, mid - 2], [mid + 2, mid + 5]].forEach(([a, b], i) => { cx.fillStyle = i ? '#dfe9ee' : '#e8f2f7'; cx.beginPath(); cx.moveTo(a * ts - ox, seaTop + ts * 1.3); cx.quadraticCurveTo((a + b) / 2 * ts - ox, seaTop - ts * (i ? 1.2 : 1.8), b * ts - ox, seaTop + ts * 1.3); cx.fill(); });
  // волны
  cx.fillStyle = 'rgba(255,255,255,.18)';
  for (let x = Math.floor(ox / 40) * 40; x < ox + VW; x += 40) { const px = x - ox; cx.fillRect(px + Math.sin(time + x) * 6, seaTop + ts * .55, 18, 2); }
  // льдины
  for (let i = 0; i < 14; i++) { const wx = ((i * 173.3 + time * (6 + i % 3 * 3)) % (W * ts)); const px = wx - ox; if (px < -80 || px > VW + 80) continue; cx.fillStyle = '#f4fbff'; cx.beginPath(); cx.moveTo(px, seaTop + ts * .55); cx.lineTo(px + 34 + i % 3 * 10, seaTop + ts * .55); cx.lineTo(px + 28 + i % 3 * 10, seaTop + ts * .8); cx.lineTo(px + 6, seaTop + ts * .8); cx.fill(); if (i % 5 === 0) drawIc(i % 10 === 0 ? 'walrus' : 'bear', px + 22, seaTop + ts * .25, ts * .7); }
  // корабль
  const sx = ((time * 20) % (W * ts + 400)) - 200 - ox; drawIc('ship', sx, seaTop + ts * .15, ts * 1.1);
  // подписи
  cx.fillStyle = 'rgba(255,255,255,.85)'; cx.font = `bold ${Math.round(ts * .32)}px sans-serif`; cx.textAlign = 'center';
  cx.fillText('Берингов пролив', (bx(2)) * ts - ox, seaTop + ts * 1.7);
  if (S.built >= 6) cx.fillText('Линия перемены даты — тут «вчера»', bx(6) * ts + ts * 11 - ox, seaTop + ts * 1.7);
}

function drawOre(t, id, px, py, ts, dropped) {
  const c = cx, s = ts, cxp = px + s / 2, cyp = py + s / 2;
  const R = mulberry(Math.round(px * 3 + py * 7) & 255);
  if (dropped) { c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(cxp, cyp, s * .4, 0, 7); c.fill(); }
  if (t === 1 || t === 2 || t === 3) {
    const col = t === 1 ? ['#b9a69a', '#7d5a4a'] : t === 2 ? ['#ff9a4a', '#3fbf9a'] : ['#ffdd44', '#d99a10'];
    for (let i = 0; i < (t === 3 ? 3 : 4); i++) { const x = px + s * (.2 + R() * .6), y = py + s * (.2 + R() * .6), r = s * (.08 + R() * .07); c.fillStyle = col[1]; c.beginPath(); c.arc(x + 1, y + 1, r, 0, 7); c.fill(); c.fillStyle = col[0]; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); if (t === 3) { c.fillStyle = '#fff6b0'; c.fillRect(x - r * .4, y - r * .5, r * .4, r * .3); } }
  } else if (t === 4 || t === 5) {
    const col = t === 4 ? '#8ff0ff' : (C.COLORED[id] && C.COLORED[id].color === 'rainbow' ? `hsl(${(time * 120) % 360},90%,65%)` : (C.COLORED[id] || {}).color || '#ff5fa8');
    const r = s * (t === 5 ? .3 : .24); const tw = 1 + Math.sin(time * 5 + px) * .08;
    c.save(); c.translate(cxp, cyp); c.scale(tw, tw);
    c.shadowColor = col; c.shadowBlur = s * .4; c.fillStyle = col;
    c.beginPath(); c.moveTo(0, -r); c.lineTo(r * .85, -r * .2); c.lineTo(0, r); c.lineTo(-r * .85, -r * .2); c.closePath(); c.fill();
    c.shadowBlur = 0; c.fillStyle = 'rgba(255,255,255,.7)'; c.beginPath(); c.moveTo(0, -r); c.lineTo(r * .3, -r * .2); c.lineTo(-r * .3, -r * .2); c.fill();
    c.restore();
  } else if (t === 6) {
    c.save(); c.shadowColor = '#ffd84a'; c.shadowBlur = s * .4; c.fillStyle = '#c98a2b'; c.fillRect(px + s * .2, py + s * .3, s * .6, s * .45); c.fillStyle = '#ffd84a'; c.fillRect(px + s * .2, py + s * .3, s * .6, s * .1); c.restore();
    c.fillStyle = '#fff'; c.font = `bold ${s * .35}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('?', cxp, py + s * .58);
  }
}

function drawMachine(ts, ox, oy) {
  const px = M.rx * ts - ox + ts / 2, py = M.ry * ts - oy + ts / 2;
  const sh = M.shake ? rnd(-1.5, 1.5) : 0;
  cx.save(); cx.translate(px + sh, py + sh);
  const d = S.dir; let rot = 0, flip = 1;
  if (d === 'l') flip = -1; else if (d === 'u') rot = -Math.PI / 2; else if (d === 'd') rot = Math.PI / 2;
  cx.rotate(rot); cx.scale(flip, 1);
  const s = ts * 1.22;
  if (S.heat > 75) { cx.shadowColor = '#ff4a1a'; cx.shadowBlur = 14 + Math.sin(time * 12) * 6; }
  const lvSpr = S.up.drill > 1 && ok(IMG['drill_' + S.up.drill]) ? IMG['drill_' + S.up.drill] : IMG.drill;
  const spr = S.legend && ok(IMG.drill_legend) ? IMG.drill_legend : itemOn('skin_gold') ? (ok(IMG.drill_gold) ? IMG.drill_gold : goldSprite()) : lvSpr;
  const sw0 = spr.naturalWidth || spr.width || 256, sh0 = spr.naturalHeight || spr.height || 190, dh = s * sh0 / sw0;
  // навесное оборудование: видно, что улучшено (растёт с уровнем)
  const att = (n, x, y, w, ax, ay) => { const im = IMG['att/' + n]; if (!ok(im)) return; const h = w * im.naturalHeight / im.naturalWidth; cx.drawImage(im, x - w * ax, y - h * ay, w, h); };
  const L = k => S.up[k], g = k => .85 + (L(k) - 2) * .09;
    cx.shadowBlur = 0;
  if (L('cargo') >= 2) att('cargo', -s * .44, dh * .5, s * .5 * g('cargo'), 1, 1);
  if (L('drive') >= 2) {
    att('turbo', -s * .34, -dh * .26, s * .32 * g('drive'), .9, .5);
  }
  if (L('tank') >= 2) att('tank', -s * .4, dh * .14, s * .32 * g('tank'), .8, .5);
  if (S.heat > 75) { cx.shadowColor = '#ff4a1a'; cx.shadowBlur = 14 + Math.sin(time * 12) * 6; }
  if (ok(spr) || spr.getContext) cx.drawImage(spr, -s / 2, -dh / 2 - ts * .02, s, dh);
  else { cx.fillStyle = '#ff9d2e'; cx.fillRect(-ts * .4, -ts * .3, ts * .6, ts * .6); cx.fillStyle = '#aaa'; cx.beginPath(); cx.moveTo(ts * .2, -ts * .3); cx.lineTo(ts * .5, 0); cx.lineTo(ts * .2, ts * .3); cx.fill(); }
  cx.shadowBlur = 0;
  if (L('cooling') >= 2) att('cool', -s * .2, -dh * .3, s * .32 * g('cooling'), .5, .9);
  if (L('scanner') >= 2) { att('radar', s * .04, -dh * .34, s * .22 * g('scanner'), .5, .95); if (Math.sin(time * 5) > .6) { cx.fillStyle = '#7dff9a'; cx.beginPath(); cx.arc(s * .02, -dh * .34 - s * .17 * g('scanner'), 2.5, 0, 7); cx.fill(); } }
  if (L('hull') >= 2) att('armor', -s * .08, dh * .34, s * .56 * g('hull'), .5, .5);
  if (S.proto) { cx.fillStyle = '#ff3df0'; cx.fillRect(s * .16, -s * .03, s * .05, s * .2); }
  if (S.shop.tank_plus && ok(IMG.i_tank)) { const th = s * .34, tw2 = th * IMG.i_tank.naturalWidth / IMG.i_tank.naturalHeight; cx.drawImage(IMG.i_tank, -s * .5 - tw2 * .6, -th * .75, tw2, th); }
  if (S.shop.insurance && ok(IMG.i_ins)) cx.drawImage(IMG.i_ins, -s * .14, s * .0, s * .16, s * .16);
  if (S.shop.lift && ok(IMG.i_rocket)) {
    const climbing = M.st === 'move' && M.y < M.fy;
    if (climbing) { cx.fillStyle = `rgba(255,${150 + Math.random() * 80 | 0},40,.9)`; cx.beginPath(); cx.moveTo(-s * .58, -s * .13); cx.lineTo(-s * (.85 + Math.random() * .15), -s * .06); cx.lineTo(-s * .58, s * .01); cx.fill(); }
    const rw = s * .3, rh = rw * IMG.i_rocket.naturalHeight / IMG.i_rocket.naturalWidth; cx.drawImage(IMG.i_rocket, -s * .62, -s * .36, rw, rh);
  }
  cx.restore();
  if (catOn()) {
    cx.save(); cx.translate(px - ts * .08, py - ts * .34 + Math.sin(time * 3) * 1.2); if (d === 'l') cx.scale(-1, 1);
    if (ok(IMG.cat_sit)) { const cw = ts * .55, ch = cw * IMG.cat_sit.naturalHeight / IMG.cat_sit.naturalWidth; cx.drawImage(IMG.cat_sit, -cw / 2, -ch, cw, ch); }

    cx.restore();
  }
  if (itemOn('skin_gold') && !S.legend && Math.random() < .3) particles.push({ x: M.rx + .5 + rnd(-.4, .4), y: M.ry + .5 + rnd(-.3, .3), vx: rnd(-.5, .5), vy: rnd(-1.5, -.5), life: .5, c: '#ffe27a' });
}

function drawLight(ts, ox, oy) {
  const lw = light.width, lh = light.height, sc = .5;
  lx.globalCompositeOperation = 'source-over';
  lx.clearRect(0, 0, lw, lh);
  const groundTop = (SURF - 1) * ts - oy;
  // темнота начинается ровно с линии дна (без «ступенек», иначе полоса воды мигает при движении камеры)
  const gTop = Math.max(0, groundTop * sc);
  for (let y = Math.floor(gTop / 8) * 8; y < lh; y += 8) {
    const y0 = Math.max(y, gTop); if (y0 >= y + 8) continue;
    const wy = (y0 / sc + oy) / ts;
    const a = clamp(.55 + (wy - SURF) * .012, .55, .9);
    lx.fillStyle = `rgba(2,4,8,${a})`; lx.fillRect(0, y0, lw, y + 8 - y0);
  }
  lx.globalCompositeOperation = 'destination-out';
  const hole = (wx, wy, r, a) => { const x = (wx * ts - ox) * sc, y = (wy * ts - oy) * sc, rr = r * ts * sc; if (x < -rr || x > lw + rr || y < -rr || y > lh + rr) return; const g = lx.createRadialGradient(x, y, rr * .2, x, y, rr); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); lx.fillStyle = g; lx.beginPath(); lx.arc(x, y, rr, 0, 7); lx.fill(); };
  hole(M.rx + .5, M.ry + .5, 4.6, 1);
  const [ddx, ddy] = DIRS[S.dir]; hole(M.rx + .5 + ddx * 2, M.ry + .5 + ddy * 2, 2.6, .8);
  for (let i = 0; i <= S.built; i++) hole(bx(i) + .5, CT + 1.5, 3.4, 1);
  const x0 = Math.max(0, Math.floor(ox / ts)), x1 = Math.min(W - 1, Math.ceil((ox + VW) / ts));
  for (let x = x0 - (x0 % 3); x <= x1; x += 3) for (let y = CT; y <= CB; y++) if (rf[idx(x, y)]) hole(x + .5, y + .4, 2.2, .85);
  if (leak) hole(leak.px + .5, leak.py + .5, 1.6, .9);
  cx.drawImage(light, 0, Math.max(0, 0), VW, VH);
  if (groundTop > 0) {}
  // тёплое свечение ламп
  cx.globalCompositeOperation = 'lighter';
  for (let x = x0 - (x0 % 3); x <= x1; x += 3) for (let y = CT; y <= CB; y++) if (rf[idx(x, y)]) { const px = x * ts - ox + ts / 2, py = y * ts - oy + ts * .2; const g = cx.createRadialGradient(px, py, 0, px, py, ts * 1.2); g.addColorStop(0, 'rgba(255,170,60,.25)'); g.addColorStop(1, 'rgba(255,170,60,0)'); cx.fillStyle = g; cx.fillRect(px - ts * 1.2, py - ts * 1.2, ts * 2.4, ts * 2.4); cx.fillStyle = '#ffd27a'; cx.fillRect(px - 3, py - ts * .15, 6, 4); }
  cx.globalCompositeOperation = 'source-over';
}

function drawScan(ts, ox, oy) {
  const a = Math.min(1, scan.t);
  const r = upv('scanner'), mx = M.x + .5, my = M.y + .5;
  cx.strokeStyle = `rgba(120,255,240,${.5 * a})`; cx.lineWidth = 2;
  const prog = 1 - Math.max(0, scan.t - 4);
  cx.beginPath(); cx.arc(mx * ts - ox, my * ts - oy, r * ts * Math.min(1, prog * 1.5), 0, 7); cx.stroke();
  const lvl = S.up.scanner;
  for (const it of scan.items) {
    const px = it.x * ts - ox + ts / 2, py = it.y * ts - oy + ts / 2;
    const onScreen = px > 10 && px < VW - 10 && py > 90 && py < VH - 10;
    if (lvl >= 2 && onScreen) {
      cx.globalAlpha = a;
      const ic = it.gas ? 'gas' : lvl >= 3 ? ({ 3: 'gold', 4: 'diamond', 5: 'pinkgem', 6: 'chest' })[it.t] : (it.t >= 4 ? 'diamond' : 'gold');
      drawIc(ic, px, py + Math.sin(time * 6 + px) * 2, ts * .6); cx.globalAlpha = 1;
    } else if (!it.gas) {
      const ang = Math.atan2(py - (my * ts - oy), px - (mx * ts - ox));
      const cxp = mx * ts - ox, cyp = my * ts - oy, rr = ts * 1.4;
      cx.save(); cx.translate(cxp + Math.cos(ang) * rr, cyp + Math.sin(ang) * rr); cx.rotate(ang); cx.globalAlpha = a;
      cx.fillStyle = it.t >= 4 ? '#8ff0ff' : '#ffd84a'; cx.beginPath(); cx.moveTo(10, 0); cx.lineTo(-6, -7); cx.lineTo(-6, 7); cx.fill(); cx.restore(); cx.globalAlpha = 1;
    }
  }
}

function drawStrip() {
  const c = $('stripc'); const w = c.clientWidth, h = c.clientHeight; if (!w) return;
  if (c.width !== w * DPR) { c.width = w * DPR; c.height = h * DPR; }
  const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, w, h);
  const L = 26, Rr = w - 26, y = h / 2, sx = x => L + (x - bx(0)) / (bx(NCH) - bx(0)) * (Rr - L);
  g.font = 'bold 9px sans-serif'; g.fillStyle = '#9db4c2'; g.textAlign = 'left'; g.fillText('RU', 4, y + 3); g.textAlign = 'right'; g.fillText('US', w - 4, y + 3);
  g.lineWidth = 4; g.lineCap = 'round';
  g.strokeStyle = '#2f4a5a'; g.beginPath(); g.moveTo(L, y); g.lineTo(Rr, y); g.stroke();
  g.strokeStyle = '#4ee08a'; g.beginPath(); g.moveTo(L, y); g.lineTo(sx(bx(S.built)), y); g.stroke();
  if (S.built < NCH) { g.strokeStyle = '#ff9d2e'; g.beginPath(); g.moveTo(sx(bx(S.built)), y); g.lineTo(sx(bx(S.built + 1)), y); g.stroke(); }
  for (let i = 0; i <= NCH; i++) { g.fillStyle = i <= S.built ? '#4ee08a' : '#55707f'; g.beginPath(); g.arc(sx(bx(i)), y, 3, 0, 7); g.fill(); }
  const mx = sx(clamp(M.rx, bx(0), bx(NCH))); g.fillStyle = '#ffcf4a'; g.beginPath(); g.moveTo(mx, y - 3); g.lineTo(mx - 5, y - 11); g.lineTo(mx + 5, y - 11); g.fill();
}

// ---------- HUD ----------
function setBar(id, val, max, txt, warn, crit) {
  const el = $(id); el.querySelector('b').textContent = txt; el.querySelector('.fill').style.width = clamp(val / max * 100, 0, 100) + '%';
  el.classList.toggle('warn', !!warn && !crit); el.classList.toggle('crit', !!crit);
}
let hudT = 0, hudCoins = -1;
function hud(dt) {
  hudT -= dt; if (hudT > 0) return; hudT = .1;
  const need = fuelNeed();
  const fuelLow = atBase < 0 && S.fuel < need * 1.25 + 2;
  setBar('b-fuel', S.fuel, tankMax(), Math.max(0, Math.round(S.fuel)) + '', fuelLow, S.fuel < tankMax() * .1 && atBase < 0);
  setBar('b-heat', S.heat, 100, Math.round(S.heat) + '°', S.heat > 60, S.heat > 85);
  setBar('b-hull', S.hull, hullMax(), Math.max(0, Math.round(S.hull)) + '', S.hull < hullMax() * .4, S.hull < hullMax() * .2);
  setBar('b-cargo', S.cargo.length, cargoMax(), S.cargo.length + '/' + cargoMax(), S.cargo.length >= cargoMax() - 1, S.cargo.length >= cargoMax());
  const cvn = Math.floor(S.coins); if (cvn !== hudCoins) { hudCoins = cvn; $('coins').innerHTML = '<img class="ic" src="assets/i/coin.webp" alt=""> ' + cvn; }
  $('pct').textContent = pct() + '%';
  let w = '';
  if (leak) w = `🚰 Протечка! До помпы: ${Math.ceil(leak.t)} с`;
  else if (S.hull <= hullMax() * .2 && atBase < 0) w = '🛡 Корпус критичен — на базу!';
  else if (S.heat > 85) w = '🌡 Перегрев! Остановись — бур остынет';
  else if (fuelLow) w = `⛽ Пора на базу: нужно ≈${Math.ceil(need)} л`;
  else if (S.cargo.length >= cargoMax() && atBase < 0) w = '📦 Отсек полон — вези на базу';
  else if (S.turboUntil > S.stats.playTime) w = `⚡ Турбо-смена: ещё ${Math.ceil(S.turboUntil - S.stats.playTime)} с`;
  else if (trOn() && atBase < 0) { const n = trNearest(); w = n ? `🧭 «${TREASURES[S.tr.t].name}»: ${S.tr.got.length}/${TR_N} · до осколка ${n.d} кл.` : ''; }
  else if (S.built < NCH) w = atBase >= 0 ? '' : `🎯 До «${stationName(S.built + 1)}» — ${segGap} ${cellsWord(segGap)} →`;
  if (w !== warnState) { warnState = w; $('warnline').textContent = w; if (w.startsWith('⛽') || w.startsWith('🚰') || w.startsWith('🛡')) { SFX.warn(); haptic('warning'); } }
  $('baseBtn').classList.toggle('hidden', !(atBase >= 0 && M.st === 'idle'));

  $('b-heat').classList.toggle('hidden', !F.heat); $('b-hull').classList.toggle('hidden', !F.hull);
  $('scanBtn').parentElement.classList.toggle('hidden', !F.scan);
  ['can', 'rep', 'cool'].forEach(k => $('c-' + k).parentElement.classList.toggle('hidden', !F.cons(k)));
  ['can', 'rep', 'cool'].forEach(k => { const b = $('c-' + k); b.querySelector('small').textContent = S.cons[k]; b.classList.toggle('dim', !S.cons[k]); });
  const cd = $('scanBtn').querySelector('.cd'); cd.style.setProperty('--p', (scanCD > 0 ? scanCD / 5 * 100 : 0) + '%');
  drawStrip();
}

// ---------- UI-хелперы ----------
let toastT = null;
function toast(t) { const el = $('toast'); el.innerHTML = t; el.classList.remove('off'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('off'), 2300); }
function floater(x, y, text, color) {
  const el = document.createElement('div'); el.className = 'fl'; el.textContent = text; el.style.color = color || '#fff';
  el.style.left = (x * TS - camX + TS / 2 - 40) + 'px'; el.style.top = (y * TS - camY - 6) + 'px';
  $('floaters').appendChild(el); setTimeout(() => el.remove(), 1100);
}
function say(who, text, force) {
  if (!force && (!S.set.jokes || sayCD > 0)) return;
  sayCD = force ? sayCD : 60;
  const el = $('say'); const ch = C.CHARS[who];
  el.querySelector('img').src = ch.img; el.querySelector('small').textContent = ch.name; el.querySelector('span').textContent = text;
  const hudH = $('hud').getBoundingClientRect().bottom; el.style.top = (hudH + 6) + 'px';
  el.classList.remove('off'); sayTimer = Math.max(4, text.length / 14);
}
['pointerdown', 'touchstart'].forEach(t => $('say').addEventListener(t, () => { $('say').classList.add('off'); sayTimer = 0; }, { passive: true }));

let dlgQueue = [], dlgDone = null;
function dialog(lines, done) {
  dlgQueue = lines.slice(); dlgDone = done || null; paused = true; showDlg();
}
function showDlg() {
  const d = $('dialog');
  if (!dlgQueue.length) { d.classList.add('hidden'); paused = !!($('sheet').classList.contains('hidden') ? false : true) || !$('modal').classList.contains('hidden'); const f = dlgDone; dlgDone = null; if (f) f(); return; }
  const [who, text] = dlgQueue.shift(); const ch = C.CHARS[who];
  d.querySelector('img').src = ch.img; d.querySelector('small').textContent = ch.name; d.querySelector('span').textContent = text;
  d.classList.remove('hidden');
}
let dlgLast = 0;
$('dialog').addEventListener('pointerup', () => { const n = performance.now(); if (n - dlgLast < 250) return; dlgLast = n; audio(); showDlg(); });

function modal(html, acts) {
  const c = $('modalCard'); c.innerHTML = html + '<div class="acts"></div>';
  const a = c.querySelector('.acts');
  (acts || [{ t: 'OK', cls: 'btn' }]).forEach(o => { const b = document.createElement('button'); b.className = o.cls || 'btn'; b.textContent = o.t; b.onclick = () => { $('modal').classList.add('hidden'); if (o.fn) o.fn(); else paused = false; }; a.appendChild(b); });
  $('modal').classList.remove('hidden'); paused = true;
}

function banner(k, t) {
  const b = $('chapterBanner'); b.querySelector('.k').textContent = k; b.querySelector('.t').textContent = t;
  b.style.opacity = 1; setTimeout(() => b.style.opacity = 0, 2600);
}

// ---------- Сканер и расходники ----------
function useScan() {
  if (!S || paused || scanCD > 0 || !F.scan) return;
  audio(); scanCD = 5; const r = upv('scanner'); const items = [];
  for (let y = M.y - r; y <= M.y + r; y++) for (let x = M.x - r; x <= M.x + r; x++) {
    if (!inb(x, y) || (x - M.x) ** 2 + (y - M.y) ** 2 > r * r || x >= fenceX()) continue; const k = idx(x, y);
    if (ore[k] >= 3) items.push({ x, y, t: ore[k], v: C.ORES[ore[k]].price || 150 });
    if (haz[k] === 2) items.push({ x, y, gas: 1, v: 0 });
  }
  scan = { t: 5, items };
  tone(600, .3, 'sine', .08, 1400);
  const val = items.reduce((s, i) => s + i.v, 0);
  const lvl = S.up.scanner;
  const diam = items.filter(i => i.t === 4 || i.t === 5);
  diam.forEach(i => { const k = idx(i.x, i.y); if (S.pins.indexOf(k) < 0 && S.pins.length < 30) S.pins.push(k); });
  if (!items.length) toast('📡 Рядом пусто. Только грунт и камни.');
  else if (lvl >= 3) { const c = {}; items.forEach(i => { const n = i.gas ? 'газ' : C.ORES[i.t].name.toLowerCase(); c[n] = (c[n] || 0) + 1; }); toast('📡 ' + Object.entries(c).map(([k, v]) => k + ' ×' + v).join(', ')); }
  else toast('📡 Ценность рядом: ' + (val > 300 ? 'высокая 💎' : val > 100 ? 'средняя' : 'низкая') + (items.some(i => i.gas) ? ' · есть газ ☁️' : ''));
  if (diam.length) toast(document.getElementById('toast').innerHTML + '<br>📍 Алмазы отмечены на карте');
  if (!S.tut.scan) { S.tut.scan = true; }
}
$('scanBtn').addEventListener('click', useScan);
function useCons(k) {
  if (!S || paused || !S.cons[k]) return;
  if (k === 'can') { if (S.fuel >= tankMax() - 1) return toast('Бак и так полон'); S.fuel = Math.min(tankMax(), S.fuel + tankMax() * .5); }
  if (k === 'rep') { if (S.hull >= hullMax() - 1) return toast('Корпус цел'); S.hull = Math.min(hullMax(), S.hull + hullMax() * .5); }
  if (k === 'cool') { if (S.heat < 5) return toast('Бур холодный'); S.heat = 0; }
  S.cons[k]--; SFX.coin(); haptic('medium'); toast(C.CONSUMABLES[k].icon + ' ' + C.CONSUMABLES[k].name + ' использован'); dirty = true;
}
['can', 'rep', 'cool'].forEach(k => $('c-' + k).addEventListener('click', () => useCons(k)));

// ---------- База ----------
function openSheet(title, html) {
  // с титульного экрана панель должна быть поверх него (иначе «Коллекция» и «Настройки» открываются под заставкой)
  $('sheet').classList.toggle('ontop', !$('title').classList.contains('hidden'));
  $('sheetTitle').textContent = title; $('sheetBody').innerHTML = html; $('sheet').classList.remove('hidden'); paused = true;
}
function closeSheet() { $('sheet').classList.add('hidden'); paused = false; save(true); }
$('sheetX').addEventListener('click', closeSheet);
$('baseBtn').addEventListener('click', () => openBase());


// Путь от текущей станции к следующей: любой прокопанный ход (не обязательно по коридору)
let segGap = SEG;
function segPath() {
  const i = S.built; if (i >= NCH) return null;
  const xa = bx(i) - 1, xb = bx(i + 1) + 1;
  const prev = new Int32Array(N).fill(-2); const q = [];
  for (let y = CT; y <= CB; y++) { const k = idx(bx(i), y); prev[k] = -1; q.push(k); }
  let found = -1, maxX = bx(i);
  for (let h = 0; h < q.length; h++) {
    const k = q[h]; const x = k % W, y = (k / W) | 0; if (x > maxX) maxX = x;
    if (baseAt[k] === i + 1) { found = k; break; }
    for (const [a, b] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (a < xa || a > xb || b < SURF || b >= H) continue; const j = idx(a, b);
      if (grid[j] === 0 && prev[j] === -2) { prev[j] = k; q.push(j); }
    }
  }
  const path = []; if (found >= 0) { let k = found; while (k >= 0) { path.push(k); k = prev[k]; } }
  return { connected: found >= 0, path, gap: found >= 0 ? 0 : Math.max(1, bx(i + 1) - 1 - maxX) };
}
let buildPending = false;
function updGap() { const p = segPath(); segGap = p ? p.gap : 0; if (p && p.connected && !buildPending && S.tut.intro) { buildPending = true; setTimeout(() => { buildPending = false; buildSegment(); }, 250); } }
function cellsWord(n) { if (window.LANG === 'en') return n === 1 ? 'клетка' : 'клетки'; const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? 'клетка' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'клетки' : 'клеток'; }
function stationName(i) { return i === 0 ? 'Чукотка' : i === NCH ? 'Аляска' : 'Станция ' + i; }

function upCost(k) { const n = S.up[k]; if (n >= 5) return null; return Math.round(C.UP_COST[n] * C.UP_MULT[k]); }
const UP_ICON = { drill: '⛏', tank: '⛽', cargo: '📦', cooling: '❄️', scanner: '📡', hull: '🛡', drive: '⚡' };
const ORE_ICON = { 1: '🪨', 2: '🟠', 3: '🟡', 4: '💎', 5: '💗', 6: '📦' };

function routeBar() {
  const p = pct(), L = bx(NCH) - bx(0);
  let dots = '';
  for (let i = 0; i <= NCH; i++) dots += `<i class="${i <= S.built ? 'on' : ''}" style="left:${(bx(i) - bx(0)) / L * 100}%"></i>`;
  return `<div class="route"><div class="rt">До Аляски пройдено <b>${p}%</b></div><div class="rl"><span>🏔 Чукотка</span><span>Аляска 🏁</span></div>
    <div class="rbar"><div class="rfill" style="width:${p}%"></div>${dots}<div class="rme" style="left:${p}%">🚜</div></div></div>`;
}

let baseAll = false; const baseFolds = {};
// Рекомендованное улучшение: что мешает пройти дальше, иначе самое доступное по важности
function recUpgrade(ups) {
  const can = ups.filter(k => upCost(k) !== null); if (!can.length) return null;
  if (S.built < NCH && C.corridorHard[S.built] > drillCap() && can.includes('drill')) return 'drill';
  const pr = ['drill', 'tank', 'cooling', 'cargo', 'hull', 'drive', 'scanner'];
  const aff = pr.filter(k => can.includes(k) && (S.refs.tokens || S.coins >= upCost(k)));
  if (aff.length) return aff[0];
  return can.slice().sort((a, b) => upCost(a) - upCost(b))[0];
}
function openBase() {
  if (atBase < 0) return;
  const b = atBase;
  updGap();
  const pips = n => '<span class="pips">' + [1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('') + '</span>';
  let h = '';
  const tk = S.refs.tokens, sm = baseSummary;
  // 1) Вылазка завершена
  if (sm) {
    const loot = Object.entries(sm.cnt).map(([t, n]) => `<span class="lt">${ORE_ICON[t]}<small>×${n}</small></span>`).join('');
    const svc = !sm.free && sm.service > 0 ? `<div class="svc">Заправка и ремонт: −${sm.service} 🪙</div>` : '';
    if (loot || sm.extra.length) h += `<div class="trip"><div class="tt">Вылазка завершена</div><div class="loot">${loot}</div>
      ${sm.gain ? `<div class="gain">🪙 +${sm.gain}</div>` : ''}
      ${sm.extra.map(([i, n]) => `<div class="ex">${i} ${n} — в коллекцию!</div>`).join('')}${svc}</div>`;
    else if (svc) h += svc.replace('class="svc"', 'class="bsvc"');
  }
  // 2) Улучшения — все карточки
  const ups = Object.keys(C.UPGRADES).filter(k => F.up(k));
  h += `<div class="ups-h"><span>⚙️ Улучшения</span><b>${tk ? '🎟 ' + tk + ' · ' : ''}🪙 ${Math.floor(S.coins)}</b></div><div class="ups">` + ups.map(k => {
    const u = C.UPGRADES[k], n = S.up[k], cost = upCost(k);
    const btn = cost === null ? '<b class="ok">MAX ✔</b>' : tk ? `<button class="btn good" data-free="${k}">🎟 Бесплатно</button>` : `<button class="btn" data-up="${k}" ${S.coins < cost ? 'disabled' : ''}>${cost} 🪙</button>`;
    return `<div class="up lv${n}"><img class="uimg" src="${upImg(k, n)}" alt=""><div class="un">${u.name} <small>ур. ${n}</small></div>${pips(n)}
      <div class="uv">${cost !== null ? u.fmt(u.vals[n - 1]) + ' → <b>' + u.fmt(u.vals[n]) + '</b>' : 'максимум'}</div>${btn}<div class="uh">${u.desc}</div></div>`;
  }).join('') + `</div>`;
  if (S.built === 7) h += `<button class="btn ${S.proto ? 'sec2' : ''} wide" id="protoBtn">🚀 ${S.proto ? 'Снять прототип бура' : 'Поставить прототип бура (быстрее, но греется)'}</button>`;
  // 3) Цель и «дальше»
  if (S.built < NCH) {
    h += `<div class="goal" style="margin-top:12px">${routeBar()}
      <div class="gnext">До следующей станции: <b>${segGap} ${cellsWord(segGap)}</b> вправо</div>
      <button class="btn good wide big" id="goBtn">Продолжить тоннель →</button>
      <div class="bonus">Руда и алмазы дают монеты для улучшений</div></div>`;
  } else h += trCard();
  // 4) Расходники — открыто
  const cons = ['can', 'rep', 'cool'].filter(k => F.cons(k));
  const CONS_IC = { can: 'fuel', rep: 'repair', cool: 'coolant' };
  if (cons.length) h += `<div class="ups-h"><span>🎒 С собой в вылазку</span></div><div class="consc">` + cons.map(k => { const c = C.CONSUMABLES[k], full = S.cons[k] >= consCap();
    return `<div class="cc"><img src="${icSrc(CONS_IC[k])}" alt=""><div class="cn">${c.name}</div><div class="cd">${c.desc}</div><div class="cq">в машине: <b>${S.cons[k]}/${consCap()}</b></div>
      <button class="btn" data-cons="${k}" ${full || S.coins < c.price ? 'disabled' : ''}>${full ? 'Полно' : c.price + ' 🪙'}</button></div>`; }).join('') + `</div>`;
  if (refReady()) h += `<div style="margin-top:12px">${inviteBlock()}</div>`;
  // 5) Свернуть можно только задания и переезд
  const fold = (id, title, inner) => `<details class="fold" data-fold="${id}" ${baseFolds[id] ? 'open' : ''}><summary>${title}</summary><div class="fb">${inner}</div></details>`;
  const aq = F.quests ? activeQuests() : [];
  if (aq.length) h += fold('q', `📋 Задания <span class="fs">${aq.length}</span>`, aq.map(q => `<div class="qrow">• ${q.text} <b>+${q.reward}🪙</b></div>`).join(''));
  if (S.built >= 1) h += fold('tp', '🚃 Переезд по станциям', `<div class="cons">` + Array.from({ length: S.built + 1 }, (_, i) => `<button class="btn sec2" data-tp="${i}" ${i === b ? 'disabled' : ''}>${i === 0 ? 'Чукотка' : i === NCH ? 'Аляска' : 'Ст. ' + i}</button>`).join('') + `</div>`);
  // 6) Лавка миллиардера — раскрыта целиком
  if (F.shop) h += `<div class="ups-h"><span>⭐ Лавка миллиардера</span></div><div class="shopnote">Всю игру можно пройти без звёзд — здесь забавные штуки и немного ускорения.</div><div class="sec">${shopItemsHtml()}</div>`;
  openSheet('⚙️ Улучшения на базе «' + stationName(b) + '»', h);
  $('sheetBody').querySelectorAll('details.fold').forEach(d => d.addEventListener('toggle', () => { baseFolds[d.dataset.fold] = d.open; }));
  baseSummary = null;
  const body = $('sheetBody');
  const on = (id, fn) => { const e = body.querySelector('#' + id); if (e) e.onclick = fn; };
  on('goBtn', closeSheet);
  bindShop(() => openBase());
  on('shopBtn', () => openShop(true));
  on('protoBtn', () => { S.proto = !S.proto; if (S.proto) say('billionaire', C.CHAPTERS_DATA[7].joke, true); dirty = true; openBase(); });
  body.querySelectorAll('[data-cons]').forEach(e => e.onclick = () => { const k = e.dataset.cons, c = C.CONSUMABLES[k]; if (S.coins >= c.price && S.cons[k] < consCap()) { S.coins -= c.price; S.cons[k]++; SFX.coin(); dirty = true; openBase(); } });
  body.querySelectorAll('[data-up]').forEach(e => e.onclick = () => {
    const k = e.dataset.up, cost = upCost(k); if (cost === null || S.coins < cost) return;
    const fr = S.fuel / tankMax(), hr = S.hull / hullMax();
    S.coins -= cost; S.up[k]++;
    if (k === 'tank') S.fuel = fr * tankMax(); if (k === 'hull') S.hull = hr * hullMax();
    SFX.build(); haptic('success'); track('upgrade', { k, lvl: S.up[k] });
    toast(UP_ICON[k] + ' ' + C.UPGRADES[k].name + ' → ' + S.up[k]);
    if (!S.tut.upgr) { S.tut.upgr = true; }
    dirty = true; openBase();
  });
  body.querySelectorAll('[data-tp]').forEach(e => e.onclick = () => { teleport(+e.dataset.tp); S.lastBase = +e.dataset.tp; dirty = true; openBase(); });
  body.querySelectorAll('[data-free]').forEach(e => e.onclick = () => {
    const k = e.dataset.free; if (!S.refs.tokens || S.up[k] >= 5) return;
    const fr = S.fuel / tankMax(), hr = S.hull / hullMax();
    S.refs.tokens--; S.up[k]++; if (k === 'tank') S.fuel = fr * tankMax(); if (k === 'hull') S.hull = hr * hullMax();
    SFX.build(); haptic('success'); track('upgrade', { k, lvl: S.up[k], free: 1 }); toast('🎟 ' + C.UPGRADES[k].name + ' → ' + S.up[k] + ' в подарок от друга!');
    dirty = true; save(true); openBase();
  });
  on('inviteBtn', invite);
  checkRefs();
}

// ---------- Друзья: 1 друг = бесплатное улучшение, 3 друга = всё +1 ----------
function refReady() { return inTG && !!window.DIG_API && S.tut.returned && tg.initDataUnsafe && tg.initDataUnsafe.user; }
function inviteBlock() {
  const n = Math.min(S.refs.n, 3);
  const slots = [0, 1, 2].map(i => `<span class="fs ${i < n ? 'on' : ''}">${i < n ? '🙂' : '➕'}</span>`).join('');
  return `<div class="invite"><div class="ih">👥 Позови друзей — получи улучшения</div>
    <div class="islots">${slots}<span class="ibig ${S.refs.big ? 'on' : ''}">🎁</span></div>
    <div class="irules">1 друг = 🎟 бесплатное улучшение<br>3 друга = 🎁 всё оборудование +1 уровень</div>
    <button class="btn wide" id="inviteBtn">📨 Пригласить друга</button>
    <div style="text-align:center;margin-top:5px;font-size:11.5px;color:#9db4c2">Друг засчитается, когда откроет игру по твоей ссылке</div></div>`;
}
function invite() {
  const uid = tg.initDataUnsafe.user.id;
  const link = APP_LINK + '?startapp=r' + uid;
  const text = 'Копаю тоннель от Чукотки до Аляски ⛏ Присоединяйся — посмотрим, кто докопается первым!';
  track('invite_open');
  try { tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent(text)); }
  catch (e) { copy(text + ' ' + link); }
}
let refCheckedAt = 0;
function checkRefs(force) {
  if (!refReady() || (!force && performance.now() - refCheckedAt < 60000)) return;
  refCheckedAt = performance.now();
  fetch(window.DIG_API + '/me', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ init: tg.initData }) })
    .then(r => r.ok ? r.json() : null).then(d => {
      if (!d || typeof d.refs !== 'number' || d.refs <= S.refs.n) return;
      const add = d.refs - S.refs.n; S.refs.n = d.refs; S.refs.tokens += add;
      SFX.gem(); haptic('success'); toast('👥 Друг присоединился! 🎟 +' + add + ' бесплатное улучшение');
      if (S.refs.n >= 3 && !S.refs.big) {
        S.refs.big = true;
        Object.keys(C.UPGRADES).filter(k => F.up(k)).forEach(k => { if (S.up[k] < 5) S.up[k]++; });
        S.fuel = tankMax(); S.hull = hullMax();
        setTimeout(() => dialog([['petrovich', 'Трое друзей в бригаде! Вся техника получила +1 уровень. Вот это я понимаю — командная работа!']]), 600);
      }
      track('refs', { n: S.refs.n }); dirty = true; save(true);
      if (atBase >= 0 && !$('sheet').classList.contains('hidden') && $('sheetTitle').textContent.indexOf('⚙️ Улучшения на базе') === 0) openBase();
    }).catch(() => {});
}

// Станция открывается сама, как только до неё прокопан ход
function buildSegment() {
  const p = segPath(); if (!p || !p.connected) return;
  const reward = Math.round(C.segReq(S.built).reward * segLen(S.built) / SEG);
  S.coins += reward;
  for (const k of p.path) rf[k] = 1;
  for (let y = CT; y <= CB; y++) for (let x = bx(S.built) - 1; x <= bx(S.built) + 1; x++) rf[idx(x, y)] = 1;
  const segN = S.built; S.built++;
  segRank(segN);
  if (S.stats.segEvac === 0) questDone('noevac');
  S.stats.segEvac = 0;
  if (S.built > 7) S.proto = false;
  computeDist(); SFX.build(); haptic('success'); track('segment', { n: S.built });
  dirty = true; save(true);
  if (!$('sheet').classList.contains('hidden')) closeSheet();
  const here = baseAt[idx(M.x, M.y)];
  if (here === S.built && S.built < NCH) { atBase = -1; onArriveBase(S.built, false, true); }
  if (S.built >= NCH) { finale(); return; }
  catSay('station');
  banner('🎉 ' + stationName(S.built).toUpperCase() + ' ОТКРЫТА · +' + reward + ' 🪙', 'Тоннель: ' + pct() + '%');
  setTimeout(() => chapterIntro(), 2800);
}

// Время прохождения участка и сравнение с другими игроками — реплика персонажа
function fmtDur(t) { t = Math.max(1, Math.round(t)); const m = Math.floor(t / 60), s = t % 60; return m ? `${m} мин ${s} с` : `${s} с`; }
function segRank(n) {
  const now = S.stats.playTime, t = now - (S.segT0 || 0); S.segT0 = now; dirty = true;
  if (!(t > 5)) return;
  const who = ['petrovich', 'alya', 'bob'][n % 3];
  const local = () => say(who, `Участок ${n + 1} пройден за ${fmtDur(t)}. Неплохой темп!`, true);
  if (!inTG || !window.DIG_API || !tg.initData) { setTimeout(local, 3200); return; }
  fetch(window.DIG_API + '/seg', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ init: tg.initData, n, t: Math.round(t) }) })
    .then(r => r.ok ? r.json() : null).then(d => {
      setTimeout(() => {
        if (!d || typeof d.faster !== 'number') return local();
        let txt;
        if (d.total < 5) txt = `Участок ${n + 1} — за ${fmtDur(t)}. Ты один из первых, кто его прошёл!`;
        else if (d.faster >= 90) txt = `Участок ${n + 1} — за ${fmtDur(t)}! Это быстрее, чем у ${d.faster}% игроков. Ты в топе!`;
        else if (d.faster >= 50) txt = `Участок ${n + 1} — за ${fmtDur(t)}. Быстрее, чем у ${d.faster}% игроков. Хороший темп!`;
        else txt = `Участок ${n + 1} — за ${fmtDur(t)}. Быстрее, чем у ${d.faster}% игроков. Обычно его проходят за ${fmtDur(d.med)} — прокачай бур!`;
        say(who, txt, true);
      }, 3200);
    }).catch(() => setTimeout(local, 3200));
}

function askWrite() {
  if (!inTG || S.askedWrite || !tg.requestWriteAccess || !tg.isVersionAtLeast('6.9')) return;
  if (tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.allows_write_to_pm) return;
  S.askedWrite = true; dirty = true;
  try { tg.requestWriteAccess(ok => { track('write_access', { ok: !!ok }); if (ok) toast('🔔 Пришлём, когда появятся новые уровни и призы'); }); } catch (e) {}
}

function chapterIntro() {
  const c = S.built; if (S.chIntro >= c || c >= NCH) return;
  S.chIntro = c; dirty = true; track('chapter', { c });
  banner('ГЛАВА ' + (c + 1), C.CHAPTERS_DATA[c].title);
  const lines = C.CHAPTERS_DATA[c].intro.slice();
  if (shopReady() && c === 2) lines.push(['billionaire', 'Кстати! Открыл «Лавку миллиардера» ⭐ — кот-прораб, золотой бур и прочие радости. Можно и без них, но с котом веселее.']);
  if (shopReady() && (c === 3 || c === 4)) lines.push(['billionaire', 'В лавке новинки! Загляни на базе, если спешишь к финишу.']);
  setTimeout(() => dialog(lines, () => setTimeout(showOffer, 400)), 1500);
}

// После каждого пройденного участка — предложение прокачаться (звёзды или друг). Можно закрыть.
function showOffer() {
  if (S.built < 1 || S.built >= NCH || S.offerShown === S.built) return;
  const canInvite = refReady() && S.refs.n < 3;
  const items = shopReady() ? C.SHOP.filter(it => F.item(it.id) && !it.consumable && !S.shop[it.id]) : [];
  if (!canInvite && !items.length) return; // всё куплено и все друзья позваны — не надоедаем
  S.offerShown = S.built; dirty = true;
  const pick = items.slice(0, canInvite ? 2 : 3);
  if (pick.length < (canInvite ? 2 : 3) && shopReady()) { const t = C.SHOP.find(i => i.id === 'estimate' && F.item(i.id)) || C.SHOP.find(i => i.id === 'coins'); if (t) pick.push(t); }
  const cards = (canInvite ? `<button class="offer inv" data-o="invite"><div class="oi">👥</div><b>Позвать друга</b><span>🎟 бесплатное улучшение</span><i>Бесплатно</i></button>` : '') +
    pick.map(it => `<button class="offer" data-o="${it.id}"><img src="assets/shop_${it.id}.webp" alt=""><b>${it.name}</b><span>${it.desc.split('.')[0]}</span><i>⭐ ${it.stars}</i></button>`).join('');
  modal(`<h2 style="text-align:center">🎉 Участок пройден!</h2><p style="text-align:center;margin-top:0">Прокачаешься перед следующим?</p><div class="offers">${cards}</div>`,
    [{ t: 'Нет, копаем дальше', cls: 'btn sec2' }]);
  track('offer_show', { b: S.built });
  $('modalCard').querySelectorAll('[data-o]').forEach(el => el.onclick = () => {
    const id = el.dataset.o; $('modal').classList.add('hidden'); paused = false; track('offer_click', { id });
    if (id === 'invite') invite(); else buy(id);
  });
}

// ---------- Карта/меню ----------
$('strip').addEventListener('click', () => {
  if (!S) return;
  let h = `<div class="sec"><h3><span>Чукотка → Аляска</span><span>${pct()}%</span></h3>`;
  for (let i = 0; i < NCH; i++) {
    const st = i < S.built ? '✅' : i === S.built ? '⛏' : '🔒';
    h += `<div class="row"><span class="grow">${st} ${i + 1}. ${C.CHAPTERS_DATA[i].title}</span><span class="sub">${C.CHAPTERS_DATA[i].rec}</span></div>`;
  }
  h += `</div><p class="sub" style="color:#9db4c2;font-size:12.5px">Бесплатный переезд между готовыми станциями — в меню базы.</p>`;
  openSheet('Карта стройки', h);
});
$('menuBtn').addEventListener('click', () => {
  if (!S) return;
  openSheet('Меню', `${refReady() ? inviteBlock() : ''}<button class="btn wide" id="m-share">📣 Поделиться прогрессом</button>
    ${F.shop ? '<button class="btn sec2 wide" id="m-shop">⭐ Лавка миллиардера</button>' : ''}
    <button class="btn sec2 wide" id="m-coll">💎 Коллекция и достижения</button>
    <button class="btn sec2 wide" id="m-set">⚙️ Настройки</button>
    <button class="btn sec2 wide" id="m-sos"><img class="mi" src="assets/i/evac.webp" alt="">Застрял? Эвакуация</button>
    <button class="btn sec2 wide" id="m-title"><img class="mi" src="assets/i/home.webp" alt="">На главный экран</button>`);
  $('m-share').onclick = () => openShare();
  if ($('inviteBtn')) $('inviteBtn').onclick = invite;
  if ($('m-shop')) $('m-shop').onclick = () => openShop();
  $('m-coll').onclick = () => openCollection();
  $('m-set').onclick = () => openSettings();
  $('m-sos').onclick = () => { closeSheet(); if (atBase >= 0) return toast('Ты и так на базе'); evacuate('sos'); };
  $('m-title').onclick = () => { closeSheet(); save(true); showTitle(); };
});

function openCollection() {
  let h = `<div class="sec"><h3><span>💗 Цветные алмазы</span><span>${S.coll.colored.length}/${C.COLORED.length}</span></h3><div class="grid">` +
    C.COLORED.map((c, i) => { const has = S.coll.colored.indexOf(i) >= 0; const col = c.color === 'rainbow' ? '#fff' : c.color; return `<div class="cell ${has ? '' : 'lock'}"><div class="ic"><div class="gem" style="background:${has ? (c.color === 'rainbow' ? 'linear-gradient(45deg,#f55,#fd5,#5f8,#58f,#d5f)' : col) : '#333'};color:${col}"></div></div>${has ? c.name : 'Глава ' + (i + 1) + ', глубоко'}</div>`; }).join('') + `</div></div>`;
  h += `<div class="sec"><h3><span>📦 Артефакты</span><span>${S.coll.art.length}/${C.ARTIFACTS.length}</span></h3>` +
    C.ARTIFACTS.map((a, i) => { const has = S.coll.art.indexOf(i) >= 0; return `<div class="row"><span class="grow">${has ? '<b>' + a.name + '</b><div class="sub">' + a.text + '</div>' : '<span class="sub">??? — секретная полость</span>'}</span></div>`; }).join('') + `</div>`;
  const trs = S.coll.tr || [];
  h += `<div class="sec"><h3><span>🧭 Сокровища пролива</span><span>${trs.length}/${TREASURES.length}</span></h3>` + TREASURES.map(T => { const has = trs.indexOf(T.id) >= 0; return `<div class="row"><img src="assets/i/tr_${T.id}.webp" alt="" style="width:44px;height:44px;object-fit:contain;flex:none;${has ? '' : 'filter:grayscale(1) brightness(.4)'}"><span class="grow">${has ? '<b>' + T.name + '</b><div class="sub">' + T.text + '</div>' : '<span class="sub">??? — откроется в бесконечном режиме после финала</span>'}</span></div>`; }).join('') + `</div>`;
  h += `<div class="sec"><h3><span>🏆 Достижения</span><span>${S.ach.length}/${Object.keys(C.ACH).length}</span></h3>` +
    Object.entries(C.ACH).map(([k, a]) => `<div class="row"><span class="grow">${S.ach.indexOf(k) >= 0 ? '🏆 <b>' + a.name + '</b>' : '🔒 ' + a.name}<div class="sub">${a.desc}</div></span></div>`).join('') + `</div>`;
  openSheet('Коллекция', h);
}
function openSettings() {
  const t = (k, name) => `<label class="toggle"><span>${name}</span><input type="checkbox" data-set="${k}" ${S.set[k] ? 'checked' : ''}></label>`;
  const ti = (id, name) => S.shop[id] ? `<label class="toggle"><span>${name}</span><input type="checkbox" data-inv="${id}" ${itemOn(id) ? 'checked' : ''}></label>` : '';
  openSheet('Настройки', `<div class="sec">${t('sound', '🔊 Звук')}${t('jokes', '💬 Реплики персонажей')}${t('vibro', '📳 Вибрация')}${t('calm', '🌙 Меньше тряски и вспышек')}${ti('cat', '🐈 Кот-прораб на буровой')}${ti('skin_gold', '✨ Золотой бур')}</div>
    <div class="toggle"><span>🌐 Язык / Language</span><span class="langsw"><button class="btn ${window.LANG === 'en' ? 'sec2' : ''} sm" data-lang="ru">RU</button><button class="btn ${window.LANG === 'en' ? '' : 'sec2'} sm" data-lang="en">EN</button></span></div>
    <button class="btn sec2 wide" id="resetBtn">Начать кампанию заново</button>
    <p style="font-size:12px;color:#9db4c2">Прогресс сохраняется в облаке Telegram. Коллекция и достижения при перезапуске сохраняются.</p>`);
  $('sheetBody').querySelectorAll('[data-set]').forEach(e => e.onchange = () => { S.set[e.dataset.set] = e.checked; dirty = true; });
  $('sheetBody').querySelectorAll('[data-lang]').forEach(e => e.onclick = () => { if (e.dataset.lang === (window.LANG || 'ru')) return; try { localStorage.setItem('dig_lang', e.dataset.lang); } catch (er) {} save(true); setTimeout(() => location.reload(), 150); });
  $('sheetBody').querySelectorAll('[data-inv]').forEach(e => e.onchange = () => { S.set['off_' + e.dataset.inv] = !e.checked; dirty = true; save(true); });
  $('resetBtn').onclick = () => modal('<h2>Начать заново?</h2><p>Тоннель, деньги и улучшения обнулятся. Коллекция и достижения останутся.</p>', [
    { t: 'Отмена', cls: 'btn sec2' }, { t: 'Заново', cls: 'btn', fn: () => newCampaign() }]);
}

// ---------- Лавка за Telegram Stars ----------
function shopReady() { return !!(window.DIG_SHOP && inTG && tg.openInvoice && tg.isVersionAtLeast && tg.isVersionAtLeast('6.1')); }
// Купленное можно включать и выключать (кот, золотой бур)
const TOGGLABLE = { cat: ['Убрать кота', 'Вернуть кота'], skin_gold: ['Снять золото', 'Надеть золото'] };
const itemOn = id => !!S.shop[id] && S.set['off_' + id] !== true;
const catOn = () => itemOn('cat');
function shopItemsHtml() {
  return C.SHOP.filter(it => F.item(it.id)).map(it => {
    const owned = !it.consumable && S.shop[it.id];
    const usedEst = it.id === 'estimate' && S.turboUntil > S.stats.playTime;
    const act = owned ? (TOGGLABLE[it.id] ? `<button class="btn sec2 sm" data-tog="${it.id}">${itemOn(it.id) ? TOGGLABLE[it.id][0] : TOGGLABLE[it.id][1]}</button>` : '<b class="ok">Есть ✔</b>') : `<button class="btn" data-buy="${it.id}" ${usedEst ? 'disabled' : ''}>⭐ ${it.stars}</button>`;
    return `<div class="row"><img src="assets/shop_${it.id}.webp" alt="" style="width:52px;height:52px;object-fit:contain;flex:none;filter:drop-shadow(0 2px 4px rgba(0,0,0,.4))"><span class="grow"><b>${it.name}</b><div class="sub">${it.desc}</div></span>${act}</div>`;
  }).join('');
}
function bindShop(reopen) {
  $('sheetBody').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buy(b.dataset.buy));
  $('sheetBody').querySelectorAll('[data-tog]').forEach(b => b.onclick = () => {
    const id = b.dataset.tog; S.set['off_' + id] = itemOn(id); dirty = true; save(true);
    if (id === 'cat') toast(catOn() ? '🐈 Кот вернулся на крышу буровой' : '🐈 Кот ушёл спать на базу');
    reopen();
  });
}
function openShop(fromBase) {
  const items = shopItemsHtml();
  openSheet('⭐ Лавка миллиардера', `<div class="sec" style="background:#2a2410;border:1px solid #6b5a1f"><div style="font-size:13.5px;line-height:1.45">Всю игру можно пройти <b>без звёзд</b>. Здесь — забавные штуки и немного ускорения для тех, кто спешит к Аляске.</div></div>
    <div class="sec">${items}</div>
    ${fromBase ? '<button class="btn sec2 wide" id="shopBack">← Назад на базу</button>' : ''}
    <p style="font-size:11.5px;color:#9db4c2">Оплата через Telegram Stars. Вопросы по оплате — команда /paysupport в боте @${BOT}.</p>`);
  bindShop(() => openShop(fromBase));
  if ($('shopBack')) $('shopBack').onclick = () => openBase();
}
function grant(id) {
  const it = C.SHOP.find(x => x.id === id); if (!it) return;
  if (id === 'coins') S.coins += 400;
  else if (id === 'estimate') S.turboUntil = S.stats.playTime + 180;
  else { S.shop[id] = 1; if (id === 'tank_plus') S.fuel = tankMax(); }
  S.buys++; dirty = true; save(true);
  SFX.build(); haptic('success'); toast(it.icon + ' ' + it.name + ' — готово!');
  if (id === 'cat') setTimeout(() => say('cat', 'Мяу. Я теперь здесь главный. Петрович в курсе.', true), 600);
  if (id === 'estimate') setTimeout(() => say('petrovich', 'Турбо-смена! Три минуты бур копает вдвое быстрее и не греется.', true), 600);
}
function buy(id) {
  const link = window.DIG_SHOP && window.DIG_SHOP[id];
  if (!link || !inTG) return toast('Лавка работает внутри Telegram');
  track('buy_open', { id });
  try {
    tg.openInvoice(link, status => {
      if (status === 'paid') { grant(id); track('buy_paid', { id }); if ($('sheet').classList.contains('hidden') === false && $('sheetTitle').textContent.indexOf('Лавка') >= 0) openShop(atBase >= 0); }
      else if (status === 'failed') toast('Оплата не прошла');
    });
  } catch (e) { toast('Не удалось открыть оплату'); }
}

// ---------- Шаринг ----------
function titleFor() {
  if (S.built >= NCH) return 'Соединитель континентов';
  const distractRatio = S.stats.distract / Math.max(60, S.stats.playTime);
  if (S.stats.diamonds >= 6 && distractRatio > .35) return 'Алмазный отвлекатор';
  if (S.stats.accidents >= 5) return 'Мастер эвакуации';
  const p = pct(); return p < 10 ? 'Стажёр бура' : p < 40 ? 'Бригадир мерзлоты' : p < 70 ? 'Подводный прораб' : 'Почти американец';
}
function distractWord() { const r = S.stats.distract / Math.max(60, S.stats.playTime); return r > .45 ? 'постоянно' : r > .2 ? 'иногда' : 'почти никогда'; }
function shareText() {
  const left = 100 - pct();
  return (S.built >= NCH ? `Я докопался до Америки! 🚇 Чукотка и Аляска соединены.` : `До Аляски осталось ${left}%.`) +
    ` Алмазов найдено: ${S.stats.diamonds}. От основной задачи отвлекался: ${distractWord()}. Звание: «${titleFor()}».`;
}
function cardUrl() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'assets/promo.jpg'; }
function shareChat(via) {
  track('share_card', { via });
  const can = inTG && tg.isVersionAtLeast && tg.isVersionAtLeast('6.7');
  const uid = inTG && tg.initDataUnsafe && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.id : 0;
  const q = `r ${pct()} ${S.stats.diamonds} ${S.stats.accidents} ${Object.keys(TITLES).indexOf(titleFor())} ${['почти никогда', 'иногда', 'постоянно'].indexOf(distractWord())} ${uid}`;
  if (can) { try { tg.switchInlineQuery(q, ['users', 'groups', 'channels']); return; } catch (e) {} }
  if (navigator.share) navigator.share({ title: 'Докопаться до Америки', text: shareText(), url: APP_LINK }).catch(() => {});
  else copy(shareText() + ' ' + APP_LINK);
}
function openShare() {
  const can = inTG && tg.isVersionAtLeast && tg.isVersionAtLeast('6.7');
  const story = inTG && tg.shareToStory && tg.isVersionAtLeast('7.8');
  openSheet('Поделиться', `<div class="sharebox">${shareText()}</div>
    <button class="btn wide" id="sh-chat">💬 Отправить в чат</button>
    ${story ? '<button class="btn sec2 wide" id="sh-story">📲 В сторис</button>' : ''}
    <button class="btn sec2 wide" id="sh-copy">🔗 Скопировать ссылку</button>
    <p style="font-size:12px;color:#9db4c2">Карточку отправляешь только ты сам — игра никому не пишет за тебя.</p>`);
  $('sh-chat').onclick = () => shareChat('chat');
  if (story) $('sh-story').onclick = () => { track('share_card', { via: 'story' }); try { tg.shareToStory(cardUrl(), { text: shareText().slice(0, 190) + ' ' + APP_LINK }); } catch (e) { toast('Сторис недоступны'); } };
  $('sh-copy').onclick = () => copy(shareText() + ' ' + APP_LINK);
}
const TITLES = { 'Стажёр бура': 1, 'Бригадир мерзлоты': 1, 'Подводный прораб': 1, 'Почти американец': 1, 'Алмазный отвлекатор': 1, 'Мастер эвакуации': 1, 'Соединитель континентов': 1 };
function copy(t) { try { navigator.clipboard.writeText(t).then(() => toast('Скопировано')); } catch (e) { toast(t); } }

// ---------- Финал ----------
function finale() {
  achieve('dug'); S.done = true; S.legend = true; S.stats.finishedAt = Date.now(); S.completions++; track('finale', { t: Math.round(S.stats.playTime) });
  save(true);
  dialog([['bob', 'Слышу! Слышу ваш бур! Стоп… мы в футах, вы в метрах… совпало?!'], ['petrovich', 'Совпало. С точностью до сметы.'], ['alya', 'Стык укреплён. Запускаем движение!']], () => {
    $('hud').classList.add('hidden'); $('controls').classList.add('hidden');
    const f = $('finale'); f.classList.remove('hidden'); paused = true; finT = 0; finCars = []; finFx = [];
    const mins = Math.round(S.stats.playTime / 60);
    $('finBody').innerHTML = `<div class="fhead"><img src="assets/fin/medal.webp" alt=""><div><h2>Тоннель до Америки проложен!</h2><p>Чукотка и Аляска соединены. По тоннелю уже поехали первые машины.</p></div></div>
      <div class="frew"><img src="assets/drill_legend.webp" alt=""><div><b>Эксклюзив: легендарный бур</b><span>Платиновый бур с алмазным наконечником — только у тех, кто дошёл до конца. Копает мощнее любого другого.</span></div></div>
      <div class="frew"><img src="assets/fin/infinity.webp" alt=""><div><b>Бесконечный режим открыт</b><span>Без уровней и стен. Под проливом спрятаны три древних сокровища, разбитых на осколки, — найди их все. Руда и алмазы появляются снова.</span></div></div>
      <div class="fstats"><div><b>${mins}</b><span>минут</span></div><div><b>${S.stats.diamonds}</b><span>алмазов</span></div><div><b>${S.stats.delivered}</b><span>находок</span></div><div><b>${S.stats.accidents}</b><span>аварий</span></div></div>
      <div class="ftitle">Звание: <b>${titleFor()}</b></div>
      <button class="btn good wide big" id="fin-share">📣 Рассказать друзьям</button>
      <div class="fsub">Покажи, что ты докопался до Америки — пусть попробуют повторить</div>
      <button class="btn wide" id="fin-cont"><img class="bi" src="assets/fin/infinity.webp" alt="">Копать бесконечно</button>
      <button class="btn sec2 wide sm2" id="fin-new">Начать новую кампанию</button>`;
    $('fin-share').onclick = () => shareChat('finale');
    $('fin-cont').onclick = () => { f.classList.add('hidden'); showGame(); paused = false; setTimeout(() => dialog([['alya', 'Пока копали, сканер поймал странный сигнал. Глубоко под проливом лежат осколки древнего сокровища — «Янтарного мамонта».'], ['petrovich', 'Семь осколков, разбросаны от Чукотки до Аляски у самого дна. Золотая стрелка у буровой покажет ближайший. Найдёшь все — премия!']]), 300); };
    $('fin-new').onclick = () => newCampaign();
  });
}
let finT = 0, finCars = [], finFx = [];
const FIN_CARS = ['truck', 'bus', 'car', 'loco', 'car', 'truck'];
['i/trarrow', 'finale_bg', 'drill_legend', 'fin/truck', 'fin/bus', 'fin/car', 'fin/loco', 'fin/firework'].forEach(n => { if (!IMG[n]) { const i = new Image(); i.src = 'assets/' + n + '.webp'; IMG[n] = i; } });
function renderFinale(dt) {
  finT += dt; const c = $('finc'); const w = c.clientWidth; if (!w) return;
  const h = Math.round(Math.min(w * .78, window.innerHeight * .42)); if (c.style.height !== h + 'px') c.style.height = h + 'px';
  if (c.width !== Math.round(w * DPR) || c.height !== Math.round(h * DPR)) { c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); }
  const g = c.getContext('2d'); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const bg = IMG.finale_bg;
  const bw = Math.max(w, h * 16 / 9), bx0 = (w - bw) / 2;
  if (ok(bg)) g.drawImage(bg, bx0, 0, bw, h); else { g.fillStyle = '#16324a'; g.fillRect(0, 0, w, h); }
  // Тоннель: ряд 0.62–0.72 высоты. Сначала его «прокладывает» бур слева направо
  const tTop = h * .615, tBot = h * .715, floor = h * .703, dig = 2.6;
  const rev = Math.min(1, finT / dig), rx = w * .03 + rev * w * .94;
  if (rev < 1) {
    g.fillStyle = '#3b2a1e'; g.fillRect(rx, tTop, w - rx, tBot - tTop);
    g.fillStyle = 'rgba(0,0,0,.25)'; for (let x = rx; x < w; x += 14) g.fillRect(x, tTop + ((x * 7) % 9), 6, 3);
    const d = IMG.drill_legend, dw = h * .2;
    if (ok(d)) { const dh = dw * d.naturalHeight / d.naturalWidth; g.drawImage(d, rx - dw * .75, floor - dh + 2 + Math.sin(finT * 40) * 1, dw, dh); }
    for (let i = 0; i < 3; i++) finFx.push({ x: rx + 2, y: tTop + Math.random() * (tBot - tTop), vx: rnd(10, 80), vy: rnd(-60, 20), life: .5, c: ['#ffd27a', '#fff', '#c9a27a'][i] });
  } else {
    // машины едут по готовому тоннелю в обе стороны
    if (!finCars.length || finCars[finCars.length - 1].t > rnd(.9, 1.6)) {
      const dir = finCars.length % 3 === 2 ? -1 : 1, kind = FIN_CARS[(finCars.length * 5) % FIN_CARS.length];
      finCars.push({ kind, dir, x: dir > 0 ? -60 : w + 60, sp: rnd(70, 110) * (kind === 'loco' ? 1.3 : 1) * w / 390, t: 0 });
    }
    for (const car of finCars) {
      car.t += dt; car.x += car.dir * car.sp * dt;
      const im = IMG['fin/' + car.kind]; if (!ok(im)) continue;
      const ch = (tBot - tTop) * (car.kind === 'car' ? .62 : .82), cw = ch * im.naturalWidth / im.naturalHeight;
      g.save(); g.translate(car.x, floor - ch); if (car.dir < 0) { g.scale(-1, 1); g.translate(-cw, 0); }
      g.drawImage(im, 0, Math.sin(car.t * 18) * .6, cw, ch); g.restore();
    }
    finCars = finCars.filter(cr => cr.x > -200 && cr.x < w + 200);
    // салют
    if (Math.random() < dt * 1.6) finFx.push({ fw: 1, x: rnd(w * .15, w * .85), y: rnd(h * .05, h * .28), life: 1.1, s: rnd(.12, .2) * h });
  }
  for (const p of finFx) {
    p.life -= dt;
    if (p.fw) { const im = IMG['fin/firework']; if (!ok(im)) continue; const k = 1.1 - p.life, sz = p.s * Math.min(1, k * 3); g.globalAlpha = Math.max(0, Math.min(1, p.life * 2)); g.drawImage(im, p.x - sz / 2, p.y - sz / 2, sz, sz); g.globalAlpha = 1; }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; g.fillStyle = p.c; g.globalAlpha = Math.max(0, p.life * 2); g.fillRect(p.x, p.y, 3, 3); g.globalAlpha = 1; }
  }
  finFx = finFx.filter(p => p.life > 0);
}

// ---------- Экраны ----------
function showTitle() {
  paused = true; $('title').classList.remove('hidden'); $('hud').classList.add('hidden'); $('controls').classList.add('hidden');
  if (S) $('tprog').innerHTML = `Тоннель: <b>${pct()}%</b> · ${S.built < NCH ? 'Глава ' + (S.built + 1) + ': ' + C.CHAPTERS_DATA[S.built].title : 'Континенты соединены!'}<br>💎 ${S.stats.diamonds} · 🪙 ${Math.floor(S.coins)}`;
  $('playBtn').innerHTML = '<img class="bi" src="assets/i/dig.webp" alt="">' + (S && (S.stats.sorties > 0 || S.built > 0) ? 'Продолжить' : 'Копать');
}
function showGame() {
  $('title').classList.add('hidden'); $('hud').classList.remove('hidden'); $('controls').classList.remove('hidden');
  const top = inTG ? ((tg.contentSafeAreaInset && tg.contentSafeAreaInset.top || 0) + (tg.safeAreaInset && tg.safeAreaInset.top || 0)) : 0;
  $('hud').style.paddingTop = (8 + top) + 'px';
}
$('playBtn').addEventListener('click', () => {
  audio(); showGame(); paused = false;
  setTimeout(() => checkRefs(true), 4000);
  const showHint = () => { if (!S.tut.moved) $('tapHint').classList.remove('hidden'); };
  if (!S.tut.intro) { S.tut.intro = true; track('tutorial_start'); S.chIntro = 0; banner('ГЛАВА 1', C.CHAPTERS_DATA[0].title); setTimeout(() => dialog(C.CHAPTERS_DATA[0].intro, showHint), 1200); }
  else { showHint(); if (S.chIntro < S.built && S.built < NCH) chapterIntro(); }
});
$('collBtnT').addEventListener('click', () => { openCollection(); });
$('brand').addEventListener('click', e => { if (inTG && tg.openTelegramLink) { e.preventDefault(); try { tg.openTelegramLink('https://t.me/moscowmap'); } catch (er) { location.href = 'https://t.me/moscowmap'; } } track('brand_click'); });
$('setBtnT').addEventListener('click', () => { openSettings(); });
$('sheetX').addEventListener('click', () => { if (!$('title').classList.contains('hidden')) paused = true; });

function newCampaign() {
  // покупки из лавки, легендарный бур, друзья и коллекция переходят в новую кампанию
  const keep = S ? { coll: S.coll, ach: S.ach, set: S.set, completions: S.completions, shop: S.shop, legend: S.legend, refs: S.refs, buys: S.buys } : {};
  S = Object.assign(defaultState(), keep); S.tut.intro = false;
  setGeo(GEO_CUR); generate(S.seed); computeDist(); teleport(0); reveal(M.x, M.y, 3);
  $('finale').classList.add('hidden'); $('sheet').classList.add('hidden'); $('modal').classList.add('hidden');
  dirty = true; save(true); showTitle();
}

// ---------- Цикл ----------
function loop(now) {
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now; time += dt;
  if (S) {
    if (!$('finale').classList.contains('hidden')) renderFinale(dt);
    else {
      if (!paused) update(dt);
      render(); hud(dt);
    }
    save(false);
  }
  requestAnimationFrame(loop);
}

// Свернули приложение — тихая пауза; вернулись — игра продолжается сама (без всплывающих окон)
let autoPaused = false;
function onHide() { save(true); track('hide'); sendEvents(true); if (S && !paused) { paused = true; autoPaused = true; } joyId = null; joyDir = null; for (const k in keys) keys[k] = 0; }
function onShow() { if (autoPaused) { autoPaused = false; const uiOpen = !$('sheet').classList.contains('hidden') || !$('dialog').classList.contains('hidden') || !$('modal').classList.contains('hidden') || !$('title').classList.contains('hidden'); if (!uiOpen) paused = false; } lastT = performance.now(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); else onShow(); });
if (inTG && tg.onEvent) { try { tg.onEvent('deactivated', onHide); tg.onEvent('activated', onShow); } catch (e) {} }
window.addEventListener('pagehide', () => save(true));
window.addEventListener('resize', resize);

// ---------- Свежая версия (Telegram кэширует страницу) ----------
function checkVersion() {
  try {
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(d => {
      if (d && d.v && window.GAME_V && d.v > window.GAME_V && sessionStorage.getItem('dig_reload') !== String(d.v)) {
        sessionStorage.setItem('dig_reload', String(d.v)); save(true);
        location.replace(location.pathname + '?v=' + d.v + location.hash);
      }
    }).catch(() => {});
  } catch (e) {}
}
setTimeout(checkVersion, 800);

// ---------- Старт ----------
function boot() {
  if (inTG) {
    try {
      tg.ready(); tg.expand();
      if (tg.disableVerticalSwipes) tg.disableVerticalSwipes();
      if (tg.setHeaderColor) tg.setHeaderColor('#0b1620'); if (tg.setBackgroundColor) tg.setBackgroundColor('#0b1620');
      if (tg.enableClosingConfirmation) tg.enableClosingConfirmation();
    } catch (e) {}
  }
  resize();
  loadAll(saved => {
    if (saved && saved.v === 1) { S = Object.assign(defaultState(), saved); if (!saved.wv) delete S.wv; if (saved.segT0 === undefined) S.segT0 = S.stats.playTime; applyStateToMap(); M.x = S.x; M.y = S.y; M.rx = M.x; M.ry = M.y; const k = idx(M.x, M.y); atBase = isOpenBase(k) ? baseAt[k] : -1; if (atBase < 0) run = { fuel0: S.fuel, maxHeat: 0, away: 0 }; }
    else { S = defaultState(); setGeo(GEO_CUR); generate(S.seed); computeDist(); teleport(0); }
    reveal(M.x, M.y, 3);
    camX = M.x * TS - VW / 2; camY = M.y * TS - VH / 2;
    showTitle(); track('open', { start: inTG ? tg.initDataUnsafe.start_param || '' : '' });
    requestAnimationFrame(t => { lastT = t; loop(t); });
  });
}
boot();
window.__dig = { get S() { return S; }, M, trPieces, trCheck, banner, flood, onArriveBase, respawnOres, bx, get W() { return W; }, segPath, teleport, buildSegment, fenceX, openBase, showDrillOffer,
  digRow: (x0, x1, y) => { for (let x = x0; x <= x1; x++) { const k = idx(x, y); if (grid[k] < 6) { grid[k] = 0; dug[k] = 1; exp[k] = 1; } } computeDist(); }, bx, finale };
})();
