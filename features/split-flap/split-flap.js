/*
 *  SPLIT-FLAP // a Solari departure-board display for headlines, counters,
 *  clocks and rotating words.
 *
 *  Markup:  <span data-split-flap>ROMA</span>
 *           <span data-split-flap data-words="WANDER, ARRIVE, LINGER"></span>
 *           <span data-split-flap data-clock="HH:MM:SS"></span>
 *           <span data-split-flap data-counter="1284" data-length="6"></span>
 *  Or call  splitFlap(el, options)  yourself. Returns destroy(), which also
 *  carries destroy.setText(text), destroy.setValue(n), destroy.sound(on),
 *  destroy.pause(), destroy.play() and destroy.text.
 *
 *  Every character is a real mechanism, built from DOM and CSS 3D transforms
 *  (no canvas). A cell is two static halves (the next character's top, the
 *  current character's bottom) and, while it moves, one to four falling
 *  leaves. A leaf is the upper half-flap: its front carries the top of the
 *  character it is leaving, its back the bottom of the next one. It falls
 *  about the hinge on the centre line under gravity (the angle comes from
 *  integrating an inverted pendulum, so it leaves slowly and arrives fast),
 *  lands on the stack with one small ballistic rebound, and is then removed,
 *  leaving the new character in the plain 2D halves, crisp.
 *
 *  Cells turn their drum in order (blank, A..Z, 0..9, punctuation) to reach
 *  a target, so a long change takes longer. The drum releases a flap every
 *  ~58ms while a flap takes ~170ms to fall, so at speed two or three leaves
 *  are in the air at once: the flutter. Each face is lit by one light above
 *  and in front: the front darkens as it tips away, the back catches a
 *  little sheen on the way down, the falling flap shades the half beneath
 *  it, and the newly bared upper half comes out of its shadow.
 *
 *  One shared rAF loop runs only while some cell is moving; offscreen or in
 *  a hidden tab, changes apply at once. Clicks are synthesised with
 *  WebAudio, off unless data-sound is set, and silent until the visitor has
 *  touched the page (no autoplay). The final text (never each flap) goes to
 *  a polite live region. Reduced motion: every change is instant.
 *  No dependencies.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

export const DRUMS = {
    full: " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-/&'",
    alpha: ' ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    blankdigits: ' 0123456789',
};

/* ---- timing ---------------------------------------------------------------
 * STEP: the drum releases a flap this often (jittered ±12%), so ~17 flaps/s.
 * FALL: one flap's fall, hinge-up to landed. BOUNCE: its rebound.          */
const STEP = 58;
const FALL = 172;
const BOUNCE = 120;
const STAGGER = 26;        // per cell, left to right
const JITTER = 60;         // plus up to this much at random
const LIGHT = (36 * Math.PI) / 180;   // light elevation above the viewer's line

/* The fall: an inverted pendulum (theta'' = g sin theta) given a small push
 * past the stop by the drum, integrated once and kept as a lookup table of
 * angle fraction (0 upright .. 1 landed) against time fraction.            */
const FALL_LUT = (() => {
    const th0 = 0.5, N = 128;
    let th = th0, w = 0.6, t = 0;
    const dt = 0.0005, pts = [[0, 0]];
    while (th < Math.PI) { w += Math.sin(th) * dt; th += w * dt; t += dt; pts.push([t, Math.min(1, (th - th0) / (Math.PI - th0))]); }
    const lut = new Float32Array(N + 1);
    for (let i = 0, j = 0; i <= N; i++) {
        const tt = (i / N) * t;
        while (j < pts.length - 2 && pts[j + 1][0] < tt) j++;
        const [ta, a] = pts[j], [tb, b] = pts[j + 1];
        lut[i] = a + (b - a) * clamp((tt - ta) / (tb - ta || 1));
    }
    return lut;
})();
function fallAngle(u) {
    const x = clamp(u) * (FALL_LUT.length - 1), i = Math.floor(x), f = x - i;
    const a = FALL_LUT[i], b = FALL_LUT[Math.min(i + 1, FALL_LUT.length - 1)];
    return 180 * (a + (b - a) * f);
}
/* After impact: one ballistic hop (a parabola) and a much smaller second.  */
function bounceAngle(ms) {
    const h1 = 68, h2 = BOUNCE - h1;
    if (ms < h1) { const u = ms / h1; return 180 - 9 * 4 * u * (1 - u); }
    const u = clamp((ms - h1) / h2); return 180 - 2.2 * 4 * u * (1 - u);
}
/* Lambert with ambient, relative to a flat face at rest. Negative = darker. */
const AMB = 0.32, DIF = 0.68;
const REST = AMB + DIF * Math.cos(LIGHT);
function faceLight(deg, back) {
    const th = (deg * Math.PI) / 180;
    let d = -Math.sin(th) * Math.sin(LIGHT) + Math.cos(th) * Math.cos(LIGHT);
    if (back) d = -d;
    return (AMB + DIF * Math.max(0, d)) / REST - 1;
}

/* ---- the physics, baked into keyframes ------------------------------------
 * Every flap falls the same way, so the fall, the light on both faces and
 * the shadow cast on the lower half are sampled once into keyframes. Each
 * cell keeps a few leaves (built once, reused), each with its four Web
 * Animations paused; a release just rewinds and plays them. Everything
 * animated is transform, filter or opacity, so the compositor runs it and
 * the main thread only sets two glyphs, a z-index and a visibility.       */
const LIFE = FALL + BOUNCE;
const angleAt = (ms) => (ms < FALL ? fallAngle(ms / FALL) : bounceAngle(ms - FALL));
const T90 = (() => { for (let ms = 0; ms < FALL; ms += 0.25) if (angleAt(ms) >= 90) return ms; return FALL; })();
let KF = null;
function physics() {
    if (KF) return KF;
    const grid = (n, extra) => [...new Set([...Array.from({ length: n + 1 }, (_, i) => (i / n) * LIFE), ...extra])].sort((a, b) => a - b);
    const bright = (lit, soft) => `brightness(${(1 + lit * (lit < 0 ? soft : soft * 0.4)).toFixed(3)})`;
    KF = { fall: [], front: [], back: [], frontL: [], backL: [], cast: [] };
    // cream flaps: brightness() would grey them, so they are shaded by a warm
    // umber overlay (--sf-tint) whose opacity follows the same light curve
    // the fall needs its curve (and the impact exactly); the light is smooth
    for (const ms of grid(24, [FALL, FALL + 34])) KF.fall.push({ offset: ms / LIFE, transform: `rotateX(${(-angleAt(ms)).toFixed(2)}deg)` });
    for (const ms of grid(10, [T90, FALL])) {
        const deg = angleAt(ms), offset = ms / LIFE, fr = faceLight(deg, false), bk = faceLight(deg, true);
        KF.front.push({ offset, filter: bright(fr, 0.9) });
        KF.back.push({ offset, filter: bright(bk, 0.9) });
        KF.frontL.push({ offset, opacity: +(Math.max(0, -fr) * 0.66).toFixed(3) });
        KF.backL.push({ offset, opacity: +(Math.max(0, -bk) * 0.66).toFixed(3) });
        KF.cast.push({ offset, opacity: +(smooth(28, 172, deg) * (ms < FALL ? 1 : 0.85) * 0.62).toFixed(3) });
    }
    return KF;
}

/* ---- sound ------------------------------------------------------------------
 * A click is 30ms of noise through a bandpass with a fast exponential decay,
 * over a quieter low knock. At most one per frame per page; many landings in
 * the same frame make it a little louder, not more numerous (a rattle).
 * The AudioContext is only created inside a user gesture.                  */
let actx = null, noise = null, master = null, impacts = 0;
const voiced = new Set();          // instances with sound on
function audioUnlock() {
    if (!voiced.size) return;
    try {
        if (!actx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            actx = new AC();
            noise = actx.createBuffer(1, Math.ceil(actx.sampleRate * 0.05), actx.sampleRate);
            const ch = noise.getChannelData(0);
            for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 2);
            master = actx.createGain(); master.gain.value = 0.5; master.connect(actx.destination);
        }
        if (actx.state === 'suspended') actx.resume();
    } catch (e) { /* no audio: stay silent */ }
}
function onGesture() { audioUnlock(); }
let gestureBound = false;
function bindGesture() {
    if (gestureBound) return;
    gestureBound = true;
    addEventListener('pointerdown', onGesture, true);
    addEventListener('keydown', onGesture, true);
}
function click(n) {
    if (!actx || actx.state !== 'running' || !voiced.size) return;
    const t = actx.currentTime, vol = Math.min(0.22, 0.07 + 0.035 * Math.sqrt(n));
    const voice = (type, f, q, v, len) => {
        const s = actx.createBufferSource(); s.buffer = noise; s.playbackRate.value = 0.85 + Math.random() * 0.4;
        const fl = actx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
        const g = actx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.0012);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        s.connect(fl); fl.connect(g); g.connect(master); s.start(t); s.stop(t + len + 0.01);
    };
    voice('bandpass', 2300 + Math.random() * 1500, 1.6, vol, 0.03);
    voice('lowpass', 520, 0.8, vol * 0.7, 0.045);
}

/* ---- the shared clock ------------------------------------------------------
 * One rAF for every cell on the page, running only while one is moving.    */
const active = new Set();
let raf = 0;
function kick() { if (!raf) raf = requestAnimationFrame(frame); }
function frame(now) {
    raf = 0;
    impacts = 0;
    for (const c of active) tickCell(c, now);
    if (impacts) click(impacts);
    if (active.size) kick();
}

const html = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const show = (ch) => (ch === ' ' ? '\u00a0' : ch);
function half(cls) {
    const h = html('span', 'sf-half ' + cls);
    const g = html('span', 'sf-g', '\u00a0');
    h.append(g);
    return { el: h, g };
}

function makeLeaf(c) {
    // a full-cell wrapper (it carries the perspective and the cast shadow)
    // around the flap, whose two faces are back to back
    const k = physics(), light = c.inst.light;
    const el = html('span', 'sf-leaf');
    const cast = html('i', 'sf-cast');
    const flap = html('span', 'sf-flap');
    const front = half('sf-top sf-front'), back = half('sf-bot sf-back');
    flap.append(front.el, back.el);
    el.append(cast, flap);
    el.style.visibility = 'hidden';
    c.el.appendChild(el);
    const o = { duration: LIFE, fill: 'both', easing: 'linear' };
    const anims = [flap.animate(k.fall, o), cast.animate(k.cast, o)];
    if (light) {
        const ft = html('i', 'sf-tint'), bt = html('i', 'sf-tint');
        front.el.appendChild(ft); back.el.appendChild(bt);
        anims.push(ft.animate(k.frontL, o), bt.animate(k.backL, o));
    } else anims.push(front.el.animate(k.front, o), back.el.animate(k.back, o));
    for (const a of anims) a.cancel();
    return { el, front, back, anims, t0: 0, to: 0, seq: 0, hit: false, low: false, last: false };
}

function release(c, t0, now) {
    const n = c.drum.length;
    const from = c.head, to = (from + 1) % n;
    const leaf = c.pool.pop() || makeLeaf(c);
    leaf.front.g.textContent = show(c.drum[from]);
    leaf.back.g.textContent = show(c.drum[to]);
    leaf.t0 = t0; leaf.to = to; leaf.seq = ++c.seq % 1000; leaf.hit = false; leaf.low = false; leaf.last = to === c.target;
    leaf.el.style.zIndex = 2000 - leaf.seq;
    leaf.el.style.visibility = '';
    for (const a of leaf.anims) { a.currentTime = Math.max(0, now - t0); a.play(); }   // late? start part-way through
    c.leaves.push(leaf);
    c.top.g.textContent = show(c.drum[to]);
    c.head = to;
}

function park(c, leaf) {
    leaf.el.style.visibility = 'hidden';
    for (const a of leaf.anims) a.cancel();     // idle leaves hold no compositor layers
    c.pool.push(leaf);
}
function land(c, leaf) {
    c.bot.g.textContent = show(c.drum[leaf.to]);
    c.pos = leaf.to;
    park(c, leaf);
}

function tickCell(c, now) {
    // let the drum release flaps that are due (catching up if a frame was late)
    if (now - c.next > 600) { snapCell(c); return; }
    while (c.head !== c.target && now >= c.next) {
        release(c, c.next, now);
        c.next += STEP * (0.88 + Math.random() * 0.24);
    }
    for (let i = 0; i < c.leaves.length; i++) {
        const L = c.leaves[i];
        const age = now - L.t0;
        // only the last flap of a change is left to bounce; the others are
        // already covered by the next one, so they go as soon as they land
        if (age >= (L.last ? LIFE : FALL)) { land(c, L); c.leaves.splice(i--, 1); continue; }
        // past the horizontal, a later flap lies on top of an earlier one
        if (!L.low && age >= T90) { L.low = true; L.el.style.zIndex = 3000 + L.seq; }
        if (age >= FALL && !L.hit) { L.hit = true; if (c.inst.sound) impacts++; }
    }
    if (c.head === c.target && !c.leaves.length) finishCell(c);
}

function snapCell(c) {
    for (const L of c.leaves) park(c, L);
    c.leaves.length = 0;
    c.head = c.pos = c.target;
    c.top.g.textContent = c.bot.g.textContent = show(c.drum[c.target]);
    finishCell(c);
}
function finishCell(c) {
    if (active.delete(c)) c.inst.cellDone();
}

/* ---- text into cells -------------------------------------------------------- */
function norm(ch, drum) {
    let u = (ch || ' ').toUpperCase();
    if (drum.includes(u)) return drum.indexOf(u);
    u = u.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (u && drum.includes(u[0])) return drum.indexOf(u[0]);
    return drum.includes(' ') ? drum.indexOf(' ') : 0;
}
function parseMask(mask) {
    // A = full drum, a = letters only, 9 = digits, anything else = a printed separator
    return [...mask].map((m) => (m === 'A' ? DRUMS.full : m === 'a' ? DRUMS.alpha : m === '9' ? DRUMS.digits : m === '_' ? DRUMS.blankdigits : { sep: m }));
}
function clockMask(fmt) { return fmt.replace(/[HMS]/g, '9'); }
function clockText(fmt, h12) {
    const d = new Date();
    let h = d.getHours();
    if (h12) h = h % 12 || 12;
    const p = (n) => String(n).padStart(2, '0');
    return fmt.replace('HH', p(h)).replace('MM', p(d.getMinutes())).replace('SS', p(d.getSeconds()));
}

let shiftCache = new Map();
function capShift(sample) {
    const cs = getComputedStyle(sample);
    const font = `${cs.fontStyle} ${cs.fontWeight} 100px ${cs.fontFamily}`;
    if (shiftCache.has(font)) return shiftCache.get(font);
    let v = 0;
    try {
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = font;
        const m = ctx.measureText('H');
        if (m.fontBoundingBoxAscent) v = (m.fontBoundingBoxDescent + m.actualBoundingBoxAscent - m.fontBoundingBoxAscent) / 200;
    } catch (e) { v = 0; }
    shiftCache.set(font, v);
    return v;
}

/* ---- the component ------------------------------------------------------------ */
export function splitFlap(root, opts = {}) {
    const ds = root.dataset;
    const pick = (k, d) => (opts[k] !== undefined ? opts[k] : ds[k] !== undefined ? ds[k] : d);
    const original = root.textContent;
    const words = [].concat(pick('words', '') || []).join(',').split(/[,|]/).map((w) => w.trim()).filter(Boolean);
    const clockFmt = pick('clock', null);
    const clock = clockFmt != null ? (clockFmt === '' || clockFmt === 'true' ? 'HH:MM' : String(clockFmt)) : null;
    const counterRaw = pick('counter', null);
    const counter = counterRaw != null;
    let value = counter ? Number(counterRaw) || 0 : 0;
    const align = pick('align', 'left');
    const theme = pick('theme', 'dark');
    const interval = Number(pick('interval', 2600));
    const intro = String(pick('intro', 'true')) !== 'false';
    const h12 = String(pick('hour12', 'false')) === 'true';
    const live = pick('live', clock ? 'off' : 'polite');
    const drumName = pick('drum', counter ? 'digits' : 'full');
    const drum = DRUMS[drumName] || String(drumName).toUpperCase();
    const initial = (words[0] || original.trim() || '').toUpperCase();
    let length = Number(pick('length', 0)) || 0;
    if (!length) length = counter ? Math.max(String(Math.round(value)).length, 4) : Math.max(initial.length, ...words.map((w) => w.length), 1);
    const maskStr = pick('mask', clock ? clockMask(clock) : null);
    const slots = maskStr ? parseMask(maskStr) : Array.from({ length }, () => drum);

    // ---- build
    root.classList.add('sf');
    if (theme === 'light') root.classList.add('sf--light');
    root.setAttribute('translate', 'no');
    const addedRole = !!clock && !root.hasAttribute('role');
    if (addedRole) root.setAttribute('role', 'timer');
    root.textContent = '';
    const sr = html('span', 'sf-sr');
    sr.setAttribute('aria-live', live); sr.setAttribute('aria-atomic', 'true');
    const row = html('span', 'sf-cells');
    row.setAttribute('aria-hidden', 'true');
    root.append(sr, row);

    const inst = {
        sound: false, busy: 0, visible: false, seen: false, light: theme === 'light' || root.classList.contains('sf--light'),
        cellDone() { if (--this.busy <= 0) { this.busy = 0; settled(); } },
    };
    const cells = [];
    for (const s of slots) {
        if (s.sep != null) { row.append(html('span', 'sf-sep', s.sep)); continue; }
        const el = html('span', 'sf-cell');
        const top = half('sf-top'), bot = half('sf-bot');
        el.append(top.el, bot.el);
        row.append(el);
        const blank = s.includes(' ') ? s.indexOf(' ') : 0;
        cells.push({ el, top, bot, drum: s, pos: blank, head: blank, target: blank, next: 0, leaves: [], pool: [], seq: 0, inst });
        top.g.textContent = bot.g.textContent = show(s[blank]);
    }

    let text = '';           // what the cells are heading for
    let shown = '';          // what was last announced
    function layout(t) {
        // fill the flap cells with t (separators in t are skipped if t matches the mask's length)
        t = String(t ?? '').toUpperCase();
        if (maskStr && t.length === slots.length) t = [...t].filter((_, i) => slots[i].sep == null).join('');
        const n = cells.length;
        if (t.length > n) t = t.slice(0, n);
        const pad = n - t.length;
        if (align === 'right') t = ' '.repeat(pad) + t;
        else if (align === 'center') t = ' '.repeat(Math.floor(pad / 2)) + t + ' '.repeat(Math.ceil(pad / 2));
        else t = t + ' '.repeat(pad);
        return t;
    }
    function readable(t) {
        if (!maskStr) return t.trim();
        let k = 0;
        return slots.map((s) => (s.sep != null ? s.sep : t[k++] ?? '')).join('').trim();
    }

    function setText(t, o = {}) {
        const target = layout(t);
        text = target;
        const instant = o.instant || calm.matches || !inst.visible || document.hidden || !ready;
        const now = performance.now() + (o.delay || 0);
        const stagger = o.stagger ?? STAGGER;
        let started = 0;
        cells.forEach((c, i) => {
            c.target = norm(target[i], c.drum);
            if (instant) { if (c.head !== c.target || c.leaves.length) snapCell(c); return; }
            if (c.head === c.target) return;
            if (!active.has(c)) {
                c.next = now + i * stagger + Math.random() * (o.jitter ?? JITTER);
                active.add(c); inst.busy++; started++;
            }
        });
        if (started) kick();
        else if (!inst.busy) settled();
    }

    function settled() {
        const r = readable(text);
        if (r !== shown) { shown = r; sr.textContent = r; }
        root.dispatchEvent(new CustomEvent('split-flap:settle', { bubbles: true, detail: { text: r } }));
        if (words.length > 1 && !paused && !calm.matches) schedule(interval, nextWord);
    }

    // ---- modes
    let timer = 0, paused = false, wi = 0;
    function schedule(ms, fn) { clearTimeout(timer); timer = setTimeout(fn, ms); }
    function nextWord() {
        if (paused || !inst.visible || document.hidden || calm.matches) return;
        wi = (wi + 1) % words.length;
        setText(words[wi]);
    }
    function tickClock() {
        setText(clockText(clock, h12), { stagger: 14, jitter: 20 });
        const ms = clock.includes('SS') ? 1000 - (Date.now() % 1000) + 5 : 60000 - (Date.now() % 60000) + 5;
        schedule(ms, tickClock);
    }
    function start() {
        if (clock) tickClock();
        else if (counter) setValue(value);
        else if (words.length) { setText(words[wi]); }
        else setText(initial);
    }
    function setValue(n) {
        value = Number(n) || 0;
        const digits = String(Math.max(0, Math.round(value)));
        setText(digits.padStart(cells.length, drum.includes('0') ? '0' : ' ').slice(-cells.length), { stagger: 30 });
    }

    // ---- start once fonts are in (the cap height centres on the split)
    let ready = false, dead = false;
    const fontsIn = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    const firstText = () => (clock ? clockText(clock, h12) : counter ? String(Math.max(0, Math.round(value))).padStart(cells.length, '0') : words[0] || initial);
    // without intro (or with reduced motion) show the text straight away
    if (!intro || calm.matches) setText(firstText(), { instant: true });
    sr.textContent = shown = readable(layout(firstText()));
    fontsIn.then(() => {
        if (dead) return;
        root.style.setProperty('--sf-shift', capShift(cells[0] ? cells[0].top.g : root).toFixed(4));
        ready = true;
        if (inst.visible) { inst.seen = true; start(); }
    });

    const io = new IntersectionObserver((es) => {
        const was = inst.visible;
        inst.visible = es[es.length - 1].isIntersecting;
        if (!inst.visible && was) for (const c of cells) if (active.has(c) || c.leaves.length) snapCell(c);
        if (inst.visible && !was && ready) {
            if (!inst.seen) { inst.seen = true; start(); }
            else if (words.length > 1 && !paused && !inst.busy) schedule(interval * 0.5, nextWord);
            else if (clock) tickClock();
        }
    }, { rootMargin: '40px 0px' });
    io.observe(root);

    const onVis = () => {
        if (document.hidden) { for (const c of cells) if (active.has(c)) snapCell(c); }
        else if (ready && inst.visible) { if (clock) tickClock(); else if (words.length > 1 && !paused && !inst.busy) schedule(interval * 0.5, nextWord); }
    };
    document.addEventListener('visibilitychange', onVis);
    const onCalm = () => { if (calm.matches) for (const c of cells) if (active.has(c)) snapCell(c); };
    calm.addEventListener?.('change', onCalm);

    function sound(on) {
        inst.sound = !!on;
        if (inst.sound) { voiced.add(inst); bindGesture(); audioUnlock(); } else voiced.delete(inst);
        return inst.sound;
    }
    if (String(pick('sound', 'false')) !== 'false') sound(true);

    function destroy() {
        dead = true;
        clearTimeout(timer);
        io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        calm.removeEventListener?.('change', onCalm);
        for (const c of cells) active.delete(c);
        voiced.delete(inst);
        root.classList.remove('sf', 'sf--light');
        if (!root.classList.length) root.removeAttribute('class');
        root.style.removeProperty('--sf-shift');
        root.removeAttribute('translate');
        if (addedRole) root.removeAttribute('role');
        root.textContent = original;
        delete root.splitFlap;
    }
    destroy.setText = (t, o) => setText(t, o);
    destroy.setValue = setValue;
    destroy.sound = sound;
    destroy.pause = () => { paused = true; clearTimeout(timer); };
    destroy.play = () => { if (!paused) return; paused = false; if (clock) tickClock(); else if (words.length > 1) schedule(interval * 0.5, nextWord); };
    Object.defineProperty(destroy, 'text', { get: () => readable(text) });
    Object.defineProperty(destroy, 'busy', { get: () => inst.busy > 0 });
    root.splitFlap = destroy;
    return destroy;
}

document.querySelectorAll('[data-split-flap]').forEach((el) => splitFlap(el));
