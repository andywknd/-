/* Живая заставка: оживляем картинку title_bg (720×1280) слоями поверх неё.
   Медленный «вдох» камеры, блики на воде, покачивание льдин и моржа, снег, мерцание ламп,
   вибрация буровой с пылью, искры золота и сияние алмазов. Бесшовный цикл, работает только пока виден титул. */
(function () {
  const title = document.getElementById('title');
  if (!title) return;
  const cv = document.createElement('canvas');
  cv.id = 'tbg';
  title.insertBefore(cv, title.firstChild);
  const g = cv.getContext('2d');
  const img = new Image();
  img.src = 'assets/title_bg.webp';
  const IW = 720, IH = 1280, LOOP = 24; // сек
  const calm = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

  // Области картинки (в пикселях исходника)
  const FLOES = [[108, 372, 152, 34], [292, 366, 62, 20], [415, 380, 145, 32], [246, 356, 44, 13], [565, 364, 40, 14], [0, 362, 84, 34], [431, 355, 38, 12]];
  const WALRUS = [165, 336, 66, 52];
  const SHIP = [484, 322, 58, 28];
  const DRILL = [390, 762, 128, 62];
  const LAMPS = [[82, 776], [197, 776], [315, 776]];
  const GOLD = [[120, 632], [160, 654], [52, 650], [200, 668], [555, 665], [520, 682], [370, 686], [612, 640], [147, 983], [188, 975], [50, 945], [660, 1063], [690, 1078], [96, 600], [300, 660]];
  const DIAM = [[604, 958, 46], [88, 1072, 46], [452, 968, 14], [500, 958, 12], [530, 1000, 12], [412, 1130, 12], [150, 1072, 12], [640, 1010, 12]];
  const SNOW = Array.from({ length: 46 }, (_, i) => ({ x: (i * 157.3) % IW, y: (i * 97.1) % 470, r: 1 + (i % 3) * .7, sp: 14 + (i % 5) * 5, ph: i * 1.7 }));
  const DUST = [];
  let W = 0, H = 0, DPR = 1, raf = 0, t0 = 0, last = 0;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = title.clientWidth; H = title.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!img.complete || !img.naturalWidth) return;
    if (!t0) t0 = now;
    const t = (now - t0) / 1000, dt = Math.min(.05, (now - (last || now)) / 1000); last = now;
    if (cv.width !== Math.round(title.clientWidth * DPR) || cv.height !== Math.round(title.clientHeight * DPR)) resize();
    const still = calm();
    // cover + медленный «вдох» камеры (бесшовно: синус с периодом LOOP)
    const k = Math.max(W / IW, H / IH);
    const z = still ? 1 : 1.035 + .035 * Math.sin(t / LOOP * Math.PI * 2);
    const s = k * z, ox = (W - IW * s) / 2, oy = (H - IH * s) / 2 + (still ? 0 : Math.sin(t / LOOP * Math.PI * 2 + 1) * 6);
    const X = x => ox + x * s, Y = y => oy + y * s;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.drawImage(img, ox, oy, IW * s, IH * s);
    const piece = (r, dx, dy, sc) => { // перерисовать кусок картинки со сдвигом/масштабом
      const [x, y, w, h] = r, sx = sc || 1;
      g.drawImage(img, x, y, w, h, X(x + w / 2) - w * s * sx / 2 + dx * s, Y(y + h / 2) - h * s * sx / 2 + dy * s, w * s * sx, h * s * sx);
    };
    if (!still) {
      // льдины, морж и корабль покачиваются на волнах
      FLOES.forEach((f, i) => piece(f, 0, Math.sin(t * 1.3 + i * 1.7) * 1.6));
      piece(WALRUS, 0, Math.sin(t * 1.3 + 1.7) * 1.6 - Math.max(0, Math.sin(t * .9)) * 1.2, 1 + Math.max(0, Math.sin(t * .9)) * .025);
      piece(SHIP, Math.sin(t * .35) * 1.5, Math.sin(t * 1.1) * 1.1);
      // буровая вибрирует
      piece(DRILL, (Math.random() - .5) * 1.4, (Math.random() - .5) * 1.2);
    }
    g.globalCompositeOperation = 'lighter';
    // блики на воде и солнечная дорожка
    for (let i = 0; i < 26; i++) {
      const y = 352 + (i * 37 % 110), sp = 8 + (i % 4) * 4;
      const x = ((i * 131 + t * sp * (i % 2 ? 1 : -1)) % IW + IW) % IW;
      const a = .18 + .18 * Math.sin(t * 2.1 + i);
      g.fillStyle = `rgba(255,255,255,${Math.max(0, a)})`;
      g.fillRect(X(x), Y(y), (14 + i % 3 * 8) * s, 1.6 * s);
    }
    for (let i = 0; i < 9; i++) {
      const y = 350 + i * 11, w = 10 + i * 4 + Math.sin(t * 3 + i) * 5;
      g.fillStyle = `rgba(255,200,120,${.22 + .14 * Math.sin(t * 2.6 + i * 1.3)})`;
      g.fillRect(X(360 - w / 2), Y(y), w * s, 2 * s);
    }
    // лампы в тоннеле мерцают тёплым светом
    LAMPS.forEach(([x, y], i) => {
      const a = .32 + .1 * Math.sin(t * 7 + i * 2) + .06 * Math.sin(t * 23 + i);
      const r = 46 * s, gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r);
      gr.addColorStop(0, `rgba(255,190,90,${a})`); gr.addColorStop(1, 'rgba(255,190,90,0)');
      g.fillStyle = gr; g.fillRect(X(x) - r, Y(y) - r, r * 2, r * 2);
    });
    // фара буровой и пыль от бура
    {
      const x = 515, y = 790, r = 70 * s, a = .3 + .08 * Math.sin(t * 11);
      const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r);
      gr.addColorStop(0, `rgba(255,220,150,${a})`); gr.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = gr; g.fillRect(X(x) - r, Y(y) - r, r * 2, r * 2);
      if (!still && Math.random() < .7) DUST.push({ x: 512, y: 780 + Math.random() * 24, vx: 10 + Math.random() * 40, vy: -20 + Math.random() * 30, l: .8 });
    }
    g.globalCompositeOperation = 'source-over';
    for (let i = DUST.length - 1; i >= 0; i--) {
      const p = DUST[i]; p.l -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt;
      if (p.l <= 0) { DUST.splice(i, 1); continue; }
      g.fillStyle = `rgba(200,160,110,${p.l * .8})`; g.fillRect(X(p.x), Y(p.y), 2.4 * s, 2.4 * s);
    }
    g.globalCompositeOperation = 'lighter';
    // золото искрится
    GOLD.forEach(([x, y], i) => {
      const v = Math.sin(t * 1.6 + i * 2.3); if (v < .55) return;
      const a = (v - .55) / .45, r = (5 + 7 * a) * s;
      g.strokeStyle = `rgba(255,240,170,${a})`; g.lineWidth = 1.4 * s;
      g.beginPath(); g.moveTo(X(x) - r, Y(y)); g.lineTo(X(x) + r, Y(y)); g.moveTo(X(x), Y(y) - r); g.lineTo(X(x), Y(y) + r); g.stroke();
    });
    // алмазы сияют
    DIAM.forEach(([x, y, rr], i) => {
      const a = .25 + .25 * Math.sin(t * 1.4 + i * 1.9), r = rr * 1.4 * s;
      const gr = g.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), r);
      gr.addColorStop(0, `rgba(140,220,255,${a})`); gr.addColorStop(1, 'rgba(140,220,255,0)');
      g.fillStyle = gr; g.fillRect(X(x) - r, Y(y) - r, r * 2, r * 2);
      if (rr > 20) { const v = Math.sin(t * 1.1 + i * 3); if (v > .7) { const b = (v - .7) / .3, q = 16 * b * s; g.strokeStyle = `rgba(255,255,255,${b})`; g.lineWidth = 1.6 * s; g.beginPath(); g.moveTo(X(x + 10) - q, Y(y - 12)); g.lineTo(X(x + 10) + q, Y(y - 12)); g.moveTo(X(x + 10), Y(y - 12) - q); g.lineTo(X(x + 10), Y(y - 12) + q); g.stroke(); } }
    });
    g.globalCompositeOperation = 'source-over';
    // лёгкий снег над морем
    if (!still) SNOW.forEach(f => {
      const y = (f.y + t * f.sp) % 470, x = f.x + Math.sin(t * .8 + f.ph) * 8;
      g.fillStyle = `rgba(255,255,255,${.55 - y / 470 * .3})`;
      g.beginPath(); g.arc(X(x), Y(y), f.r * s, 0, 7); g.fill();
    });
  }
  function run() { if (!raf && !title.classList.contains('hidden')) { last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  new MutationObserver(() => title.classList.contains('hidden') || document.hidden ? stop() : run()).observe(title, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : run());
  window.addEventListener('resize', resize);
  resize(); img.onload = run; run();
})();
