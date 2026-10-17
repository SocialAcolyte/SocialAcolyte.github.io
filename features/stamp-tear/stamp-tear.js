/*
 *  STAMP-TEAR // tear a stamp from a perforated sheet and mount it in an album.
 *
 *  A pane of stamps printed on one sheet of paper: round perforation holes in
 *  rows between them, a paper margin (selvage) with its plate number and
 *  colour dots, the perforation lines running out through it to the edge.
 *  The cells take their shape from the designs (12 holes on the short side,
 *  as many on the long side as give an even white margin).
 *  Grab a stamp and pull. It resists: it gives a few pixels, the paper
 *  bridges between the holes stretch across the opening seam and the
 *  perforation rows around it darken with strain. Past the threshold the
 *  bridges snap one after another from your grip outward (an unzip, ~150ms)
 *  and the stamp comes free with the classic half-hole edge and faint torn
 *  fibres on every tooth. The sheet keeps the gap, torn teeth and all.
 *
 *  A free stamp hangs from the point you grabbed it: a physical pendulum
 *  (rigid card, real moment of inertia, gravity, air damping) driven by the
 *  acceleration of your hand, so it swings and turns like a card held at a
 *  corner. Let go over the album and it slides into the nearest empty
 *  pocket, straightened, and gets its colour: the sheet is printed muted,
 *  colour is earned. Let go anywhere else and it settles on the page with a
 *  small rotation and a soft shadow; pick it up again whenever you like.
 *
 *  Markup:  <div data-stamp-tear>
 *             <ul class="st-sheet">
 *               <li><img src="stamp-1.jpg" alt=""></li>   (data-name="…" optional)
 *               …
 *             </ul>
 *             <div class="st-album"></div>      (<img>s in here are singles,
 *           </div>                               already mounted)
 *
 *  Options (data attributes, all optional):
 *    data-threshold="64"   px of pull before the perforations give
 *    data-give="5"         px a stamp shifts in the sheet while resisting
 *    data-unzip="150"      ms for the bridges to snap, grip outward
 *    data-gravity="5200"   px/s² for the hanging swing (bigger = quicker)
 *    data-swing="0.16"     damping ratio of the swing (1 = no overshoot)
 *    data-cols="0"         columns on the sheet; 0 = 4 where there is room, else 3
 *    data-max="128"        largest stamp width, px (portrait; wider shapes get more)
 *    data-aspect="0"       printed design width / height; 0 = read it from the images
 *    data-plate="Nº 1"     plate number printed in the margin ('' for none)
 *    data-hint="…"         small label under the sheet ('' for none)
 *
 *  Or call  stampTear(element, { threshold, give, … })  yourself. Returns
 *  destroy(), which puts the original list back exactly as it was.
 *
 *  Keyboard: Tab to a stamp, Enter (or Space) tears it and carries it to the
 *  next free pocket with the same motion, shortened; focus moves on to the
 *  next stamp. An aria-live line reports each mount. Reduced motion: the
 *  stamp still follows your finger, but it hangs without swinging, tears
 *  instantly and drops straight into place; nothing moves on its own.
 *  Without JS: the stamps are a quiet grid of images. No dependencies.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const num = (v, d) => (v == null || v === '' || isNaN(+v) ? d : +v);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const TAU = Math.PI * 2;
const SVGNS = 'http://www.w3.org/2000/svg';

// Holes per stamp side. The short side always has 12 (about gauge 12 at the
// sizes this draws; real stamps run 11 to 14), the long side as many as make
// the printed design sit in an even white margin. A 10:13 design gives the
// classic 12 x 15.
function holesFor(ad) {
    if (ad < 1) return [12, Math.max(8, Math.round(12 * (0.83 + 0.17 * ad) / ad))];
    return [Math.max(8, Math.round(12 * (0.83 * ad + 0.17))), 12];
}
const OPP = { t: 'b', b: 't', l: 'r', r: 'l' };

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* A tile of paper grain: specks and a few short fibres, very faint. */
let grainURL = '';
function grain() {
    if (grainURL) return grainURL;
    const S = 180, c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    if (!g) return '';
    const rnd = mulberry32(11);
    for (let i = 0; i < 3200; i++) {
        const a = 0.016 + rnd() * 0.05;
        g.fillStyle = rnd() < 0.72 ? `rgba(96,78,54,${a})` : `rgba(255,255,255,${a * 2.2})`;
        g.fillRect(rnd() * S, rnd() * S, rnd() < 0.85 ? 1 : 1.6, 1);
    }
    g.lineWidth = 0.6;
    for (let i = 0; i < 54; i++) {
        const x = rnd() * S, y = rnd() * S, ang = rnd() * TAU, l = 3 + rnd() * 10;
        g.strokeStyle = `rgba(112,92,64,${0.03 + rnd() * 0.05})`;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(ang + .7) * l * .5, y + Math.sin(ang + .7) * l * .5,
            x + Math.cos(ang) * l, y + Math.sin(ang) * l);
        g.stroke();
    }
    grainURL = c.toDataURL('image/png');
    return grainURL;
}

const f2 = (v) => +v.toFixed(2);
const circle = (x, y, r) => `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}"/>`;
const svgMask = (w, h, white, black) => `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="${SVGNS}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><mask id="m">` +
    `<g fill="#fff">${white}</g><g fill="#000">${black}</g></mask></defs>` +
    `<rect width="${w}" height="${h}" mask="url(#m)"/></svg>`)}")`;

/* One stamp: a rectangle with half holes all round, so that two neighbours
   side by side make whole holes and the paper between them is the bridge. */
function cellMask(W, H, px, py, r, HX, HY) {
    let holes = '';
    for (let i = 0; i <= HX; i++) holes += circle(i * px, 0, r) + circle(i * px, H, r);
    for (let j = 1; j < HY; j++) holes += circle(0, j * py, r) + circle(W, j * py, r);
    return svgMask(W, H, `<rect width="${W}" height="${H}"/>`, holes);
}

/* The margin: a frame around the pane, half holes along its inner edge, and
   the perforation lines carried on out through it to the cut edge. */
function selvageMask(g) {
    const { W, H, m, cols, rows, px, py, r, PW, PH, hx: HX, hy: HY } = g;
    const iw = cols * W, ih = rows * H;
    let holes = `<rect x="${m}" y="${m}" width="${iw}" height="${ih}"/>`;
    for (let k = 0; k <= cols * HX; k++) holes += circle(m + k * px, m, r) + circle(m + k * px, m + ih, r);
    for (let k = 1; k < rows * HY; k++) holes += circle(m, m + k * py, r) + circle(m + iw, m + k * py, r);
    for (let c = 0; c <= cols; c++) {
        const x = m + c * W;
        for (let y = m - py; y > r * 1.6; y -= py) holes += circle(x, y, r);
        for (let y = m + ih + py; y < PH - r * 1.6; y += py) holes += circle(x, y, r);
    }
    for (let rr = 0; rr <= rows; rr++) {
        const y = m + rr * H;
        for (let x = m - px; x > r * 1.6; x -= px) holes += circle(x, y, r);
        for (let x = m + iw + px; x < PW - r * 1.6; x += px) holes += circle(x, y, r);
    }
    return svgMask(PW, PH, `<rect width="${PW}" height="${PH}"/>`, holes);
}

/* Geometry of one edge of a cell, in the cell's own coordinates. The normal
   points out of the stamp. */
function edgeOf(e, W, H, px, py, HX, HY) {
    if (e === 't') return { ox: 0, oy: 0, tx: 1, ty: 0, nx: 0, ny: -1, n: HX, p: px };
    if (e === 'b') return { ox: 0, oy: H, tx: 1, ty: 0, nx: 0, ny: 1, n: HX, p: px };
    if (e === 'l') return { ox: 0, oy: 0, tx: 0, ty: 1, nx: -1, ny: 0, n: HY, p: py };
    return { ox: W, oy: 0, tx: 0, ty: 1, nx: 1, ny: 0, n: HY, p: py };
}

/* Torn teeth: each bridge ends in a ragged tip of paper and a few hairs. */
function fibres(seed, E, r, flip) {
    const rnd = mulberry32(seed);
    const nx = flip ? -E.nx : E.nx, ny = flip ? -E.ny : E.ny;
    const at = (s, o) => `${f2(E.ox + E.tx * s + nx * o)} ${f2(E.oy + E.ty * s + ny * o)}`;
    let nub = '', hair = '';
    for (let k = 0; k < E.n; k++) {
        const s0 = k * E.p + r * 0.9, s1 = (k + 1) * E.p - r * 0.9;
        if (s1 <= s0) continue;
        nub += `M${at(s0, -0.5)}`;
        const steps = 6;
        for (let j = 0; j <= steps; j++) {
            const env = Math.sin(Math.PI * j / steps);
            nub += `L${at(mix(s0, s1, j / steps), env * r * (0.1 + rnd() * 0.42))}`;
        }
        nub += `L${at(s1, -0.5)}Z`;
        const count = 1 + Math.floor(rnd() * 3);
        for (let h = 0; h < count; h++) {
            const s = mix(s0, s1, 0.15 + rnd() * 0.7);
            const o = r * (0.08 + rnd() * 0.18);
            const a = (rnd() - 0.5) * 1.5, len = r * (0.3 + rnd() * 0.6);
            const ds = Math.sin(a) * len, dn = Math.cos(a) * len;
            hair += `M${at(s, o)}Q${at(s + ds * 0.4 + (rnd() - .5) * r * .3, o + dn * 0.55)} ${at(s + ds, o + dn)}`;
        }
    }
    return `<path class="st-nub" d="${nub}"/><path class="st-hair" d="${hair}"/>`;
}

export function stampTear(root, opts = {}) {
    const sheet = root && root.querySelector('.st-sheet');
    if (!root || !sheet || root.classList.contains('st-live')) return () => {};
    const lis = [...sheet.children].filter((n) => n.tagName === 'LI');
    if (!lis.length) return () => {};
    const ds = root.dataset;
    const pick = (k, d) => opts[k] ?? ds[k] ?? d;
    const cfg = {
        threshold: num(pick('threshold'), 64),
        give: num(pick('give'), 5),
        unzip: num(pick('unzip'), 150),
        gravity: num(pick('gravity'), 5200),
        swing: num(pick('swing'), 0.16),
        cols: num(pick('cols'), 0),
        max: num(pick('max'), 128),
        plate: String(pick('plate', 'Nº 1')),
        aspect: num(pick('aspect'), 0),
        hint: String(pick('hint', 'Pull a stamp free')),
    };
    const N = lis.length;
    const made = [];
    const el = (tag, cls, parent, attrs) => {
        const e = tag === 'svg' ? document.createElementNS(SVGNS, 'svg') : document.createElement(tag);
        if (cls) e.setAttribute('class', cls);
        if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(e);
        made.push(e);
        return e;
    };

    /* ---- build ---------------------------------------------------------- */
    const home = { parent: sheet.parentNode, next: sheet.nextSibling };
    root.classList.add('st-live');
    const g0 = grain();
    if (g0) root.style.setProperty('--st-grain', `url(${g0})`);

    const col = el('div', 'st-col');
    sheet.parentNode.insertBefore(col, sheet);
    const pane = el('div', 'st-pane', col);
    el('div', 'st-selvage', pane, { 'aria-hidden': 'true' });
    pane.appendChild(sheet);
    const selFib = el('svg', 'st-fib st-fib-selvage', pane, { 'aria-hidden': 'true' });
    const marks = el('div', 'st-marks', pane, { 'aria-hidden': 'true' });
    const plate = el('span', 'st-mark st-plate', marks);
    plate.textContent = cfg.plate;
    const dots = el('span', 'st-mark st-dots', marks);
    for (let i = 0; i < 4; i++) el('i', '', dots);
    const control = el('span', 'st-mark st-control', marks);
    control.textContent = String(1000 + ((N * 7919) % 9000)).slice(0, 4);
    const overlay = el('canvas', 'st-strain', pane, { 'aria-hidden': 'true' });
    const octx = overlay.getContext('2d');

    const bar = el('div', 'st-bar', col);
    const hint = el('span', 'st-hint', bar, { 'aria-hidden': 'true' });
    hint.textContent = cfg.hint;
    const btn = el('button', 'st-new', bar, { type: 'button' });
    btn.textContent = 'New sheet';
    btn.disabled = true;

    let album = root.querySelector('.st-album');
    const ownAlbum = !album;
    if (!album) { album = el('div', 'st-album'); col.after(album); }
    // <img>s already in the album are singles: mounted from the start
    const singleImgs = [...album.children].filter((n) => n.tagName === 'IMG');
    const albumHome = singleImgs.map((im) => ({ im, next: im.nextSibling }));
    const leaf = el('div', 'st-leaf', album);
    const folio = el('span', 'st-folio', leaf, { 'aria-hidden': 'true' });
    // pockets: the singles' first (a row or two of collection), then one per sheet stamp
    const NS = singleImgs.length, NM = N + NS;
    const mounts = Array.from({ length: NM }, () => ({ el: el('div', 'st-mount'), s: null }));
    const singles = singleImgs.map((im, k) => {
        const e = document.createElement('div');
        e.className = 'st-stamp st-single is-mounted is-inked';
        e.setAttribute('aria-hidden', 'true');
        const paper = document.createElement('div');
        paper.className = 'st-paper';
        im.draggable = false;
        paper.appendChild(im);
        const fib = document.createElementNS(SVGNS, 'svg');
        fib.setAttribute('class', 'st-fib');
        e.append(paper, fib);
        const sg = { im, el: e, fib, k, single: true, state: 'mounted' };
        mounts[k].s = sg;
        mounts[k].el.classList.add('is-filled');
        mounts[k].el.appendChild(e);
        return sg;
    });
    let rowEls = [];
    const sheetMounted = () => mounts.filter((x) => x.s && !x.s.single && x.s.state === 'mounted').length;

    const layer = el('div', 'st-layer', root);
    const status = el('p', 'st-sr', root, { 'aria-live': 'polite' });
    const hintId = `st-hint-${Math.random().toString(36).slice(2, 8)}`;
    const srHint = el('span', 'st-sr', root, { id: hintId });
    srHint.textContent = 'Enter tears it off and mounts it in the album.';

    const stamps = lis.map((li, i) => {
        const img = li.querySelector('img');
        li.classList.add('st-cell');
        const e = document.createElement('div');
        e.className = 'st-stamp';
        e.tabIndex = 0;
        e.setAttribute('role', 'button');
        e.setAttribute('aria-label', li.dataset.name || `Stamp ${i + 1} of ${N}`);
        e.setAttribute('aria-describedby', hintId);
        const paper = document.createElement('div');
        paper.className = 'st-paper';
        if (img) { img.draggable = false; img.setAttribute('aria-hidden', 'true'); paper.appendChild(img); }
        const fib = document.createElementNS(SVGNS, 'svg');
        fib.setAttribute('class', 'st-fib');
        fib.setAttribute('aria-hidden', 'true');
        e.append(paper, fib);
        li.appendChild(e);
        return {
            i, li, el: e, img, fib, row: 0, col: 0, state: 'sheet', edges: new Set(),
            d: { x: 0, y: 0 }, dv: { x: 0, y: 0 },
            x: 0, y: 0, th: 0, om: 0, sc: 1, lift: 0,
            vx: 0, vy: 0, vth: 0, vsc: 0, vlift: 0,
            px: 0, py: 0, pvx: 0, pvy: 0, gx: 0, gy: 0,
            src: null, mount: -1, bridges: [], holes: [], auto: null,
        };
    });
    let selvageEdges = [];

    /* ---- geometry --------------------------------------------------------- */
    let G = null;
    let card = '#fcfaf4';
    const OP = 8; // overlay overhang, px

    // the sheet's shape comes from its designs: the median natural aspect
    let lastAd = 0;
    function designAspect() {
        const as = lis.map((li) => li.querySelector('img')).filter((im) => im && im.naturalWidth)
            .map((im) => im.naturalWidth / im.naturalHeight).sort((a, b) => a - b);
        lastAd = as.length ? as[as.length >> 1] : 0;
        return lastAd;
    }
    const onImg = () => {
        const before = lastAd;
        if (!cfg.aspect && Math.abs(designAspect() - before) > 0.01) layout();
    };

    function layout() {
        const rw = root.clientWidth;
        if (!rw) return;
        const wide = rw >= 920;
        root.classList.toggle('st-wide', wide);
        const area = wide ? Math.floor((rw - clamp(rw * 0.06, 40, 96)) / 2) : rw;
        const cols = cfg.cols || (area >= 500 ? 4 : 3);
        const rows = Math.ceil(N / cols);
        const m = Math.round(clamp(area * 0.05, 16, 26));
        const ad = cfg.aspect || designAspect() || 0.77;
        const [HX, HY] = holesFor(ad);
        const big = cfg.max * Math.max(1, HX / 12 * 0.82);
        const W = Math.max(48, Math.floor(Math.min(big, (area - 2 * m) / cols)));
        const H = Math.round(W * HY / HX);
        const px = W / HX, py = H / HY, r = Math.min(px, py) * 0.335;
        const PW = cols * W + 2 * m, PH = rows * H + 2 * m;
        const inset = Math.round(Math.min(W, H) * 0.085);
        G = { W, H, m, cols, rows, px, py, r, PW, PH, inset, wide, hx: HX, hy: HY };

        // album page
        // pockets snug to the stamps, at about two thirds size, so the page
        // stays quieter and smaller than the sheet
        const gx = Math.round(W * 0.09), lp = Math.round(clamp(W * 0.16, 12, 22));
        const a = (0.68 * cols * W - (cols - 1) * gx) / (cols * W);
        Object.assign(G, { a, MW: Math.round(W * a), MH: Math.round(H * a), gx, lp, gy: Math.round(H * a * 0.24) });

        const S = root.style;
        S.setProperty('--st-w', W + 'px'); S.setProperty('--st-h', H + 'px');
        S.setProperty('--st-m', m + 'px'); S.setProperty('--st-cols', cols);
        S.setProperty('--st-pw', PW + 'px'); S.setProperty('--st-ph', PH + 'px');
        S.setProperty('--st-inset', inset + 'px');
        S.setProperty('--st-mw', G.MW + 'px'); S.setProperty('--st-mh', G.MH + 'px');
        S.setProperty('--st-gx', gx + 'px'); S.setProperty('--st-gy', G.gy + 'px'); S.setProperty('--st-lp', lp + 'px');
        S.setProperty('--st-cell-mask', cellMask(W, H, px, py, r, HX, HY));
        S.setProperty('--st-selvage-mask', selvageMask(G));
        card = getComputedStyle(root).getPropertyValue('--st-card').trim() || card;

        stamps.forEach((s, i) => { s.row = Math.floor(i / cols); s.col = i % cols; s.fib.setAttribute('width', W); s.fib.setAttribute('height', H); });
        selFib.setAttribute('width', PW); selFib.setAttribute('height', PH);

        // margin inscriptions sit between the perforation lines
        const fs = clamp(m * 0.36, 6.5, 8.5);
        marks.style.fontSize = fs + 'px';
        plate.style.cssText = `left:${m + W * 0.12}px;top:${(m - fs) / 2}px`;
        control.style.cssText = `right:${m + W * 0.12}px;bottom:${(m - fs) / 2}px`;
        dots.style.cssText = `left:${m + W * 0.12}px;bottom:${(m - fs * 0.9) / 2}px;--d:${fs * 0.9}px`;

        const dpr = Math.min(2, devicePixelRatio || 1);
        overlay.width = (PW + 2 * OP) * dpr; overlay.height = (PH + 2 * OP) * dpr;
        overlay.style.cssText = `left:${-OP}px;top:${-OP}px;width:${PW + 2 * OP}px;height:${PH + 2 * OP}px`;
        octx.setTransform(dpr, 0, 0, dpr, 0, 0);

        layoutAlbum();
        renderAllFibres();
        updateGaps();
        for (const s of stamps) {
            if (s.state === 'mounted') placeMounted(s);
            if (s.state === 'loose') { keepInside(s); applyFree(s); }
        }
    }

    /* ---- fibres ------------------------------------------------------------ */
    function renderFibres(s) {
        const { W, H, px, py, r } = G;
        let out = '';
        for (const e of s.edges) out += fibres(s.i * 31 + e.charCodeAt(0), edgeOf(e, W, H, px, py, G.hx, G.hy), r, false);
        s.fib.innerHTML = out;
    }
    function renderSelvage() {
        const { W, H, px, py, r, m } = G;
        let out = '';
        for (const { i, e } of selvageEdges) {
            const s = stamps[i], E = edgeOf(e, W, H, px, py, G.hx, G.hy);
            E.ox += m + s.col * W; E.oy += m + s.row * H;
            out += fibres(i * 17 + e.charCodeAt(0) + 999, E, r, true);
        }
        selFib.innerHTML = out;
    }
    function renderAllFibres() { stamps.forEach(renderFibres); renderSelvage(); }

    // a gap is shaded only from the sides where paper still stands
    function updateGaps() {
        for (const s of stamps) {
            if (!s.li.classList.contains('is-gone')) continue;
            for (const e of ['t', 'l', 'r']) {
                const rr = s.row + (e === 'b') - (e === 't'), c = s.col + (e === 'r') - (e === 'l');
                const j = rr * G.cols + c;
                const paper = rr < 0 || c < 0 || c >= G.cols || (j < N && !stamps[j].li.classList.contains('is-gone'));
                s.li.style.setProperty('--st-g' + e, paper ? 1 : 0);
            }
        }
    }

    function neighbour(s, e) {
        const rr = s.row + (e === 'b') - (e === 't'), c = s.col + (e === 'r') - (e === 'l');
        if (rr < 0 || c < 0 || c >= G.cols || rr >= G.rows) return 'selvage';
        const j = rr * G.cols + c;
        if (j >= N) return null;
        const nb = stamps[j];
        return nb.state === 'sheet' || nb.state === 'return' ? nb : null;
    }

    /* ---- coordinates (root-local) -------------------------------------------- */
    let rootRect = root.getBoundingClientRect();
    const ptr = { cx: 0, cy: 0 };
    const local = () => ({ x: ptr.cx - rootRect.left, y: ptr.cy - rootRect.top });
    function cellOrigin(s) {
        const p = pane.getBoundingClientRect();
        return { x: p.left - rootRect.left + G.m + s.col * G.W, y: p.top - rootRect.top + G.m + s.row * G.H };
    }
    function mountCentre(mi) {
        const r = mounts[mi].el.getBoundingClientRect();
        return { x: r.left - rootRect.left + r.width / 2, y: r.top - rootRect.top + r.height / 2 };
    }
    function leafRect() {
        const r = leaf.getBoundingClientRect();
        return { l: r.left - rootRect.left, t: r.top - rootRect.top, r: r.right - rootRect.left, b: r.bottom - rootRect.top };
    }
    function nearestEmpty(c) {
        let best = -1, bd = Infinity;
        mounts.forEach((mt, k) => {
            if (mt.s) return;
            const p = mountCentre(k), d = Math.hypot(p.x - c.x, p.y - c.y);
            if (d < bd) { bd = d; best = k; }
        });
        return best;
    }
    const firstEmpty = () => mounts.findIndex((mt) => !mt.s);
    function overAlbum(s) {
        // over it if the stamp, or the hand holding it, is over the page
        const R = leafRect(), pad = 14;
        const inside = (x, y) => x > R.l - pad && x < R.r + pad && y > R.t - pad && y < R.b + pad;
        return inside(s.x, s.y) || (s.state === 'held' && inside(s.px, s.py));
    }
    function keepInside(s) {
        const w = root.clientWidth, h = root.clientHeight, hw = G.W * 0.4, hh = G.H * 0.4;
        s.x = clamp(s.x, hw, Math.max(hw, w - hw));
        s.y = clamp(s.y, hh, Math.max(hh, h - hh));
    }

    /* ---- drawing ------------------------------------------------------------- */
    function applySheet(s) { s.el.style.transform = `translate(${f2(s.d.x)}px,${f2(s.d.y)}px)`; }
    function applyFree(s) {
        const { W, H } = G;
        s.el.style.transform = `translate3d(${f2(s.x - W / 2)}px,${f2(s.y - H / 2)}px,0) rotate(${s.th.toFixed(4)}rad) scale(${s.sc.toFixed(4)})`;
        // the shadow falls straight down the screen, so undo the card's turn
        const L = clamp(s.lift, 0, 1.2), c = Math.cos(-s.th), sn = Math.sin(-s.th);
        const sh = (ox, oy, blur, a) => {
            const lx = (c * ox - sn * oy) / s.sc, ly = (sn * ox + c * oy) / s.sc;
            return `drop-shadow(${f2(lx)}px ${f2(ly)}px ${f2(blur / s.sc)}px rgba(38,26,14,${a.toFixed(3)}))`;
        };
        s.el.style.filter = `${sh(0, 0.6 + 1.5 * L, 0.6 + 1.6 * L, 0.22 * (1 - L * 0.6))} ${sh(0, 3 + 13 * L, 5 + 16 * L, 0.10 + 0.08 * L)}`;
    }
    // a single keeps its own shape and true size, perforated at the sheet's
    // gauge and torn all round; its pocket is cut to fit it
    function placeSingle(sg) {
        const ad = sg.im.naturalWidth ? sg.im.naturalWidth / sg.im.naturalHeight : 0.77;
        const [hx, hy] = holesFor(ad);
        const p = Math.min(G.px, G.py), Ws = Math.round(hx * p), Hs = Math.round(hy * p);
        const pxs = Ws / hx, pys = Hs / hy;
        const sc = G.a, pw = Math.round(Ws * sc), ph = Math.round(Hs * sc);
        const box = mounts[sg.k].el.style;
        box.width = pw + 'px'; box.height = ph + 'px';
        const st = sg.el.style;
        st.setProperty('--st-w', Ws + 'px'); st.setProperty('--st-h', Hs + 'px');
        st.setProperty('--st-inset', Math.round(Math.min(Ws, Hs) * 0.085) + 'px');
        st.setProperty('--st-cell-mask', cellMask(Ws, Hs, pxs, pys, G.r, hx, hy));
        st.transform = `translate(${f2((pw - Ws) / 2)}px,${f2((ph - Hs) / 2)}px) scale(${sc.toFixed(4)})`;
        sg.fib.setAttribute('width', Ws); sg.fib.setAttribute('height', Hs);
        let out = '';
        for (const e of ['t', 'r', 'b', 'l']) out += fibres(sg.k * 53 + e.charCodeAt(0), edgeOf(e, Ws, Hs, pxs, pys, hx, hy), G.r, false);
        sg.fib.innerHTML = out;
        return { w: pw, h: ph };
    }
    const onSingle = () => { if (G) layoutAlbum(); };

    // rows as even as possible, so no row is left with a lonely pocket
    const split = (n, k) => Array.from({ length: k }, (_, i) => Math.floor(n / k) + (i < n % k ? 1 : 0));
    function layoutAlbum() {
        const sizes = singles.map(placeSingle);
        const maxW = G.cols * G.W * 0.92;
        const rowsOf = [];
        if (NS) {
            for (let k = 1; k <= NS; k++) {
                const parts = split(NS, k);
                let at = 0, fits = true;
                const rows = parts.map((n) => { const r0 = sizes.slice(at, at + n); at += n; return r0; });
                for (const r0 of rows) if (r0.reduce((t, z) => t + z.w, 0) + (r0.length - 1) * G.gx > maxW) fits = false;
                if (fits || k === NS) {
                    at = 0;
                    for (const n of parts) { rowsOf.push(mounts.slice(at, at + n).map((mt, j) => [mt, sizes[at + j].h])); at += n; }
                    break;
                }
            }
        }
        let at = NS;
        for (const n of split(N, Math.ceil(N / G.cols))) {
            rowsOf.push(mounts.slice(at, at + n).map((mt) => [mt, G.MH]));
            at += n;
        }
        for (const r0 of rowEls) r0.remove();
        rowEls = rowsOf.map((list) => {
            const row = document.createElement('div');
            row.className = 'st-row';
            for (const [mt] of list) row.appendChild(mt.el);
            row.style.setProperty('--st-sh', Math.round(Math.min(...list.map((x) => x[1])) * 0.56) + 'px');
            leaf.insertBefore(row, folio);
            return row;
        });
    }

    function placeMounted(s) {
        const { W, H, MW, MH, a } = G;
        s.el.style.transform = `translate(${f2((MW - W) / 2)}px,${f2((MH - H) / 2)}px) scale(${a.toFixed(4)})`;
        s.el.style.filter = '';
    }

    let overlayDirty = false;
    function drawStrain(now) {
        if (overlayDirty) { octx.clearRect(0, 0, G.PW + 2 * OP, G.PH + 2 * OP); overlayDirty = false; }
        const live = stamps.filter((s) => s.state === 'strain' || s.state === 'unzip' || s.state === 'return');
        if (!live.length) return;
        overlayDirty = true;
        const ctx = octx, r = G.r;
        ctx.save();
        ctx.translate(OP, OP);
        for (const s of live) {
            const d = s.d, mag = Math.hypot(d.x, d.y);
            const strain = clamp(mag / cfg.give);
            // the perforation rows around it darken as the paper takes the load:
            // each hole, and the slot it opens into, fills with shadow
            for (const h of s.holes) {
                const a = strain * 0.36 * (0.3 + 0.7 * h.w);
                if (a < 0.01) continue;
                const a0 = Math.atan2(h.ny, h.nx);
                ctx.fillStyle = `rgba(58,40,22,${a.toFixed(3)})`;
                ctx.beginPath();
                ctx.arc(h.x, h.y, r, a0 - Math.PI / 2, a0 + Math.PI / 2);
                ctx.arc(h.x + d.x, h.y + d.y, r, a0 + Math.PI / 2, a0 + Math.PI * 1.5);
                ctx.closePath();
                ctx.fill();
            }
            // the bridges stretch across the opening seam, necking as they go
            for (const b of s.bridges) {
                const open = -(d.x * b.nx + d.y * b.ny);
                if (b.snapped) {
                    const age = now - b.snapAt;
                    if (age > 70 || open < 0.3) continue;
                    const k = (1 - age / 70) * 0.32, hw = b.hw * 0.7;
                    ctx.fillStyle = card;
                    for (const [x0, y0, sx, sy] of [[b.x, b.y, d.x * k, d.y * k], [b.x + d.x, b.y + d.y, -d.x * k, -d.y * k]]) {
                        ctx.beginPath();
                        ctx.moveTo(x0 - b.tx * hw, y0 - b.ty * hw);
                        ctx.lineTo(x0 + sx - b.tx * hw * 0.3, y0 + sy - b.ty * hw * 0.3);
                        ctx.lineTo(x0 + sx + b.tx * hw * 0.3, y0 + sy + b.ty * hw * 0.3);
                        ctx.lineTo(x0 + b.tx * hw, y0 + b.ty * hw);
                        ctx.fill();
                    }
                    continue;
                }
                if (open < 0.15) continue;
                const neck = b.hw * (1 - 0.55 * clamp(open / (cfg.give * 1.1)));
                const mx = b.x + d.x / 2, my = b.y + d.y / 2;
                const a1x = b.x - b.tx * b.hw, a1y = b.y - b.ty * b.hw;
                const a2x = b.x + b.tx * b.hw, a2y = b.y + b.ty * b.hw;
                ctx.beginPath();
                ctx.moveTo(a1x - b.nx * 0.4, a1y - b.ny * 0.4);
                ctx.quadraticCurveTo(mx - b.tx * neck, my - b.ty * neck, a1x + d.x + b.nx * 0.4, a1y + d.y + b.ny * 0.4);
                ctx.lineTo(a2x + d.x + b.nx * 0.4, a2y + d.y + b.ny * 0.4);
                ctx.quadraticCurveTo(mx + b.tx * neck, my + b.ty * neck, a2x - b.nx * 0.4, a2y - b.ny * 0.4);
                ctx.closePath();
                ctx.fillStyle = card;
                ctx.fill();
                ctx.strokeStyle = `rgba(110,88,60,${(0.12 + 0.2 * strain).toFixed(3)})`;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(a1x, a1y); ctx.quadraticCurveTo(mx - b.tx * neck, my - b.ty * neck, a1x + d.x, a1y + d.y);
                ctx.moveTo(a2x, a2y); ctx.quadraticCurveTo(mx + b.tx * neck, my + b.ty * neck, a2x + d.x, a2y + d.y);
                ctx.stroke();
            }
        }
        ctx.restore();
    }

    /* ---- states ---------------------------------------------------------------
       sheet → strain → unzip → held → settle-mount → mounted
                  ↘ return (let go early)   ↘ settle-loose → loose → held …    */

    function beginStrain(s, grab) {
        s.state = 'strain';
        s.grab = grab;
        s.li.classList.add('is-pulled');
        const { W, H, px, py, r, m } = G;
        const o = cellOrigin(s);
        const pane0 = { x: o.x - m - s.col * W, y: o.y - m - s.row * H };
        const gpx = grab.x - pane0.x, gpy = grab.y - pane0.y;  // grip in pane coords
        const cx0 = m + s.col * W, cy0 = m + s.row * H;
        s.bridges = []; s.holes = []; s.attached = [];
        for (const e of ['t', 'r', 'b', 'l']) {
            const nb = neighbour(s, e);
            if (!nb) continue;
            s.attached.push([e, nb]);
            const E = edgeOf(e, W, H, px, py, G.hx, G.hy);
            const side = e === 'l' || e === 'r';
            for (let k = 0; k <= E.n; k++) {
                const x = cx0 + E.ox + E.tx * k * E.p, y = cy0 + E.oy + E.ty * k * E.p;
                if (!side || (k > 0 && k < E.n)) s.holes.push({ x, y, nx: E.nx, ny: E.ny, w: Math.exp(-Math.hypot(x - gpx, y - gpy) / (W * 0.9)) });
                if (k === E.n) continue;
                const bx = cx0 + E.ox + E.tx * (k + 0.5) * E.p, by = cy0 + E.oy + E.ty * (k + 0.5) * E.p;
                s.bridges.push({ x: bx, y: by, tx: E.tx, ty: E.ty, nx: E.nx, ny: E.ny, hw: E.p / 2 - r,
                    dist: Math.hypot(bx - gpx, by - gpy), snapped: false, at: 0, snapAt: 0 });
            }
        }
    }

    function strainOffset(s, p) {
        const Dx = p.x - s.grab.x, Dy = p.y - s.grab.y, D = Math.hypot(Dx, Dy);
        if (D < 1e-3) return { x: 0, y: 0, D };
        const k = cfg.give * (1 - Math.exp(-D / (cfg.threshold * 0.45))) / D;
        return { x: Dx * k, y: Dy * k, D };
    }

    function beginUnzip(s, now, dur) {
        s.state = 'unzip';
        s.t0 = now;
        s.dur = dur;
        s.d0 = { x: s.d.x, y: s.d.y };
        const sorted = [...s.bridges].sort((a, b) => a.dist - b.dist);
        const rnd = mulberry32(s.i * 97 + 5);
        sorted.forEach((b, k) => {
            const t = sorted.length > 1 ? k / (sorted.length - 1) : 1;
            b.at = dur * clamp(Math.pow(t, 0.85) + (rnd() - 0.5) * 0.06);
        });
    }

    function tearFree(s, now) {
        // fibres on both sides of every bridge that just broke
        for (const [e, nb] of s.attached) {
            s.edges.add(e);
            if (nb === 'selvage') selvageEdges.push({ i: s.i, e });
            else { nb.edges.add(OPP[e]); renderFibres(nb); }
        }
        renderFibres(s);
        renderSelvage();
        // a tiny tick under the finger, where phones allow it
        if (s.touch && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
            try { navigator.vibrate(8); } catch (e) { /* not everywhere */ }
        }

        const o = cellOrigin(s);
        s.x = o.x + G.W / 2 + s.d.x; s.y = o.y + G.H / 2 + s.d.y;
        s.th = 0; s.om = 0; s.sc = 1; s.lift = 0; s.vsc = 0; s.vlift = 0;
        s.gx = s.grab.x - (o.x + G.W / 2); s.gy = s.grab.y - (o.y + G.H / 2);
        s.px = s.grab.x + s.d.x; s.py = s.grab.y + s.d.y; s.pvx = 0; s.pvy = 0;
        s.d = { x: 0, y: 0 };
        s.li.classList.remove('is-pulled');
        s.li.classList.add('is-gone');
        updateGaps();
        s.el.style.transform = '';
        s.el.classList.add('is-free');
        layer.appendChild(s.el);
        s.state = 'held';
        s.tFree = now;
        setSwing(s);
        applyFree(s);
        btn.disabled = false;
        // let go during the unzip: it still comes away, and drops at once
        if (s.letGo) { s.letGo = false; drop(s); }
    }

    function setSwing(s) {
        const k = (G.W * G.W + G.H * G.H) / 12, L = Math.hypot(s.gx, s.gy);
        const wn = Math.sqrt(cfg.gravity * L / (k + L * L));
        s.damp = Math.max(1.4, 2 * (calm.matches ? 1.3 : cfg.swing) * wn);
        s.kI = k;
    }

    function pickUp(s, p, now) {
        const c = Math.cos(-s.th), sn = Math.sin(-s.th), dx = (p.x - s.x) / s.sc, dy = (p.y - s.y) / s.sc;
        s.gx = c * dx - sn * dy; s.gy = sn * dx + c * dy;
        s.px = p.x; s.py = p.y; s.pvx = 0; s.pvy = 0;
        s.om = s.vth || 0;
        s.state = 'held';
        s.tFree = now - 400;
        setSwing(s);
        layer.appendChild(s.el);
    }

    /* The hanging card. The pivot chases the hand through a stiff spring (so
       its acceleration is smooth), and the card turns about the pivot under
       gravity minus that acceleration: I·θ'' = r × m(g − a). */
    function stepHeld(s, dt, now) {
        const P = s.src(now);
        const w = mix(26, 70, clamp((now - s.tFree) / 260));
        const ax0 = w * w * (P.x - s.px) - 2 * w * s.pvx, ay0 = w * w * (P.y - s.py) - 2 * w * s.pvy;
        s.pvx += ax0 * dt; s.pvy += ay0 * dt; s.px += s.pvx * dt; s.py += s.pvy * dt;
        let ax = ax0, ay = ay0;
        const am = Math.hypot(ax, ay), cap = 26000;
        if (am > cap) { ax *= cap / am; ay *= cap / am; }
        const c = Math.cos(s.th), sn = Math.sin(s.th);
        const rx = -(c * s.gx - sn * s.gy) * s.sc, ry = -(sn * s.gx + c * s.gy) * s.sc;
        const torque = rx * (cfg.gravity - ay) + ry * ax;
        const alpha = torque / (s.kI * s.sc * s.sc + rx * rx + ry * ry) - s.damp * s.om - 0.04 * s.om * Math.abs(s.om);
        s.om += alpha * dt;
        s.th += s.om * dt;
        const c2 = Math.cos(s.th), s2 = Math.sin(s.th);
        s.x = s.px - (c2 * s.gx - s2 * s.gy) * s.sc;
        s.y = s.py - (s2 * s.gx + c2 * s.gy) * s.sc;
    }

    function spring(s, k, v, target, w, z, dt) {
        const a = w * w * (target - s[k]) - 2 * z * w * s[v];
        s[v] += a * dt;
        s[k] += s[v] * dt;
        return Math.abs(target - s[k]) < 0.05 && Math.abs(s[v]) < 0.5;
    }

    function drop(s) {
        s.src = null;
        clearTarget();
        if (overAlbum(s)) {
            const mi = nearestEmpty({ x: s.x, y: s.y });
            if (mi >= 0) return toMount(s, mi);
        }
        toLoose(s);
    }

    function toMount(s, mi) {
        mounts[mi].s = s;
        s.mount = mi;
        s.state = 'settle-mount';
        s.vx = s.pvx; s.vy = s.pvy; s.vth = s.om;
        s.th = wrapAngle(s.th);
        s.el.classList.add('is-inked');
        s.el.tabIndex = -1;
        s.el.setAttribute('aria-disabled', 'true');
        if (calm.matches) finishMount(s);
    }

    function finishMount(s) {
        const mt = mounts[s.mount];
        s.state = 'mounted';
        mt.el.classList.add('is-filled');
        mt.el.appendChild(s.el);
        s.el.classList.remove('is-free');
        s.el.classList.add('is-mounted');
        placeMounted(s);
        const n = sheetMounted();
        folio.textContent = `${n} / ${N}`;
        say(`${s.el.getAttribute('aria-label')} mounted. ${n} of ${N} in the album.`);
    }

    function toLoose(s) {
        s.state = 'settle-loose';
        s.vx = s.pvx * 0.6; s.vy = s.pvy * 0.6; s.vth = s.om * 0.5;
        s.th = wrapAngle(s.th);
        const rnd = mulberry32(s.i * 13 + Math.round(s.x));
        const lim = 6 * Math.PI / 180;
        s.restTh = clamp(s.th * 0.22, -lim, lim) + (rnd() - 0.5) * 0.05;
        s.restX = s.x + s.pvx * 0.05; s.restY = s.y + s.pvy * 0.05;
        const t = { x: s.restX, y: s.restY };
        keepInside(t);
        s.restX = t.x; s.restY = t.y;
        if (calm.matches) { s.x = s.restX; s.y = s.restY; s.th = s.restTh; s.sc = 1; s.lift = 0; finishLoose(s); }
    }
    function finishLoose(s) {
        s.state = 'loose';
        s.vx = s.vy = s.vth = 0;
        applyFree(s);
        say(`${s.el.getAttribute('aria-label')} set down on the page.`);
    }

    let targetMount = -1;
    function clearTarget() {
        if (targetMount >= 0) mounts[targetMount].el.classList.remove('is-target');
        targetMount = -1;
    }
    function showTarget(s) {
        const mi = overAlbum(s) ? nearestEmpty({ x: s.x, y: s.y }) : -1;
        if (mi === targetMount) return;
        clearTarget();
        if (mi >= 0) { mounts[mi].el.classList.add('is-target'); targetMount = mi; }
    }

    /* One frame for one stamp. Returns true while it still needs frames. */
    function step(s, dt, now) {
        switch (s.state) {
            case 'strain': {
                const o = strainOffset(s, s.src(now));
                s.d = o;
                applySheet(s);
                if (o.D >= s.thr) {
                    if (calm.matches || s.zip <= 0) { tearFree(s, now); return true; }
                    beginUnzip(s, now, s.zip);
                }
                return true;
            }
            case 'unzip': {
                const t = clamp((now - s.t0) / s.dur);
                // the paper lets go: a little more give as the bridges fail
                const k = 1 + 0.7 * t;
                s.d = { x: s.d0.x * k, y: s.d0.y * k };
                applySheet(s);
                for (const b of s.bridges) if (!b.snapped && now - s.t0 >= b.at) { b.snapped = true; b.snapAt = now; }
                if (t >= 1) tearFree(s, now);
                return true;
            }
            case 'return': {
                const z = s.tug ? 0.42 : 0.55, w = 34;
                for (const k of ['x', 'y']) {
                    const a = w * w * (0 - s.d[k]) - 2 * z * w * s.dv[k];
                    s.dv[k] += a * dt; s.d[k] += s.dv[k] * dt;
                }
                applySheet(s);
                if (Math.hypot(s.d.x, s.d.y) < 0.03 && Math.hypot(s.dv.x, s.dv.y) < 1) {
                    s.d = { x: 0, y: 0 }; s.dv = { x: 0, y: 0 }; s.tug = false;
                    applySheet(s);
                    s.state = 'sheet';
                    s.li.classList.remove('is-pulled');
                    return false;
                }
                return true;
            }
            case 'held': {
                const n = Math.max(1, Math.ceil(dt / 0.004)), h = dt / n;
                for (let i = 0; i < n; i++) stepHeld(s, h, now);
                spring(s, 'sc', 'vsc', 1.045, 18, 1, dt);
                spring(s, 'lift', 'vlift', 1, 12, 1, dt);
                applyFree(s);
                if (s.auto) {
                    if (now >= s.auto.end) { s.om *= 0.6; toMount(s, s.auto.mi); s.auto = null; }
                } else showTarget(s);
                return true;
            }
            case 'settle-mount': {
                const c = mountCentre(s.mount);
                let ok = spring(s, 'x', 'vx', c.x, 15, 0.95, dt);
                ok = spring(s, 'y', 'vy', c.y, 15, 0.95, dt) && ok;
                ok = spring(s, 'th', 'vth', 0, 13, 0.78, dt) && Math.abs(s.th) < 0.002 && ok;
                ok = spring(s, 'sc', 'vsc', G.a, 16, 1, dt) && ok;
                spring(s, 'lift', 'vlift', 0, 11, 1, dt);
                applyFree(s);
                if (ok) { s.x = c.x; s.y = c.y; s.th = 0; s.sc = G.a; finishMount(s); return false; }
                return true;
            }
            case 'settle-loose': {
                let ok = spring(s, 'x', 'vx', s.restX, 11, 1, dt);
                ok = spring(s, 'y', 'vy', s.restY, 11, 1, dt) && ok;
                ok = spring(s, 'th', 'vth', s.restTh, 9, 0.85, dt) && Math.abs(s.th - s.restTh) < 0.002 && ok;
                ok = spring(s, 'sc', 'vsc', 1, 14, 1, dt) && ok;
                spring(s, 'lift', 'vlift', 0, 9, 1, dt);
                applyFree(s);
                if (ok && s.lift < 0.01) { s.lift = 0; finishLoose(s); return false; }
                return true;
            }
        }
        return false;
    }

    /* ---- loop ------------------------------------------------------------------ */
    let raf = 0, last = 0, visible = true;
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    function tick(now) {
        raf = 0;
        const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 1 / 60;
        last = now;
        rootRect = root.getBoundingClientRect();
        if (drag) autoScroll(dt);
        let busy = false;
        for (const s of stamps) {
            if (!visible && !drag && !s.auto) settleNow(s);
            else if (step(s, dt, now)) busy = true;
        }
        drawStrain(now);
        if (busy || drag) raf = requestAnimationFrame(tick);
        else last = 0;
    }
    function settleNow(s) {
        if (s.state === 'settle-mount') finishMount(s);
        else if (s.state === 'settle-loose') { s.x = s.restX; s.y = s.restY; s.th = s.restTh; s.sc = 1; s.lift = 0; finishLoose(s); }
        else if (s.state === 'return') { s.d = { x: 0, y: 0 }; applySheet(s); s.state = 'sheet'; s.li.classList.remove('is-pulled'); }
    }
    // while you carry a stamp to the edge of the screen, the page follows
    function autoScroll(dt) {
        const s = drag.s;
        if (s.state !== 'held') return;
        const edge = 72, y = ptr.cy, h = innerHeight;
        let v = 0;
        if (y > h - edge) v = (y - (h - edge)) / edge;
        else if (y < edge) v = -(edge - y) / edge;
        if (v) scrollBy(0, Math.sign(v) * Math.pow(Math.abs(v), 1.5) * 900 * dt);
    }

    /* ---- input ------------------------------------------------------------------- */
    let drag = null;
    const stampOf = (t) => {
        const e = t && t.closest && t.closest('.st-stamp');
        return e ? stamps.find((s) => s.el === e) : null;
    };
    const fromPointer = () => local();

    function onDown(e) {
        if (drag || (e.button != null && e.button > 0)) return;
        const s = stampOf(e.target);
        if (!s || !['sheet', 'return', 'loose', 'settle-loose'].includes(s.state)) return;
        e.preventDefault();
        ptr.cx = e.clientX; ptr.cy = e.clientY;
        rootRect = root.getBoundingClientRect();
        const now = performance.now();
        drag = { s, id: e.pointerId, t: now, x: e.clientX, y: e.clientY, far: 0 };
        root.classList.add('st-grabbing');
        s.src = fromPointer;
        if (s.state === 'loose' || s.state === 'settle-loose') pickUp(s, local(), now);
        else {
            s.touch = e.pointerType === 'touch';
            s.thr = s.touch ? cfg.threshold * 0.85 : cfg.threshold;
            s.zip = cfg.unzip;
            s.dv = { x: 0, y: 0 };
            beginStrain(s, local());
        }
        addEventListener('pointermove', onMove, { passive: false });
        addEventListener('pointerup', onUp);
        addEventListener('pointercancel', onUp);
        kick();
    }
    function onMove(e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (e.cancelable) e.preventDefault();
        ptr.cx = e.clientX; ptr.cy = e.clientY;
        drag.far = Math.max(drag.far, Math.hypot(e.clientX - drag.x, e.clientY - drag.y));
        kick();
    }
    function onUp(e) {
        if (!drag || e.pointerId !== drag.id) return;
        const { s, t, far } = drag;
        drag = null;
        endListen();
        root.classList.remove('st-grabbing');
        if (s.state === 'strain') {
            s.state = 'return';
            s.src = null;
            // a tap gets a small elastic tug, so you can feel it is attached
            if (far < 5 && performance.now() - t < 350 && !calm.matches) {
                s.tug = true;
                s.d = { x: 0, y: cfg.give * 0.55 };
                s.dv = { x: 0, y: 40 };
            } else s.dv = { x: 0, y: 0 };
        } else if (s.state === 'unzip') {
            const p = s.src(performance.now());
            s.src = () => p;   // it still comes away; it just isn't held for long
            s.letGo = true;
        } else if (s.state === 'held') drop(s);
        kick();
    }
    function endListen() {
        removeEventListener('pointermove', onMove);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointercancel', onUp);
    }
    function onKey(e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const s = stampOf(e.target);
        if (!s || drag || !['sheet', 'loose'].includes(s.state)) return;
        e.preventDefault();
        const mi = firstEmpty();
        if (mi < 0) return;
        autoMount(s, mi);
        const next = stamps.find((x) => x.i > s.i && x.state === 'sheet') || stamps.find((x) => x.state === 'sheet');
        (next ? next.el : btn).focus({ preventScroll: true });
    }

    /* Enter: the same tear and carry, on rails. */
    function autoMount(s, mi) {
        const now = performance.now();
        rootRect = root.getBoundingClientRect();
        if (s.state === 'loose') {
            s.pvx = s.pvy = 0; s.om = 0;
            toMount(s, mi);
            kick();
            return;
        }
        const o = cellOrigin(s);
        const grip = { x: o.x + G.W * 0.68, y: o.y + G.H * 0.1 };
        const target = mountCentre(mi);
        const dx = target.x - grip.x, dy = target.y - grip.y, dl = Math.hypot(dx, dy) || 1;
        const ux = dx / dl, uy = dy / dl;
        mounts[mi].s = s;                 // reserve it now
        s.touch = false;
        s.thr = cfg.threshold;
        s.zip = Math.round(cfg.unzip * 0.6);
        s.d = { x: 0, y: 0 };
        beginStrain(s, grip);
        if (calm.matches) { tearFree(s, now); s.pvx = s.pvy = 0; s.om = 0; mounts[mi].s = null; toMount(s, mi); return; }
        const pull = cfg.threshold * 1.05, t0 = now;
        let flight = null;
        s.src = (t) => {
            if (s.state === 'strain' || s.state === 'unzip') {
                const k = easeInOut(clamp((t - t0) / 90));
                return { x: grip.x + ux * pull * k, y: grip.y + uy * pull * k };
            }
            if (!flight) {
                const end = mountCentre(mi);
                const ex = end.x + (s.gx * G.a), ey = end.y + (s.gy * G.a);
                const dur = clamp(Math.hypot(ex - s.px, ey - s.py) / 1.5, 420, 820);
                flight = { x0: s.px, y0: s.py, ex, ey, t0: t, dur };
                s.auto = { mi, end: t + dur };
            }
            const k = easeInOut(clamp((t - flight.t0) / flight.dur));
            const arc = -Math.min(110, Math.hypot(flight.ex - flight.x0, flight.ey - flight.y0) * 0.22) * Math.sin(Math.PI * k);
            return { x: mix(flight.x0, flight.ex, k), y: mix(flight.y0, flight.ey, k) + arc };
        };
        s.auto = { mi, end: Infinity };
        kick();
    }

    /* ---- reset --------------------------------------------------------------------- */
    const timers = [];
    function reset() {
        if (drag) { drag = null; endListen(); root.classList.remove('st-grabbing'); }
        const out = stamps.filter((s) => s.state !== 'sheet');
        if (!out.length) return;
        const back = () => {
            for (const s of stamps) {
                s.state = 'sheet'; s.src = null; s.auto = null; s.letGo = false; s.mount = -1;
                s.d = { x: 0, y: 0 }; s.dv = { x: 0, y: 0 };
                s.edges.clear();
                s.el.getAnimations && s.el.getAnimations().forEach((a) => a.cancel());
                s.el.classList.remove('is-free', 'is-mounted', 'is-inked');
                s.el.style.filter = '';
                s.el.tabIndex = 0;
                s.el.removeAttribute('aria-disabled');
                s.li.classList.remove('is-pulled', 'is-gone');
                s.li.appendChild(s.el);
                applySheet(s);
            }
            selvageEdges = [];
            for (const mt of mounts) {
                mt.el.classList.remove('is-target');
                if (mt.s && mt.s.single) continue;
                mt.s = null;
                mt.el.classList.remove('is-filled');
            }
            targetMount = -1;
            folio.textContent = `0 / ${N}`;
            renderAllFibres();
            btn.disabled = true;
            if (!calm.matches && out.length) {
                out.forEach((s, k) => s.el.animate(
                    [{ opacity: 0, transform: 'translateY(-5px)' }, { opacity: 1, transform: 'translate(0,0)' }],
                    { duration: 560, delay: k * 40, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' }));
            }
            say('A new sheet.');
            const first = stamps[0].el;
            if (document.activeElement === btn) first.focus({ preventScroll: true });
        };
        if (calm.matches) return back();
        out.forEach((s) => s.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in', fill: 'forwards' }));
        timers.push(setTimeout(back, 280));
    }

    let sayTimer = 0;
    function say(text) {
        clearTimeout(sayTimer);
        status.textContent = '';
        sayTimer = setTimeout(() => { status.textContent = text; }, 60);
    }

    /* ---- wire up ------------------------------------------------------------------- */
    folio.textContent = `0 / ${N}`;
    const imgs = stamps.map((s) => s.img).filter(Boolean);
    imgs.forEach((im) => im.addEventListener('load', onImg));
    singleImgs.forEach((im) => im.addEventListener('load', onSingle));
    layout();
    let roRaf = 0;
    const ro = new ResizeObserver(() => {
        cancelAnimationFrame(roRaf);
        roRaf = requestAnimationFrame(() => { rootRect = root.getBoundingClientRect(); layout(); });
    });
    ro.observe(root);
    const io = new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) kick(); });
    io.observe(root);
    const onScroll = () => { rootRect = root.getBoundingClientRect(); };
    addEventListener('scroll', onScroll, { passive: true });
    root.addEventListener('pointerdown', onDown);
    root.addEventListener('keydown', onKey);
    btn.addEventListener('click', reset);
    const noDrag = (e) => { if (stampOf(e.target)) e.preventDefault(); };
    root.addEventListener('dragstart', noDrag);

    return function destroy() {
        cancelAnimationFrame(raf); cancelAnimationFrame(roRaf);
        timers.forEach(clearTimeout); clearTimeout(sayTimer);
        ro.disconnect(); io.disconnect();
        endListen();
        removeEventListener('scroll', onScroll);
        root.removeEventListener('pointerdown', onDown);
        root.removeEventListener('keydown', onKey);
        root.removeEventListener('dragstart', noDrag);
        imgs.forEach((im) => im.removeEventListener('load', onImg));
        for (const { im, next } of albumHome) {
            im.removeEventListener('load', onSingle);
            im.removeAttribute('draggable');
            album.insertBefore(im, next && next.parentNode === album ? next : null);
        }
        btn.removeEventListener('click', reset);
        for (const s of stamps) {
            if (s.img) { s.img.removeAttribute('aria-hidden'); s.img.removeAttribute('draggable'); s.li.appendChild(s.img); }
            s.el.remove();
            s.li.classList.remove('st-cell', 'is-pulled', 'is-gone');
            for (const v of ['--st-gt', '--st-gl', '--st-gr']) s.li.style.removeProperty(v);
            if (!s.li.getAttribute('style')) s.li.removeAttribute('style');
            if (!s.li.className) s.li.removeAttribute('class');
        }
        home.parent.insertBefore(sheet, home.next && home.next.parentNode === home.parent ? home.next : null);
        for (const r0 of rowEls) r0.remove();
        for (const mt of mounts) mt.el.remove();
        for (const e of made) e.remove();
        if (ownAlbum) album.remove();
        root.classList.remove('st-live', 'st-wide', 'st-grabbing');
        for (const v of ['--st-grain', '--st-w', '--st-h', '--st-m', '--st-cols', '--st-pw', '--st-ph', '--st-inset',
            '--st-mw', '--st-mh', '--st-gx', '--st-gy', '--st-lp', '--st-cell-mask', '--st-selvage-mask']) root.style.removeProperty(v);
        if (!root.getAttribute('style')) root.removeAttribute('style');
    };
}

document.querySelectorAll('[data-stamp-tear]').forEach((el) => stampTear(el));
