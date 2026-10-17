/*
 *  WRAP // a paragraph set in JS around the real outline of a drawing.
 *
 *  Inspired by Cheng Lou's pretext (vendor/pretext, MIT). The browser can only
 *  wrap text around a static float; here the shape moves every frame, so each
 *  line is measured by pretext (pure arithmetic over cached glyph widths) and
 *  placed by hand. The slots on each row come from the sticker's alpha mask,
 *  not a circle or a box, so the words follow the drawing's silhouette.
 *
 *  Grab the drawing and throw it: the text re-flows under your hand, and a
 *  spring carries it back to its slow drift.
 *
 *  The real <p> stays in the DOM (selection, screen readers, ctrl+F, no-JS).
 *  If anything here bails, the page is just a page.
 */

const LIB = './vendor/pretext/layout.js';
const PAD = 14;          // air between the drawing and the words
const MIN_RUN = 150;     // narrowest slot worth setting a line in
const MAX_ROWS = 300;    // runaway guard
const MASK_ROWS = 96;    // vertical resolution of the silhouette
const ALPHA = 28;        // alpha (0-255) above which a pixel counts as drawing

const root = document.querySelector('[data-wrap]');
const src = root && root.querySelector('.wrap-src');
const fig = root && root.querySelector('.wrap-fig img');
const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function typeOf(el) {
  const s = getComputedStyle(el);
  const size = parseFloat(s.fontSize) || 24;
  const lh = parseFloat(s.lineHeight) || size * 1.4;
  return {
    spec: `${s.fontStyle} ${s.fontWeight} ${size}px ${s.fontFamily}`,
    lh: Math.round(lh),
    color: s.color
  };
}

// The drawing, converted once to greyscale (Safari has no ctx.filter) with a
// per-row silhouette: where the opaque pixels start and end on each row.
function readSprite(img) {
  const w = 220;
  const h = Math.round((w * img.naturalHeight) / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const full = x.getImageData(0, 0, c.width, c.height);
  const d = full.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    const k = clamp((g - 128) * 1.1 + 128, 0, 255);   // a touch of contrast
    d[i] = d[i + 1] = d[i + 2] = k;
  }
  x.putImageData(full, 0, 0);

  const left = new Float32Array(MASK_ROWS);
  const right = new Float32Array(MASK_ROWS);
  for (let r = 0; r < MASK_ROWS; r++) {
    const y0 = Math.floor((r / MASK_ROWS) * c.height);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) / MASK_ROWS) * c.height));
    let lo = c.width;
    let hi = -1;
    for (let y = y0; y < y1; y++) {
      for (let px = 0; px < c.width; px++) {
        if (d[(y * c.width + px) * 4 + 3] > ALPHA) {
          if (px < lo) lo = px;
          break;
        }
      }
      for (let px = c.width - 1; px >= 0; px--) {
        if (d[(y * c.width + px) * 4 + 3] > ALPHA) {
          if (px > hi) hi = px;
          break;
        }
      }
    }
    left[r] = hi < 0 ? -1 : lo / c.width;
    right[r] = hi < 0 ? -1 : (hi + 1) / c.width;
  }
  return { canvas: c, left, right, aspect: c.height / c.width, w, h };
}

// Horizontal extent of the drawing across the band [y0, y1), in canvas px.
function extent(S, sp, y0, y1) {
  if (y1 <= sp.y || y0 >= sp.y + sp.h) return null;
  const a = Math.max(0, Math.floor(((y0 - sp.y) / sp.h) * MASK_ROWS));
  const b = Math.min(MASK_ROWS - 1, Math.floor(((y1 - sp.y) / sp.h) * MASK_ROWS));
  let lo = 1;
  let hi = -1;
  for (let r = a; r <= b; r++) {
    if (S.left[r] < 0) continue;
    if (S.left[r] < lo) lo = S.left[r];
    if (S.right[r] > hi) hi = S.right[r];
  }
  if (hi < 0) return null;
  return [sp.x + lo * sp.w, sp.x + hi * sp.w];
}

// Walks the paragraph row by row. Each row has up to two slots, left and right
// of the drawing, filled in reading order. `onLine` omitted = height only.
function flow(api, P, S, sp, colW, lh, onLine) {
  let cursor = { segmentIndex: 0, graphemeIndex: 0 };
  let y = 0;
  for (let i = 0; i < MAX_ROWS; i++) {
    const e = extent(S, sp, y, y + lh);
    const slots = e
      ? [[0, e[0] - PAD], [e[1] + PAD, colW]]
      : [[0, colW]];
    for (const [a, b] of slots) {
      if (b - a < MIN_RUN) continue;
      const range = api.layoutNextLineRange(P, cursor, b - a);
      if (range === null) return y;
      if (onLine) onLine(api.materializeLineRange(P, range), a, y);
      cursor = range.end;
    }
    y += lh;
  }
  return y;
}

async function boot() {
  if (!root || !src || !fig) return;
  const c = navigator.connection;
  if (c && (c.saveData || /^(slow-)?2g$/.test(c.effectiveType || ''))) return;

  let api;
  try {
    api = await import(LIB);
    if (!fig.complete) await new Promise((ok, no) => { fig.onload = ok; fig.onerror = no; });
  } catch (e) { return; }

  const text = src.textContent.replace(/\s+/g, ' ').trim();
  const canvas = document.createElement('canvas');
  canvas.className = 'wrap-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let S;
  try { S = readSprite(fig); } catch (e) { return; }   // tainted or unreadable

  let type = null;
  let P = null;
  let colW = 0;
  let H = 0;
  let bounds = null;
  const sp = { x: 0, y: 0, w: 0, h: 0 };

  async function measure() {
    const next = typeOf(src);
    colW = Math.round(root.clientWidth);
    if (colW < 260) return false;

    if (!P || !type || next.spec !== type.spec) {
      type = next;
      try {
        await document.fonts.load(type.spec, text.slice(0, 64));
        await document.fonts.ready;
      } catch (e) { /* use what is loaded */ }
      P = api.prepareWithSegments(text, type.spec);
    } else type = next;

    sp.w = Math.round(Math.min(colW * (colW < 600 ? 0.46 : 0.4), 380));
    sp.h = Math.round(sp.w * S.aspect);

    const natural = api.layout(P, colW, type.lh).height;
    const H0 = Math.max(natural + type.lh * 2, sp.h * 1.25);
    bounds = { x0: 0, x1: colW - sp.w, y0: 0, y1: H0 - sp.h };

    // Height is fixed once, from the worst case over every spot the drawing
    // can reach, so the page never jumps while it moves. Pure arithmetic.
    let worst = H0;
    for (let gx = 0; gx < 7; gx++) {
      for (let gy = 0; gy < 5; gy++) {
        sp.x = bounds.x0 + ((bounds.x1 - bounds.x0) * gx) / 6;
        sp.y = bounds.y0 + ((bounds.y1 - bounds.y0) * gy) / 4;
        worst = Math.max(worst, flow(api, P, S, sp, colW, type.lh, null) + type.lh);
      }
    }
    H = Math.ceil(worst);

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(colW * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  // Offset from the drift path: the pointer sets it while held, a spring
  // returns it to zero after release.
  const off = { x: 0, y: 0, vx: 0, vy: 0 };
  let held = false;
  // Phone orientation: tilting slides the drawing like something on a tray,
  // and the words re-flow around it as it goes.
  let tilt = { x: 0, y: 0, active: false };
  import('./tilt.js?v=2').then((m) => {
    tilt = m.default;
    // On a phone the footnote says how to play.
    const note = root.querySelector('.wrap-note');
    const say = () => { if (note) note.textContent = "Set line by line in JavaScript around the drawing's outline. Tilt your phone, or pick it up."; };
    tilt.active ? say() : tilt.listeners.add(say);
  }).catch(() => {});
  let lastT = 0;

  let tu = 0.5;   // eased tilt target, 0..1 across the bounds
  let tv = 0.5;
  function drift(t) {
    let u = 0.5 + 0.5 * Math.sin(t * 0.00022);
    let v = 0.5 + 0.5 * Math.sin(t * 0.00031 + 1.3);
    if (tilt.active) {
      tu += ((0.5 + tilt.x * 0.5) - tu) * 0.08;
      tv += ((0.5 + tilt.y * 0.5) - tv) * 0.08;
      u = tu;
      v = tv;
    }
    return {
      x: bounds.x0 + (bounds.x1 - bounds.x0) * u,
      y: bounds.y0 + (bounds.y1 - bounds.y0) * v
    };
  }

  function place(t) {
    const d = calm.matches ? { x: bounds.x1 * 0.78, y: bounds.y1 * 0.4 } : drift(t);
    sp.x = clamp(d.x + off.x, bounds.x0, bounds.x1);
    sp.y = clamp(d.y + off.y, bounds.y0, bounds.y1);
  }

  function draw(t) {
    place(t);
    ctx.clearRect(0, 0, colW, H);

    // The drawing leans into its own motion, like something carried.
    const lean = clamp((off.vx || 0) * 0.00035, -0.22, 0.22);
    ctx.save();
    ctx.translate(sp.x + sp.w / 2, sp.y + sp.h / 2);
    ctx.rotate(lean);
    ctx.drawImage(S.canvas, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();

    ctx.font = type.spec;
    ctx.fillStyle = type.color;
    ctx.textBaseline = 'middle';
    const half = type.lh / 2;
    flow(api, P, S, sp, colW, type.lh, (line, x, y) => ctx.fillText(line.text, x, y + half));
  }

  if (!(await measure())) return;
  src.insertAdjacentElement('afterend', canvas);
  root.classList.add('is-flowing');
  draw(0);

  /* ------------------------------------------------------- grab and throw */

  let last = null;
  let gx = 0;
  let gy = 0;
  let running = false;

  const local = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Hit-test against the silhouette, not the bounding box.
  function hit(e) {
    const p = local(e);
    const e2 = extent(S, sp, p.y, p.y + 1);
    return !!e2 && p.x >= e2[0] - 6 && p.x <= e2[1] + 6;
  }

  // Say up front that a touch on the drawing is not a scroll; touches on the
  // words still scroll the page.
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches[0] && hit(e.touches[0])) e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !hit(e)) return;
    const p = local(e);
    gx = sp.x - p.x;
    gy = sp.y - p.y;
    held = true;
    off.vx = off.vy = 0;
    last = { x: p.x, y: p.y, t: e.timeStamp };
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('is-held');
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!held) { canvas.classList.toggle('can-grab', hit(e)); return; }
    const p = local(e);
    const d = calm.matches ? { x: bounds.x1 * 0.78, y: bounds.y1 * 0.4 } : drift(lastT);
    off.x = p.x + gx - d.x;
    off.y = p.y + gy - d.y;
    const dt = Math.max(1, e.timeStamp - last.t);
    off.vx = off.vx * 0.6 + ((p.x - last.x) / dt) * 1000 * 0.4;
    off.vy = off.vy * 0.6 + ((p.y - last.y) / dt) * 1000 * 0.4;
    last = { x: p.x, y: p.y, t: e.timeStamp };
    if (!running) draw(lastT);
  });

  function release(e) {
    if (!held) return;
    held = false;
    canvas.classList.remove('is-held');
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) { /* gone */ }
    if (e.timeStamp - last.t > 90) off.vx = off.vy = 0;   // a pause is not a throw
    if (!running) start();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', () => canvas.classList.remove('can-grab'));

  // Underdamped: overshoots once or twice, so it feels thrown, not tweened.
  function spring(dt) {
    if (held) return;
    const K = 34, C = 6.5;
    off.vx += (-K * off.x - C * off.vx) * dt;
    off.vy += (-K * off.y - C * off.vy) * dt;
    off.x += off.vx * dt;
    off.y += off.vy * dt;
    if (Math.abs(off.x) + Math.abs(off.y) + Math.abs(off.vx) + Math.abs(off.vy) < 0.05) {
      off.x = off.y = off.vx = off.vy = 0;
    }
  }

  /* ------------------------------------------------------------ frame loop */

  let raf = 0;
  let onScreen = true;

  function tick(now) {
    if (!running) return;
    spring(Math.min(0.05, (now - lastT) / 1000 || 0.016));
    lastT = now;
    draw(now);
    const settled = !off.x && !off.y && !off.vx && !off.vy;
    // Under reduced motion there is no drift: stop the loop once it settles.
    if (calm.matches && settled && !held) { running = false; return; }
    raf = requestAnimationFrame(tick);
  }
  function start() {
    if (running || document.hidden) return;
    running = true;
    lastT = performance.now();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((en) => {
      onScreen = en[0].isIntersecting;
      onScreen && !calm.matches ? start() : stop();
    }, { rootMargin: '120px' }).observe(root);
  } else if (!calm.matches) start();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (onScreen && !calm.matches) start();
  });

  calm.addEventListener && calm.addEventListener('change', (e) => {
    if (e.matches) { stop(); draw(performance.now()); }
    else if (onScreen) start();
  });

  let timer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const w = Math.round(root.clientWidth);
      if (Math.abs(w - colW) < 8) return;
      if (!(await measure())) { stop(); root.classList.remove('is-flowing'); return; }
      root.classList.add('is-flowing');
      draw(performance.now());
    }, 180);
  }, { passive: true });
}

// Nothing is fetched or measured until the section is near the viewport.
if (root) {
  const go = () => {
    if (!('IntersectionObserver' in window)) return boot();
    const io = new IntersectionObserver((en) => {
      if (!en[0].isIntersecting) return;
      io.disconnect();
      boot();
    }, { rootMargin: '500px' });
    io.observe(root);
  };
  document.readyState === 'complete' ? go() : window.addEventListener('load', go, { once: true });
}
