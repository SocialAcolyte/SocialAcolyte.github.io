/*
 *  PRETEXT-TESSERAE // a paragraph laid as a mosaic.
 *
 *  Markup:  <figure data-pretext-tesserae data-src="assets/neptune.webp">
 *             <p class="tes-text">The paragraph.</p>
 *           </figure>
 *  Or call pretextTesserae(element, { src, srcNarrow, colours, rows, lines,
 *  size, grain, wash, deepen, detail, grout, build, font, weight, tracking,
 *  height, label }); it returns destroy(). Options are in the README.
 *
 *  The stones are laid the way a mosaicist lays them (andamento). The
 *  picture is read in a small palette; the boundaries between its regions
 *  are the outlines. One or two rows of stones hug every outline, following
 *  its curve (rows are bands of distance from the outline, an exact distance
 *  transform), and the rest of the ground is laid in straight courses, every
 *  other course offset half a stone like brick (opus tessellatum). Each row
 *  is cut into stones about one and three-quarter times as long as they are
 *  tall (seeds along the row, relaxed only along it), each stone trimmed
 *  against its neighbours so none overlap.
 *  Each stone is a little text frame turned to run along its row: the
 *  paragraph runs from stone to stone along the rows (the rows are its lines
 *  now), and Cheng Lou's pretext (vendor/pretext, MIT) breaks it into the
 *  lines each stone can hold: the stone is scanned at every line's height
 *  for its width there and layoutNextLineRange fills it. Lines are justified.
 *  Each stone takes one colour, its region's, from near-black to pale marble.
 *  Dark stones carry paper-coloured words, pale stones ink. The grout is the
 *  paper.
 *
 *  When it scrolls into view the stones are laid one by one into a faint
 *  sinopia (the red underdrawing on the mortar bed), the rows hugging the
 *  outlines first, then the ground, in grey; colour comes up behind them like
 *  a floor being washed. About two seconds. Hover a stone (tap on a phone,
 *  arrow keys) and it comes up off the bed toward you until its type is
 *  readable; the next stone in the reading order darkens faintly.
 *
 *  The real <p> stays in the DOM (screen readers, find, no-JS).
 *  Reduced motion: the finished mosaic, still; lifting is instant.
 */

const LIB = './vendor/pretext/layout.js';
const REF = 100;              // pretext measures once at 100px; other sizes scale
const LEADING = 1.02;         // line pitch x font size: tight, like set stone
const ASC = 0.66, DESC = 0.15;  // the glyph band each line needs, in em
const M = 12;                 // canvas margin (CSS px) for a lifted cell's shadow

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);

function rng(seed) {          // mulberry32: the same cells on every visit
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- colour ----------------------------------------------------------------
// The picture is lifted so it reads in small heavy type on paper. Its
// levels are stretched (1st to 99th percentile of lightness), the mid-tones
// pushed down so a silver fish parts from a white ground, highlights capped
// (a white ground stays a pale stone instead of vanishing into the page),
// saturation raised, black lifted to a warm charcoal.
const FLOOR = [34, 29, 26], FK = FLOOR.map((f) => 1 - f / 255);
function makeLift(px, sat = 1.75, ceil = 0.8) {
    const hist = new Uint32Array(256);
    let n = 0;
    for (let i = 0; i < px.length; i += 4) { hist[(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) | 0]++; n++; }
    const pct = (p) => { let s = 0; for (let i = 0; i < 256; i++) { s += hist[i]; if (s >= n * p) return i; } return 255; };
    const lo = pct(0.01), hi = Math.max(lo + 30, pct(0.94));
    // Two curves: greys get their mid-tones pushed down (a silver fish
    // parts from a white ground); coloured stones keep their lightness (a
    // red mullet stays red, not brown). Chroma blends between them.
    const curve = (e) => {
        const lut = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            let t = clamp((i - lo) / (hi - lo));
            t = Math.pow(t, e);
            t = mix(t, t * t * (3 - 2 * t), 0.25);
            lut[i] = (0.02 + (ceil - 0.02) * t) * 255;
        }
        return lut;
    };
    const lutG = curve(1.35), lutC = curve(0.92);
    return (d, i) => {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const ch = clamp(((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(24, Y)) * 1.6);
        const Y2 = mix(lutG[Y | 0], lutC[Y | 0], ch), k = Y2 / Math.max(1, Y);
        d[i] = FLOOR[0] + clamp(Y2 + (r * k - Y2) * sat, 0, 255) * FK[0];
        d[i + 1] = FLOOR[1] + clamp(Y2 + (g * k - Y2) * sat, 0, 255) * FK[1];
        d[i + 2] = FLOOR[2] + clamp(Y2 + (b * k - Y2) * sat, 0, 255) * FK[2];
    };
}
// Grey stone, a hair warm so it sits on the paper.
function grey(d, i) {
    const Y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    d[i] = Math.min(255, Y * 1.0 + 3); d[i + 1] = Y * 0.985 + 1; d[i + 2] = Y * 0.95;
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ---- geometry --------------------------------------------------------------
// Keep the part of a convex polygon where a*x + b*y <= c.
function clipHalf(poly, a, b, c) {
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
        const P = poly[i], Q = poly[(i + 1) % n];
        const dp = a * P[0] + b * P[1] - c, dq = a * Q[0] + b * Q[1] - c;
        if (dp <= 0) out.push(P);
        if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
            const t = dp / (dp - dq);
            out.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
        }
    }
    return out;
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// The x-extent of a convex polygon at height y, or null.
function span(poly, y) {
    let lo = Infinity, hi = -Infinity;
    for (let i = 0, n = poly.length; i < n; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
        if ((y1 <= y && y2 >= y) || (y2 <= y && y1 >= y)) {
            if (y1 === y2) { lo = Math.min(lo, x1, x2); hi = Math.max(hi, x1, x2); }
            else {
                const x = x1 + ((y - y1) * (x2 - x1)) / (y2 - y1);
                if (x < lo) lo = x;
                if (x > hi) hi = x;
            }
        }
    }
    return hi > lo ? [lo, hi] : null;
}
function area(poly) {
    let s = 0;
    for (let i = 0, n = poly.length; i < n; i++) {
        const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n];
        s += x1 * y2 - x2 * y1;
    }
    return Math.abs(s) / 2;
}
// A polygon with its corners eased (hand-cut stone is never knife-sharp).
function rounded(poly, r) {
    const p = new Path2D(), n = poly.length;
    if (n < 3) return p;
    const mid = (A, B) => [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    const m0 = mid(poly[n - 1], poly[0]);
    p.moveTo(m0[0], m0[1]);
    for (let i = 0; i < n; i++) {
        const A = poly[i], B = poly[(i + 1) % n], m = mid(A, B);
        const L = Math.min(Math.hypot(B[0] - A[0], B[1] - A[1]), Math.hypot(A[0] - poly[(i + n - 1) % n][0], A[1] - poly[(i + n - 1) % n][1]));
        p.arcTo(A[0], A[1], m[0], m[1], Math.min(r, L * 0.35));
    }
    p.closePath();
    return p;
}
const plain = (poly) => {
    const p = new Path2D();
    poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
    p.closePath();
    return p;
};

// Convex hull (monotone chain) of [x, y] points.
function convexHull(pts) {
    if (pts.length < 3) return pts.slice();
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const p of P) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
    lo.pop(); hi.pop();
    return lo.concat(hi);
}
// A convex polygon grown (d > 0) or shrunk (d < 0) by d: the intersection
// of its edges' half-planes, each moved d outward.
function offsetConvex(poly, d) {
    const n = poly.length;
    if (n < 3) return [];
    let cx = 0, cy = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of poly) { cx += x / n; cy += y / n; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const m = Math.abs(d) + 1;
    let out = rect(x0 - m, y0 - m, x1 + m, y1 + m);
    for (let i = 0; i < n; i++) {
        const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % n];
        let nx = by - ay, ny = -(bx - ax);
        const L = Math.hypot(nx, ny);
        if (L < 1e-9) continue;
        nx /= L; ny /= L;
        if (nx * (cx - ax) + ny * (cy - ay) > 0) { nx = -nx; ny = -ny; }
        out = clipHalf(out, nx, ny, nx * ax + ny * ay + d);
        if (out.length < 3) return [];
    }
    return out;
}
// Exact squared Euclidean distance transform in place (Felzenszwalb and
// Huttenlocher): f is 0 on the features and 1e20 elsewhere.
function edt(f, w, h) {
    const n = Math.max(w, h), g = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), z = new Float32Array(n + 1);
    const one = (len) => {
        let k = 0;
        v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
        for (let q = 1; q < len; q++) {
            let s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) { k--; s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
            k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + g[v[k]]; }
    };
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) g[y] = f[y * w + x]; one(h); for (let y = 0; y < h; y++) f[y * w + x] = d[y]; }
    for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) g[x] = f[y * w + x]; one(w); for (let x = 0; x < w; x++) f[y * w + x] = d[x]; }
    return f;
}

// Soft hyphens for the canvas copy only (VC|CV, three letters each side), so
// narrow cells stay full. The <p> is untouched.
function hyphenate(text) {
    const V = /[aeiouyàâäéèêëïîôöùûü]/i, NO = /^(th|ch|sh|ph|wh|ck|gh|qu|ng|rh)$/i;
    return text.replace(/[A-Za-zÀ-ÿ]{7,}/g, (w) => {
        if (w.includes('\u00ad')) return w;
        let out = '', from = 0;
        for (let i = 2; i < w.length - 4; i++) {
            const a = w[i], b = w[i + 1];
            if (V.test(w[i - 1]) && !V.test(a) && !V.test(b) && V.test(w[i + 2]) && !NO.test(a + b) && i + 1 - from >= 3) {
                out += w.slice(from, i + 1) + '\u00ad';
                from = i + 1;
            }
        }
        return out + w.slice(from);
    });
}

function loadImage(src) {
    return new Promise((ok, no) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => ok(im);
        im.onerror = no;
        im.src = src;
    });
}

// Box blur in place (separable, radius r), w x h, `ch` interleaved channels.
function blur(a, w, h, ch, r) {
    if (r < 1) return a;
    const tmp = new Float32Array(a.length), n = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += a[(y * w + clamp(k, 0, w - 1)) * ch + c];
        for (let x = 0; x < w; x++) {
            tmp[(y * w + x) * ch + c] = s / n;
            s += a[(y * w + Math.min(w - 1, x + r + 1)) * ch + c] - a[(y * w + Math.max(0, x - r)) * ch + c];
        }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += tmp[(clamp(k, 0, h - 1) * w + x) * ch + c];
        for (let y = 0; y < h; y++) {
            a[(y * w + x) * ch + c] = s / n;
            s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * ch + c] - tmp[(Math.max(0, y - r) * w + x) * ch + c];
        }
    }
    return a;
}

export function pretextTesserae(root, opts = {}) {
    const src = root && root.querySelector('.tes-text');
    const url = opts.src ?? (root && root.dataset.src);
    // Art direction: a second (taller) picture for narrow columns.
    const narrowUrl = opts.srcNarrow ?? (root && root.dataset.srcNarrow);
    const NARROW = 560;
    if (!root || !src || !url) return () => {};
    const ds = root.dataset;
    const num = (k, d) => {
        const raw = opts[k] ?? ds[k];
        if (raw === undefined || raw === null || raw === '') return d;
        const v = Number(raw);
        return Number.isFinite(v) ? v : d;
    };
    const fixedSize = num('size', 0);
    const grain = clamp(num('grain', 1), 0.6, 2);       // stone size x
    const lines = clamp(Math.round(num('lines', 2)), 1, 4);   // lines of type across a stone
    const colours = clamp(Math.round(num('colours', 4)), 2, 8);   // palette the picture is read in
    const hug = clamp(Math.round(num('rows', 2)), 0, 6);  // rows that follow each outline
    const detail = clamp(num('detail', 0));            // picture through the glyphs
    const groutOpt = num('grout', 0);
    const wash = clamp(num('wash', 0.72));
    const deepen = clamp(num('deepen', 0.28));
    const heightVh = clamp(num('height', 0.88), 0.3, 1.5);
    const tracking = num('tracking', 0);
    const build = (opts.build ?? ds.build ?? 'enter') === 'none' ? 'none' : 'enter';
    const weight = opts.weight ?? ds.weight ?? null;
    const family = opts.font ?? ds.font ?? null;
    const label = opts.label ?? ds.label ?? 'The paragraph, set as a mosaic. Arrow keys lift one stone at a time.';

    let dead = false;
    const off = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    const stage = document.createElement('div');
    stage.className = 'tes-stage';
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-roledescription', 'mosaic');
    stage.setAttribute('aria-label', label);
    const canvas = document.createElement('canvas');
    canvas.className = 'tes-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const say = document.createElement('p');
    say.className = 'tes-live';
    say.setAttribute('aria-live', 'polite');
    stage.append(canvas, say);
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const layer = () => document.createElement('canvas');
    const colourL = layer(), greyL = layer();

    let api, img, text = '';
    let font = { style: 'normal', weight: '700', family: 'serif' };
    let paper = '#f3f0e8', paperRGB = [243, 240, 232], inkRGB = [20, 19, 18], sinopia = 'rgba(176, 98, 70, 0.55)';

    // Geometry (CSS px): the mosaic is W x H; the canvas adds M all round.
    let W = 0, H = 0, dpr = 1, s0 = 9, lift = null;
    let cells = [], order = [], outline = null;
    let owner = null, ownerW = 0, ownerH = 0, ownerQ = 1, cellOf = null;   // hit testing

    // ---- the stones -----------------------------------------------------------
    // Laid the way a mosaicist lays them (andamento): one or two rows of
    // stones hugging every outline in the picture, following its curve, and
    // the ground filled in straight courses (opus tessellatum), each row cut
    // into near-square stones.
    async function cut(me) {
        let tSlice = performance.now(), longest = 0;
        const yieldNow = async () => {
            longest = Math.max(longest, performance.now() - tSlice);
            await breathe();
            tSlice = performance.now();
            return !(dead || me !== job);
        };
        // 1. The picture at about 2.2 CSS px a sample, read in a small
        //    palette (k-means), its speckle cleaned up: a map of regions
        //    whose boundaries are the outlines.
        const RW = Math.max(80, Math.min(620, Math.round(W / 2.2)));
        const RH = Math.max(60, Math.round(RW * H / W));
        const q = W / RW, N0 = RW * RH;
        const rc = layer(); rc.width = RW; rc.height = RH;
        const rx = rc.getContext('2d', { willReadFrequently: true });
        rx.imageSmoothingQuality = 'high';
        let srcC = img, sw = img.naturalWidth, sh = img.naturalHeight;
        while (sw > RW * 2.2) {
            const h2 = layer(); h2.width = Math.round(sw / 2); h2.height = Math.round(sh / 2);
            const hx = h2.getContext('2d'); hx.imageSmoothingQuality = 'high';
            hx.drawImage(srcC, 0, 0, h2.width, h2.height);
            srcC = h2; sw = h2.width; sh = h2.height;
        }
        rx.drawImage(srcC, 0, 0, RW, RH);
        const px = rx.getImageData(0, 0, RW, RH).data;
        lift = makeLift(px);
        // softened by about half a real tessera, so the grout lines of a
        // photographed mosaic don't read as outlines
        const soft = new Float32Array(N0 * 3);
        for (let i = 0; i < N0; i++) { soft[i * 3] = px[i * 4]; soft[i * 3 + 1] = px[i * 4 + 1]; soft[i * 3 + 2] = px[i * 4 + 2]; }
        blur(soft, RW, RH, 3, Math.max(1, Math.round(W / 200 / q)));
        const lit = new Uint8ClampedArray(N0 * 4);
        for (let i = 0; i < N0; i++) { lit[i * 4] = soft[i * 3]; lit[i * 4 + 1] = soft[i * 3 + 1]; lit[i * 4 + 2] = soft[i * 3 + 2]; lift(lit, i * 4); }

        if (!(await yieldNow())) return false;
        const K = colours, cen = new Float32Array(K * 3);
        {   // centres seeded at lightness quantiles, then a few Lloyd rounds
            const Yb = new Uint8Array(N0), hist = new Uint32Array(256), sum = new Float64Array(256 * 3);
            for (let i = 0; i < N0; i++) {
                const y = Math.min(255, (soft[i * 3] * 0.3 + soft[i * 3 + 1] * 0.59 + soft[i * 3 + 2] * 0.11) | 0);
                Yb[i] = y; hist[y]++; sum[y * 3] += soft[i * 3]; sum[y * 3 + 1] += soft[i * 3 + 1]; sum[y * 3 + 2] += soft[i * 3 + 2];
            }
            for (let k = 0, acc0 = 0, y = 0; k < K; k++) {
                const want = ((k + 0.5) / K) * N0;
                while (y < 255 && acc0 + hist[y] < want) acc0 += hist[y++];
                const n = Math.max(1, hist[y]);
                cen[k * 3] = sum[y * 3] / n; cen[k * 3 + 1] = sum[y * 3 + 1] / n; cen[k * 3 + 2] = sum[y * 3 + 2] / n;
            }
            const acc = new Float64Array(K * 4);
            for (let it = 0; it < 10; it++) {
                acc.fill(0);
                for (let i = 0; i < N0; i += 2) {
                    let best = 0, bd = Infinity;
                    for (let k = 0; k < K; k++) {
                        const d = (soft[i * 3] - cen[k * 3]) ** 2 + (soft[i * 3 + 1] - cen[k * 3 + 1]) ** 2 + (soft[i * 3 + 2] - cen[k * 3 + 2]) ** 2;
                        if (d < bd) { bd = d; best = k; }
                    }
                    acc[best * 4] += soft[i * 3]; acc[best * 4 + 1] += soft[i * 3 + 1]; acc[best * 4 + 2] += soft[i * 3 + 2]; acc[best * 4 + 3]++;
                }
                for (let k = 0; k < K; k++) if (acc[k * 4 + 3]) for (let c = 0; c < 3; c++) cen[k * 3 + c] = acc[k * 4 + c] / acc[k * 4 + 3];
            }
        }
        let lab = new Uint8Array(N0);
        for (let i = 0; i < N0; i++) {
            let best = 0, bd = Infinity;
            for (let k = 0; k < K; k++) {
                const d = (soft[i * 3] - cen[k * 3]) ** 2 + (soft[i * 3 + 1] - cen[k * 3 + 1]) ** 2 + (soft[i * 3 + 2] - cen[k * 3 + 2]) ** 2;
                if (d < bd) { bd = d; best = k; }
            }
            lab[i] = best;
        }
        if (!(await yieldNow())) return false;
        // majority filter, twice: no single-sample islands
        for (let pass = 0; pass < 2; pass++) {
            const out = new Uint8Array(N0), cnt = new Uint8Array(K);
            for (let y = 0; y < RH; y++) {
                const j0 = Math.max(0, y - 1), j1 = Math.min(RH - 1, y + 1);
                for (let x = 0; x < RW; x++) {
                    const i0 = Math.max(0, x - 1), i1 = Math.min(RW - 1, x + 1);
                    let best = lab[y * RW + x], bc = 0;
                    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
                        const l = lab[j * RW + i], c = ++cnt[l];
                        if (c > bc) { bc = c; best = l; }
                    }
                    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cnt[lab[j * RW + i]] = 0;
                    out[y * RW + x] = best;
                }
            }
            lab = out;
        }
        if (!(await yieldNow())) return false;
        // islands smaller than a couple of stones (stains, a stray dark
        // stone in the photograph) join the region around them
        {
            const comp = new Int32Array(N0).fill(-1), stack = new Int32Array(N0);
            const minComp = Math.max(6, ((lines * s0 * LEADING * 2.2) / q) ** 2);
            let nc = 0;
            for (let s0i = 0; s0i < N0; s0i++) {
                if (comp[s0i] >= 0) continue;
                const l = lab[s0i];
                let top = 0, size = 0;
                const members = [];
                stack[top++] = s0i; comp[s0i] = nc;
                const nb = new Uint32Array(K);
                while (top) {
                    const i = stack[--top]; size++; members.push(i);
                    const x = i % RW, y = (i / RW) | 0;
                    const visit = (j) => {
                        if (lab[j] !== l) { nb[lab[j]]++; return; }
                        if (comp[j] < 0) { comp[j] = nc; stack[top++] = j; }
                    };
                    if (x > 0) visit(i - 1);
                    if (x < RW - 1) visit(i + 1);
                    if (y > 0) visit(i - RW);
                    if (y < RH - 1) visit(i + RW);
                }
                if (size < minComp) {
                    let best = -1;
                    for (let k = 0; k < K; k++) if (k !== l && nb[k] && (best < 0 || nb[k] > nb[best])) best = k;
                    if (best >= 0) for (const i of members) lab[i] = best;
                }
                nc++;
            }
        }
        if (!(await yieldNow())) return false;

        // 2. Distance to the nearest outline (region boundary, or the frame),
        //    exact (Felzenszwalb), lightly smoothed for the curve of the rows.
        const f = new Float32Array(N0).fill(1e20);
        for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
            const i = y * RW + x, l = lab[i];
            if ((x + 1 < RW && lab[i + 1] !== l) || (y + 1 < RH && lab[i + RW] !== l)) f[i] = 0;
        }
        edt(f, RW, RH);
        const dist = new Float32Array(N0);
        for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
            const i = y * RW + x;
            // the frame is an outline too: rows run round the border
            const b = Math.min(x + 0.5, y + 0.5, RW - x - 0.5, RH - y - 0.5);
            dist[i] = Math.min(Math.sqrt(f[i]) + 0.5, b);
        }
        blur(dist, RW, RH, 1, 1);

        // 3. Rows. Within `hug` rows of an outline a stone's row is its band
        //    of distance; beyond, the ground is laid in straight courses.
        const lineH = s0 * LEADING;
        const hpx = (lines * lineH + 2 * s0 * 0.16 + grout()) * grain;   // stone height, CSS px
        const hs = hpx / q, ws = hs * 1.75, hg = hs * 1.2, wg = hs * 2.2;  // row height, stone length; ground course and stone
        const zone = hug * hs;
        const key = new Int32Array(N0);
        const phase = rng(0x5eed + N0)();
        for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) {
            const i = y * RW + x, d = dist[i];
            key[i] = d < zone ? lab[i] * 4096 + Math.floor(d / hs) : lab[i] * 4096 + 64 + Math.floor((y + 0.5) / hg + phase);
        }

        // 4. Seeds: along each hugging row's centre line about one stone
        //    apart; along each course at a stone's width, every other course
        //    offset half a stone (like brick), a hand's jitter in both.
        const R = rng(0x7e55e + N0);
        const sxA = [], syA = [], skA = [];
        const G = Math.max(2, ws * 1.4), gw = Math.ceil(RW / G) + 1, gh = Math.ceil(RH / G) + 1;
        const taken = new Map();
        const near = (x, y, k, r2) => {
            const gx = (x / G) | 0, gy = (y / G) | 0;
            for (let j = gy - 1; j <= gy + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) {
                const l = taken.get(j * gw + i);
                if (l) for (const n of l) if (skA[n] === k && (sxA[n] - x) ** 2 + (syA[n] - y) ** 2 < r2) return true;
            }
            return false;
        };
        const put = (x, y, k) => {
            const g = ((y / G) | 0) * gw + ((x / G) | 0);
            if (!taken.has(g)) taken.set(g, []);
            taken.get(g).push(sxA.length);
            sxA.push(x); syA.push(y); skA.push(k);
        };
        const centre = [];
        for (let i = 0; i < N0; i++) {
            const d = dist[i];
            if (d < zone && Math.abs(d - (Math.floor(d / hs) + 0.5) * hs) < 0.6) centre.push(i);
        }
        for (let i = centre.length - 1; i > 0; i--) { const j = (R() * (i + 1)) | 0; const t = centre[i]; centre[i] = centre[j]; centre[j] = t; }
        const sp2 = (ws * 0.92) ** 2;    // stones run longer than they are tall: rows are lines of type
        for (const i of centre) {
            const x = (i % RW) + 0.5, y = ((i / RW) | 0) + 0.5;
            if (!near(x, y, key[i], sp2)) put(x, y, key[i]);
        }
        for (let row = 0; row * hg - phase * hg < RH + hg; row++) {
            const y = (row + 0.5 - phase) * hg;
            if (y < 0 || y >= RH) continue;
            for (let x = ((row & 1) ? wg * 0.5 : 0) + wg * 0.5; x < RW; x += wg * (0.9 + 0.2 * R())) {
                const xi = Math.min(RW - 1, x | 0), yi = Math.min(RH - 1, (y + (R() - 0.5) * 0.2 * hg) | 0), i = yi * RW + xi;
                if (dist[i] >= zone) put(x, yi + 0.5, key[i]);
            }
        }
        if (!(await yieldNow())) return false;

        // 5. Each sample goes to the nearest seed in its own row; seeds move
        //    to the middle of what they own (Lloyd, but only along the row),
        //    so stones even out to the same size.
        const gN = gw * gh, start0 = new Int32Array(gN + 1);
        let list = new Int32Array(sxA.length);
        const index = () => {
            start0.fill(0);
            for (let k = 0; k < N; k++) start0[Math.min(gh - 1, (sy[k] / G) | 0) * gw + Math.min(gw - 1, (sx[k] / G) | 0) + 1]++;
            for (let i = 0; i < gN; i++) start0[i + 1] += start0[i];
            const at = start0.slice(0, gN);
            for (let k = 0; k < N; k++) list[at[Math.min(gh - 1, (sy[k] / G) | 0) * gw + Math.min(gw - 1, (sx[k] / G) | 0)]++] = k;
        };
        const own = new Int32Array(N0);
        const assign = () => {
            index();
            for (let y = 0; y < RH; y++) {
                const gy = ((y + 0.5) / G) | 0, py = y + 0.5;
                for (let x = 0; x < RW; x++) {
                    const gx = ((x + 0.5) / G) | 0, px2 = x + 0.5, kk = key[y * RW + x];
                    let best = -1, bd = Infinity;
                    for (let j = Math.max(0, gy - 1); j <= Math.min(gh - 1, gy + 1); j++)
                        for (let i = Math.max(0, gx - 1); i <= Math.min(gw - 1, gx + 1); i++) {
                            const g = j * gw + i;
                            for (let n = start0[g], e = start0[g + 1]; n < e; n++) {
                                const k = list[n];
                                if (sk[k] !== kk) continue;
                                const d = (sx[k] - px2) ** 2 + (sy[k] - py) ** 2;
                                if (d < bd) { bd = d; best = k; }
                            }
                        }
                    // a stone is never much bigger than a stone: further
                    // than that, the sample waits for a seed of its own
                    own[y * RW + x] = bd <= (kk % 4096 >= 64 ? capG : capH) ? best : -1;
                }
            }
        };
        const capH = (ws * 0.62) ** 2, capG = (wg * 0.62) ** 2;
        // Wherever a row has no stone near enough, set one, until the rows
        // are full (a sliver too thin for any stone stays grout).
        let N = sxA.length;
        let sx = Float32Array.from(sxA), sy = Float32Array.from(syA), sk = Int32Array.from(skA);
        for (let round = 0; round < 3; round++) {
            assign();
            let added = 0;
            for (let i = 0; i < N0; i++) {
                if (own[i] >= 0) continue;
                const x = (i % RW) + 0.5, y = ((i / RW) | 0) + 0.5;
                if (!near(x, y, key[i], sp2 * 0.8)) { put(x, y, key[i]); added++; }
            }
            if (!added) break;
            if (!(await yieldNow())) return false;
            N = sxA.length;
            sx = Float32Array.from(sxA); sy = Float32Array.from(syA); sk = Int32Array.from(skA);
            list = new Int32Array(N);
        }
        const ax = new Float64Array(N), ay = new Float64Array(N), an = new Float64Array(N);
        for (let it = 0; it < 3; it++) {
            assign();
            ax.fill(0); ay.fill(0); an.fill(0);
            for (let i = 0; i < N0; i++) { const k = own[i]; if (k < 0) continue; ax[k] += (i % RW) + 0.5; ay[k] += ((i / RW) | 0) + 0.5; an[k]++; }
            for (let k = 0; k < N; k++) if (an[k]) { sx[k] = ax[k] / an[k]; sy[k] = ay[k] / an[k]; }
            if (!(await yieldNow())) return false;
        }
        assign();

        if (!(await yieldNow())) return false;
        // 6. Each stone: its outline (the hull of what it owns), its colour
        //    (the main region under it, in the lifted picture, pulled toward
        //    that region's palette colour so a stone is one colour) and the
        //    way its row runs (along the outline it hugs; level in the ground).
        const pix = Array.from({ length: N }, () => []);
        for (let i = 0; i < N0; i++) if (own[i] >= 0) pix[own[i]].push(i);
        const palLit = new Uint8ClampedArray(K * 4);
        for (let k = 0; k < K; k++) { palLit[k * 4] = cen[k * 3]; palLit[k * 4 + 1] = cen[k * 3 + 1]; palLit[k * 4 + 2] = cen[k * 3 + 2]; lift(palLit, k * 4); }
        // The palette's lightness spread over the full range of stone, from
        // near-black to a pale marble, whatever the photograph's light: a
        // weathered white floor is still white stone.
        const Yp = (a, i) => 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2];
        let yMin = 255, yMax = 0;
        for (let k = 0; k < K; k++) { yMin = Math.min(yMin, Yp(palLit, k * 4)); yMax = Math.max(yMax, Yp(palLit, k * 4)); }
        const stretch = (rgb) => {
            const Y = Yp(rgb, 0), t = clamp((Y - yMin) / Math.max(20, yMax - yMin));
            const Y2 = (0.11 + 0.71 * t) * 255, kk = Y2 / Math.max(1, Y);
            return rgb.map((v) => clamp(Y2 + (v * kk - Y2) * 1.2, 0, 255));
        };
        const g2 = grout() / 2, pad = s0 * 0.16, minPix = hs * hs * 0.22;
        cells = [];
        cellOf = new Int32Array(N).fill(-1);
        // Hulls of what each stone owns, then trimmed against its neighbours
        // (the bisector with each nearby stone's middle), so stones on a
        // curve never overlap.
        const hullOf = new Array(N), mx = new Float32Array(N), my = new Float32Array(N);
        const Gc = wg * q * 1.2, cgw = Math.ceil(W / Gc) + 1, cgh = Math.ceil(H / Gc) + 1;
        const cgrid = Array.from({ length: cgw * cgh }, () => []);
        for (let k = 0; k < N; k++) {
            const P = pix[k];
            if (P.length < minPix) continue;
            const pts = P.map((i) => [((i % RW) + 0.5) * q, (((i / RW) | 0) + 0.5) * q]);
            const hull = convexHull(pts);
            if (hull.length < 3) continue;
            hullOf[k] = offsetConvex(hull, q * 0.5);
            for (const [x, y] of pts) { mx[k] += x; my[k] += y; }
            mx[k] /= pts.length; my[k] /= pts.length;
            cgrid[Math.min(cgh - 1, (my[k] / Gc) | 0) * cgw + Math.min(cgw - 1, (mx[k] / Gc) | 0)].push(k);
        }
        for (let k = 0; k < N; k++) {
            const P = pix[k];
            if (!hullOf[k]) continue;
            let full = hullOf[k];
            const gx0 = (mx[k] / Gc) | 0, gy0 = (my[k] / Gc) | 0;
            for (let j = Math.max(0, gy0 - 1); j <= Math.min(cgh - 1, gy0 + 1); j++)
                for (let i = Math.max(0, gx0 - 1); i <= Math.min(cgw - 1, gx0 + 1); i++)
                    for (const m of cgrid[j * cgw + i]) {
                        if (m === k) continue;
                        const dx = mx[m] - mx[k], dy = my[m] - my[k], L = Math.hypot(dx, dy);
                        if (L < 1e-6) continue;
                        const a = dx / L, b = dy / L;
                        full = clipHalf(full, a, b, a * (mx[k] + mx[m]) / 2 + b * (my[k] + my[m]) / 2);
                    }
            if (full.length < 3) continue;
            const face = offsetConvex(full, -g2);
            const frameW = offsetConvex(full, -g2 - pad);
            if (face.length < 3) continue;
            let cxs = 0, cys = 0;
            for (const [x, y] of full) { cxs += x; cys += y; }
            const cx = cxs / full.length, cy = cys / full.length;
            // main region and colour
            const cnt = new Uint32Array(K);
            for (const i of P) cnt[lab[i]]++;
            let L = 0;
            for (let j = 1; j < K; j++) if (cnt[j] > cnt[L]) L = j;
            let r = 0, g = 0, b = 0, n = 0;
            for (const i of P) if (lab[i] === L) { r += lit[i * 4]; g += lit[i * 4 + 1]; b += lit[i * 4 + 2]; n++; }
            const rgb = stretch([mix(r / n, palLit[L * 4], 0.6), mix(g / n, palLit[L * 4 + 1], 0.6), mix(b / n, palLit[L * 4 + 2], 0.6)]);
            // the row's direction: across the gradient of the distance
            let th = 0;
            const level = (sk[k] % 4096) >= 64 ? 2 : (sk[k] % 4096);
            if (level < 2) {
                let gx = 0, gy = 0;
                for (const i of P) {
                    const x = i % RW, y = (i / RW) | 0;
                    if (x < 1 || y < 1 || x >= RW - 1 || y >= RH - 1) continue;
                    gx += dist[i + 1] - dist[i - 1]; gy += dist[i + RW] - dist[i - RW];
                }
                th = Math.atan2(gx, -gy);           // tangent = gradient turned 90 degrees
                if (th > Math.PI / 2) th -= Math.PI;
                if (th <= -Math.PI / 2) th += Math.PI;
                // a hair of hand-set wobble
                th += (R() - 0.5) * 0.06;
            }
            const cos = Math.cos(-th), sin = Math.sin(-th);
            const local = frameW.map(([x, y]) => [(x - cx) * cos - (y - cy) * sin, (x - cx) * sin + (y - cy) * cos]);
            cellOf[k] = cells.length;
            cells.push({ k, x: cx, y: cy, cx, cy, th, deg: th * 180 / Math.PI, level, row: sk[k], full, face, frame: local, rgb, lines: [], words: [], area: area(full) });
        }
        owner = own; ownerW = RW; ownerH = RH; ownerQ = q;

        // 7. Colours of face, words and reading ink.
        for (const c of cells) {
            const g = [...c.rgb]; grey(g, 0); c.grey = g;
            const far = Math.hypot(c.rgb[0] - paperRGB[0], c.rgb[1] - paperRGB[1], c.rgb[2] - paperRGB[2]);
            c.alpha = wash * mix(0.58, 1, Math.pow(clamp(far / 170), 0.85));
            const face = c.rgb.map((v, i) => mix(paperRGB[i], v, c.alpha));
            const Yf = 0.2126 * face[0] + 0.7152 * face[1] + 0.0722 * face[2];
            const Yr = (0.2126 * c.rgb[0] + 0.7152 * c.rgb[1] + 0.0722 * c.rgb[2]) / 255;
            // Dark stones carry paper-coloured words; pale ones ink, the
            // paler the stone the deeper the ink; coloured ones their own
            // colour a shade deeper.
            const light = Yf <= 112;
            c.word = light ? c.rgb.map((v, i) => mix(v, paperRGB[i], 0.8)) : c.rgb.map((v, i) => mix(v, inkRGB[i], clamp(deepen + 0.45 * Yr * Yr)));
            c.greyWord = [...c.word]; grey(c.greyWord, 0);
            c.ink = c.rgb.map((v, i) => mix(v, inkRGB[i], 0.86));
        }

        if (!(await yieldNow())) return false;
        // 8. Reading order: along each row, stone to stone (rows are lines
        //    of text now), the rows from the top of the picture down.
        const byRow = new Map();
        for (const c of cells) { if (!byRow.has(c.row)) byRow.set(c.row, []); byRow.get(c.row).push(c); }
        const chains = [];
        const reach = (hpx * 2.4) ** 2;
        for (const list2 of byRow.values()) {
            if (list2[0].level === 2) { list2.sort((a, b) => a.cx - b.cx); chains.push(list2); continue; }
            const left = new Set(list2);
            while (left.size) {
                let cur = null;
                for (const c of left) if (!cur || c.cx < cur.cx) cur = c;
                const chain = [];
                while (cur) {
                    left.delete(cur); chain.push(cur);
                    let nx = null, nd = reach;
                    for (const c of left) { const d = (c.cx - cur.cx) ** 2 + (c.cy - cur.cy) ** 2; if (d < nd) { nd = d; nx = c; } }
                    cur = nx;
                }
                chains.push(chain);
            }
        }
        chains.sort((a, b) => (a[0].cy - b[0].cy) || (a[0].cx - b[0].cx));
        order = chains.flat();
        order.forEach((c, i) => { c.i = i; });

        // 9. The order they are laid in: the rows hugging the outlines
        //    first, from where the picture is busiest, then the ground.
        let sx0 = 0, sy0 = 0, sn = 0;
        for (const c of cells) if (c.level === 0) { sx0 += c.cx; sy0 += c.cy; sn++; }
        const ox = sn ? sx0 / sn : W / 2, oy = sn ? sy0 / sn : H / 2, far = Math.hypot(W, H) / 2;
        const R2 = rng(0x1a1d);
        const rk = cells.map((c) => [c, 0.42 * (c.level / 2) + 0.46 * Math.hypot(c.cx - ox, c.cy - oy) / far + 0.12 * R2()]);
        rk.sort((a, b) => a[1] - b[1]).forEach(([c], i) => { c.rank = i / Math.max(1, rk.length - 1); });
        longest = Math.max(longest, performance.now() - tSlice);
        if (root.dataset.debug !== undefined) console.log(`tesserae: longest cutting slice ${longest | 0}ms`);
        return true;
    }

    function grout() { return groutOpt || clamp(s0 * 0.3, 1.4, 3); }

    // ---- the words ------------------------------------------------------------
    function sizeOf(c) {
        // One size of type throughout, a touch larger in the ground's
        // bigger stones (quarter-pixel steps keep the fonts few).
        return Math.round(4 * s0 * (c.level === 2 ? 1.06 : 1)) / 4;
    }
    function slots(c) {
        const s = c.size, L = s * LEADING, poly = c.frame;
        if (poly.length < 3) return [];
        let y0 = Infinity, y1 = -Infinity;
        for (const [, y] of poly) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const least = s * 1.35;
        // Try a few vertical offsets and keep the one that holds the most
        // text: the tips of a stone are narrow, so where the lines fall
        // matters.
        let best = [], bestW = -1;
        for (let o = 0; o < 4; o++) {
            const out = [];
            let tot = 0;
            for (let base = y0 + ASC * s + (o / 4) * L; base + DESC * s <= y1; base += L) {
                const A = span(poly, base - ASC * s), B = span(poly, base + DESC * s);
                if (!A || !B) continue;
                const a = Math.max(A[0], B[0]), b = Math.min(A[1], B[1]);
                if (b - a >= least) { out.push({ a, b, base }); tot += b - a; }
            }
            if (tot > bestW) { bestW = tot; best = out; }
        }
        return best;
    }

    const wcache = new Map();
    let mctx = null;
    function widthRef(w) {
        let v = wcache.get(w);
        if (v === undefined) { v = mctx.measureText(w).width; wcache.set(w, v); }
        return v;
    }

    function pour() {
        const spec = (s) => `${font.style} ${font.weight} ${s}px ${font.family}`;
        mctx = mctx || layer().getContext('2d');
        mctx.font = spec(REF);
        wcache.clear();
        const ls = { letterSpacing: tracking * REF };
        const base = hyphenate(text);
        // Enough copies of the paragraph for every stone (it begins again
        // after an interpunct, on the canvas only).
        let cap = 0;
        for (const c of cells) { c.size = sizeOf(c); cap += area(c.frame) / (c.size * c.size * LEADING * 0.44); }
        let copies = Math.max(1, Math.ceil((cap * 1.3) / Math.max(1, base.length)));
        let Q, cursor, lastSeg = 0;
        for (let attempt = 0; attempt < 4; attempt++) {
            Q = api.prepareWithSegments(Array(copies).fill(base).join(' \u00b7 '), spec(REF), ls);
            cursor = { segmentIndex: 0, graphemeIndex: 0 };
            let ran = false;
            for (const c of order) {
                c.lines = [];
                const k = REF / c.size;
                for (const sl of slots(c)) {
                    let range = api.layoutNextLineRange(Q, cursor, (sl.b - sl.a) * k), squeeze = 1;
                    if (range === null) { ran = true; break; }
                    // A word longer than the run would be split mid-word.
                    // Cut a smaller stone instead: set that line in smaller
                    // type (down to 70%), or failing that leave the run empty.
                    const split = (r) => r.end.graphemeIndex > 0 && r.end.segmentIndex === cursor.segmentIndex;
                    if (split(range)) {
                        range = api.layoutNextLineRange(Q, cursor, (sl.b - sl.a) * k / 0.7);
                        if (!range || split(range)) continue;
                        squeeze = 0;            // measured below
                    }
                    c.lines.push({ ...sl, range, squeeze });
                    cursor = range.end;
                }
                if (ran) break;
            }
            if (!ran) break;
            copies = Math.ceil(copies * 1.6) + 1;
        }
        lastSeg = cursor;

        // Justify each line to its run through the word gaps (up to about
        // two and a half spaces; anything left is split either side). A
        // lone word is centred. No letter-spacing: stones are cut, not
        // stretched, and it keeps the set fast.
        const space = widthRef(' ');
        for (const c of cells) {
            c.words = [];
            c.said = '';
            for (const ln of c.lines) {
                const t = api.materializeLineRange(Q, ln.range).text.trim();
                if (!t) continue;
                c.said += (c.said && !c.said.endsWith('-') ? ' ' : '') + t;
                const parts = t.split(/\s+/);
                let s = c.size, kk = s / REF, sp = space * kk, tr0 = tracking * s;
                let ws = parts.map((w) => widthRef(w) * kk + tr0 * ([...w].length - 1));
                // A line that only just fits (pretext measures whole runs, we
                // measure words) or was squeezed is set a quarter-pixel
                // smaller until its word gaps are at least 0.7 of a space.
                const need = ws.reduce((a, b) => a + b, 0) + sp * (ln.squeeze ? 0.7 : 1) * (parts.length - 1);
                if (!ln.squeeze || need > ln.b - ln.a) {
                    const f = Math.floor(4 * s * Math.min(1, (ln.b - ln.a) / need)) / (4 * s);
                    s *= f; kk *= f; sp *= f; tr0 *= f;
                    ws = ws.map((w) => w * f);
                }
                const sum = ws.reduce((a, b) => a + b, 0);
                const run = ln.b - ln.a, gaps = parts.length - 1;
                let gap = sp, track = 0, x = ln.a;
                let slack = run - sum - sp * gaps;
                if (!gaps) {
                    x = ln.a + (run - sum) / 2;
                } else if (slack <= 0) {
                    gap = (run - sum) / gaps;
                } else {
                    const g = Math.min(slack, sp * 1.5 * gaps);
                    slack -= g;
                    gap = sp + g / gaps;
                    x = ln.a + slack / 2;
                }
                parts.forEach((w, wi) => {
                    const n = [...w].length - 1;
                    const wd = ws[wi] + track * n;
                    c.words.push({ t: w, x, y: ln.base, tr: track + tr0, s });
                    x += wd + gap;
                });
            }
            c.said = c.said.replace(/\u00ad/g, '');
        }
        return lastSeg;
    }

    // ---- paint ----------------------------------------------------------------
    // Two layers per layout: the stones in colour, and (only until the floor
    // is laid) the same stones in grey. The reading ink is set on demand,
    // one stone at a time.
    const spec = (s) => `${font.style} ${font.weight} ${s}px ${font.family}`;
    const LS = 'letterSpacing' in CanvasRenderingContext2D.prototype;
    // Font and spacing are only set when they change (both are slow to
    // set), so stones are drawn grouped by size.
    // Each stone's words are set in its own frame: centred on the stone and
    // turned to run along its row.
    function setWords(x, c, colour) {
        if (colour) x.fillStyle = colour;
        const m = x.getTransform();
        x.setTransform(c.deg ? m.translate(c.cx, c.cy).rotate(c.deg) : m.translate(c.cx, c.cy));
        for (const w of c.words) {
            if (w.s !== x.__tesS) {
                x.__tesS = w.s;
                x.font = spec(w.s);
                if (LS) x.letterSpacing = (Math.round(w.tr * 100) / 100) + 'px';
            }
            x.fillText(w.t, w.x, w.y);
        }
        x.setTransform(m);
    }
    function paint() {
        const CW = Math.round((W + 2 * M) * dpr), CH = Math.round((H + 2 * M) * dpr);
        for (const c of [canvas, colourL]) { c.width = CW; c.height = CH; }
        canvas.style.width = W + 2 * M + 'px';
        canvas.style.height = H + 2 * M + 'px';
        const T = (x) => { x.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr); x.textBaseline = 'alphabetic'; return x; };
        const r = Math.min(2.2, grout() * 0.8);
        for (const c of cells) {
            c.fullPath = plain(c.full);
            c.facePath = rounded(c.face, r);
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const [x, y] of c.full) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
            c.box = [x0 - 3, y0 - 3, x1 + 3, y1 + 3];
        }
        outline = new Path2D();
        for (const c of cells) outline.addPath(c.facePath);

        // The stone faces, then the words on them.
        const cx = T(colourL.getContext('2d'));
        cx.__tesS = 0;
        for (const c of cells) { cx.fillStyle = css(c.rgb, c.alpha); cx.fill(c.facePath); }
        const bySize = [...cells].sort((a, b) => a.size - b.size);
        if (!detail) {
            for (const c of bySize) setWords(cx, c, css(c.word));       // flat stones
        } else {
            // data-detail: the words are a mask, and what fills them is each
            // stone's colour with some of the picture (lifted) through it.
            const mask = layer(); mask.width = CW; mask.height = CH;
            const mx = T(mask.getContext('2d'));
            mx.fillStyle = '#000';
            for (const c of bySize) setWords(mx, c, null);
            const fillC = layer(); fillC.width = CW; fillC.height = CH;
            const fx = T(fillC.getContext('2d'));
            for (const c of cells) { fx.fillStyle = css(c.word); fx.fill(c.fullPath); }
            const ph = layer(); ph.width = Math.round(W * dpr); ph.height = Math.round(H * dpr);
            const pxx = ph.getContext('2d', { willReadFrequently: true });
            pxx.imageSmoothingQuality = 'high';
            pxx.drawImage(img, 0, 0, ph.width, ph.height);
            const im = pxx.getImageData(0, 0, ph.width, ph.height);
            for (let i = 0; i < im.data.length; i += 4) lift(im.data, i);
            pxx.putImageData(im, 0, 0);
            fx.globalAlpha = detail;
            fx.drawImage(ph, 0, 0, W, H);
            fx.setTransform(1, 0, 0, 1, 0, 0);
            fx.globalAlpha = 1;
            fx.globalCompositeOperation = 'destination-in';
            fx.drawImage(mask, 0, 0);
            cx.setTransform(1, 0, 0, 1, 0, 0);
            cx.drawImage(fillC, 0, 0);
        }
        cx.setTransform(1, 0, 0, 1, 0, 0);
        if (phase !== 'built') greyOut();
    }
    // The grey floor for the build: the colour layer through a greyscale
    // filter, warmed a touch; or, without canvas filters, set again in grey.
    function greyOut() {
        greyL.width = colourL.width; greyL.height = colourL.height;
        const gx = greyL.getContext('2d');
        if ('filter' in gx) {
            gx.filter = 'grayscale(1) sepia(0.12)';
            gx.drawImage(colourL, 0, 0);
            gx.filter = 'none';
            return;
        }
        gx.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
        gx.textBaseline = 'alphabetic';
        for (const c of cells) { gx.fillStyle = css(c.grey, c.alpha); gx.fill(c.facePath); }
        gx.__tesS = 0;
        for (const c of cells) setWords(gx, c, css(c.greyWord));
        gx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // ---- layout ---------------------------------------------------------------
    let job = 0, ready = false;
    const breathe = () => new Promise((r) => setTimeout(r, 0));
    const pics = new Map();
    const picture = (u) => {
        const href = new URL(u, document.baseURI).href;
        if (!pics.has(href)) pics.set(href, loadImage(href));
        return pics.get(href);
    };
    async function layout() {
        const me = ++job;
        const want = narrowUrl && root.clientWidth < NARROW ? narrowUrl : url;
        const next = await picture(want);
        if (dead || me !== job) return false;
        img = next;
        const cs = getComputedStyle(root);
        const availW = Math.max(160, root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
        const aspect = img.naturalHeight / img.naturalWidth;
        W = Math.floor(Math.min(availW, (innerHeight * heightVh) / aspect));
        H = Math.round(W * aspect);
        s0 = fixedSize || clamp(W / 210, 4.2, 7);
        dpr = Math.min(3, devicePixelRatio || 1);
        if ((W + 2 * M) * (H + 2 * M) * dpr * dpr > 2.8e6) dpr = Math.min(dpr, 2);
        const pv = cs.getPropertyValue('--paper').trim();
        if (pv) {
            paper = pv;
            mctx = mctx || layer().getContext('2d');
            mctx.fillStyle = '#f3f0e8'; mctx.fillStyle = pv;
            const h = /^#([0-9a-f]{6})$/i.exec(mctx.fillStyle);
            if (h) paperRGB = [0, 2, 4].map((k) => parseInt(h[1].slice(k, k + 2), 16));
        }
        ready = false;
        canvas.style.width = W + 2 * M + 'px';      // hold the space while cutting
        canvas.style.height = H + 2 * M + 'px';
        const t0 = performance.now();
        // In slices, so a long layout never holds the page still.
        if (!(await cut(me))) return false;
        await breathe();
        if (dead || me !== job) return false;
        pour();
        await breathe();
        if (dead || me !== job) return false;
        paint();
        // data-debug: one line on the console per layout
        if (root.dataset.debug !== undefined) console.log(`tesserae: ${cells.length} cells, s0 ${s0.toFixed(2)}, ${(performance.now() - t0).toFixed(0)}ms`);
        for (const c of cells) { c.h = 0; c.hv = 0; c.n = 0; }
        ready = true;
        return true;
    }

    // ---- motion ---------------------------------------------------------------
    // Build clock: each stone has a rank (0..1). It is laid at rank x LAY,
    // in PRESS seconds, and its colour comes up WET seconds later.
    const LAY = 1.15, PRESS = 0.42, WET = 0.34, BLOOM = 0.5;
    const END = LAY + WET + 0.18 + BLOOM;
    let phase = 'idle', tb = 0, clock = 0;      // idle -> building -> built
    let visible = false, raf = 0, last = 0;
    let lifted = null, hint = null, kbd = false;

    function drawCell(c, a, col, k, dy) {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
        ctx.clip(c.fullPath);
        if (k !== 1 || dy) {
            ctx.translate(c.cx, c.cy + dy);
            ctx.scale(k, k);
            ctx.translate(-c.cx, -c.cy);
        }
        const [x0, y0, x1, y1] = c.box;
        const sx = (x0 + M) * dpr, sy = (y0 + M) * dpr, sw = (x1 - x0) * dpr, sh = (y1 - y0) * dpr;
        ctx.globalCompositeOperation = 'lighter';     // exact cross-fade: same alpha mask
        if (col < 1) { ctx.globalAlpha = a * (1 - col); ctx.drawImage(greyL, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0); }
        if (col > 0) { ctx.globalAlpha = a * col; ctx.drawImage(colourL, sx, sy, sw, sh, x0, y0, x1 - x0, y1 - y0); }
        ctx.restore();
    }

    // How far a stone comes up when lifted: enough that its type reaches
    // about 10.5px, so a small stone becomes readable.
    const liftOf = (c) => clamp(10.5 / c.size, 1.14, 2.3);
    // Where the lifted stone sits at lift h: scaled about its centre,
    // raised a little, and nudged back inside the canvas near an edge.
    function liftGeom(c, h) {
        const k = 1 + (liftOf(c) - 1) * h;
        let [x0, y0, x1, y1] = c.box;
        const cx = c.cx, cy = c.cy - 3 * h;
        x0 = cx + (x0 - c.cx) * k; x1 = cx + (x1 - c.cx) * k;
        y0 = cy + (y0 - c.cy) * k; y1 = cy + (y1 - c.cy) * k;
        const lo = -M + 4, hiX = W + M - 4, hiY = H + M - 4 - 8 * h;
        const dx = x0 < lo ? lo - x0 : x1 > hiX ? hiX - x1 : 0;
        const dy = y0 < lo ? lo - y0 : y1 > hiY ? hiY - y1 : 0;
        return { k, ox: dx, oy: dy - 3 * h };
    }
    function drawLift(c) {
        const h = c.h;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
        // take the stone out of its bed, and darken the hollow it leaves
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fill(c.fullPath);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = `rgba(60, 44, 30, ${0.1 * h})`;
        ctx.fill(c.facePath);
        const { k, ox, oy } = liftGeom(c, h);
        ctx.translate(c.cx + ox, c.cy + oy);
        ctx.scale(k, k);
        ctx.translate(-c.cx, -c.cy);
        ctx.shadowColor = `rgba(52, 36, 22, ${0.32 * h})`;
        ctx.shadowBlur = 18 * h * dpr;
        ctx.shadowOffsetY = 7 * h * dpr;
        ctx.fillStyle = paper;
        ctx.fill(c.facePath);
        ctx.shadowColor = 'transparent';
        // its face catches the light as it rises; the words go to ink
        ctx.fillStyle = css(c.rgb, mix(c.alpha, Math.min(c.alpha, 0.26), h));
        ctx.fill(c.facePath);
        ctx.textBaseline = 'alphabetic';
        ctx.__tesS = 0;
        ctx.globalAlpha = 1 - h;
        setWords(ctx, c, css(c.word));
        ctx.globalAlpha = h;
        setWords(ctx, c, css(c.ink));
        ctx.restore();
        ctx.__tesS = 0;
    }
    // Is (x, y) on the lifted stone as it is drawn now (scaled, raised)?
    function onLifted(x, y) {
        const c = lifted;
        if (!c || !c.h) return false;
        const { k, ox, oy } = liftGeom(c, c.h);
        const px = c.cx + (x - c.cx - ox) / k, py = c.cy + (y - c.cy - oy) / k;
        const p = c.full;
        for (let i = 0, n = p.length; i < n; i++) {
            const [ax, ay] = p[i], [bx, by] = p[(i + 1) % n];
            if ((bx - ax) * (py - ay) - (by - ay) * (px - ax) < 0) return false;
        }
        return true;
    }
    function drawHint(c, a) {
        const [x0, y0, x1, y1] = c.box;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
        ctx.clip(c.fullPath);
        ctx.globalAlpha = a;
        ctx.textBaseline = 'alphabetic';
        ctx.__tesS = 0;
        setWords(ctx, c, css(c.ink));
        ctx.restore();
        ctx.__tesS = 0;
    }

    function render() {
        if (!ready) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (phase === 'built') {
            ctx.globalCompositeOperation = 'copy';
            ctx.drawImage(colourL, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
        } else {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const t = phase === 'building' ? clock : -1;
            for (const c of cells) {
                const tl = c.rank * LAY;
                const p = (t - tl) / PRESS;
                if (p <= 0) continue;
                const e = easeOut(p);
                const col = easeOut((t - tl - PRESS * 0.4 - WET - c.rank * 0.18) / BLOOM);
                // set down from a hair above: a touch large, settling home
                drawCell(c, clamp(p * 2.2), col, 1 + 0.12 * (1 - e), -1.5 * (1 - e));
            }
            // the sinopia under it all, fading as the floor is finished
            const sa = phase === 'building' ? 1 - clamp((clock - LAY * 0.6) / (END - LAY * 0.6)) : 1;
            if (sa > 0) {
                ctx.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
                ctx.globalCompositeOperation = 'destination-over';
                ctx.globalAlpha = sa;
                ctx.strokeStyle = sinopia;
                ctx.lineWidth = 0.75;
                ctx.stroke(outline);
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
            }
        }
        // reading: the next stone darkens faintly, the lifted one lifts
        for (const c of cells) if (c.n > 0.004) drawHint(c, 0.34 * c.n);
        for (const c of cells) if (c.h > 0.004) drawLift(c);
    }

    function frame(now) {
        raf = 0;
        if (dead || !ready) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const still = calm.matches;
        let alive = false;
        if (phase === 'building') {
            clock = (now - tb) / 1000;
            if (clock >= END + PRESS || still) { phase = 'built'; greyL.width = greyL.height = 0; }
            else alive = true;
        }
        // Lift: a critically damped spring per stone (no overshoot).
        for (const c of cells) {
            const ht = c === lifted ? 1 : 0, nt = c === hint ? 1 : 0;
            if (still) { c.h = ht; c.hv = 0; c.n = nt; continue; }
            const K = 380, D = 2 * Math.sqrt(K);
            c.hv += (K * (ht - c.h) - D * c.hv) * dt;
            c.h += c.hv * dt;
            c.n += (nt - c.n) * (1 - Math.exp(-dt / 0.14));
            if (Math.abs(ht - c.h) > 0.002 || Math.abs(c.hv) > 0.01 || Math.abs(nt - c.n) > 0.004) alive = true;
            else { c.h = ht; c.hv = 0; c.n = nt; }
        }
        render();
        if (alive && visible) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    const kick = () => { if (!raf && !dead && ready && cells.length) raf = requestAnimationFrame(frame); };

    function startBuild() {
        if (phase !== 'idle') return;
        if (calm.matches || build === 'none') { phase = 'built'; greyL.width = greyL.height = 0; render(); return; }
        phase = 'building';
        tb = performance.now();
        clock = 0;
        kick();
    }

    // ---- input ----------------------------------------------------------------
    function cellAt(x, y) {
        if (!ready || !owner) return null;
        if (x < -4 || y < -4 || x > W + 4 || y > H + 4) return null;
        const X = clamp((x / ownerQ) | 0, 0, ownerW - 1), Y = clamp((y / ownerQ) | 0, 0, ownerH - 1);
        // the stone under the point, or (on grout) the nearest one
        for (let r = 0; r <= 4; r++) {
            let best = null, bd = Infinity;
            for (let j = Math.max(0, Y - r); j <= Math.min(ownerH - 1, Y + r); j++)
                for (let i = Math.max(0, X - r); i <= Math.min(ownerW - 1, X + r); i++) {
                    const k = owner[j * ownerW + i], ci = k >= 0 ? cellOf[k] : -1;
                    if (ci < 0) continue;
                    const d = (i - X) ** 2 + (j - Y) ** 2;
                    if (d < bd) { bd = d; best = cells[ci]; }
                }
            if (best) return best;
        }
        return null;
    }
    function lift_(c, announce) {
        if (c === lifted) return;
        lifted = c;
        hint = c ? order[c.i + 1] || null : null;
        for (const d of cells) if (d.h === undefined) { d.h = 0; d.hv = 0; d.n = 0; }
        if (announce && c) say.textContent = c.said;
        kick();
    }
    const local = (e) => {
        const r = canvas.getBoundingClientRect();
        return [e.clientX - r.left - M, e.clientY - r.top - M];
    };
    on(canvas, 'pointermove', (e) => {
        if (e.pointerType !== 'mouse' || !cells.length) return;
        const [x, y] = local(e);
        if (onLifted(x, y)) return;        // a raised stone keeps the pointer
        lift_(cellAt(x, y));
    });
    on(canvas, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && !kbd) lift_(null); });
    // Touch: a tap lifts a stone (another tap, or a tap elsewhere, sets it
    // back). Drags are left to the page: it scrolls and pinch-zooms as usual.
    let down = null;
    on(canvas, 'pointerdown', (e) => { if (e.pointerType !== 'mouse') down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    on(canvas, 'pointerup', (e) => {
        if (e.pointerType === 'mouse' || !down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t;
        down = null;
        if (moved > 10 || dt > 700 || !cells.length) return;
        const [x, y] = local(e);
        const c = cellAt(x, y);
        lift_(c === lifted ? null : c);
    });
    on(canvas, 'pointercancel', () => { down = null; });
    on(document, 'pointerdown', (e) => { if (lifted && !stage.contains(e.target)) lift_(null); });
    on(stage, 'keydown', (e) => {
        if (!ready || !cells.length) return;
        const i = lifted ? lifted.i : -1;
        let j = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = Math.min(order.length - 1, i + 1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = Math.max(0, i < 0 ? 0 : i - 1);
        else if (e.key === 'Home') j = 0;
        else if (e.key === 'End') j = order.length - 1;
        else if (e.key === 'Escape' && lifted) { lift_(null); e.preventDefault(); return; }
        if (j === null) return;
        e.preventDefault();
        kbd = true;
        if (phase !== 'built') { phase = 'built'; greyL.width = greyL.height = 0; }
        lift_(order[j], true);
    });
    on(stage, 'blur', () => { kbd = false; lift_(null); });

    // ---- start ----------------------------------------------------------------
    root.classList.add('tes', 'tes-wait');
    (async () => {
        try {
            api = await import(LIB);
            await picture(narrowUrl && root.clientWidth < NARROW ? narrowUrl : url);
            const cs = getComputedStyle(src);
            font = { style: cs.fontStyle, weight: weight || cs.fontWeight, family: family || cs.fontFamily };
            const m = cs.color.match(/\d+(\.\d+)?/g);
            if (m) inkRGB = m.slice(0, 3).map(Number);
            text = src.textContent.replace(/\s+/g, ' ').trim();
            try { await document.fonts.load(`${font.style} ${font.weight} 24px ${font.family}`); await document.fonts.ready; } catch (e) { /* measure what we have */ }
            if (dead || !text) return;
            root.appendChild(stage);
            root.classList.add('is-live');
            if (!(await layout())) return;
            root.classList.remove('tes-wait');
        } catch (e) {
            stage.remove();
            root.classList.remove('is-live', 'tes-wait');
            if (root.dataset.debug !== undefined) console.warn(e);
            return;
        }
        render();

        const io = new IntersectionObserver((en) => {
            for (const x of en) {
                visible = x.isIntersecting;
                if (visible && x.intersectionRatio >= 0.3) startBuild();
            }
            if (visible) kick();
        }, { threshold: [0, 0.3, 0.6] });
        io.observe(stage);
        off.push(() => io.disconnect());
        let timer = 0, lastW = -1, lastH = innerHeight;
        const ro = new ResizeObserver((en) => {
            const w = Math.round(en[0].contentRect.width);
            if (lastW < 0) { lastW = w; return; }
            // re-cut when the column changes width, or the window's height
            // changes a lot (not the phone's URL bar sliding)
            if (w === lastW && Math.abs(innerHeight - lastH) < 140) return;
            lastW = w; lastH = innerHeight;
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (dead) return;
                lifted = hint = null;
                if (phase === 'building') phase = 'built';
                layout().then((ok) => { if (ok) render(); });
            }, 160);
        });
        ro.observe(root);
        off.push(() => { ro.disconnect(); clearTimeout(timer); });
        on(calm, 'change', () => { if (calm.matches && phase === 'building') { phase = 'built'; render(); } });
    })();

    return function destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        off.forEach((f) => f());
        stage.remove();
        root.classList.remove('tes', 'is-live', 'tes-wait');
    };
}

// Auto-start every [data-pretext-tesserae] once it is near the viewport.
function autoStart(el) {
    if (!('IntersectionObserver' in window)) return pretextTesserae(el);
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        pretextTesserae(el);
    }, { rootMargin: '900px' });
    io.observe(el);
}
document.querySelectorAll('[data-pretext-tesserae]').forEach(autoStart);
