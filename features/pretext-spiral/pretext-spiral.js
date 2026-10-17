/*
 *  PRETEXT-SPIRAL // a paragraph wound onto a clay disc.
 *
 *  Markup:  <section data-pretext-spiral data-src="assets/clay.webp">
 *             <div class="ps-stage">
 *               <p class="ps-text">The paragraph.</p>
 *             </div>
 *           </section>
 *  Or call pretextSpiral(section, options) yourself; it returns destroy().
 *
 *  Like the Phaistos Disc: the text is stamped into a disc of fired clay
 *  along an Archimedean spiral, from the rim inward (or from the centre out),
 *  each phrase closed by a small stamped tick and the turns parted by an
 *  incised spiral groove. Every turn of the spiral is one "line":
 *  pretext's layoutNextLineRange breaks the paragraph with maxWidth = the arc
 *  length of that turn, and the words are then letter-spaced so the turn is
 *  filled exactly, end to end. Each glyph is set along the curve, rotated to
 *  the tangent, its top toward the rim.
 *
 *  The disc is lit, not painted. The glyphs, grooves, a rounded rim and the
 *  clay's grain are baked once into a height map; a fragment shader turns
 *  it every frame, takes the slope as a normal and lights it from a fixed
 *  lamp at the top left, with the impressions casting short shadows into
 *  themselves (a few steps marched toward the light). Because the light
 *  stays put while the disc turns, the shadow is always on the far wall of
 *  each letter, as it is when you turn a real tablet in your hand.
 *
 *  Drag to turn it (it keeps its momentum and comes to rest with a word
 *  centred under the mark), scroll and it turns with the page, or use the
 *  arrow keys. A fine needle at twelve o'clock rides the groove above the
 *  turn being read; the word passing under it fills with ink, and the words
 *  already read keep a little of it. A line beneath the disc shows the same
 *  passage set flat, sliding as the disc turns.
 *
 *  Options (data attributes, or the options object, which wins):
 *    data-src="…"            the material: a square photo whose inscribed
 *                            circle is the disc's face (same origin).
 *    data-material="clay"    clay | bronze  (bronze: metal, more gloss)
 *    data-from="rim"         rim | centre   where the text begins
 *    data-scroll="pin"       pin: a pinned runway, scrolling turns it.
 *                            flow: it turns as the page goes by. none.
 *    data-trail="0.5"        ink left in the words already read (0..1)
 *    data-reader="true"      the flat line of text beneath the disc
 *    data-font, data-weight  canvas-only type (defaults: the <p>'s own)
 *    data-dividers="phrases" phrases | words   where the stamped ticks go
 *    data-lead="1.22"        turn pitch, as a multiple of the type size
 *    data-label="…"          accessible name of the disc
 *  A <p class="ps-legend"> in the stage is set round the edge as a coin's
 *  legend, and the spiral fills the field inside it.
 *
 *  The real <p> stays in the DOM (screen readers, find, no-JS). Without
 *  WebGL it is simply the paragraph. Reduced motion: no runway, nothing
 *  turns by itself; dragging and keys still work and stop dead.
 */

const LIB = './vendor/pretext/layout.js';
const REF = 100;                 // pretext measures once at 100px; widths scale
const TAU = Math.PI * 2;
const M = 0.13;                  // canvas margin round the disc, x radius (shadow, needle)

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;

const MATERIALS = {
    //         spec   shine  metal  ambient  glyph depth (x size)  rim height (x R)
    clay:   { spec: 0.05, shine: 14, metal: 0, amb: 0.36, depth: 0.15, rim: 0.03, micro: 1.4, ink: [0.085, 0.07, 0.06] },
    bronze: { spec: 0.42, shine: 22, metal: 1, amb: 0.34, depth: 0.13, rim: 0.022, micro: 1.0, ink: [0.07, 0.06, 0.05] },
};

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uAlb;     // the face, premultiplied, alpha = the disc
uniform sampler2D uRel;     // r glyphs, g grooves and marks, b rim (blurred disc), a grain
uniform vec2 uRes;          // canvas, device px (= texture size)
uniform float uRot;         // disc rotation, clockwise
uniform float uR;           // disc radius, device px
uniform vec4 uDepth;        // glyph depth, mark depth, rim height, grain height (device px)
uniform vec3 uSp;           // spiral centreline r(t) = a + dir * b * t: a, b, dir
uniform vec4 uInk[4];       // words being inked: t from, t to, amount
uniform vec3 uTrail;        // t from, t to, amount: ink left in the words read
uniform vec3 uInkCol;
uniform vec4 uMat;          // spec, shine, metal, ambient
uniform vec4 uNeedle;       // pointer top y, pointer end y (above the rim), tip y, tick half length (px from centre, y down)
uniform vec2 uNeedle2;      // half width, bead radius
uniform float uPx;          // device px per css px
const vec3 L = vec3(-0.5345, -0.6236, 0.5701);     // the lamp: top left, 35 degrees up

float H(vec4 v) {
    float e = clamp((v.b - 0.5) * 2.0, 0.0, 1.0);
    float rim = 1.0 - (1.0 - e) * (1.0 - e) * (1.0 - e);
    return uDepth.z * rim - uDepth.x * v.r - uDepth.y * v.g + uDepth.w * (v.a - 0.5);
}

void main() {
    vec2 s = vec2(gl_FragCoord.x - uRes.x * 0.5, uRes.y * 0.5 - gl_FragCoord.y);
    float c = cos(uRot), sn = sin(uRot);
    vec2 l = vec2(c * s.x + sn * s.y, -sn * s.x + c * s.y);
    vec2 uv = l / uRes + 0.5;
    vec2 px = 1.0 / uRes;
    vec4 A = texture2D(uAlb, uv);
    vec4 o = vec4(0.0);

    // the disc's shadow on the paper: a close contact shadow and a wide soft one
    float d1 = length(s - vec2(0.012, 0.022) * uR);
    float d2 = length(s - vec2(0.045, 0.075) * uR);
    float sh = 0.30 * (1.0 - smoothstep(uR * 0.975, uR * 1.03, d1))
             + 0.16 * (1.0 - smoothstep(uR * 0.90, uR * 1.16, d2));

    if (A.a > 0.003) {
        vec3 alb = A.rgb / A.a;
        vec4 v = texture2D(uRel, uv);
        float h0 = H(v);
        float hx = H(texture2D(uRel, uv + vec2(px.x, 0.0))) - H(texture2D(uRel, uv - vec2(px.x, 0.0)));
        float hy = H(texture2D(uRel, uv + vec2(0.0, px.y))) - H(texture2D(uRel, uv - vec2(0.0, px.y)));
        vec2 gL = vec2(hx, hy) * 0.5;
        vec2 g = vec2(c * gL.x - sn * gL.y, sn * gL.x + c * gL.y);
        vec3 n = normalize(vec3(-g, 1.0));

        // ink: which turn of the spiral this pixel sits on, so where along the text
        float th = atan(l.x, -l.y);
        if (th < 0.0) th += 6.2831853;
        float r = length(l);
        float k = floor((uSp.z * (r - uSp.x) / uSp.y - th) / 6.2831853 + 0.5);
        float t = th + 6.2831853 * k;
        float ink = (t >= uTrail.x && t < uTrail.y) ? uTrail.z : 0.0;
        for (int i = 0; i < 4; i++) {
            if (t >= uInk[i].x && t < uInk[i].y) ink = max(ink, uInk[i].z);
        }
        float glyph = smoothstep(0.08, 0.55, v.r);
        alb = mix(alb, uInkCol, ink * glyph * 0.94);

        // shadows cast into the impressions: march toward the lamp
        vec2 Ll = normalize(vec2(c * L.x + sn * L.y, -sn * L.x + c * L.y));
        float tanE = L.z / length(L.xy);
        float occ = 0.0;
        float stp = max(0.75, uDepth.x * 0.3);
        for (int i = 1; i <= 8; i++) {
            float d = float(i) * stp;
            float hi = H(texture2D(uRel, uv + Ll * d * px));
            occ = max(occ, hi - h0 - d * tanE);
        }
        float shade = smoothstep(0.0, uDepth.x * 0.5 + 0.5, occ);

        float diff = max(dot(n, L), 0.0) / L.z;
        float lit = uMat.w + (1.0 - uMat.w) * diff;
        float cav = 1.0 - 0.30 * v.r - 0.24 * v.g;
        vec3 col = alb * lit * cav * (1.0 - 0.58 * shade);
        vec3 hv = normalize(L + vec3(0.0, 0.0, 1.0));
        float sp = pow(max(dot(n, hv), 0.0), uMat.y) * uMat.x * (1.0 - shade) * (1.0 - 0.6 * ink * glyph);
        col += sp * mix(vec3(1.0, 0.96, 0.9), alb * 1.6 + 0.15, uMat.z);
        o = vec4(col * A.a, A.a);
    }
    o += vec4(vec3(0.16, 0.11, 0.07) * sh, sh) * (1.0 - o.a);

    // the reading needle: a hairline down from above the rim to a bead in the
    // groove of the turn being read, standing a little above the surface
    float hw = uNeedle2.x, br = uNeedle2.y, tip = uNeedle.z, ht = uNeedle.w;
    // a short pointer on the paper above the rim, and a short tick with a bead
    // riding the groove of the turn being read: never a line across the face
    float in1 = smoothstep(uNeedle.x - 1.0, uNeedle.x + 6.0 * uPx, s.y) * (1.0 - smoothstep(uNeedle.y - 1.0, uNeedle.y + 1.0, s.y));
    float in2 = smoothstep(tip - ht - 1.0, tip - ht + 1.0, s.y) * (1.0 - smoothstep(tip + ht - 1.0, tip + ht + 1.0, s.y));
    float line = clamp(hw + 0.5 - abs(s.x), 0.0, 1.0) * max(in1, in2);
    float bead = clamp(br + 0.5 - length(s - vec2(0.0, tip)), 0.0, 1.0);
    vec2 so = s - vec2(2.2, 3.0) * uPx;
    float sIn1 = smoothstep(uNeedle.x, uNeedle.x + 10.0 * uPx, so.y) * (1.0 - smoothstep(uNeedle.y - 2.0 * uPx, uNeedle.y + 2.0 * uPx, so.y));
    float sIn2 = smoothstep(tip - ht - 2.0 * uPx, tip - ht + 2.0 * uPx, so.y) * (1.0 - smoothstep(tip + ht - 2.0 * uPx, tip + ht + 2.0 * uPx, so.y));
    float nsh = 0.22 * (1.0 - smoothstep(0.0, hw + 2.2 * uPx, abs(so.x))) * max(sIn1, sIn2);
    nsh = max(nsh, 0.26 * (1.0 - smoothstep(br * 0.6, br + 2.6 * uPx, length(so - vec2(0.0, tip)))));
    o = vec4(vec3(0.12, 0.08, 0.05) * nsh, nsh) + o * (1.0 - nsh);
    float nd = max(line, bead);
    o = vec4(vec3(0.078, 0.074, 0.07) * nd, nd) + o * (1.0 - nd);
    gl_FragColor = o;
}`;

function loadImage(src) {
    return new Promise((ok, no) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => ok(im);
        im.onerror = no;
        im.src = src;
    });
}

// A small seeded random, so the disc's outline is the same on every visit.
function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Blur a canvas: the filter where the browser has it, else a few halvings and
// back (bilinear smoothing does the work).
function blurred(src, radius) {
    const out = document.createElement('canvas');
    out.width = src.width; out.height = src.height;
    const x = out.getContext('2d');
    if ('filter' in x) {
        x.filter = `blur(${radius}px)`;
        x.drawImage(src, 0, 0);
        x.filter = 'none';
        if (x.getImageData(out.width >> 1, out.height >> 1, 1, 1).data[3] > 0) return out;
        x.clearRect(0, 0, out.width, out.height);
    }
    let c = src, w = src.width, h = src.height;
    const steps = Math.max(1, Math.round(Math.log2(Math.max(2, radius))));
    for (let i = 0; i < steps; i++) {
        const d = document.createElement('canvas');
        w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
        d.width = w; d.height = h;
        const dx = d.getContext('2d');
        dx.imageSmoothingQuality = 'high';
        dx.drawImage(c, 0, 0, w, h);
        c = d;
    }
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, out.width, out.height);
    return out;
}

export function pretextSpiral(root, opts = {}) {
    const stage = root && (root.querySelector('.ps-stage') || root);
    const src = root && root.querySelector('.ps-text');
    const legendEl = root && root.querySelector('.ps-legend');
    const url = opts.src ?? (root && root.dataset.src);
    if (!root || !src || !url) return () => {};

    const ds = root.dataset;
    const mat = MATERIALS[opts.material ?? ds.material] || MATERIALS.clay;
    const fromCentre = /^cent/.test(String(opts.from ?? ds.from ?? 'rim'));
    const dir = fromCentre ? 1 : -1;
    const scrollMode = ['pin', 'flow', 'none'].includes(opts.scroll ?? ds.scroll) ? (opts.scroll ?? ds.scroll) : 'pin';
    const trail = clamp(Number(opts.trail ?? ds.trail ?? 0.5));
    const wantReader = String(opts.reader ?? ds.reader ?? 'true') !== 'false';
    const weightOpt = opts.weight ?? ds.weight ?? null;
    const familyOpt = opts.font ?? ds.font ?? null;
    const LEAD = Number(opts.lead ?? ds.lead ?? 1.22) || 1.22;
    const dividers = (opts.dividers ?? ds.dividers ?? 'phrases') === 'words' ? 'words' : 'phrases';
    // Where a word ends a phrase (or always, with data-dividers="words") it is
    // closed by a stamped tick and a wider gap; inside a phrase, a plain space.
    const PHRASE = /[.,;:!?\u2014\u2013)\]"\u201d\u2019']$/;
    const ticked = (w) => dividers === 'words' || PHRASE.test(w);
    const gapOf = (w, s) => s * (ticked(w) ? 0.82 : 0.34);
    const label = opts.label ?? ds.label ?? 'Inscribed disc. Turn it to read: arrow keys move a word at a time.';
    root.classList.add('ps', 'ps-' + scrollMode);

    let dead = false;
    const off = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    // DOM: the disc (focusable, a slider over the words), its canvas, and
    // the flat reading line beneath.
    const disc = document.createElement('div');
    disc.className = 'ps-disc';
    disc.tabIndex = 0;
    disc.setAttribute('role', 'slider');
    disc.setAttribute('aria-label', label);
    disc.setAttribute('aria-orientation', 'horizontal');
    const canvas = document.createElement('canvas');
    canvas.className = 'ps-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    disc.appendChild(canvas);
    let reader = null, readerLine = null, readerSpans = [];

    let api, img, gl, prog, texAlb, texRel, U = {};
    let text = '', legend = '';
    let font = { style: 'normal', weight: '500', family: 'serif' };
    let inkCol = mat.ink;

    // Geometry (css px unless named): disc radius, canvas side, device scale.
    let R = 0, C = 0, T = 0, k = 1;
    let size = 12, pitch = 14, spA = 0, spB = 1;
    let words = [];             // { text, t0, t1, tc, a, b (ink range) }

    // Motion.
    const st = { phi: 0, omega: 0, target: 0, mode: 'rest' };
    let active = -1, raf = 0, last = 0, visible = false, settleTimer = 0;
    let ink = new Float32Array(0);
    let readerX = [];           // per word: [x0, x1] in the reader line, css px
    let readerW = 0;

    // ---- type ----------------------------------------------------------------
    const spec = (s) => `${font.style} ${font.weight} ${s}px ${font.family}`;
    const mctx = document.createElement('canvas').getContext('2d');
    const widthCache = new Map();
    // Width of one grapheme at REF px. Glyphs are set one by one on the curve,
    // so they are measured one by one (no kerning across a curve anyway).
    function gw(g) {
        let w = widthCache.get(g);
        if (w === undefined) { mctx.font = spec(REF); w = mctx.measureText(g).width; widthCache.set(g, w); }
        return w;
    }
    const graphemes = (w) => [...w];
    const wordW = (w, s) => graphemes(w).reduce((a, g) => a + gw(g), 0) * s / REF;

    // ---- the spiral ------------------------------------------------------------
    // Centreline of the band at parameter t (radians, clockwise from twelve):
    // r(t) = a + dir * b * t, b = pitch / 2π. Arc length along a turn from t0
    // is r0 τ + dir b τ² / 2 (the tiny radial component is ignored), which
    // inverts in closed form.
    const rAt = (t) => spA + dir * spB * t;
    const arcLen = (t0, t1) => { const r0 = rAt(t0), u = t1 - t0; return r0 * u + dir * spB * u * u / 2; };
    const tAtArc = (t0, sArc) => {
        const r0 = rAt(t0), q = dir * spB;
        if (Math.abs(q) < 1e-9) return t0 + sArc / r0;
        return t0 + (-r0 + Math.sqrt(Math.max(0, r0 * r0 + 2 * q * sArc))) / q;
    };

    // Fill the turns at type size s. Each turn is one line: pretext breaks
    // the paragraph with maxWidth = the turn's arc length (less the word
    // dividers), and the turn takes exactly the words that fit.
    let spread = 1;            // pitch stretch, so the last turn ends near the centre
    function wind(P, s, Ro, Ri) {
        const p = s * LEAD * spread, b = p / TAU, gap = s * 0.82;
        const a = fromCentre ? Ri + p / 2 : Ro - p / 2;
        const tMax = Math.max(0, fromCentre ? (Ro - p / 2 - a) / b : (a - p / 2 - Ri) / b);
        spA = a; spB = b;
        const lines = [];
        let cursor = { segmentIndex: 0, graphemeIndex: 0 };
        for (let n = 0; ; n++) {
            const t0 = TAU * n;
            if (t0 >= tMax - 0.05) return { ok: false, lines, p, gap };
            const t1 = Math.min(TAU * (n + 1), tMax);
            const arc = arcLen(t0, t1);
            let W = arc, got = null;
            for (let it = 0; it < 10; it++) {
                const range = api.layoutNextLineRange(P, cursor, (W * REF) / s);
                if (range === null) return { ok: true, lines, p, gap };
                const broke = range.end.graphemeIndex > 0;          // a word split mid-word
                const ws = api.materializeLineRange(P, range).text.trim().split(/\s+/).filter(Boolean);
                const need = ws.reduce((m, w) => m + wordW(w, s) + gapOf(w, s), 0);
                if (!broke && need <= arc) { got = { range, ws, need }; break; }
                if (ws.length <= 1) break;
                W -= Math.max(need - arc, s * 0.3) + (broke ? s : 0);
            }
            if (!got) return { ok: false, lines, p, gap };
            lines.push({ n, t0, t1, arc, ws: got.ws, need: got.need, full: t1 >= TAU * (n + 1) - 1e-6 });
            cursor = got.range.end;
        }
    }

    // ---- layout ------------------------------------------------------------------
    let geo = null;
    function layout() {
        const box = disc.getBoundingClientRect();
        R = Math.max(60, box.width / 2);
        C = Math.ceil(2 * R * (1 + M));
        const maxTex = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048);
        let dpr = Math.min(3, window.devicePixelRatio || 1);
        if (C * dpr > 2048) dpr = Math.max(1, 2048 / C);
        T = Math.min(maxTex, Math.round(C * dpr));
        k = T / C;
        canvas.width = canvas.height = T;
        const inset = (C - 2 * R) / 2;
        Object.assign(canvas.style, { width: C + 'px', height: C + 'px', left: -inset + 'px', top: -inset + 'px' });

        // The bands: a coin's legend ring takes the outside; else a border of
        // punched dots. The centre keeps a rosette.
        let legendGeo = null, Ro;
        if (legend) {
            legendGeo = setLegend();
            Ro = legendGeo.inner - R * 0.03;
        } else Ro = R * 0.885;
        const Ri = R * (fromCentre ? 0.11 : 0.15);

        // Largest type whose text fits the spiral.
        const P = api.prepareWithSegments(text, spec(REF));
        spread = 1;
        let lo = 3, hi = Math.min(40, R / 6);
        for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            wind(P, mid, Ro, Ri).ok ? (lo = mid) : (hi = mid);
        }
        size = Math.floor(lo * 50) / 50;
        let res = wind(P, size, Ro, Ri);
        while (!res.ok && size > 3) { size -= 0.05; res = wind(P, size, Ro, Ri); }
        // Turns come in whole numbers, so the largest size usually leaves a
        // band empty before the centre. Open the pitch a little (up to 30%)
        // until the text reaches it: the words wind all the way in.
        let a = 1, b = 1.3;
        for (let i = 0; i < 14; i++) {
            spread = (a + b) / 2;
            wind(P, size, Ro, Ri).ok ? (a = spread) : (b = spread);
        }
        spread = a;
        res = wind(P, size, Ro, Ri);
        pitch = res.p;
        geo = { Ro, Ri, legend: legendGeo, lines: res.lines, gap: res.gap };
        place(res);
        bake();
        buildReader();
    }

    // Justify and place every glyph. Each full turn is filled exactly: the
    // slack goes to letter-spacing first (up to 0.14em), the rest to the
    // dividers. The last turn is set at its natural spacing and simply ends.
    let glyphs = [], marks = [], tickAt = 0;
    function place(res) {
        glyphs = []; marks = []; words = [];
        const s = size, p = pitch;
        mctx.font = spec(s);
        const m = mctx.measureText('Hdlbkhgjpqy');
        const asc = m.actualBoundingBoxAscent || s * 0.72, desc = m.actualBoundingBoxDescent || s * 0.24;
        const xm = mctx.measureText('xaeo');
        const xh = xm.actualBoundingBoxAscent || s * 0.45;
        // centre the x-height a touch below the band's middle, so ascenders and
        // descenders share the band evenly
        const baseOff = mix(xh / 2, (asc - desc) / 2, 0.55);
        tickAt = xh / 2 - baseOff;          // the x-height's middle, from the centreline
        const N = res.lines.length;
        res.lines.forEach((ln, li) => {
            const last = li === N - 1;
            const parts = ln.ws.map((w) => ({ w, gl: graphemes(w) }));
            parts.forEach((q) => { q.ws = q.gl.map((g) => gw(g) * s / REF); q.width = q.ws.reduce((a2, b2) => a2 + b2, 0); });
            const inner = parts.reduce((n, q) => n + q.gl.length - 1, 0);
            let slack = ln.arc - ln.need, track = 0, extra = 0;
            if (!last && ln.full) {
                track = inner ? Math.min(slack / inner, s * 0.14) : 0;
                slack -= track * inner;
                extra = slack / parts.length;
            }
            const G = parts.map((q) => gapOf(q.w, s) + extra);
            // the gap after a turn's last word straddles the seam at twelve
            let u = G[G.length - 1] / 2;
            parts.forEach((q, wi) => {
                const u0 = u;
                q.gl.forEach((g, gi) => {
                    const t = tAtArc(ln.t0, u + q.ws[gi] / 2);
                    glyphs.push({ g, t, r: rAt(t) - baseOff, w: q.ws[gi] });
                    u += q.ws[gi] + (gi < q.gl.length - 1 ? track : 0);
                });
                const u1 = u;
                words.push({ text: q.w, t0: tAtArc(ln.t0, u0), t1: tAtArc(ln.t0, u1), tc: tAtArc(ln.t0, (u0 + u1) / 2) });
                const gx = wi === parts.length - 1 ? G[wi] / 2 : G[wi];
                u += G[wi];
                const isLast = last && wi === parts.length - 1;
                if (!isLast && ticked(q.w)) marks.push({ kind: 'div', t: tAtArc(ln.t0, u1 + (wi === parts.length - 1 ? gx : G[wi] / 2)) });
            });
        });
        // Each word inks from the divider before it to the divider after it.
        words.forEach((w, i) => {
            w.a = i ? (words[i - 1].t1 + w.t0) / 2 : w.t0 - 0.5;
            w.b = i < words.length - 1 ? (w.t1 + words[i + 1].t0) / 2 : w.t1 + 0.5;
        });
        ink = new Float32Array(words.length);
        if (active >= words.length) active = words.length - 1;
    }

    // A coin's legend: one ring, the words parted by interpuncts and spaced
    // out to close the circle exactly.
    function setLegend() {
        const outer = R * 0.9;
        const one = legend.toUpperCase().split(/\s+/).filter(Boolean);
        const per = (ws) => {
            const inner = ws.reduce((n, w) => n + graphemes(w).length - 1, 0);
            const nat = ws.reduce((n, w) => n + graphemes(w).reduce((a2, g) => a2 + gw(g), 0), 0) / REF;
            return nat + inner * 0.2 + ws.length * 1.2;          // ems round the ring
        };
        // A short legend goes round more than once, as on coins, so the
        // letters keep a coin's size instead of being spread out thin.
        const circ0 = TAU * outer * 0.93;
        const copies = Math.max(1, Math.round(circ0 / (R * 0.1 * per(one))));
        const all = Array.from({ length: copies }, () => one).flat();
        const parts = all.map((w) => ({ w, gl: graphemes(w) }));
        const inner = parts.reduce((n, q) => n + q.gl.length - 1, 0);
        let sL = R * 0.08;
        for (let i = 0; i < 4; i++) sL = Math.min(R * 0.11, (TAU * (outer - sL * 0.62)) / per(all));
        const band = sL * 1.24, rMid = outer - band / 2;
        mctx.font = spec(sL);
        const capH = mctx.measureText('H').actualBoundingBoxAscent || sL * 0.66;
        const ws = parts.map((q) => q.gl.map((g) => gw(g) * sL / REF));
        const total = ws.flat().reduce((a2, b2) => a2 + b2, 0);
        const circ = TAU * rMid;
        let track = inner ? Math.min(((circ - total) - parts.length * sL * 1.2) / inner, sL * 0.45) : 0;
        track = Math.max(0, track);
        const gapX = (circ - total - track * inner) / parts.length;
        const out = { outer, inner: outer - band, size: sL, glyphs: [], dots: [] };
        let u = gapX / 2;
        parts.forEach((q, wi) => {
            q.gl.forEach((g, gi) => {
                const th = (u + ws[wi][gi] / 2) / rMid;
                out.glyphs.push({ g, t: th, r: rMid - capH / 2, w: ws[wi][gi] });
                u += ws[wi][gi] + (gi < q.gl.length - 1 ? track : 0);
            });
            out.dots.push((u + gapX / 2) / rMid);
            u += gapX;
        });
        return out;
    }

    // ---- bake: the face and the height map --------------------------------------
    function outline(x, seedR) {
        const r = rng(7), harm = [2, 3, 5, 7].map((h, i) => ({ h, a: [0.006, 0.005, 0.003, 0.002][i] * (0.6 + r() * 0.8), ph: r() * TAU }));
        x.beginPath();
        for (let i = 0; i <= 240; i++) {
            const th = (i / 240) * TAU;
            let f = 1;
            for (const q of harm) f += q.a * Math.sin(q.h * th + q.ph);
            const rr = seedR * f;
            i ? x.lineTo(Math.sin(th) * rr, -Math.cos(th) * rr) : x.moveTo(Math.sin(th) * rr, -Math.cos(th) * rr);
        }
        x.closePath();
    }

    function bake() {
        const mk = () => { const c = document.createElement('canvas'); c.width = c.height = T; return c; };
        const at = (x) => x.setTransform(k, 0, 0, k, T / 2, T / 2);

        // The face: the photograph, cut to the disc's outline.
        const albC = mk(), ax = albC.getContext('2d', { willReadFrequently: true });
        at(ax);
        ax.imageSmoothingQuality = 'high';
        ax.drawImage(img, -R, -R, 2 * R, 2 * R);
        ax.globalCompositeOperation = 'destination-in';
        outline(ax, R);
        ax.fill();
        ax.globalCompositeOperation = 'source-over';

        // The rim: the disc's silhouette blurred, so the height falls away
        // in a rounded edge where the blur crosses the outline.
        const discC = mk(), dx = discC.getContext('2d');
        at(dx);
        dx.fillStyle = '#fff';
        outline(dx, R);
        dx.fill();
        const rimC = blurred(discC, R * 0.05 * k);

        // Impressions: glyphs in red, grooves and marks in green.
        const relC = mk(), rx = relC.getContext('2d', { willReadFrequently: true });
        rx.fillStyle = '#000';
        rx.fillRect(0, 0, T, T);
        rx.globalCompositeOperation = 'lighter';
        at(rx);
        rx.textBaseline = 'alphabetic';
        rx.fillStyle = '#ff0000';
        rx.font = spec(size);
        const setGlyph = (q) => {
            rx.save();
            rx.rotate(q.t);
            rx.fillText(q.g, -q.w / 2, -q.r);
            rx.restore();
        };
        glyphs.forEach(setGlyph);
        if (geo.legend) { rx.font = spec(geo.legend.size); geo.legend.glyphs.forEach(setGlyph); }

        rx.strokeStyle = '#00ff00';
        rx.fillStyle = '#00ff00';
        rx.lineCap = 'round';
        const s = size, p = pitch;
        const dot = (th, rr, rad) => { rx.beginPath(); rx.arc(Math.sin(th) * rr, -Math.cos(th) * rr, rad, 0, TAU); rx.fill(); };
        const circle = (rr, w) => { rx.lineWidth = w; rx.beginPath(); rx.arc(0, 0, rr, 0, TAU); rx.stroke(); };
        // word dividers: a short stroke across the band
        // word dividers: a short stamped tick, about half the cap height,
        // standing on the x-height's middle, finer and shallower than a letter
        rx.lineWidth = Math.max(0.5, s * 0.042);
        rx.strokeStyle = '#00a800';
        for (const q of marks) {
            const rc = rAt(q.t) + tickAt;
            rx.save(); rx.rotate(q.t);
            rx.beginPath(); rx.moveTo(0, -(rc - s * 0.18)); rx.lineTo(0, -(rc + s * 0.18)); rx.stroke();
            rx.restore();
        }
        rx.strokeStyle = '#00ff00';
        // the spiral groove between the turns, from the first word to the last
        const tEnd = words.length ? words[words.length - 1].b + 0.02 : TAU;
        const spiral = (from, to, off) => {
            rx.beginPath();
            const steps = Math.ceil((to - from) / 0.01);
            for (let i = 0; i <= steps; i++) {
                const t = from + (to - from) * (i / steps), rr = rAt(t) + off;
                i ? rx.lineTo(Math.sin(t) * rr, -Math.cos(t) * rr) : rx.moveTo(Math.sin(t) * rr, -Math.cos(t) * rr);
            }
            rx.stroke();
        };
        rx.lineWidth = Math.max(0.6, s * 0.06);
        const startSide = fromCentre ? -p / 2 : p / 2;      // the edge the text begins from
        spiral(0, Math.max(TAU, tEnd), startSide);
        spiral(Math.max(0, tEnd - TAU), tEnd, -startSide);
        // the start: five dots in a row across the first band, as on the disc
        for (let i = 0; i < 5; i++) dot(0, rAt(0) + (i - 2) * p * 0.17, Math.max(0.5, s * 0.07));
        // the end: one small stamped ring after the last word
        if (words.length) {
            const te = words[words.length - 1].t1 + s * 0.9 / rAt(words[words.length - 1].t1);
            rx.lineWidth = Math.max(0.5, s * 0.06);
            rx.beginPath(); rx.arc(Math.sin(te) * rAt(te), -Math.cos(te) * rAt(te), s * 0.2, 0, TAU); rx.stroke();
        }
        // the centre: a rosette of eight petals, Phaistos sign 38
        {
            const rr = fromCentre ? Math.max(s * 0.9, geo.Ri - p * 0.35) : Math.max(s, geo.Ri * 0.78);
            rx.lineWidth = Math.max(0.6, rr * 0.07);
            circle(rr, Math.max(0.6, rr * 0.07));
            for (let i = 0; i < 8; i++) {
                rx.save(); rx.rotate((i / 8) * TAU);
                rx.beginPath(); rx.ellipse(0, -rr * 0.54, rr * 0.15, rr * 0.33, 0, 0, TAU); rx.fill();
                rx.restore();
            }
            rx.beginPath(); rx.arc(0, 0, rr * 0.13, 0, TAU); rx.fill();
        }
        if (geo.legend) {
            const L = geo.legend;
            circle(L.outer, Math.max(0.7, L.size * 0.06));
            circle(L.inner, Math.max(0.7, L.size * 0.06));
            for (const th of L.dots) dot(th, (L.outer + L.inner) / 2, L.size * 0.1);
            // a beaded border between the legend and the edge
            const rb = (L.outer + R) / 2 - R * 0.004, n = Math.round((TAU * rb) / (R * 0.034));
            for (let i = 0; i < n; i++) dot((i / n) * TAU, rb, R * 0.0105);
        } else {
            // a border of small punched dots between the rim and the first turn
            const rb = (geo.Ro + R * 0.985) / 2, n = Math.round((TAU * rb) / (s * 1.05));
            for (let i = 0; i < n; i++) dot((i / n) * TAU, rb, Math.max(0.55, s * 0.09));
        }
        rx.setTransform(1, 0, 0, 1, 0, 0);
        rx.globalCompositeOperation = 'lighter';
        rx.drawImage(blueOf(rimC), 0, 0);

        // Pack: r g b from the relief, a = the face's grain (its luminance).
        const rel = rx.getImageData(0, 0, T, T), ad = ax.getImageData(0, 0, T, T).data, d = rel.data;
        for (let i = 0; i < d.length; i += 4) {
            d[i + 3] = ad[i + 3] ? 0.2126 * ad[i] + 0.7152 * ad[i + 1] + 0.0722 * ad[i + 2] : 128;
        }

        gl.bindTexture(gl.TEXTURE_2D, texAlb);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, albC);
        gl.bindTexture(gl.TEXTURE_2D, texRel);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, rel);

        gl.viewport(0, 0, T, T);
        gl.uniform2f(U.uRes, T, T);
        gl.uniform1f(U.uR, R * k);
        gl.uniform1f(U.uPx, k);
        gl.uniform4f(U.uDepth, size * mat.depth * k, size * mat.depth * 0.8 * k, R * mat.rim * k, mat.micro * k);
        gl.uniform3f(U.uSp, spA * k, spB * k, dir);
        gl.uniform4f(U.uMat, mat.spec, mat.shine, mat.metal, mat.amb);
        gl.uniform3f(U.uInkCol, inkCol[0], inkCol[1], inkCol[2]);
    }
    // the blurred silhouette into the blue channel
    function blueOf(c) {
        const o = document.createElement('canvas');
        o.width = c.width; o.height = c.height;
        const x = o.getContext('2d');
        x.drawImage(c, 0, 0);
        x.globalCompositeOperation = 'multiply';
        x.fillStyle = '#0000ff';
        x.fillRect(0, 0, o.width, o.height);
        x.globalCompositeOperation = 'destination-in';
        x.drawImage(c, 0, 0);
        return o;
    }

    // ---- the reading line beneath --------------------------------------------------
    function buildReader() {
        if (!wantReader) return;
        if (!reader) {
            reader = document.createElement('div');
            reader.className = 'ps-reader';
            reader.setAttribute('aria-hidden', 'true');
            readerLine = document.createElement('div');
            readerLine.className = 'ps-line';
            reader.appendChild(readerLine);
            disc.after(reader);
        }
        readerLine.textContent = '';
        readerSpans = words.map((w) => {
            const sp = document.createElement('span');
            sp.className = 'ps-w';
            sp.textContent = w.text;
            readerLine.appendChild(sp);
            readerLine.appendChild(document.createTextNode(' '));
            return sp;
        });
        measureReader();
        const cs = getComputedStyle(reader);
        if (document.fonts) document.fonts.load(`${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`).then(() => { if (!dead) { measureReader(); render(); } }, () => {});
    }
    function measureReader() {
        if (!reader) return;
        readerW = reader.clientWidth;
        readerX = readerSpans.map((sp) => [sp.offsetLeft, sp.offsetLeft + sp.offsetWidth]);
    }
    // where the reading line should sit for disc position phi (continuous)
    function readerAt(phi) {
        const n = words.length;
        if (!n || !readerX.length) return 0;
        if (phi <= words[0].t0) return readerX[0][0] + (phi - words[0].t0) * 30;
        for (let i = 0; i < n; i++) {
            const w = words[i];
            if (phi <= w.t1) return mix(readerX[i][0], readerX[i][1], clamp((phi - w.t0) / Math.max(1e-6, w.t1 - w.t0)));
            if (i < n - 1 && phi < words[i + 1].t0) return mix(readerX[i][1], readerX[i + 1][0], (phi - w.t1) / Math.max(1e-6, words[i + 1].t0 - w.t1));
        }
        return readerX[n - 1][1];
    }

    // ---- reading -------------------------------------------------------------------
    const tFirst = () => (words.length ? words[0].tc : 0);
    const tLast = () => (words.length ? words[words.length - 1].tc : 0);
    function wordAt(phi) {
        let lo = 0, hi = words.length - 1;
        if (hi < 0) return -1;
        while (lo < hi) { const m = (lo + hi + 1) >> 1; words[m].a <= phi ? (lo = m) : (hi = m - 1); }
        return lo;
    }
    const detent = (phi) => { const i = wordAt(clamp(phi, tFirst(), tLast())); return i < 0 ? phi : words[i].tc; };

    function setActive(i) {
        if (i === active) return;
        active = i;
        const w = words[i];
        disc.setAttribute('aria-valuenow', String(i + 1));
        disc.setAttribute('aria-valuetext', w ? `${w.text} (word ${i + 1} of ${words.length})` : '');
        readerSpans.forEach((sp, j) => sp.classList.toggle('is-on', j === i));
    }

    // ---- frame ---------------------------------------------------------------------
    function render() {
        if (!gl) return;
        const phi = st.phi;
        gl.uniform1f(U.uRot, -phi);
        // the words being inked (up to four at once)
        const lit = [];
        for (let i = 0; i < ink.length; i++) if (ink[i] > 0.004) lit.push(i);
        lit.sort((x, y) => ink[y] - ink[x]);
        const arr = new Float32Array(16);
        for (let j = 0; j < 4; j++) {
            const i = lit[j];
            if (i === undefined) { arr.set([-1e4, -1e4, 0, 0], j * 4); continue; }
            arr.set([words[i].a, words[i].b, ink[i], 0], j * 4);
        }
        gl.uniform4fv(U.uInk, arr);
        const a0 = words.length ? words[0].a : 0;
        gl.uniform3f(U.uTrail, a0, active > 0 ? words[active].a : a0, calm.matches ? 0 : trail);
        // the needle: from above the rim down to the groove over this turn
        const tr = clamp(phi, tFirst(), tLast());
        const tip = rAt(tr) + pitch * 0.5;
        gl.uniform4f(U.uNeedle, -(C / 2 - 2) * k, -(R * 1.016 + 2) * k, -tip * k, pitch * 0.34 * k);
        gl.uniform2f(U.uNeedle2, Math.max(0.5, 0.55 * k), Math.max(1.6, 2.1 * k));
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (readerLine && readerX.length) {
            const x = readerAt(phi);
            readerLine.style.transform = `translate3d(${(readerW / 2 - x).toFixed(2)}px,0,0)`;
        }
    }

    function frame(now) {
        raf = 0;
        if (dead) return;
        const dt = last ? Math.min(1 / 30, (now - last) / 1000) : 1 / 60;
        last = now;
        let alive = false;
        if (st.mode === 'coast') {
            st.omega *= Math.exp(-dt / 1.0);
            st.phi += st.omega * dt;
            // past either end the disc meets a soft resistance
            const lo = tFirst() - 0.6, hi = tLast() + 0.6;
            if (st.phi < lo || st.phi > hi) st.omega *= Math.exp(-dt / 0.12);
            if (Math.abs(st.omega) < 1.1) { st.mode = 'spring'; st.target = detent(st.phi + st.omega * 0.3); }
            alive = true;
        }
        if (st.mode === 'spring') {
            const K = 34, D = 2 * Math.sqrt(K);
            st.omega += (K * (st.target - st.phi) - D * st.omega) * dt;
            st.phi += st.omega * dt;
            if (Math.abs(st.target - st.phi) < 2e-4 && Math.abs(st.omega) < 2e-3) { st.phi = st.target; st.omega = 0; st.mode = 'rest'; }
            else alive = true;
        }
        if (st.mode === 'drag') alive = true;
        setActive(wordAt(clamp(st.phi, tFirst(), tLast())));
        // ink soaks in quickly and lifts slowly
        for (let i = 0; i < ink.length; i++) {
            const want = i === active ? 1 : 0;
            if (ink[i] === want) continue;
            if (calm.matches) { ink[i] = want; continue; }
            ink[i] += (want - ink[i]) * (1 - Math.exp(-dt / (want > ink[i] ? 0.09 : 0.42)));
            if (Math.abs(want - ink[i]) < 0.004) ink[i] = want; else alive = true;
        }
        render();
        if (alive && visible) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    const kick = () => { if (!raf && !dead && gl && words.length) raf = requestAnimationFrame(frame); };

    function goTo(phi) {
        if (calm.matches) { st.phi = st.target = phi; st.omega = 0; st.mode = 'rest'; }
        else { st.target = phi; st.mode = 'spring'; }
        kick();
    }
    function nudge(d) {
        if (st.mode === 'drag') { st.phi += d; kick(); return; }
        st.target = (st.mode === 'spring' ? st.target : st.phi) + d;
        st.mode = 'spring';
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => { if (st.mode === 'spring') { st.target = detent(st.target); kick(); } }, 150);
        kick();
    }

    // ---- input ---------------------------------------------------------------------
    let drag = null;
    const local = (e) => {
        const r = disc.getBoundingClientRect();
        return { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
    };
    on(disc, 'pointerdown', (e) => {
        if (!words.length || (e.pointerType === 'mouse' && e.button !== 0)) return;
        const q = local(e);
        if (Math.hypot(q.x, q.y) > R * 1.04) return;
        drag = { id: e.pointerId, a: Math.atan2(q.y, q.x), samples: [{ t: performance.now(), phi: st.phi }] };
        try { disc.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
        st.mode = 'drag'; st.omega = 0;
        disc.classList.add('is-dragging');
        kick();
    });
    on(disc, 'pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const q = local(e), a = Math.atan2(q.y, q.x);
        let da = a - drag.a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        drag.a = a;
        // near the hub an angle means little: ease the grip there
        const rr = Math.hypot(q.x, q.y) / R;
        da *= clamp((rr - 0.06) / 0.22);
        st.phi -= da;
        const now = performance.now();
        drag.samples.push({ t: now, phi: st.phi });
        while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
        kick();
    });
    const release = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const s0 = drag.samples[0], now = performance.now();
        const v = e.type === 'pointercancel' ? 0 : (st.phi - s0.phi) / Math.max(0.016, (now - s0.t) / 1000);
        drag = null;
        disc.classList.remove('is-dragging');
        if (calm.matches) { goTo(detent(st.phi)); return; }
        st.omega = clamp(v, -16, 16);
        st.mode = Math.abs(st.omega) > 1.1 ? 'coast' : 'spring';
        if (st.mode === 'spring') st.target = detent(st.phi + st.omega * 0.3);
        kick();
    };
    on(disc, 'pointerup', release);
    on(disc, 'pointercancel', release);
    on(disc, 'lostpointercapture', release);
    on(disc, 'keydown', (e) => {
        if (!words.length) return;
        const i = Math.max(0, active);
        const perTurn = Math.max(1, Math.round(words.length / Math.max(1, geo.lines.length)));
        const to = {
            ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1,
            PageDown: i + perTurn, PageUp: i - perTurn, Home: 0, End: words.length - 1,
        }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        const j = clamp(to, 0, words.length - 1);
        goTo(words[j].tc);
    });

    // Scrolling turns it as if the page were a belt on its rim: the rim moves
    // about twice as far as the page does.
    let lastY = window.scrollY;
    on(window, 'scroll', () => {
        const y = window.scrollY, dy = y - lastY;
        lastY = y;
        if (!visible || calm.matches || scrollMode === 'none' || !words.length) return;
        nudge((dy * 2.1) / Math.max(60, R));
    }, { passive: true });

    // ---- GL ------------------------------------------------------------------------
    function initGL() {
        gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
        if (!gl) return false;
        const sh = (type, s) => {
            const o = gl.createShader(type);
            gl.shaderSource(o, s);
            gl.compileShader(o);
            if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(o)); return null; }
            return o;
        };
        const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return false;
        prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        U = {};
        for (const n of ['uAlb', 'uRel', 'uRes', 'uRot', 'uR', 'uDepth', 'uSp', 'uInk', 'uTrail', 'uInkCol', 'uMat', 'uNeedle', 'uNeedle2', 'uPx']) U[n] = gl.getUniformLocation(prog, n);
        const tex = (unit) => {
            const t = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        };
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        texAlb = tex(0);
        texRel = tex(1);
        gl.uniform1i(U.uAlb, 0);
        gl.uniform1i(U.uRel, 1);
        gl.clearColor(0, 0, 0, 0);
        return true;
    }
    // bake() binds each texture while uploading; rebind to the right units
    const bindUnits = () => {
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texAlb);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texRel);
    };

    function relayout() {
        gl.activeTexture(gl.TEXTURE0);
        layout();
        bindUnits();
        if (active < 0 || st.mode === 'rest') { st.phi = st.target = active >= 0 ? words[active].tc : tFirst(); }
        render();
    }

    // ---- start ---------------------------------------------------------------------
    (async () => {
        try {
            api = await import(LIB);
            img = await loadImage(new URL(url, document.baseURI).href);
            const cs = getComputedStyle(src);
            font = { style: cs.fontStyle, weight: weightOpt || cs.fontWeight, family: familyOpt || cs.fontFamily };
            const ic = getComputedStyle(root).getPropertyValue('--ps-ink').trim();
            if (ic) {
                const m = ic.match(/^#([0-9a-f]{6})$/i);
                if (m) inkCol = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
            }
            text = src.textContent.replace(/­/g, '').replace(/\s+/g, ' ').trim();
            legend = legendEl ? legendEl.textContent.replace(/\s+/g, ' ').trim() : '';
            try { await document.fonts.load(`${font.style} ${font.weight} 24px ${font.family}`); await document.fonts.ready; } catch (e) { /* measure what we have */ }
            if (dead || !text) return;
            if (!initGL()) throw new Error('no webgl');
            (legendEl || src).before(disc);
            root.classList.add('is-live');
            relayout();
        } catch (e) {
            disc.remove();
            if (reader) reader.remove();
            root.classList.remove('is-live');
            gl = null;
            return;
        }
        disc.setAttribute('aria-valuemin', '1');
        disc.setAttribute('aria-valuemax', String(words.length));
        st.phi = st.target = tFirst();
        setActive(0);
        ink[0] = 1;
        render();

        on(canvas, 'webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
        on(canvas, 'webglcontextrestored', () => { try { if (initGL()) { relayout(); kick(); } } catch (e) { /* the text stays */ } });

        const io = new IntersectionObserver((en) => {
            visible = en[0].isIntersecting;
            if (visible) { lastY = window.scrollY; kick(); }
        }, { rootMargin: '40px' });
        io.observe(disc);
        off.push(() => io.disconnect());
        let timer = 0, lastW = Math.round(disc.getBoundingClientRect().width);
        const ro = new ResizeObserver(() => {
            const w = Math.round(disc.getBoundingClientRect().width);
            if (reader) measureReader();
            if (w === lastW) { render(); return; }
            lastW = w;
            clearTimeout(timer);
            timer = setTimeout(() => { if (!dead && gl) { relayout(); kick(); } }, 140);
        });
        ro.observe(disc);
        if (reader) { ro.observe(reader); ro.observe(readerLine); }
        off.push(() => { ro.disconnect(); clearTimeout(timer); });
        on(calm, 'change', () => { ink.fill(0); if (active >= 0) ink[active] = 1; render(); kick(); });
        on(document, 'visibilitychange', () => { last = 0; });
    })();

    return function destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        clearTimeout(settleTimer);
        off.forEach((f) => f());
        disc.remove();
        if (reader) reader.remove();
        const lose = gl && gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
        root.classList.remove('ps', 'ps-' + scrollMode, 'is-live');
    };
}

// Auto-start every [data-pretext-spiral] once it is near the viewport.
function autoStart(el) {
    if (!('IntersectionObserver' in window)) return pretextSpiral(el);
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        pretextSpiral(el);
    }, { rootMargin: '800px' });
    io.observe(el);
}
document.querySelectorAll('[data-pretext-spiral]').forEach(autoStart);
