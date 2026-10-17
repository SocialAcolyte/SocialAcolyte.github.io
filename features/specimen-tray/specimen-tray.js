/*
 *  SPECIMEN-TRAY // a naturalist's drawer of shells and coins you can handle.
 *
 *  Markup:  <section data-specimen-tray data-label="IV">
 *             <div class="sp-stage">
 *               <ul class="sp-tray" aria-label="A drawer of shells and coins">
 *                 <li data-no="1147"><img src="assets/cone.webp" alt="A cone shell"></li>
 *                 <li data-no="0212" data-weight="3" data-back="assets/coin-rev.webp">
 *                   <img src="assets/coin.webp" alt="A silver coin"></li>
 *               </ul>
 *             </div>
 *           </section>
 *  Or call  specimenTray(element, options)  yourself. Returns destroy().
 *
 *  Scrolling into the section pulls the drawer out from under a shelf edge. It
 *  has mass: a spring carries it toward the scroll position and it stops hard
 *  against its runners, and that stop is what makes the objects shiver and the
 *  tags swing (each one keeps the drawer's speed for an instant, then the felt
 *  takes it back).
 *
 *  The objects are 2D rigid bodies. Each outline is the convex hull of the
 *  image's own alpha, read once from a small canvas, so any cut-out works.
 *  Contacts come from SAT with edge clipping and are solved with sequential
 *  impulses; the lining is Coulomb friction, so a thrown shell slides, turns
 *  and stops dead rather than drifting like a puck on ice. A drag is a soft
 *  spring at the point you grabbed, so a coin caught by its rim swings round to
 *  trail the finger and leaves with the spin it had.
 *
 *  Every object has a paper tag drawn by rough.js (Preet Shihn, MIT, vendored)
 *  with its catalogue number in a hand, tied on by a short verlet thread. The
 *  tags weigh nothing and drag behind.
 *
 *  Each <img> becomes a <button>: Tab reaches it, arrows nudge it (Shift for a
 *  push), Enter or Space turns it over. Reduced motion: the drawer is open,
 *  nothing moves on its own, and a drag still works but stops where you let go.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
let rand = Math.random;
const rnd = (a, b) => a + rand() * (b - a);
// data-seed gives the same arrangement every load (handy for tests and stills)
const seeded = (n) => () => { n = (n + 0x6d2b79f5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const NS = 'http://www.w3.org/2000/svg';
const H = 1 / 180;                       // physics step, seconds
let uid = 0;

/* ─── Outline from alpha ─────────────────────────────────────────── */

function cross3(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }

function convexHull(pts) {
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const lo = [], up = [];
    for (const p of pts) {
        while (lo.length >= 2 && cross3(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
        lo.push(p);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i];
        while (up.length >= 2 && cross3(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop();
        up.push(p);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Drop the vertex that encloses the least area until few enough remain.
function simplify(poly, max) {
    const v = poly.slice();
    while (v.length > max) {
        let best = 0, area = Infinity;
        for (let i = 0; i < v.length; i++) {
            const a = Math.abs(cross3(v[(i + v.length - 1) % v.length], v[i], v[(i + 1) % v.length]));
            if (a < area) { area = a; best = i; }
        }
        v.splice(best, 1);
    }
    return v;
}

// Hull in 0..1 image units, or an ellipse if the pixels can't be read.
function outline(img) {
    const n = 120;
    const ar = img.naturalWidth / img.naturalHeight || 1;
    const cw = ar >= 1 ? n : Math.max(8, Math.round(n * ar));
    const ch = ar >= 1 ? Math.max(8, Math.round(n / ar)) : n;
    try {
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, cw, ch);
        const d = g.getImageData(0, 0, cw, ch).data;
        const pts = [];
        for (let y = 0; y < ch; y++) {
            let x0 = -1, x1 = -1;
            for (let x = 0; x < cw; x++) if (d[(y * cw + x) * 4 + 3] > 110) { if (x0 < 0) x0 = x; x1 = x; }
            if (x0 >= 0) pts.push([x0, y], [x0, y + 1], [x1 + 1, y], [x1 + 1, y + 1]);
        }
        if (pts.length < 12) throw 0;
        return simplify(convexHull(pts), 18).map(([x, y]) => [x / cw, y / ch]);
    } catch (e) {
        const out = [];
        for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            out.push([.5 + Math.cos(a) * .49, .5 + Math.sin(a) * .49]);
        }
        return out;
    }
}

// Area, centroid and second moment (per unit density) of a polygon.
function polyProps(v) {
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < v.length; i++) {
        const [x0, y0] = v[i], [x1, y1] = v[(i + 1) % v.length];
        const c = x0 * y1 - x1 * y0;
        A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
    }
    A /= 2; cx /= 6 * A; cy /= 6 * A;
    let I = 0;
    for (let i = 0; i < v.length; i++) {
        const x0 = v[i][0] - cx, y0 = v[i][1] - cy;
        const x1 = v[(i + 1) % v.length][0] - cx, y1 = v[(i + 1) % v.length][1] - cy;
        const c = x0 * y1 - x1 * y0;
        I += c * (x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1);
    }
    return { A: Math.abs(A), cx, cy, I: Math.abs(I / 12), ccw: A > 0 };
}

/* ─── Contacts ───────────────────────────────────────────────────── */

function maxSeparation(A, B) {
    let best = -Infinity, edge = 0;
    for (let i = 0; i < A.n; i++) {
        const nx = A.nx[i], ny = A.ny[i], vx = A.wx[i], vy = A.wy[i];
        let s = Infinity;
        for (let j = 0; j < B.n; j++) {
            const d = nx * (B.wx[j] - vx) + ny * (B.wy[j] - vy);
            if (d < s) s = d;
        }
        if (s > best) { best = s; edge = i; }
    }
    return [best, edge];
}

// Two convex polygons -> up to two contact points, normal pointing A to B.
function collide(A, B, out) {
    const [sA, eA] = maxSeparation(A, B);
    if (sA > .5) return;
    const [sB, eB] = maxSeparation(B, A);
    if (sB > .5) return;
    let R = A, I = B, e = eA, flip = false;
    if (sB > sA + .05) { R = B; I = A; e = eB; flip = true; }
    const nx = R.nx[e], ny = R.ny[e];
    const i2 = (e + 1) % R.n;
    const v1x = R.wx[e], v1y = R.wy[e], v2x = R.wx[i2], v2y = R.wy[i2];
    // incident edge: the one facing the reference normal most
    let k = 0, kd = Infinity;
    for (let j = 0; j < I.n; j++) {
        const d = I.nx[j] * nx + I.ny[j] * ny;
        if (d < kd) { kd = d; k = j; }
    }
    const k2 = (k + 1) % I.n;
    let pts = [[I.wx[k], I.wy[k]], [I.wx[k2], I.wy[k2]]];
    const tx = v2x - v1x, ty = v2y - v1y, tl = Math.hypot(tx, ty) || 1;
    const ux = tx / tl, uy = ty / tl;
    pts = clipSeg(pts, -ux, -uy, -(ux * v1x + uy * v1y));
    if (pts.length < 2) return;
    pts = clipSeg(pts, ux, uy, ux * v2x + uy * v2y);
    if (pts.length < 2) return;
    const Nx = flip ? -nx : nx, Ny = flip ? -ny : ny;
    for (const [px, py] of pts) {
        const sep = nx * (px - v1x) + ny * (py - v1y);
        if (sep <= .5) out.push({ a: A, b: B, nx: Nx, ny: Ny, x: px, y: py, pen: -sep });
    }
}

// Keep the part of a segment where n.p <= off.
function clipSeg(p, nx, ny, off) {
    const out = [];
    const d0 = nx * p[0][0] + ny * p[0][1] - off;
    const d1 = nx * p[1][0] + ny * p[1][1] - off;
    if (d0 <= 0) out.push(p[0]);
    if (d1 <= 0) out.push(p[1]);
    if (d0 * d1 < 0) {
        const t = d0 / (d0 - d1);
        out.push([p[0][0] + (p[1][0] - p[0][0]) * t, p[0][1] + (p[1][1] - p[0][1]) * t]);
    }
    return out;
}

/* ─── The component ──────────────────────────────────────────────── */

export function specimenTray(root, opts = {}) {
    const stage = root && root.querySelector('.sp-stage');
    const tray = root && root.querySelector('.sp-tray');
    if (!stage || !tray || root.__spTray) return () => {};
    const ds = root.dataset;
    const cfg = {
        label: opts.label ?? ds.label ?? '',
        fill: Number(opts.fill ?? ds.fill ?? .2),             // share of the lining covered by objects
        minSize: Number(opts.minSize ?? ds.minSize ?? 68),    // px; fewer objects rather than tiny ones
        maxSize: Number(opts.maxSize ?? ds.maxSize ?? 210),
        friction: Number(opts.friction ?? ds.friction ?? 1),  // 1 = felt; lower is slicker
        tags: (opts.tags ?? ds.tags ?? 'true') !== 'false',
        seed: opts.seed ?? ds.seed,
    };
    rand = cfg.seed != null && cfg.seed !== '' ? seeded(Number(cfg.seed) | 0) : Math.random;

    let dead = false;
    const off = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    /* ── scaffolding: shelf above, a clipped slot, the drawer in it ── */
    const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
    const shelf = mk('div', 'sp-shelf');
    const slot = mk('div', 'sp-slot');
    const drawer = mk('div', 'sp-drawer');
    const front = mk('div', 'sp-front');
    const tagLayer = mk('div', 'sp-tags');
    const canvas = mk('canvas', 'sp-threads');
    const live = mk('p', 'sp-sr');
    const hint = mk('p', 'sp-sr');
    [shelf, front, tagLayer, canvas].forEach((e) => e.setAttribute('aria-hidden', 'true'));
    front.innerHTML = '<span class="sp-knob"></span><span class="sp-holder"><span class="sp-card"></span></span><span class="sp-knob"></span>';
    front.querySelector('.sp-card').textContent = cfg.label;
    live.setAttribute('aria-live', 'polite');
    hint.id = `sp-hint-${++uid}`;
    hint.textContent = 'Drag to move it, or use the arrow keys. Enter turns it over.';
    const home = tray.nextSibling;
    root.append(live, hint);
    root.__spTray = true;
    // The cabinet goes in once the pictures are ready; until then the plain tray shows.
    let mounted = false;
    function mount() {
        mounted = true;
        stage.insertBefore(shelf, tray);
        stage.insertBefore(slot, tray);
        slot.appendChild(drawer);
        drawer.append(tagLayer, canvas, tray, front);
    }
    const ctx = canvas.getContext('2d');

    /* ── items: each <img> goes into a <button> with two shadows ── */
    const items = [...tray.children].filter((li) => li.querySelector('img'));
    const bodies = items.map((li) => {
        const img = li.querySelector('img');
        const btn = mk('button', 'sp-obj');
        btn.type = 'button';
        btn.setAttribute('aria-describedby', hint.id);
        const no = li.dataset.no || '';
        btn.setAttribute('aria-label', `${no ? `Nº ${no}, ` : ''}${img.alt || 'specimen'}`);
        img.draggable = false;
        const sh1 = mk('img', 'sp-sh sp-sh-near');
        const sh2 = mk('img', 'sp-sh sp-sh-far');
        [sh1, sh2].forEach((s) => { s.alt = ''; s.setAttribute('aria-hidden', 'true'); s.draggable = false; s.src = img.currentSrc || img.src; });
        img.replaceWith(btn);
        btn.appendChild(img);
        li.prepend(sh1, sh2);
        const back = li.dataset.back ? Object.assign(new Image(), { src: new URL(li.dataset.back, document.baseURI).href }) : null;
        return {
            li, img, btn, sh1, sh2, no, back, front: img.currentSrc || img.src,
            weight: Number(li.dataset.weight || 1), size: Number(li.dataset.size || 1),
            x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0,
            lift: 0, hover: false, focus: false, held: null,
            flip: -1, side: 1, mirror: 1, z: 0, css: '',
        };
    });
    let usable = bodies.slice();
    let pool = bodies.slice();           // the ones on show this visit

    /* ── state ── */
    let W = 0, Hh = 0, dpr = 1;
    let d = 0, dv = 0, open = false;     // drawer: 0 shut .. 1 out against its stops
    let visible = false, raf = 0, last = 0, acc = 0, zTop = 10;
    let ropesMoving = true, rough = null, hand = 'cursive', live0 = false;
    const tags = [];

    const css = getComputedStyle(root);
    const ink = css.getPropertyValue('--sp-tag-ink').trim() || '#2b2117';
    const lining = css.getPropertyValue('--sp-lining').trim() || '#e3dac8';
    const thread = css.getPropertyValue('--sp-thread').trim() || '#b4553a';

    /* ── drawer pose ── */
    let travelPx = 600;
    const travel = () => travelPx;
    function target() {
        if (calm.matches) return 1;
        const r = root.getBoundingClientRect();
        const vh = innerHeight;
        const run = Math.max(1, r.height - vh);
        const p = clamp((vh * .55 - r.top) / (vh * .55 + run * .42));
        return smooth(p) * 1.14;          // aims past the stops so it arrives with speed
    }
    function poseDrawer() {
        if (d >= 1) {
            drawer.style.transform = '';
            drawer.style.filter = '';
            return;
        }
        const e = d;
        drawer.style.transform = `translate3d(0, ${(-(1 - e) * travel()).toFixed(1)}px, ${(-(1 - e) * 140).toFixed(1)}px) rotateX(${((1 - e) * 16).toFixed(2)}deg)`;
        drawer.style.filter = `saturate(${(.2 + .8 * e * e).toFixed(3)}) brightness(${(.72 + .28 * e).toFixed(3)})`;
    }
    function setOpen(v) {
        if (v === open) return;
        open = v;
        root.classList.toggle('is-open', v);
        if (!v) bodies.forEach((b) => { b.held = null; b.li.classList.remove('is-held'); });
    }

    /* ── sizing and first arrangement ── */
    function measure() {
        W = tray.clientWidth; Hh = tray.clientHeight;
        dpr = Math.min(2, devicePixelRatio || 1);
        const ox = tray.offsetLeft, oy = tray.offsetTop;
        for (const el of [tagLayer, canvas]) Object.assign(el.style, { left: ox + 'px', top: oy + 'px', width: W + 'px', height: Hh + 'px' });
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(Hh * dpr);
        travelPx = drawer.offsetHeight * 1.02;
    }

    function shape(b, s) {
        b.sBase = s;
        const showBack = b.back && b.side < 0;
        const pic = showBack ? b.back : b.img;
        const iw = pic.naturalWidth || 1, ih = pic.naturalHeight || 1;
        const k = (s * b.size) / Math.max(iw, ih);
        b.iw = iw * k; b.ih = ih * k;
        const hull = (showBack ? b.hullBack01 : b.hull01).map(([u, v]) => [u * b.iw, v * b.ih]);
        const P = polyProps(hull);
        if (!P.ccw) hull.reverse();
        b.cx = P.cx; b.cy = P.cy;
        b.lx = hull.map((p) => p[0] - P.cx);
        b.ly = hull.map((p) => p[1] - P.cy);
        if (b.mirror < 0) mirrorHull(b);
        b.n = b.lx.length;
        b.wx = new Float64Array(b.n); b.wy = new Float64Array(b.n);
        b.nx = new Float64Array(b.n); b.ny = new Float64Array(b.n);
        b.r = Math.max(...b.lx.map((x, i) => Math.hypot(x, b.ly[i])));
        const dens = .001 * b.weight;
        b.m = P.A * dens; b.im = 1 / b.m;
        b.I = P.I * dens; b.iI = 1 / b.I;
        b.rg = Math.sqrt(P.I / P.A);
        b.s = s * b.size;
        // DOM geometry: the li sits at the centroid; children are offset to it
        for (const el of [b.btn, b.sh1, b.sh2]) {
            Object.assign(el.style, {
                left: (-b.cx).toFixed(2) + 'px', top: (-b.cy).toFixed(2) + 'px',
                width: b.iw.toFixed(2) + 'px', height: b.ih.toFixed(2) + 'px',
                transformOrigin: `${b.cx.toFixed(2)}px ${b.cy.toFixed(2)}px`,
            });
        }
        b.css = '';
    }
    function mirrorHull(b) {
        b.lx = b.lx.map((x) => -x).reverse();
        b.ly = b.ly.slice().reverse();
    }

    function layout(keep) {
        measure();
        const area = (b) => b.size * b.size * (b.hullA || .6) * Math.min(b.img.naturalWidth, b.img.naturalHeight) / Math.max(b.img.naturalWidth, b.img.naturalHeight);
        // biggest objects that fill the share asked for; drop a few rather than shrink below minSize
        let list = keep ? pool : shuffle(usable.slice());
        let s = 0;
        while (true) {
            s = Math.sqrt((cfg.fill * W * Hh) / list.reduce((t, b) => t + area(b), 0));
            if (s >= cfg.minSize || list.length <= 3) break;
            list = list.slice(0, -1);
        }
        s = Math.min(s, cfg.maxSize);
        pool = list;
        bodies.forEach((b) => { b.li.hidden = !pool.includes(b); });   // more than fit: some sit out this visit

        if (!keep) {
            const n = pool.length;
            const cols = Math.max(1, Math.round(Math.sqrt((n * W) / Hh)));
            const rows = Math.ceil(n / cols);
            pool.forEach((b, i) => {
                const row = Math.floor(i / cols);
                const inRow = row === rows - 1 ? n - row * cols : cols;
                const col = i % cols;
                const cw = W / cols, chh = Hh / rows;
                const x0 = (W - inRow * cw) / 2;
                b.x = x0 + (col + .5 + rnd(-.16, .16)) * cw;
                b.y = (row + .5 + rnd(-.14, .14)) * chh;
                b.a = rnd(-.24, .24);
                b.vx = b.vy = b.w = 0;
            });
        } else {
            pool.forEach((b) => { b.x *= W / keep.W; b.y *= Hh / keep.H; });
        }
        pool.forEach((b) => shape(b, s));
        for (let i = 0; i < 90; i++) { worldVerts(); separate(1); }
        if (cfg.tags) makeTags(s, !!keep);
        for (let i = 0; i < 240; i++) ropeStep(.6);
        ropesMoving = true;
    }

    function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
        return a;
    }

    /* ── tags ── */
    function makeTags(s, keepDir) {
        tagLayer.textContent = '';
        tags.length = 0;
        for (const b of pool) {
            // a small snail gets a small tag; legibility sets the floor
            const os = Math.sqrt(b.s * s);
            const Lt = Math.round(clamp(os * .6, 54, 104));
            const Wt = Math.round(clamp(os * .24, 21, 36));
            // tie the thread where there is room: try eight headings, keep the emptiest
            let best = null, bestScore = -Infinity;
            for (let k = 0; k < 8; k++) {
                const ang = (k / 8) * Math.PI * 2 + rnd(-.25, .25);
                const reach = b.r + Lt * .75;
                const px = b.x + Math.cos(ang) * reach, py = b.y + Math.sin(ang) * reach;
                let score = Math.min(px, W - px, py, Hh - py) * 1.5;
                for (const o of pool) if (o !== b) score = Math.min(score, Math.hypot(px - o.x, py - o.y) - o.r * .8);
                for (const t of tags) score = Math.min(score, Math.hypot(px - t.mx, py - t.my) - Lt * .55);
                score += rnd(0, 6) + Math.cos(ang) * Lt * .45;   // tags that read the right way up, mostly
                if (score > bestScore) { bestScore = score; best = ang; }
            }
            if (keepDir && b.tag) best = b.tag.dir;
            // anchor: the hull vertex facing that way, tucked under the edge
            const la = best - b.a;
            let ai = 0, ad = -Infinity;
            for (let i = 0; i < b.n; i++) {
                const dd = b.lx[i] * Math.cos(la) + b.ly[i] * Math.sin(la);
                if (dd > ad) { ad = dd; ai = i; }
            }
            const ax = b.lx[ai] * .82, ay = b.ly[ai] * .82;
            const c = Math.cos(b.a), sn = Math.sin(b.a);
            const wx = b.x + c * ax - sn * ay, wy = b.y + sn * ax + c * ay;
            const len = Math.max(12, os * .26) + rnd(0, os * .1);
            const N = 7;
            const hx = wx + Math.cos(best) * len, hy = wy + Math.sin(best) * len;
            const bow = rnd(-.3, .3);
            const pts = [];
            for (let i = 0; i <= N; i++) {
                const t = i / N;
                const x = wx + (hx - wx) * t - Math.sin(best) * Math.sin(t * Math.PI) * len * bow;
                const y = wy + (hy - wy) * t + Math.cos(best) * Math.sin(t * Math.PI) * len * bow;
                pts.push({ x, y, px: x, py: y });
            }
            const holeX = Wt * .42;
            const tailLen = Lt - holeX;
            const ta = best + rnd(-.4, .4);
            const tail = { x: hx + Math.cos(ta) * tailLen, y: hy + Math.sin(ta) * tailLen };
            tail.px = tail.x; tail.py = tail.y;
            const el = drawTag(b.no, Lt, Wt, holeX);
            tagLayer.appendChild(el);
            const tag = { b, ax, ay, pts, tail, seg: (len * 1.18) / N, Lt, Wt, holeX, tailLen, el, dir: best, css: '',
                mx: (hx + tail.x) / 2, my: (hy + tail.y) / 2 };
            b.tag = tag;
            tags.push(tag);
        }
    }

    function drawTag(no, Lt, Wt, holeX) {
        const box = mk('div', 'sp-tag');
        const svg = document.createElementNS(NS, 'svg');
        const pad = 3;
        svg.setAttribute('width', Lt + pad * 2);
        svg.setAttribute('height', Wt + pad * 2);
        svg.setAttribute('viewBox', `${-pad} ${-pad} ${Lt + pad * 2} ${Wt + pad * 2}`);
        box.style.cssText = `width:${Lt + pad * 2}px;height:${Wt + pad * 2}px;margin:${-pad}px 0 0 ${-pad}px;transform-origin:${holeX + pad}px ${Wt / 2 + pad}px`;
        const ch = Wt * .3;
        const shapePts = [[0, ch], [ch, 0], [Lt, 0], [Lt, Wt], [ch, Wt], [0, Wt - ch]];
        const tones = ['#f6f1e4', '#f2ead8', '#f7f3ea', '#efe5cf'];
        const paper = tones[Math.floor(rand() * tones.length)];
        const r = Wt * .12;
        const seed = 1 + Math.floor(rand() * 2 ** 20);
        if (rough) {
            const rc = rough.svg(svg);
            svg.appendChild(rc.polygon(shapePts, { seed, roughness: .9, bowing: .7, stroke: ink, strokeWidth: .85, fill: paper, fillStyle: 'solid' }));
            svg.appendChild(rc.circle(holeX, Wt / 2, r * 3.5, { seed: seed + 1, roughness: .7, stroke: ink, strokeWidth: .55 }));
            svg.appendChild(rc.circle(holeX, Wt / 2, r * 2, { seed: seed + 2, roughness: .5, stroke: ink, strokeWidth: .7, fill: lining, fillStyle: 'solid' }));
            const lx = holeX + r * 2.5;
            svg.appendChild(rc.line(lx, Wt * .8, Lt - Wt * .25, Wt * .8, { seed: seed + 3, roughness: .6, stroke: ink, strokeWidth: .35 }));
        } else {
            const pg = document.createElementNS(NS, 'polygon');
            pg.setAttribute('points', shapePts.map((p) => p.join(',')).join(' '));
            pg.setAttribute('fill', paper); pg.setAttribute('stroke', ink); pg.setAttribute('stroke-width', '.8');
            const hole = document.createElementNS(NS, 'circle');
            Object.entries({ cx: holeX, cy: Wt / 2, r, fill: lining, stroke: ink, 'stroke-width': .7 }).forEach(([k, v]) => hole.setAttribute(k, v));
            svg.append(pg, hole);
        }
        if (no) {
            const t = document.createElementNS(NS, 'text');
            const x0 = holeX + r * 2.6;
            const room = Lt - x0 - Wt * .25;
            const label = `Nº ${no}`;
            ctx.font = `100px ${hand}`;
            const fs = Math.min(Wt * .4, (room / Math.max(1, ctx.measureText(label).width)) * 100);
            t.setAttribute('x', x0.toFixed(1));
            t.setAttribute('y', (Wt * .62).toFixed(1));
            t.setAttribute('font-size', fs.toFixed(2));
            t.setAttribute('fill', ink);
            t.setAttribute('font-family', hand);
            t.textContent = label;
            svg.appendChild(t);
        }
        box.appendChild(svg);
        return box;
    }

    /* ── physics ── */
    function worldVerts() {
        for (const b of pool) {
            const c = Math.cos(b.a), s = Math.sin(b.a);
            for (let i = 0; i < b.n; i++) {
                b.wx[i] = b.x + c * b.lx[i] - s * b.ly[i];
                b.wy[i] = b.y + s * b.lx[i] + c * b.ly[i];
            }
            for (let i = 0; i < b.n; i++) {
                const j = (i + 1) % b.n;
                const ex = b.wx[j] - b.wx[i], ey = b.wy[j] - b.wy[i];
                const l = Math.hypot(ex, ey) || 1;
                b.nx[i] = ey / l; b.ny[i] = -ex / l;
            }
        }
    }

    function contacts() {
        const out = [];
        for (let i = 0; i < pool.length; i++) {
            const A = pool[i];
            for (let j = i + 1; j < pool.length; j++) {
                const B = pool[j];
                const rr = A.r + B.r + 1;
                if ((A.x - B.x) ** 2 + (A.y - B.y) ** 2 < rr * rr) collide(A, B, out);
            }
            // walls are half-planes; a body touching one gets its two deepest corners
            for (const [wnx, wny, lim] of [[1, 0, 0], [-1, 0, -W], [0, 1, 0], [0, -1, -Hh]]) {
                const hit = [];
                for (let k = 0; k < A.n; k++) {
                    const pen = -(wnx * A.wx[k] + wny * A.wy[k] - lim);
                    if (pen > -.5) hit.push({ a: null, b: A, nx: wnx, ny: wny, x: A.wx[k], y: A.wy[k], pen });
                }
                hit.sort((p, q) => q.pen - p.pen);
                out.push(...hit.slice(0, 2));
            }
        }
        return out;
    }

    function separate(k) {
        const cs = contacts();
        for (const c of cs) {
            const ia = c.a ? c.a.im : 0, ib = c.b.im;
            const corr = Math.max(0, c.pen - .2) * k / (ia + ib);
            if (c.a) { c.a.x -= c.nx * corr * ia; c.a.y -= c.ny * corr * ia; }
            c.b.x += c.nx * corr * ib; c.b.y += c.ny * corr * ib;
        }
    }

    function applyImpulse(b, px, py, rx, ry, sign) {
        b.vx += sign * px * b.im; b.vy += sign * py * b.im;
        b.w += sign * (rx * py - ry * px) * b.iI;
    }

    function solve(cs) {
        for (const c of cs) {
            const A = c.a, B = c.b;
            c.rax = A ? c.x - A.x : 0; c.ray = A ? c.y - A.y : 0;
            c.rbx = c.x - B.x; c.rby = c.y - B.y;
            const ia = A ? A.im : 0, iia = A ? A.iI : 0;
            const rna = c.rax * c.ny - c.ray * c.nx, rnb = c.rbx * c.ny - c.rby * c.nx;
            c.mn = 1 / (ia + B.im + iia * rna * rna + B.iI * rnb * rnb);
            const tx = -c.ny, ty = c.nx;
            const rta = c.rax * ty - c.ray * tx, rtb = c.rbx * ty - c.rby * tx;
            c.mt = 1 / (ia + B.im + iia * rta * rta + B.iI * rtb * rtb);
            const vn = relVel(c, c.nx, c.ny);
            const e = A ? .14 : .24;
            c.bounce = vn < -50 ? -e * vn : 0;
            c.mu = A ? .32 : .28;
            c.Pn = 0; c.Pt = 0;
        }
        for (let it = 0; it < 8; it++) {
            for (const c of cs) {
                const vn = relVel(c, c.nx, c.ny);
                let dP = c.mn * (-vn + c.bounce);
                const P0 = c.Pn; c.Pn = Math.max(P0 + dP, 0); dP = c.Pn - P0;
                if (c.a) applyImpulse(c.a, c.nx * dP, c.ny * dP, c.rax, c.ray, -1);
                applyImpulse(c.b, c.nx * dP, c.ny * dP, c.rbx, c.rby, 1);
                const tx = -c.ny, ty = c.nx;
                const vt = relVel(c, tx, ty);
                let dT = c.mt * -vt;
                const T0 = c.Pt, lim = c.mu * c.Pn;
                c.Pt = clamp(T0 + dT, -lim, lim); dT = c.Pt - T0;
                if (c.a) applyImpulse(c.a, tx * dT, ty * dT, c.rax, c.ray, -1);
                applyImpulse(c.b, tx * dT, ty * dT, c.rbx, c.rby, 1);
            }
        }
    }
    function relVel(c, nx, ny) {
        const A = c.a, B = c.b;
        let vx = B.vx - B.w * c.rby, vy = B.vy + B.w * c.rbx;
        if (A) { vx -= A.vx - A.w * c.ray; vy -= A.vy + A.w * c.rax; }
        return vx * nx + vy * ny;
    }

    function step(h) {
        const mu = 2300 * cfg.friction;                  // felt: px/s² of Coulomb deceleration
        for (const b of pool) {
            if (b.held) {
                // soft spring at the grabbed point (Box2D's mouse joint)
                const hd = b.held;
                const c = Math.cos(b.a), s = Math.sin(b.a);
                const rx = c * hd.lx - s * hd.ly, ry = s * hd.lx + c * hd.ly;
                const Cx = b.x + rx - hd.tx, Cy = b.y + ry - hd.ty;
                const om = 2 * Math.PI * 7, z = .95;
                const kk = b.m * om * om, dd = 2 * b.m * z * om;
                const gamma = 1 / (h * (dd + h * kk)), beta = h * kk * gamma;
                const k11 = b.im + b.iI * ry * ry + gamma, k12 = -b.iI * rx * ry, k22 = b.im + b.iI * rx * rx + gamma;
                const det = k11 * k22 - k12 * k12 || 1;
                const vpx = b.vx - b.w * ry + beta * Cx, vpy = b.vy + b.w * rx + beta * Cy;
                const px = -(k22 * vpx - k12 * vpy) / det, py = -(-k12 * vpx + k11 * vpy) / det;
                applyImpulse(b, px, py, rx, ry, 1);
                b.w *= Math.exp(-7 * h);
            } else {
                const sp = Math.hypot(b.vx, b.vy);
                if (sp > 0) { const k = Math.max(0, sp - mu * h) / sp; b.vx *= k; b.vy *= k; }
                const dw = (mu / Math.max(8, b.rg)) * .7 * h;
                b.w = Math.abs(b.w) <= dw ? 0 : b.w - Math.sign(b.w) * dw;
                b.vx *= 1 - 1.5 * h; b.vy *= 1 - 1.5 * h;
            }
            const sp = Math.hypot(b.vx, b.vy);
            if (sp > 2800) { b.vx *= 2800 / sp; b.vy *= 2800 / sp; }
            b.w = clamp(b.w, -16, 16);
        }
        worldVerts();
        solve(contacts());
        for (const b of pool) { b.x += b.vx * h; b.y += b.vy * h; b.a += b.w * h; }
        worldVerts();
        separate(.6);
        if (cfg.tags) ropeStep(calm.matches ? .55 : 1);
    }

    // Threads and tags: verlet points on felt, the first pinned under the object.
    function ropeStep(damp) {
        let moved = 0;
        for (const t of tags) {
            const b = t.b;
            const c = Math.cos(b.a), s = Math.sin(b.a);
            const p0 = t.pts[0];
            p0.x = b.x + c * t.ax - s * t.ay; p0.y = b.y + s * t.ax + c * t.ay;
            p0.px = p0.x; p0.py = p0.y;
            const N = t.pts.length - 1;
            for (let i = 1; i <= N + 1; i++) {
                const p = i <= N ? t.pts[i] : t.tail;
                const k = i < N ? .9 * damp : .965 * damp;      // thread is dragged; the card glides a little
                const vx = (p.x - p.px) * k, vy = (p.y - p.py) * k;
                p.px = p.x; p.py = p.y;
                p.x += vx; p.y += vy;
                moved = Math.max(moved, Math.abs(vx) + Math.abs(vy));
            }
            for (let it = 0; it < 10; it++) {
                for (let i = 0; i < N; i++) {
                    const a = t.pts[i], q = t.pts[i + 1];
                    const dx = q.x - a.x, dy = q.y - a.y, dl = Math.hypot(dx, dy) || 1e-6;
                    if (dl > t.seg) {                           // a thread only pulls, never pushes
                        const f = (dl - t.seg) / dl;
                        if (i === 0) { q.x -= dx * f; q.y -= dy * f; }
                        else { a.x += dx * f * .5; a.y += dy * f * .5; q.x -= dx * f * .5; q.y -= dy * f * .5; }
                    }
                }
                for (let i = 1; i < N - 1; i++) {               // a little stiffness: no hairpins
                    const a = t.pts[i], q = t.pts[i + 2];
                    const dx = q.x - a.x, dy = q.y - a.y, dl = Math.hypot(dx, dy) || 1e-6;
                    const min = t.seg * 1.55;
                    if (dl < min) { const f = ((min - dl) / dl) * .12; a.x -= dx * f; a.y -= dy * f; q.x += dx * f; q.y += dy * f; }
                }
                const hp = t.pts[N], tl = t.tail;               // the card itself is rigid
                const dx = tl.x - hp.x, dy = tl.y - hp.y, dl = Math.hypot(dx, dy) || 1e-6;
                const f = ((dl - t.tailLen) / dl) * .5;
                hp.x += dx * f * .4; hp.y += dy * f * .4; tl.x -= dx * f * 1.6; tl.y -= dy * f * 1.6;
                const m = t.Wt * .55;
                for (let i = 1; i <= N + 1; i++) {
                    const p = i <= N ? t.pts[i] : t.tail;
                    const mm = i >= N ? m : 2;
                    p.x = clamp(p.x, mm, W - mm); p.y = clamp(p.y, mm, Hh - mm);
                }
            }
        }
        ropesMoving = moved > .015;
    }

    /* ── drawing ── */
    function render() {
        for (const b of pool) {
            // turning over: the width folds through zero; the hull and image swap at the middle
            let f = 0, sx = b.mirror;
            if (b.flip >= 0) {
                f = Math.sin(Math.PI * b.flip);
                sx = Math.abs(Math.cos(Math.PI * easeInOut(b.flip))) * b.mirror;
            }
            const L = clamp(Math.max(b.lift, f * .9));
            const sc = 1 + .04 * L;
            const deg = (b.a * 180) / Math.PI;
            const ox = 2 + 9 * L, oy = 3 + 13 * L;
            const s = `${b.x.toFixed(2)},${b.y.toFixed(2)},${deg.toFixed(2)},${sx.toFixed(3)},${L.toFixed(3)}`;
            if (s === b.css) continue;
            b.css = s;
            b.li.style.transform = `translate3d(${b.x.toFixed(2)}px, ${b.y.toFixed(2)}px, 0)`;
            b.btn.style.transform = `translate(${(-1.5 * L).toFixed(2)}px, ${(-2.5 * L).toFixed(2)}px) rotate(${deg.toFixed(2)}deg) scale(${(sc * sx).toFixed(4)}, ${sc.toFixed(4)})`;
            b.sh1.style.transform = `translate(${(ox * .25).toFixed(2)}px, ${(oy * .25).toFixed(2)}px) rotate(${deg.toFixed(2)}deg) scale(${sx.toFixed(4)}, 1)`;
            b.sh1.style.opacity = (.62 * (1 - L) + .05).toFixed(3);
            b.sh2.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px) rotate(${deg.toFixed(2)}deg) scale(${((1 + .07 * L) * sx).toFixed(4)}, ${(1 + .07 * L).toFixed(4)})`;
            b.sh2.style.opacity = (.34 + .14 * L).toFixed(3);
        }
        if (!cfg.tags) return;
        for (const t of tags) {
            const hp = t.pts[t.pts.length - 1];
            const ang = Math.atan2(t.tail.y - hp.y, t.tail.x - hp.x);
            const s = `translate3d(${(hp.x - t.holeX).toFixed(2)}px, ${(hp.y - t.Wt / 2).toFixed(2)}px, 0) rotate(${((ang * 180) / Math.PI).toFixed(2)}deg)`;
            if (s !== t.css) { t.el.style.transform = s; t.css = s; }
        }
        drawThreads();
    }

    function drawThreads() {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, Hh);
        const path = (t, dx, dy) => {
            const p = t.pts;
            ctx.beginPath();
            ctx.moveTo(p[0].x + dx, p[0].y + dy);
            for (let i = 1; i < p.length - 1; i++) {
                const mx = (p[i].x + p[i + 1].x) / 2, my = (p[i].y + p[i + 1].y) / 2;
                ctx.quadraticCurveTo(p[i].x + dx, p[i].y + dy, mx + dx, my + dy);
            }
            const e = p[p.length - 1];
            ctx.lineTo(e.x + dx, e.y + dy);
        };
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(40, 28, 18, .16)';
        ctx.lineWidth = 1.6;
        for (const t of tags) { path(t, .7, 1); ctx.stroke(); }
        ctx.strokeStyle = thread;
        ctx.lineWidth = 1.05;
        for (const t of tags) {
            path(t, 0, 0); ctx.stroke();
            // the loop through the hole
            const hp = t.pts[t.pts.length - 1];
            const ang = Math.atan2(t.tail.y - hp.y, t.tail.x - hp.x);
            const r = t.Wt * .12;
            ctx.beginPath();
            ctx.ellipse(hp.x + Math.cos(ang) * r * .2, hp.y + Math.sin(ang) * r * .2, r * 1.35, r * .9, ang + .4, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    /* ── loop ── */
    function awake() {
        if (!open) return false;
        for (const b of pool) {
            if (b.held || b.flip >= 0) return true;
            if (Math.abs(b.vx) + Math.abs(b.vy) > .5 || Math.abs(b.w) > .005) return true;
            const tgt = liftTarget(b);
            if (Math.abs(b.lift - tgt) > .002) return true;
        }
        return cfg.tags && ropesMoving;
    }
    const liftTarget = (b) => (b.held ? 1 : b.hover ? .32 : b.focus ? .22 : 0);

    function frame(t) {
        raf = 0;
        const dt = last ? Math.min(.05, (t - last) / 1000) : 1 / 60;
        last = t;

        // the drawer: a damped spring toward the scroll, stopped hard by its runners
        const tg = target();
        let moving = false;
        if (calm.matches) { d = 1; dv = 0; }
        else {
            const n = Math.ceil(dt / (1 / 240));
            for (let i = 0; i < n; i++) {
                const h = dt / n;
                dv += (36 * (tg - d) - 10.5 * dv) * h;
                d += dv * h;
                if (d >= 1) {
                    if (dv > .25) shiver(dv);
                    d = 1; dv = Math.min(0, dv);
                    if (tg >= 1) dv = 0;
                }
                if (d < 0) { d = 0; dv = Math.max(0, dv); }
            }
            moving = Math.abs(dv) > 1e-4 || Math.abs(Math.min(1, tg) - d) > 1e-4;
        }
        poseDrawer();
        setOpen(d >= 1);

        for (const b of pool) {
            const tgt = liftTarget(b);
            b.lift += (tgt - b.lift) * (1 - Math.exp(-dt * (tgt > b.lift ? 16 : 9)));
            if (b.flip >= 0) {
                const before = b.flip;
                b.flip += dt / .78;
                if (before < .5 && b.flip >= .5) turn(b);
                if (b.flip >= 1) { b.flip = -1; b.w += rnd(-1.2, 1.2); }
            }
        }

        if (open) {
            acc = Math.min(acc + dt, .1);
            while (acc >= H) { step(H); acc -= H; }
        }
        render();

        if (visible && (moving || awake())) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    const kick = () => { if (!raf && !dead && live0) raf = requestAnimationFrame(frame); };

    // The drawer hits its stops: everything on the felt keeps going for an instant.
    function shiver(speed) {
        const v = clamp(speed * travel(), 0, 2200);
        const kObj = clamp(v * .1, 0, 190), kTag = clamp(v * .2, 0, 380);
        for (const b of pool) {
            b.vy += kObj * rnd(.75, 1.1) / Math.sqrt(b.weight);
            b.vx += kObj * rnd(-.15, .15);
            b.w += rnd(-1, 1) * kObj * .006;
        }
        for (const t of tags) {
            for (const p of [...t.pts.slice(1), t.tail]) p.py -= kTag * rnd(.8, 1.15) * H;
        }
        ropesMoving = true;
    }

    function turnOver(b) {
        if (b.flip >= 0) return;
        if (calm.matches) { turn(b); b.css = ''; worldVerts(); render(); return; }
        b.flip = 0; kick();
    }
    function turn(b) {
        b.side = -b.side;
        if (b.back) {
            // the other face is its own photograph: its own outline and proportions
            const src = b.side < 0 ? b.back.src : b.front;
            b.img.src = src; b.sh1.src = src; b.sh2.src = src;
            shape(b, b.sBase);
        } else {
            b.mirror = -b.mirror;
            mirrorHull(b);
        }
        live.textContent = `${b.no ? `Nº ${b.no}` : 'Specimen'} turned over.`;
    }

    /* ── input ── */
    function toTray(e) {
        const r = tray.getBoundingClientRect();
        return { x: e.clientX - r.left - tray.clientLeft, y: e.clientY - r.top - tray.clientTop };
    }
    function inside(b, x, y, m) {
        for (let i = 0; i < b.n; i++) if (b.nx[i] * (x - b.wx[i]) + b.ny[i] * (y - b.wy[i]) > m) return false;
        return true;
    }
    function grab(b, e) {
        const p = toTray(e);
        // the button is a box; prefer whichever outline is really under the finger
        const under = pool.filter((o) => inside(o, p.x, p.y, 4)).sort((m, n) => n.z - m.z)[0];
        if (under) b = under;
        const c = Math.cos(-b.a), s = Math.sin(-b.a);
        const dx = p.x - b.x, dy = p.y - b.y;
        b.held = { id: e.pointerId, lx: c * dx - s * dy, ly: s * dx + c * dy, tx: p.x, ty: p.y };
        b.z = ++zTop;
        b.li.style.zIndex = b.z;
        b.li.classList.add('is-held');
        return b;
    }

    const holding = new Map();
    for (const b of bodies) {
        on(b.btn, 'pointerdown', (e) => {
            if (!open || (e.pointerType === 'mouse' && e.button !== 0)) return;
            e.preventDefault();
            try { b.btn.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
            holding.set(e.pointerId, grab(b, e));
            kick();
        });
        on(b.btn, 'pointermove', (e) => {
            const h = holding.get(e.pointerId);
            if (!h || !h.held) return;
            const p = toTray(e);
            h.held.tx = p.x; h.held.ty = p.y;
            kick();
        });
        const drop = (e) => {
            const h = holding.get(e.pointerId);
            if (!h) return;
            holding.delete(e.pointerId);
            h.held = null;
            h.li.classList.remove('is-held');
            if (calm.matches) { h.vx = h.vy = h.w = 0; }
            kick();
        };
        on(b.btn, 'pointerup', drop);
        on(b.btn, 'pointercancel', drop);
        on(b.btn, 'lostpointercapture', drop);
        on(b.btn, 'pointerenter', (e) => { if (e.pointerType === 'mouse') { b.hover = true; kick(); } });
        on(b.btn, 'pointerleave', (e) => { if (e.pointerType === 'mouse') { b.hover = false; kick(); } });
        on(b.btn, 'focus', () => { b.focus = true; b.z = ++zTop; b.li.style.zIndex = b.z; kick(); });
        on(b.btn, 'blur', () => { b.focus = false; kick(); });
        on(b.btn, 'dblclick', () => { if (open) turnOver(b); });
        on(b.btn, 'keydown', (e) => {
            if (!open) return;
            const push = e.shiftKey ? 640 : 260;
            const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
            if (dir) {
                e.preventDefault();
                b.vx += dir[0] * push * (calm.matches ? 0 : 1);
                b.vy += dir[1] * push * (calm.matches ? 0 : 1);
                if (calm.matches) { b.x = clamp(b.x + dir[0] * 12, b.r * .5, W - b.r * .5); b.y = clamp(b.y + dir[1] * 12, b.r * .5, Hh - b.r * .5); worldVerts(); separate(1); if (cfg.tags) for (let i = 0; i < 60; i++) ropeStep(.5); }
                kick();
            } else if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                turnOver(b);
            }
        });
        on(b.btn, 'click', (e) => e.preventDefault());
    }

    const io = new IntersectionObserver((en) => {
        visible = en[0].isIntersecting;
        if (visible) { last = 0; kick(); }
    }, { rootMargin: '120px' });
    io.observe(root);
    on(window, 'scroll', kick, { passive: true });
    let rt = 0;
    on(window, 'resize', () => {
        clearTimeout(rt);
        rt = setTimeout(() => {
            if (!live0 || (tray.clientWidth === W && tray.clientHeight === Hh)) return;
            const keep = { W, H: Hh };
            layout(keep);
            render(); kick();
        }, 180);
    }, { passive: true });
    const onCalm = () => { last = 0; kick(); };
    calm.addEventListener('change', onCalm);
    off.push(() => calm.removeEventListener('change', onCalm));


    /* ── start once images, the hand and rough.js are ready ── */
    (async () => {
        const handVar = css.getPropertyValue('--sp-hand').trim() || '"Homemade Apple", cursive';
        hand = handVar;
        const fontWait = Promise.race([
            document.fonts ? document.fonts.load(`20px ${handVar}`).then(() => document.fonts.ready) : Promise.resolve(),
            new Promise((r) => setTimeout(r, 3000)),
        ]).catch(() => {});
        const roughWait = cfg.tags ? import('./vendor/roughjs/rough.esm.js').then((m) => { rough = m.default; }).catch(() => {}) : null;
        await Promise.all([
            ...bodies.map((b) => (b.img.decode ? b.img.decode().catch(() => {}) : null)),
            ...bodies.map((b) => (b.back && b.back.decode ? b.back.decode().catch(() => {}) : null)),
            fontWait, roughWait,
        ]);
        if (dead) return;
        // an image that failed to load is simply left out of the drawer
        usable = bodies.filter((b) => b.img.naturalWidth > 0);
        bodies.forEach((b) => { if (!usable.includes(b)) b.li.hidden = true; });
        if (!usable.length) return;
        for (const b of usable) {
            b.hull01 = outline(b.img);
            if (b.back && b.back.naturalWidth) b.hullBack01 = outline(b.back);
            else b.back = null;
            b.hullA = polyProps(b.hull01).A;
        }
        mount();
        root.classList.add('is-live');
        travelPx = drawer.offsetHeight * 1.02 || 600;
        d = Math.min(1, target());
        if (calm.matches) d = 1;
        layout(null);
        live0 = true;
        poseDrawer();
        setOpen(d >= 1);
        render();
        kick();
    })();

    function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(rt);
        io.disconnect();
        off.forEach((f) => f());
        for (const b of bodies) {
            b.btn.replaceWith(b.img);
            b.img.src = b.front;
            b.sh1.remove(); b.sh2.remove();
            b.li.hidden = false;
            b.li.removeAttribute('style');
            b.li.classList.remove('is-held');
        }
        if (mounted) stage.insertBefore(tray, home && home.parentNode === stage ? home : null);
        [shelf, slot, live, hint].forEach((e) => e.remove());
        root.classList.remove('is-live', 'is-open');
        delete root.__spTray;
    }
    return destroy;
}

// Auto-start every [data-specimen-tray] once it is near the viewport.
function autoStart(el) {
    const go = () => {
        if (!('IntersectionObserver' in window)) return specimenTray(el);
        const io = new IntersectionObserver((en) => {
            if (!en[0].isIntersecting) return;
            io.disconnect();
            specimenTray(el);
        }, { rootMargin: '700px' });
        io.observe(el);
    };
    go();                                 // modules run after parsing; images are awaited inside
}
document.querySelectorAll('[data-specimen-tray]').forEach(autoStart);
