/*
 *  PRETEXT-BURN // a letter that burns as you scroll, and unburns as you
 *  scroll back.
 *
 *  Markup:  <section data-pretext-burn>
 *             <div class="pb-stage">
 *               <article class="pb-letter">
 *                 <p class="pb-date">…</p> <p class="pb-greet">…</p>
 *                 <p>…</p> <p>…</p>
 *                 <p class="pb-close">…</p> <p class="pb-sign">…</p>
 *               </article>
 *             </div>
 *           </section>
 *  Or call pretextBurn(section, opts) yourself; it returns destroy().
 *
 *  1. pretext (Cheng Lou, vendor/pretext) lays the letter out on the sheet,
 *     line by line, at the largest size that fits; each line is written onto
 *     a 2D canvas with a hand's small irregularities (a drifting baseline, a
 *     slight slope, the ink fading between dips of the pen). That canvas is
 *     the ink texture.
 *  2. In a worker, a burn-time field: Dijkstra over a grid from a corner,
 *     through a paper whose speed varies (thick and thin spots, fibres it
 *     runs along, slow blots of size, faster along the cut edges, a little
 *     faster through ink). Every point stores the moment the fire reaches it.
 *  3. One fragment shader thresholds that field by t (the scroll): ahead of
 *     the front the paper browns; at the front a thin line of embers broken
 *     into beads; behind it char, black and glossy, cracked into plates that
 *     curl; then ash, grey, the writing still faintly there in rust; then the
 *     plates lift away one by one and leave holes onto the page.
 *  4. Ash flakes, a few sparks and a faint grey smoke are particles. Each
 *     flake is the very plate whose hole opens as it leaves.
 *
 *  Nothing is simulated per frame: t picks the state, so scrolling back
 *  unburns the sheet exactly. The embers breathe while you scroll and for a
 *  few seconds after; then the loop stops on dim, frozen embers.
 */

const LIB = './vendor/pretext/layout.js';
const REF = 100;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const ss = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function rng(seed) {
    let a = (seed >>> 0) || 1;
    return () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
}

function colour(css, fallback) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = fallback; c.fillStyle = css || fallback;
    const v = c.fillStyle;
    if (v[0] === '#') return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16) / 255);
    const m = v.match(/[\d.]+/g) || [0, 0, 0];
    return m.slice(0, 3).map((x) => +x / 255);
}

// ---- the burn-time field (runs in a worker) ---------------------------------
function burnKernel() {
    function hash(ix, iy, s) {
        let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 982451653)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h ^= h >>> 16;
        return (h >>> 0) / 4294967296;
    }
    function vn(x, y, s) {
        const ix = Math.floor(x), iy = Math.floor(y);
        let fx = x - ix, fy = y - iy;
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const a = hash(ix, iy, s), b = hash(ix + 1, iy, s), c = hash(ix, iy + 1, s), d = hash(ix + 1, iy + 1, s);
        return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    }
    function fbm(x, y, s, o) {
        let v = 0, amp = 0.5, f = 1, n = 0;
        for (let i = 0; i < o; i++) { v += amp * vn(x * f, y * f, s + i * 17); n += amp; amp *= 0.5; f *= 2.03; }
        return v / n;
    }
    function compute(job) {
        const { gw, gh, cell, W, H, ink, seed, fib } = job;
        const N = gw * gh;
        const sp = new Float32Array(N);
        const ct = Math.cos(fib), st = Math.sin(fib);
        let a = (seed * 2654435761) >>> 0 || 7;
        const R = () => { a ^= a << 13; a >>>= 0; a ^= a >>> 17; a ^= a << 5; a >>>= 0; return a / 4294967296; };
        // blots of heavier size the fire has to go round (they burn last)
        const blots = [];
        for (let i = 0; i < 5; i++) blots.push({ x: R() * W, y: R() * H * 0.9, r: W * (0.025 + R() * 0.05), k: 0.55 + R() * 0.25 });
        const z = (v) => (v - 0.5) / 0.13;
        for (let j = 0; j < gh; j++) {
            for (let i = 0; i < gw; i++) {
                const x = i * cell, y = j * cell, k = j * gw + i;
                const u = x * ct + y * st, v = -x * st + y * ct;
                const big = z(fbm(x / (0.3 * W), y / (0.3 * W), seed, 3));
                const mid = z(fbm(x / (0.07 * W), y / (0.07 * W), seed + 57, 3));
                const fb = z(fbm(u / (0.12 * W), v / (0.011 * W), seed + 101, 3));
                let s = Math.exp(0.42 * big + 0.3 * mid + 0.2 * fb);
                for (const b of blots) {
                    const d2 = ((x - b.x) ** 2 + (y - b.y) ** 2) / (b.r * b.r);
                    if (d2 < 4) s *= 1 - (1 - b.k) * Math.exp(-d2 * 1.6);
                }
                // more air at a cut edge: the fire runs along it
                const ed = Math.min(x, y, W - x, H - y);
                s *= 1 + 0.3 * Math.exp(-ed / (0.018 * W));
                s *= 1 + 0.18 * (ink[k] / 255);
                sp[k] = s;
            }
        }
        // 16-neighbour Dijkstra
        const offs = [];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
            [1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
            const len = Math.hypot(dx, dy);
            const c = (dx * ct + dy * st) / len;
            const along = 1 / (1 + 0.3 * c * c);          // faster along the fibres
            const rise = 1 + 0.14 * (dy / len);            // heat climbs: up is a little faster
            offs.push({ dx, dy, d: dy * gw + dx, m: len * cell * along * rise });
        }
        const run = () => {
        const dist = new Float64Array(N).fill(Infinity);
        const heap = new Int32Array(N), pos = new Int32Array(N).fill(-1);
        let hn = 0;
        const up = (k) => {
            const id = heap[k], d = dist[id];
            while (k > 0) { const pk = (k - 1) >> 1, pid = heap[pk]; if (dist[pid] <= d) break; heap[k] = pid; pos[pid] = k; k = pk; }
            heap[k] = id; pos[id] = k;
        };
        const down = (k) => {
            const id = heap[k], d = dist[id];
            for (;;) {
                let c = 2 * k + 1;
                if (c >= hn) break;
                if (c + 1 < hn && dist[heap[c + 1]] < dist[heap[c]]) c++;
                if (dist[heap[c]] >= d) break;
                heap[k] = heap[c]; pos[heap[k]] = k; k = c;
            }
            heap[k] = id; pos[id] = k;
        };
        const push = (id, d) => {
            if (d >= dist[id] || pos[id] === -2) return;
            dist[id] = d;
            if (pos[id] < 0) { heap[hn] = id; pos[id] = hn; hn++; up(hn - 1); } else up(pos[id]);
        };
        // ignition: the bottom right corner
        const ix = job.ignite[0] * (gw - 1), iy = job.ignite[1] * (gh - 1);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
            const d = Math.hypot(i - ix, j - iy);
            if (d < 2.5) push(j * gw + i, d * cell);
        }
        while (hn > 0) {
            const id = heap[0];
            hn--;
            if (hn > 0) { heap[0] = heap[hn]; pos[heap[0]] = 0; down(0); }
            pos[id] = -2;
            const i = id % gw, j = (id / gw) | 0, d0 = dist[id], s0 = sp[id];
            for (const o of offs) {
                const ii = i + o.dx, jj = j + o.dy;
                if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
                const nb = id + o.d;
                if (pos[nb] === -2) continue;
                push(nb, d0 + o.m * 2 / (s0 + sp[nb]));
            }
        }
        return dist;
        };
        // The fire goes out with a fragment left. Any other pocket the front
        // has closed round (a slow blot) burns too: its paper is made faster
        // until no island of unburned paper is left inside the char.
        let dist = run();
        const sortedD = Float64Array.from(dist).sort();
        const Dend = sortedD[Math.floor(N * job.keep)];
        const lab = new Int32Array(N);
        for (let iter = 0; iter < 5; iter++) {
            lab.fill(0);
            const comps = [];
            const stack = new Int32Array(N);
            for (let k0 = 0; k0 < N; k0++) {
                if (lab[k0] || dist[k0] < Dend) continue;
                const id = comps.length + 1, cells = [];
                let sn = 0; stack[sn++] = k0; lab[k0] = id;
                while (sn) {
                    const k = stack[--sn]; cells.push(k);
                    const i = k % gw, j = (k / gw) | 0;
                    if (i > 0 && !lab[k - 1] && dist[k - 1] >= Dend) { lab[k - 1] = id; stack[sn++] = k - 1; }
                    if (i < gw - 1 && !lab[k + 1] && dist[k + 1] >= Dend) { lab[k + 1] = id; stack[sn++] = k + 1; }
                    if (j > 0 && !lab[k - gw] && dist[k - gw] >= Dend) { lab[k - gw] = id; stack[sn++] = k - gw; }
                    if (j < gh - 1 && !lab[k + gw] && dist[k + gw] >= Dend) { lab[k + gw] = id; stack[sn++] = k + gw; }
                }
                comps.push(cells);
            }
            if (comps.length < 2) break;
            comps.sort((a, b) => b.length - a.length);
            for (let c = 1; c < comps.length; c++) for (const k of comps[c]) sp[k] *= 3;
            dist = run();
        }
        const T = new Float32Array(N);
        for (let k = 0; k < N; k++) T[k] = dist[k] / W;
        // local speed of the front, in sheet widths per unit of t
        let G = new Float32Array(N);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
            const k = j * gw + i;
            const l = T[j * gw + Math.max(0, i - 1)], r = T[j * gw + Math.min(gw - 1, i + 1)];
            const u = T[Math.max(0, j - 1) * gw + i], d = T[Math.min(gh - 1, j + 1) * gw + i];
            const sx = (i > 0 && i < gw - 1) ? 2 : 1, sy = (j > 0 && j < gh - 1) ? 2 : 1;
            const g = Math.hypot((r - l) / (sx * cell), (d - u) / (sy * cell)) * W;
            G[k] = g > 1e-6 ? 1 / g : 5;
        }
        for (let pass = 0; pass < 3; pass++) {
            const O = new Float32Array(N);
            for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
                let s = 0, n = 0;
                for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
                    const ii = i + c, jj = j + b;
                    if (ii < 0 || jj < 0 || ii >= gw || jj >= gh) continue;
                    s += G[jj * gw + ii]; n++;
                }
                O[j * gw + i] = s / n;
            }
            G = O;
        }
        for (let k = 0; k < N; k++) G[k] = Math.min(5, Math.max(0.15, G[k]));
        // a smoothed copy of the field: the scorch is a heat gradient that
        // follows the front's broad shape, not every finger of it
        const Ts = Float32Array.from(T);
        const RB = Math.max(2, Math.round((0.022 * W) / cell)), tmp = new Float32Array(N);
        for (let pass = 0; pass < 2; pass++) {
            for (let j = 0; j < gh; j++) {
                let acc = 0, n = 0;
                for (let i = -RB; i < gw + RB; i++) {
                    if (i + RB < gw) { acc += Ts[j * gw + i + RB]; n++; }
                    if (i - RB - 1 >= 0) { acc -= Ts[j * gw + i - RB - 1]; n--; }
                    if (i >= 0 && i < gw) tmp[j * gw + i] = acc / n;
                }
            }
            for (let i = 0; i < gw; i++) {
                let acc = 0, n = 0;
                for (let j = -RB; j < gh + RB; j++) {
                    if (j + RB < gh) { acc += tmp[(j + RB) * gw + i]; n++; }
                    if (j - RB - 1 >= 0) { acc -= tmp[(j - RB - 1) * gw + i]; n--; }
                    if (j >= 0 && j < gh) Ts[j * gw + i] = acc / n;
                }
            }
        }
        // never let the smoothing pull the scorch behind the real front
        for (let k = 0; k < N; k++) Ts[k] = Math.min(Ts[k], T[k]);
        const sorted = Float32Array.from(T).sort();
        const Tend = Dend / W;
        return { T, G, Ts, Tend, Tmax: sorted[N - 1] };
    }
    return { compute };
}

function makeWorker() {
    const src = `const K = (${burnKernel.toString()})();
onmessage = (e) => { const r = K.compute(e.data); postMessage(r, [r.T.buffer, r.G.buffer, r.Ts.buffer]); };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
}

// ---- shaders -------------------------------------------------------------------
const SHEET_VS = `#version 300 es
in vec2 a;
uniform vec4 uRect;
uniform float uMarg;
uniform vec2 uCanvas;
out vec2 vP;
void main() {
    vec2 p = mix(vec2(-uMarg), uRect.zw + uMarg, a);
    vP = p;
    vec2 c = uRect.xy + p;
    gl_Position = vec4(c.x / uCanvas.x * 2. - 1., 1. - c.y / uCanvas.y * 2., 0., 1.);
}`;

const SHEET_FS = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uT, uTV, uInk, uCells, uNoise;
uniform vec2 uSheet, uGrid, uCellsN, uFibre;
uniform float uCell, uFlake, uT0, uLive, uHeat, uTime, uAj, uDpr;
uniform vec4 uBand;           // scorch px, ember px, char age, ash age
uniform vec3 uPaper, uInkC;
in vec2 vP;
out vec4 o;

float n1(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return texture(uNoise, (i + f + .5) / 256.).r; }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return texture(uNoise, (i + f + .5) / 256.).g; }
float fbm(vec2 p) { return .5 * n1(p) + .3 * n1(p * 2.03 + 17.1) + .2 * n1(p * 4.11 + 41.3); }

float Tat(vec2 p) {
    vec2 g = clamp(p / uCell, vec2(0.), uGrid - 1.0001);
    ivec2 i = ivec2(g); vec2 f = g - vec2(i);
    float a = texelFetch(uT, i, 0).r, b = texelFetch(uT, i + ivec2(1, 0), 0).r;
    float c = texelFetch(uT, i + ivec2(0, 1), 0).r, d = texelFetch(uT, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec4 TV(vec2 p) { return texture(uTV, (clamp(p / uCell, vec2(0.), uGrid - 1.) + .5) / uGrid); }

float liftAge(float j) { return uBand.z + uBand.w + j * uAj; }

// is there sheet at q? (smooth, for shadows)
float present(vec2 q) {
    if (q.x < 0. || q.y < 0. || q.x > uSheet.x || q.y > uSheet.y) return 0.;
    float age = uT0 - TV(q).r;
    return 1. - smoothstep(uBand.z + uBand.w, uBand.z + uBand.w + uAj, age);
}
float shade(vec2 p) {
    vec2 L = vec2(-.48, -.88);
    return .3 * present(p + L * 1.5) + .24 * present(p + L * 3.4 + vec2(1.4, -.7))
         + .24 * present(p + L * 3.4 - vec2(1.4, -.7)) + .22 * present(p + L * 6.5);
}

vec4 cellD(ivec2 c) { return texelFetch(uCells, clamp(c, ivec2(0), ivec2(uCellsN) - 1), 0); }
void vor(vec2 p, out vec2 ctr, out vec4 dat, out float edge, out vec2 nctr, out vec4 ndat) {
    vec2 g = p / uFlake + 1.;
    ivec2 ic = ivec2(floor(g)); vec2 f = fract(g);
    float md = 9.; ivec2 mc = ic; vec2 mr = vec2(0.);
    dat = vec4(0.); ndat = vec4(0.);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        ivec2 c = ic + ivec2(i, j); vec4 d = cellD(c);
        vec2 r = vec2(i, j) + d.xy - f; float dd = dot(r, r);
        if (dd < md) { md = dd; mr = r; mc = c; dat = d; }
    }
    float me = 9.; ivec2 nc = mc;
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        ivec2 c = mc + ivec2(i, j);
        if (c == mc) continue;
        vec4 d = cellD(c);
        vec2 r = vec2(c - ic) + d.xy - f;
        vec2 dr = r - mr;
        if (dot(dr, dr) > 1e-5) {
            float e = dot(.5 * (mr + r), normalize(dr));
            if (e < me) { me = e; nc = c; ndat = d; }
        }
    }
    ctr = (vec2(mc) + dat.xy - 1.) * uFlake;
    nctr = (vec2(nc) + ndat.xy - 1.) * uFlake;
    edge = me * uFlake;
}

vec3 paperCol(vec2 p) {
    vec3 c = uPaper;
    vec2 q = vec2(dot(p, uFibre), dot(p, vec2(-uFibre.y, uFibre.x)));
    float fib = n1(vec2(q.x * .045, q.y * .8)) - .5;
    float flo = fbm(p * .06) - .5;                 // the cloudy look-through of a handmade sheet
    float grain = n2(p * 1.6) - .5;
    c *= 1. + .045 * flo + .022 * fib + .02 * grain;
    // laid lines and chain lines from the mould's wires
    c *= 1. - .009 * sin(p.y * 6.2832 / 3.2 + n1(p * .04) * 2.);
    float per = uSheet.x / 7.;
    float cx = mod(p.x + 2.5 * (n1(vec2(p.y * .015, 3.)) - .5), per) - per * .5;
    c *= 1. - .022 * exp(-cx * cx / 2.2);
    // the edges have toned with age
    vec2 e = min(p, uSheet - p); float ed = min(e.x, e.y);
    float ton = exp(-ed / (uSheet.x * .03)) * (.6 + .8 * n1(p * .025));
    c = mix(c, c * vec3(.96, .91, .80), clamp(ton, 0., 1.) * .45);
    // a few foxing spots
    float fox = smoothstep(.8, .92, n1(p * .07 + 31.)) * smoothstep(.45, .8, n2(p * .5));
    c = mix(c, vec3(.80, .64, .46), fox * .12);
    // folded in three: a mountain and a valley crease
    for (int k = 1; k <= 2; k++) {
        float fy = uSheet.y * float(k) / 3. + (n1(vec2(p.x * .008, float(k) * 7.)) - .5) * 4.;
        float d = p.y - fy;
        float side = k == 1 ? 1. : -1.;
        c *= 1. + side * .045 * (d / 1.4) * exp(-d * d / 3.9) - .018 * exp(-d * d / .7);
        c *= 1. - side * .01 * sign(d) * exp(-abs(d) / 18.);
    }
    return c;
}

vec3 ramp(float x) {
    vec3 c = vec3(0.);
    c = mix(c, vec3(.30, .035, .0), smoothstep(.0, .22, x));
    c = mix(c, vec3(.78, .13, .01), smoothstep(.18, .48, x));
    c = mix(c, vec3(1., .40, .05), smoothstep(.42, .78, x));
    c = mix(c, vec3(1., .70, .26), smoothstep(.74, 1.1, x));
    c = mix(c, vec3(1., .93, .72), smoothstep(1.05, 1.6, x));
    return c;
}

vec4 holeLayer(vec2 p) {
    float s = shade(p);
    float a1 = .26 * s;
    vec3 sc = vec3(.16, .12, .09);
    // a little fallen ash on the page under the holes
    float dust = smoothstep(.86, .97, n1(p * .55 + 3.)) * smoothstep(.3, .7, n2(p * .08)) * .45;
    return vec4(vec3(.66, .64, .61) * dust + sc * a1 * (1. - dust), dust + a1 * (1. - dust));
}

void main() {
    vec2 p = vP;
    vec2 e = min(p, uSheet - p);
    float cov = clamp(min(e.x, e.y) * uDpr + .5, 0., 1.);
    if (cov <= 0.) { float s = shade(p); o = vec4(vec3(.16, .12, .09) * .22 * s, .22 * s); return; }
    vec2 pc = clamp(p, vec2(0.), uSheet);

    float T = Tat(pc);
    vec4 tv = TV(pc);
    float G = tv.g;
    float age = uT0 - T;
    float W = uSheet.x;
    float rag = (fbm(pc * .3) - .5) * 2.8 + (n1(pc * 1.3) - .5) * 1.2;
    float dp = -age * G * W + rag;                  // css px ahead of the front (+)
    float dps = min(dp, -(uT0 - tv.b) * G * W + rag * .5);   // the same, from the smoothed front
    float Sc = uBand.x, E = uBand.y, Cg = uBand.z, Ag = uBand.w;
    float ink = texture(uInk, pc / uSheet).a;
    vec3 paper = paperCol(pc);
    vec3 col;
    float alpha = 1.;
    vec4 under = vec4(0.);
    float tm = uTime;
    float glowK = uLive * (.45 + .55 * uHeat);
    vec3 L = normalize(vec3(-.45, -.7, .75));
    vec3 Hh = normalize(L + vec3(0., 0., 1.));
    // which way the unburned paper lies (the front's normal)
    vec2 dir = vec2(0., -1.);
    float lipH = 0., lipD = 0.;
    if (dp < 9. * E) {
        vec2 gT = vec2(TV(pc + vec2(2., 0.)).r - TV(pc - vec2(2., 0.)).r, TV(pc + vec2(0., 2.)).r - TV(pc - vec2(0., 2.)).r);
        dir = -gT / max(length(gT), 1e-6);
        // the leading edge of the char rolls up off the sheet: a ridge a few px
        // behind the embers, highest just before the edge
        float c = dp + 2.4 * E, w = 2.6 * E;
        lipH = exp(-c * c / (w * w)) * smoothstep(0., Cg * .25, uT0 - T + Cg * .25);
        lipD = lipH * (-2. * c / (w * w)) * 2.2 * E;     // d(height)/d(dp), in px per px
    }

    if (dps > Sc * 1.7 + 6.) {
        col = mix(paper, uInkC, ink);
    } else if (dp > 0.) {
        // scorch: a heat gradient following the front's broad shape,
        // darkest against the char, mottled at fibre scale
        float sv = fbm(pc * .045 + 5.);
        float Sl = Sc * (.7 + .6 * sv);
        float sb = clamp(1. - dps / Sl, 0., 1.);
        float sn = clamp(1. - dp / (Sc * .28), 0., 1.);
        float s = max(sb * sb * (3. - 2. * sb) * .88, sn * sn);
        s = clamp(s + .07 * (n2(pc * .6) - .5) * s + .05 * (n1(pc * .18) - .5) * s, 0., 1.);
        vec3 sc = paper;
        sc = mix(sc, paper * vec3(.97, .90, .72), smoothstep(0., .35, s));
        sc = mix(sc, vec3(.80, .61, .36), smoothstep(.28, .66, s));
        sc = mix(sc, vec3(.47, .27, .12), smoothstep(.6, .88, s));
        sc = mix(sc, vec3(.13, .07, .035), smoothstep(.86, 1., s));
        vec3 ik = mix(uInkC, vec3(.035, .02, .015), smoothstep(0., .6, s));
        col = mix(sc, ik, ink);
        // under the rolled lip: a soft shadow on the paper just ahead
        float sh = (1. - smoothstep(0., 3.5 * E, dp)) * (.35 + .65 * clamp(dot(dir, normalize(vec2(.45, .7))), 0., 1.));
        col *= 1. - .45 * sh;
    } else {
        // the ash breaks into small flakes along a jittered Voronoi net
        vec2 pw = pc + (vec2(n1(pc * .2), n2(pc * .2 + 23.7)) - .5) * uFlake * .55;
        vec2 ctr, nctr; vec4 dat, ndat; float edge;
        vor(pw, ctr, dat, edge, nctr, ndat);
        float lift = liftAge(dat.z);
        float ageC = uT0 - Tat(ctr);
        under = holeLayer(p);
        if (ageC > lift) { o = under; return; }
        float nAge = uT0 - Tat(nctr);
        float aa = 1.1 / uDpr;
        if (nAge > liftAge(ndat.z)) alpha = smoothstep(0., aa, edge);

        // ash comes in a narrow band, in soft patches
        float ashT = age + Ag * (1.1 * (fbm(pc * .05 + 7.) - .5) + .5 * (n1(pc * .35) - .5));
        float ash = smoothstep(Cg - Ag * .15, Cg + Ag * .2, ashT);
        float k = smoothstep(lift - Ag * .5, lift, ageC);     // about to break away

        // char buckles as it shrinks: gentle ridges a few mm across, loosely
        // along the fibres; broad soft highlights ride them
        vec2 fq = vec2(dot(pc, uFibre), dot(pc, vec2(-uFibre.y, uFibre.x)));
        float bw = W * .028;
        float formed = smoothstep(0., Cg * .2, age);
        vec2 grad = vec2(0.);
        for (int i = 0; i < 2; i++) {
            vec2 dq = i == 0 ? vec2(1., 0.) : vec2(0., 1.);
            vec2 qa = pc + dq, qb = pc - dq;
            vec2 fa = vec2(dot(qa, uFibre), dot(qa, vec2(-uFibre.y, uFibre.x)));
            vec2 fb = vec2(dot(qb, uFibre), dot(qb, vec2(-uFibre.y, uFibre.x)));
            float ha = sin(fa.y * 6.2832 / (bw * 1.6) + 9. * fbm(qa / (bw * 3.))) * .18 + (fbm(vec2(fa.x / (bw * 2.2), fa.y / (bw * 1.1))) - .5) * 2.2;
            float hb = sin(fb.y * 6.2832 / (bw * 1.6) + 9. * fbm(qb / (bw * 3.))) * .18 + (fbm(vec2(fb.x / (bw * 2.2), fb.y / (bw * 1.1))) - .5) * 2.2;
            if (i == 0) grad.x = (ha - hb) * .5; else grad.y = (ha - hb) * .5;
        }
        float amp = bw * .1 * formed * (1. - .6 * ash);
        vec2 slope = grad * amp + dir * lipD;
        // fine wrinkle in the ash: thin, fragile
        slope += (vec2(n1(pc * .55), n2(pc * .55 + 5.)) - .5) * .5 * ash;
        // a flake cups as it comes loose
        slope -= (pc - ctr) / uFlake * 1.2 * k;
        vec3 N = normalize(vec3(-slope, 1.));
        float diff = max(dot(N, L), 0.);
        float nh = max(dot(N, Hh), 0.);
        // satin: broad, soft highlights, no wet glints
        float sat = pow(nh, 8.) * .045 + pow(nh, 26.) * .08;
        vec3 charC = vec3(.034, .03, .028) * (.5 + .7 * diff) + sat * vec3(.78, .78, .8) * (1. + .5 * ink);
        charC += ink * vec3(.018, .013, .009);
        // the lip of the rolled edge catches the light
        charC += vec3(.16, .135, .11) * lipH * clamp(dot(-dir, normalize(vec2(-.45, -.7))) * .5 + .5, 0., 1.) * smoothstep(.0, .6, diff);
        charC = mix(vec3(.15, .075, .035) * (.7 + .5 * diff), charC, smoothstep(0., Cg * .12, age));
        // a few long splits along the fibres
        float spn = n1(vec2(fq.x / (W * .3), fq.y / (W * .03)) + 50.) + (n2(pc * .25) - .5) * .03;
        float spw = fwidth(spn);
        float spd = abs(spn - .5) / max(spw, 1e-5);
        float spOn = smoothstep(.62, .7, n2(pc / (W * .22) + 9.)) * smoothstep(Cg * .25, Cg * .7, age);
        float split = (1. - smoothstep(.4, 1.4, spd / mix(.6, 1.8, smoothstep(Cg * .3, Cg, age)))) * spOn;
        charC = mix(charC, vec3(.008), split * .9);
        // ash: very thin, pale silver-grey; the iron of the ink stays, rust on grey
        vec3 ashC = vec3(.78, .77, .75) * (.9 + .14 * fbm(pc * .15)) * (.88 + .16 * diff);
        ashC = mix(ashC, vec3(.40, .38, .36), smoothstep(.75, .92, n2(pc * .5 + 11.)) * .4 * (1. - k));
        ashC = mix(ashC, vec3(.58, .44, .35), ink * .4);
        // grey where the ash is still forming over the char
        vec3 mid = mix(charC, vec3(.5, .49, .47), .6);
        col = mix(charC, mix(mid, ashC, smoothstep(.35, 1., ash)), smoothstep(0., .35, ash));
        // hairline breaks just before a flake goes
        float hair = (1. - smoothstep(.25, .25 + aa, edge)) * k * ash;
        col = mix(col, vec3(.45, .44, .42), hair * .6);
    }

    // embers
    if (dp < 2.5 * E && dp > -9. * E && glowK > 0.) {
        vec2 dr = vec2(tm * .9, -tm * .6);
        float b1 = n1(pc * .16 + dr * .11);
        float b2 = n2(pc * .16 - dr * .09 + 31.);
        float bead = smoothstep(.44, .74, mix(b1, b2, .5 + .5 * sin(tm * .8 + pc.x * .013 + pc.y * .009)));
        float fine = n1(pc * .45 + dr * .3);
        float wob = (n2(pc * .07 + 3.) - .5) * .9 * E;      // the line wanders and thickens
        float wid = E * (.32 + .3 * bead);
        float core = exp(-pow((dp + .35 * E + wob * .3) / wid, 2.));
        float tail = dp < 0. ? exp(dp / (2.2 * E)) : 0.;
        float I = core * (.16 + 1.25 * bead * (.7 + .5 * fine));
        I += tail * .16 * smoothstep(.35, .8, n1(pc * .05 - dr * .05)) * (1. - core);
        // hot points inside the beads
        I += pow(n2(pc * .32 + vec2(tm * 1.1, -tm * .8)), 6.) * 3. * core * bead;
        // the writing glows a moment longer than the paper round it
        I += ink * exp(-pow((dp + 1.7 * E) / (1.9 * E), 2.)) * (.55 + .6 * bead);
        I *= (1. + uHeat * .32 * (n1(vec2(tm * 1.4, (pc.x + pc.y) * .006)) - .5)) * glowK;
        vec3 em = ramp(I);
        col = col * (1. - smoothstep(.04, .45, I)) + em;
        // and their light on the paper close by
        float halo = exp(-abs(dp + .4 * E) / (3.2 * E)) * (.3 + .7 * smoothstep(.3, .8, n1(pc * .05 + dr * .03))) * glowK;
        col += vec3(1., .36, .07) * halo * (dp > 0. ? .2 : .1);
    }

    col = clamp(col, 0., 1.);
    float a = alpha * cov;
    o = vec4(col * a, a) + under * (1. - a);
}`;

const PART_VS = `#version 300 es
in vec4 aA;     // x, y, size, alpha
in vec4 aB;     // kind, rot, flip, seed
uniform vec2 uCanvas;
uniform float uDpr;
out vec4 vB;
out float vAl;
void main() {
    gl_Position = vec4(aA.x / uCanvas.x * 2. - 1., 1. - aA.y / uCanvas.y * 2., 0., 1.);
    gl_PointSize = aA.z * uDpr;
    vB = aB; vAl = aA.w;
}`;

const PART_FS = `#version 300 es
precision highp float;
uniform sampler2D uNoise;
in vec4 vB;
in float vAl;
out vec4 o;
float n1(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return texture(uNoise, (i + f + .5) / 256.).r; }
void main() {
    vec2 q = gl_PointCoord * 2. - 1.;
    float kind = vB.x;
    if (kind < .5) {
        // a flake of ash, turning over as it rises
        float c = cos(vB.y), s = sin(vB.y);
        q = mat2(c, -s, s, c) * q;
        float fl = cos(vB.z);
        q.x /= max(abs(fl), .1);
        float r = length(q);
        vec2 dir = q / max(r, 1e-4);
        float rad = .6 + .3 * (n1(dir * 1.7 + vB.w * 40.) - .5) * 2. + .08 * (n1(dir * 4.3 + vB.w * 70.) - .5);
        float px = fwidth(r) * 1.2;
        float m = 1. - smoothstep(rad - px, rad + px, r);
        bool charred = fract(vB.w * 7.31) < .06;
        vec3 col = charred ? vec3(.2, .19, .18) : vec3(.84, .83, .81);
        col *= .72 + .34 * abs(fl) + .1 * (n1(q * 3. + vB.w * 50.) - .5);
        if (fl < 0.) col *= .85;
        col = mix(col, charred ? col * 1.6 : col * 1.07, smoothstep(rad * .55, rad, r));
        o = vec4(col, 1.) * m * vAl * .9;
    } else if (kind < 1.5) {
        // smoke: grey, never black
        float r2 = dot(q, q);
        float n = n1(q * 1.6 + vB.w * 60. + vB.y) * .6 + n1(q * 3.7 - vB.w * 20. - vB.y * 1.7) * .4;
        float a = exp(-r2 * 2.4) * clamp(.25 + 1.5 * (n - .4), 0., 1.) * smoothstep(1., .7, sqrt(r2));
        o = vec4(vec3(.52, .505, .49), 1.) * a * vAl;
    } else {
        float r2 = dot(q, q);
        float a = exp(-r2 * 9.) + exp(-r2 * 2.2) * .22;
        o = vec4(vec3(1., .6, .2) * a * vAl, a * vAl * .7);
    }
}`;

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
}
function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const U = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(p, i); U[u.name] = gl.getUniformLocation(p, u.name); }
    return { p, U };
}

// ---- the component ----------------------------------------------------------------
export function pretextBurn(root, opts = {}) {
    const letter = root && root.querySelector('.pb-letter');
    if (!root || !letter) return () => {};
    const stage = root.querySelector('.pb-stage') || root;
    const ds = root.dataset;
    const opt = (k, d) => opts[k] ?? ds[k] ?? d;
    const seed = String(opt('seed', '11')) === 'random' ? (Math.random() * 1e9) | 0 : Number(opt('seed', 11)) || 11;
    const aspect = Number(opt('aspect', 1.38));
    const leading = Number(opt('leading', 1.9));
    const keep = clamp(Number(opt('keep', 0.22)), 0, 0.9);
    const rest = clamp(Number(opt('rest', 0.36)));
    const ignite = String(opt('ignite', 'right')) === 'left' ? [0, 1] : [1, 1];

    root.classList.add('pb');
    let dead = false;
    const off = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    const canvas = document.createElement('canvas');
    canvas.className = 'pb-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    let gl = null, S = null, P = null, tex = {}, bufs = {}, api, worker = null, job = 0;
    let font = { style: 'normal', weight: '400', family: 'cursive' };
    let paperRGB = [0.97, 0.94, 0.87], inkRGB = [0.165, 0.114, 0.078];
    let L = null, ready = false;
    let visible = false, raf = 0, last = 0;
    let T = 0, target = 0, heat = 0, clock = 0, lastScroll = -1e9, prevTe = null;
    const parts = [];
    const MAXP = 420;
    const pbuf = new Float32Array(MAXP * 8);
    const R = rng(seed * 7 + 1);

    // ---- layout -------------------------------------------------------------------
    function paragraphs() {
        return [...letter.querySelectorAll('p')].map((p) => {
            const c = p.className;
            const kind = /pb-date/.test(c) ? 'date' : /pb-greet/.test(c) ? 'greet' : /pb-close/.test(c) ? 'close' : /pb-sign/.test(c) ? 'sign' : 'body';
            return { kind, text: p.textContent.replace(/\s+/g, ' ').trim() };
        }).filter((p) => p.text);
    }
    const spec = (s) => `${font.style} ${font.weight} ${s}px ${font.family}`;

    function setLetter(paras, size, width) {
        const lead = size * leading;
        const lines = [];
        let y = 0, prevKind = null;
        for (const pa of paras) {
            const gap = prevKind === null ? 0 : pa.kind === 'greet' ? 0.7 : pa.kind === 'close' ? 0.55 : pa.kind === 'sign' ? 0 : pa.kind === 'body' && prevKind === 'greet' ? 0.15 : 0.12;
            y += gap * lead;
            let cur = { segmentIndex: 0, graphemeIndex: 0 }, first = true;
            const left = pa.kind === 'close' ? 0.34 * width : pa.kind === 'sign' ? 0.56 * width : 0;
            for (;;) {
                const ind = pa.kind === 'body' && first ? 2.2 * size : 0;
                const mw = width - left - ind;
                const ln = api.layoutNextLine(pa.P, cur, (mw * REF) / size);
                if (!ln) break;
                const w = (ln.width * size) / REF;
                const x = pa.kind === 'date' ? width - w : left + ind;
                lines.push({ text: ln.text.trim(), x, y, kind: pa.kind });
                cur = ln.end; y += lead; first = false;
            }
            prevKind = pa.kind;
        }
        return { lines, h: y - lead + size * 0.5 };
    }

    function geometry() {
        const vw = stage.clientWidth || innerWidth;
        const vh = innerHeight;
        const phone = vw < 640;
        const my = phone ? Math.max(20, vh * 0.05) : Math.max(36, vh * 0.065);
        const mx = phone ? 16 : 40;
        let W = Math.min(vw - 2 * mx, (vh - 2 * my) / aspect, 640);
        let H = W * aspect;
        if (phone) { H = Math.min(vh - 2 * my, W * Math.max(aspect, 1.5)); }
        W = Math.round(W); H = Math.round(H);
        return { vw, vh, W, H, x: Math.round((vw - W) / 2), y: Math.round((vh - H) / 2), phone };
    }

    function layout() {
        const g = geometry();
        const paras = paragraphs();
        paras.forEach((p) => { p.P = api.prepareWithSegments(p.text, spec(REF)); });
        const padX = Math.round(g.W * 0.095), padT = Math.round(g.W * 0.1), padB = Math.round(g.W * 0.09);
        const tw = g.W - 2 * padX, th = g.H - padT - padB;
        let lo = 5, hi = 30;
        for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (setLetter(paras, m, tw).h <= th) lo = m; else hi = m; }
        const size = Math.floor(lo * 8) / 8;
        const set = setLetter(paras, size, tw);
        const dpr = Math.min(2, devicePixelRatio || 1);
        const top = padT + (th - set.h) * 0.35;
        L = { ...g, size, padX, top, lines: set.lines, dpr, paras };
    }

    // the letter, written, into the ink canvas (alpha = ink)
    function writeInk() {
        const { W, H, dpr, size } = L;
        const c = document.createElement('canvas');
        c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
        const x = c.getContext('2d');
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.font = spec(size);
        x.textBaseline = 'alphabetic';
        x.fillStyle = '#fff';
        const r = rng(seed * 13 + 5);
        const space = x.measureText(' ').width;
        let sinceDip = 0, dipAt = 6 + ((r() * 6) | 0);
        let drift = 0;
        for (const ln of L.lines) {
            drift = drift * 0.6 + (r() - 0.5) * 0.12 * size;
            const base = L.top + ln.y + size;
            const ang = (r() - 0.62) * 0.012;
            x.save();
            x.translate(L.padX + ln.x, base + drift);
            x.rotate(ang);
            let wx = 0;
            for (const w of ln.text.split(' ').filter(Boolean)) {
                // the pen dipped, then running drier word by word
                if (sinceDip >= dipAt) { sinceDip = 0; dipAt = 5 + ((r() * 7) | 0); }
                x.globalAlpha = 0.97 - 0.3 * (sinceDip / 11) - r() * 0.04;
                sinceDip++;
                x.fillText(w, wx, (r() - 0.5) * 0.07 * size);
                wx += x.measureText(w).width + space * (0.92 + r() * 0.2);
            }
            x.restore();
        }
        return c;
    }

    // ---- GL ----------------------------------------------------------------------
    function texture(name, unit, w, h, ifmt, fmt, type, data, filter, wrap) {
        if (!tex[name]) tex[name] = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex[name]);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        if (data instanceof HTMLCanvasElement) gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, fmt, type, data);
        else gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap || gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap || gl.CLAMP_TO_EDGE);
    }

    function initGL() {
        gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
        if (!gl) throw new Error('no webgl2');
        S = program(gl, SHEET_VS, SHEET_FS);
        P = program(gl, PART_VS, PART_FS);
        bufs.quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        bufs.parts = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.parts);
        gl.bufferData(gl.ARRAY_BUFFER, pbuf.byteLength, gl.DYNAMIC_DRAW);
        bufs.vaoS = gl.createVertexArray();
        gl.bindVertexArray(bufs.vaoS);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.quad);
        const la = gl.getAttribLocation(S.p, 'a');
        gl.enableVertexAttribArray(la);
        gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
        bufs.vaoP = gl.createVertexArray();
        gl.bindVertexArray(bufs.vaoP);
        gl.bindBuffer(gl.ARRAY_BUFFER, bufs.parts);
        const lA = gl.getAttribLocation(P.p, 'aA'), lB = gl.getAttribLocation(P.p, 'aB');
        gl.enableVertexAttribArray(lA); gl.vertexAttribPointer(lA, 4, gl.FLOAT, false, 32, 0);
        gl.enableVertexAttribArray(lB); gl.vertexAttribPointer(lB, 4, gl.FLOAT, false, 32, 16);
        gl.bindVertexArray(null);
        const nz = new Uint8Array(256 * 256 * 4), r = rng(seed * 31 + 3);
        for (let i = 0; i < nz.length; i++) nz[i] = (r() * 256) | 0;
        texture('noise', 4, 256, 256, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, nz, gl.LINEAR, gl.REPEAT);
        gl.useProgram(S.p);
        ['uT', 'uTV', 'uInk', 'uCells', 'uNoise'].forEach((k, i) => gl.uniform1i(S.U[k], i));
        gl.useProgram(P.p);
        gl.uniform1i(P.U.uNoise, 4);
    }

    // ---- the field ------------------------------------------------------------------
    let F = null;   // { T, gw, gh, cell, Tend, cells, lifts, embers }
    function compute() {
        layout();
        const inkC = writeInk();
        const W = L.W, H = L.H;
        const cell = Math.max(1.4, W / 330);
        const gw = Math.ceil(W / cell) + 1, gh = Math.ceil(H / cell) + 1;
        // ink coverage per grid node
        const sm = document.createElement('canvas');
        sm.width = gw; sm.height = gh;
        const sx = sm.getContext('2d', { willReadFrequently: true });
        sx.imageSmoothingQuality = 'high';
        sx.drawImage(inkC, 0, 0, gw, gh);
        const d = sx.getImageData(0, 0, gw, gh).data;
        const ink = new Uint8Array(gw * gh);
        for (let i = 0; i < ink.length; i++) ink[i] = d[i * 4 + 3];
        const fib = -1.33 + (rng(seed)() - 0.5) * 0.3;
        const payload = { gw, gh, cell, W, H, ink, seed, fib, keep: 1 - keep, ignite };
        const id = ++job;
        const geo = { ...L, cell, gw, gh, fib, inkC };
        const done = (r) => { if (!dead && id === job) upload(geo, r); };
        try {
            if (!worker) worker = makeWorker();
            worker.onmessage = (e) => done(e.data);
            worker.onerror = () => { worker = null; done(burnKernel().compute(payload)); };
            worker.postMessage(payload, [ink.buffer]);
        } catch (e) {
            worker = null;
            setTimeout(() => done(burnKernel().compute(payload)), 0);
        }
    }

    function upload(geo, r) {
        L = geo;
        const { W, H, gw, gh, cell, dpr } = geo;
        canvas.width = Math.round(geo.vw * dpr);
        canvas.height = Math.round(geo.vh * dpr);
        texture('T', 0, gw, gh, gl.R32F, gl.RED, gl.FLOAT, r.T, gl.NEAREST);
        const tv = new Float32Array(gw * gh * 4);
        for (let i = 0; i < gw * gh; i++) { tv[i * 4] = r.T[i]; tv[i * 4 + 1] = r.G[i]; tv[i * 4 + 2] = r.Ts[i]; }
        texture('TV', 1, gw, gh, gl.RGBA16F, gl.RGBA, gl.FLOAT, tv, gl.LINEAR);
        texture('ink', 2, 0, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, geo.inkC, gl.LINEAR);
        // the plates the char cracks into, and the flakes the ash leaves as
        const flake = W / 85;
        const nx = Math.ceil(W / flake) + 3, ny = Math.ceil(H / flake) + 3;
        const cd = new Uint8Array(nx * ny * 4), rr = rng(seed * 17 + 9);
        for (let i = 0; i < nx * ny; i++) {
            cd[i * 4] = 30 + ((rr() * 196) | 0); cd[i * 4 + 1] = 30 + ((rr() * 196) | 0);
            cd[i * 4 + 2] = (rr() * 256) | 0; cd[i * 4 + 3] = (rr() * 256) | 0;
        }
        texture('cells', 3, nx, ny, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cd, gl.NEAREST);
        const Tg = r.T;
        const Tat = (x, y) => {
            const gx = clamp(x / cell, 0, gw - 1.0001), gy = clamp(y / cell, 0, gh - 1.0001);
            const i = gx | 0, j = gy | 0, fx = gx - i, fy = gy - j, k = j * gw + i;
            return mix(mix(Tg[k], Tg[k + 1], fx), mix(Tg[k + gw], Tg[k + gw + 1], fx), fy);
        };
        const band = bands(W, r.Tend);
        const lifts = [];
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const k = (j * nx + i) * 4;
            const x = (i + cd[k] / 255 - 1) * flake, y = (j + cd[k + 1] / 255 - 1) * flake;
            if (x < 0 || y < 0 || x > W || y > H) continue;
            lifts.push({ x, y, at: Tat(x, y) + band[2] + band[3] + (cd[k + 2] / 255) * band[4], s: cd[k + 3] / 255 });
        }
        lifts.sort((a, b) => a.at - b.at);
        const embers = [];
        for (let j = 0; j < gh; j += 2) for (let i = 0; i < gw; i += 2) embers.push(Tg[j * gw + i], i * cell, j * cell);
        const idx = [...Array(embers.length / 3).keys()].sort((a, b) => embers[a * 3] - embers[b * 3]);
        const E = new Float32Array(embers.length);
        idx.forEach((v, n) => { E[n * 3] = embers[v * 3]; E[n * 3 + 1] = embers[v * 3 + 1]; E[n * 3 + 2] = embers[v * 3 + 2]; });
        F = { Tend: r.Tend, flake, nx, ny, lifts, embers: E, band };
        gl.useProgram(S.p);
        gl.uniform2f(S.U.uSheet, W, H);
        gl.uniform2f(S.U.uGrid, gw, gh);
        gl.uniform1f(S.U.uCell, cell);
        gl.uniform2f(S.U.uCellsN, nx, ny);
        gl.uniform1f(S.U.uFlake, flake);
        gl.uniform2f(S.U.uFibre, Math.cos(geo.fib), Math.sin(geo.fib));
        gl.uniform4f(S.U.uBand, band[0], band[1], band[2], band[3]);
        gl.uniform1f(S.U.uAj, band[4]);
        gl.uniform1f(S.U.uDpr, dpr);
        gl.uniform3f(S.U.uPaper, ...paperRGB);
        gl.uniform3f(S.U.uInkC, ...inkRGB);
        ready = true;
        root.classList.add('is-live');
        T = target = timeAt(progress());
        prevTe = null;
        draw();
    }

    // scorch (px), ember (px), char (t), ash (t), lift jitter (t)
    const bands = (W, Tend) => [Math.max(10, W * 0.042), clamp(W * 0.0068, 2.2, 4.2), 0.15 * Tend, 0.035 * Tend, 0.022 * Tend];

    // ---- time ------------------------------------------------------------------------
    function progress() {
        if (calm.matches) return -1;
        const r = root.getBoundingClientRect();
        const run = r.height - innerHeight;
        if (run <= 0) return -1;
        return clamp(-r.top / run);
    }
    // scroll progress -> t. The fire starts a little way in, slows near the
    // end and goes out, leaving the corner with the greeting.
    function timeAt(p) {
        if (!F) return 0;
        if (p < 0) return F.Tend * rest;
        const x = clamp((p - 0.05) / 0.8);
        return mix(-0.02, F.Tend, 1 - Math.pow(1 - x, 1.45));
    }
    function liveAt(p) { return p < 0 ? 1 : 1 - ss(0.84, 0.96, p); }

    // ---- particles -----------------------------------------------------------------
    function spawnFromEmbers(kind, te) {
        const E = F.embers, n = E.length / 3;
        let lo = 0, hi = n;
        const a = te - 0.006;
        while (lo < hi) { const m = (lo + hi) >> 1; if (E[m * 3] < a) lo = m + 1; else hi = m; }
        let end = lo;
        while (end < n && E[end * 3] <= te) end++;
        if (end <= lo) return;
        const k = lo + ((R() * (end - lo)) | 0);
        const x = L.x + E[k * 3 + 1], y = L.y + E[k * 3 + 2];
        if (kind === 1) parts.push({ kind, x, y, vx: (R() - 0.5) * 6, vy: -(10 + R() * 12), size: 16 + R() * 10, grow: 40 + R() * 30, rot: R() * 6, vr: (R() - 0.5) * 0.5, flip: 0, vf: 0, seed: R(), age: 0, life: 4.5 + R() * 2.5, a0: 0.34 + R() * 0.16 });
        else parts.push({ kind, x, y, vx: (R() - 0.5) * 18, vy: -(28 + R() * 40), size: 2.6 + R() * 1.6, grow: 0, rot: 0, vr: 0, flip: 0, vf: 0, seed: R(), age: 0, life: 0.5 + R() * 0.7, a0: 1 });
    }
    function spawnFlake(c) {
        parts.push({ kind: 0, x: L.x + c.x, y: L.y + c.y, vx: (R() - 0.5) * 10, vy: -(6 + R() * 12), size: F.flake * (1.4 + c.s * 0.6), grow: -F.flake * 0.6, rot: R() * 6.28, vr: (R() - 0.5) * 2.2, flip: 0, vf: (R() < 0.5 ? -1 : 1) * (1 + R() * 3), seed: c.s, age: 0, life: 2.6 + R() * 2.4, a0: 1 });
    }
    function stepParts(dt) {
        for (let i = parts.length - 1; i >= 0; i--) {
            const q = parts[i];
            q.age += dt;
            if (q.age > q.life || q.y < -120) { parts.splice(i, 1); continue; }
            const s = q.seed * 40;
            if (q.kind === 0) {
                q.vy += -9 * dt; q.vx += Math.sin(q.age * 2.3 + s) * 16 * dt;
                q.vx *= Math.exp(-dt * 0.8); q.vy *= Math.exp(-dt * 0.5);
            } else if (q.kind === 1) {
                q.vy += -2 * dt; q.vx += Math.sin(q.age * 0.9 + s) * 5 * dt;
            } else {
                q.vy *= Math.exp(-dt * 1.4); q.vx += Math.sin(q.age * 9 + s) * 30 * dt;
            }
            q.x += q.vx * dt; q.y += q.vy * dt;
            q.rot += q.vr * dt; q.flip += q.vf * dt;
        }
    }
    function packParts() {
        let n = 0;
        for (const kind of [1, 0, 2]) {
            for (const q of parts) {
                if (q.kind !== kind || n >= MAXP) continue;
                const k = q.age / q.life;
                let a = q.a0;
                if (kind === 1) a *= ss(0, 0.12, k) * (1 - ss(0.35, 1, k));
                else if (kind === 0) a *= 1 - ss(0.55, 1, k);
                else a *= 1 - k;
                const o = n * 8;
                pbuf[o] = q.x; pbuf[o + 1] = q.y; pbuf[o + 2] = Math.max(1, q.size + q.grow * k); pbuf[o + 3] = a;
                pbuf[o + 4] = kind; pbuf[o + 5] = q.rot; pbuf[o + 6] = q.flip; pbuf[o + 7] = q.seed;
                n++;
            }
        }
        return n;
    }

    // ---- draw ------------------------------------------------------------------------
    let live = 1;
    function draw() {
        if (!gl || !ready) return;
        const Te = Math.min(T, F.Tend);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(S.p);
        gl.bindVertexArray(bufs.vaoS);
        ['T', 'TV', 'ink', 'cells', 'noise'].forEach((k, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[k]); });
        gl.uniform4f(S.U.uRect, L.x, L.y, L.W, L.H);
        gl.uniform1f(S.U.uMarg, 14);
        gl.uniform2f(S.U.uCanvas, L.vw, L.vh);
        gl.uniform1f(S.U.uT0, Te);
        gl.uniform1f(S.U.uLive, T > 0 ? live : 0);
        gl.uniform1f(S.U.uHeat, heat);
        gl.uniform1f(S.U.uTime, clock);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        const n = packParts();
        if (n) {
            gl.useProgram(P.p);
            gl.bindVertexArray(bufs.vaoP);
            gl.bindBuffer(gl.ARRAY_BUFFER, bufs.parts);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, pbuf, 0, n * 8);
            gl.uniform2f(P.U.uCanvas, L.vw, L.vh);
            gl.uniform1f(P.U.uDpr, L.dpr);
            gl.drawArrays(gl.POINTS, 0, n);
        }
        gl.bindVertexArray(null);
    }

    function frame(now) {
        raf = 0;
        if (dead || !ready) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const still = calm.matches;
        const p = progress();
        target = timeAt(p);
        live = liveAt(p);
        const before = Math.min(T, F.Tend);
        T += (target - T) * (still ? 1 : 1 - Math.exp(-dt / 0.12));
        if (Math.abs(target - T) < 1e-5) T = target;
        const Te = Math.min(T, F.Tend);
        const moving = Math.abs(target - T) > 1e-5 || now - lastScroll < 150;
        if (still) heat = 0.6;
        else heat += ((moving ? 1 : 0) - heat) * (1 - Math.exp(-dt / (moving ? 0.25 : 1.5)));
        clock += dt * heat;
        const burning = T > 0 && T < F.Tend + 0.02 && live > 0.01;
        if (!still) {
            // flakes leave exactly as their holes open (forward only)
            if (prevTe !== null && Te > prevTe) {
                let made = 0;
                for (const c of F.lifts) {
                    if (c.at > Te) break;
                    if (c.at <= prevTe) continue;
                    if (made < 16 && parts.length < MAXP && R() < 0.45) { spawnFlake(c); made++; }
                }
            }
            if (burning && visible) {
                const g = heat * live;
                if (R() < dt * 14 * g && parts.length < MAXP) spawnFromEmbers(1, Te);
                if (R() < dt * 1.4 * g * (moving ? 1 : 0.3) && parts.length < MAXP) spawnFromEmbers(2, Te);
            }
            stepParts(dt);
        }
        prevTe = Te;
        draw();
        const alive = !still && (Math.abs(target - T) > 1e-5 || parts.length > 0 || (burning && heat > 0.01));
        if (alive && visible && !document.hidden) raf = requestAnimationFrame(frame);
        else { last = 0; if (heat <= 0.01) heat = 0; }
    }
    const kick = () => { if (!raf && !dead && ready && visible) raf = requestAnimationFrame(frame); };

    on(window, 'scroll', () => { lastScroll = performance.now(); kick(); }, { passive: true });
    on(document, 'visibilitychange', kick);

    // ---- start -----------------------------------------------------------------------
    (async () => {
        try {
            const cs = getComputedStyle(letter);
            font = { style: cs.fontStyle, weight: opt('weight', cs.fontWeight), family: opt('font', cs.fontFamily) };
            const rs = getComputedStyle(root);
            paperRGB = colour(rs.getPropertyValue('--pb-sheet').trim(), '#f7f0df');
            inkRGB = colour(rs.getPropertyValue('--pb-ink').trim(), '#2a1d14');
            api = await import(LIB);
            try { await document.fonts.load(`${font.style} ${font.weight} 30px ${font.family}`, 'Dear'); await document.fonts.ready; } catch (e) { /* measure what we have */ }
            if (dead) return;
            stage.insertBefore(canvas, stage.firstChild);
            initGL();
            compute();
        } catch (e) {
            canvas.remove();
            root.classList.remove('is-live');
            return;
        }
        const io = new IntersectionObserver((en) => {
            for (const e of en) visible = e.isIntersecting;
            if (visible) kick();
        });
        io.observe(root);
        off.push(() => io.disconnect());
        on(calm, 'change', () => { T = target = timeAt(progress()); parts.length = 0; draw(); kick(); });
        let timer = 0, lastW = stage.clientWidth, lastH = innerHeight;
        const ro = new ResizeObserver(() => {
            const w = stage.clientWidth, h = innerHeight;
            if (w === lastW && Math.abs(h - lastH) < 120) return;
            lastW = w; lastH = h;
            clearTimeout(timer);
            timer = setTimeout(() => { if (!dead) { parts.length = 0; compute(); } }, 160);
        });
        ro.observe(stage);
        off.push(() => { ro.disconnect(); clearTimeout(timer); });
    })();

    function destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        off.forEach((f) => f());
        if (worker) worker.terminate();
        if (gl) {
            Object.values(tex).forEach((t) => gl.deleteTexture(t));
            [bufs.quad, bufs.parts].forEach((b) => b && gl.deleteBuffer(b));
            [bufs.vaoS, bufs.vaoP].forEach((v) => v && gl.deleteVertexArray(v));
            if (S) gl.deleteProgram(S.p);
            if (P) gl.deleteProgram(P.p);
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
        canvas.remove();
        root.classList.remove('pb', 'is-live');
    }
    // for testing: jump the scroll-free state (t as a fraction of the burn)
    destroy.debug = () => ({ T, target, heat, live, parts: parts.length, kinds: [0, 1, 2].map((k) => parts.filter((q) => q.kind === k).length), Tend: F && F.Tend, size: L && L.size, raf: !!raf });
    return destroy;
}

// Auto-start every [data-pretext-burn] once it is near the viewport.
document.querySelectorAll('[data-pretext-burn]').forEach((el) => {
    const go = () => { el.pretextBurn = pretextBurn(el); };
    if (!('IntersectionObserver' in window)) { go(); return; }
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        go();
    }, { rootMargin: '800px' });
    io.observe(el);
});
