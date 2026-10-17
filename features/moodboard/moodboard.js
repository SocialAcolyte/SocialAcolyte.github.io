/*
 *  MOODBOARD // a pinboard of images on an endless sheet of paper.
 *
 *  Markup:  <section data-moodboard data-key="studio" aria-label="Moodboard">
 *             <ul class="mb-cards">
 *               <li data-large="assets/lg/great-wave.webp" data-size="1.3" data-label="this blue">
 *                 <img src="assets/sm/great-wave.jpg" width="560" height="383" alt="The Great Wave"></li>
 *               <li data-pinned><img src="assets/sm/aureus-nero.jpg" width="500" height="506" alt="A gold aureus"></li>
 *             </ul>
 *           </section>
 *  Or call  moodboard(section, options)  yourself. It returns destroy().
 *
 *  One world layer carries every card; the camera is a single CSS transform on
 *  it (translate + scale), so panning and zooming never touch the cards. The
 *  layer is composited only while the camera moves and is re-rasterised when
 *  it stops, so type and pictures are sharp at any zoom.
 *
 *  Pointers go through a small statechart (CHART below). Inputs only send
 *  events; the chart alone decides what an event means in the current state,
 *  and an event a state does not list means nothing.
 *
 *  Cards are paper prints. Picked up, a card rises (scale, a deeper and longer
 *  shadow) and hangs from the point you hold: its tilt is a spring chasing the
 *  pointer's sideways speed, so it swings as you move and settles when you
 *  stop. Let go fast and it slides on with the speed it had and stops the way
 *  paper stops on paper. A pinned card cannot leave; pull it and it swings
 *  about its pin and back. Edges snap to other cards' edges and centres, with
 *  thin clay guides, and a card that snaps squares itself up.
 *
 *  Phones: in the page the board is a window. One finger drags cards; two
 *  fingers pan and zoom; a vertical swipe on the paper scrolls the page. Full
 *  screen (the corner button) gives one finger to the board as well.
 *
 *  Reduced motion: no deal, no glides, no inertia, no throws, no swing. Cards
 *  still follow the finger exactly and stop where they are let go.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const DEG = Math.PI / 180;
const ease = {
    inOut: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    outQuart: (t) => 1 - Math.pow(1 - t, 4),
};
let rand = Math.random;
const rnd = (a, b) => a + rand() * (b - a);
const seeded = (n) => () => { n = (n + 0x6d2b79f5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

/* Physical constants (world units are CSS px at zoom 1). */
const FRICTION = 4.4;        // 1/s. A throw slides v / FRICTION: 1500 px/s goes ~340 px
const MAX_THROW = 2200;      // px/s on screen
const TILT_PER_SPEED = .0085;// degrees of swing per px/s of sideways speed
const MAX_TILT = 11;
const SNAP_PX = 7;           // on screen
const ZOOM_MAX = 4;

// The pointer statechart. Each state lists the events it accepts and where
// they lead. Everything else is ignored.
export const CHART = {
    idle:      { DOWN_CARD: 'pressing', DOWN_CANVAS: 'pointing', DOWN_PAN: 'panning', DOWN_MARQUEE: 'marquee', SECOND: 'pinching' },
    pressing:  { MOVE_FAR: 'dragging', PULL_PINNED: 'straining', UP: 'idle', CANCEL: 'idle', SECOND: 'pinching' },
    dragging:  { MOVE: 'dragging', UP: 'idle', CANCEL: 'idle', SECOND: 'pinching' },
    straining: { MOVE: 'straining', UP: 'idle', CANCEL: 'idle', SECOND: 'pinching' },
    pointing:  { MOVE_FAR: 'panning', SWIPE: 'idle', HOLD: 'marquee', UP: 'idle', CANCEL: 'idle', SECOND: 'pinching' },
    panning:   { MOVE: 'panning', UP: 'idle', CANCEL: 'idle', SECOND: 'pinching' },
    marquee:   { MOVE: 'marquee', UP: 'idle', CANCEL: 'idle', SECOND: 'pinching' },
    pinching:  { MOVE: 'pinching', LIFT: 'resting', CANCEL: 'idle' },
    resting:   { LIFT: 'idle', CANCEL: 'idle' },
};

const ICON = {
    undo: '<path d="M9.5 6.5 5.5 10.5l4 4"/><path d="M5.5 10.5h8.25a4.75 4.75 0 0 1 0 9.5H11"/>',
    redo: '<path d="M14.5 6.5l4 4-4 4"/><path d="M18.5 10.5h-8.25a4.75 4.75 0 0 0 0 9.5H13"/>',
    tidy: '<rect x="4.5" y="4.5" width="6" height="6" rx=".6"/><rect x="13.5" y="4.5" width="6" height="6" rx=".6"/><rect x="4.5" y="13.5" width="6" height="6" rx=".6"/><rect x="13.5" y="13.5" width="6" height="6" rx=".6"/>',
    out: '<path d="M6.5 12h11"/>',
    in: '<path d="M6.5 12h11M12 6.5v11"/>',
    fit: '<path d="M4.5 9V5.5a1 1 0 0 1 1-1H9M15 4.5h3.5a1 1 0 0 1 1 1V9M19.5 15v3.5a1 1 0 0 1-1 1H15M9 19.5H5.5a1 1 0 0 1-1-1V15"/>',
    full: '<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/>',
    shrink: '<path d="M19.5 10.5H13.5V4.5M4.5 13.5h6v6M13.5 10.5l6-6M10.5 13.5l-6 6"/>',
    restore: '<path d="M3.5 12s3-6 8.5-6 8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6z"/><circle cx="12" cy="12" r="2.6"/>',
};

export function moodboard(root, opts = {}) {
    if (root.__mb) return root.__mb;
    const list = root.querySelector('ul, ol');
    if (!list) return () => {};
    const ds = root.dataset;
    const flag = (v, d) => (v == null ? d : v !== 'false' && v !== false);
    const o = {
        key: opts.key ?? ds.key ?? 'moodboard',
        persist: flag(opts.persist ?? ds.persist, true),
        seed: opts.seed ?? (ds.seed ? +ds.seed : null),
        size: +(opts.size ?? ds.size ?? 200),
        minimap: flag(opts.minimap ?? ds.minimap, true),
        snap: flag(opts.snap ?? ds.snap, true),
        deal: flag(opts.deal ?? ds.deal, true),
        wheel: opts.wheel ?? ds.wheel ?? 'pan',
        maxZoom: +(opts.maxZoom ?? ds.maxZoom ?? ZOOM_MAX),
    };
    rand = o.seed != null ? seeded(o.seed) : Math.random;
    const id = ++uid;
    const off = [];
    const on = (t, ev, f, p) => { t.addEventListener(ev, f, p); off.push(() => t.removeEventListener(ev, f, p)); };
    let dead = false, live = false, raf = 0, last = 0, visible = true;

    /* ─── Cards ──────────────────────────────────────────────────── */

    const cards = [...list.children].filter((li) => li.querySelector('img')).map((li, i) => {
        const img = li.querySelector('img');
        const src = img.getAttribute('src');
        return {
            li, img, i, src,
            id: li.dataset.id || src.split('/').pop().replace(/\.\w+$/, ''),
            lg: (li.dataset.large || '').trim().split(/\s+/)[0] || null,
            lgW: +(/\s(\d+)w\s*$/.exec(li.dataset.large || '') || [])[1] || 0,
            size: +li.dataset.size || 1,
            label: li.dataset.label || '',
            pinned: 'pinned' in li.dataset,
            hidden: false,
            x: 0, y: 0, r: 0, k: 1, order: i, sel: false,
            vx: 0, vy: 0, tilt: 0, tiltV: 0, lift: 0, liftV: 0, liftT: 0,
            strain: 0, strainV: 0, strainT: 0, f: 1,
            held: false, square: false, anim: null, hi: 0, m: [1, 0, 0, 1, 0, 0], key: '',
            rgb: [190, 182, 168], hue: 0, sat: 0, lum: .7,
        };
    });
    if (!cards.length) return () => {};
    const byEl = new Map(cards.map((c) => [c.li, c]));
    let topOrder = cards.length;

    /* ─── DOM ────────────────────────────────────────────────────── */

    const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
    const grid = el('div', 'mb-grid');
    const world = el('div', 'mb-world');
    const over = document.createElementNS(NS, 'svg');
    over.setAttribute('class', 'mb-over'); over.setAttribute('aria-hidden', 'true');
    const mini = el('div', 'mb-mini');
    const miniCv = el('canvas');
    mini.append(miniCv); mini.setAttribute('aria-hidden', 'true');
    const help = el('p', 'mb-sr');
    help.id = `mb-help-${id}`;
    help.textContent = 'Drag cards to move them; two fingers or the wheel pan, pinch or Ctrl and the wheel zooms. Arrow keys nudge a card, Enter zooms to it, P pins it, Delete hides it, Ctrl Z undoes.';
    const toast = el('div', 'mb-toast');
    const toastText = el('span');
    const toastBtn = el('button', 'mb-toast-btn', 'Undo');
    toastBtn.type = 'button';
    toast.append(toastText, toastBtn);
    const live$ = el('div', 'mb-sr');
    live$.setAttribute('aria-live', 'polite');
    const btn = (name, label, icon) => {
        const b = el('button', `mb-btn mb-${name}`, icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[icon]}</svg>` : '');
        b.type = 'button'; b.setAttribute('aria-label', label); b.title = label;
        return b;
    };
    const bar = el('div', 'mb-bar');
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Board');
    const b = {
        undo: btn('undo', 'Undo', 'undo'), redo: btn('redo', 'Redo', 'redo'),
        tidy: btn('tidy', 'Tidy into a grid', 'tidy'),
        out: btn('zout', 'Zoom out', 'out'), pct: btn('pct', 'Zoom to 100%'), in: btn('zin', 'Zoom in', 'in'),
        fit: btn('fit', 'Zoom to fit', 'fit'), restore: btn('restore', 'Show hidden cards', 'restore'),
    };
    b.pct.textContent = '100%';
    const sep = () => el('span', 'mb-sep');
    bar.append(b.undo, b.redo, sep(), b.tidy, b.restore, sep(), b.out, b.pct, b.in, b.fit);
    const full = btn('full', 'Full screen', 'full');
    full.setAttribute('aria-pressed', 'false');
    const hold = el('div', 'mb-hold');      // the ring that grows during a long press
    hold.setAttribute('aria-hidden', 'true');

    /* ─── Camera ─────────────────────────────────────────────────── */

    let W = 1, H = 1;
    const cam = { ox: 0, oy: 0, z: 1 };
    const mo = { vx: 0, vy: 0, zT: 0, ax: 0, ay: 0, glide: null, moving: false };
    let settleT = 0, compT = 0;
    // the lower zoom limit: half of what fits everything, and never above 0.3
    const zMinF = () => Math.min(.3, fitZoom(bounds(), ...margins()) * .5);
    const toWorld = (sx, sy) => ({ x: (sx - cam.ox) / cam.z, y: (sy - cam.oy) / cam.z });
    const center = () => toWorld(W / 2, H / 2);
    const setCenter = (cx, cy, z = cam.z) => { cam.z = z; cam.ox = W / 2 - cx * z; cam.oy = H / 2 - cy * z; };
    function zoomAt(sx, sy, z2) {
        const w = toWorld(sx, sy);
        cam.z = z2; cam.ox = sx - w.x * z2; cam.oy = sy - w.y * z2;
    }
    let pctShown = '';
    function applyCam() {
        world.style.transform = `translate(${cam.ox}px, ${cam.oy}px) scale(${cam.z})`;
        root.style.setProperty('--mb-z', cam.z.toFixed(4));
        // the dot grid: 24 world px, thinning out as you zoom away
        let g = 24 * cam.z; while (g < 14) g *= 2;
        grid.style.backgroundSize = `${g}px ${g}px`;
        grid.style.backgroundPosition = `${cam.ox % g}px ${cam.oy % g}px`;
        grid.style.opacity = clamp((cam.z - .08) / .35, .25, 1);
        const p = `${Math.round(cam.z * 100)}%`;
        if (p !== pctShown) { b.pct.textContent = pctShown = p; }
        // compositing while the camera moves; sharp re-raster once it rests
        if (!world.classList.contains('is-moving')) world.classList.add('is-moving');
        clearTimeout(compT);
        compT = setTimeout(() => { world.classList.remove('is-moving'); upgradeImages(); }, 180);
        overlayDirty = miniDirty = true;
    }
    function glideTo(cx, cy, z, dur = 720) {
        mo.vx = mo.vy = 0; mo.zT = 0;
        z = clamp(z, zMinF(), o.maxZoom);
        if (calm.matches || !dur) { setCenter(cx, cy, z); applyCam(); return; }
        const c0 = center();
        mo.glide = { c0, z0: cam.z, cx, cy, z, t0: performance.now(), dur };
        kick();
    }
    // content bounds from the rotated corners of every visible card
    function bounds(list2 = cards.filter((c) => !c.hidden)) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of list2) {
            for (const [px, py] of corners(c, true)) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); }
        }
        if (x0 === Infinity) return { x0: -200, y0: -200, x1: 200, y1: 200 };
        return { x0, y0, x1, y1 };
    }
    function fitZoom(bb, mx, my) {
        return Math.min((W - 2 * mx) / Math.max(1, bb.x1 - bb.x0), (H - 2 * my) / Math.max(1, bb.y1 - bb.y0));
    }
    const margins = () => (W < 560 ? [16, 50] : [44, 58]);   // bottom room for the toolbar
    function fitAll(dur = 720) {
        const bb = bounds();
        const [mx, my] = margins();
        const z = Math.min(1.15, fitZoom(bb, mx, my));
        glideTo((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2 + (W < 560 ? 4 : 6) / z, z, dur);
    }
    function zoomTo(c, dur = 760) {
        const bb = bounds([c]);
        // never past the picture's own resolution: sharp or nothing
        const px = c.lg && c.lgW ? Math.max(c.lgW, c.smW) : c.lg ? c.smW * 3 : c.smW;
        const sharp = px / (c.iw * c.k * Math.min(3, devicePixelRatio || 1));
        const z = Math.min(fitZoom(bb, W * .09 + 8, H * .1 + 24), Math.max(1, sharp), o.maxZoom);
        glideTo(c.x, c.y, z, dur);
    }
    function zoomBy(f, sx = W / 2, sy = H / 2) {
        mo.glide = null;
        const base = mo.zT || cam.z;
        mo.zT = clamp(base * f, zMinF(), o.maxZoom);
        mo.ax = sx; mo.ay = sy;
        if (calm.matches) { zoomAt(sx, sy, mo.zT); mo.zT = 0; applyCam(); return; }
        kick();
    }
    // Keep some of the board in view: the view's centre may not leave the
    // content by more than about half a screen. Checked when a pan comes to rest.
    function settleBounds() {
        if (mo.glide || mo.zT || state === 'panning' || state === 'pinching') return;
        const bb = bounds();
        const c = center();
        const hx = W / cam.z * .45, hy = H / cam.z * .45;
        const cx = clamp(c.x, bb.x0 - hx, bb.x1 + hx), cy = clamp(c.y, bb.y0 - hy, bb.y1 + hy);
        const z = clamp(cam.z, zMinF(), o.maxZoom);
        if (Math.abs(cx - c.x) > .5 || Math.abs(cy - c.y) > .5 || z !== cam.z) glideTo(cx, cy, z, 420);
    }

    /* ─── Card geometry and drawing ──────────────────────────────── */

    // M = T(x,y) R(r+tilt) [T(pin) R(strain) T(-pin)] S(k·(1+lift)) T(-w/2,-h/2)
    // k is the card's display scale: 1, except after a justified Tidy
    function matrix(c, rest) {
        // at rest means where it is going: an animating card counts at its target
        if (rest && c.anim) c = { ...c, x: c.anim.tx, y: c.anim.ty, r: c.anim.tr, k: c.anim.tk };
        const k = c.k * (rest ? 1 : 1 + .03 * c.lift);
        const a = (rest ? c.r : c.r + c.tilt) * DEG, s = rest ? 0 : c.strain * DEG;
        const t = a + s, ct = Math.cos(t) * k, st = Math.sin(t) * k;
        const py = (-c.h / 2 + c.pinY) * c.k;
        // inner corner (0,0) → q1 = (-w/2,-h/2)·k → about the pin by s → by a, then +x,y
        let qx = -c.w / 2 * k, qy = -c.h / 2 * k - py;
        const cs = Math.cos(s), ss = Math.sin(s);
        let rx = qx * cs - qy * ss, ry = qx * ss + qy * cs + py;
        const ca = Math.cos(a), sa = Math.sin(a);
        return [ct, st, -st, ct, c.x + rx * ca - ry * sa, c.y + rx * sa + ry * ca];
    }
    function corners(c, rest) {
        const m = rest ? matrix(c, true) : c.m;
        return [[0, 0], [c.w, 0], [c.w, c.h], [0, c.h]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
    }
    function draw(c) {
        c.m = matrix(c);
        const m = c.m;
        const key = `${m[0].toFixed(5)},${m[1].toFixed(5)},${m[4].toFixed(2)},${m[5].toFixed(2)}|${c.lift.toFixed(3)}`;
        if (key === c.key) return;
        c.key = key;
        c.li.style.transform = `matrix(${m[0]},${m[1]},${m[2]},${m[3]},${m[4]},${m[5]})`;
        c.li.style.setProperty('--lift', c.lift.toFixed(3));
        overlayDirty = miniDirty = true;
    }
    function raise(list2) {
        list2.slice().sort((a, b2) => a.order - b2.order).forEach((c) => { c.order = ++topOrder; c.li.style.zIndex = c.order; });
    }

    /* ─── Selection ──────────────────────────────────────────────── */

    const sel = new Set();
    let hover = null;
    function select(list2, add = false) {
        if (!add) for (const c of [...sel]) if (!list2.includes(c)) { sel.delete(c); c.sel = false; c.li.setAttribute('aria-selected', 'false'); }
        for (const c of list2) { sel.add(c); c.sel = true; c.li.setAttribute('aria-selected', 'true'); }
        root.classList.toggle('has-sel', sel.size > 0);
        overlayDirty = miniDirty = true; kick();
    }
    function deselect(c) { sel.delete(c); c.sel = false; c.li.setAttribute('aria-selected', 'false'); overlayDirty = miniDirty = true; kick(); }

    /* ─── Undo ───────────────────────────────────────────────────── */

    const undos = [], redos = [];
    const pose = (c) => ({ x: c.x, y: c.y, r: c.r, k: c.k });
    function record(entry) {
        undos.push(entry); if (undos.length > 150) undos.shift();
        redos.length = 0; syncBar(); saveSoon();
    }
    // A throw's end is only known when it stops: settle() fills it in then (or
    // when the card is caught again first).
    const pending = new Set();
    function settle(c) {
        for (const it of pending) if (it.c === c) { it.b = pose(c); pending.delete(it); }
    }
    function resolve(entry) {
        if (entry.kind !== 'move') return;
        for (const it of entry.items) {
            if (!it.b) { const c = it.c; c.vx = c.vy = 0; if (c.anim) finishAnim(c); settle(c); it.b = pose(c); }
        }
    }
    function moveTo(c, p, dur, delay = 0, arc = 0) {
        settle(c);
        c.vx = c.vy = 0;
        if (calm.matches || !dur) { c.anim = null; c.x = p.x; c.y = p.y; c.r = p.r; c.k = p.k ?? c.k; draw(c); return; }
        c.anim = { fx: c.x, fy: c.y, fr: c.r, fk: c.k, tx: p.x, ty: p.y, tr: p.r, tk: p.k ?? c.k, t0: performance.now(), delay, dur, arc, e: ease.inOut, land: 0 };
    }
    function finishAnim(c) { const a = c.anim; c.x = a.tx; c.y = a.ty; c.r = a.tr; c.k = a.tk; c.anim = null; c.lift = c.liftT; draw(c); }
    function apply(entry, back) {
        if (entry.kind === 'move') {
            resolve(entry);
            const n = entry.items.length;
            entry.items.forEach((it, i) => moveTo(it.c, back ? it.a : it.b, n > 6 ? 560 : 380, n > 6 ? i * 14 : 0, n > 6 ? .6 : .25));
            if (n > 6) {
                // a big rearrangement (tidy): frame the whole board as it will be
                const ps = entry.items.map((it) => ({ c: it.c, p: back ? it.a : it.b }));
                const rest = cards.filter((c) => !c.hidden && !ps.some((q) => q.c === c));
                const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
                for (const { c, p } of ps.concat(rest.map((c) => ({ c, p: c })))) {
                    const hw = c.w * (p.k ?? c.k) / 2, hh = c.h * (p.k ?? c.k) / 2;
                    bb.x0 = Math.min(bb.x0, p.x - hw); bb.x1 = Math.max(bb.x1, p.x + hw);
                    bb.y0 = Math.min(bb.y0, p.y - hh); bb.y1 = Math.max(bb.y1, p.y + hh);
                }
                const [mx, my] = margins();
                glideTo((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2, Math.min(1.15, fitZoom(bb, mx, my)), 820);
            } else reveal(entry.items.map((it) => it.c), back ? 'a' : 'b', entry);
        } else if (entry.kind === 'hide') {
            for (const c of entry.cards) setHidden(c, back ? false : true);
            if (back) select(entry.cards);
        } else if (entry.kind === 'show') {
            for (const c of entry.cards) setHidden(c, !back);
            if (!back) select(entry.cards);
        } else if (entry.kind === 'pin') {
            for (const c of entry.cards) setPinned(c, back ? !entry.value : entry.value);
        }
        kick(); saveSoon(); syncBar();
    }
    function undo() { const e = undos.pop(); if (!e) return; apply(e, true); redos.push(e); say(e.say ? `Undid ${e.say}` : 'Undone'); syncBar(); }
    function redo() { const e = redos.pop(); if (!e) return; apply(e, false); undos.push(e); say(e.say ? `Redid ${e.say}` : 'Redone'); syncBar(); }
    // if the cards an undo moves are out of sight, glide to them
    function reveal(list2, which, entry) {
        const pts = entry.items.map((it) => it[which]);
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const s = { x: cx * cam.z + cam.ox, y: cy * cam.z + cam.oy };
        if (s.x < 0 || s.y < 0 || s.x > W || s.y > H) glideTo(cx, cy, cam.z, 640);
    }

    /* ─── Pin, hide, tidy ────────────────────────────────────────── */

    function setPinned(c, v) {
        c.pinned = v;
        c.li.classList.toggle('is-pinned', v);
        c.li.classList.remove('is-pinning', 'is-unpinning');
        void c.li.offsetWidth;
        if (!calm.matches) c.li.classList.add(v ? 'is-pinning' : 'is-unpinning');
        c.li.setAttribute('aria-label', name(c));
        if (v) { c.vx = c.vy = 0; if (c.anim) finishAnim(c); }
        miniDirty = true;
    }
    function togglePin(list2) {
        if (!list2.length) return;
        const v = !list2.every((c) => c.pinned);
        list2.forEach((c) => setPinned(c, v));
        record({ kind: 'pin', cards: list2, value: v, say: v ? 'pin' : 'unpin' });
        say(v ? (list2.length > 1 ? `${list2.length} cards pinned` : 'Pinned') : (list2.length > 1 ? `${list2.length} cards unpinned` : 'Unpinned'));
    }
    function setHidden(c, v) {
        c.hidden = v;
        clearTimeout(c.hideT);
        if (v) {
            deselect(c);
            c.li.classList.add('is-gone');
            c.hideT = setTimeout(() => { if (c.hidden) c.li.hidden = true; }, calm.matches ? 0 : 280);
        } else {
            c.li.hidden = false; void c.li.offsetWidth;
            c.li.classList.remove('is-gone');
        }
        miniDirty = overlayDirty = true;
        syncBar();
    }
    function hide(list2) {
        if (!list2.length) return;
        const next = nextFocus(list2);
        list2.forEach((c) => setHidden(c, true));
        record({ kind: 'hide', cards: list2, say: 'hide' });
        toastShow(list2.length > 1 ? `${list2.length} cards hidden` : 'Card hidden', true);
        if (next) { next.li.focus({ preventScroll: true }); select([next]); }
        else root.focus({ preventScroll: true });
    }
    function nextFocus(gone) {
        const rest = cards.filter((c) => !c.hidden && !gone.includes(c));
        if (!rest.length) return null;
        const g = gone[0];
        return rest.reduce((a, c) => (Math.hypot(c.x - g.x, c.y - g.y) < Math.hypot(a.x - g.x, a.y - g.y) ? c : a));
    }
    function restoreHidden() {
        const gone = cards.filter((c) => c.hidden);
        if (!gone.length) return;
        gone.forEach((c) => setHidden(c, false));
        record({ kind: 'show', cards: gone, say: 'show hidden' });
        select(gone);
        say(`${gone.length} card${gone.length > 1 ? 's' : ''} back`);
    }

    // Tidy: a justified gallery in order of colour. Every row is one height and
    // fills the block's width exactly (cards scale to fit, gaps stay even), so
    // the block has clean left and right edges. Pinned cards stay where they
    // are; a row meeting one breaks into the free spans either side of it, like
    // text around a figure, and each span is justified on its own.
    function tidy() {
        const movers = cards.filter((c) => !c.hidden && !c.pinned);
        if (!movers.length) return;
        const pinned = cards.filter((c) => !c.hidden && c.pinned);
        const order = movers.slice().sort((a, c) => colourKey(a) - colourKey(c));
        const asp = order.map((c) => c.w / c.h);
        const g = Math.round(o.size * .09);           // gutter between cards
        const Ht = o.size * .9;                       // the row height we aim for
        const [mx, my] = margins();
        const aspect = clamp((W - 2 * mx) / Math.max(1, H - 2 * my), .45, 2.6);
        const all = bounds();
        const cx = (all.x0 + all.x1) / 2, cy = (all.y0 + all.y1) / 2;
        const obstacles = pinned.map((c) => { const b = bounds([c]); return { x0: b.x0 - g * 1.5, x1: b.x1 + g * 1.5, y0: b.y0 - g * 1.5, y1: b.y1 + g * 1.5 }; });
        const natural = asp.reduce((s, a) => s + a * Ht + g, 0);

        function layout(Wt, shift) {
            const rowsEst = Math.max(1, Math.round(natural / Wt));
            const x0 = cx - Wt / 2, top = cy - (rowsEst * (Ht + g) - g) / 2 + shift * Ht;
            let y = top, i = 0, guard = 0, bad = 0, waste = 0;
            const out = [], heights = [];
            while (i < order.length && guard++ < 400) {
                // the free spans of this band, between pinned cards
                let spans = [[x0, x0 + Wt]];
                for (const ob of obstacles) {
                    if (ob.y0 >= y + Ht * 1.3 || ob.y1 <= y) continue;
                    spans = spans.flatMap(([a, b2]) => (ob.x1 <= a || ob.x0 >= b2 ? [[a, b2]] : [[a, ob.x0], [ob.x1, b2]]));
                }
                // a sliver beside a pinned card stays empty; that costs a little
                for (const [a, b2] of spans) if (b2 - a < Ht * .7) waste += (b2 - a) / Wt;
                spans = spans.filter(([a, b2]) => b2 - a >= Ht * .7);
                if (!spans.length) { y += Ht * .2; waste += .2; continue; }
                // The widest span sets the band's height: it takes cards while they
                // fit at the target height, then keeps or drops the one that
                // overflows, whichever lands nearer it, and is justified exactly.
                // Narrower spans take as many as fit at that height and spread them.
                // Their cards come first in reading order, so iterate to agree.
                const mainIdx = spans.reduce((m, sp, k) => (sp[1] - sp[0] > spans[m][1] - spans[m][0] ? k : m), 0);
                const sumOf = (k0, k1) => { let q = 0; for (let k = k0; k < k1; k++) q += asp[k]; return q; };
                const fill = (Hb) => {
                    let j = i; const parts = [];
                    spans.forEach(([a, b2], si) => {
                        if (j >= order.length) return;
                        const sw = b2 - a;
                        let n = 0;
                        if (si !== mainIdx) {
                            while (j + n < order.length && Hb * sumOf(j, j + n + 1) + g * n <= sw) n++;
                        } else {
                            let sum = 0;
                            while (j + n < order.length) {
                                const next = sum + asp[j + n], hNext = (sw - g * n) / next;
                                if (hNext < Ht) {
                                    const hPrev = n ? (sw - g * (n - 1)) / sum : Infinity;
                                    if (!n || Math.abs(hNext - Ht) < Math.abs(hPrev - Ht)) n++;
                                    break;
                                }
                                n++; sum = next;
                            }
                            // near the end, share the last cards between this row and the
                            // next so the final row is not two or three giant cards
                            if (j + n < order.length && sumOf(j + n, order.length) * Ht < sw * .8) {
                                const end = order.length, hOf = (k0, k1) => (sw - g * (k1 - k0 - 1)) / sumOf(k0, k1);
                                let bestD = Infinity;
                                for (let k = j + 1; k < end; k++) {
                                    const d = Math.abs(Math.log(hOf(j, k) / Ht)) + Math.abs(Math.log(hOf(k, end) / Ht));
                                    if (d < bestD) { bestD = d; n = k - j; }
                                }
                            }
                        }
                        if (n) parts.push({ a, sw, from: j, n, sum: sumOf(j, j + n), main: si === mainIdx });
                        j += n;
                    });
                    const m = parts.find((p) => p.main);
                    return { parts, j, h: m ? (m.sw - g * (m.n - 1)) / m.sum : Hb };
                };
                let Hb = Ht, F = fill(Hb);
                for (let it = 0; it < 5 && Math.abs(F.h - Hb) > .5; it++) { Hb = Math.min(F.h, Ht * 1.7); F = fill(Hb); }
                if (!F.parts.length) { y += Ht * .2; continue; }
                for (const p of F.parts) {
                    let gap = p.n > 1 ? (p.sw - Hb * p.sum) / (p.n - 1) : 0;
                    let x = p.a;
                    if (p.n === 1 || gap > g * 2.6 || gap < 0) { gap = g; x = p.a + (p.sw - (Hb * p.sum + g * (p.n - 1))) / 2; if (!p.main) bad += .25; }
                    for (let j = 0; j < p.n; j++) {
                        const c = order[p.from + j], w = asp[p.from + j] * Hb;
                        out.push({ c, x: x + w / 2, y: y + Hb / 2, k: Hb / c.h });
                        x += w + gap;
                    }
                }
                i = F.j;
                heights.push(Hb);
                y += Hb + g;
            }
            const h = y - g - top;
            const dev = heights.reduce((s, hh) => s + Math.pow(Math.log(hh / Ht), 2), 0) / heights.length;
            const last = heights.length ? Math.log(heights[heights.length - 1] / Ht) : 0;
            return { out, x0, top, Wt, h, score: dev * 4 + last * last * 6 + Math.abs(Math.log(Wt / h / aspect)) * 1.5 + bad + waste * 1.5 };
        }
        // try a range of widths around the one that matches the window; keep the best
        const W0 = Math.sqrt(natural * (Ht + g) * aspect);
        let best = null;
        for (let f = .62; f <= 1.5; f += .02) for (const sh of pinned.length ? [0, -.5, -.25, .25, .5] : [0]) {
            const L = layout(W0 * f, sh);
            if (L.out.length === order.length && (!best || L.score < best.score)) best = L;
        }
        if (!best) return;
        const items = best.out.map((p) => ({ c: p.c, a: pose(p.c), b: { x: p.x, y: p.y, r: 0, k: p.k } }));
        items.forEach((it, n) => moveTo(it.c, it.b, 700, n * 22, .9));
        raise(items.map((it) => it.c));
        raise(pinned);
        record({ kind: 'move', items, say: 'tidy' });
        say('Tidied into rows, by colour');
        // fit the camera to where everything is going (bounds() reads the targets)
        const tb = bounds();
        glideTo((tb.x0 + tb.x1) / 2, (tb.y0 + tb.y1) / 2 + 6 / cam.z, Math.min(1.15, fitZoom(tb, mx, my)), 1000);
        domOrder(best.out.map((p) => p.c).concat(pinned));
        kick();
    }
    function colourKey(c) {
        // neutrals (black, grey, paper) after the colours, light to dark
        if (c.sat < .07) return 1000 + (1 - c.lum) * 100;
        return (c.hue + 15) % 360;
    }
    const box = (c, pad = 0) => { const hw = c.w * c.k / 2 + pad, hh = c.h * c.k / 2 + pad; return { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh }; };

    // Tab follows reading order (rows of the layout), not the order of the markup.
    function domOrder(list2) {
        if (root.contains(document.activeElement) && document.activeElement !== root) return;
        const vis = (list2 || cards.slice().sort((a, c) => (Math.round(a.y / 160) - Math.round(c.y / 160)) || a.x - c.x));
        const rest = cards.filter((c) => !vis.includes(c));
        for (const c of vis.concat(rest)) list.append(c.li);
    }

    /* ─── Layout: a loose cluster ────────────────────────────────── */

    function cluster(list2, aspect) {
        const placed = [];
        const order = list2.slice().sort((a, c) => c.w * c.h * rnd(.75, 1.25) - a.w * a.h * rnd(.75, 1.25));
        const total = order.reduce((s, c) => s + c.w * c.h, 0) * 1.18;
        const rx = Math.sqrt(total * aspect / Math.PI), ry = rx / aspect;
        const gap = o.size * .035;
        for (const c of order) {
            const tuck = rand() < .34 ? .13 : .02;    // some cards tuck under a neighbour, as on a real board
            let best = null, bestCost = Infinity;
            for (let k = 0; k < 420; k++) {
                const ang = rnd(0, Math.PI * 2), rad = Math.sqrt(rand()) * 1.3;
                const px = Math.cos(ang) * rad * rx, py = Math.sin(ang) * rad * ry;
                let ov = 0;
                for (const p of placed) {
                    const ox = Math.min(px + c.w / 2 + gap, p.x + p.w / 2 + gap) - Math.max(px - c.w / 2 - gap, p.x - p.w / 2 - gap);
                    const oy = Math.min(py + c.h / 2 + gap, p.y + p.h / 2 + gap) - Math.max(py - c.h / 2 - gap, p.y - p.h / 2 - gap);
                    if (ox > 0 && oy > 0) ov = Math.max(ov, ox * oy / Math.min(c.w * c.h, p.w * p.h));
                }
                const cost = rad + Math.max(0, ov - tuck) * 14;
                if (cost < bestCost) { bestCost = cost; best = [px, py]; }
            }
            c.x = best[0]; c.y = best[1];
            const small = c.w * c.h < o.size * o.size * .55;
            c.r = rnd(-1, 1) * (small ? 4.2 : 2.2);
            placed.push(c);
            c.order = placed.length; c.li.style.zIndex = c.order;
        }
        const bb = { x0: Math.min(...placed.map((c) => c.x - c.w / 2)), x1: Math.max(...placed.map((c) => c.x + c.w / 2)), y0: Math.min(...placed.map((c) => c.y - c.h / 2)), y1: Math.max(...placed.map((c) => c.y + c.h / 2)) };
        const mx = (bb.x0 + bb.x1) / 2, my = (bb.y0 + bb.y1) / 2;
        for (const c of placed) { c.x -= mx; c.y -= my; }
        topOrder = placed.length;
    }

    /* ─── Persistence ────────────────────────────────────────────── */

    const storeKey = `moodboard:${o.key}`;
    let saveT = 0;
    function saveSoon() {
        if (!o.persist) return;
        clearTimeout(saveT);
        saveT = setTimeout(save, 450);
    }
    function save() {
        if (anyMoving()) { saveSoon(); return; }
        const data = { v: 1, c: {} };
        for (const c of cards) data.c[c.id] = [Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10, Math.round(c.r * 100) / 100, c.order, c.pinned ? 1 : 0, c.hidden ? 1 : 0, Math.round(c.k * 1000) / 1000];
        try { localStorage.setItem(storeKey, JSON.stringify(data)); } catch { /* private mode, quota: the board still works */ }
    }
    function load() {
        if (!o.persist) return null;
        try {
            const d = JSON.parse(localStorage.getItem(storeKey) || 'null');
            return d && d.v === 1 && d.c ? d.c : null;
        } catch { return null; }
    }

    /* ─── Images: colour and resolution ──────────────────────────── */

    function sample(c) {
        try {
            const cv = document.createElement('canvas'); cv.width = cv.height = 8;
            const g = cv.getContext('2d', { willReadFrequently: true });
            g.drawImage(c.img, 0, 0, 8, 8);
            const d = g.getImageData(0, 0, 8, 8).data;
            let r = 0, gg = 0, bb = 0;
            for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
            const n = d.length / 4;
            c.rgb = [r / n, gg / n, bb / n].map(Math.round);
            // the dominant hue: a circular mean of every cell's hue, weighted by how
            // vivid it is (so a red stamp on white paper still reads as red)
            let X = 0, Y = 0;
            for (let i = 0; i < d.length; i += 4) {
                const [h, s, l] = hsl(d[i], d[i + 1], d[i + 2]);
                const w = s * Math.max(0, 1 - Math.abs(l - .5) * 1.7);
                X += Math.cos(h * DEG) * w; Y += Math.sin(h * DEG) * w;
            }
            c.hue = (Math.atan2(Y, X) / DEG + 360) % 360;
            c.sat = Math.hypot(X, Y) / n;
            c.lum = hsl(...c.rgb)[2];
            // a thumbnail for the minimap, so the map shows the pictures themselves
            const t = document.createElement('canvas');
            const k = 72 / Math.max(c.smW, c.smH);
            t.width = Math.max(1, Math.round(c.smW * k)); t.height = Math.max(1, Math.round(c.smH * k));
            t.getContext('2d').drawImage(c.img, 0, 0, t.width, t.height);
            c.thumb = t;
        } catch { /* a cross-origin image: keep the neutral default */ }
    }
    function hsl(r, g, b2) {
        r /= 255; g /= 255; b2 /= 255;
        const mx = Math.max(r, g, b2), mn = Math.min(r, g, b2), l = (mx + mn) / 2;
        if (mx === mn) return [0, 0, l];
        const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
        const h = mx === r ? (g - b2) / d + (g < b2 ? 6 : 0) : mx === g ? (b2 - r) / d + 2 : (r - g) / d + 4;
        return [h * 60, s, l];
    }
    // Swap the small jpg for the large webp once the card is shown bigger than
    // the jpg can draw sharply (or past 1.5x zoom), and only for cards in view.
    let loading = 0;
    function upgradeImages() {
        if (!live || dead) return;
        const dpr = Math.min(3, devicePixelRatio || 1);
        for (const c of cards) {
            if (loading >= 4) return;
            if (c.hi || c.hidden || c.dead || !c.lg || (c.lgW && c.lgW <= c.smW)) continue;
            const need = c.iw * c.k * cam.z * dpr;
            if (!(cam.z >= 1.5 || need > c.smW * 1.04)) continue;
            const sx = c.x * cam.z + cam.ox, sy = c.y * cam.z + cam.oy, rr = Math.max(c.w, c.h) * c.k * cam.z;
            if (sx + rr < 0 || sy + rr < 0 || sx - rr > W || sy - rr > H) continue;
            c.hi = 1; loading++;
            const im = new Image();
            im.decoding = 'async';
            im.src = c.lg;
            (im.decode ? im.decode() : Promise.resolve()).then(() => {
                if (dead) return;
                c.lgW = im.naturalWidth;
                if (c.lgW > c.smW) c.img.src = c.lg;
                c.hi = 2;
            }).catch(() => { c.hi = 3; }).finally(() => { loading--; upgradeImages(); });
        }
    }

    /* ─── Overlay: selection, hover, guides, marquee ─────────────── */

    let overlayDirty = true, miniDirty = true;
    let guides = null, marq = null;
    const toScreen = ([x, y]) => [x * cam.z + cam.ox, y * cam.z + cam.oy];
    const poly = (c) => corners(c).map(toScreen).map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    function drawOverlay() {
        overlayDirty = false;
        let s = '';
        if (hover && !hover.sel && !hover.hidden && state === 'idle') s += `<polygon class="mb-o-hover" points="${poly(hover)}"/>`;
        const vis = [...sel].filter((c) => !c.hidden);
        for (const c of vis) s += `<polygon class="mb-o-sel" points="${poly(c)}"/>`;
        if (vis.length > 1 && state !== 'marquee') {
            const bb = bounds(vis);
            const [x0, y0] = toScreen([bb.x0, bb.y0]), [x1, y1] = toScreen([bb.x1, bb.y1]);
            s += `<rect class="mb-o-group" x="${x0 - 6}" y="${y0 - 6}" width="${x1 - x0 + 12}" height="${y1 - y0 + 12}"/>`;
        }
        if (guides) {
            for (const g of guides) {
                const [a0, a1] = [toScreen(g.p0), toScreen(g.p1)];
                s += `<line class="mb-o-guide" x1="${a0[0]}" y1="${a0[1]}" x2="${a1[0]}" y2="${a1[1]}"/>`;
                for (const p of g.marks) {
                    const [x, y] = toScreen(p);
                    s += `<path class="mb-o-x" d="M${x - 3} ${y - 3}l6 6M${x + 3} ${y - 3}l-6 6"/>`;
                }
            }
        }
        if (marq) {
            const [x0, y0] = toScreen([Math.min(marq.x0, marq.x1), Math.min(marq.y0, marq.y1)]);
            const [x1, y1] = toScreen([Math.max(marq.x0, marq.x1), Math.max(marq.y0, marq.y1)]);
            s += `<rect class="mb-o-marquee" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>`;
        }
        over.innerHTML = s;
    }

    /* ─── Minimap ────────────────────────────────────────────────── */

    let mm = null, mmFrozen = null, inks = null;
    function drawMini() {
        miniDirty = false;
        if (!o.minimap) return;
        const r = mini.getBoundingClientRect();
        if (!r.width) return;
        const dpr = Math.min(2, devicePixelRatio || 1);
        const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
        if (miniCv.width !== cw || miniCv.height !== ch) { miniCv.width = cw; miniCv.height = ch; }
        const g = miniCv.getContext('2d');
        const bb = bounds();
        const v0 = toWorld(0, 0), v1 = toWorld(W, H);
        let wb = mmFrozen || {
            x0: Math.min(bb.x0, v0.x), y0: Math.min(bb.y0, v0.y), x1: Math.max(bb.x1, v1.x), y1: Math.max(bb.y1, v1.y),
        };
        const pad = .06 * Math.max(wb.x1 - wb.x0, wb.y1 - wb.y0);
        if (!mmFrozen) wb = { x0: wb.x0 - pad, y0: wb.y0 - pad, x1: wb.x1 + pad, y1: wb.y1 + pad };
        const s = Math.min(cw / (wb.x1 - wb.x0), ch / (wb.y1 - wb.y0));
        const ox = (cw - (wb.x1 - wb.x0) * s) / 2 - wb.x0 * s, oy = (ch - (wb.y1 - wb.y0) * s) / 2 - wb.y0 * s;
        mm = { wb, s, ox, oy, dpr };
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, cw, ch);
        if (!inks) { const cs = getComputedStyle(root); inks = ['--mb-card', '--mb-accent', '--mb-brass'].map((v, i) => cs.getPropertyValue(v).trim() || ['#fbf9f4', '#c96f4a', '#b8913f'][i]); }
        const [paper, accent, brass] = inks;
        const ordered = cards.filter((c) => !c.hidden).sort((a, c) => a.order - c.order);
        for (const c of ordered) {
            const m = c.m;
            g.setTransform(m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s + ox, m[5] * s + oy);
            g.fillStyle = paper; g.fillRect(0, 0, c.w, c.h);
            const p = c.pad;
            if (c.thumb) g.drawImage(c.thumb, p, p, c.iw, c.ih);
            else { g.fillStyle = `rgb(${c.rgb})`; g.fillRect(p, p, c.iw, c.ih); }
            if (c.sel) { g.strokeStyle = accent; g.lineWidth = 1.6 * dpr / s; g.strokeRect(0, 0, c.w, c.h); }
        }
        g.setTransform(1, 0, 0, 1, 0, 0);
        for (const c of ordered) {
            if (!c.pinned) continue;
            g.fillStyle = brass;
            g.beginPath(); g.arc(c.x * s + ox, (c.y + (-c.h / 2 + c.pinY) * c.k) * s + oy, 1.6 * dpr, 0, 7); g.fill();
        }
        // the view
        const x0 = v0.x * s + ox, y0 = v0.y * s + oy, x1 = v1.x * s + ox, y1 = v1.y * s + oy;
        g.fillStyle = accent; g.globalAlpha = .08; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.globalAlpha = 1;
        g.strokeStyle = accent; g.lineWidth = 1.25 * dpr;
        g.strokeRect(Math.round(x0) + .5, Math.round(y0) + .5, Math.round(x1 - x0), Math.round(y1 - y0));
    }
    function miniPoint(e) {
        const r = mini.getBoundingClientRect();
        const dpr = mm.dpr;
        return { x: ((e.clientX - r.left) * dpr - mm.ox) / mm.s, y: ((e.clientY - r.top) * dpr - mm.oy) / mm.s };
    }
    let miniDrag = null;
    function onMiniDown(e) {
        if (!mm || e.button > 0) return;
        e.preventDefault(); e.stopPropagation();
        mmFrozen = mm.wb;
        try { mini.setPointerCapture(e.pointerId); } catch { /* fine */ }
        const p = miniPoint(e);
        const c = center();
        const v0 = toWorld(0, 0), v1 = toWorld(W, H);
        const inside = p.x > v0.x && p.x < v1.x && p.y > v0.y && p.y < v1.y;
        // grab the view rectangle where you took it; elsewhere, jump to centre there
        miniDrag = { id: e.pointerId, dx: inside ? c.x - p.x : 0, dy: inside ? c.y - p.y : 0 };
        if (!inside) glideTo(p.x, p.y, cam.z, 300);
        mini.classList.add('is-active');
    }
    function onMiniMove(e) {
        if (!miniDrag || e.pointerId !== miniDrag.id) return;
        const p = miniPoint(e);
        mo.glide = null; mo.vx = mo.vy = 0;
        setCenter(p.x + miniDrag.dx, p.y + miniDrag.dy); applyCam(); kick();
    }
    function onMiniUp(e) {
        if (!miniDrag || e.pointerId !== miniDrag.id) return;
        miniDrag = null; mmFrozen = null; miniDirty = true;
        mini.classList.remove('is-active');
        kick(); setTimeout(settleBounds, 320);
    }

    /* ─── Toast and announcements ────────────────────────────────── */

    let toastT = 0;
    function say(msg) { live$.textContent = ''; requestAnimationFrame(() => { live$.textContent = msg; }); }
    function toastShow(msg, withUndo = false, ms = 2600) {
        toastText.textContent = msg;
        toastBtn.hidden = !withUndo;
        toast.classList.add('is-on');
        clearTimeout(toastT);
        toastT = setTimeout(() => toast.classList.remove('is-on'), ms);
        say(withUndo ? `${msg}. Press Control Z to undo.` : msg);
    }
    let hinted = {};
    function hintOnce(k, msg, ms) { if (hinted[k]) return; hinted[k] = 1; toastShow(msg, false, ms); }

    /* ─── Pointer statechart ─────────────────────────────────────── */

    let state = 'idle';
    const pts = new Map();
    let primary = null, down = null, samples = [], lastClick = null, spaceHeld = false, holdT = 0;
    let isFull = false;

    function send(ev, d) {
        const to = CHART[state][ev];
        if (!to) return false;
        const A = ACT[state];
        if (to !== state && A.exit) A.exit(ev, d);
        if (A[ev]) A[ev](d);
        if (to !== state) {
            state = to; root.dataset.state = to;
            if (ACT[to].enter) ACT[to].enter(ev, d);
            overlayDirty = true; kick();
        }
        return true;
    }
    const local = (e) => { const r = root.getBoundingClientRect(); return { x: e.clientX - r.left - root.clientLeft, y: e.clientY - r.top - root.clientTop }; };
    function velocity() {
        const t = performance.now();
        const s = samples.filter((p) => t - p.t < 90);
        if (s.length < 2) return { x: 0, y: 0 };
        const a = s[0], z = s[s.length - 1], dt = (z.t - a.t) / 1000;
        if (dt < .008) return { x: 0, y: 0 };
        return { x: (z.x - a.x) / dt, y: (z.y - a.y) / dt };
    }
    function pushSample(p) { const t = performance.now(); samples.push({ t, x: p.x, y: p.y }); while (samples.length > 12) samples.shift(); }
    function clickAt(kind, c) {
        const t = performance.now();
        const dbl = lastClick && lastClick.kind === kind && lastClick.c === c && t - lastClick.t < 340 && Math.hypot(down.x - lastClick.x, down.y - lastClick.y) < 14;
        lastClick = dbl ? null : { kind, c, t, x: down.x, y: down.y };
        return dbl;
    }

    let moving = [], from = [], startW = null, snapped = false, lastP = null, pickTilt = 0;
    const ACT = {
        idle: {},
        pressing: {
            enter() {
                const c = down.card;
                if (down.shift) { if (!c.sel) { c.sel = true; select([c], true); down.added = true; } }
                else if (!c.sel) { cards.forEach((q) => { q.sel = false; }); c.sel = true; select([c]); }
                syncSel();
                raise([...sel]);
                pointerFocus(c);
                if (!c.pinned) for (const q of sel) if (!q.pinned) { q.liftT = .55; q.vx = q.vy = 0; }
                kick();
            },
            MOVE_FAR() {},
            UP() {
                const c = down.card;
                for (const q of sel) q.liftT = q === hover ? .14 : 0;
                if (down.shift && c.sel && !down.added) { c.sel = false; deselect(c); syncSel(); }
                else if (!down.shift && sel.size > 1) { cards.forEach((q) => { q.sel = q === c; }); select([c]); }
                if (clickAt('card', c)) zoomTo(c);
                kick();
            },
            CANCEL() { for (const q of sel) q.liftT = 0; kick(); },
        },
        dragging: {
            enter() {
                const g = down.card;
                moving = [...sel].filter((c) => !c.pinned && !c.hidden);
                if (!moving.includes(g)) moving = [g];
                from = moving.map((c) => ({ c, a: pose(c) }));
                startW = toWorld(down.x, down.y);
                // hang from where you hold it: held above its middle it trails, below it leads
                const dx = startW.x - g.x, dy = startW.y - g.y, a = -g.r * DEG;
                const ly = dx * Math.sin(a) + dy * Math.cos(a);
                const f = .35 + .65 * clamp(-ly / (g.h * g.k / 2), -1, 1);
                pickTilt = Math.sign(dx || 1) * (calm.matches ? 0 : 1);
                for (const c of moving) {
                    settle(c);
                    c.held = true; c.anim = null; c.vx = c.vy = 0; c.liftT = 1; c.f = f; c.square = false;
                    c.tiltV += pickTilt * 26;
                    c.li.classList.add('is-held');
                }
                root.classList.add('is-grabbing');
                snapped = false;
                dragMove(lastP);
            },
            MOVE(p) { dragMove(p); },
            exit(ev) {
                let v = velocity();
                const sp = Math.hypot(v.x, v.y);
                if (sp > MAX_THROW) { v.x *= MAX_THROW / sp; v.y *= MAX_THROW / sp; }
                const fling = ev === 'UP' && !calm.matches && sp > 140 && !(snapped && sp < 520);
                for (const c of moving) {
                    c.held = false; c.liftT = c === hover ? .14 : 0;
                    c.li.classList.remove('is-held');
                    if (fling) { c.vx = v.x / cam.z; c.vy = v.y / cam.z; }
                }
                root.classList.remove('is-grabbing');
                guides = null;
                const items = from.map(({ c, a }) => ({ c, a, b: fling ? null : pose(c) }));
                if (items.some((it) => !it.b || Math.hypot(it.b.x - it.a.x, it.b.y - it.a.y) > .5 || it.b.r !== it.a.r)) {
                    record({ kind: 'move', items, say: 'move' });
                    if (fling) items.forEach((it) => pending.add(it));
                }
                moving = []; from = [];
                saveSoon(); kick();
            },
        },
        straining: {
            enter() {
                const c = down.card;
                c.held = true; c.li.classList.add('is-held');
                if (!hinted.pin) hintOnce('pin', 'Pinned. Tap the pin to free it.', 2400);
                ACT.straining.MOVE(lastP);
            },
            MOVE(p) {
                const c = down.card;
                const w = toWorld(p.x, p.y), w0 = toWorld(down.x, down.y);
                // the pull, as an angle about the pin: paper gives a little, then stops
                const arm = Math.max(40, Math.hypot(w0.x - c.x, w0.y - (c.y + (-c.h / 2 + c.pinY) * c.k)));
                const pull = (w.x - w0.x) / arm;
                c.strainT = -clamp(Math.atan(pull) / DEG * .45, -9, 9) * (calm.matches ? .5 : 1);
                kick();
            },
            exit() { const c = down.card; c.held = false; c.strainT = 0; c.li.classList.remove('is-held'); kick(); },
        },
        pointing: {
            enter() {
                clearTimeout(holdT);
                holdT = setTimeout(() => send('HOLD'), 460);
                hold.style.left = `${down.x}px`; hold.style.top = `${down.y}px`;
                hold.classList.remove('is-on'); void hold.offsetWidth; hold.classList.add('is-on');
            },
            exit() { clearTimeout(holdT); hold.classList.remove('is-on'); },
            SWIPE() { hintOnce('two', 'Two fingers to move the board', 2200); },
            UP() {
                if (!down.shift) { cards.forEach((q) => { q.sel = false; }); select([]); }
                if (clickAt('canvas', null)) fitAll();
            },
        },
        panning: {
            enter() { mo.glide = null; mo.zT = 0; mo.vx = mo.vy = 0; samples = []; pushSample(lastP); root.classList.add('is-grabbing'); },
            MOVE(p) {
                const q = samples[samples.length - 1];
                cam.ox += p.x - q.x; cam.oy += p.y - q.y;
                pushSample(p); applyCam(); kick();
            },
            exit(ev) {
                root.classList.remove('is-grabbing');
                const v = velocity();
                if (ev === 'UP' && !calm.matches && Math.hypot(v.x, v.y) > 60) { mo.vx = v.x; mo.vy = v.y; }
                else setTimeout(settleBounds, 60);
                kick();
            },
        },
        marquee: {
            enter() {
                const w = toWorld(down.x, down.y);
                marq = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, base: down.shift ? [...sel] : [] };
                if (!down.shift) { cards.forEach((q) => { q.sel = false; }); select([]); }
                if (down.type === 'touch' && navigator.vibrate) { try { navigator.vibrate(8); } catch { /* fine */ } }
                root.classList.add('is-marquee');
                ACT.marquee.MOVE(lastP);
            },
            MOVE(p) {
                const w = toWorld(p.x, p.y);
                marq.x1 = w.x; marq.y1 = w.y;
                const x0 = Math.min(marq.x0, marq.x1), x1 = Math.max(marq.x0, marq.x1), y0 = Math.min(marq.y0, marq.y1), y1 = Math.max(marq.y0, marq.y1);
                const hit = cards.filter((c) => {
                    if (c.hidden) return false;
                    const bb = bounds([c]);
                    return bb.x0 < x1 && bb.x1 > x0 && bb.y0 < y1 && bb.y1 > y0;
                });
                const all = [...new Set(marq.base.concat(hit))];
                cards.forEach((c) => { c.sel = all.includes(c); });
                select(all);
                overlayDirty = true; kick();
            },
            exit() {
                root.classList.remove('is-marquee');
                marq = null;
                if (sel.size) say(`${sel.size} card${sel.size > 1 ? 's' : ''} selected`);
                const first = [...sel][0];
                if (first) pointerFocus(first);
            },
        },
        pinching: {
            enter() {
                const [a, c] = [...pts.values()];
                const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
                mo.glide = null; mo.zT = 0; mo.vx = mo.vy = 0;
                pinch = { d0: Math.max(10, Math.hypot(a.x - c.x, a.y - c.y)), z0: cam.z, w: toWorld(mid.x, mid.y), mid, lo: zMinF() };
                hinted.two = 1;
            },
            MOVE() {
                const [a, c] = [...pts.values()];
                if (!c) return;
                const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
                let z = pinch.z0 * Math.hypot(a.x - c.x, a.y - c.y) / pinch.d0;
                // past the limits it resists, then springs back on release
                if (z > o.maxZoom) z = o.maxZoom * Math.pow(z / o.maxZoom, .3);
                if (z < pinch.lo) z = pinch.lo * Math.pow(z / pinch.lo, .3);
                cam.z = z; cam.ox = mid.x - pinch.w.x * z; cam.oy = mid.y - pinch.w.y * z;
                pinch.mid = mid;
                applyCam(); kick();
            },
            exit() {
                const z = clamp(cam.z, zMinF(), o.maxZoom);
                if (z !== cam.z) { mo.zT = z; mo.ax = pinch.mid.x; mo.ay = pinch.mid.y; if (calm.matches) { zoomAt(mo.ax, mo.ay, z); mo.zT = 0; applyCam(); } }
                setTimeout(settleBounds, 380);
                kick();
            },
        },
        resting: {},
    };
    let pinch = null;

    function dragMove(p) {
        if (!p) return;
        lastP = p;
        pushSample(p);
        const w = toWorld(p.x, p.y);
        let dx = w.x - startW.x, dy = w.y - startW.y;
        guides = null; snapped = false;
        if (o.snap && !down.alt) {
            const s = snap(dx, dy);
            dx += s.dx; dy += s.dy; guides = s.guides; snapped = s.hit;
        }
        for (const { c, a } of from) { c.x = a.x + dx; c.y = a.y + dy; if (snapped) c.square = true; }
        overlayDirty = true; kick();
    }
    // Align the moving group's edges and centre with any other card's.
    function snap(dx, dy) {
        const mb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
        for (const { c, a } of from) {
            const hw = c.w * c.k / 2, hh = c.h * c.k / 2;
            mb.x0 = Math.min(mb.x0, a.x + dx - hw); mb.x1 = Math.max(mb.x1, a.x + dx + hw);
            mb.y0 = Math.min(mb.y0, a.y + dy - hh); mb.y1 = Math.max(mb.y1, a.y + dy + hh);
        }
        const others = cards.filter((c) => !c.hidden && !moving.includes(c)).map((c) => ({ c, ...box(c) }));
        const th = SNAP_PX / cam.z;
        const axis = (lo, hi, key0, key1) => {
            const mine = [lo, (lo + hi) / 2, hi];
            let best = null;
            for (const q of others) {
                const theirs = [q[key0], (q[key0] + q[key1]) / 2, q[key1]];
                for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
                    // centre to centre, or edge to edge; not centre to edge
                    if ((i === 1) !== (j === 1)) continue;
                    const d = theirs[j] - mine[i];
                    if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d) - 1e-6)) best = { d, v: theirs[j] };
                }
            }
            return best;
        };
        const bx = axis(mb.x0, mb.x1, 'x0', 'x1'), by = axis(mb.y0, mb.y1, 'y0', 'y1');
        const sdx = bx ? bx.d : 0, sdy = by ? by.d : 0;
        const m2 = { x0: mb.x0 + sdx, x1: mb.x1 + sdx, y0: mb.y0 + sdy, y1: mb.y1 + sdy };
        const out = [];
        const near = (a, b2) => Math.abs(a - b2) < .5 / cam.z + 1e-3;
        if (bx) {
            const X = bx.v, ys = [m2.y0, m2.y1], marks = [];
            if ([m2.x0, (m2.x0 + m2.x1) / 2, m2.x1].some((v) => near(v, X))) marks.push([X, m2.y0], [X, m2.y1]);
            for (const q of others) if ([q.x0, (q.x0 + q.x1) / 2, q.x1].some((v) => near(v, X))) { ys.push(q.y0, q.y1); marks.push([X, q.y0], [X, q.y1]); }
            out.push({ p0: [X, Math.min(...ys)], p1: [X, Math.max(...ys)], marks });
        }
        if (by) {
            const Y = by.v, xs = [m2.x0, m2.x1], marks = [];
            if ([m2.y0, (m2.y0 + m2.y1) / 2, m2.y1].some((v) => near(v, Y))) marks.push([m2.x0, Y], [m2.x1, Y]);
            for (const q of others) if ([q.y0, (q.y0 + q.y1) / 2, q.y1].some((v) => near(v, Y))) { xs.push(q.x0, q.x1); marks.push([q.x0, Y], [q.x1, Y]); }
            out.push({ p0: [Math.min(...xs), Y], p1: [Math.max(...xs), Y], marks });
        }
        return { dx: sdx, dy: sdy, guides: out.length ? out : null, hit: !!(bx || by) };
    }

    function syncSel() { for (const c of cards) c.li.setAttribute('aria-selected', c.sel ? 'true' : 'false'); }
    let pointerFocusing = false;
    function pointerFocus(c) { pointerFocusing = true; c.li.focus({ preventScroll: true }); pointerFocusing = false; }

    function onDown(e) {
        if (!live || e.target.closest('.mb-bar, .mb-mini, .mb-full, .mb-toast')) return;
        if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
        const p = local(e);
        pts.set(e.pointerId, { x: p.x, y: p.y, type: e.pointerType });
        try { root.setPointerCapture(e.pointerId); } catch { /* fine */ }
        if (e.pointerType === 'mouse') e.preventDefault();      // no text selection, no focus scroll
        root.classList.remove('is-kbd');
        if (pts.size >= 2) { primary = null; send('SECOND'); return; }
        primary = e.pointerId;
        const li = e.target.closest('.mb-card');
        const card = li && byEl.get(li);
        lastP = p;
        samples = []; pushSample(p);
        down = { x: p.x, y: p.y, t: performance.now(), type: e.pointerType, card, shift: e.shiftKey || e.metaKey || e.ctrlKey, alt: e.altKey };
        mo.vx = mo.vy = 0;
        if (card && e.target.closest('.mb-pin') && (card.pinned || card.sel || e.pointerType === 'mouse')) {
            pts.delete(e.pointerId); primary = null;
            if (!card.sel) { cards.forEach((q) => { q.sel = q === card; }); select([card]); syncSel(); }
            togglePin([card]); pointerFocus(card);
            return;
        }
        if (e.button === 1 || spaceHeld) send('DOWN_PAN');
        else if (card) send('DOWN_CARD');
        else if (down.shift) send('DOWN_MARQUEE');
        else send('DOWN_CANVAS');
    }
    function onMove(e) {
        const p = local(e);
        if (!pts.has(e.pointerId)) {
            if (e.pointerType === 'mouse' && state === 'idle') hoverAt(e);
            return;
        }
        pts.set(e.pointerId, { ...pts.get(e.pointerId), x: p.x, y: p.y });
        if (state === 'pinching') { send('MOVE'); return; }
        if (e.pointerId !== primary) return;
        lastP = p;
        const dist = Math.hypot(p.x - down.x, p.y - down.y);
        const slop = down.type === 'mouse' ? 3 : 7;
        if (state === 'pressing') {
            pushSample(p);
            if (dist > slop) send(down.card.pinned ? 'PULL_PINNED' : 'MOVE_FAR', p);
            return;
        }
        if (state === 'pointing') {
            if (dist <= slop) return;
            // in the page a vertical swipe on paper belongs to the page (the browser
            // takes it); a sideways one gets the two-finger hint
            if (down.type === 'touch' && !isFull) { if (Math.abs(p.x - down.x) > Math.abs(p.y - down.y) * 1.2) send('SWIPE'); }
            else send('MOVE_FAR', p);
            return;
        }
        send('MOVE', p);
    }
    function onUp(e) {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        if (state === 'pinching' || state === 'resting') { send('LIFT'); if (!pts.size) primary = null; return; }
        if (e.pointerId !== primary) return;
        primary = null;
        send(e.type === 'pointercancel' ? 'CANCEL' : 'UP', lastP);
    }
    function hoverAt(e) {
        const li = e.target.closest && e.target.closest('.mb-card');
        const c = li ? byEl.get(li) : null;
        if (c === hover) return;
        if (hover && !hover.held) hover.liftT = 0;
        hover = c;
        if (c && !c.held && !c.pinned) c.liftT = .14;
        overlayDirty = true; kick();
    }

    // In the page, a touch on paper may scroll the page; once the board owns a
    // gesture (two fingers, a card, a marquee, full screen) the page keeps still.
    function onTouchMove(e) {
        if (isFull || e.touches.length > 1 || (state !== 'idle' && state !== 'pointing')) { if (e.cancelable) e.preventDefault(); }
    }
    function onTouchStart(e) { if (e.touches.length > 1 && e.cancelable) e.preventDefault(); }

    let lastPageScroll = -1e9, wheelT = 0;
    function onWheel(e) {
        if (!live) return;
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? H : 1;
        let dx = e.deltaX * scale, dy = e.deltaY * scale;
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const p = local(e);
            mo.glide = null; mo.vx = mo.vy = 0;
            const f = Math.exp(-dy * (Math.abs(dy) < 50 ? .0105 : .0022));
            if (Math.abs(dy) < 50 || calm.matches) {        // a trackpad pinch: direct
                mo.zT = 0;
                let z = cam.z * f;
                z = clamp(z, zMinF() * .85, o.maxZoom * 1.08);
                zoomAt(p.x, p.y, z); applyCam();
                clearTimeout(wheelT); wheelT = setTimeout(() => { const zc = clamp(cam.z, zMinF(), o.maxZoom); if (zc !== cam.z) zoomBy(zc / cam.z, p.x, p.y); else settleBounds(); }, 160);
            } else zoomBy(f, p.x, p.y);
            kick();
            return;
        }
        if (o.wheel === 'page' && !isFull) return;
        // a page scroll that is already under way passes over the board
        if (!isFull && performance.now() - lastPageScroll < 420) return;
        e.preventDefault();
        if (e.shiftKey && !dx) { dx = dy; dy = 0; }
        mo.glide = null; mo.zT = 0; mo.vx = mo.vy = 0;
        cam.ox -= dx; cam.oy -= dy; applyCam(); kick();
        clearTimeout(wheelT); wheelT = setTimeout(settleBounds, 220);
    }

    /* ─── Keyboard ───────────────────────────────────────────────── */

    let nudge = null;
    function onKey(e) {
        if (!live) return;
        if (e.key === 'Tab' || e.key.startsWith('Arrow') || e.key === 'Enter') root.classList.add('is-kbd');
        const mod = e.metaKey || e.ctrlKey;
        const k = e.key;
        const onCard = e.target.classList && e.target.classList.contains('mb-card');
        const onButton = e.target.closest && e.target.closest('button');
        if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
        if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); redo(); return; }
        if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); const all = cards.filter((c) => !c.hidden); all.forEach((c) => { c.sel = true; }); select(all); syncSel(); say(`All ${all.length} cards selected`); return; }
        if (mod) return;
        if (k === ' ' && !onButton) { e.preventDefault(); if (!spaceHeld) { spaceHeld = true; root.classList.add('is-space'); } return; }
        if (k === '+' || k === '=') { e.preventDefault(); zoomBy(1.5); return; }
        if (k === '-' || k === '_') { e.preventDefault(); zoomBy(1 / 1.5); return; }
        if (k === '0' && !onButton) { e.preventDefault(); zoomBy(1 / cam.z); return; }
        if (k === '1' || k === '!') { e.preventDefault(); fitAll(); return; }
        if (k === 'Escape') {
            if (sel.size) { cards.forEach((c) => { c.sel = false; }); select([]); syncSel(); e.preventDefault(); return; }
            if (isFull) { setFull(false); e.preventDefault(); }
            return;
        }
        // on a card: that card (and the selection it belongs to); on the board: the selection
        const c = onCard ? byEl.get(e.target) : [...sel].filter((q) => !q.hidden).pop();
        if (!c) return;
        if (onCard && !c.sel) select([c]);
        const targets = [...sel].filter((q) => !q.hidden);
        if (onButton && !onCard) return;
        if (k.startsWith('Arrow')) {
            e.preventDefault();
            const step = e.shiftKey ? 48 : 8;
            const dx = k === 'ArrowLeft' ? -step : k === 'ArrowRight' ? step : 0;
            const dy = k === 'ArrowUp' ? -step : k === 'ArrowDown' ? step : 0;
            const movers = targets.filter((q) => !q.pinned);
            if (!movers.length) { say('Pinned. Press P to unpin.'); for (const q of targets) q.strainV += (dx ? -Math.sign(dx) : 0) * 60; kick(); return; }
            const t = performance.now();
            if (!nudge || t - nudge.t > 900 || nudge.entry !== undos[undos.length - 1]) {
                nudge = { t, entry: { kind: 'move', items: movers.map((q) => ({ c: q, a: pose(q), b: null })), say: 'nudge' } };
                record(nudge.entry);
            }
            nudge.t = t;
            for (const q of movers) {
                if (q.anim) finishAnim(q);
                settle(q);
                q.x += dx; q.y += dy; q.vx = q.vy = 0;
                if (!calm.matches) q.tiltV += dx * 7;     // a little sway, as if pushed
            }
            for (const it of nudge.entry.items) it.b = pose(it.c);
            ensureVisible(c); saveSoon(); kick();
        } else if (k === 'Enter') { e.preventDefault(); zoomTo(c); }
        else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); hide(targets); }
        else if (k === 'p' || k === 'P') { e.preventDefault(); togglePin(targets); }
    }
    function onKeyUp(e) { if (e.key === ' ' && spaceHeld) { spaceHeld = false; root.classList.remove('is-space'); } }
    function ensureVisible(c) {
        const bb = bounds([c]);
        const [x0, y0] = toScreen([bb.x0, bb.y0]), [x1, y1] = toScreen([bb.x1, bb.y1]);
        const m = 16;
        if (x0 < m || y0 < m || x1 > W - m || y1 > H - 60) {
            const z = Math.max(cam.z, Math.min(.5, fitZoom(bb, 40, 70)));
            glideTo(c.x, c.y, Math.min(z, fitZoom(bb, 30, 60)), 520);
        }
    }
    function onFocusIn(e) {
        const c = byEl.get(e.target);
        if (!c || pointerFocusing || state !== 'idle') return;
        root.classList.add('is-kbd');
        if (!c.sel) { cards.forEach((q) => { q.sel = q === c; }); select([c]); syncSel(); }
        ensureVisible(c);
    }

    /* ─── Full screen ────────────────────────────────────────────── */

    let prevOverflow = '';
    function setFull(v) {
        if (v === isFull) return;
        const c = center();
        isFull = v;
        root.classList.toggle('is-full', v);
        full.setAttribute('aria-pressed', String(v));
        full.setAttribute('aria-label', v ? 'Exit full screen' : 'Full screen');
        full.title = full.getAttribute('aria-label');
        full.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[v ? 'shrink' : 'full']}</svg>`;
        if (v) { prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'; }
        else document.documentElement.style.overflow = prevOverflow;
        measure(c);
        if (v && coarse.matches) hintOnce('full', 'One finger moves the board now', 1800);
        root.focus({ preventScroll: true });
    }

    /* ─── Toolbar ────────────────────────────────────────────────── */

    function syncBar() {
        b.undo.disabled = !undos.length;
        b.redo.disabled = !redos.length;
        const n = cards.filter((c) => c.hidden).length;
        b.restore.hidden = !n;
        b.restore.setAttribute('aria-label', `Show ${n} hidden card${n === 1 ? '' : 's'}`);
        b.restore.title = b.restore.getAttribute('aria-label');
        b.restore.dataset.n = n;
    }
    const click = (bt, f) => on(bt, 'click', (e) => { e.preventDefault(); f(); });
    click(b.undo, undo); click(b.redo, redo); click(b.tidy, tidy);
    click(b.in, () => zoomBy(1.5)); click(b.out, () => zoomBy(1 / 1.5));
    click(b.pct, () => zoomBy(1 / cam.z)); click(b.fit, () => fitAll());
    click(b.restore, restoreHidden);
    click(full, () => setFull(!isFull));
    click(toastBtn, () => { undo(); toast.classList.remove('is-on'); });

    /* ─── The loop ───────────────────────────────────────────────── */

    function spring(c, k, target, stiff, ratio, dt) {
        const v = k + 'V';
        const damp = 2 * Math.sqrt(stiff) * ratio;
        c[v] += (-stiff * (c[k] - target) - damp * c[v]) * dt;
        c[k] += c[v] * dt;
        if (Math.abs(c[k] - target) < 1e-3 && Math.abs(c[v]) < 1e-2) { c[k] = target; c[v] = 0; return false; }
        return true;
    }
    const anyMoving = () => cards.some((c) => c.anim || c.vx || c.vy || c.held);

    function kick() { if (!raf && live && !dead && visible) { last = 0; raf = requestAnimationFrame(tick); } }
    function tick(t) {
        raf = 0;
        if (dead) return;
        const dt = last ? Math.min(.05, (t - last) / 1000) : 1 / 60;
        last = t;
        let busy = false;

        // camera
        if (mo.glide) {
            const g = mo.glide, p = clamp((t - g.t0) / g.dur), e = ease.inOut(p);
            const lz = lerp(Math.log(g.z0), Math.log(g.z), e);
            setCenter(lerp(g.c0.x, g.cx, e), lerp(g.c0.y, g.cy, e), Math.exp(lz));
            applyCam();
            if (p >= 1) mo.glide = null; else busy = true;
        } else if (mo.zT) {
            const lz = Math.log(cam.z), lt = Math.log(mo.zT);
            const nz = Math.exp(lz + (lt - lz) * (1 - Math.exp(-dt * 16)));
            if (Math.abs(lt - lz) < .002) { zoomAt(mo.ax, mo.ay, mo.zT); mo.zT = 0; setTimeout(settleBounds, 30); }
            else { zoomAt(mo.ax, mo.ay, nz); busy = true; }
            applyCam();
        }
        if (mo.vx || mo.vy) {
            cam.ox += mo.vx * dt; cam.oy += mo.vy * dt;
            const d = Math.exp(-dt * 4.2);
            mo.vx *= d; mo.vy *= d;
            if (Math.hypot(mo.vx, mo.vy) < 8) { mo.vx = mo.vy = 0; settleBounds(); } else busy = true;
            applyCam();
        }
        // auto-pan while dragging or selecting near the window's edge
        if ((state === 'dragging' || state === 'marquee') && lastP) {
            const m = 30, sp = 620 * dt;
            const ex = lastP.x < m ? (m - lastP.x) / m : lastP.x > W - m ? -(lastP.x - W + m) / m : 0;
            const ey = lastP.y < m ? (m - lastP.y) / m : lastP.y > H - m ? -(lastP.y - H + m) / m : 0;
            if (ex || ey) {
                cam.ox += ex * sp; cam.oy += ey * sp; applyCam();
                if (state === 'dragging') dragMove(lastP); else ACT.marquee.MOVE(lastP);
                busy = true;
            }
        }

        // cards
        const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
        const vel = state === 'dragging' ? velocity() : null;
        for (const c of cards) {
            if (c.dead) continue;
            let act = false;
            if (c.anim) {
                const a = c.anim;
                const p = clamp((t - a.t0 - a.delay) / a.dur);
                const e = a.e(p);
                c.x = lerp(a.fx, a.tx, e); c.y = lerp(a.fy, a.ty, e); c.r = lerp(a.fr, a.tr, e); c.k = Math.exp(lerp(Math.log(a.fk), Math.log(a.tk), e));
                c.lift = Math.max(c.liftT, a.arc * Math.sin(Math.PI * Math.min(1, p * 1.08)) + a.land * (1 - e));
                c.liftV = 0;
                if (p >= 1) { c.anim = null; c.lift = c.liftT; } else act = true;
            } else if (!c.held && (c.vx || c.vy)) {
                c.x += c.vx * dt; c.y += c.vy * dt;
                const d = Math.exp(-dt * FRICTION);
                c.vx *= d; c.vy *= d;
                if (Math.hypot(c.vx, c.vy) * cam.z < 6) { c.vx = c.vy = 0; settle(c); saveSoon(); }
                else act = true;
            }
            if (c.held && c.square && Math.abs(c.r) > .01) { c.r *= Math.exp(-dt * 16); act = true; }
            else if (c.held && c.square) c.r = 0;
            // the swing: a spring chasing sideways speed
            let tt = 0;
            if (!calm.matches) {
                if (c.held && vel && moving.includes(c)) tt = clamp(vel.x * TILT_PER_SPEED * c.f, -MAX_TILT, MAX_TILT);
                else if (c.vx) tt = clamp(c.vx * cam.z * TILT_PER_SPEED * c.f, -MAX_TILT, MAX_TILT);
            }
            for (let s = 0; s < steps; s++) {
                if (calm.matches) { c.tilt = 0; c.tiltV = 0; c.lift = c.anim ? c.lift : c.liftT; c.strain = c.strainT; c.strainV = 0; break; }
                act = spring(c, 'tilt', tt, 140, .62, h) | act;
                if (!c.anim) act = spring(c, 'lift', c.liftT, 300, .9, h) | act;
                act = spring(c, 'strain', c.strainT, 110, .38, h) | act;
            }
            if (c.held) act = true;
            draw(c);
            busy = busy || act;
        }

        if (overlayDirty) drawOverlay();
        if (miniDirty && o.minimap) drawMini();
        if (busy || state === 'dragging' || state === 'straining') kick();
    }

    /* ─── Measure and start ──────────────────────────────────────── */

    function measure(keep) {
        const c = keep || (live ? center() : null);
        W = root.clientWidth || 1; H = root.clientHeight || 1;
        const bb = bounds();
        const [mx, my] = margins();
                if (c) { setCenter(c.x, c.y); applyCam(); }
        miniDirty = overlayDirty = true; kick();
    }

    const ro = new ResizeObserver(() => { inks = null; if (live) measure(); });
    let io = null;
    let dealt = false;
    function deal() {
        if (dealt) return;
        dealt = true;
        const t0 = performance.now();
        for (const c of cards) if (c.anim) { c.anim.t0 = t0; }
        kick();
    }

    (async () => {
        // Cards with width/height attributes are laid out at once; the rest wait
        // for their image (at most 4s). A picture that fails is left out.
        const dims = (c) => (c.img.naturalWidth ? [c.img.naturalWidth, c.img.naturalHeight] : [+c.img.getAttribute('width'), +c.img.getAttribute('height')]);
        const loaded = (c) => (c.img.complete && c.img.naturalWidth ? Promise.resolve() : new Promise((res) => {
            c.img.addEventListener('load', res, { once: true }); c.img.addEventListener('error', res, { once: true });
        }));
        await Promise.race([
            Promise.all(cards.filter((c) => !(dims(c)[0] > 0)).map(loaded)),
            new Promise((res) => setTimeout(res, 4000)),
        ]);
        if (dead) return;
        const broken = (c) => (c.img.complete && !c.img.naturalWidth) || !(dims(c)[0] > 0);
        const usable = cards.filter((c) => !broken(c));
        cards.filter((c) => !usable.includes(c)).forEach((c) => { c.hidden = true; c.li.hidden = true; c.dead = true; });
        if (!usable.length) return;
        // colour is read once each picture is in; a late failure takes the card off the board
        for (const c of usable) {
            loaded(c).then(() => {
                if (dead) return;
                if (!c.img.naturalWidth) { setHidden(c, true); c.dead = true; return; }
                sample(c); miniDirty = true; kick();
            });
        }

        // build
        root.classList.add('is-live');
        root.prepend(grid);
        world.append(list);
        root.append(world, over, hold, bar, toast, full, live$, help);
        if (o.minimap) root.append(mini);
        if (!root.hasAttribute('tabindex')) root.tabIndex = -1;
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-multiselectable', 'true');
        list.setAttribute('aria-label', root.getAttribute('aria-label') || 'Moodboard');
        list.setAttribute('aria-describedby', help.id);
        W = root.clientWidth || 1; H = root.clientHeight || 1;

        for (const c of usable) {
            [c.smW, c.smH] = dims(c);
            const asp = c.smW / c.smH;
            const s = o.size * c.size;
            c.iw = Math.round(s * Math.sqrt(asp)); c.ih = Math.round(s / Math.sqrt(asp));
            c.pad = Math.round(clamp(s * .052, 6, 16));
            const lab = c.label ? Math.round(o.size * .17) : 0;
            c.w = c.iw + 2 * c.pad; c.h = c.ih + 2 * c.pad + lab;
            c.pinY = Math.round(c.pad * .5 + 2);
            const li = c.li;
            li.classList.add('mb-card');
            li.tabIndex = 0;
            li.setAttribute('role', 'option');
            li.setAttribute('aria-roledescription', 'card');
            li.setAttribute('aria-selected', 'false');
            li.style.width = `${c.w}px`; li.style.height = `${c.h}px`;
            li.style.setProperty('--pad', `${c.pad}px`);
            li.style.setProperty('--lab', `${lab}px`);
            li.style.setProperty('--hand', `${Math.round(o.size * .115)}px`);
            c.img.draggable = false;
            c.img.style.width = `${c.iw}px`; c.img.style.height = `${c.ih}px`;
            if (c.label && !li.querySelector('.mb-label')) { const l = el('span', 'mb-label'); l.textContent = c.label; l.setAttribute('aria-hidden', 'true'); li.append(l); c.labelEl = l; }
            const pin = el('span', 'mb-pin', '<i class="mb-pin-shadow"></i><i class="mb-pin-head"></i>');
            pin.setAttribute('aria-hidden', 'true');
            li.append(pin); c.pinEl = pin;
            li.classList.toggle('is-pinned', c.pinned);
            li.setAttribute('aria-label', name(c));
        }

        const saved = load();
        const known = saved ? usable.filter((c) => saved[c.id]) : [];
        cluster(usable, clamp(W / H, .7, 1.9));          // everyone gets a place; saved cards then take theirs
        if (known.length) {
            for (const c of known) {
                const [x, y, r, ord, pin, hid, k] = saved[c.id];
                c.x = x; c.y = y; c.r = r; c.k = clamp(+k || 1, .2, 5); c.order = ord; c.pinned = !!pin;
                c.li.classList.toggle('is-pinned', c.pinned);
                c.li.setAttribute('aria-label', name(c));
                if (hid) { c.hidden = true; c.li.hidden = true; c.li.classList.add('is-gone'); }
            }
            // new cards (not in the saved board) go beside it
            const fresh = usable.filter((c) => !saved[c.id]);
            if (fresh.length) {
                const bb = bounds(known);
                fresh.forEach((c, k) => { c.x = bb.x1 + o.size * .4 + c.w / 2 + (k % 3) * o.size * 1.2; c.y = bb.y0 + c.h / 2 + Math.floor(k / 3) * o.size * 1.2; });
            }
            topOrder = Math.max(...usable.map((c) => c.order));
            for (const c of usable) c.li.style.zIndex = c.order;
        }
        for (const c of usable) { c.m = matrix(c, true); }
        domOrder();
        syncBar();

        // camera: fit everything
        const bb = bounds();
        const [mx, my] = margins();
        const z = Math.min(1.15, fitZoom(bb, mx, my));
        setCenter((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2 + (W < 560 ? 4 : 6) / z, z);
        applyCam();

        // the deal: a pile in the middle, then each card to its place
        if (o.deal && !calm.matches) {
            const cx = (bb.x0 + bb.x1) / 2, cy = (bb.y0 + bb.y1) / 2;
            const seq = usable.filter((c) => !c.hidden).sort((a, c) => a.order - c.order);
            seq.forEach((c, k) => {
                c.anim = { fx: cx + rnd(-10, 10), fy: cy + rnd(-8, 8), fr: rnd(-9, 9), fk: c.k, tx: c.x, ty: c.y, tr: c.r, tk: c.k, t0: Infinity, delay: k * 34, dur: 900, arc: .25, land: .7, e: ease.outQuart };
                c.x = c.anim.fx; c.y = c.anim.fy; c.r = c.anim.fr; c.lift = .7;
            });
        } else dealt = true;
        for (const c of usable) draw(c);

        live = true;
        on(root, 'pointerdown', onDown);
        on(root, 'pointermove', onMove);
        on(root, 'pointerup', onUp);
        on(root, 'pointercancel', onUp);
        on(root, 'lostpointercapture', (e) => { if (pts.has(e.pointerId) && e.pointerType !== 'mouse') onUp({ pointerId: e.pointerId, type: 'pointercancel' }); });
        on(root, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && !pts.size) { if (hover && !hover.held) hover.liftT = 0; hover = null; overlayDirty = true; kick(); } });
        on(root, 'wheel', onWheel, { passive: false });
        on(root, 'touchstart', onTouchStart, { passive: false });
        on(root, 'touchmove', onTouchMove, { passive: false });
        on(root, 'contextmenu', (e) => { if (!e.target.closest('.mb-bar, .mb-toast')) e.preventDefault(); });
        on(root, 'keydown', onKey);
        on(root, 'keyup', onKeyUp);
        on(root, 'focusin', onFocusIn);
        on(root, 'scroll', () => { root.scrollTop = 0; root.scrollLeft = 0; });
        on(root, 'dragstart', (e) => e.preventDefault());
        on(window, 'scroll', () => { lastPageScroll = performance.now(); }, { passive: true });
        on(window, 'blur', () => { spaceHeld = false; root.classList.remove('is-space'); });
        on(mini, 'pointerdown', onMiniDown);
        on(mini, 'pointermove', onMiniMove);
        on(mini, 'pointerup', onMiniUp);
        on(mini, 'pointercancel', onMiniUp);
        on(document, 'visibilitychange', () => { if (!document.hidden) kick(); });
        ro.observe(root);
        if ('IntersectionObserver' in window) {
            io = new IntersectionObserver((en) => {
                const e = en[en.length - 1];
                visible = e.isIntersecting;
                if (visible) { if (e.intersectionRatio > .3 || (e.intersectionRect.height > innerHeight * .3)) deal(); kick(); }
            }, { threshold: [0, .3, .6] });
            io.observe(root);
        } else deal();
        setTimeout(() => { if (!dealt && visible) deal(); }, 2500);
        kick();
        root.dispatchEvent(new CustomEvent('moodboard:ready', { bubbles: true }));
    })();

    function name(c) {
        const a = c.img.getAttribute('alt') || 'Image';
        return `${a}${c.label ? `, “${c.label}”` : ''}${c.pinned ? ', pinned' : ''}`;
    }

    function destroy() {
        dead = true; live = false;
        cancelAnimationFrame(raf);
        clearTimeout(saveT); clearTimeout(toastT); clearTimeout(holdT); clearTimeout(compT); clearTimeout(wheelT);
        off.forEach((f) => f());
        ro.disconnect(); if (io) io.disconnect();
        if (isFull) document.documentElement.style.overflow = prevOverflow;
        for (const c of cards) {
            c.img.src = c.src; c.img.removeAttribute('style'); c.img.removeAttribute('draggable');
            if (c.labelEl) c.labelEl.remove();
            if (c.pinEl) c.pinEl.remove();
            c.li.hidden = false;
            c.li.removeAttribute('style'); c.li.removeAttribute('tabindex'); c.li.removeAttribute('role');
            c.li.removeAttribute('aria-roledescription'); c.li.removeAttribute('aria-selected'); c.li.removeAttribute('aria-label');
            c.li.classList.remove('mb-card', 'is-pinned', 'is-pinning', 'is-unpinning', 'is-gone', 'is-held');
        }
        ['role', 'aria-multiselectable', 'aria-label', 'aria-describedby'].forEach((a) => list.removeAttribute(a));
        root.append(list);
        [grid, world, over, hold, bar, toast, full, live$, help, mini].forEach((e) => e.remove());
        root.classList.remove('is-live', 'is-full', 'has-sel', 'is-grabbing', 'is-space', 'is-marquee');
        root.removeAttribute('data-state');
        root.style.removeProperty('--mb-z');
        delete root.__mb;
    }
    destroy.undo = undo;
    destroy.redo = redo;
    destroy.tidy = tidy;
    destroy.fit = () => fitAll();
    destroy.full = setFull;
    destroy.reset = () => { try { localStorage.removeItem(storeKey); } catch { /* fine */ } };
    destroy.select = (ids) => { const l = cards.filter((c) => ids.includes(c.id)); cards.forEach((c) => { c.sel = l.includes(c); }); select(l); syncSel(); };
    destroy.zoomTo = (cid) => { const c = cards.find((q) => q.id === cid); if (c) zoomTo(c); };
    Object.defineProperty(destroy, 'state', { get: () => state });
    Object.defineProperty(destroy, 'camera', { get: () => ({ ...cam }) });
    destroy.cards = cards;
    root.__mb = destroy;
    return destroy;
}

// Auto-start every [data-moodboard] once it is near the viewport.
function autoStart(root) {
    if (!('IntersectionObserver' in window)) { moodboard(root); return; }
    const io = new IntersectionObserver((en) => {
        if (!en.some((e) => e.isIntersecting)) return;
        io.disconnect();
        moodboard(root);
    }, { rootMargin: '600px' });
    io.observe(root);
}
document.querySelectorAll('[data-moodboard]').forEach(autoStart);
