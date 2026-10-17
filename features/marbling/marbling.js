/*
 *  MARBLING // a marbler's bath: drop ink, pull a stylus, comb it, lay paper.
 *
 *  Markup:  <figure data-marbling>
 *             <img src="assets/nicholson-1856-stone.webp" alt="">
 *           </figure>
 *  Or call  marbling(figure, options)  yourself. It returns destroy(), which
 *  also carries .drop(x, y, ink) .comb(dir) .play(preset) .lay() .clear()
 *  .png() .svg() for scripting.
 *
 *  Options (data attributes, all optional; the options object wins):
 *    data-preset="stone"     compose a pattern when the bath is first seen:
 *                            stone | nonpareil | spanish | peacock
 *    data-autoplay           compose slowly by itself and hold (heroes).
 *                            data-autoplay="loop" lays paper and starts again.
 *    data-controls="full"    the tool bar; "none" for a bare bath
 *    data-inks="..."         comma list of colours to replace the palette
 *    data-tempo="1"          speed of presets (autoplay runs at 0.4)
 *    data-hold="9"           seconds a loop holds a finished pattern
 *    data-seed="7"           same pattern every load
 *
 *  The mathematics is Aubrey Jaffer's "Mathematical Marbling" (2012). Inks are
 *  polygons, so every edge is a vector and sharp at any size. Each drop and
 *  each pass of a tine is a map of the plane that every vertex goes through:
 *
 *    ink drop   P' = C + (P - C) * sqrt(1 + r^2 / |P - C|^2)
 *               Area is conserved, so a ring of ink is pushed thinner as the
 *               drop opens, and two growth steps compose exactly (r^2 adds),
 *               which is how a drop spreads over several frames.
 *    tine line  P' = P + M * a * l / (d + l)
 *               d is the distance to the nearest tine of a comb, M its
 *               direction. Animated, it is delivered by the moving front of
 *               the comb (a logistic window in s = P.M), solved backwards per
 *               vertex with Newton, so the end state is exactly Jaffer's map.
 *    wavy comb  the same, conjugated by a sinusoidal shear: the tines are
 *               straightened, combed, and bent back (peacock).
 *    wave       P' = P + M * A * sin(2 pi (P.N) / L + phase)   (Spanish wave)
 *    stylus     a point tine dragged by hand: the same l / (d + l) falloff
 *               across the path, a Gaussian along it, integrated in small steps.
 *
 *  Edges are refined as they are mapped: an edge whose image is too long is
 *  split at its pre-image midpoint, which is mapped exactly, so a drop landing
 *  on a line opens it into a true circle instead of tearing a chord through
 *  it. Short edges are merged; edges far outside the bath are kept coarse and
 *  inks pushed wholly off it are dropped, so vertex counts stay in budget.
 *
 *  Tap or click drops ink (hold to keep feeding it); the colour cycles through
 *  indigo, madder, ochre, verdigris, black and cream. Drag pulls a stylus.
 *  Comb draws a comb of tines across, alternating direction. Lay paper lowers
 *  a sheet onto the bath, rolls it down, lifts it, turns it over: the print
 *  (a mirror image, as a contact print is) on laid paper; the bath is clear.
 *
 *  Touch: a tap drops, a sideways drag pulls the stylus, an upward or
 *  downward drag scrolls the page (touch-action: pan-y). "Draw" frees the
 *  stylus in every direction and marks the bath until it is switched off.
 *
 *  Reduced motion: presets and autoplay show their finished pattern, drops
 *  open at once, the paper prints without the flight. The stylus still works.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const coarse = matchMedia('(pointer: coarse)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const seeded = (n) => () => { n = (n + 0x6d2b79f5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TAU = Math.PI * 2;

/* A historical palette, aged the way the pigments on an 1856 endpaper have
   aged: indigo, a brick madder, a dull ochre, a sap verdigris, the grey-blue
   of a Spanish sheet, an iron-gall black and a cream. data-palette="bright"
   gives the fresh pigments. */
export const INKS = [
    { id: 'indigo',    name: 'Indigo',    color: '#2f4862' },
    { id: 'madder',    name: 'Madder',    color: '#9a4434' },
    { id: 'ochre',     name: 'Ochre',     color: '#c09852' },
    { id: 'verdigris', name: 'Verdigris', color: '#5a7865' },
    { id: 'slate',     name: 'Slate',     color: '#7f949b' },
    { id: 'black',     name: 'Black',     color: '#352d2a' },
    { id: 'cream',     name: 'Cream',     color: '#e3d3a2' },
];
export const BRIGHT = [
    { id: 'indigo',    name: 'Indigo',    color: '#2b3f68' },
    { id: 'madder',    name: 'Madder',    color: '#a83b2d' },
    { id: 'ochre',     name: 'Ochre',     color: '#d0a04a' },
    { id: 'verdigris', name: 'Verdigris', color: '#3d7c70' },
    { id: 'slate',     name: 'Slate',     color: '#6f8ea3' },
    { id: 'black',     name: 'Black',     color: '#1e1b19' },
    { id: 'cream',     name: 'Cream',     color: '#f2e8cc' },
];
const SIZE = '#dbd4c4';      // the size (the bath's surface) when nothing floats on it
const PAPER = '#f5f0e3';     // the sheet

const W = 1000;              // the bath is 1000 units wide; H follows its shape
const SEG = 2.4;             // longest edge, css px, after refinement
const MERGE = .5;            // edges shorter than SEG * MERGE are merged
const BUDGET = 110000;       // vertices before edges are allowed to coarsen

/* ─── colour helpers ─────────────────────────────────────────────── */

function hex(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
    if (m) { const v = parseInt(m[1], 16); return [v >> 16 & 255, v >> 8 & 255, v & 255]; }
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = c; const s = ctx.fillStyle;
    if (s[0] === '#') return hex(s);
    const n = s.match(/[\d.]+/g) || [0, 0, 0];
    return [+n[0], +n[1], +n[2]];
}
const css = (r) => `rgb(${r[0] | 0},${r[1] | 0},${r[2] | 0})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ─── the bath: inks as polygons, every operation a map of the plane ─ */

class Bath {
    constructor(h) {
        this.W = W; this.H = h;
        this.inks = [];
        this.seg = 3; this.segScale = 1;
        this.count = 0;
        this.dirty = true;
        this.buf = new Float64Array(16384);
        this.q = [];             // maps queued this frame, applied together by flush()
        this.tx = 0; this.ty = 0;
    }
    clear() { this.inks.length = 0; this.q.length = 0; this.count = 0; this.dirty = true; }

    // Queue a map of the plane. T(x, y) writes its image to this.tx, this.ty;
    // touches(box) may say an ink's bounding box is out of its reach.
    push(T, touches = null) { this.q.push({ T, touches }); this.dirty = true; }

    // Apply the queued maps as one composite, refining edges as they are mapped:
    // an edge whose image is too long is split at its pre-image midpoint, which
    // is mapped exactly.
    flush() {
        const q = this.q;
        if (!q.length) return;
        this.q = [];
        const nq = q.length;
        // Each ink goes through only the maps that can reach it (and, if it was
        // born mid-queue, only those queued after it), composed in order.
        let fns = [];
        const chain = (x, y) => {
            for (let i = 0, n = fns.length; i < n; i++) { fns[i](x, y); x = this.tx; y = this.ty; }
        };
        let T = chain;
        const seg = this.seg * this.segScale, segOut = seg * 8;
        const minIn = seg * MERGE, minOut = segOut * MERGE;
        const bx0 = -.25 * this.W, bx1 = 1.25 * this.W, by0 = -.25 * this.H, by1 = 1.25 * this.H;
        const keep = [];
        let total = 0;
        let out = this.buf, k = 0;
        const grow = () => { const o = new Float64Array(out.length * 2); o.set(out); out = this.buf = o; };
        const refine = (ax, ay, tax, tay, bx, by, tbx, tby, depth) => {
            const dx = tbx - tax, dy = tby - tay, L2 = dx * dx + dy * dy;
            const lim = ((tax < bx0 || tax > bx1 || tay < by0 || tay > by1) && (tbx < bx0 || tbx > bx1 || tby < by0 || tby > by1)) ? segOut : seg;
            if (L2 <= lim * lim || depth > 14) return;
            const mx = (ax + bx) * .5, my = (ay + by) * .5;
            T(mx, my); const tmx = this.tx, tmy = this.ty;
            refine(ax, ay, tax, tay, mx, my, tmx, tmy, depth + 1);
            if (k + 2 > out.length) grow();
            out[k++] = tmx; out[k++] = tmy;
            refine(mx, my, tmx, tmy, bx, by, tbx, tby, depth + 1);
        };
        for (const ink of this.inks) {
            // inks out of reach of every queued map are left as they are
            const born = ink.born || 0;
            ink.born = 0;
            fns = [];
            for (let i = born; i < nq; i++) {
                const e = q[i];
                const f = e.forInk ? e.forInk(ink.box) : (!e.touches || e.touches(ink.box) ? e.T : null);
                if (f) fns.push(f);
            }
            if (!fns.length) { keep.push(ink); total += ink.n; continue; }
            T = fns.length === 1 ? fns[0] : chain;
            const p = ink.p, n = ink.n;
            k = 0;
            T(p[0], p[1]);
            const fx = this.tx, fy = this.ty;
            let ax = p[0], ay = p[1], tax = fx, tay = fy;
            for (let i = 0; i < n; i++) {
                if (k + 2 > out.length) grow();
                out[k++] = tax; out[k++] = tay;
                let bx, by, tbx, tby;
                if (i === n - 1) { bx = p[0]; by = p[1]; tbx = fx; tby = fy; }
                else { bx = p[2 * i + 2]; by = p[2 * i + 3]; T(bx, by); tbx = this.tx; tby = this.ty; }
                refine(ax, ay, tax, tay, bx, by, tbx, tby, 0);
                ax = bx; ay = by; tax = tbx; tay = tby;
            }
            // merge vertices closer than the minimum to the last one kept, into
            // the ink's own array when it is big enough
            const m = k >> 1;
            let dst = ink.p.length >= k ? ink.p : new Float64Array(Math.max(32, Math.ceil(k * 1.25)));
            let j = 0, minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
            let lx = out[0], ly = out[1];
            dst[j++] = lx; dst[j++] = ly;
            minx = maxx = lx; miny = maxy = ly;
            for (let i = 1; i < m; i++) {
                const x = out[2 * i], y = out[2 * i + 1];
                const lim = (x < bx0 || x > bx1 || y < by0 || y > by1) ? minOut : minIn;
                const dx = x - lx, dy = y - ly;
                if (dx * dx + dy * dy < lim * lim && m - i + (j >> 1) > 8) continue;
                dst[j++] = x; dst[j++] = y; lx = x; ly = y;
                if (x < minx) minx = x; else if (x > maxx) maxx = x;
                if (y < miny) miny = y; else if (y > maxy) maxy = y;
            }
            if (maxx < bx0 || minx > bx1 || maxy < by0 || miny > by1) continue;   // pushed off the bath
            ink.p = dst; ink.n = j >> 1;
            const b = ink.box; b[0] = minx; b[1] = miny; b[2] = maxx; b[3] = maxy;
            total += ink.n;
            keep.push(ink);
        }
        this.inks = keep;
        this.count = total;
        if (total > BUDGET * 1.6) this.decimate(minIn * Math.sqrt(total / BUDGET));
        // stay in budget: coarsen a little when the pattern gets very long, relax when it doesn't
        if (total > BUDGET) this.segScale = Math.min(3, this.segScale * 1.1);
        else if (total < BUDGET * .5 && this.segScale > 1) this.segScale = Math.max(1, this.segScale / 1.05);
        this.dirty = true;
    }

    // Thin out vertices closer than `min` (an emergency brake on runaway counts).
    decimate(min) {
        let total = 0;
        for (const ink of this.inks) {
            const p = ink.p, n = ink.n;
            let j = 2, lx = p[0], ly = p[1];
            for (let i = 1; i < n; i++) {
                const x = p[2 * i], y = p[2 * i + 1];
                if ((x - lx) ** 2 + (y - ly) ** 2 < min * min && n - i + (j >> 1) > 8) continue;
                p[j++] = x; p[j++] = y; lx = x; ly = y;
            }
            ink.n = j >> 1; total += ink.n;
        }
        this.count = total;
        this.segScale = Math.min(3, this.segScale * 1.3);
    }

    // One step of an ink drop opening at (cx, cy): r^2 grows by dr2.
    // Drops queued one after another are applied in one tight loop. Far from a
    // drop its push (r^2 / 2d) is negligible, so it is faded out smoothly
    // between 5 and 10 radii (R, the drop's final radius) and inks beyond
    // that skip it: thousands of fine drops then cost little more than a few.
    drop(cx, cy, dr2, R = Math.sqrt(dr2)) {
        if (!(dr2 > 0)) return;
        const last = this.q[this.q.length - 1];
        if (last && last.drops && !last.closed) { last.drops.push(cx, cy, dr2, R); this.dirty = true; return; }
        const D = [cx, cy, dr2, R];
        const make = (L) => (x, y) => {
            for (let i = 0, n = L.length; i < n; i += 4) {
                const c0 = L[i], c1 = L[i + 1], r = L[i + 3];
                let dx = x - c0, dy = y - c1, d2 = dx * dx + dy * dy;
                const far = 100 * r * r;                       // (10 R)^2
                if (d2 > far) continue;
                let a = L[i + 2];
                const near = 25 * r * r;                       // (5 R)^2
                if (d2 > near) { const t = (far - d2) / (far - near); a *= t * t * (3 - 2 * t); }
                if (d2 < 1e-12) { dx = 1e-6; d2 = 1e-12; }
                const k = Math.sqrt(1 + a / d2);
                x = c0 + dx * k; y = c1 + dy * k;
            }
            this.tx = x; this.ty = y;
        };
        const entry = {
            drops: D,
            T: (x, y) => make(D)(x, y),
            forInk: (b) => {
                const L = [];
                for (let i = 0; i < D.length; i += 4) {
                    const reach = 10 * D[i + 3] + 4;
                    if (D[i] + reach >= b[0] && D[i] - reach <= b[2] && D[i + 1] + reach >= b[1] && D[i + 1] - reach <= b[3]) L.push(D[i], D[i + 1], D[i + 2], D[i + 3]);
                }
                return L.length ? make(L) : null;
            },
        };
        this.q.push(entry);
        this.dirty = true;
    }

    addCircle(cx, cy, r, color) {
        // (maps still queued this frame will carry the new drop a hair: harmless)
        const n = 16, p = new Float64Array(64);
        for (let i = 0; i < n; i++) { p[2 * i] = cx + r * Math.cos(i / n * TAU); p[2 * i + 1] = cy + r * Math.sin(i / n * TAU); }
        const ink = { p, n, color, box: [cx - r, cy - r, cx + r, cy + r], born: this.q.length };
        const last = this.q[this.q.length - 1];
        if (last) last.closed = true;       // later drops start a new batch
        this.inks.push(ink);
        this.dirty = true;
        return ink;
    }

    // A comb (or a single tine) pulled along M, its front moving from F0 to F1
    // (s measured from the comb's origin). See the header for the method.
    comb(c, F0, F1) {
        if (F1 === F0) return;
        const { ox, oy, mx, my, nx, ny, spacing, offset, alpha, lambda, sigma, A, om, ph } = c;
        const sig = (x) => 1 / (1 + Math.exp(-x));
        // beyond 9.5 sigma of the front nothing moves (the logistic is flat to 1e-4)
        const lo = Math.min(F0, F1) - 9.5 * sigma, hi = Math.max(F0, F1) + 9.5 * sigma + alpha;
        this.push((x, y) => {
            const rx = x - ox, ry = y - oy;
            const s = rx * mx + ry * my;
            if (s < lo || s > hi) { this.tx = x; this.ty = y; return; }
            let u = rx * nx + ry * ny;
            if (A) u -= A * Math.sin(om * s + ph);
            const v = u - offset;
            let d;
            if (spacing > 0) { const m = v - spacing * Math.floor(v / spacing); d = m < spacing - m ? m : spacing - m; }
            else d = Math.abs(v);
            const af = alpha * lambda / (d + lambda);
            // the pre-image s0 of s under the front at F0 (Newton, from a good guess)
            let s0 = s - af * sig((F0 - s) / sigma);
            for (let i = 0; i < 2; i++) {
                const g = sig((F0 - s0) / sigma);
                const h = s0 + af * g - s;
                const dh = 1 - af * g * (1 - g) / sigma;
                s0 -= h / dh;
            }
            const sn = s0 + af * sig((F1 - s0) / sigma);
            if (A) u += A * Math.sin(om * sn + ph);
            this.tx = ox + sn * mx + u * nx; this.ty = oy + sn * my + u * ny;
        }, (b) => {
            // the range of s over the box's corners
            const s1 = (b[0] - ox) * mx + (b[1] - oy) * my, s2 = (b[2] - ox) * mx + (b[1] - oy) * my;
            const s3 = (b[0] - ox) * mx + (b[3] - oy) * my, s4 = (b[2] - ox) * mx + (b[3] - oy) * my;
            return Math.max(s1, s2, s3, s4) >= lo && Math.min(s1, s2, s3, s4) <= hi;
        });
    }

    // Sinusoidal shear: displacement along M varies with P.N (area preserving).
    wave(mx, my, nx, ny, dA, L, ph) {
        if (!dA) return;
        const k = TAU / L;
        this.push((x, y) => {
            const t = dA * Math.sin((x * nx + y * ny) * k + ph);
            this.tx = x + mx * t; this.ty = y + my * t;
        });
    }

    // A stylus at (tx, ty) moved by (vx, vy).
    stylus(tx, ty, vx, vy, lambda, sigma, gain) {
        const len = Math.hypot(vx, vy);
        if (len < 1e-6) return;
        const mx = vx / len, my = vy / len, reach = 4 * sigma, far = 40 * lambda;
        const R = reach + far;
        this.push((x, y) => {
            const rx = x - tx, ry = y - ty;
            const s = rx * mx + ry * my;
            this.tx = x; this.ty = y;
            if (s > reach || s < -reach) return;
            const d = Math.abs(-rx * my + ry * mx);
            if (d > far) return;
            const w = gain * len * Math.exp(-s * s / (2 * sigma * sigma)) * (lambda / (d + lambda)) * Math.exp(-d / (10 * lambda));
            this.tx = x + mx * w; this.ty = y + my * w;
        }, (b) => b[2] >= tx - R && b[0] <= tx + R && b[3] >= ty - R && b[1] <= ty + R);
    }
}

/* ─── drawing ────────────────────────────────────────────────────── */

function trace(ctx, p, n) {
    let x = p[2 * n - 2], y = p[2 * n - 1];
    ctx.moveTo((x + p[0]) * .5, (y + p[1]) * .5);
    for (let i = 0; i < n; i++) {
        const j = i === n - 1 ? 0 : i + 1;
        x = p[2 * i]; y = p[2 * i + 1];
        ctx.quadraticCurveTo(x, y, (x + p[2 * j]) * .5, (y + p[2 * j + 1]) * .5);
    }
    ctx.closePath();
}

// The body of an ink: pigment floating on size is never a flat fill. A tile
// of periodic noise (soft mottling and a fine granulation, about a css pixel a
// grain) is laid over each fill, clipped by it, offset per ink so neighbours
// differ. It is built at 3 px per css px, so it is sharp at any DPR, and it
// moves luminance by only a few per cent.
export const GRAIN_TILE = 160;           // css px
let grainTile = null;
function inkGrain() {
    if (grainTile) return grainTile;
    const P = 3, N = GRAIN_TILE * P, rng = seeded(1856);
    // periodic value noise: a G x G lattice, wrapped, smoothly interpolated
    const lattice = (G) => { const a = new Float32Array(G * G); for (let i = 0; i < a.length; i++) a[i] = rng() * 2 - 1; return a; };
    const sample = (L, G, x, y) => {
        const fx = x * G / N, fy = y * G / N;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const i0 = x0 % G, i1 = (x0 + 1) % G, j0 = (y0 % G) * G, j1 = ((y0 + 1) % G) * G;
        const a = L[j0 + i0] + (L[j0 + i1] - L[j0 + i0]) * sx;
        const b = L[j1 + i0] + (L[j1 + i1] - L[j1 + i0]) * sx;
        return a + (b - a) * sy;
    };
    const m1 = lattice(6), m2 = lattice(14), g1 = lattice(Math.round(GRAIN_TILE / 1.1)), g2 = lattice(Math.round(GRAIN_TILE / .55));
    const c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), im = g.createImageData(N, N), d = im.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const mot = .65 * sample(m1, 6, x, y) + .35 * sample(m2, 14, x, y);
        let gr = .6 * sample(g1, g1.length ** .5, x, y) + .4 * sample(g2, g2.length ** .5, x, y);
        gr = Math.sign(gr) * Math.pow(Math.abs(gr), 1.6);        // sparse, sharper grains
        const v = .55 * mot + .45 * gr * 1.6;
        const i = 4 * (y * N + x);
        const w = v > 0 ? 255 : 0;
        d[i] = w; d[i + 1] = w * .97; d[i + 2] = w * .9;
        d[i + 3] = Math.min(255, Math.abs(v) * 255 * (v > 0 ? .1 : .13));
    }
    g.putImageData(im, 0, 0);
    grainTile = c;
    return c;
}

// Draw the inks with ctx already mapped to bath units, oldest first. A drop of
// gall water is an ink of nothing: it is filled with the ground (the size in
// the bath, the paper in a print), which is what opens a pale speckle.
// Each fill is also stroked in its own colour, a hair wide (lw, bath units),
// so neighbouring inks overlap by a fraction of a pixel and no seam of what
// lies beneath shows through their shared, antialiased edge. `tex` (pattern
// and css px per bath unit) adds the body; inks marked `vein` get a darker
// hairline rim, the veined edge of a Turkish stone.
function paintInks(ctx, bath, view, ground, lw = 0, tex = null) {
    ctx.lineJoin = 'round';
    const m = tex ? new DOMMatrix() : null;
    for (const ink of bath.inks) {
        const b = ink.box;
        if (view && (b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3])) continue;
        ctx.beginPath();
        trace(ctx, ink.p, ink.n);
        if (ink.gall && !ground) {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = '#000'; ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            continue;
        }
        ctx.fillStyle = ctx.strokeStyle = ink.gall ? ground : ink.fill;
        ctx.fill();
        if (lw) { ctx.lineWidth = lw; ctx.stroke(); }
        if (tex && !ink.gall) {
            // one tile pixel is a third of a css px: in bath units, 1 / (3 * cssPerUnit)
            const k = 1 / (3 * tex.unit), o = ink.tex || [0, 0];
            m.a = m.d = k; m.b = m.c = 0; m.e = -o[0] * k; m.f = -o[1] * k;
            tex.pat.setTransform(m);
            ctx.fillStyle = tex.pat;
            ctx.fill();
        }
        if (ink.vein && lw) {
            ctx.globalAlpha = .5;
            ctx.strokeStyle = ink.rim;
            ctx.lineWidth = lw * 1.4;
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }
}

/* ─── paper: laid paper, generated, sharp at any resolution ─────── */

function makePaper(w, h, px, rng, tone = PAPER, plain = false) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });     // drawn once, kept in memory, never lost with the GPU
    g.fillStyle = tone; g.fillRect(0, 0, w, h);
    // cloudy formation of handmade paper: low-frequency noise, smoothly upscaled
    if (!plain) {
    const lw = Math.max(4, Math.round(w / (px * 26))), lh = Math.max(4, Math.round(h / (px * 26)));
    const lo = document.createElement('canvas'); lo.width = lw; lo.height = lh;
    const lg = lo.getContext('2d'), id = lg.createImageData(lw, lh);
    for (let i = 0; i < lw * lh; i++) { const v = 128 + (rng() - .5) * 70; id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = v; id.data[4 * i + 3] = 255; }
    lg.putImageData(id, 0, 0);
    g.save(); g.globalAlpha = .07; g.globalCompositeOperation = 'overlay'; g.imageSmoothingQuality = 'high';
    g.drawImage(lo, 0, 0, w, h); g.restore();
    }
    // laid lines (about 1 mm apart) and chain lines (about 25 mm), very faint
    if (!plain) {
    g.save();
    g.globalAlpha = .045; g.fillStyle = '#8f8471';
    const laid = 3.8 * px;
    for (let y = rng() * laid; y < h; y += laid) g.fillRect(0, y, w, Math.max(.6, .35 * px));
    g.globalAlpha = .05;
    const chain = 92 * px;
    for (let x = rng() * chain; x < w; x += chain) g.fillRect(x, 0, Math.max(1, .9 * px), h);
    g.restore();
    }
    // fibres
    g.save(); g.lineCap = 'round';
    const fibres = plain ? 0 : Math.round(w * h / (px * px * 700));
    for (let i = 0; i < fibres; i++) {
        const x = rng() * w, y = rng() * h, a = rng() * TAU, l = (4 + rng() * 14) * px, bend = (rng() - .5) * l * .5;
        g.globalAlpha = .05 + rng() * .08;
        g.strokeStyle = rng() < .6 ? '#9b907c' : '#ffffff';
        g.lineWidth = (.25 + rng() * .35) * px;
        g.beginPath(); g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * l * .5 - Math.sin(a) * bend, y + Math.sin(a) * l * .5 + Math.cos(a) * bend, x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
    }
    g.restore();
    // grain
    const im = g.getImageData(0, 0, w, h), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
        const v = (rng() - .5) * (plain ? 30 : 9);
        d[i] += v; d[i + 1] += v; d[i + 2] += v;
    }
    g.putImageData(im, 0, 0);
    return c;
}

/* ─── presets: scores of drops and combs ─────────────────────────── */

// Spread n points over the bath, each the best of a few candidates (Mitchell's
// best-candidate), so drops land evenly but not on a grid.
function scatter(rng, n, w, h, prev = [], tries = 6, margin = 0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
        let best = null, bd = -1;
        for (let t = 0; t < tries; t++) {
            const x = -margin + rng() * (w + 2 * margin), y = -margin + rng() * (h + 2 * margin);
            let md = Infinity;
            for (const p of pts) md = Math.min(md, (p[0] - x) ** 2 + (p[1] - y) ** 2);
            for (const p of prev) md = Math.min(md, ((p[0] - x) ** 2 + (p[1] - y) ** 2) * 1.6);
            if (md > bd) { bd = md; best = [x, y]; }
        }
        pts.push(best);
    }
    return pts;
}

// A score is a list of { t (seconds), op, ... }. Drop gap and comb time are at
// tempo 1; the player divides by tempo.
export function compose(name, rng, H, k = 1) {
    const area = W * H / (W * 750);         // relative to a 4:3 bath
    const S = Math.sqrt(W * H);
    const ev = [];
    let t = 0;
    const drops = (ink, n, r0, r1, gap, opts = {}) => {
        // finer: k^2 as many drops, 1/k the size (speckles shrink more gently), in k^1.5 less time each
        const kk = ink == null ? Math.sqrt(k) : k;
        const pts = scatter(rng, Math.round(n * area * kk * kk), W, H, opts.prev || [], 6, opts.margin ?? S * .04 / kk);
        for (const [x, y] of pts) {
            ev.push({ t, op: 'drop', x, y, r: S * (r0 + rng() * (r1 - r0)) / kk, ink });
            t += gap / Math.pow(kk, 1.3) * (.7 + rng() * .6);
        }
        return pts;
    };
    const comb = (dir, o) => {
        o = { ...o, spacing: o.spacing / k, offset: o.offset / k, alpha: o.alpha / k, lambda: o.lambda / k };
        ev.push({ t, op: 'comb', dir, ...o });
        t += o.dur || 1.6;
    };
    const pause = (s) => { t += s; };
    // a ground for combed patterns: colours interleaved, about two and a half
    // bath-areas of ink, so the surface is covered in small mixed stones
    const ground = (inks, n = 240, r0 = .045, r1 = .062) => {
        const pts = scatter(rng, Math.round(n * area * k * k), W, H, [], 3, S * .04 / k);
        pts.forEach(([x, y], i) => {
            ev.push({ t, op: 'drop', x, y, r: S * (r0 + rng() * (r1 - r0)) / k, ink: inks[i % inks.length] });
            t += .014 / Math.pow(k, 1.3) * (.7 + rng() * .6);
        });
    };

    if (name === 'stone') {
        // Turkish stone (tas ebru): each colour pushes the last into veins;
        // the last and largest drops become the stones; gall water speckles them.
        // About three bath-areas of ink in all, so the surface is covered.
        drops('madder', 16, .19, .24, .05);
        drops('black', 40, .035, .05, .02);
        drops('indigo', 44, .045, .06, .02);
        drops('ochre', 44, .05, .068, .022);
        drops('cream', 40, .055, .075, .025);
        pause(.25);
        drops(null, 170, .0025, .0065, .008, { margin: 0 });
    } else if (name === 'nonpareil') {
        // get-gel (a rake there and back), then the fine nonpareil comb across
        ground(['indigo', 'madder', 'ochre', 'cream', 'black']);
        pause(.3);
        const rake = W / 10;
        comb('down', { spacing: rake, offset: rake * .25, alpha: rake * .95, lambda: rake * .12, dur: 1.6 });
        comb('up', { spacing: rake, offset: rake * .75, alpha: rake * .95, lambda: rake * .12, dur: 1.6 });
        const fine = H / 30;
        comb('right', { spacing: fine, offset: fine * .5, alpha: fine * 1.6, lambda: fine * .1, dur: 2 });
    } else if (name === 'spanish') {
        // a stone ground rocked into waves as it is taken up
        drops('black', 16, .19, .24, .05);
        drops('madder', 36, .035, .05, .02);
        drops('ochre', 30, .04, .055, .02);
        drops('slate', 46, .055, .075, .022);
        pause(.2);
        drops(null, 80, .0035, .007, .012, { margin: 0 });
        pause(.3);
        ev.push({ t, op: 'wave', angle: -20, A: S * .045, L: S * .17, dur: 2.4 });
        t += 2.4;
    } else if (name === 'peacock') {
        // bouquet: get-gel, the fine comb down, then a wide comb drawn back up
        // through it, which turns each run of little arches into a plume
        ground(['indigo', 'ochre', 'madder', 'verdigris', 'cream']);
        pause(.3);
        const rake = H / 8;
        comb('right', { spacing: rake, offset: rake * .2, alpha: rake * .95, lambda: rake * .1, dur: 1.6 });
        comb('left', { spacing: rake, offset: rake * .7, alpha: rake * .95, lambda: rake * .1, dur: 1.6 });
        const fine = W / 48;
        comb('down', { spacing: fine, offset: fine * .5, alpha: fine * 1.6, lambda: fine * .1, dur: 2 });
        const wide = W / 11;
        comb('up', { spacing: wide, offset: wide * .5, alpha: wide * 1.05, lambda: wide * .1, dur: 2.2 });
    }
    ev.push({ t, op: 'end' });
    return ev;
}

/* ─── the component ─────────────────────────────────────────────── */

export function marbling(root, opts = {}) {
    const ds = root.dataset;
    const has = (k) => opts[k] !== undefined || ds[k] !== undefined;
    const opt = (k, d) => (opts[k] !== undefined ? opts[k] : ds[k] !== undefined ? ds[k] : d);
    const num = (k, d) => { const v = parseFloat(opt(k, d)); return Number.isFinite(v) ? v : d; };

    const seed = opt('seed', null);
    const rng = seed != null && seed !== '' ? seeded(+seed || 1) : Math.random;
    const autoplay = has('autoplay') && opt('autoplay', '') !== 'false' ? (String(opt('autoplay', '')) === 'loop' ? 'loop' : 'hold') : null;
    const presetName = opt('preset', autoplay ? 'peacock' : '');
    const controls = opt('controls', autoplay ? 'none' : 'full') !== 'none';
    const tempo = num('tempo', autoplay ? .4 : 1);
    const hold = num('hold', 9);
    let palette = (opt('palette', 'aged') === 'bright' ? BRIGHT : INKS).map((x) => ({ ...x }));
    // how fine presets are drawn, against the sheet: drops this many times smaller, combs this many times tighter
    const fine = clamp(num('fine', autoplay ? 1.3 : 2.4), .5, 4);
    const custom = opt('inks', '');
    if (custom) palette = String(custom).split(',').map((c, i) => ({ id: 'ink' + i, name: c.trim(), color: c.trim() }));
    palette.forEach((p) => { p.rgb = hex(p.color); });
    const sizeRGB = hex(getComputedStyle(root).getPropertyValue('--mb-size').trim() || SIZE);
    const paperTone = getComputedStyle(root).getPropertyValue('--mb-paper').trim() || PAPER;

    const img = root.querySelector(':scope > img');
    const off = [];
    const on = (t, e, f, o) => { t.addEventListener(e, f, o); off.push(() => t.removeEventListener(e, f, o)); };
    const el = (tag, cls, parent, attrs = {}) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        for (const k in attrs) n.setAttribute(k, attrs[k]);
        if (parent) parent.appendChild(n);
        return n;
    };

    /* DOM */
    root.classList.add('mb', 'is-live');
    const stage = el('div', 'mb-stage', root);
    const bathEl = el('div', 'mb-bath', stage, {
        tabindex: '0', role: 'application', 'aria-roledescription': 'marbling bath',
        'aria-label': 'Marbling bath',
    });
    const help = el('span', 'mb-sr', root, { id: 'mb-help-' + Math.random().toString(36).slice(2, 8) });
    help.textContent = 'Tap or press Enter to drop ink; hold to feed the drop. Drag, or Shift and the arrow keys, to pull a stylus through. C combs; P lays paper.';
    bathEl.setAttribute('aria-describedby', help.id);
    const canvas = el('canvas', 'mb-canvas', bathEl, { 'aria-hidden': 'true' });
    const ghost = el('canvas', 'mb-ghost', bathEl, { 'aria-hidden': 'true' });
    const over = el('canvas', 'mb-over', bathEl, { 'aria-hidden': 'true' });
    const grain = el('div', 'mb-grain', bathEl, { 'aria-hidden': 'true' });
    const sheen = el('div', 'mb-sheen', bathEl, { 'aria-hidden': 'true' });
    const hint = el('div', 'mb-hint', bathEl, { 'aria-hidden': 'true' });
    hint.textContent = coarse.matches ? 'tap to drop ink' : 'click to drop ink · drag to pull';
    const sheetWrap = el('div', 'mb-sheet', bathEl, { 'aria-hidden': 'true' });
    const shadow = el('div', 'mb-shadow', sheetWrap);
    const sheetIn = el('div', 'mb-sheet-in', sheetWrap);
    const back = el('canvas', 'mb-face mb-back', sheetIn);
    const through = el('canvas', 'mb-face mb-through', sheetIn);
    const shade = el('div', 'mb-face mb-shade', sheetIn);
    const front = el('canvas', 'mb-face mb-front', sheetIn);
    const live = el('p', 'mb-sr', root, { 'aria-live': 'polite' });
    const ctx = canvas.getContext('2d');
    const octx = over.getContext('2d');

    /* tool bar */
    let bar = null, inkBtns = [], layBtn = null, drawBtn = null, combBtn = null, presetBtns = [];
    if (controls) {
        bar = el('div', 'mb-bar', root, { role: 'toolbar', 'aria-label': 'Marbling tools' });
        const row1 = el('div', 'mb-row', bar);
        const inks = el('div', 'mb-inks', row1, { role: 'radiogroup', 'aria-label': 'Ink' });
        inkBtns = palette.map((p, i) => {
            const b = el('button', 'mb-ink', inks, { type: 'button', role: 'radio', 'aria-checked': 'false', 'aria-label': p.name, title: p.name });
            b.style.setProperty('--c', p.color);
            el('span', '', b);
            on(b, 'click', () => { inkIndex = i; syncInk(); });
            return b;
        });
        const acts = el('div', 'mb-acts', row1);
        combBtn = el('button', 'mb-btn', acts, { type: 'button' }); combBtn.textContent = 'Comb';
        on(combBtn, 'click', () => api.comb());
        drawBtn = el('button', 'mb-btn mb-draw', acts, { type: 'button', 'aria-pressed': 'false' }); drawBtn.textContent = 'Draw';
        on(drawBtn, 'click', () => setDraw(!drawMode));
        layBtn = el('button', 'mb-btn mb-lay', acts, { type: 'button' }); layBtn.textContent = 'Lay paper';
        on(layBtn, 'click', () => (state === 'print' ? putAway() : api.lay()));
        const row2 = el('div', 'mb-row mb-row2', bar);
        const pre = el('div', 'mb-presets', row2, { role: 'group', 'aria-label': 'Patterns' });
        presetBtns = [['stone', 'Stone'], ['nonpareil', 'Nonpareil'], ['spanish', 'Spanish wave'], ['peacock', 'Peacock']].map(([k, label]) => {
            const b = el('button', 'mb-link', pre, { type: 'button' }); b.textContent = label;
            on(b, 'click', () => api.play(k));
            return b;
        });
        const out = el('div', 'mb-out', row2, { role: 'group', 'aria-label': 'Save' });
        for (const [k, label] of [['png', 'PNG'], ['svg', 'SVG'], ['clear', 'Clear']]) {
            const b = el('button', 'mb-link', out, { type: 'button', 'aria-label': k === 'clear' ? 'Clear the bath' : 'Download ' + label });
            b.textContent = label;
            on(b, 'click', () => (k === 'clear' ? api.clear() : k === 'png' ? download('png') : download('svg')));
        }
    }

    /* state */
    let H = 750, cw = 0, ch = 0, dpr = 1, scale = 1, ox = 0, oy = 0;
    let bath = null;
    let inkIndex = 0;
    let actions = [];
    let raf = 0, last = 0, visible = false, dead = false, started = false;
    let state = 'bath';            // bath | laying | print
    let drawMode = false;
    let comber = 0;                // which way the next comb goes
    let overlay = { comb: null, tip: null, cursor: null };
    let cursor = null;             // keyboard cursor, bath units
    let printCanvas = null, printSVG = null;
    let loopTimer = 0, io = null, ro = null, sizeTimer = 0;

    const say = (s) => { live.textContent = ''; setTimeout(() => { if (!dead) live.textContent = s; }, 30); };

    function syncInk() {
        inkBtns.forEach((b, i) => b.setAttribute('aria-checked', String(i === inkIndex)));
        root.style.setProperty('--mb-next', palette[inkIndex].color);
    }

    function setDraw(v) {
        drawMode = v;
        root.classList.toggle('is-drawing', v);
        if (drawBtn) drawBtn.setAttribute('aria-pressed', String(v));
    }

    /* layout */
    function layout() {
        const r = bathEl.getBoundingClientRect();
        cw = Math.max(1, r.width); ch = Math.max(1, r.height);
        const want = Math.min(3, devicePixelRatio || 1);
        dpr = cw * ch * want * want > 3.6e6 ? Math.min(2, want) : want;
        if (!bath) {
            H = Math.round(W * ch / cw);
            bath = new Bath(H);
        }
        scale = Math.max(cw / W, ch / bath.H);
        ox = (cw - W * scale) / 2; oy = (ch - bath.H * scale) / 2;
        bath.seg = clamp(SEG / scale, 1, 12);
        if (grain.dataset.dpr !== String(dpr)) {
            // the size's own faint texture: a tile of fine grain and soft mottling, at device resolution
            const t = 220, c = makePaper(Math.round(t * dpr), Math.round(t * dpr), dpr, seeded(11), '#808080', true);
            grain.style.backgroundImage = `url(${c.toDataURL()})`;
            grain.style.backgroundSize = `${t}px ${t}px`;
            grain.dataset.dpr = String(dpr);
        }
        for (const c of [canvas, over, ghost]) {
            c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr);
        }
        bath.dirty = true;
    }

    /* drawing */
    // the ink-body pattern for a context (patterns belong to a context)
    const pats = new WeakMap();
    function texFor(c, unit) {
        let pat = pats.get(c);
        if (!pat) { pat = c.createPattern(inkGrain(), 'repeat'); pats.set(c, pat); }
        return pat ? { pat, unit } : null;
    }

    function prepInk(ink, rgb) {
        ink.rgb = rgb;
        ink.fill = css(rgb);
        ink.rim = css(mixc(rgb, [26, 18, 12], .4));
    }

    function draw() {
        bath.flush();
        const k = scale * dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = css(sizeRGB);
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(k, 0, 0, k, ox * dpr, oy * dpr);
        const view = [-ox / scale, -oy / scale, (cw - ox) / scale, (ch - oy) / scale];
        paintInks(ctx, bath, view, css(sizeRGB), .9 / (scale * dpr), texFor(ctx, scale));
        bath.dirty = false;
    }

    function drawOverlay() {
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.clearRect(0, 0, over.width, over.height);
        const k = scale * dpr;
        octx.setTransform(k, 0, 0, k, ox * dpr, oy * dpr);
        const px = 1 / scale;
        const c = overlay.comb;
        if (c) {
            // the comb: a rod held just above the surface, its tines in the size
            const { ox: cx, oy: cy, mx, my, nx, ny } = c;
            const F = c.F;
            const ext = Math.hypot(W, bath.H);
            const ax = cx + mx * F, ay = cy + my * F;
            const fade = c.fade;
            octx.lineCap = 'round';
            // the spine, held a finger's breadth above the size: wood, with its soft shadow on the bath
            const sx = ax - mx * 10 * px, sy = ay - my * 10 * px;
            octx.save();
            octx.globalAlpha = .9 * fade;
            octx.shadowColor = 'rgba(30, 20, 10, .35)';
            octx.shadowBlur = 7 * dpr; octx.shadowOffsetX = 3 * dpr; octx.shadowOffsetY = 6 * dpr;
            octx.strokeStyle = '#5c4632';
            octx.lineWidth = 4.5 * px;
            octx.beginPath(); octx.moveTo(sx - nx * ext, sy - ny * ext); octx.lineTo(sx + nx * ext, sy + ny * ext); octx.stroke();
            octx.restore();
            octx.globalAlpha = .35 * fade;
            octx.strokeStyle = '#f3e3c6';
            octx.lineWidth = 1 * px;
            octx.beginPath();
            const hx = -Math.abs(my) * .4 * px - Math.abs(mx) * 1.2 * px, hy = -Math.abs(mx) * .4 * px - Math.abs(my) * 1.2 * px;
            octx.moveTo(sx - nx * ext + hx, sy - ny * ext + hy);
            octx.lineTo(sx + nx * ext + hx, sy + ny * ext + hy);
            octx.stroke();
            octx.strokeStyle = '#3b2f24';
            const u0 = -ext, u1 = ext;
            const first = Math.ceil((u0 - c.offset) / c.spacing);
            for (let i = first; c.offset + i * c.spacing < u1; i++) {
                let u = c.offset + i * c.spacing;
                if (c.A) u += c.A * Math.sin(c.om * F + c.ph);
                const tx = ax + nx * u, ty = ay + ny * u;
                if (tx < -20 || tx > W + 20 || ty < -20 || ty > bath.H + 20) continue;
                const bx = tx - mx * 10 * px, by = ty - my * 10 * px;
                octx.globalAlpha = .7 * fade;
                octx.lineWidth = 1.4 * px;
                octx.beginPath(); octx.moveTo(bx, by); octx.lineTo(tx, ty); octx.stroke();
                octx.globalAlpha = .35 * fade;
                octx.strokeStyle = '#fbf7ee';
                octx.lineWidth = 1 * px;
                octx.beginPath(); octx.arc(tx, ty, 3.4 * px, 0, TAU); octx.stroke();
                octx.strokeStyle = '#3b2f24';
                octx.globalAlpha = .9 * fade;
                octx.fillStyle = '#211b16';
                octx.beginPath(); octx.arc(tx, ty, 1.6 * px, 0, TAU); octx.fill();
            }
            octx.globalAlpha = 1;
        }
        const tip = overlay.tip || (cursor && bathEl.matches(':focus-visible') ? cursor : null);
        if (tip) {
            octx.globalAlpha = .38; octx.strokeStyle = '#fbf7ee'; octx.lineWidth = 1.2 * px;
            octx.beginPath(); octx.arc(tip[0], tip[1], 6 * px, 0, TAU); octx.stroke();
            octx.globalAlpha = .9; octx.fillStyle = '#1e1a16';
            octx.beginPath(); octx.arc(tip[0], tip[1], 2 * px, 0, TAU); octx.fill();
            if (!overlay.tip) {
                octx.globalAlpha = .7; octx.strokeStyle = '#1e1a16'; octx.lineWidth = 1 * px;
                octx.beginPath(); octx.arc(tip[0], tip[1], 11 * px, 0, TAU); octx.stroke();
            }
            octx.globalAlpha = 1;
        }
    }

    /* actions: each update(dt) returns true when finished; finish() completes at once */
    function dropAction(x, y, R, ink, feed = false) {
        const r0 = Math.max(.6, R * .02);
        const Rmax = feed ? R * 3 : R;
        const tau = .15 * clamp(Math.sqrt(R / tapR()), .45, 1);     // small drops open quicker
        bath.drop(x, y, r0 * r0, Rmax);
        let poly = null;
        if (ink === -1) {
            poly = bath.addCircle(x, y, r0, 'gall');
            poly.gall = true;
        } else if (ink != null) {
            const p = palette[ink];
            const j = (rng() - .5) * .08;
            poly = bath.addCircle(x, y, r0, p.id);
            prepInk(poly, mixc(p.rgb, j > 0 ? [255, 252, 245] : [0, 0, 0], Math.abs(j)));
            poly.vein = !!bath.veins;
            poly.tex = [rng() * 4096, rng() * 4096];
        }
        hint.classList.add('is-gone');
        const a = {
            r2: r0 * r0, target: R * R, feeding: feed, x, y, poly,
            update(dt) {
                if (this.feeding) this.target = Math.min(this.target + R * R * 1.6 * dt, R * R * 9);
                const k = 1 - Math.exp(-dt / tau);
                const n = this.r2 + (this.target - this.r2) * k;
                bath.drop(x, y, n - this.r2, Rmax);
                this.r2 = n;
                if (!this.feeding && this.target - this.r2 < this.target * .02) { this.finish(); return true; }
                return false;
            },
            finish() { this.feeding = false; bath.drop(x, y, this.target - this.r2, Rmax); this.r2 = this.target; },
        };
        return a;
    }

    function combSpec(dir, o) {
        const dirs = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
        const [mx, my] = dirs[dir] || dirs.right;
        const S = Math.sqrt(W * bath.H);
        const spacing = o.spacing ?? W / 24;
        const alpha = o.alpha ?? spacing * 1.6;
        const c = {
            ox: W / 2, oy: bath.H / 2, mx, my, nx: -my, ny: mx,
            spacing, offset: o.offset ?? spacing * .5, alpha, lambda: o.lambda ?? spacing * .1,
            sigma: Math.max(alpha * .45, S * .03), A: o.A || 0, om: o.om || 0, ph: o.ph || 0,
        };
        const L = Math.abs(W * mx) + Math.abs(bath.H * my);
        c.F0 = -L / 2 - 6 * c.sigma; c.F1 = L / 2 + 6 * c.sigma;
        c.F = c.F0;
        return c;
    }

    function combAction(dir, o, dur) {
        const c = combSpec(dir, o);
        const T = Math.max(.2, dur);
        let t = 0;
        hint.classList.add('is-gone');
        return {
            update(dt) {
                t += dt;
                const f = clamp(t / T);
                const F = c.F0 + (c.F1 - c.F0) * ease(f);
                bath.comb(c, c.F, F);
                c.F = F;
                c.fade = Math.min(1, f * 6, (1 - f) * 6);
                overlay.comb = f < 1 ? c : null;
                return f >= 1;
            },
            finish() { bath.comb(c, c.F, c.F1); c.F = c.F1; overlay.comb = null; },
        };
    }

    function waveAction(angle, A, L, dur) {
        const a = angle * Math.PI / 180;
        const mx = Math.cos(a), my = Math.sin(a), nx = -my, ny = mx;
        const ph = rng() * TAU;
        let t = 0, done = 0;
        return {
            update(dt) {
                t += dt;
                const f = clamp(t / dur), v = A * ease(f);
                bath.wave(mx, my, nx, ny, v - done, L, ph); done = v;
                return f >= 1;
            },
            finish() { bath.wave(mx, my, nx, ny, A - done, L, ph); done = A; },
        };
    }

    // play a score: its events fire on time and their actions run alongside
    function scoreAction(ev, speed) {
        let t = 0, i = 0;
        const kids = [];
        const fire = (e, now) => {
            if (e.op === 'drop') {
                let idx = -1;
                if (e.ink != null) {
                    idx = palette.findIndex((p) => p.id === e.ink);
                    if (idx < 0) idx = Math.max(0, INKS.findIndex((p) => p.id === e.ink)) % palette.length;
                }
                return dropAction(e.x, e.y, e.r, idx);
            }
            if (e.op === 'comb') return combAction(e.dir, e, (e.dur || 1.6) / speed);
            if (e.op === 'wave') return waveAction(e.angle, e.A, e.L, (e.dur || 2) / speed);
            return null;
        };
        return {
            score: true,
            update(dt) {
                t += dt * speed;
                while (i < ev.length && ev[i].t <= t) { const a = fire(ev[i]); if (a) kids.push(a); i++; }
                for (let k = kids.length - 1; k >= 0; k--) if (kids[k].update(dt)) kids.splice(k, 1);
                return i >= ev.length && kids.length === 0;
            },
            finish() {
                for (const k of kids) k.finish();
                kids.length = 0;
                while (i < ev.length) { const a = fire(ev[i]); if (a) a.finish(); i++; }
                overlay.comb = null;
            },
        };
    }

    // With reduced motion an action is not shown in motion: it is computed in
    // slices of a frame (a fine preset is seconds of work) and the bath is
    // drawn once, finished.
    let quiet = [], settled = [];
    function run(a) {
        (calm.matches ? quiet : actions).push(a); kick(); return a;
    }
    // finish everything in progress without showing it, then resolve
    function settle() {
        quiet.push(...actions); actions = [];
        if (!quiet.length) return Promise.resolve();
        kick();
        return new Promise((res) => settled.push(res));
    }

    function changed() {
        bath.flush();
        root.dispatchEvent(new CustomEvent('marbling:change', { bubbles: true, detail: { inks: bath.inks.length, vertices: bath.count } }));
    }

    /* loop */
    function kick() { if (!raf && !dead) { last = 0; raf = requestAnimationFrame(frame); } }
    function frame(now) {
        raf = 0;
        if (dead) return;
        const dt = last ? Math.min((now - last) / 1000, 1 / 20) : 1 / 60;
        last = now;
        if (visible || !started) {
            for (let k = 0; k < actions.length; k++) {
                if (actions[k].update(dt)) { actions.splice(k, 1); k--; if (!actions.some((a) => a.score)) changed(); }
            }
            if (stroke) stepStroke();
            bath.flush();
            if (quiet.length) {
                const t0 = performance.now();
                while (quiet.length && performance.now() - t0 < 14) {
                    if (quiet[0].update(.1)) quiet.shift();
                    bath.flush();
                }
                overlay.comb = null;
                if (!quiet.length) { changed(); settled.splice(0).forEach((f) => f()); }
            }
        }
        if (bath.dirty && !quiet.length) draw();
        drawOverlay();
        if ((actions.length || quiet.length || stroke || feeding) && visible) raf = requestAnimationFrame(frame);
    }

    /* pointer: tap drops, hold feeds, drag pulls the stylus */
    let press = null, stroke = null, feeding = null, feedTimer = 0;
    const toBath = (e) => {
        const r = bathEl.getBoundingClientRect();
        return [(e.clientX - r.left - ox) / scale, (e.clientY - r.top - oy) / scale];
    };
    const tapR = () => Math.sqrt(W * bath.H) * .055;

    function nextInk() {
        const i = inkIndex;
        inkIndex = (inkIndex + 1) % palette.length;
        syncInk();
        return i;
    }

    function dropAt(x, y, feed) {
        if (state !== 'bath') { putAway(); }
        const i = nextInk();
        const a = dropAction(x, y, tapR(), i, feed && !calm.matches);
        if (calm.matches) { a.finish(); bath.dirty = true; kick(); } else { actions.push(a); kick(); }
        say(palette[i].name + ' dropped.');
        return a;
    }

    on(bathEl, 'pointerdown', (e) => {
        if (e.button !== 0 || state === 'laying') return;
        if (state === 'print') { putAway(); return; }
        const p = toBath(e);
        press = { id: e.pointerId, x: e.clientX, y: e.clientY, p, t: performance.now(), type: e.pointerType };
        if (e.pointerType !== 'touch' || drawMode) { try { bathEl.setPointerCapture(e.pointerId); } catch (_) { /* fine */ } }
        clearTimeout(feedTimer);
        feedTimer = setTimeout(() => {
            if (!press || stroke) return;
            feeding = dropAt(press.p[0], press.p[1], true);
            kick();
        }, 150);
    });
    on(bathEl, 'pointermove', (e) => {
        if (!press || e.pointerId !== press.id) return;
        const dx = e.clientX - press.x, dy = e.clientY - press.y;
        if (!stroke && !feeding && dx * dx + dy * dy > 36) {
            clearTimeout(feedTimer);
            stroke = { at: press.p.slice(), to: press.p.slice() };
            hint.classList.add('is-gone');
            if (state !== 'bath') putAway();
        }
        if (stroke) {
            stroke.to = toBath(e);
            overlay.tip = stroke.to;
            kick();
        }
    });
    const release = (e, cancelled) => {
        if (!press || e.pointerId !== press.id) return;
        clearTimeout(feedTimer);
        if (feeding) { feeding.feeding = false; feeding = null; }
        else if (!stroke && !cancelled) dropAt(press.p[0], press.p[1], false);
        if (stroke) { stepStroke(true); stroke = null; overlay.tip = null; changed(); kick(); say('Stylus pulled.'); }
        press = null;
    };
    on(bathEl, 'pointerup', (e) => release(e, false));
    on(bathEl, 'pointercancel', (e) => release(e, true));
    on(bathEl, 'contextmenu', (e) => e.preventDefault());

    // the stylus follows the pointer in steps no longer than a third of its reach
    function stepStroke(flush) {
        const s = stroke; if (!s) return;
        const S = Math.sqrt(W * bath.H);
        const lam = S * .02, sig = S * .034;
        let dx = s.to[0] - s.at[0], dy = s.to[1] - s.at[1];
        const L = Math.hypot(dx, dy);
        if (L < .05) return;
        // a touch of lag so a shaky hand still pulls a clean line
        const follow = flush ? 1 : Math.min(1, .55 + L / (sig * 6));
        const go = L * follow;
        const n = Math.max(1, Math.ceil(go / (sig / 3)));
        dx /= L; dy /= L;
        const step = go / n;
        for (let i = 0; i < n; i++) {
            const tx = s.at[0] + dx * step * .5, ty = s.at[1] + dy * step * .5;
            bath.stylus(tx, ty, dx * step, dy * step, lam, sig, .86);
            s.at[0] += dx * step; s.at[1] += dy * step;
        }
    }

    /* keyboard */
    on(bathEl, 'focus', () => { if (!cursor) cursor = [W / 2, bath.H / 2]; drawOverlay(); });
    on(bathEl, 'blur', () => drawOverlay());
    on(bathEl, 'keydown', (e) => {
        if (state === 'laying') return;
        if (!cursor) cursor = [W / 2, bath.H / 2];
        const step = (e.altKey ? 6 : 24) * (W / Math.max(cw, 1)) ;
        const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (dirs[e.key]) {
            e.preventDefault();
            const [ux, uy] = dirs[e.key];
            const from = cursor.slice();
            cursor = [clamp(cursor[0] + ux * step, 0, W), clamp(cursor[1] + uy * step, 0, bath.H)];
            if (e.shiftKey) {
                if (state === 'print') putAway();
                stroke = { at: from, to: cursor.slice() };
                stepStroke(true); stroke = null; changed();
            }
            kick(); drawOverlay();
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (state === 'print') { putAway(); return; }
            if (!e.repeat) dropAt(cursor[0], cursor[1], false);
        } else if (e.key === 'c' || e.key === 'C') { e.preventDefault(); api.comb(); }
        else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); state === 'print' ? putAway() : api.lay(); }
    });

    /* paper */
    function sheetRect() {
        const m = Math.round(Math.min(cw, ch) * .045);
        return { x: m, y: m, w: Math.round(cw - 2 * m), h: Math.round(ch - 2 * m) };
    }

    // render the bath (or its mirror) under the sheet into a canvas of w x h device px
    function renderPrint(w, h, px, mirror, withPaper, ground = true, blur = 0) {
        const r = sheetRect();
        // prints are drawn once and kept, so they live in memory (willReadFrequently),
        // not on the GPU, where a lost context would blank them
        const cpu = (cw_, ch_) => { const x = document.createElement('canvas'); x.width = cw_; x.height = ch_; x.getContext('2d', { willReadFrequently: true }); return x; };
        const c = withPaper ? makePaper(w, h, px, rng, paperTone) : cpu(w, h);
        const inkC = cpu(w, h);
        const g = inkC.getContext('2d');
        const k = w / r.w;                         // device px per css px of the sheet
        if (ground) {
            g.fillStyle = css(mixc(sizeRGB, hex(paperTone), .82));     // the unprinted ground: paper, a little dulled by size
            g.fillRect(0, 0, w, h);
        }
        g.save();
        if (mirror) { g.translate(w, 0); g.scale(-1, 1); }
        g.scale(k, k);
        g.translate(-r.x, -r.y);
        g.translate(ox, oy); g.scale(scale, scale);
        paintInks(g, bath, null, ground ? css(mixc(sizeRGB, hex(paperTone), .82)) : null, .9 / (scale * k), ground ? texFor(g, scale) : null);
        g.restore();
        const cg = c.getContext('2d');
        cg.save();
        cg.globalCompositeOperation = withPaper ? 'multiply' : 'source-over';
        if (blur) cg.filter = `blur(${blur}px)`;   // one blurred draw of the whole layer, never per ink
        cg.drawImage(inkC, 0, 0);
        cg.restore();
        if (withPaper) {
            // the paper's own tooth shows a little through the ink
            cg.save(); cg.globalAlpha = .22; cg.globalCompositeOperation = 'soft-light';
            cg.drawImage(makePaper(w, h, px, rng, '#808080'), 0, 0); cg.restore();
        }
        return c;
    }

    function svgString(mirror) {
        bath.flush();
        const r = sheetRect();
        const useSheet = mirror;
        // bath units of the visible region (or the sheet's region)
        const x0 = useSheet ? (r.x - ox) / scale : Math.max(0, -ox / scale);
        const y0 = useSheet ? (r.y - oy) / scale : Math.max(0, -oy / scale);
        const w = useSheet ? r.w / scale : Math.min(W, cw / scale);
        const h = useSheet ? r.h / scale : Math.min(bath.H, ch / scale);
        const f = (v) => (Math.round(v * 10) / 10).toString();
        const parts = [];
        const bg = useSheet ? css(mixc(sizeRGB, hex(paperTone), .82)) : css(sizeRGB);
        parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" width="${Math.round(w * 2)}" height="${Math.round(h * 2)}">`);
        parts.push(`<defs><clipPath id="b"><rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}"/></clipPath></defs>`);
        parts.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="${bg}"/>`);
        parts.push(`<g clip-path="url(#b)"${mirror ? ` transform="translate(${f(2 * x0 + w)} 0) scale(-1 1)"` : ''} stroke-width="${(w / 4000).toFixed(3)}" stroke-linejoin="round">`);
        for (const ink of bath.inks) {
            const p = ink.p, n = ink.n;
            let d = `M${f((p[2 * n - 2] + p[0]) / 2)} ${f((p[2 * n - 1] + p[1]) / 2)}`;
            for (let i = 0; i < n; i++) {
                const j = i === n - 1 ? 0 : i + 1;
                d += `Q${f(p[2 * i])} ${f(p[2 * i + 1])} ${f((p[2 * i] + p[2 * j]) / 2)} ${f((p[2 * i + 1] + p[2 * j + 1]) / 2)}`;
            }
            const c = ink.gall ? bg : ink.fill;
            parts.push(`<path d="${d}Z" fill="${c}" stroke="${c}"/>`);
        }
        parts.push('</g></svg>');
        return parts.join('');
    }

    function save(blob, name) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    function download(kind) {
        const stamp = 'marbling-' + new Date().toISOString().slice(0, 10);
        if (kind === 'svg') {
            const s = state === 'print' && printSVG ? printSVG : svgString(false);
            save(new Blob([s], { type: 'image/svg+xml' }), stamp + '.svg');
            say('SVG saved.');
            return;
        }
        let c;
        if (state === 'print' && printCanvas) c = printCanvas;
        else {
            const long = 2400, k = long / Math.max(cw, ch);
            c = document.createElement('canvas'); c.width = Math.round(cw * k); c.height = Math.round(ch * k);
            const g = c.getContext('2d');
            g.fillStyle = css(sizeRGB); g.fillRect(0, 0, c.width, c.height);
            g.setTransform(scale * k, 0, 0, scale * k, ox * k, oy * k);
            paintInks(g, bath, null, css(sizeRGB), .9 / (scale * k), texFor(g, scale));
        }
        c.toBlob((b) => b && save(b, stamp + '.png'), 'image/png');
        say('PNG saved.');
    }

    // a small timeline helper: run f(t in 0..1) over ms, resolves at the end
    const tl = (ms, f) => new Promise((res) => {
        const t0 = performance.now();
        const step = (now) => {
            if (dead) return res();
            const t = clamp((now - t0) / ms);
            f(t);
            t < 1 ? requestAnimationFrame(step) : res();
        };
        requestAnimationFrame(step);
    });

    function setSheet({ y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, origin = 'top', op = 1, lift = 0 }) {
        sheetIn.style.transformOrigin = `50% ${origin === 'top' ? '0%' : origin === 'bottom' ? '100%' : '50%'}`;
        sheetIn.style.transform = `translate3d(0, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${s})`;
        sheetWrap.style.opacity = op;
        // light from above: a sheet tilted out of the plane catches less of it
        shade.style.opacity = clamp(Math.abs(rx) / 40) * (Math.abs(ry) < 90 ? 1 : 0);       // never on the 3D element itself: opacity would flatten it
        // the shadow: the higher the sheet, the further, softer and fainter its shadow
        shadow.style.opacity = clamp(op * (.55 - lift * .25));
        shadow.style.transform = `translate(${lift * 14}px, ${lift * 22 + 2}px) scale(${1 + lift * .04})`;
        shadow.style.filter = `blur(${3 + lift * 18}px)`;
    }

    async function layPaper() {
        if (state !== 'bath' || !bath.inks.length) {
            if (!bath.inks.length) say('The bath is empty: drop some ink first.');
            return;
        }
        state = 'laying';
        if (layBtn) layBtn.disabled = true;
        await settle();
        if (stroke) { stroke = null; overlay.tip = null; }
        overlay.comb = null;
        if (bath.dirty) draw();
        drawOverlay();
        state = 'laying';
        root.classList.add('is-laying');
        if (layBtn) layBtn.disabled = true;
        const r = sheetRect();
        Object.assign(sheetWrap.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
        const px = Math.min(dpr, 2.5);
        const w = Math.round(r.w * px), h = Math.round(r.h * px);
        // the back of the sheet, blank; the ink that shows through it; the print
        const paperBack = makePaper(w, h, px, rng, paperTone);
        back.width = w; back.height = h; back.getContext('2d', { willReadFrequently: true }).drawImage(paperBack, 0, 0);
        const thr = renderPrint(w, h, px, false, false, false, 2.6 * px);
        through.width = w; through.height = h; through.getContext('2d', { willReadFrequently: true }).drawImage(thr, 0, 0);
        const pr = renderPrint(w, h, px, true, true);
        front.width = w; front.height = h; front.getContext('2d', { willReadFrequently: true }).drawImage(pr, 0, 0);
        printCanvas = pr;
        printSVG = svgString(true);
        sheetWrap.classList.add('is-on');
        through.style.opacity = 0;
        const H0 = r.h;

        if (calm.matches) {
            setSheet({ ry: 180, rz: -.6, lift: 0 });
            ghostOut(true);
            bath.clear(); draw();
            return finishPrint();
        }
        say('Laying the paper.');
        // 1. the sheet comes down, its top edge first
        await tl(900, (t) => {
            const e = easeOut(t);
            setSheet({ y: -H0 * .12 * (1 - e), rx: 38 * (1 - e * .35), s: 1.02 - .02 * e, op: clamp(t * 3), lift: 1 - e * .5, origin: 'top' });
        });
        // 2. it rolls down onto the size; the ink soaks through behind the contact line
        await tl(1100, (t) => {
            const e = ease(t);
            const rx = 38 * .65 * (1 - e);
            setSheet({ rx, lift: .5 * (1 - e), origin: 'top' });
            const reach = clamp(e * 1.08) * 100;
            through.style.webkitMaskImage = through.style.maskImage = `linear-gradient(to bottom, #000 ${reach - 6}%, transparent ${reach + 2}%)`;
            through.style.opacity = .08 + .06 * e;
        });
        // 3. a moment on the bath; the ink takes
        ghostOut(false);
        bath.clear(); draw();
        await tl(500, (t) => { through.style.opacity = .14 + .05 * t; });
        through.style.webkitMaskImage = through.style.maskImage = 'none';
        // 4. lifted from the near edge, the sheet peels away
        await tl(1000, (t) => {
            const e = ease(t);
            setSheet({ y: -H0 * .05 * e, rx: -26 * e, s: 1 + .02 * e, lift: e, origin: 'bottom' });
        });
        // 5. turned over in the air, and laid face up on the tray to look at
        await tl(1250, (t) => {
            const e = ease(t);
            setSheet({ y: -H0 * .05 * (1 - e), rx: -26 * (1 - e), ry: 180 * e, rz: -.6 * e, s: 1.02 - .02 * e, lift: 1 - e * .9, origin: 'center' });
        });
        await tl(500, (t) => setSheet({ ry: 180, rz: -.6, lift: .1 * (1 - easeOut(t)), origin: 'center' }));
        finishPrint();
    }

    function finishPrint() {
        state = 'print';
        root.classList.remove('is-laying');
        root.classList.add('is-print');
        if (layBtn) { layBtn.disabled = false; layBtn.textContent = 'New sheet'; }
        say('The print is lifted. The bath is clear.');
        const c = printCanvas, s = printSVG;
        root.dispatchEvent(new CustomEvent('marbling:print', {
            bubbles: true,
            detail: { canvas: c, png: () => new Promise((res) => c.toBlob(res, 'image/png')), svg: () => s },
        }));
        changed();
        if (autoplay === 'loop') {
            clearTimeout(loopTimer);
            loopTimer = setTimeout(() => { putAway(); setTimeout(() => !dead && api.play(nextPreset()), 700); }, 4500);
        }
    }

    function ghostOut(instant) {
        const g = ghost.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, ghost.width, ghost.height);
        if (instant) return;
        g.drawImage(canvas, 0, 0);
        ghost.style.transition = 'none';
        ghost.style.opacity = '.2';
        void ghost.offsetWidth;
        ghost.style.transition = 'opacity 3.2s cubic-bezier(.3,.1,.3,1) .4s';
        ghost.style.opacity = '0';
    }

    function putAway() {
        if (state !== 'print') return;
        state = 'bath';
        root.classList.remove('is-print');
        if (layBtn) layBtn.textContent = 'Lay paper';
        const done = () => { sheetWrap.classList.remove('is-on'); setSheet({ op: 0 }); };
        if (calm.matches) return done();
        tl(650, (t) => {
            const e = ease(t);
            setSheet({ y: ch * .5 * e, ry: 180, rz: -.6 + 2.2 * e, op: 1 - e, lift: .2 + e * .4, origin: 'center' });
        }).then(done);
    }

    const order = ['stone', 'peacock', 'nonpareil', 'spanish'];
    let played = presetName && order.includes(presetName) ? order.indexOf(presetName) : -1;
    const nextPreset = () => order[(played + 1) % order.length];

    /* api */
    const api = {
        drop(x, y, ink) {
            const i = ink == null ? nextInk() : (typeof ink === 'number' ? ink : Math.max(0, palette.findIndex((p) => p.id === ink || p.name === ink)));
            return run(dropAction(x ?? W / 2, y ?? bath.H / 2, tapR(), i));
        },
        comb(dir) {
            if (state === 'laying') return;
            if (state === 'print') putAway();
            const cycle = ['down', 'up', 'right', 'left'];
            const d = dir || cycle[comber++ % 4];
            const sp = W / 22;
            const o = { spacing: sp, offset: sp * ((d === 'up' || d === 'left') ? .0 : .5), alpha: sp * 1.5, lambda: sp * .12 };
            run(combAction(d, o, 1.7));
            say('Comb drawn ' + ({ down: 'down', up: 'up', right: 'across', left: 'back' })[d] + '.');
        },
        play(name) {
            if (state === 'laying') return;
            if (state === 'print') putAway();
            actions = []; quiet = []; overlay.comb = null;
            const had = bath.inks.length;
            played = Math.max(0, order.indexOf(name));
            const go = () => {
                bath.clear(); ghostOut(true);
                bath.veins = name === 'stone' || name === 'spanish';
                run(scoreAction(compose(name, rng, bath.H, fine), tempo));
                presetBtns.forEach((b, i) => b.setAttribute('aria-current', String(['stone', 'nonpareil', 'spanish', 'peacock'][i] === name)));
                say(({ stone: 'Turkish stone', nonpareil: 'Nonpareil', spanish: 'Spanish wave', peacock: 'Peacock' })[name] + '.');
            };
            if (had && !calm.matches) {
                // skim the old pattern away first
                ghostOut(false); bath.clear(); draw();
                ghost.style.transition = 'opacity .5s ease';
                ghost.style.opacity = '0';
                setTimeout(() => !dead && go(), 120);
            } else go();
        },
        // play your own score: [{ t, op: 'drop', x, y, r, ink }, { t, op: 'comb', dir, spacing, alpha, lambda, A, om, dur }, { t, op: 'wave', angle, A, L, dur }]
        score(ev, speed = tempo) {
            if (state === 'laying') return;
            if (state === 'print') putAway();
            const list = ev.slice().sort((a, b) => a.t - b.t);
            run(scoreAction(list, speed));
        },
        lay: () => layPaper(),
        clear() {
            if (state === 'laying') return;
            if (state === 'print') putAway();
            actions = []; quiet = []; overlay.comb = null;
            if (!calm.matches) ghostOut(false);
            ghost.style.transition = 'opacity .6s ease';
            ghost.style.opacity = '0';
            bath.clear(); draw(); changed();
            say('The bath is clear.');
        },
        png: () => download('png'),
        svg: () => download('svg'),
        get state() { return state; },
        get bath() { return bath; },
    };

    /* start */
    function start() {
        layout();
        syncInk();
        draw();
        drawOverlay();
        started = true;
        visible = true;
        if (presetName && order.includes(presetName)) {
            hint.classList.add('is-gone');
            api.play(presetName);
        }
        if (autoplay === 'loop' && calm.matches) { /* nothing moves on its own */ }
        if (autoplay === 'loop' && !calm.matches) {
            // when a composition ends, hold it, then lay paper
            on(root, 'marbling:change', () => {
                if (state !== 'bath' || actions.length) return;
                clearTimeout(loopTimer);
                loopTimer = setTimeout(() => { if (!actions.length && state === 'bath') api.lay(); }, hold * 1000);
            });
        }
    }

    io = new IntersectionObserver((en) => {
        visible = en[0].isIntersecting;
        if (visible) kick();
    }, { rootMargin: '60px' });
    io.observe(root);

    let w0 = 0, h0 = 0;
    ro = new ResizeObserver(() => {
        const r = bathEl.getBoundingClientRect();
        if (Math.abs(r.width - w0) < 1 && Math.abs(r.height - h0) < 1) return;
        w0 = r.width; h0 = r.height;
        if (!started) return;
        clearTimeout(sizeTimer);
        sizeTimer = setTimeout(() => { if (dead) return; layout(); draw(); drawOverlay(); }, 120);
    });
    ro.observe(bathEl);
    on(calm, 'change', () => { if (calm.matches) { quiet.push(...actions); actions = []; kick(); } });
    on(document, 'visibilitychange', () => { if (!document.hidden) kick(); });
    // if the GPU drops the bath's canvas, redraw it when it comes back
    on(canvas, 'contextrestored', () => { pats.delete(ctx); if (bath) { bath.dirty = true; kick(); } });

    if (img && !img.complete) on(img, 'load', () => {}, { once: true });
    start();

    function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(feedTimer); clearTimeout(loopTimer); clearTimeout(sizeTimer);
        off.forEach((f) => f());
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        for (const n of [stage, bar, help, live]) if (n) n.remove();
        root.classList.remove('mb', 'is-live', 'is-drawing', 'is-print', 'is-laying');
        root.style.removeProperty('--mb-next');
    }
    Object.defineProperties(destroy, Object.getOwnPropertyDescriptors(api));
    return destroy;
}

// Auto-start every [data-marbling] once it nears the viewport.
function autoStart(el) {
    if (!('IntersectionObserver' in window) || el.classList.contains('is-live')) return;
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        el.marbling = marbling(el);
    }, { rootMargin: '300px' });
    io.observe(el);
}
document.querySelectorAll('[data-marbling]').forEach(autoStart);
