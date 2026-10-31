/*
 *  KINTSUGI // a porcelain dish that breaks, and is mended with gold.
 *
 *  Markup:  <figure data-kintsugi><img src="assets/hydrangea-dish.webp" alt=""></figure>
 *  Or call  kintsugi(el, options)  yourself. Returns destroy(), which also
 *  carries destroy.strike(x, y), destroy.mend() and destroy.state.
 *
 *  The <img> is a transparent cut-out of a dish photographed from above. Tap
 *  it and it cracks from where you tapped, the way a struck dish does: three
 *  to six main cracks at uneven angles out of the blow (a Voronoi diagram with
 *  one seed per wedge, at different distances, so the cracks miss each other
 *  instead of meeting in a star), a couple of branches further out, and
 *  sometimes a sliver along one crack that is lost. Every crack
 *  is bent by one smooth noise field, so two neighbouring shards share the
 *  same ragged edge exactly. The pieces jump, tumble a little (2.5D: tilt,
 *  height, light and a cast shadow) and slide to rest on the paper, with a
 *  few chips. Each shard is the photograph clipped to its polygon, drawn
 *  from a copy of the photo made at the screen's own resolution, with the
 *  white porcelain body showing as a bright line along every broken edge.
 *
 *  Tap again (or wait) and they lift, fly home on springs, largest first,
 *  and seat. Then gold lacquer runs out from the impact along the crack
 *  network (a geodesic flood over the crack graph), fills the lost piece,
 *  and sets. The seams are ribbons of uneven width, edged with a hair of red
 *  urushi, lit as rounded ridges: a highlight rides on the side facing the
 *  light, and the light follows the pointer (or the phone's tilt), so the
 *  glints travel along the seams as you move. Gold dust sparkles beside them.
 *
 *  The behaviour is a small statechart (CHART) run by a twenty-line
 *  interpreter, mirrored to data-phase:
 *
 *    whole ─STRIKE→ breaking ─SETTLED→ broken ─MEND→ mending ─SEATED→ gilding ─GILT→ mended
 *                      └──────────MEND (tap mid-air)──↗                        mended ─STRIKE→ breaking
 *
 *  data-state="mended" starts already mended (seams only, not a button).
 *  Reduced motion: the mended dish, and nothing breaks. Keyboard: Enter or
 *  Space breaks and mends. No dependencies; rAF runs only while something
 *  moves and the piece is on screen.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const CRACK_MS = 150;       // the cracks run through the glaze before anything moves
const GILD_MS = 2300;       // the lacquer's run from the impact to the farthest rim
const SWEEP_MS = 1500;      // one slow pass of light once the gold has set
const STAGGER_MS = 70;      // between shards lifting, largest first

/* ---- the statechart ---------------------------------------------------- */
export const CHART = {
    initial: 'whole',
    states: {
        whole:    { on: { STRIKE: 'breaking' } },
        breaking: { entry: 'shatter', on: { SETTLED: 'broken', MEND: 'mending' } },
        broken:   { entry: 'rest', on: { MEND: 'mending' } },
        mending:  { entry: 'gather', on: { SEATED: 'gilding' } },
        gilding:  { entry: 'gild', on: { GILT: 'mended' } },
        mended:   { entry: 'shine', on: { STRIKE: [{ target: 'breaking', guard: 'again' }] } },
    },
};

function interpret(chart, { actions = {}, guards = {}, onChange }) {
    let state = chart.initial;
    return {
        get state() { return state; },
        jump(s) { state = s; onChange && onChange(state, null, 'INIT'); },
        send(event) {
            let t = (chart.states[state].on || {})[event];
            if (Array.isArray(t)) t = t.find((c) => !c.guard || guards[c.guard]());
            if (!t) return false;
            const from = state;
            state = typeof t === 'string' ? t : t.target;
            onChange && onChange(state, from, event);
            [].concat(chart.states[state].entry || []).forEach((a) => actions[a] && actions[a]());
            return true;
        },
    };
}

/* ---- randomness and noise ---------------------------------------------- */
function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function noise2(seed) {
    const r = rng(seed), P = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) P[i] = r() * 2 - 1;
    const h = (i, j) => P[((Math.imul(i, 374761393) ^ Math.imul(j, 668265263)) >>> 0) % 1021];
    return (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
        const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
        return mix(mix(h(xi, yi), h(xi + 1, yi), u), mix(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
    };
}

/* ---- the dish's outline, read from the cut-out's alpha -------------------
 * Units: the alpha bounding box's centre is the origin and half its longer
 * side is 1, so the dish is about the unit disc. rim(θ) is the true edge.  */
function readOutline(img) {
    const n = 360, k = n / Math.max(img.naturalWidth, img.naturalHeight);
    const w = Math.max(8, Math.round(img.naturalWidth * k)), h = Math.max(8, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h);
    const a = x.getImageData(0, 0, w, h).data;
    let x0 = w, x1 = 0, y0 = h, y1 = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (a[(j * w + i) * 4 + 3] > 24) {
        if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j;
    }
    if (x1 <= x0) { x0 = 0; y0 = 0; x1 = w - 1; y1 = h - 1; }
    const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, R = Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2;
    const A = 256, r = new Float32Array(A);
    for (let i = 0; i < A; i++) {
        const t = (i / A) * TAU, dx = Math.cos(t), dy = Math.sin(t);
        let q = 0;
        for (let s = 0; s < R * 1.6; s += 0.35) {
            const px = Math.round(cx + dx * s - 0.5), py = Math.round(cy + dy * s - 0.5);
            if (px < 0 || py < 0 || px >= w || py >= h || a[(py * w + px) * 4 + 3] < 128) break;
            q = s;
        }
        r[i] = q / R;
    }
    const rs = r.map((_, i) => (r[(i + A - 1) % A] + 2 * r[i] + r[(i + 1) % A]) / 4);
    const rim = (t) => {
        const f = (((t / TAU) % 1) + 1) % 1 * A, i = Math.floor(f) % A;
        return mix(rs[i], rs[(i + 1) % A], f - Math.floor(f));
    };
    // natural-pixel geometry of the unit frame
    return { rim, cx: cx / k, cy: cy / k, R: R / k };
}

/* ---- the fracture -------------------------------------------------------
 * Voronoi cells by half-plane clipping of a slightly enlarged outline (the
 * photo's own alpha draws the true rim). Every output edge remembers what
 * made it: -1 for the outline, or the index of the neighbouring seed.     */
function clipHalf(poly, tags, m, n, j) {
    const out = [], ot = [], N = poly.length;
    for (let i = 0; i < N; i++) {
        const P = poly[i], Q = poly[(i + 1) % N], t = tags[i];
        const dp = (P[0] - m[0]) * n[0] + (P[1] - m[1]) * n[1];
        const dq = (Q[0] - m[0]) * n[0] + (Q[1] - m[1]) * n[1];
        const cut = () => { const u = dp / (dp - dq); return [P[0] + (Q[0] - P[0]) * u, P[1] + (Q[1] - P[1]) * u]; };
        if (dp <= 0 && dq <= 0) { out.push(Q); ot.push(t); }
        else if (dp <= 0 && dq > 0) { out.push(cut()); ot.push(t); }
        else if (dp > 0 && dq <= 0) { out.push(cut()); ot.push(j); out.push(Q); ot.push(t); }
    }
    // ot[k] tags the edge that ENDS at out[k]; turn that into edge-from tags
    const tg = ot.map((_, k) => ot[(k + 1) % ot.length]);
    return [out, tg];
}

function seedsFor(I, n, rnd, inside) {
    // A struck dish breaks unevenly: three to six main cracks at irregular angles out of the
    // blow, so one wedge is often much bigger than the rest. A seed sits in each wedge (its
    // bisectors with the neighbours are the cracks); seeds at different distances from the blow
    // make the cracks miss each other there instead of meeting in one tidy star.
    const seeds = [];
    const ok = (p, d) => inside(p, 0.93) && seeds.every((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) > d);
    const k = 3 + Math.floor(rnd() * 4);
    const gaps = Array.from({ length: k }, () => 0.3 + Math.pow(rnd(), 1.5) * 2.2);
    const sum = gaps.reduce((a, b) => a + b, 0);
    let a = rnd() * TAU;
    for (const g of gaps) {
        const w = (g / sum) * TAU, am = a + w * (0.3 + rnd() * 0.4), r = 0.3 + rnd() * 0.55;
        for (let f = 1; f > 0.15; f *= 0.8) {
            const p = [I[0] + Math.cos(am) * r * f, I[1] + Math.sin(am) * r * f];
            if (ok(p, 0.14)) { seeds.push(p); break; }
        }
        a += w;
    }
    // then secondary breaks: a few small pieces near the blow, and cracks that branch off
    // across a wedge further out (a partial arc, not a ring)
    for (let tries = 0; seeds.length < n && tries < 3000; tries++) {
        let p, d;
        if (rnd() < 0.3) {
            const aa = rnd() * TAU, rr = 0.13 + rnd() * 0.2;
            p = [I[0] + Math.cos(aa) * rr, I[1] + Math.sin(aa) * rr]; d = 0.13;
        } else {
            const s = seeds[Math.floor(rnd() * seeds.length)];
            const aa = Math.atan2(s[1] - I[1], s[0] - I[0]) + (rnd() - 0.5) * 1.1, rr = 0.25 + rnd() * 0.45;
            p = [s[0] + Math.cos(aa) * rr, s[1] + Math.sin(aa) * rr]; d = 0.24;
        }
        if (ok(p, d)) seeds.push(p);
    }
    while (seeds.length < 3) {
        const aa = rnd() * TAU, rr = Math.sqrt(rnd()) * 0.9, p = [Math.cos(aa) * rr, Math.sin(aa) * rr];
        if (inside(p, 0.93)) seeds.push(p);
    }
    return seeds;
}

function fracture(outline, I, n, seed, blow = 1) {
    const rnd = rng(seed), N2 = noise2(seed * 7 + 3), N3 = noise2(seed * 13 + 5);
    const rim = outline.rim;
    const inside = (p, f = 1) => Math.hypot(p[0], p[1]) < rim(Math.atan2(p[1], p[0])) * f;
    const rimX = (t) => rim(t) * 1.03 + 0.012;            // the enlarged outline the cells are cut from
    const A = 160, base = [], btag = [];
    for (let i = 0; i < A; i++) { const t = (i / A) * TAU, q = rimX(t); base.push([Math.cos(t) * q, Math.sin(t) * q]); btag.push(-1); }

    const seeds = seedsFor(I, n, rnd, inside);
    // vertices, snapped so neighbouring cells share them exactly
    const V = [], vid = (p) => {
        for (let i = 0; i < V.length; i++) if (Math.abs(V[i][0] - p[0]) < 2e-5 && Math.abs(V[i][1] - p[1]) < 2e-5) return i;
        V.push(p); return V.length - 1;
    };
    const cells = seeds.map((s, i) => {
        let poly = base, tags = btag;
        for (let j = 0; j < seeds.length && poly.length; j++) {
            if (j === i) continue;
            const q = seeds[j], m = [(s[0] + q[0]) / 2, (s[1] + q[1]) / 2], nn = [q[0] - s[0], q[1] - s[1]];
            [poly, tags] = clipHalf(poly, tags, m, nn, j);
        }
        const ids = [], tg = [];
        poly.forEach((p, k) => { const id = vid(p); if (ids[ids.length - 1] !== id) { ids.push(id); tg.push(tags[k]); } else tg[tg.length - 1] = tags[k]; });
        if (ids.length > 2 && ids[0] === ids[ids.length - 1]) { ids.pop(); tg.pop(); }
        return { seed: s, ids, tg };
    });

    // the displacement that makes straight bisectors into cracks: smooth bends plus a fine tremor,
    // fading to nothing at the enlarged outline so cracks always reach it
    const disp = (p) => {
        const t = Math.atan2(p[1], p[0]), f = clamp((rimX(t) - Math.hypot(p[0], p[1])) / 0.1);
        const ax = N2(p[0] * 1.3 + 11, p[1] * 1.3) * 0.1 + N2(p[0] * 5 + 40, p[1] * 5) * 0.016 + N3(p[0] * 16, p[1] * 16 + 7) * 0.006;
        const ay = N2(p[0] * 1.3, p[1] * 1.3 + 23) * 0.1 + N2(p[0] * 5, p[1] * 5 + 61) * 0.016 + N3(p[0] * 16 + 3, p[1] * 16) * 0.006;
        return [p[0] + ax * f, p[1] + ay * f];
    };
    const VD = V.map(disp);
    const cracks = new Map();
    const crackFor = (a, b, ci, cj) => {
        const lo = Math.min(a, b), hi = Math.max(a, b), key = lo + ':' + hi;
        let c = cracks.get(key);
        if (!c) {
            const P = V[lo], Q = V[hi], L = Math.hypot(Q[0] - P[0], Q[1] - P[1]), k = Math.max(2, Math.ceil(L / 0.016));
            const pts = [VD[lo]];
            for (let s = 1; s < k; s++) pts.push(disp([mix(P[0], Q[0], s / k), mix(P[1], Q[1], s / k)]));
            pts.push(VD[hi]);
            c = { a: lo, b: hi, pts, cells: [ci, cj] };
            cracks.set(key, c);
        }
        return c;
    };
    const shards = cells.map((cell, ci) => {
        const pts = [], own = [];
        cell.ids.forEach((a, k) => {
            const b = cell.ids[(k + 1) % cell.ids.length], t = cell.tg[k];
            if (t >= 0) {
                const c = crackFor(a, b, ci, t);
                own.push(c);
                const seq = a === c.a ? c.pts : c.pts.slice().reverse();
                for (let s = 0; s < seq.length - 1; s++) pts.push(seq[s]);
            } else pts.push(VD[a]);
        });
        let ar = 0, cx = 0, cy = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length], c = p[0] * q[1] - q[0] * p[1];
            ar += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
        }
        ar /= 2; cx /= 6 * ar; cy /= 6 * ar;
        return { pts, cracks: own, area: Math.abs(ar), hx: cx, hy: cy, ci };
    }).filter((s) => s.pts.length > 2 && s.area > 1e-5);


    // seams: every crack, trimmed to the true rim; distances for the lacquer's flow
    const crackList = [...cracks.values()];
    const nodes = [], nodeOf = new Map();
    const node = (key, p) => { if (!nodeOf.has(key)) { nodeOf.set(key, nodes.length); nodes.push({ p, adj: [], d: Infinity }); } return nodeOf.get(key); };
    crackList.forEach((c, ci) => {
        c.nodes = c.pts.map((p, k) => node(k === 0 ? 'v' + c.a : k === c.pts.length - 1 ? 'v' + c.b : ci + '.' + k, p));
        for (let k = 1; k < c.nodes.length; k++) {
            const u = c.nodes[k - 1], v = c.nodes[k], L = Math.hypot(c.pts[k][0] - c.pts[k - 1][0], c.pts[k][1] - c.pts[k - 1][1]);
            nodes[u].adj.push([v, L]); nodes[v].adj.push([u, L]);
        }
    });
    // Dijkstra from the impact: it may jump through the glaze (at a cost) to the nearest cracks
    nodes.forEach((nd) => { nd.d = Math.hypot(nd.p[0] - I[0], nd.p[1] - I[1]) * 1.6; });
    const done = new Uint8Array(nodes.length);
    for (let it = 0; it < nodes.length; it++) {
        let u = -1, best = Infinity;
        for (let i = 0; i < nodes.length; i++) if (!done[i] && nodes[i].d < best) { best = nodes[i].d; u = i; }
        if (u < 0) break;
        done[u] = 1;
        for (const [v, L] of nodes[u].adj) if (nodes[u].d + L < nodes[v].d) nodes[v].d = nodes[u].d + L;
    }
    const W = 0.0155, seams = [];
    let maxD = 0;
    crackList.forEach((c) => {
        let cur = null;
        const ws = rnd() * 50;
        for (let k = 0; k < c.pts.length; k++) {
            const p = c.pts[k], d = nodes[c.nodes[k]].d, inn = inside(p, 0.988);
            if (inn) {
                if (!cur) {
                    cur = { pts: [], d: [] , end0: false, end1: false };
                    if (k > 0) { const q = c.pts[k - 1], e = rimCross(q, p, rim, 0.988); cur.pts.push(e); cur.d.push(d); cur.end0 = true; }
                }
                cur.pts.push(p); cur.d.push(d);
            } else if (cur) {
                const q = c.pts[k - 1], e = rimCross(q, p, rim, 0.988);
                cur.pts.push(e); cur.d.push(nodes[c.nodes[k - 1]].d); cur.end1 = true;
                seams.push(cur); cur = null;
            }
        }
        if (cur && cur.pts.length > 1) seams.push(cur);
    });
    // Sometimes a sliver along one crack near the blow is lost: carved out of the shard on one
    // side (the other side keeps the crack as it was), it flies off with the chips and its gap
    // is filled with gold. Only the owner's edge moves, so everything else still refits exactly.
    const holes = [];
    let sliver = null;
    if (blow > 0.5 && rnd() < 0.7) {
        const dI = (p) => Math.hypot(p[0] - I[0], p[1] - I[1]);
        const cand = crackList.filter((c) => c.pts.length >= 9 && c.pts.some((p) => dI(p) < 0.4 && inside(p, 0.9)))
            .sort((x, y) => Math.min(...x.pts.map(dI)) - Math.min(...y.pts.map(dI)));
        const c = cand[Math.floor(rnd() * Math.min(2, cand.length))];
        const owner = c && shards.find((sh) => sh.ci === c.cells[rnd() < 0.5 ? 0 : 1]);
        if (c && owner) {
            const L = c.pts.length, m = Math.min(L - 3, 6 + Math.floor(rnd() * 5));
            let kn = 0; c.pts.forEach((p, k) => { if (dI(p) < dI(c.pts[kn])) kn = k; });
            const s0 = clamp(kn - Math.floor(rnd() * m), 1, L - 2 - m), s1 = s0 + m;
            const run = c.pts.slice(s0, s1 + 1);
            if (run.every((p) => inside(p, 0.95))) {
                const nrm = (k) => { const a = c.pts[k - 1], b = c.pts[k + 1], tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1; return [-ty / l, tx / l]; };
                const mid = s0 + (m >> 1), nm = nrm(mid);
                const side = pointIn(owner.pts, [c.pts[mid][0] + nm[0] * 0.004, c.pts[mid][1] + nm[1] * 0.004]) ? 1 : -1;
                const maxW = 0.016 + rnd() * 0.016;
                const off = run.map((p, j) => {
                    if (j === 0 || j === m) return p;
                    const t = j / m, w = maxW * Math.pow(Math.sin(Math.PI * t), 0.7) * (0.7 + 0.6 * (N3(j * 0.9 + seed % 97, 5) * 0.5 + 0.5));
                    const nn = nrm(s0 + j);
                    return [p[0] + nn[0] * w * side, p[1] + nn[1] * w * side];
                });
                for (let j = 1; j < m; j++) { const ix = owner.pts.indexOf(c.pts[s0 + j]); if (ix >= 0) owner.pts[ix] = off[j]; }
                owner.cracks = [...owner.cracks, { pts: off }];
                const pts = run.concat(off.slice(1, -1).reverse());
                let ar = 0, cx = 0, cy = 0;
                for (let i = 0; i < pts.length; i++) {
                    const p = pts[i], q = pts[(i + 1) % pts.length], cc = p[0] * q[1] - q[0] * p[1];
                    ar += cc; cx += (p[0] + q[0]) * cc; cy += (p[1] + q[1]) * cc;
                }
                ar /= 2; cx /= 6 * ar; cy /= 6 * ar;
                const ds = run.map((_, j) => nodes[c.nodes[s0 + j]].d);
                sliver = { pts, cracks: [{ pts: [...pts, pts[0]] }], area: Math.abs(ar), hx: cx, hy: cy, lost: true };
                holes.push({ pts, d: Math.min(...ds), hx: cx, hy: cy });
                seams.push({ pts: off, d: ds, end0: false, end1: false });
            }
        }
    }
    if (sliver) shards.push(sliver);

    seams.forEach((s, si) => {
        // irregular width along the arc: urushi laid by hand, swelling and thinning
        let acc = 0; s.w = []; s.s = [];
        const o = si * 17.3;
        for (let k = 0; k < s.pts.length; k++) {
            if (k) acc += Math.hypot(s.pts[k][0] - s.pts[k - 1][0], s.pts[k][1] - s.pts[k - 1][1]);
            s.s.push(acc);
            s.w.push(W * clamp(0.8 + 0.42 * N3(acc * 7 + o, o) + 0.16 * N2(acc * 34 + o, 3), 0.45, 1.5));
            maxD = Math.max(maxD, s.d[k]);
        }
    });
    // junctions where three cracks meet get a little pool of gold; rim ends wrap over the edge
    const blobs = [];
    nodes.forEach((nd) => { if (nd.adj.length >= 3 && inside(nd.p, 0.99)) blobs.push({ p: nd.p, r: W * (0.5 + rnd() * 0.18), d: nd.d }); });
    seams.forEach((s) => {
        if (s.end0) blobs.push({ p: s.pts[0], r: W * 0.42, d: s.d[0] });
        if (s.end1) blobs.push({ p: s.pts[s.pts.length - 1], r: W * 0.42, d: s.d[s.d.length - 1] });
    });
    // gold dust: specks scattered beside the seams, each a tiny facet with its own angle
    const dust = [];
    seams.forEach((s) => {
        for (let k = 1; k < s.pts.length; k++) {
            const p = s.pts[k - 1], q = s.pts[k], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
            const cnt = L * 200 * (0.4 + rnd());
            for (let c = 0; c < cnt; c++) {
                if (rnd() > 0.55) continue;
                const u = rnd(), nx = -(q[1] - p[1]) / L, ny = (q[0] - p[0]) / L;
                const off = (rnd() - 0.5) * 2 * W * (0.75 + Math.pow(rnd(), 4) * 2.2);
                const x = mix(p[0], q[0], u) + nx * off, y = mix(p[1], q[1], u) + ny * off;
                if (!inside([x, y], 0.99)) continue;
                dust.push({ x, y, r: W * (0.07 + rnd() * 0.16), f: rnd() * TAU, d: mix(s.d[k - 1], s.d[k], u) });
            }
        }
    });
    holes.forEach((h) => {
        for (let c = 0; c < 60; c++) {
            const x = h.hx + (rnd() - 0.5) * 0.16, y = h.hy + (rnd() - 0.5) * 0.16;
            if (pointIn(h.pts, [x, y])) dust.push({ x, y, r: W * (0.07 + rnd() * 0.14), f: rnd() * TAU, d: h.d + 0.02 });
        }
    });

    // a few chips, from along the cracks near the blow
    const chips = [];
    const near = crackList.filter((c) => c.pts.some((p) => Math.hypot(p[0] - I[0], p[1] - I[1]) < 0.4 && inside(p, 0.95)));
    for (let i = 0; i < 9 && near.length; i++) {
        const c = near[Math.floor(rnd() * near.length)], p = c.pts[Math.floor(rnd() * c.pts.length)];
        if (!inside(p, 0.94)) continue;
        const sz = 0.012 + rnd() * 0.022, a = rnd() * TAU, pts = [];
        const k = 3 + (rnd() < 0.4 ? 1 : 0);
        for (let j = 0; j < k; j++) { const aa = a + (j / k) * TAU + (rnd() - 0.5) * 0.9, rr = sz * (0.55 + rnd() * 0.6); pts.push([p[0] + Math.cos(aa) * rr, p[1] + Math.sin(aa) * rr]); }
        chips.push({ pts, hx: p[0], hy: p[1], area: sz * sz, chip: true, cracks: [{ pts: [...pts, pts[0]] }] });
    }
    return { shards, chips, seams, blobs, dust, holes, maxD, I };
}

function pointIn(pts, p) {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
    }
    return c;
}
function rimCross(q, p, rim, f) {
    // bisect between an outside point and an inside one for where the crack meets the rim
    let a = q, b = p;
    const inn = (x) => Math.hypot(x[0], x[1]) < rim(Math.atan2(x[1], x[0])) * f;
    if (inn(a)) { a = p; b = q; }
    for (let i = 0; i < 18; i++) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (inn(m)) b = m; else a = m; }
    return b;
}

/* gold powder: a tile of fine light and dark specks laid over the filled piece */
let grain = null;
function makeGrain() {
    const c = document.createElement('canvas'); c.width = c.height = 96;
    const x = c.getContext('2d'), r = rng(7);
    for (let i = 0; i < 900; i++) {
        const v = r();
        x.fillStyle = v > 0.5 ? `rgba(255,244,205,${0.15 + r() * 0.35})` : `rgba(90,58,14,${0.1 + r() * 0.25})`;
        const s = 0.6 + r() * 1.1;
        x.fillRect(r() * 96, r() * 96, s, s);
    }
    return c;
}

/* ---- colour -------------------------------------------------------------- */
function rgbOf(css, el) {
    const s = document.createElement('span');
    s.style.color = css; s.style.display = 'none'; el.appendChild(s);
    const m = getComputedStyle(s).color.match(/[\d.]+/g) || [200, 160, 80];
    s.remove();
    return m.slice(0, 3).map(Number);
}
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/* ======================================================================== */
export function kintsugi(el, opts = {}) {
    if (el.__kintsugi) return el.__kintsugi;
    const ds = el.dataset;
    const get = (k, d) => (opts[k] !== undefined ? opts[k] : ds[k] !== undefined ? ds[k] : d);
    const startMended = String(get('state', 'whole')) === 'mended';
    const cfg = {
        src: get('src', ''),
        pieces: clamp(Math.round(+get('pieces', 8)) || 8, 4, 30),
        breakOn: String(get('break', startMended ? 'none' : 'tap')),
        mend: String(get('mend', 'auto')),
        pause: Math.max(0, +get('pause', 1600) || 0),
        seed: get('seed', ''),
        size: get('size', '') === '' ? 0 : clamp(+get('size', 0.66) || 0.66, 0.2, 1),
        label: get('label', 'Break the dish'),
        mendLabel: get('mendLabel', 'Mend it with gold'),
        announce: get('announce', 'Mended with gold.'),
    };
    const img = el.querySelector('img');
    if (!img) return () => {};
    const pool = String(cfg.src).split(',').map((s) => s.trim()).filter(Boolean);
    if (pool.length) {
        const pick = new URL(pool[Math.floor(Math.random() * pool.length)], document.baseURI).href;
        if (img.src !== pick) { img.dataset.ktSrc = img.getAttribute('src') || ''; img.src = pick; }
    }

    const ac = new AbortController();
    const on = (t, e, f, o = {}) => t.addEventListener(e, f, { ...o, signal: ac.signal });
    let dead = false, raf = 0, last = 0, visible = false, timer = 0, viewTimer = 0, sizeTimer = 0;
    let io = null, ro = null, tilt = null;

    // DOM: canvas over the stage, a focus ring around the dish, a live region
    el.classList.add('kt');
    const canvas = document.createElement('canvas');
    canvas.className = 'kt-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    const ring = document.createElement('span');
    ring.className = 'kt-ring'; ring.setAttribute('aria-hidden', 'true');
    const live = document.createElement('span');
    live.className = 'kt-live'; live.setAttribute('aria-live', 'polite');

    let outline = null, frac = null, srcCanvas = null, history = null;
    let W = 0, H = 0, dpr = 1, S = 1, ox = 0, oy = 0, tex = null, texO = [0, 0], plateShadow = null;
    let lastLight = '', shards = [], phaseT = 0, gildT = 0, sweepT = -1, crackT = 0;
    const light = { x: -0.45, y: -0.7, tx: -0.45, ty: -0.7, px: null, py: null, hot: 0, thot: 0 };
    let gold = { base: [201, 160, 74], deep: [110, 76, 22], hi: [255, 240, 196], lac: [122, 40, 24], body: [251, 249, 244] };

    const interactive = () => !calm.matches && cfg.breakOn !== 'none';
    const m = interpret(CHART, {
        guards: { again: () => interactive() },
        actions: {
            shatter() { shatter(); },
            rest() { scheduleMend(); announce('Broken.'); },
            gather() { clearTimeout(timer); gather(); },
            gild() { gildT = 0; kick(); },
            shine() { sweepT = 0; announce(cfg.announce); kick(); },
        },
        onChange(state, from, event) {
            el.dataset.phase = state;
            labelFor(state);
            if (from) el.dispatchEvent(new CustomEvent('kintsugi:state', { bubbles: true, detail: { state, from, event } }));
        },
    });

    function labelFor(state) {
        if (!interactive()) return;
        const busy = state === 'mending' || state === 'gilding';
        el.setAttribute('aria-label', state === 'breaking' || state === 'broken' ? cfg.mendLabel : cfg.label);
        busy ? el.setAttribute('aria-disabled', 'true') : el.removeAttribute('aria-disabled');
    }
    function announce(t) { live.textContent = ''; setTimeout(() => { if (!dead) live.textContent = t; }, 60); }

    /* ---- layout and textures ------------------------------------------- */
    function layout() {
        const r = el.getBoundingClientRect();
        W = Math.max(1, r.width); H = Math.max(1, r.height);
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
        const size = cfg.size || clamp(parseFloat(getComputedStyle(el).getPropertyValue('--kt-size')) || 0.66, 0.2, 1);
        const Rpx = (size * Math.min(W, H)) / 2;
        S = Rpx * dpr;
        ox = Math.round(canvas.width / 2); oy = Math.round(canvas.height / 2);
        ring.style.width = ring.style.height = `${Rpx * 2 + 18}px`;
        buildTex();
        shards.forEach(buildSprites);
        paint();
    }
    function buildTex() {
        const src = srcCanvas || img;
        const nw = src.naturalWidth || src.width, nh = src.naturalHeight || src.height;
        const k = S / outline.R;                         // device px per natural px
        tex = document.createElement('canvas');
        tex.width = Math.max(1, Math.ceil(nw * k)); tex.height = Math.max(1, Math.ceil(nh * k));
        const t = tex.getContext('2d');
        t.imageSmoothingQuality = 'high';
        t.drawImage(src, 0, 0, nw * k, nh * k);
        texO = [outline.cx * k, outline.cy * k];
        // a soft shadow under the whole dish
        const pad = Math.ceil(S * 0.12);
        plateShadow = document.createElement('canvas');
        plateShadow.width = tex.width + pad * 2; plateShadow.height = tex.height + pad * 2;
        const p = plateShadow.getContext('2d');
        p.shadowColor = 'rgba(38,30,22,1)'; p.shadowBlur = S * 0.05; p.shadowOffsetX = 100000;
        p.drawImage(tex, pad - 100000, pad);
    }
    function buildSprites(sh) {
        const pad = Math.ceil(3 * dpr + 2);
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        const rel = sh.pts.map((p) => [(p[0] - sh.hx) * S, (p[1] - sh.hy) * S]);
        rel.forEach((p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
        const w = Math.ceil(x1 - x0) + pad * 2, h = Math.ceil(y1 - y0) + pad * 2;
        const ax = -x0 + pad, ay = -y0 + pad;
        const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
        const path = new Path2D();
        rel.forEach((p, i) => (i ? path.lineTo(p[0] + ax, p[1] + ay) : path.moveTo(p[0] + ax, p[1] + ay)));
        path.closePath();
        const face = mk(), f = face.getContext('2d');
        f.save(); f.clip(path);
        f.drawImage(tex, ax - (texO[0] + sh.hx * S), ay - (texO[1] + sh.hy * S));
        f.restore();
        // the break: a shaded hair inside the glaze, then the white body itself
        f.globalCompositeOperation = 'source-atop';
        f.lineJoin = 'round'; f.lineCap = 'round';
        const edge = (c) => { const q = new Path2D(); c.pts.forEach((p, i) => { const x = (p[0] - sh.hx) * S + ax, y = (p[1] - sh.hy) * S + ay; i ? q.lineTo(x, y) : q.moveTo(x, y); }); return q; };
        const edges = sh.cracks.map(edge);
        f.strokeStyle = 'rgba(40,34,28,.16)'; f.lineWidth = 4.6 * dpr; edges.forEach((q) => f.stroke(q));
        f.strokeStyle = rgba(gold.body, 0.97); f.lineWidth = 2.1 * dpr; edges.forEach((q) => f.stroke(q));
        // silhouettes: porcelain body (the shard's thickness, and its lit side) and a dark one (its shaded side)
        const tint = (col) => { const c = mk(), x = c.getContext('2d'); x.drawImage(face, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, w, h); return c; };
        const body = tint(rgba(mixc(gold.body, [214, 208, 196], 0.25), 1));
        const dark = tint('rgb(24,20,17)');
        const sp = Math.ceil(S * 0.05 + 6);
        const shadow = document.createElement('canvas'); shadow.width = w + sp * 2; shadow.height = h + sp * 2;
        const s = shadow.getContext('2d');
        s.shadowColor = 'rgba(38,30,22,1)'; s.shadowBlur = Math.max(2, S * 0.014); s.shadowOffsetX = 100000;
        s.drawImage(face, sp - 100000, sp);
        sh.spr = { face, body, dark, shadow, ax, ay, sax: ax + sp, say: ay + sp };
    }

    /* ---- the break ------------------------------------------------------ */
    let impact = [0.2, -0.15];
    function newFracture(I) {
        const seed = cfg.seed !== '' && !history ? (+cfg.seed | 0) : (Math.random() * 1e9) | 0;
        frac = fracture(outline, I, cfg.pieces, seed);
        shards = [...frac.shards, ...frac.chips].map((s) => ({
            ...s, reach: Math.max(...s.pts.map((p) => Math.hypot(p[0] - s.hx, p[1] - s.hy))) * 1.04 + 0.01, x: s.hx, y: s.hy, z: 0, vx: 0, vy: 0, vz: 0, th: 0, w: 0, tx: 0, ty: 0, wx: 0, wy: 0, alpha: 1, seated: false,
        }));
        shards.forEach(buildSprites);
        light.hot = 0;
    }
    function shatter() {
        clearTimeout(timer);
        if (history) bakeGold();          // the old gold goes with the pieces
        newFracture(impact);
        crackT = 0; phaseT = 0;
        const I = impact, rnd = Math.random;
        const meanA = frac.shards.reduce((a, s) => a + s.area, 0) / frac.shards.length;
        shards.forEach((s) => {
            let dx = s.hx - I[0], dy = s.hy - I[1];
            const d = Math.hypot(dx, dy) || 1e-3;
            dx /= d; dy /= d;
            const nearK = Math.exp(-d * 2.2);
            const small = Math.pow(meanA / Math.max(s.area, 1e-4), 0.22);
            const sp = (0.8 + rnd() * 0.8) * (0.85 + nearK * 0.8) * clamp(small, 0.7, s.chip ? 2.6 : 1.5);
            const a = (rnd() - 0.5) * 0.6;
            s.vx = (dx * Math.cos(a) - dy * Math.sin(a)) * sp;
            s.vy = (dx * Math.sin(a) + dy * Math.cos(a)) * sp;
            s.vz = (s.chip ? 1.2 : 0.8) + rnd() * 0.9 + nearK * 0.6;
            s.w = (rnd() - 0.5) * (s.chip ? 16 : 6) * clamp(small, 0.6, 1.6);
            s.wx = (rnd() - 0.5) * 9; s.wy = (rnd() - 0.5) * 9;
        });
        if (navigator.vibrate && navigator.userActivation && navigator.userActivation.isActive) try { navigator.vibrate(10); } catch (e) { /* no matter */ }
        kick();
    }
    function bakeGold() {
        // draw the current gold onto a copy of the photo at its own resolution, so a dish broken
        // twice carries its first repair in its pieces
        const nw = (srcCanvas || img).naturalWidth || srcCanvas.width, nh = (srcCanvas || img).naturalHeight || srcCanvas.height;
        const c = document.createElement('canvas'); c.width = nw; c.height = nh;
        const x = c.getContext('2d');
        x.drawImage(srcCanvas || img, 0, 0);
        x.globalCompositeOperation = 'source-atop';
        const k = outline.R;
        drawGold(x, k, outline.cx, outline.cy, Infinity, { x: -0.45, y: -0.7, px: null, py: null, hot: 0 }, history, 1 / dpr * (k / S));
        c.naturalWidth = nw; c.naturalHeight = nh;
        srcCanvas = c;
        buildTex();
    }

    /* ---- physics (units: the dish's radius; seconds) -------------------- */
    const G = 9.5;
    function stepBreak(dt) {
        const hx = (W * dpr / 2) / S, hy = (H * dpr / 2) / S;
        let moving = false;
        for (const s of shards) {
            if (s.z > 0 || s.vz > 0) {
                s.vz -= G * dt; s.z += s.vz * dt;
                s.tx += s.wx * dt; s.ty += s.wy * dt;
                s.tx = clamp(s.tx, -0.55, 0.55); s.ty = clamp(s.ty, -0.55, 0.55);
                if (s.z <= 0) {
                    s.z = 0;
                    if (s.vz < -0.7) { s.vz *= -0.26; s.wx *= -0.5; s.wy *= -0.5; s.w *= 0.7; } else s.vz = 0;
                    const sp = Math.hypot(s.vx, s.vy);
                    if (sp > 0) { const k = Math.max(0, 1 - 0.18 * (1 + Math.abs(s.vz))) ; s.vx *= k; s.vy *= k; }
                }
            } else {
                // sliding on paper
                const sp = Math.hypot(s.vx, s.vy), dec = 0.62 * G * dt;
                if (sp <= dec) { s.vx = 0; s.vy = 0; } else { s.vx -= (s.vx / sp) * dec; s.vy -= (s.vy / sp) * dec; }
                s.w *= Math.exp(-7 * dt); if (Math.abs(s.w) < 0.02) s.w = 0;
                // lie flat
                s.tx *= Math.exp(-18 * dt); s.ty *= Math.exp(-18 * dt); s.wx = s.wy = 0;
                if (Math.abs(s.tx) < 1e-3) s.tx = 0; if (Math.abs(s.ty) < 1e-3) s.ty = 0;
            }
            s.x += s.vx * dt; s.y += s.vy * dt; s.th += s.w * dt;
            const rr = s.reach;
            if (s.x < -hx + rr) { s.x = -hx + rr; s.vx = Math.abs(s.vx) * 0.25; }
            if (s.x > hx - rr) { s.x = hx - rr; s.vx = -Math.abs(s.vx) * 0.25; }
            if (s.y < -hy + rr) { s.y = -hy + rr; s.vy = Math.abs(s.vy) * 0.25; }
            if (s.y > hy - rr) { s.y = hy - rr; s.vy = -Math.abs(s.vy) * 0.25; }
            if (s.z > 0 || Math.abs(s.vz) > 0 || Math.hypot(s.vx, s.vy) > 0.004 || Math.abs(s.w) > 0.02 || s.tx || s.ty) moving = true;
        }
        // shards on the paper nudge each other apart rather than stack deep
        for (let i = 0; i < shards.length; i++) for (let j = i + 1; j < shards.length; j++) {
            const a = shards[i], b = shards[j];
            if (a.z > 0.02 || b.z > 0.02 || a.chip || b.chip) continue;
            const ra = Math.sqrt(a.area / Math.PI) * 0.72, rb = Math.sqrt(b.area / Math.PI) * 0.72;
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-4, o = ra + rb - d;
            if (o > 0) {
                const ma = a.area, mb = b.area, k = (o / d) * 0.5;
                a.x -= dx * k * (mb / (ma + mb)) * 2; a.y -= dy * k * (mb / (ma + mb)) * 2;
                b.x += dx * k * (ma / (ma + mb)) * 2; b.y += dy * k * (ma / (ma + mb)) * 2;
                const rv = (b.vx - a.vx) * dx / d + (b.vy - a.vy) * dy / d;
                if (rv < 0) { const im = rv * 0.6; a.vx += dx / d * im * (mb / (ma + mb)); a.vy += dy / d * im * (mb / (ma + mb)); b.vx -= dx / d * im * (ma / (ma + mb)); b.vy -= dy / d * im * (ma / (ma + mb)); }
            }
        }
        return moving;
    }

    function gather() {
        phaseT = 0;
        const order = shards.filter((s) => !s.chip && !s.lost).sort((a, b) => b.area - a.area);
        order.forEach((s, i) => { s.t0 = i * STAGGER_MS / 1000; s.seated = false; });
        shards.forEach((s) => { if (s.chip || s.lost) { s.t0 = 0; s.fade = true; } });
        // the nearest turn home: never more than half a turn
        shards.forEach((s) => { s.th = Math.atan2(Math.sin(s.th), Math.cos(s.th)); });
        kick();
    }
    function stepMend(dt) {
        let all = true;
        const LIFT = 0.13;
        for (const s of shards) {
            if (s.fade) { s.alpha = Math.max(0, s.alpha - dt / 0.45); continue; }
            if (s.seated) continue;
            all = false;
            const t = phaseT - s.t0;
            if (t < 0) continue;
            const spring = (x, v, k, z) => -k * x - 2 * z * Math.sqrt(k) * v;
            const dx = s.x - s.hx, dy = s.y - s.hy, dist = Math.hypot(dx, dy);
            // up first, then home; it comes down onto its place as it arrives
            const zT = t < 0.16 ? LIFT : LIFT * smooth(0.0, 0.16, dist + Math.abs(s.th) * 0.08);
            s.vz += spring(s.z - zT, s.vz, 260, 1) * dt; s.z += s.vz * dt;
            if (t >= 0.12) {
                const k = 46, z = 0.88;
                s.vx += spring(dx, s.vx, k, z) * dt; s.vy += spring(dy, s.vy, k, z) * dt;
                s.w += spring(s.th, s.w, k * 0.9, z) * dt;
                s.x += s.vx * dt; s.y += s.vy * dt; s.th += s.w * dt;
            }
            s.wx += spring(s.tx, s.wx, 120, 1) * dt; s.wy += spring(s.ty, s.wy, 120, 1) * dt;
            s.tx += s.wx * dt; s.ty += s.wy * dt;
            if (dist < 0.0012 && Math.abs(s.th) < 0.0015 && s.z < 0.0015 && Math.hypot(s.vx, s.vy) < 0.02 && t > 0.3) {
                Object.assign(s, { x: s.hx, y: s.hy, z: 0, th: 0, tx: 0, ty: 0, vx: 0, vy: 0, vz: 0, w: 0, wx: 0, wy: 0, seated: true });
            }
        }
        return !all;
    }

    /* ---- painting ------------------------------------------------------- */
    function paint() {
        if (!tex) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const st = m.state;
        const whole = st === 'whole' || st === 'gilding' || st === 'mended' || (st === 'breaking' && crackT < CRACK_MS);
        if (whole) {
            const shake = st === 'breaking' ? (1 - crackT / CRACK_MS) * dpr * 0.8 : 0;
            const px = Math.round(ox - texO[0] + (Math.random() - 0.5) * shake), py = Math.round(oy - texO[1] + (Math.random() - 0.5) * shake);
            const pad = (plateShadow.width - tex.width) / 2;
            ctx.globalAlpha = 0.34;
            ctx.drawImage(plateShadow, px - pad + S * 0.012, py - pad + S * 0.03);
            ctx.globalAlpha = 1;
            ctx.drawImage(tex, px, py);
            if (st === 'breaking') drawCracks(crackT / CRACK_MS);
            if (st === 'gilding') drawOpen(gildT);
            if (st === 'gilding' || st === 'mended') {
                const g = st === 'mended' ? Infinity : gildT;
                ctx.save();
                drawGold(ctx, S, ox, oy, g, light, frac, 1);
                ctx.restore();
            }
            return;
        }
        // shards, low ones first
        const order = shards.slice().sort((a, b) => a.z - b.z || (a.chip ? 1 : 0) - (b.chip ? 1 : 0));
        const Lk = [-0.5, -0.86];
        for (const s of order) {
            if (s.alpha <= 0.002 || !s.spr) continue;
            const sp = s.spr, px = ox + s.x * S, py = oy + s.y * S;
            const c = Math.cos(s.th), n = Math.sin(s.th), sc = 1 + s.z * 0.34;
            // cast shadow: further, softer and fainter the higher it flies
            const so = (0.013 + s.z * 0.42) * S, ss = 1 + s.z * 0.18;
            ctx.globalAlpha = s.alpha * 0.7 / (1 + s.z * 8);
            ctx.setTransform(c * ss, n * ss, -n * ss, c * ss, px + so * 0.4, py + so * 0.75);
            ctx.drawImage(sp.shadow, -sp.sax, -sp.say);
            // tilt foreshortens; the shard's thickness shows on the side it leans away from
            const fx = Math.cos(s.ty) * sc, fy = Math.cos(s.tx) * sc;
            const a = fx * c, b = fy * n, cc = -fx * n, d = fy * c;
            const tk = (0.0055 + Math.abs(s.tx) * 0.012 + Math.abs(s.ty) * 0.012) * S;
            ctx.globalAlpha = s.alpha;
            ctx.setTransform(a, b, cc, d, px - Math.sin(s.ty) * tk, py + Math.max(0.6 * dpr, tk) - Math.sin(s.tx) * tk);
            ctx.drawImage(sp.body, -sp.ax, -sp.ay);
            ctx.setTransform(a, b, cc, d, px, py);
            ctx.drawImage(sp.face, -sp.ax, -sp.ay);
            const lum = (Math.sin(s.ty) * -Lk[0] + Math.sin(s.tx) * -Lk[1]) * 1.1;
            if (Math.abs(lum) > 0.01) {
                ctx.globalAlpha = s.alpha * Math.min(lum > 0 ? 0.4 : 0.22, Math.abs(lum) * 0.55);
                ctx.drawImage(lum > 0 ? sp.body : sp.dark, -sp.ax, -sp.ay);
            }
        }
        ctx.globalAlpha = 1;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    function drawOpen(g) {
        // seated but not yet gilded: the breaks still show white, the lost piece is still a hole
        ctx.save();
        frac.holes.forEach((h) => {
            const a = 1 - smooth(h.d, h.d + 0.12, g);
            if (a <= 0) return;
            ctx.globalCompositeOperation = 'destination-out';
            ctx.globalAlpha = a;
            ctx.beginPath(); h.pts.forEach((p, i) => (i ? ctx.lineTo(ox + p[0] * S, oy + p[1] * S) : ctx.moveTo(ox + p[0] * S, oy + p[1] * S))); ctx.closePath();
            ctx.fill();
        });
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = 1;
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        const path = new Path2D();
        frac.seams.forEach((s) => s.pts.forEach((p, k) => (k ? path.lineTo(ox + p[0] * S, oy + p[1] * S) : path.moveTo(ox + p[0] * S, oy + p[1] * S))));
        ctx.strokeStyle = 'rgba(40,34,28,.22)'; ctx.lineWidth = 2.6 * dpr; ctx.stroke(path);
        ctx.strokeStyle = rgba(gold.body, 0.95); ctx.lineWidth = 1.2 * dpr; ctx.stroke(path);
        ctx.restore();
    }
    function drawCracks(t) {
        // the instant before it comes apart: hairlines race out from the blow
        const g = frac.maxD * Math.min(1, t * 1.15) + 0.02;
        ctx.save();
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(30,24,20,.55)'; ctx.lineWidth = 0.9 * dpr;
        ctx.beginPath();
        frac.seams.forEach((s) => {
            let started = false;
            for (let k = 0; k < s.pts.length; k++) {
                if (s.d[k] > g) break;
                const x = ox + s.pts[k][0] * S, y = oy + s.pts[k][1] * S;
                started ? ctx.lineTo(x, y) : ctx.moveTo(x, y); started = true;
            }
        });
        ctx.stroke();
        ctx.restore();
    }

    /* The gold. Each seam is a ribbon of varying width, filled with a sheen that
     * runs along the light's direction, edged with a hair of red lacquer, and
     * lit as a rounded ridge: per segment, a highlight on the side facing the
     * light, strongest where the seam runs across the light and near the
     * pointer. g is how far the lacquer has run (Infinity once set).        */
    function drawGold(c, S_, ox_, oy_, g, L, F, unit) {
        if (!F) return;
        const lx = L.x, ly = L.y, ll = Math.hypot(lx, ly) || 1, lnx = lx / ll, lny = ly / ll;
        const elev = clamp(ll, 0.2, 1);
        const X = (p) => ox_ + p[0] * S_, Y = (p) => oy_ + p[1] * S_;
        const FRONT = 0.07;
        const tip = (d) => (g === Infinity ? 1 : smooth(0, FRONT, g - d));
        // the broad sheen: bright toward the light, deep away from it; a band follows the pointer
        const gr = c.createLinearGradient(ox_ + lnx * S_ * 1.1, oy_ + lny * S_ * 1.1, ox_ - lnx * S_ * 1.1, oy_ - lny * S_ * 1.1);
        const hot = L.px == null ? 0.38 : clamp(0.5 - (L.px * lnx + L.py * lny) / 2.2, 0.08, 0.92);
        gr.addColorStop(0, rgba(mixc(gold.base, gold.hi, 0.35), 1));
        gr.addColorStop(clamp(hot - 0.2), rgba(gold.base, 1));
        gr.addColorStop(hot, rgba(mixc(gold.base, gold.hi, 0.62), 1));
        gr.addColorStop(clamp(hot + 0.22), rgba(gold.base, 1));
        gr.addColorStop(1, rgba(mixc(gold.base, gold.deep, 0.55), 1));

        // holes: the lost piece, filled flush with gold
        F.holes.forEach((h) => {
            const a = g === Infinity ? 1 : smooth(h.d, h.d + 0.12, g);
            if (a <= 0) return;
            c.globalAlpha = a;
            c.beginPath(); h.pts.forEach((p, i) => (i ? c.lineTo(X(p), Y(p)) : c.moveTo(X(p), Y(p)))); c.closePath();
            c.fillStyle = gr; c.fill();
            c.fillStyle = rgba(gold.deep, 0.22); c.fill();
            if (grain) { c.save(); c.clip(); c.globalAlpha = a * 0.9; c.fillStyle = c.createPattern(grain, 'repeat'); c.fill(); c.restore(); c.globalAlpha = a; }
            const rg = c.createRadialGradient(X([h.hx, h.hy]) + lnx * S_ * 0.04, Y([h.hx, h.hy]) + lny * S_ * 0.04, 0, X([h.hx, h.hy]), Y([h.hx, h.hy]), S_ * 0.1);
            rg.addColorStop(0, rgba(gold.hi, 0.32 * elev + 0.25 * (L.hot || 0))); rg.addColorStop(1, rgba(gold.hi, 0));
            c.fillStyle = rg; c.fill();
            c.globalAlpha = 1;
        });

        // ribbons
        const lacW = Math.max(0.5, 0.45 * unit * dpr);
        c.lineJoin = 'round';
        const ribbon = new Path2D(), wet = [];
        F.seams.forEach((s) => {
            const n = s.pts.length;
            let end = n - 1;
            while (end > 0 && s.d[end] > g && s.d[end - 1] > g) end--;
            if (s.d[0] > g && (end === 0 || s.d[1] > g)) return;
            const L_ = [], R_ = [];
            for (let k = 0; k <= end; k++) {
                let p = s.pts[k], d = s.d[k];
                if (k === end && d > g && k > 0) {
                    const q = s.pts[k - 1], dq = s.d[k - 1], u = clamp((g - dq) / (d - dq || 1));
                    p = [mix(q[0], p[0], u), mix(q[1], p[1], u)]; d = g;
                    wet.push(p);
                }
                if (k === 0 && d > g) {
                    // flowing in from the far end
                    const q = s.pts[1], dq = s.d[1], u = clamp((g - dq) / (d - dq || 1));
                    p = [mix(q[0], p[0], u), mix(q[1], p[1], u)]; d = g; wet.push(p);
                }
                const a = s.pts[Math.max(0, k - 1)], b = s.pts[Math.min(n - 1, k + 1)];
                let tx = b[0] - a[0], ty = b[1] - a[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
                const w = s.w[k] * tip(d) * 0.5;
                L_.push([p[0] - ty * w, p[1] + tx * w]); R_.push([p[0] + ty * w, p[1] - tx * w]);
            }
            if (L_.length < 2) return;
            ribbon.moveTo(X(L_[0]), Y(L_[0]));
            for (let k = 1; k < L_.length; k++) ribbon.lineTo(X(L_[k]), Y(L_[k]));
            for (let k = R_.length - 1; k >= 0; k--) ribbon.lineTo(X(R_[k]), Y(R_[k]));
            ribbon.closePath();
        });
        F.blobs.forEach((b) => {
            const k = tip(b.d);
            if (k <= 0) return;
            ribbon.moveTo(X(b.p) + b.r * k * S_, Y(b.p));
            ribbon.arc(X(b.p), Y(b.p), b.r * k * S_, 0, TAU);
        });
        // the red-brown urushi bed shows as a hair at the gold's edge
        c.strokeStyle = rgba(gold.lac, 0.55); c.lineWidth = lacW * 2.2; c.stroke(ribbon);
        c.fillStyle = gr; c.fill(ribbon, 'nonzero');

        // ridge light, in alpha buckets so it is a dozen fills, not a thousand
        const B = 10, hiP = Array.from({ length: B }, () => new Path2D()), loP = Array.from({ length: B }, () => new Path2D());
        let hiUsed = new Uint8Array(B), loUsed = new Uint8Array(B);
        const pxu = L.px, pyu = L.py;
        F.seams.forEach((s) => {
            for (let k = 1; k < s.pts.length; k++) {
                if (s.d[k] > g) break;
                const p = s.pts[k - 1], q = s.pts[k];
                let tx = q[0] - p[0], ty = q[1] - p[1]; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
                const nx = -ty, ny = tx, dn = nx * lnx + ny * lny, side = dn >= 0 ? 1 : -1;
                let I = Math.pow(Math.abs(dn), 1.6) * (0.35 + 0.65 * elev);
                if (pxu != null) {
                    const mx = (p[0] + q[0]) / 2 - pxu, my = (p[1] + q[1]) / 2 - pyu;
                    I = I * 0.75 + L.hot * 0.95 * Math.exp(-(mx * mx + my * my) / 0.05) * (0.4 + 0.6 * Math.abs(dn));
                }
                I = clamp(0.12 + I);
                const w0 = s.w[k - 1] * tip(s.d[k - 1]), w1 = s.w[k] * tip(s.d[k]);
                const quad = (P, o0, o1, h0, h1) => {
                    P.moveTo(X([p[0] + nx * (o0 - h0), 0]), Y([0, p[1] + ny * (o0 - h0)]));
                    P.lineTo(X([q[0] + nx * (o1 - h1), 0]), Y([0, q[1] + ny * (o1 - h1)]));
                    P.lineTo(X([q[0] + nx * (o1 + h1), 0]), Y([0, q[1] + ny * (o1 + h1)]));
                    P.lineTo(X([p[0] + nx * (o0 + h0), 0]), Y([0, p[1] + ny * (o0 + h0)]));
                    P.closePath();
                };
                const bi = Math.min(B - 1, Math.floor(I * B));
                quad(hiP[bi], side * w0 * 0.14, side * w1 * 0.14, w0 * 0.19, w1 * 0.19); hiUsed[bi] = 1;
                const bl = Math.min(B - 1, Math.floor(Math.abs(dn) * B));
                quad(loP[bl], -side * w0 * 0.3, -side * w1 * 0.3, w0 * 0.12, w1 * 0.12); loUsed[bl] = 1;
            }
        });
        for (let i = 0; i < B; i++) {
            if (loUsed[i]) { c.fillStyle = rgba(gold.deep, 0.42 * ((i + 0.5) / B)); c.fill(loP[i]); }
        }
        for (let i = 0; i < B; i++) {
            if (hiUsed[i]) { c.fillStyle = rgba(gold.hi, 0.95 * ((i + 0.5) / B)); c.fill(hiP[i]); }
        }

        // dust: each speck flashes when the light comes round to its facet
        const la = Math.atan2(lny, lnx), DB = 8, dP = Array.from({ length: DB }, () => new Path2D()), dU = new Uint8Array(DB);
        for (const p of F.dust) {
            if (p.d > g) continue;
            const f = Math.max(0, Math.cos(p.f - la * 2));
            let a = 0.32 + 0.68 * Math.pow(f, 10);
            if (pxu != null) { const mx = p.x - pxu, my = p.y - pyu; a = Math.min(1, a + L.hot * 0.6 * Math.exp(-(mx * mx + my * my) / 0.03) * f); }
            const r = Math.max(0.55 * dpr * unit, p.r * S_), bi = Math.min(DB - 1, Math.floor(a * DB));
            dP[bi].rect(ox_ + p.x * S_ - r, oy_ + p.y * S_ - r, r * 2, r * 2); dU[bi] = 1;
        }
        for (let i = 0; i < DB; i++) {
            if (!dU[i]) continue;
            const a = (i + 0.5) / DB;
            c.fillStyle = rgba(a > 0.6 ? mixc(gold.base, gold.hi, 0.7) : gold.base, a);
            c.fill(dP[i]);
        }
        // the wet tip of the running lacquer
        wet.forEach((p) => {
            const rg = c.createRadialGradient(X(p), Y(p), 0, X(p), Y(p), 0.02 * S_);
            rg.addColorStop(0, rgba(gold.hi, 0.85)); rg.addColorStop(1, rgba(gold.hi, 0));
            c.fillStyle = rg; c.fillRect(X(p) - 0.02 * S_, Y(p) - 0.02 * S_, 0.04 * S_, 0.04 * S_);
        });
    }

    /* ---- the loop ------------------------------------------------------- */
    function kick() { if (!raf && visible && !dead) { last = 0; raf = requestAnimationFrame(frame); } }
    function frame(now) {
        raf = 0;
        if (dead) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        let more = false;
        const st = m.state;
        if (st === 'breaking') {
            if (crackT < CRACK_MS) { crackT += dt * 1000; more = true; }
            else {
                const sub = 4;
                for (let i = 0; i < sub; i++) more = stepBreak(dt / sub) || more;
                phaseT += dt;
                if (!more && phaseT > 0.3) { paint(); m.send('SETTLED'); return; }
                more = true;
            }
        } else if (st === 'mending') {
            phaseT += dt;
            const sub = 3;
            for (let i = 0; i < sub; i++) more = stepMend(dt / sub) || more;
            if (!more) { paint(); m.send('SEATED'); return; }
            more = true;
        } else if (st === 'gilding') {
            gildT += (dt * 1000 / GILD_MS) * (frac.maxD + 0.12) * (1.4 - 0.8 * easeInOut(clamp(gildT / (frac.maxD + 0.12))));
            more = true;
            if (gildT >= frac.maxD + 0.12) { gildT = Infinity; paint(); m.send('GILT'); return; }
        }
        // light: eases toward the pointer (or tilt); one slow pass after setting
        if (st === 'mended' || st === 'gilding') {
            if (sweepT >= 0) {
                sweepT += dt * 1000;
                const u = easeInOut(clamp(sweepT / SWEEP_MS)), a = mix(-2.6, -0.5, u);
                light.tx = Math.cos(a) * 0.9; light.ty = Math.sin(a) * 0.9;
                if (sweepT >= SWEEP_MS) sweepT = -1;
                more = true;
            } else if (tilt && tilt.active) {
                light.tx = clamp(tilt.x * 1.2, -1, 1); light.ty = clamp(-0.4 + tilt.y * 1.2, -1, 1);
                more = true;
            }
            const k = 1 - Math.exp(-dt / 0.11);
            const dx = light.tx - light.x, dy = light.ty - light.y, dh = light.thot - light.hot;
            light.x += dx * k; light.y += dy * k; light.hot += dh * k;
            if (Math.abs(dx) + Math.abs(dy) + Math.abs(dh) > 0.002) more = true;
        }
        const lk = light.x.toFixed(3) + light.y.toFixed(3) + light.hot.toFixed(3);
        if (st !== 'mended' || lk !== lastLight || sweepT >= 0) { paint(); lastLight = lk; }
        if (more && visible) raf = requestAnimationFrame(frame);
    }

    /* ---- input ---------------------------------------------------------- */
    function toUnit(clientX, clientY) {
        const r = el.getBoundingClientRect();
        return [((clientX - r.left) * dpr - ox) / S, ((clientY - r.top) * dpr - oy) / S];
    }
    function strikeAt(u) {
        if (!outline) return;
        const t = Math.atan2(u[1], u[0]), lim = outline.rim(t) * 0.82, d = Math.hypot(u[0], u[1]);
        impact = d > lim ? [Math.cos(t) * lim, Math.sin(t) * lim] : u;
        m.send('STRIKE');
    }
    const randomImpact = () => { const a = Math.random() * TAU, r = 0.12 + Math.random() * 0.36; return [Math.cos(a) * r, Math.sin(a) * r]; };
    function activate(u) {
        const st = m.state;
        if (st === 'whole' || st === 'mended') strikeAt(u || randomImpact());
        else if (st === 'breaking' || st === 'broken') m.send('MEND');
    }
    function scheduleMend() {
        clearTimeout(timer);
        if (cfg.mend !== 'auto') return;
        timer = setTimeout(() => { if (visible) m.send('MEND'); else timer = -1; }, cfg.pause);
    }
    function onClick(e) {
        if (!interactive() || e.button) return;
        activate(e.detail === 0 ? null : toUnit(e.clientX, e.clientY));
    }
    function onKey(e) {
        if (!interactive() || e.repeat || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        activate(null);
    }
    function onMove(e) {
        if (!outline || !visible) return;
        const u = toUnit(e.clientX, e.clientY);
        const lx = clamp(u[0] / 2.2, -1, 1), ly = clamp(u[1] / 2.2, -1, 1);
        // the light sits toward the pointer, a little above the dish
        light.tx = lx; light.ty = ly; light.px = u[0]; light.py = u[1];
        light.thot = Math.hypot(u[0], u[1]) < 1.6 ? 1 : 0;
        if (sweepT >= 0 && sweepT > 200) sweepT = -1;
        if (m.state === 'mended' || m.state === 'gilding') kick();
    }

    /* ---- start ---------------------------------------------------------- */
    async function start() {
        try { await img.decode(); } catch (e) { if (!img.complete || !img.naturalWidth) await new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); }); }
        if (dead || !img.naturalWidth) return;
        outline = readOutline(img);
        if (!grain) grain = makeGrain();
        const css = getComputedStyle(el);
        const read = (v, d) => rgbOf(css.getPropertyValue(v).trim() || d, el);
        gold = { base: read('--kt-gold', '#c9a04a'), deep: read('--kt-gold-deep', '#6e4c16'), hi: read('--kt-gold-light', '#fff1c6'), lac: read('--kt-lacquer', '#7a2818'), body: read('--kt-body', '#fbf9f4') };

        el.append(canvas, ring, live);
        el.classList.add('is-live');
        if (interactive()) {
            if (!el.hasAttribute('tabindex')) { el.tabIndex = 0; el.dataset.ktTab = '1'; }
            el.setAttribute('role', 'button');
        }
        if (startMended || calm.matches) {
            // already mended: a fracture laid down, the gold set
            const seed = cfg.seed !== '' ? +cfg.seed | 0 : (Math.random() * 1e9) | 0;
            const r = rng(seed ^ 0x5bd1e995), a = r() * TAU, rr = 0.12 + r() * 0.34;
            const hard = r() < 0.4;
            frac = fracture(outline, [Math.cos(a) * rr, Math.sin(a) * rr], hard ? cfg.pieces : Math.min(cfg.pieces, 6), seed, hard ? 1 : 0.3);
            history = frac;
            m.jump('mended');
        } else m.jump('whole');

        on(el, 'click', onClick);
        on(el, 'keydown', onKey);
        on(window, 'pointermove', onMove, { passive: true });
        on(el, 'pointerdown', onMove, { passive: true });
        on(el, 'pointerleave', () => { light.thot = 0; kick(); });
        on(calm, 'change', () => {
            if (calm.matches && m.state !== 'mended' && m.state !== 'whole') {
                // finish at once
                shards.forEach((s) => Object.assign(s, { x: s.hx, y: s.hy, z: 0, th: 0, tx: 0, ty: 0, seated: true }));
                m.jump('mended'); history = frac;
            }
            paint();
        });
        on(document, 'visibilitychange', () => { if (!document.hidden) kick(); });
        import('./tilt.js').then((mod) => { tilt = mod.default; }).catch(() => {});

        io = new IntersectionObserver((en) => {
            const e = en[en.length - 1];
            visible = e.isIntersecting;
            if (visible) {
                kick();
                if (timer === -1) { timer = 0; scheduleMend(); }
                if (cfg.breakOn === 'view' && interactive() && m.state === 'whole' && (e.intersectionRatio >= 0.55 || e.intersectionRect.height > innerHeight * 0.5) && !viewTimer) {
                    viewTimer = setTimeout(() => { if (visible && m.state === 'whole') strikeAt(randomImpact()); }, 450);
                }
            }
        }, { threshold: [0, 0.55, 0.8] });
        io.observe(el);

        let w0 = 0, h0 = 0;
        ro = new ResizeObserver(() => {
            const r = el.getBoundingClientRect();
            if (Math.abs(r.width - w0) < 1 && Math.abs(r.height - h0) < 1) return;
            w0 = r.width; h0 = r.height;
            clearTimeout(sizeTimer);
            sizeTimer = setTimeout(() => { if (!dead) layout(); }, tex ? 120 : 0);
        });
        ro.observe(el);
        layout();
        if (m.state === 'mended') { history = frac; paint(); }
    }
    // the history (for breaking it again) is whatever gold is on the dish now
    el.addEventListener('kintsugi:state', (e) => { if (e.detail.state === 'mended') history = frac; }, { signal: ac.signal });
    start();

    function destroy() {
        dead = true;
        ac.abort();
        cancelAnimationFrame(raf);
        clearTimeout(timer); clearTimeout(viewTimer); clearTimeout(sizeTimer);
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        canvas.remove(); ring.remove(); live.remove();
        el.classList.remove('kt', 'is-live');
        el.removeAttribute('data-phase');
        el.removeAttribute('aria-disabled');
        if (interactive() || el.getAttribute('role') === 'button') { el.removeAttribute('role'); el.removeAttribute('aria-label'); }
        if (el.dataset.ktTab) { el.removeAttribute('tabindex'); delete el.dataset.ktTab; }
        if (img.dataset.ktSrc !== undefined) { img.src = img.dataset.ktSrc; delete img.dataset.ktSrc; }
        if (!el.classList.length) el.removeAttribute('class');
        delete el.__kintsugi;
    }
    destroy.strike = (x, y) => { if (x == null) activate(null); else strikeAt([x, y]); };
    destroy.mend = () => m.send('MEND');
    Object.defineProperty(destroy, 'state', { get: () => m.state });
    el.__kintsugi = destroy;
    return destroy;
}

document.querySelectorAll('[data-kintsugi]').forEach((el) => kintsugi(el));
