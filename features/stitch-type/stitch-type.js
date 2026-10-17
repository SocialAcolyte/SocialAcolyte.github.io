/*
 *  STITCH-TYPE // a heading sewn in silk satin stitch on linen.
 *
 *  Markup:  <section class="st" data-stitch-type data-thread="#8f1d22">
 *             <h1 class="st-text">Hand made</h1>
 *           </section>
 *  Or call  stitchType(section, { thread, outline, angle, density, duration })
 *  yourself. Returns a function that undoes it.
 *
 *  The heading is laid out by CSS as usual (any loaded font, any wrapping).
 *  Each word is rasterised offscreen into a mask at its exact place. From the
 *  mask: a distance field gives the stroke's "across" direction everywhere
 *  (smoothed as an orientation tensor so both sides of a stroke agree), and
 *  satin stitches are laid edge to edge along it, rotated by a slant, packed
 *  evenly, jittered, with tiny gaps. A marching-squares contour of every glyph
 *  gets a fine split-stitch outline (short overlapping stitches, each coming
 *  up through the one before), and a faint blue transfer line for the
 *  embroiderer to follow, washed away when the work is done.
 *
 *  Every stitch is one instanced capsule in WebGL2, shaded as silk floss:
 *  rounded cross-section, a raised arch, fine lengthwise fibres, and an
 *  anisotropic (Kajiya-Kay, two-lobe) sheen that depends on the stitch's
 *  direction against the light. The light follows the pointer, the phone's
 *  tilt (tilt.js) and the scroll, so strokes running different ways glint in
 *  turn, the way real satin stitch does. Shadows fall on the linen.
 *
 *  Scrolling it into view sews it: glyph by glyph, outline then fill, a steel
 *  needle with a loop of trailing thread working along the strokes. At the end
 *  the needle goes down through the cloth and the finished embroidery is left.
 *
 *  Options (data attributes, all optional):
 *    data-thread="#8f1d22"        silk colour; a list ("#c9a227, #f1d98a")
 *                                 is a variegated thread, drifting through the
 *                                 colours in sewing order
 *    data-outline="#5a1014"       split-stitch colour (default: the thread, deeper)
 *    data-angle="24"              satin slant, degrees off square-across
 *    data-density="1"             stitches per stroke; 1.5 = finer silk
 *    data-duration="2.6"          seconds to sew the whole heading
 *    data-transfer="#5d6f93"      the transfer line drawn before sewing (blue
 *                                 on pale cloth; chalk white on dark)
 *
 *  The real heading stays in the DOM (screen readers, selection, no-JS, print);
 *  once live its ink turns transparent and the canvas is aria-hidden.
 *  Reduced motion: the finished embroidery, still; the sheen still follows the
 *  pointer. Without WebGL2 a 2D canvas draws the same stitches more simply.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const hash = (i, k = 0) => {
    const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return s - Math.floor(s);
};
const num = (v, d) => (v == null || v === '' || isNaN(+v) ? d : +v);
const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const HEAD = 'h1,h2,h3,h4,h5,h6,.st-text';
const STRIDE = 14;                 // floats per stitch instance

/* ---------------------------------------------------------------- colour */

let probe;
function rgbOf(c) {
    probe = probe || document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = c;
    probe.fillRect(0, 0, 1, 1);
    const d = probe.getImageData(0, 0, 1, 1).data;
    return [lin(d[0] / 255), lin(d[1] / 255), lin(d[2] / 255)];
}
function parseThreads(v) {
    if (Array.isArray(v)) return v.map(rgbOf);
    const list = String(v).match(/#[0-9a-f]{3,8}\b|(?:rgb|hsl|oklch|oklab|lab|lch)a?\([^)]*\)|[a-z]+/gi) || ['#8f1d22'];
    return list.map(rgbOf);
}
function ramp(list, t) {
    if (list.length === 1) return list[0];
    const x = clamp(t) * (list.length - 1);
    const i = Math.min(list.length - 2, Math.floor(x));
    const f = x - i;
    return [0, 1, 2].map((k) => mix(list[i][k], list[i + 1][k], f));
}

/* ------------------------------------------------------- geometry helpers */

// Felzenszwalb & Huttenlocher squared distance transform, one dimension.
function dt1(f, n, d, v, z) {
    let k = 0;
    v[0] = 0; z[0] = -1e30; z[1] = 1e30;
    for (let q = 1; q < n; q++) {
        let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
        k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
        while (z[k + 1] < q) k++;
        d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
}
// Distance from every inside pixel to the nearest outside one.
function edt(inside, W, H) {
    const n = Math.max(W, H);
    const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1), v = new Int32Array(n);
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = inside[i] ? 1e20 : 0;
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) f[y] = out[y * W + x];
        dt1(f, H, d, v, z);
        for (let y = 0; y < H; y++) out[y * W + x] = d[y];
    }
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) f[x] = out[y * W + x];
        dt1(f, W, d, v, z);
        for (let x = 0; x < W; x++) out[y * W + x] = Math.sqrt(d[x]);
    }
    return out;
}
// Three box passes, separable: close enough to a gaussian.
function blur(a, W, H, r) {
    r = Math.max(1, Math.round(r));
    const tmp = new Float32Array(a.length);
    const k = 1 / (2 * r + 1);
    for (let pass = 0; pass < 3; pass++) {
        for (let y = 0; y < H; y++) {
            const o = y * W;
            let s = 0;
            for (let x = -r; x <= r; x++) s += a[o + clamp(x, 0, W - 1)];
            for (let x = 0; x < W; x++) {
                tmp[o + x] = s * k;
                s += a[o + Math.min(W - 1, x + r + 1)] - a[o + Math.max(0, x - r)];
            }
        }
        for (let x = 0; x < W; x++) {
            let s = 0;
            for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, H - 1) * W + x];
            for (let y = 0; y < H; y++) {
                a[y * W + x] = s * k;
                s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
            }
        }
    }
}
function bil(a, W, H, x, y) {
    if (x < 0 || y < 0 || x >= W - 1 || y >= H - 1) return 0;
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return mix(mix(a[i], a[i + 1], fx), mix(a[i + W], a[i + W + 1], fx), fy);
}

// Marching squares at 0.5 → closed loops of sub-pixel points.
const CASES = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], null, [[0, 2]], [[3, 0]],
    [[3, 0]], [[0, 2]], null, [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
function contours(M, W, H) {
    const link = new Map();
    const pt = new Map();
    const key = (e, x, y) => (e === 0 ? (y * W + x) * 2 : e === 2 ? ((y + 1) * W + x) * 2 : e === 3 ? (y * W + x) * 2 + 1 : (y * W + x + 1) * 2 + 1);
    const at = (e, x, y, v) => {
        const k = key(e, x, y);
        if (!pt.has(k)) {
            let p;
            if (e === 0) p = [x + (0.5 - v[0]) / (v[1] - v[0]), y];
            else if (e === 2) p = [x + (0.5 - v[3]) / (v[2] - v[3]), y + 1];
            else if (e === 3) p = [x, y + (0.5 - v[0]) / (v[3] - v[0])];
            else p = [x + 1, y + (0.5 - v[1]) / (v[2] - v[1])];
            pt.set(k, p);
        }
        return k;
    };
    const join = (a, b) => {
        (link.get(a) || link.set(a, []).get(a)).push(b);
        (link.get(b) || link.set(b, []).get(b)).push(a);
    };
    for (let y = 0; y < H - 1; y++) {
        for (let x = 0; x < W - 1; x++) {
            const i = y * W + x;
            const v = [M[i], M[i + 1], M[i + W + 1], M[i + W]];
            const c = (v[0] >= 0.5 ? 8 : 0) | (v[1] >= 0.5 ? 4 : 0) | (v[2] >= 0.5 ? 2 : 0) | (v[3] >= 0.5 ? 1 : 0);
            if (c === 0 || c === 15) continue;
            let segs = CASES[c];
            if (!segs) {
                const mid = (v[0] + v[1] + v[2] + v[3]) / 4 >= 0.5;
                segs = c === 5 ? (mid ? [[3, 0], [1, 2]] : [[0, 1], [3, 2]]) : (mid ? [[0, 1], [3, 2]] : [[3, 0], [2, 1]]);
            }
            for (const [e1, e2] of segs) join(at(e1, x, y, v), at(e2, x, y, v));
        }
    }
    const seen = new Set();
    const loops = [];
    for (const start of link.keys()) {
        if (seen.has(start)) continue;
        const loop = [];
        let prev = -1, cur = start;
        while (cur !== undefined && !seen.has(cur)) {
            seen.add(cur);
            loop.push(pt.get(cur));
            const nb = link.get(cur);
            const nx = nb[0] !== prev ? nb[0] : nb[1];
            prev = cur;
            cur = nx;
        }
        if (loop.length > 6) loops.push(loop);
    }
    return loops;
}

/* --------------------------------------------------------- the stitcher */

function measure(heading, host) {
    const hr = host.getBoundingClientRect();
    const ctx = document.createElement('canvas').getContext('2d');
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const runs = [];
    let em = 0;
    for (let n; (n = walker.nextNode());) {
        const cs = getComputedStyle(n.parentElement);
        const size = parseFloat(cs.fontSize);
        const font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
        const ls = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing;
        const tt = cs.textTransform;
        const raw = n.textContent;
        const re = /\S+/g;
        let m;
        ctx.font = font;
        while ((m = re.exec(raw))) {
            range.setStart(n, m.index);
            range.setEnd(n, m.index + m[0].length);
            const rects = range.getClientRects();
            const pieces = rects.length === 1 ? [[m[0], m.index, rects[0]]] : [...m[0]].map((ch, j) => {
                range.setStart(n, m.index + j); range.setEnd(n, m.index + j + 1);
                return [ch, m.index + j, range.getBoundingClientRect()];
            });
            for (const [s, , r] of pieces) {
                if (!r.width) continue;
                const str = tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase() : s;
                const fm = ctx.measureText(str);
                runs.push({
                    str, font, ls, size,
                    x: r.left - hr.left, y: r.bottom - hr.top - fm.fontBoundingBoxDescent,
                    l: r.left - hr.left, t: r.top - hr.top, r: r.right - hr.left, b: r.bottom - hr.top
                });
                em = Math.max(em, size);
            }
        }
    }
    return { runs, em, W: hr.width, H: hr.height };
}

function build(meas, cfg) {
    const { runs, em } = meas;
    if (!runs.length) return null;
    const S = clamp(170 / em, 0.6, 2.6);                 // mask px per CSS px
    const sp = Math.max(1.15, em * 0.0165 / cfg.density); // satin spacing, CSS px
    const spM = sp * S;
    const slant = cfg.angle * Math.PI / 180;

    // 1. the mask
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const r of runs) { x0 = Math.min(x0, r.l); y0 = Math.min(y0, r.t); x1 = Math.max(x1, r.r); y1 = Math.max(y1, r.b); }
    x0 -= em * 0.3; x1 += em * 0.3; y0 -= em * 0.15; y1 += em * 0.15;
    const W = Math.ceil((x1 - x0) * S), H = Math.ceil((y1 - y0) * S);
    const mc = document.createElement('canvas');
    mc.width = W; mc.height = H;
    const mx = mc.getContext('2d', { willReadFrequently: true });
    mx.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
    mx.fillStyle = '#fff';
    mx.textBaseline = 'alphabetic';
    for (const r of runs) {
        mx.font = r.font;
        if ('letterSpacing' in mx) mx.letterSpacing = r.ls;
        mx.fillText(r.str, r.x, r.y);
    }
    const px = mx.getImageData(0, 0, W, H).data;
    const M = new Float32Array(W * H);
    const IN = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) { M[i] = px[i * 4 + 3] / 255; IN[i] = M[i] >= 0.5 ? 1 : 0; }
    const toX = (x) => x0 + (x + 0.5) / S;
    const toY = (y) => y0 + (y + 0.5) / S;
    const inside = (x, y) => bil(M, W, H, x, y) >= 0.5;

    // 2. distance field → orientation tensor of the across-stroke direction
    const D = edt(IN, W, H);
    const C2 = new Float32Array(W * H), S2 = new Float32Array(W * H);
    for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (!IN[i] && !IN[i - 1] && !IN[i + 1] && !IN[i - W] && !IN[i + W]) continue;
            const gx = (D[i + 1] - D[i - 1]) * 0.5, gy = (D[i + W] - D[i - W]) * 0.5;
            const wgt = 1 / (1 + D[i] * 0.25);          // trust the edges most
            C2[i] = (gx * gx - gy * gy) * wgt;
            S2[i] = 2 * gx * gy * wgt;
        }
    }
    const br = em * S * 0.085;                  // wide: strokes turn smoothly through junctions
    blur(C2, W, H, br); blur(S2, W, H, br);
    const dirAt = (x, y) => {
        const a = 0.5 * Math.atan2(bil(S2, W, H, x, y), bil(C2, W, H, x, y)) - slant;
        return [Math.cos(a), Math.sin(a)];
    };

    // 3. components (glyphs), in reading order
    const lab = new Int32Array(W * H).fill(-1);
    const comps = [];
    const stack = [];
    for (let i = 0; i < W * H; i++) {
        if (!IN[i] || lab[i] >= 0) continue;
        const c = { id: comps.length, n: 0, sx: 0, sy: 0, minx: 1e9, sat: [], out: [], loops: [] };
        comps.push(c);
        lab[i] = c.id; stack.push(i);
        while (stack.length) {
            const j = stack.pop();
            const x = j % W, y = (j / W) | 0;
            c.n++; c.sx += x; c.sy += y; c.minx = Math.min(c.minx, x);
            for (const k of [j - 1, j + 1, j - W, j + W]) {
                if (k >= 0 && k < W * H && IN[k] && lab[k] < 0) { lab[k] = c.id; stack.push(k); }
            }
        }
    }
    const runOf = (c) => {
        const cx = toX(c.sx / c.n), cy = toY(c.sy / c.n);
        let best = 0, bd = 1e18;
        runs.forEach((r, k) => {
            const dx = Math.max(r.l - cx, 0, cx - r.r), dy = Math.max(r.t - cy, 0, cy - r.b);
            const d = dx * dx + dy * dy;
            if (d < bd - 1e-6) { bd = d; best = k; }
        });
        return best;
    };
    for (const c of comps) c.run = runOf(c);

    // 4. satin chords: cast across the stroke from dense candidates, keep the
    //    ones that sit at least a spacing away from similar chords already laid.
    //    The same machine, turned 90 degrees and coarser, lays the underlay.
    const layer = (dirFn, spL, fill, free) => {
    const spM = spL;
    const chords = [];
    const cell = spM;
    const GW = Math.ceil(W / cell) + 1, GH = Math.ceil(H / cell) + 1;
    const grid = new Array(GW * GH);
    const cast = (x, y, dx, dy, maxL) => {
        let tf = 0, tb = 0, md = 0;
        const st = 0.5;
        while (tf < maxL && inside(x + dx * (tf + st), y + dy * (tf + st))) { tf += st; md = Math.max(md, bil(D, W, H, x + dx * tf, y + dy * tf)); }
        while (tb < maxL && inside(x - dx * (tb + st), y - dy * (tb + st))) { tb += st; md = Math.max(md, bil(D, W, H, x - dx * tb, y - dy * tb)); }
        // refine both edges by bisection
        let a = tf, b = tf + st;
        for (let k = 0; k < 5; k++) { const m = (a + b) / 2; inside(x + dx * m, y + dy * m) ? (a = m) : (b = m); }
        tf = a;
        a = tb; b = tb + st;
        for (let k = 0; k < 5; k++) { const m = (a + b) / 2; inside(x - dx * m, y - dy * m) ? (a = m) : (b = m); }
        tb = a;
        return [x - dx * tb, y - dy * tb, x + dx * tf, y + dy * tf, md, tf + tb];
    };
    const cosSim = Math.cos(32 * Math.PI / 180);
    const near = (qx, qy, dx, dy, d2) => {
        const gx = (qx / cell) | 0, gy = (qy / cell) | 0;
        for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
                const g = grid[(gy + oy) * GW + gx + ox];
                if (!g) continue;
                for (let k = 0; k < g.length; k += 4) {
                    const ex = g[k] - qx, ey = g[k + 1] - qy;
                    const e2 = ex * ex + ey * ey;
                    // similar stitches keep a spacing apart; crossing ones may not touch at all
                    if (e2 < d2 && (Math.abs(g[k + 2] * dx + g[k + 3] * dy) > cosSim || e2 < d2 * 0.3)) return true;
                }
            }
        }
        return false;
    };
    const blocked = (ax, ay, bx, by, dx, dy, dmin) => {
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (spM * 0.5)));
        for (let s = 0; s <= n; s++) if (near(mix(ax, bx, s / n), mix(ay, by, s / n), dx, dy, dmin * dmin)) return true;
        return false;
    };
    // the longest free stretch of a chord around its seed (for short fill stitches)
    const trim = (ax, ay, bx, by, dx, dy, dmin, seedF) => {
        const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / (spM * 0.35)));
        const free = [];
        for (let s = 0; s <= n; s++) free.push(!near(mix(ax, bx, s / n), mix(ay, by, s / n), dx, dy, dmin * dmin));
        let c = Math.round(seedF * n);
        if (!free[c]) return null;
        let i = c, j = c;
        while (i > 0 && free[i - 1]) i--;
        while (j < n && free[j + 1]) j++;
        // pull back half a spacing from whatever it ran into
        const back = (spM * 0.25) / Math.hypot(bx - ax, by - ay);
        const f0 = i === 0 ? 0 : i / n + back, f1 = j === n ? 1 : j / n - back;
        if ((f1 - f0) * Math.hypot(bx - ax, by - ay) < spM * 1.1) return null;
        return [mix(ax, bx, f0), mix(ay, by, f0), mix(ax, bx, f1), mix(ay, by, f1)];
    };
    const lay = (ax, ay, bx, by, dx, dy, comp) => {
        chords.push({ ax, ay, bx, by, dx, dy, comp });
        const L = Math.hypot(bx - ax, by - ay);
        const n = Math.max(1, Math.ceil(L / (spM * 0.5)));
        for (let s = 0; s <= n; s++) {
            const qx = mix(ax, bx, s / n), qy = mix(ay, by, s / n);
            const k = ((qy / cell) | 0) * GW + ((qx / cell) | 0);
            (grid[k] || (grid[k] = [])).push(qx, qy, dx, dy);
        }
    };
    const maxL = em * S * 0.9;
    // fill stitches follow the satin already laid around them
    const localDir = (x, y) => {
        const gx = (x / cell) | 0, gy = (y / cell) | 0;
        let c2 = 0, s2 = 0;
        for (let oy = -2; oy <= 2; oy++) {
            for (let ox = -2; ox <= 2; ox++) {
                const g = grid[(gy + oy) * GW + gx + ox];
                if (!g) continue;
                for (let k = 0; k < g.length; k += 4) {
                    const wt = 1 / (1 + (g[k] - x) ** 2 + (g[k + 1] - y) ** 2);
                    c2 += (g[k + 2] * g[k + 2] - g[k + 3] * g[k + 3]) * wt;
                    s2 += 2 * g[k + 2] * g[k + 3] * wt;
                }
            }
        }
        if (c2 * c2 + s2 * s2 < 1e-12) return null;
        const an = 0.5 * Math.atan2(s2, c2);
        return [Math.cos(an), Math.sin(an)];
    };
    const tryAt = (x, y, dmin, loose) => {
        const i = (y | 0) * W + (x | 0);
        if (!IN[i] || D[i] < 0.75) return;
        const [dx, dy] = loose ? localDir(x, y) || dirFn(x, y) : dirFn(x, y);
        const [ax, ay, bx, by, md, L] = cast(x, y, dx, dy, maxL);
        // a chord that runs along a stroke (into a crossbar, say) is not satin
        if (!free && L > (2 * md + 2) / Math.max(0.5, Math.cos(slant)) * (loose ? 1.9 : 1.45) + spM) return;
        if (L < spM * 0.5) return;
        if (!loose) {
            if (blocked(ax, ay, bx, by, dx, dy, dmin)) return;
            lay(ax, ay, bx, by, dx, dy, lab[i]);
            return;
        }
        const seedF = Math.hypot(x - ax, y - ay) / Math.max(L, 1e-6);
        const t = trim(ax, ay, bx, by, dx, dy, dmin, seedF);
        if (t) lay(t[0], t[1], t[2], t[3], dx, dy, lab[i]);
    };
    const gc = spM / 3;
    const dmin = spM * 0.86;
    let ci = 0;
    for (let y = 1; y < H - 1; y += gc) {
        for (let x = 1; x < W - 1; x += gc) {
            ci++;
            tryAt(x + (hash(ci, 1) - 0.5) * gc * 0.7, y + (hash(ci, 2) - 0.5) * gc * 0.7, dmin, false);
        }
    }
    // gap fill: anything still bare gets a looser second pass
    const cov = new Uint8Array(W * H);
    const stamp = (c) => {
        const L = Math.hypot(c.bx - c.ax, c.by - c.ay);
        const n = Math.max(1, Math.ceil(L));
        const rr = spM * 0.62;
        for (let s = 0; s <= n; s++) {
            const qx = mix(c.ax, c.bx, s / n), qy = mix(c.ay, c.by, s / n);
            for (let yy = Math.floor(qy - rr); yy <= qy + rr; yy++) {
                for (let xx = Math.floor(qx - rr); xx <= qx + rr; xx++) {
                    if (xx >= 0 && yy >= 0 && xx < W && yy < H && (xx - qx) ** 2 + (yy - qy) ** 2 <= rr * rr) cov[yy * W + xx] = 1;
                }
            }
        }
    };
    if (!fill) return chords;
    chords.forEach(stamp);
    const holes = [];
    for (let i = 0; i < W * H; i++) if (IN[i] && !cov[i] && D[i] > 1.2) holes.push(i);
    for (let k = holes.length - 1; k > 0; k--) { const j = (hash(k, 7) * (k + 1)) | 0; [holes[k], holes[j]] = [holes[j], holes[k]]; }
    for (const i of holes) {
        if (cov[i]) continue;
        const n0 = chords.length;
        tryAt(i % W + 0.5, ((i / W) | 0) + 0.5, spM * 0.8, true);
        if (chords.length > n0) stamp(chords[chords.length - 1]);
    }
    return chords;
    };
    const chords = layer(dirAt, spM, true, false);

    // 5. chords → stitches: inset for the round ends, jitter, split long ones
    const w = sp * 1.28;                           // thread width: neighbours overlap a little
    const maxStitch = em * 0.3;
    const toStitches = (list, key, salt) => {
    for (const [k0, c] of list.entries()) {
        const k = k0 + salt;
        const comp = comps[c.comp];
        if (!comp) continue;
        let ax = toX(c.ax), ay = toY(c.ay), bx = toX(c.bx), by = toY(c.by);
        let L = Math.hypot(bx - ax, by - ay);
        const ux = (bx - ax) / L, uy = (by - ay) / L;
        const inA = w * (0.32 + (hash(k, 3) - 0.5) * 0.3), inB = w * (0.32 + (hash(k, 4) - 0.5) * 0.3);
        if (L > inA + inB + w * 0.2) { ax += ux * inA; ay += uy * inA; bx -= ux * inB; by -= uy * inB; L -= inA + inB; }
        // a hair of angular wobble about the middle
        const wob = (hash(k, 5) - 0.5) * 0.035;
        const mx2 = (ax + bx) / 2, my2 = (ay + by) / 2, cw = Math.cos(wob), sw = Math.sin(wob);
        const rot = (x, y) => [mx2 + (x - mx2) * cw - (y - my2) * sw, my2 + (x - mx2) * sw + (y - my2) * cw];
        [ax, ay] = rot(ax, ay); [bx, by] = rot(bx, by);
        const parts = Math.ceil(L / maxStitch);
        const ww = w * (0.94 + hash(k, 6) * 0.14);
        if (parts <= 1) comp[key].push([ax, ay, bx, by, ww, k]);
        else {
            // long and short: split points staggered from row to row
            let prev = 0;
            for (let p = 1; p <= parts; p++) {
                const f = p === parts ? 1 : (p + (k % 2 ? 0.28 : -0.28)) / parts;
                comp[key].push([mix(ax, bx, prev), mix(ay, by, prev), mix(ax, bx, f), mix(ay, by, f), ww, k * 7 + p]);
                prev = f;
            }
        }
    }
    };
    toStitches(chords, 'sat', 0);

    // 6. contours → split-stitch outline + transfer dashes
    const loops = contours(M, W, H);
    const ow = sp * 0.78;
    const ol = sp * 2.5, adv = ol * 0.58;
    const transfer = [];
    for (const raw of loops) {
        // which glyph: the inside pixel touching the first point
        const [px0, py0] = raw[0];
        let id = -1;
        for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1], [1, 0], [0, 1], [1, 1]]) {
            const j = (Math.floor(py0) + oy) * W + Math.floor(px0) + ox;
            if (j >= 0 && j < W * H && lab[j] >= 0) { id = lab[j]; break; }
        }
        if (id < 0) continue;
        // smooth, to CSS px
        const n = raw.length;
        const pts = raw.map((p, i) => {
            const a = raw[(i - 1 + n) % n], b = raw[(i + 1) % n];
            return [toX((a[0] + 2 * p[0] + b[0]) / 4), toY((a[1] + 2 * p[1] + b[1]) / 4)];
        });
        pts.push(pts[0]);
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        const per = cum[cum.length - 1];
        if (per < sp * 2) continue;
        let seg = 0;
        const at = (s) => {
            s = ((s % per) + per) % per;
            if (s < cum[seg]) seg = 0;
            while (seg < cum.length - 2 && cum[seg + 1] < s) seg++;
            const f = (s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
            return [mix(pts[seg][0], pts[seg + 1][0], f), mix(pts[seg][1], pts[seg + 1][1], f)];
        };
        // inward normal: step a little and ask the mask
        const inward = (p, q) => {
            const tx = q[0] - p[0], ty = q[1] - p[1], tl = Math.hypot(tx, ty) || 1;
            const nx = -ty / tl, ny = tx / tl;
            const mxp = (p[0] + q[0]) / 2, myp = (p[1] + q[1]) / 2;
            const s = bil(M, W, H, (mxp + nx - x0) * S - 0.5, (myp + ny - y0) * S - 0.5) > bil(M, W, H, (mxp - nx - x0) * S - 0.5, (myp - ny - y0) * S - 0.5) ? 1 : -1;
            return [nx * s, ny * s];
        };
        const comp = comps[id];
        const loop = [];
        const count = Math.max(2, Math.round(per / adv));
        const step = per / count;
        const s0 = hash(id * 13 + loops.length, 8) * step;
        for (let i = 0; i < count; i++) {
            const s = s0 + i * step;
            seg = 0;
            const p = at(s), q = at(Math.min(s + Math.min(ol, per * 0.45), s0 + per + step * 0.4));
            const [nx, ny] = inward(p, q);
            const ins = ow * 0.28;
            loop.push([p[0] + nx * ins, p[1] + ny * ins, q[0] + nx * ins, q[1] + ny * ins, ow * (0.95 + hash(i, 9) * 0.1), i + id * 1000]);
        }
        comp.loops.push({ per, st: loop });
        // transfer: short dashes along the contour
        const dl = sp * 2.6, gap = sp * 1.7;
        for (let s = hash(id, 10) * gap; s + dl < per; s += dl + gap) {
            seg = 0;
            const p = at(s), q = at(s + dl);
            transfer.push([p[0], p[1], q[0], q[1]]);
        }
    }
    for (const c of comps) {
        c.loops.sort((a, b) => b.per - a.per);
        c.out = c.loops.flatMap((l) => l.st);
    }

    // 7. sewing order: glyphs in reading order; in each, the satin is worked as
    //    a nearest-neighbour chain so the needle travels along the strokes.
    comps.sort((a, b) => a.run - b.run || a.minx - b.minx);
    for (const c of comps) {
        const s = c.sat;
        if (s.length < 2) continue;
        const mid = s.map((t) => [(t[0] + t[2]) / 2, (t[1] + t[3]) / 2]);
        const used = new Uint8Array(s.length);
        let cur = 0, best = 1e18;
        mid.forEach((m, i) => { const v = m[0] * 0.4 + m[1]; if (v < best) { best = v; cur = i; } });
        const order = [];
        let ax = s[cur][0], ay = s[cur][1];
        for (let k = 0; k < s.length; k++) {
            used[cur] = 1;
            const t = s[cur];
            // come up on the same side as the last stitch did
            const flip = Math.hypot(t[2] - ax, t[3] - ay) < Math.hypot(t[0] - ax, t[1] - ay);
            const o = flip ? [t[2], t[3], t[0], t[1], t[4], t[5]] : t;
            order.push(o);
            ax = o[0]; ay = o[1];
            let nb = -1, nd = 1e18;
            const [cx, cy] = mid[cur];
            for (let i = 0; i < s.length; i++) {
                if (used[i]) continue;
                const d = (mid[i][0] - cx) ** 2 + (mid[i][1] - cy) ** 2;
                if (d < nd) { nd = d; nb = i; }
            }
            if (nb < 0) break;
            cur = nb;
        }
        c.sat = order;
    }

    // 8. padding: the glyphs, eroded to sit inside the outline, as a texture.
    //    Red channel coverage, green the glyph's index (time is filled in later).
    const er = ow * 0.55 * S;
    const pad = new Uint8Array(W * H * 4);
    const rank = new Map(comps.map((c, i) => [c.id, i]));
    for (let i = 0; i < W * H; i++) {
        const a = clamp(D[i] - er + 0.5);
        if (a <= 0) continue;
        pad[i * 4] = a * 255;
        pad[i * 4 + 1] = rank.get(lab[i]) ?? 0;
        pad[i * 4 + 3] = 255;
    }
    return { comps, transfer, sp, w, ow, em, box: [x0, y0, x1, y1], pad: { data: pad, W, H, x: x0, y: y0, S } };
}

/* ------------------------------------------------- instances & timing */

function pack(geo, cfg) {
    const { comps, transfer, sp, em } = geo;
    const total = comps.reduce((a, c) => a + c.sat.length + c.out.length, 0);
    const T = cfg.duration > 0 ? cfg.duration : clamp(1.5 + total * 0.00055, 2.1, 3.3);
    const intro = 0.45, hop = 0.05;
    const cost = (c) => c.sat.length + c.out.length * 0.55;
    const allCost = comps.reduce((a, c) => a + cost(c), 0) || 1;
    const avail = T - hop * Math.max(0, comps.length - 1);
    // gentle rhythm: a beat slower at the start and the end
    const warp = (u) => u - 0.055 * Math.sin(2 * Math.PI * u);

    const satin = new Float32Array(comps.reduce((a, c) => a + c.sat.length, 0) * STRIDE);
    const outline = new Float32Array(comps.reduce((a, c) => a + c.out.length, 0) * STRIDE);
    const trans = new Float32Array(transfer.length * STRIDE);
    const padT = new Float32Array(256).fill(1e6);
    const seq = [];                 // every stitch in sewing order: [t0, dur, ax, ay, bx, by]
    const outCol = cfg.outline ? rgbOf(cfg.outline) : null;
    let si = 0, oi = 0, acc = 0, sewn = 0;
    const put = (arr, i, s, t0, dur, col, kind, h) => {
        const o = i * STRIDE;
        arr[o] = s[0]; arr[o + 1] = s[1]; arr[o + 2] = s[2]; arr[o + 3] = s[3];
        arr[o + 4] = s[4]; arr[o + 5] = t0; arr[o + 6] = dur; arr[o + 7] = hash(s[5], 11);
        const j = 0.93 + hash(s[5], 12) * 0.12;   // dye-lot wobble
        arr[o + 8] = col[0] * j; arr[o + 9] = col[1] * j; arr[o + 10] = col[2] * j; arr[o + 11] = kind;
        arr[o + 12] = h; arr[o + 13] = h;
    };
    const tAt = (c) => intro + warp(c / allCost) * avail;
    comps.forEach((c, ci) => {
        const base = ci * hop;
        const n = c.out.length;
        for (let k = 0; k < n; k++) {
            const a = acc + k * 0.55, t0 = tAt(a) + base, t1 = tAt(a + 0.55) + base;
            const col = outCol || ramp(cfg.thread, sewn / total).map((v) => v * 0.62);
            put(outline, oi++, c.out[k], t0, Math.max(0.045, (t1 - t0) * 4), col, 1, geo.ow * 0.7);
            seq.push([t0, Math.max(0.045, (t1 - t0) * 4), ...c.out[k].slice(0, 4)]);
            sewn++;
        }
        acc += n * 0.55;
        if (ci < 256) padT[ci] = tAt(acc) + base;
        for (const s of c.sat) {
            const t0 = tAt(acc) + base, t1 = tAt(acc + 1) + base;
            put(satin, si++, s, t0, Math.max(0.04, (t1 - t0) * 3), ramp(cfg.thread, sewn / total), 0, geo.w * 0.45);
            seq.push([t0, Math.max(0.04, (t1 - t0) * 3), s[0], s[1], s[2], s[3]]);
            acc += 1;
            sewn++;
        }
    });
    const tc = rgbOf(cfg.transfer);
    transfer.forEach((t, i) => put(trans, i, [...t, Math.max(0.7, sp * 0.3), i], -1e6, 1e-3, tc, 4, 0));
    seq.sort((a, b) => a[0] - b[0]);
    const end = seq.length ? seq[seq.length - 1][0] + seq[seq.length - 1][1] : intro;
    // padding colour: the thread at this glyph, deep in shadow
    const padRGB = new Uint8Array(geo.pad.data);
    const counts = [];
    let run = 0;
    comps.forEach((c) => { counts.push(run); run += c.out.length + c.sat.length; });
    const deep = (ci) => ramp(cfg.thread, (counts[ci] || 0) / Math.max(1, total)).map((v) => Math.round(255 * Math.pow(v * 0.3, 1 / 2.2)));
    const cache = new Map();
    for (let i = 0; i < padRGB.length; i += 4) {
        if (!padRGB[i + 3]) continue;
        const ci = padRGB[i + 1];
        const c = cache.get(ci) || cache.set(ci, deep(ci)).get(ci);
        const a = padRGB[i] / 255;
        // premultiplied
        padRGB[i] = c[0] * a; padRGB[i + 1] = c[1] * a; padRGB[i + 2] = c[2] * a; padRGB[i + 3] = a * 255;
    }
    const padTime = new Uint8Array(geo.pad.W * geo.pad.H);
    for (let i = 0, j = 0; i < geo.pad.data.length; i += 4, j++) padTime[j] = geo.pad.data[i + 1];
    return { satin, outline, trans, seq, end, intro, sp, em, w: geo.w,
        pad: { rgba: padRGB, idx: padTime, W: geo.pad.W, H: geo.pad.H, x: geo.pad.x, y: geo.pad.y, S: geo.pad.S, times: padT } };
}

/* -------------------------------------------------------------- shaders */

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aC;
layout(location=1) in vec4 iAB;
layout(location=2) in vec4 iP;
layout(location=3) in vec4 iCol;
layout(location=4) in vec2 iH;
uniform vec2 uRes; uniform float uClock; uniform float uPass; uniform vec3 uLight;
out vec2 vP; flat out vec4 vAB; flat out vec4 vQ; flat out vec4 vCol; flat out vec3 vX;
void main(){
  float g = clamp((uClock - iP.y) / max(iP.z, 1e-4), 0., 1.);
  float kind = iCol.w;
  if (g <= 0. || (uPass < .5 && kind > 3.5)) { gl_Position = vec4(3., 3., 3., 1.); return; }
  vec2 A = iAB.xy, B = mix(A, iAB.zw, g);
  float w = iP.x;
  // a stitch just pulled through sits a little proud, then settles
  float age = max(uClock - iP.y - iP.z, 0.);
  float lift = kind < 1.5 ? 1. + 1.2 * exp(-age / .2) : 1.;
  vec2 h = iH * lift;
  if (uPass < .5) {
    // cast away from the lamp, by height; long throws are clamped and softened
    vec2 dA = A - uLight.xy, dB = B - uLight.xy;
    A += normalize(dA + 1e-4) * h.x * min(length(dA) / max(uLight.z, 1.), 1.1) * .75;
    B += normalize(dB + 1e-4) * h.y * min(length(dB) / max(uLight.z, 1.), 1.1) * .75;
  }
  vec2 d = B - A; float L = length(d);
  vec2 u = L > 1e-3 ? d / L : vec2(1., 0.);
  vec2 n = vec2(-u.y, u.x);
  float pad = w * .5 + (uPass < .5 ? w * (kind > 1.5 && kind < 3.5 ? 1.6 : .9) + 1. : 1.5);
  vec2 P = mix(A - u * pad, B + u * pad, aC.x * .5 + .5) + n * pad * aC.y;
  vP = P; vAB = vec4(A, B); vQ = vec4(w, g, iP.w, L); vCol = iCol; vX = vec3(h, length(iAB.zw - iAB.xy));
  vec2 c = P / uRes * 2. - 1.;
  gl_Position = vec4(c.x, -c.y, 0., 1.);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vP; flat in vec4 vAB; flat in vec4 vQ; flat in vec4 vCol; flat in vec3 vX;
uniform float uPass; uniform vec3 uLight; uniform float uDpr; uniform float uFade; uniform float uTransfer; uniform float uNeedle;
out vec4 o;
float h1(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  vec2 A = vAB.xy, B = vAB.zw;
  float w = vQ.x, hw = w * .5, L = vQ.w, seed = vQ.z, kind = vCol.w;
  vec2 d = B - A; vec2 u = L > 1e-3 ? d / L : vec2(1., 0.); vec2 nr = vec2(-u.y, u.x);
  vec2 pa = vP - A;
  float al = dot(pa, u), ac = dot(pa, nr);
  float tc = clamp(al, 0., L);
  vec2 rv = vP - (A + u * tc);
  float r = length(rv);
  float rr = hw;
  bool needle = kind > 1.5 && kind < 2.5;
  if (needle) {
    // a steel needle: sharp point at A, eye near B. vX.z = full length
    float fromTip = uNeedle - (L - tc);
    rr = hw * mix(.12, 1., pow(smoothstep(0., uNeedle * .24, fromTip), .7));
    if (al < 0.) rr = 0.;
  }
  if (uPass < .5) {
    float soft = hw * (needle ? 1.6 : .85) + .7;
    float a = 1. - smoothstep(rr - soft * .4, rr + soft, r);
    float k = needle ? .26 : (kind > 2.5 ? .2 : .34);
    k *= kind > 1.5 ? uFade : 1.;
    o = vec4(vec3(.09, .06, .04) * a * k, a * k);
    return;
  }
  float cov = clamp((rr - r) * uDpr + .5, 0., 1.);
  if (cov <= 0.) discard;
  if (kind > 3.5) {
    // transfer line: faint water-soluble blue, washed out when sewn
    float a = cov * .5 * uTransfer;
    o = vec4(vCol.rgb * a, a);
    o.rgb = pow(o.rgb / max(a, 1e-4), vec3(1. / 2.2)) * a;
    return;
  }
  vec2 q = rv / max(rr, 1e-3);
  float u2 = min(dot(q, q), 1.);
  float across = clamp(ac / max(rr, 1e-3), -1., 1.);
  float t = L > 1e-3 ? tc / L : .5;
  vec3 V = vec3(0., 0., 1.);
  vec3 col;
  if (needle) {
    vec3 N = normalize(vec3(q * .95, sqrt(max(1. - u2, 0.))));
    vec3 Ld = normalize(uLight - vec3(vP, vX.y * t));
    vec3 H = normalize(Ld + V);
    vec3 T = normalize(vec3(u, vX.y / max(L, 1.)));
    float th = dot(T, H);
    float s = pow(sqrt(max(0., 1. - th * th)), 160.) * smoothstep(-.2, .5, dot(N, H));
    float env = smoothstep(-.4, .7, dot(N.xy, normalize(-uLight.xy + vP)) * -1.);
    col = vec3(.08, .085, .09) + vec3(.55, .56, .6) * env * .8 + vec3(1.) * s * 1.6 + vec3(.25) * max(dot(N, Ld), 0.);
    // the eye: a slot near the blunt end
    float fromEye = L - tc;
    float slot = smoothstep(.0, .02, fromEye - uNeedle * .045) * smoothstep(.0, .02, uNeedle * .13 - fromEye);
    slot *= 1. - smoothstep(rr * .22, rr * .36, abs(ac));
    col = mix(col, vec3(.05, .04, .035), slot * .9);
  } else {
    bool twist = kind > .5;
    float fib = h1(floor((across * .5 + .5) * (twist ? 5. : 8.)) * 7.31 + seed * 91.7);
    vec3 N = normalize(vec3(q * (twist ? .9 : .55), sqrt(max(1. - u2, 0.))));
    float archH = kind < .5 ? w * .5 : (kind < 1.5 ? w * .35 : 0.);
    float hgt = 4. * t * (1. - t) * archH + (kind > 2.5 ? mix(vX.x, vX.y, t) : 0.);
    float slope = L > 1e-3 ? 4. * archH * (1. - 2. * t) / L + (kind > 2.5 ? (vX.y - vX.x) / L : 0.) : 0.;
    vec3 T = normalize(vec3(u, slope));
    float groove = 1.;
    if (twist) {
      // two plies twisted: fibres lean, grooves run diagonally
      float per = w * 1.15;
      float ph = fract((al - ac * 1.1) / per + seed);
      groove = mix(.55, 1., smoothstep(0., .22, ph) * smoothstep(1., .78, ph));
      vec3 tw = normalize(vec3(u * .82 + nr * .57, 0.));
      T = normalize(mix(T, tw, .65) + vec3(0., 0., (ph - .5) * .5));
    }
    vec3 Ld = normalize(uLight - vec3(vP, hgt));
    vec3 H = normalize(Ld + V);
    vec3 T1 = normalize(T + N * (-.07 + (fib - .5) * .16));
    vec3 T2 = normalize(T + N * .12);
    float a1 = dot(T1, H), a2 = dot(T2, H);
    float s1 = pow(sqrt(max(0., 1. - a1 * a1)), twist ? 90. : 260.);
    float s2 = pow(sqrt(max(0., 1. - a2 * a2)), 40.);
    float kd = sqrt(max(0., 1. - pow(dot(T, Ld), 2.)));
    float lam = max(dot(N, Ld), 0.);
    float diff = mix(lam, kd, .45);
    float ao = mix(twist ? .4 : .58, 1., pow(max(1. - u2, 0.), .5));
    if (kind < 1.5) ao *= mix(.55, 1., smoothstep(0., w * 1.2, min(tc, L - tc) + w * .15));
    ao *= groove;
    vec3 base = vCol.rgb * (.86 + .26 * fib);
    float vis = smoothstep(0., .25, lam);
    vec3 sheen = mix(base * 2.2 + .04, vec3(1., .95, .88), .45);
    col = base * (.22 + .85 * diff) * ao
        + (sheen * s1 * (twist ? .45 : .75) + base * s2 * 1.3) * ao * vis;
  }
  col = col / (1. + col * .12);
  float a = cov * (kind > 1.5 ? uFade : 1.);
  o = vec4(pow(max(col, 0.), vec3(1. / 2.2)) * a, a);
}`;

const PVS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aC;
uniform vec2 uRes; uniform vec4 uBox;
out vec2 vUV; out vec2 vP;
void main(){
  vec2 t = aC * .5 + .5;
  vUV = t;
  vP = mix(uBox.xy, uBox.zw, t);
  vec2 c = vP / uRes * 2. - 1.;
  gl_Position = vec4(c.x, -c.y, 0., 1.);
}`;
const PFS = `#version 300 es
precision highp float;
in vec2 vUV; in vec2 vP;
uniform sampler2D uTex; uniform highp usampler2D uIdx; uniform vec4 uTimes[64]; uniform float uClock;
out vec4 o;
float h2(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec4 c = texture(uTex, vUV);
  if (c.a < .004) discard;
  ivec2 sz = textureSize(uIdx, 0);
  uint id = texelFetch(uIdx, ivec2(vUV * vec2(sz)), 0).r;
  int i = int(id);
  float t = uTimes[i / 4][i % 4];
  float a = smoothstep(t, t + .12, uClock);
  float n = .8 + .4 * h2(floor(vP * .8));
  o = vec4(c.rgb * n, c.a) * a;
}`;

function makeGL(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) return null;
    const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const U = {};
    for (const n of ['uRes', 'uClock', 'uPass', 'uLight', 'uDpr', 'uFade', 'uTransfer', 'uNeedle']) U[n] = gl.getUniformLocation(prog, n);
    const pprog = gl.createProgram();
    gl.attachShader(pprog, sh(gl.VERTEX_SHADER, PVS));
    gl.attachShader(pprog, sh(gl.FRAGMENT_SHADER, PFS));
    gl.linkProgram(pprog);
    if (!gl.getProgramParameter(pprog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pprog));
    const PU = {};
    for (const n of ['uRes', 'uBox', 'uTex', 'uIdx', 'uTimes', 'uClock']) PU[n] = gl.getUniformLocation(pprog, n);
    let padInfo = null;
    const texRGBA = gl.createTexture(), texIdx = gl.createTexture();
    const pad = (p) => {
        padInfo = p;
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.bindTexture(gl.TEXTURE_2D, texRGBA);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, p.W, p.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, p.rgba);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.bindTexture(gl.TEXTURE_2D, texIdx);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, p.W, p.H, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, p.idx);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (let k = 1; k <= 4; k++) { gl.enableVertexAttribArray(k); gl.vertexAttribDivisor(k, 1); }
    const bufs = {};
    const upload = (name, data, dynamic) => {
        if (!bufs[name]) bufs[name] = { b: gl.createBuffer(), n: 0 };
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs[name].b);
        gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
        bufs[name].n = data.length / STRIDE;
    };
    const draw = (name, pass) => {
        const B = bufs[name];
        if (!B || !B.n) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, B.b);
        const st = STRIDE * 4;
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, st, 0);
        gl.vertexAttribPointer(2, 4, gl.FLOAT, false, st, 16);
        gl.vertexAttribPointer(3, 4, gl.FLOAT, false, st, 32);
        gl.vertexAttribPointer(4, 2, gl.FLOAT, false, st, 48);
        gl.uniform1f(U.uPass, pass);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, B.n);
    };
    const frame = (s) => {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(vao);
        if (padInfo) {
            gl.useProgram(pprog);
            gl.uniform2f(PU.uRes, s.W, s.H);
            gl.uniform4f(PU.uBox, padInfo.x, padInfo.y, padInfo.x + padInfo.W / padInfo.S, padInfo.y + padInfo.H / padInfo.S);
            gl.uniform4fv(PU.uTimes, padInfo.times);
            gl.uniform1f(PU.uClock, s.clock);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texRGBA);
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texIdx);
            gl.uniform1i(PU.uTex, 0); gl.uniform1i(PU.uIdx, 1);
            for (let k = 1; k <= 4; k++) gl.disableVertexAttribArray(k);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            for (let k = 1; k <= 4; k++) gl.enableVertexAttribArray(k);
            gl.useProgram(prog);
        }
        gl.uniform2f(U.uRes, s.W, s.H);
        gl.uniform1f(U.uClock, s.clock);
        gl.uniform3f(U.uLight, s.light[0], s.light[1], s.light[2]);
        gl.uniform1f(U.uDpr, s.dpr);
        gl.uniform1f(U.uFade, s.fade);
        gl.uniform1f(U.uTransfer, s.transfer);
        gl.uniform1f(U.uNeedle, s.needleLen);
        if (s.transfer > 0.003) draw('trans', 1);
        draw('satin', 0); draw('satin', 1);
        draw('outline', 0); draw('outline', 1);
        if (s.dyn) { draw('dyn', 0); draw('dyn', 1); }
    };
    const lose = () => { const e = gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); };
    return { upload, frame, lose, gl, pad };
}

/* ---------------------------------------------- 2D fallback (no WebGL2) */

function make2D(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const bufs = {};
    const srgb = (v) => Math.round(255 * Math.pow(clamp(v / (1 + v * 0.12)), 1 / 2.2));
    const upload = (name, data) => { bufs[name] = data; };
    let padImg = null, padInfo = null;
    const pad = (p) => {
        padInfo = p;
        padImg = document.createElement('canvas');
        padImg.width = p.W; padImg.height = p.H;
        const id = new ImageData(p.W, p.H);
        for (let i = 0; i < p.rgba.length; i += 4) {
            const a = p.rgba[i + 3] / 255;
            if (!a) continue;
            id.data[i] = p.rgba[i] / a; id.data[i + 1] = p.rgba[i + 1] / a; id.data[i + 2] = p.rgba[i + 2] / a; id.data[i + 3] = p.rgba[i + 3];
        }
        padImg.getContext('2d').putImageData(id, 0, 0);
    };
    const draw = (name, s, pass) => {
        const a = bufs[name];
        if (!a) return;
        for (let i = 0; i < a.length; i += STRIDE) {
            const kind = a[i + 11];
            const g = clamp((s.clock - a[i + 5]) / Math.max(a[i + 6], 1e-4));
            if (g <= 0) continue;
            const ax = a[i], ay = a[i + 1], bx = mix(ax, a[i + 2], g), by = mix(ay, a[i + 3], g);
            const w = a[i + 4];
            ctx.lineWidth = w;
            if (pass === 0) {
                if (kind > 3.5) continue;
                ctx.strokeStyle = 'rgba(30,20,12,.22)';
                const o = a[i + 12] * 0.6;
                const lx = ((ax + bx) / 2 - s.light[0]), ly = ((ay + by) / 2 - s.light[1]);
                const ll = Math.hypot(lx, ly) || 1;
                ctx.beginPath(); ctx.moveTo(ax + lx / ll * o, ay + ly / ll * o); ctx.lineTo(bx + lx / ll * o, by + ly / ll * o); ctx.stroke();
                continue;
            }
            if (kind > 3.5) {
                if (s.transfer < 0.01) continue;
                ctx.strokeStyle = `rgba(93,111,147,${0.5 * s.transfer})`;
                ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
                continue;
            }
            // one sheen value per stitch, from its direction against the light
            const L = Math.hypot(bx - ax, by - ay) || 1;
            const tx = (bx - ax) / L, ty = (by - ay) / L;
            let lx = s.light[0] - (ax + bx) / 2, ly = s.light[1] - (ay + by) / 2, lz = s.light[2];
            const ln = Math.hypot(lx, ly, lz); lx /= ln; ly /= ln; lz /= ln;
            const hx = lx, hy = ly, hz = lz + 1, hn = Math.hypot(hx, hy, hz);
            const th = (tx * hx + ty * hy) / hn;
            const spec = Math.pow(Math.sqrt(Math.max(0, 1 - th * th)), 120);
            const kd = Math.sqrt(Math.max(0, 1 - (tx * lx + ty * ly) ** 2));
            const c = [0, 1, 2].map((k) => a[i + 8 + k]);
            ctx.strokeStyle = `rgb(${c.map((v) => srgb(v * (0.3 + 0.45 * kd))).join(',')})`;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
            ctx.lineWidth = w * 0.5;
            ctx.strokeStyle = `rgb(${c.map((v) => srgb(v * (0.55 + 0.6 * kd) + spec * 0.3 * (v * 2 + 0.06))).join(',')})`;
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        }
    };
    const frame = (s) => {
        ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
        ctx.clearRect(0, 0, s.W, s.H);
        ctx.lineCap = 'round';
        draw('trans', s, 1);
        if (padImg && s.clock >= padInfo.times[0]) ctx.drawImage(padImg, padInfo.x, padInfo.y, padInfo.W / padInfo.S, padInfo.H / padInfo.S);
        draw('satin', s, 0); draw('satin', s, 1);
        draw('outline', s, 0); draw('outline', s, 1);
    };
    return { upload, frame, pad, lose() {} };
}

/* ------------------------------------------------------------ the piece */

export function stitchType(host, opts = {}) {
    if (!host) return () => {};
    const heading = host.matches(HEAD) ? host : host.querySelector('.st-text') || host.querySelector(HEAD);
    if (!heading) return () => {};
    const ds = host.dataset;
    const cfg = {
        thread: parseThreads(opts.thread ?? ds.thread ?? '#8f1d22'),
        outline: opts.outline ?? ds.outline ?? null,
        angle: num(opts.angle ?? ds.angle, 24),
        density: clamp(num(opts.density ?? ds.density, 1), 0.4, 2.5),
        duration: num(opts.duration ?? ds.duration, 0),
        transfer: opts.transfer ?? ds.transfer ?? '#5d6f93',
    };

    let dead = false;
    let canvas = null, R = null, data = null;
    let W = 0, H = 0, dpr = 1;
    let raf = 0, last = 0, visible = false;
    let state = 'idle';                   // idle → sewing → done
    let clock = -1, startAt = 0;
    const light = { x: 0, y: 0, z: 1, vx: 0, vy: 0, vz: 0, init: false };
    const ptr = { x: 0, y: 0, on: false, until: 0 };
    let tilt = { x: 0, y: 0, active: false };
    const needle = { x: 0, y: 0, vx: 0, vy: 0, ang: -0.75, f: 0, init: false };
    let rope = null;
    const cleanup = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); cleanup.push(() => t.removeEventListener(ev, fn, o)); };

    function size() {
        const r = host.getBoundingClientRect();
        W = Math.max(1, Math.round(r.width));
        H = Math.max(1, Math.round(r.height));
        dpr = Math.min(3, devicePixelRatio || 1);
        while (W * H * dpr * dpr > 14e6 && dpr > 1) dpr -= 0.25;
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
    }

    let builtW = 0;
    function rebuild() {
        size();
        const meas = measure(heading, host);
        const geo = build(meas, cfg);
        if (!geo) return false;
        data = pack(geo, cfg);
        data.box = geo.box;
        R.upload('satin', data.satin);
        R.upload('outline', data.outline);
        R.upload('trans', data.trans);
        R.pad(data.pad);
        builtW = W;
        return true;
    }

    // the light: an anglepoise held over the work. Pointer, tilt, scroll.
    function lightTarget() {
        const [bx0, by0, bx1, by1] = data.box;
        const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, bw = bx1 - bx0, bh = by1 - by0;
        const z = Math.max(bw, bh * 2) * 0.3;
        if (ptr.on || performance.now() < ptr.until) return [ptr.x, ptr.y, data.em * 1.5];
        const r = host.getBoundingClientRect();
        // scrolling slides the lamp: the sheen travels as the work passes
        const sc = clamp(((r.top + cy) - innerHeight / 2) / innerHeight, -1, 1);
        let x = cx - bw * 0.42, y = cy - bh * 0.9 - sc * bh * 1.6;
        if (tilt.active) { x = cx + tilt.x * bw * 0.7; y = cy + tilt.y * bh * 2.2 - bh * 0.4; }
        return [x, y, z];
    }

    function stepNeedle(dt) {
        const seq = data.seq;
        // the work point: where the newest stitch has reached
        let lo = 0, hi = seq.length - 1, k = -1;
        while (lo <= hi) { const m = (lo + hi) >> 1; if (seq[m][0] <= clock) { k = m; lo = m + 1; } else hi = m - 1; }
        const s = seq[Math.max(0, k)];
        const g = k < 0 ? 0 : clamp((clock - s[0]) / s[1]);
        const tx = mix(s[2], s[4], g), ty = mix(s[3], s[5], g);
        if (!needle.init) { needle.x = tx; needle.y = ty; needle.init = true; }
        const om = 34;
        const ax = om * om * (tx - needle.x) - 2 * om * needle.vx, ay = om * om * (ty - needle.y) - 2 * om * needle.vy;
        needle.vx += ax * dt; needle.vy += ay * dt;
        needle.x += needle.vx * dt; needle.y += needle.vy * dt;
        const lean = clamp(needle.vx * 0.0006, -0.25, 0.25) - clamp(needle.vy * 0.0003, -0.15, 0.15);
        needle.ang += (-0.78 + lean - needle.ang) * (1 - Math.exp(-dt * 6));
        // up through the cloth at the start, down through it at the end
        const out = state === 'sewing' && clock < data.end + 0.05;
        needle.f += ((out && clock > -0.2 ? 1 : 0) - needle.f) * (1 - Math.exp(-dt * (out ? 7 : 5)));
        if (!out && needle.f < 0.01) needle.f = 0;
        // where the thread went in a moment ago: a slower follower of the tip
        if (!needle.ax) { needle.ax = needle.x; needle.ay = needle.y; needle.avx = 0; needle.avy = 0; }
        const oa = 9;
        needle.avx += (oa * oa * (needle.x - needle.ax) - 2 * oa * needle.avx) * dt;
        needle.avy += (oa * oa * (needle.y - needle.ay) - 2 * oa * needle.avy) * dt;
        needle.ax += needle.avx * dt; needle.ay += needle.avy * dt;
        return [needle.ax, needle.ay];
    }

    function dynInstances(dt, anchor) {
        const em = data.em, w = data.w;
        const Ln = em * 0.62;
        const ux = Math.cos(needle.ang), uy = Math.sin(needle.ang);
        const f = needle.f;
        const ex = needle.x + ux * Ln * f, ey = needle.y + uy * Ln * f;
        const eyeH = Ln * f * 0.3;
        // rope: verlet chain from the needle's eye to where the thread went in
        const N = 22;
        const restTotal = (Math.hypot(ex - anchor[0], ey - anchor[1]) * 1.04 + em * 0.35) * Math.max(f, 0.02);
        if (!rope) {
            rope = { x: new Float32Array(N + 1), y: new Float32Array(N + 1), px: new Float32Array(N + 1), py: new Float32Array(N + 1) };
            for (let i = 0; i <= N; i++) { rope.x[i] = rope.px[i] = mix(ex, anchor[0], i / N); rope.y[i] = rope.py[i] = mix(ey, anchor[1], i / N); }
        }
        const gy = em * 2.5, damp = Math.exp(-dt * 4);
        for (let i = 1; i < N; i++) {
            const vx = (rope.x[i] - rope.px[i]) * damp, vy = (rope.y[i] - rope.py[i]) * damp;
            rope.px[i] = rope.x[i]; rope.py[i] = rope.y[i];
            rope.x[i] += vx; rope.y[i] += vy + gy * dt * dt;
        }
        rope.x[0] = ex - ux * Ln * f * 0.08; rope.y[0] = ey - uy * Ln * f * 0.08;
        rope.x[N] = anchor[0]; rope.y[N] = anchor[1];
        const rest = restTotal / N;
        for (let it = 0; it < 12; it++) {
            for (let i = 0; i < N; i++) {
                const dx = rope.x[i + 1] - rope.x[i], dy = rope.y[i + 1] - rope.y[i];
                const d = Math.hypot(dx, dy) || 1e-6;
                if (d <= rest) continue;
                const c = (d - rest) / d * 0.5;
                const w0 = i === 0 ? 0 : 1, w1 = i + 1 === N ? 0 : 1;
                const s = w0 + w1 || 1;
                rope.x[i] += dx * c * 2 * w0 / s; rope.y[i] += dy * c * 2 * w0 / s;
                rope.x[i + 1] -= dx * c * 2 * w1 / s; rope.y[i + 1] -= dy * c * 2 * w1 / s;
            }
            // a little bending stiffness: silk curves, it does not kink
            for (let i = 1; i < N; i++) {
                rope.x[i] += ((rope.x[i - 1] + rope.x[i + 1]) / 2 - rope.x[i]) * 0.35;
                rope.y[i] += ((rope.y[i - 1] + rope.y[i + 1]) / 2 - rope.y[i]) * 0.35;
            }
        }
        const arr = new Float32Array((N + 1) * STRIDE);
        const col = ramp(cfg.thread, clamp((clock - data.intro) / Math.max(0.1, data.end - data.intro)));
        const put = (i, a, b, ww, kind, h0, h1, sd, c) => {
            const o = i * STRIDE;
            arr.set([a[0], a[1], b[0], b[1], ww, -1e6, 1e-3, sd, c[0], c[1], c[2], kind, h0, h1], o);
        };
        for (let i = 0; i < N; i++) {
            const h0 = eyeH * Math.pow(1 - i / N, 1.4), h1 = eyeH * Math.pow(1 - (i + 1) / N, 1.4);
            put(i, [rope.x[i], rope.y[i]], [rope.x[i + 1], rope.y[i + 1]], w * 0.95, 3, h0 + w, h1 + w, 0.37 + i * 0.013, col);
        }
        put(N, [needle.x, needle.y], [ex, ey], Math.max(1.6, w * 1.45), 2, 0, eyeH, 0.5, [0.5, 0.5, 0.5]);
        return { arr, Ln };
    }

    function frame(t) {
        raf = 0;
        if (dead || !data) return;
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
        last = t;
        let alive = false;

        if (state === 'sewing') {
            clock = (t - startAt) / 1000;
            if (clock > data.end + 0.9) { state = 'done'; clock = 1e6; }
            else alive = true;
        }
        const trg = lightTarget();
        if (!light.init) { [light.x, light.y, light.z] = trg; light.init = true; }
        const om = 7;
        for (const [p, v, k] of [['x', 'vx', 0], ['y', 'vy', 1], ['z', 'vz', 2]]) {
            const a = om * om * (trg[k] - light[p]) - 2 * om * light[v];
            light[v] += a * dt;
            light[p] += light[v] * dt;
            if (Math.abs(trg[k] - light[p]) > 0.4 || Math.abs(light[v]) > 2) alive = true;
        }
        if (tilt.active && visible) alive = true;

        let dyn = false, Ln = 1, fade = 1;
        if (state === 'sewing' && R.gl) {
            const anchor = stepNeedle(dt);
            if (needle.f > 0.004 || clock < data.end) {
                const d = dynInstances(dt, anchor);
                R.upload('dyn', d.arr, true);
                Ln = d.Ln;
                dyn = true;
                fade = clamp(needle.f * 4);
            }
        }
        const transfer = state === 'done' ? 0 : clamp(1 - (clock - data.end - 0.1) / 0.7);
        R.frame({ W, H, dpr, clock: state === 'idle' ? -1 : clock, light: [light.x, light.y, light.z], fade, transfer, needleLen: Ln, dyn });

        if (alive && visible) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && !dead && data) raf = requestAnimationFrame(frame); };

    function sew() {
        if (state !== 'idle') return;
        if (calm.matches) { state = 'done'; clock = 1e6; kick(); return; }
        state = 'sewing';
        startAt = performance.now();
        needle.init = false; needle.f = 0; needle.ax = 0; rope = null;
        kick();
    }

    async function start() {
        // fonts first: the mask must be the real glyphs
        try {
            const fams = new Set();
            heading.querySelectorAll('*').forEach((e) => fams.add(e));
            fams.add(heading);
            await Promise.all([...fams].map((e) => {
                const cs = getComputedStyle(e);
                return document.fonts.load(`${cs.fontStyle} ${cs.fontWeight} 64px ${cs.fontFamily}`, e.textContent || 'a');
            }));
            await document.fonts.ready;
        } catch (e) { /* draw with whatever is loaded */ }
        if (dead) return;

        canvas = document.createElement('canvas');
        canvas.className = 'st-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        try { R = makeGL(canvas); } catch (e) { R = null; }
        if (!R) R = make2D(canvas);
        if (!R) { host.classList.add('is-off'); return; }
        host.appendChild(canvas);
        let ok = false;
        try { ok = rebuild(); } catch (e) { ok = false; }
        if (!ok) { canvas.remove(); host.classList.add('is-off'); return; }
        host.classList.add('is-live');
        if (calm.matches) { state = 'done'; clock = 1e6; }

        on(canvas, 'webglcontextlost', (e) => {
            e.preventDefault();
            // fall back to the plain 2D drawing; the stitches stay
            const c2 = document.createElement('canvas');
            c2.className = 'st-canvas'; c2.setAttribute('aria-hidden', 'true');
            canvas.replaceWith(c2); canvas = c2;
            R = make2D(canvas); size();
            R.upload('satin', data.satin); R.upload('outline', data.outline); R.upload('trans', data.trans); R.pad(data.pad);
            kick();
        });

        import('./tilt.js').then((m) => {
            tilt = m.default;
            const f = () => kick();
            tilt.listeners.add(f);
            cleanup.push(() => tilt.listeners.delete(f));
            kick();
        }).catch(() => {});

        const local = (e) => {
            const r = host.getBoundingClientRect();
            ptr.x = e.clientX - r.left; ptr.y = e.clientY - r.top;
        };
        on(host, 'pointermove', (e) => { local(e); ptr.on = true; kick(); }, { passive: true });
        on(host, 'pointerdown', (e) => { local(e); ptr.on = true; kick(); }, { passive: true });
        const leave = (e) => { ptr.on = false; ptr.until = e.pointerType === 'touch' ? performance.now() + 1400 : 0; kick(); setTimeout(kick, 1500); };
        on(host, 'pointerleave', leave);
        on(host, 'pointerup', (e) => { if (e.pointerType === 'touch') leave(e); });
        on(host, 'pointercancel', leave);
        on(window, 'scroll', kick, { passive: true });

        const io = new IntersectionObserver((en) => {
            for (const e of en) {
                if (e.target === host) {
                    visible = e.isIntersecting;
                    if (visible) { last = 0; kick(); }
                } else if (e.isIntersecting && e.intersectionRatio >= 0.55) sew();
            }
        }, { threshold: [0, 0.55, 1] });
        io.observe(host);
        io.observe(heading);
        cleanup.push(() => io.disconnect());

        let timer = 0;
        const ro = new ResizeObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (dead) return;
                const r = host.getBoundingClientRect();
                size();
                if (Math.abs(Math.round(r.width) - builtW) > 1) rebuild();
                kick();
            }, 140);
        });
        ro.observe(host);
        cleanup.push(() => { ro.disconnect(); clearTimeout(timer); });
        kick();
    }
    start().catch(() => { if (canvas) canvas.remove(); host.classList.remove("is-live"); host.classList.add("is-off"); });

    return function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        cleanup.forEach((f) => f());
        if (R) R.lose();
        if (canvas) canvas.remove();
        host.classList.remove('is-live');
    };
}

// Auto-start every [data-stitch-type], each once it is near the viewport.
function autoStart(el) {
    if (el.__stitchType) return;
    el.__stitchType = true;
    if (!('IntersectionObserver' in window)) { stitchType(el); return; }
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        stitchType(el);
    }, { rootMargin: '600px' });
    io.observe(el);
}
document.querySelectorAll('[data-stitch-type]').forEach(autoStart);
