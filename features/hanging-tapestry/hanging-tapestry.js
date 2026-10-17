/*
 *  HANGING-TAPESTRY // a woven hanging on a turned rod, as real cloth.
 *
 *  Markup:  <figure data-hanging-tapestry>
 *             <img src="assets/unicorn-in-captivity.webp" alt="" width="2000" height="2862">
 *           </figure>
 *  Or call  hangingTapestry(figure, { hang, loops, fringe, breeze, bloom, grain, lift })
 *  yourself. It returns destroy().
 *
 *  Options (data attributes, all optional; the options object wins):
 *    data-hang="rod"       rod: the top is sewn into a sleeve round the rod, the
 *                          rod hangs on a cord from one nail. loops: the cloth
 *                          hangs by fabric tabs and sags between them (a banner).
 *                          Default: loops when the image is over 1.8x as wide as tall.
 *    data-loops="7"        how many tabs, for hang="loops" (default: one per ~110px)
 *    data-fringe="knots"   knots: warp ends knotted in small bundles. tassels:
 *                          a few bound tassels. none.
 *    data-breeze="1"       0-2, the slow air that keeps it alive; 0 = still
 *    data-bloom            starts in black and white and blooms into colour
 *                          the first time it is properly in view
 *    data-grain="1"        0-1.5, the woven micro-relief laid over the image
 *    data-lift="1"         0-2, how much a fast scroll lifts it like moving air
 *
 *  The cloth is a position-based (Verlet) simulation of about 2000 particles:
 *  structural, shear and bend constraints, plus a tether from every particle to
 *  the rod so the wool never stretches like rubber, however hard it is pulled.
 *  It steps at a fixed 120 Hz. Gravity is scaled to the size of the cloth, so
 *  a small one and a large one swing with the same slow, heavy period (~2.7 s).
 *  The top is gathered a little into the rod's sleeve, which is what gives a
 *  hung tapestry its soft vertical folds; the folds are simulated, not drawn.
 *
 *  WebGL1 draws it in three passes:
 *    shadow    the cloth and fringe, projected onto the wall along the light by
 *              how far each point stands off it, into a quarter-size buffer,
 *              blurred twice, laid on the paper.
 *    cloth     the image as a mipmapped texture (its own alpha keeps the real,
 *              slightly crooked bound edge). Per-pixel light from the
 *              simulated normals with a wrapped diffuse, so folds stay soft;
 *              valleys darkened by their curvature; a faint grazing sheen of
 *              wool; a woven relief (weft ridges with their little pips) that
 *              fades out before it could alias. The back is a plain linen
 *              lining, seen when a corner is lifted and turned.
 *    fringe    rope-simulated bundles hanging from the bottom edge, drawn as
 *              thin lit strands.
 *  The rod, finials, cords and nail are an SVG drawn once per size.
 *
 *  Breeze: three slow travelling sines, gusting, acting on each particle
 *  through its normal (cloth catches air face-on). Scrolling down lifts the
 *  hem like moving air. Grab anywhere and pull; let go and it swings back and
 *  settles. A tap pushes it to the wall. A phone's tilt leans its gravity.
 *  On touch screens a vertical swipe still scrolls the page (pan-y); sideways
 *  drags pull the cloth.
 *
 *  Without WebGL: the image with a CSS fold shading, a static fringe and the
 *  same hardware. Reduced motion: the cloth simulated to rest before it is
 *  first shown, folds and all, and then still. Dragging still works, heavily
 *  damped, and nothing moves by itself.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const HZ = 120;                 // fixed simulation rate
const DT = 1 / HZ;
const G_PER_H = 2.7;            // gravity in cloth-heights / s^2: a ~2.7 s swing at any size
const DAMP = 0.9;               // air drag on velocity, per second
const DAMP_CALM = 7;            // reduced motion: settles without swinging
const ITER = 5;                 // constraint passes per step
const K_SHEAR = 0.6;
const K_BEND = 0.22;            // heavy wool: broad, soft folds
const GATHER = 0.89;            // how much the sleeve gathers the top edge
const PLUMB = 9;                // 1/s^2: each column's wish to hang plumb from where it is sewn
const TARGET_VERTS = 2100;
const PERSPECTIVE = 2.6;        // focal length in figure sizes; tiny, but a lifted corner grows

let uid = 0;

/* ── shaders ──────────────────────────────────────────────────────────── */

const PREC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const CLOTH_VS = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute vec2 aUv;
attribute float aAo;
uniform vec2 uSize;     // canvas, css px
uniform vec2 uC;        // perspective centre
uniform float uF;       // focal length, css px
varying vec3 vN;
varying vec2 vUv;
varying float vAo;
void main() {
    float s = uF / (uF - aPos.z);
    vec2 p = uC + (aPos.xy - uC) * s;
    gl_Position = vec4(p.x / uSize.x * 2. - 1., 1. - p.y / uSize.y * 2., -aPos.z / 2000., 1.);
    vN = aNor; vUv = aUv; vAo = aAo;
}`;

const CLOTH_FS = (deriv) => `${deriv ? '#extension GL_OES_standard_derivatives : enable' : ''}
${PREC}
uniform sampler2D uTex;
uniform vec3 uL;
uniform float uSat;
uniform vec2 uThreads;     // weft ridges across / down the whole cloth
uniform float uGrain;      // 0..1.5, already faded for the pixel pitch
uniform vec3 uLining;
varying vec3 vN;
varying vec2 vUv;
varying float vAo;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
    vec4 t = texture2D(uTex, vUv);           // premultiplied
    if (t.a < .004) discard;
    vec3 N = normalize(vN);
    vec3 base = t.rgb;
    vec2 tp = vUv * uThreads;
    if (!gl_FrontFacing) {
        // the lining: plain-woven linen, a finer, flatter cloth
        N = -N;
        base = uLining * t.a;
        tp *= vec2(1.4, 1.4);
    }
    // woven relief: horizontal weft ridges (the warps run sideways in a
    // tapestry), each made of little pips, brick-offset row to row
    float row = floor(tp.y);
    float fy = fract(tp.y);
    float sx = tp.x + .5 * mod(row, 2.);
    float fx = fract(sx);
    float crest = sin(fy * 3.14159);
    float pip = sin(fx * 3.14159);
    float h = crest * (.62 + .38 * pip);
    float jit = hash(vec2(floor(sx), row)) - .5;
    float yarn = hash(vec2(row * .37, floor(tp.x / 23.) + floor(row / 3.))) - .5;   // abrash: yarn lots differ
    float fade = uGrain;
    ${deriv ? 'float px = max(fwidth(tp.y), fwidth(tp.x) * .8); fade *= 1. - smoothstep(.22, .42, px);' : ''}
    N = normalize(N + vec3(0., -cos(fy * 3.14159) * .2 * fade, 0.));

    // wrapped diffuse, normalised so flat cloth shows the image exactly
    float w = .55;
    float d = (dot(N, uL) + w) / (1. + w);
    float d0 = (uL.z + w) / (1. + w);
    float shade = clamp(d / d0, .38, 1.22) * vAo;
    shade *= 1. + fade * ((h - .62) * .12 + jit * .06 + yarn * .05);
    vec3 c = base * shade;

    // wool sheen: fibres catch light at grazing angles, and a broad soft lobe
    float graze = 1. - clamp(N.z, 0., 1.);
    float sheen = pow(graze, 2.2) * .5 + pow(max(dot(N, normalize(uL + vec3(0., 0., 1.))), 0.), 12.) * .07;
    // linen is matt: the lining takes a fifth of the wool's sheen
    c += vec3(1., .95, .86) * sheen * (gl_FrontFacing ? .16 : .03) * t.a * (.6 + .4 * h);

    float g = dot(c, vec3(.299, .587, .114));
    c = mix(vec3(g), c, uSat);
    gl_FragColor = vec4(c, t.a);
}`;

// the shadow: everything projected onto the wall along the light, by its depth
const SHADOW_VS = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform vec2 uSize;
uniform vec2 uDir;      // wall offset per px of depth
uniform vec2 uBase;
varying vec2 vUv;
varying float vD;
void main() {
    vec2 p = aPos.xy + uDir * aPos.z + uBase;
    gl_Position = vec4(p.x / uSize.x * 2. - 1., 1. - p.y / uSize.y * 2., 0., 1.);
    vUv = aUv;
    vD = clamp(aPos.z / 70., 0., 1.);
}`;
const SHADOW_FS = `${PREC}
uniform sampler2D uTex;
uniform float uUseTex;
varying vec2 vUv;
varying float vD;
void main() {
    float a = mix(1., texture2D(uTex, vUv).a, uUseTex);
    gl_FragColor = vec4(mix(.62, .32, vD) * a);
}`;

const QUAD_VS = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const BLUR_FS = `${PREC}
uniform sampler2D uSrc;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
    vec4 s = texture2D(uSrc, vUv) * .2270;
    s += (texture2D(uSrc, vUv + uStep * 1.3846) + texture2D(uSrc, vUv - uStep * 1.3846)) * .3162;
    s += (texture2D(uSrc, vUv + uStep * 3.2308) + texture2D(uSrc, vUv - uStep * 3.2308)) * .0703;
    gl_FragColor = s;
}`;
const COMP_FS = `${PREC}
uniform sampler2D uSrc;
uniform vec3 uCol;
uniform float uK;
uniform vec2 uEdge;     // fade width at the canvas edges, in uv
varying vec2 vUv;
void main() {
    vec2 e = smoothstep(vec2(0.), uEdge, vUv) * smoothstep(vec2(0.), uEdge, 1. - vUv);
    float a = texture2D(uSrc, vUv).a * uK * e.x * e.y;
    gl_FragColor = vec4(uCol * a, a);
}`;

const FRINGE_VS = `
attribute vec3 aPos;
attribute float aShade;
uniform vec2 uSize;
uniform vec2 uC;
uniform float uF;
varying float vShade;
void main() {
    float s = uF / (uF - aPos.z);
    vec2 p = uC + (aPos.xy - uC) * s;
    gl_Position = vec4(p.x / uSize.x * 2. - 1., 1. - p.y / uSize.y * 2., -aPos.z / 2000. - .0005, 1.);
    vShade = aShade;
}`;
const FRINGE_FS = `${PREC}
uniform vec3 uCol;
uniform float uSat;
varying float vShade;
void main() {
    vec3 c = uCol * vShade;
    float g = dot(c, vec3(.299, .587, .114));
    gl_FragColor = vec4(mix(vec3(g), c, uSat), 1.);
}`;

/* ── the component ────────────────────────────────────────────────────── */

export function hangingTapestry(root, opts = {}) {
    const img = root && root.querySelector('img');
    if (!img) return () => {};
    const id = `ht${++uid}`;
    const pick = (k) => (opts[k] ?? root.dataset[k]);
    const num = (k, d) => {
        const v = pick(k);
        return v == null || v === '' || !isFinite(Number(v)) ? d : Number(v);
    };
    const bloomOpt = pick('bloom');
    const cfg = {
        hang: String(pick('hang') || 'auto'),
        loops: Math.round(num('loops', 0)),
        fringe: String(pick('fringe') || 'auto'),
        breeze: clamp(num('breeze', 1), 0, 2),
        bloom: bloomOpt != null && bloomOpt !== false && bloomOpt !== 'false' && bloomOpt !== '0',
        grain: clamp(num('grain', 1), 0, 1.5),
        lift: clamp(num('lift', 1), 0, 2),
    };

    let dead = false;
    const off = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };

    // ── geometry (css px, figure coordinates; z toward the viewer, wall at 0)
    let W = 0, Hf = 0, aspect = 0.7, mode = 'rod', fringeMode = 'knots';
    let rodR = 6, rodY = 0, nailY = 0, rodX0 = 0, rodX1 = 0, finL = 0, cordH = 0, loopL = 0;
    let side = 0, top = 0, bottom = 0, cw = 0, ch = 0, y0 = 0, z0 = 8, fringeL = 0;
    let tabs = [];          // [{x, w}] for hang=loops

    function readAspect() {
        if (img.naturalWidth) return img.naturalWidth / img.naturalHeight;
        const w = Number(img.getAttribute('width')), h = Number(img.getAttribute('height'));
        return w > 0 && h > 0 ? w / h : 0.7;
    }

    // Sizes everything from the figure's width, and pads the figure so the
    // rod, cords and fringe have room. Synchronous and cheap.
    function measure() {
        aspect = readAspect();
        mode = cfg.hang === 'rod' || cfg.hang === 'loops' ? cfg.hang : aspect > 1.8 ? 'loops' : 'rod';
        fringeMode = ['knots', 'tassels', 'none'].includes(cfg.fringe) ? cfg.fringe : 'knots';
        W = Math.max(60, root.getBoundingClientRect().width);
        rodR = clamp(W * 0.0105, 4.2, 9.5);
        finL = rodR * 4.4;
        const over = rodR * 1.9;             // bare rod beyond the cloth, where the cord ties
        side = Math.round(finL + over + 3);
        cw = W - 2 * side;
        ch = cw / aspect;
        fringeL = fringeMode === 'none' ? 0 : fringeMode === 'tassels' ? clamp(ch * 0.13, 26, 70) : clamp(ch * 0.04, 13, 32);
        cordH = mode === 'rod' ? clamp(W * 0.1, 34, 110) : clamp(W * 0.045, 26, 70);
        loopL = mode === 'loops' ? clamp(ch * 0.075, 10, 26) : 0;
        nailY = Math.max(6, rodR * 0.9);
        rodY = nailY + cordH;
        y0 = mode === 'rod' ? rodY + rodR * 0.35 : rodY + rodR + loopL;
        top = Math.round(y0);
        y0 = top;
        bottom = Math.round(fringeL + 34);       // the fringe, and room for the shadow to fade
        Hf = top + ch + bottom;
        rodX0 = side - over;
        rodX1 = W - side + over;
        z0 = mode === 'rod' ? rodR * 1.5 : rodR * 1.25;
        tabs = [];
        if (mode === 'loops') {
            const n = Math.max(2, cfg.loops || Math.round(cw / 170) + 1);
            const tw = clamp(cw / n * 0.2, 12, 30);
            for (let k = 0; k < n; k++) tabs.push({ x: side + tw / 2 + (cw - tw) * (k / (n - 1)), w: tw });
        }
        root.style.padding = `${top}px ${side}px ${bottom}px`;
        root.style.setProperty('--ht-top', `${top}px`);
        root.style.setProperty('--ht-side', `${side}px`);
        root.style.setProperty('--ht-bottom', `${bottom}px`);
        root.style.setProperty('--ht-fringe', `${fringeL}px`);
    }

    // ── hardware: rod, finials, cord, nail, tabs (SVG, drawn once per size)
    let svg = null;
    let clothTone = [0.82, 0.78, 0.68];   // sampled from the image's edges
    let fringeTone = [0.86, 0.82, 0.72];
    let tasselTone = [0.6, 0.38, 0.24];

    function hex(c, k = 1) {
        return '#' + c.map((v) => Math.round(clamp(v * k) * 255).toString(16).padStart(2, '0')).join('');
    }

    function drawHardware() {
        const NS = 'http://www.w3.org/2000/svg';
        if (!svg) {
            svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('class', 'ht-hw');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');
            root.appendChild(svg);
        }
        const H = Hf;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('width', W);
        svg.setAttribute('height', H);
        const r = rodR, y = rodY, R = r * 1.32;   // R: the finial ball
        const cwid = clamp(r * 0.36, 1.4, 3);
        const tieL = rodX0 + (side - rodX0) * 0.45, tieR = W - tieL;
        const nx = W / 2;
        const f = (n) => n.toFixed(2);

        // a turned finial: profile r(x) from the rod end outward
        function finial(x0, dir) {
            const prof = [
                [0, 1.28], [0.32, 1.28], [0.38, 1.0], [0.62, 0.84], [0.78, 1.06], [0.94, 0.84],
                [1.15, 0.7],
            ];
            const pts = prof.map(([u, k]) => [u * r, k * r]);
            const cx = 1.15 * r + R * 0.92;            // ball centre (along the axis)
            const a0 = Math.asin(clamp(0.7 * r / R, 0, 1));
            const top = [], bot = [];
            for (const [u, k] of pts) { top.push([u, -k]); bot.push([u, k]); }
            for (let i = 0; i <= 18; i++) {
                const a = Math.PI - a0 - (Math.PI - a0 - 0.55) * (i / 18);
                top.push([cx + Math.cos(a) * R, -Math.sin(a) * R]);
                bot.push([cx + Math.cos(a) * R, Math.sin(a) * R]);
            }
            // a small turned point
            const tipX = cx + R * 1.55;
            top.push([cx + R * 1.08, -R * 0.3], [tipX, -R * 0.06]);
            bot.push([cx + R * 1.08, R * 0.3], [tipX, R * 0.06]);
            const P = (p) => `${f(x0 + dir * p[0])},${f(y + p[1])}`;
            const d = 'M' + top.map(P).join(' L') + ' L' + bot.reverse().map(P).join(' L') + 'Z';
            const ball = { x: x0 + dir * cx, r: R };
            // the ring lines of the turning
            const rings = [0.32, 0.38, 0.78, 1.15].map((u) => {
                const k = u === 0.78 ? 1.06 : u === 0.32 ? 1.28 : u === 0.38 ? 1.0 : 0.7;
                return `<line x1="${f(x0 + dir * u * r)}" y1="${f(y - k * r)}" x2="${f(x0 + dir * u * r)}" y2="${f(y + k * r)}"/>`;
            }).join('');
            return { d, ball, rings };
        }
        const fl = finial(rodX0, -1), fr = finial(rodX1, 1);

        // wood grain: long, faintly wavering lines along the rod
        let seed = 7;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        let grain = '';
        for (let i = 0; i < 9; i++) {
            const gy = y - r * 0.8 + r * 1.6 * rnd();
            let d = `M${f(rodX0)},${f(gy)}`;
            const ph = rnd() * 6, amp = 0.15 + rnd() * 0.35, wl = 40 + rnd() * 120;
            for (let x = rodX0; x <= rodX1; x += 12) d += ` L${f(x)},${f(gy + Math.sin(x / wl + ph) * amp * r * 0.3)}`;
            grain += `<path d="${d}" stroke-width="${f(0.35 + rnd() * 0.5)}" opacity="${f(0.18 + rnd() * 0.3)}"/>`;
        }

        // cord: a soft catenary from each tie to the nail, twisted (dashes)
        const cord = (x1) => {
            const mx = (x1 + nx) / 2, my = (y - r * 0.9 + nailY) / 2 + Math.abs(nx - x1) * 0.015;
            return `M${f(x1)},${f(y - r * 0.85)} Q${f(mx)},${f(my)} ${f(nx)},${f(nailY + 1)}`;
        };
        const cords = cord(tieL) + ' ' + cord(tieR);
        // the cord's turns round the rod at each tie
        const wraps = [tieL, tieR].map((tx) => [-1, 0, 1].map((k) => {
            const xx = tx + k * cwid * 1.05;
            return `<path d="M${f(xx - cwid * 0.4)},${f(y - r * 1.02)} Q${f(xx + cwid * 0.5)},${f(y)} ${f(xx - cwid * 0.4)},${f(y + r * 1.02)}"/>`;
        }).join('')).join('');

        // tabs (hang=loops): a band of cloth up and over the rod
        const linen = clothTone.map((v, i) => v * 0.35 + [0.85, 0.8, 0.69][i] * 0.65);
        const tone = hex(linen), toneHi = hex(linen, 1.08), toneLo = hex(linen, 0.6);
        let tabsSvg = '';
        for (const t of tabs) {
            // a band of linen up over the rod: rounded where it turns, sewn on below
            const x = t.x - t.w / 2, x2 = x + t.w, yt = y - r - Math.max(1.4, r * 0.25), yb = y0 + 3;
            const rr = Math.min(t.w * 0.45, r * 0.9);
            const d = `M${f(x)},${f(yb)} L${f(x)},${f(yt + rr)} Q${f(x)},${f(yt)} ${f(x + rr)},${f(yt)} L${f(x2 - rr)},${f(yt)} Q${f(x2)},${f(yt)} ${f(x2)},${f(yt + rr)} L${f(x2)},${f(yb)} Z`;
            tabsSvg += `<path d="${d}" fill="url(#${id}-tab)"/><path d="${d}" fill="url(#${id}-tabx)"/>`
                + `<line x1="${f(x + 2)}" y1="${f(yb - 4.5)}" x2="${f(x2 - 2)}" y2="${f(yb - 4.5)}" stroke="#5b4a35" stroke-opacity=".55" stroke-width=".7" stroke-dasharray="1.6 1.4"/>`
                + `<line x1="${f(x + 2)}" y1="${f(y + r + 1.5)}" x2="${f(x2 - 2)}" y2="${f(y + r + 1.5)}" stroke="#2b1d10" stroke-opacity=".16" stroke-width="2.2" filter="url(#${id}-softer)"/>`;
        }

        const sh = { x: z0 * 0.4 + 1, y: z0 * 0.7 + 2 };
        svg.innerHTML = `
<defs>
  <linearGradient id="${id}-wood" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y - r)}" x2="0" y2="${f(y + r)}">
    <stop offset="0" stop-color="#2b1a0e"/><stop offset=".1" stop-color="#5e3b20"/>
    <stop offset=".27" stop-color="#a87447"/><stop offset=".36" stop-color="#c18c5a"/>
    <stop offset=".46" stop-color="#8d5c34"/><stop offset=".72" stop-color="#5a3820"/>
    <stop offset=".9" stop-color="#2f1d10"/><stop offset="1" stop-color="#1f130a"/>
  </linearGradient>
  <linearGradient id="${id}-brass" gradientUnits="userSpaceOnUse" x1="0" y1="${f(y - R)}" x2="0" y2="${f(y + R)}">
    <stop offset="0" stop-color="#3f2c0f"/><stop offset=".14" stop-color="#8a6526"/>
    <stop offset=".28" stop-color="#e6cd8c"/><stop offset=".36" stop-color="#cfa752"/>
    <stop offset=".58" stop-color="#8c6726"/><stop offset=".8" stop-color="#4f3712"/>
    <stop offset=".91" stop-color="#7d5e27"/><stop offset="1" stop-color="#3a280c"/>
  </linearGradient>
  <radialGradient id="${id}-glint" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#fff8e2" stop-opacity=".9"/><stop offset="1" stop-color="#fff8e2" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${id}-nail" cx=".38" cy=".34" r=".7">
    <stop offset="0" stop-color="#f1dca0"/><stop offset=".35" stop-color="#c49a48"/><stop offset=".8" stop-color="#6b4c1a"/><stop offset="1" stop-color="#3d2a0c"/>
  </radialGradient>
  <linearGradient id="${id}-tab" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${toneLo}"/><stop offset=".08" stop-color="${toneHi}"/>
    <stop offset=".3" stop-color="${tone}"/><stop offset=".5" stop-color="${hex(linen, 0.82)}"/>
    <stop offset=".62" stop-color="${hex(linen, 0.95)}"/><stop offset="1" stop-color="${hex(linen, 0.86)}"/>
  </linearGradient>
  <linearGradient id="${id}-tabx" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#2b1d10" stop-opacity=".28"/><stop offset=".22" stop-color="#2b1d10" stop-opacity="0"/>
    <stop offset=".45" stop-color="#fffaf0" stop-opacity=".12"/><stop offset=".8" stop-color="#2b1d10" stop-opacity=".04"/>
    <stop offset="1" stop-color="#2b1d10" stop-opacity=".34"/>
  </linearGradient>
  <clipPath id="${id}-rodclip"><rect x="${f(rodX0)}" y="${f(y - r)}" width="${f(rodX1 - rodX0)}" height="${f(2 * r)}"/></clipPath>
  <filter id="${id}-soft" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="${f(r * 0.55)}"/></filter>
  <filter id="${id}-softer" x="-10%" y="-60%" width="120%" height="220%"><feGaussianBlur stdDeviation="1.4"/></filter>
</defs>
<g class="ht-shadows">
  <path d="${cords}" fill="none" stroke="#1d140b" stroke-opacity=".16" stroke-width="${f(cwid * 1.3)}" transform="translate(2.5 4)" filter="url(#${id}-softer)"/>
  <circle cx="${f(nx + 1.5)}" cy="${f(nailY + 2.5)}" r="${f(r * 0.6)}" fill="#1d140b" fill-opacity=".22" filter="url(#${id}-softer)"/>
  <rect x="${f(rodX0 - finL + sh.x)}" y="${f(y - r * 0.7 + sh.y)}" width="${f(rodX1 - rodX0 + 2 * finL)}" height="${f(r * 1.7)}" rx="${f(r)}" fill="#1d140b" fill-opacity=".28" filter="url(#${id}-soft)"/>
</g>
<path d="${cords}" fill="none" stroke="#3b2c1f" stroke-width="${f(cwid)}" stroke-linecap="round"/>
<path d="${cords}" fill="none" stroke="#9b8462" stroke-width="${f(cwid * 0.62)}" stroke-dasharray="${f(cwid * 0.55)} ${f(cwid * 0.95)}" stroke-linecap="butt" opacity=".75"/>
<circle cx="${f(nx)}" cy="${f(nailY)}" r="${f(r * 0.55)}" fill="url(#${id}-nail)"/>
<rect x="${f(rodX0)}" y="${f(y - r)}" width="${f(rodX1 - rodX0)}" height="${f(2 * r)}" fill="url(#${id}-wood)"/>
<g clip-path="url(#${id}-rodclip)" fill="none" stroke="#2a170a">${grain}</g>
<g fill="none" stroke="#3b2c1f" stroke-width="${f(cwid)}" stroke-linecap="round">${wraps}</g>
<g fill="none" stroke="#a48d6a" stroke-width="${f(cwid * 0.4)}" opacity=".6" transform="translate(-.4 -.2)">${wraps}</g>
${tabsSvg}
<path d="${fl.d}" fill="url(#${id}-brass)"/>
<path d="${fr.d}" fill="url(#${id}-brass)"/>
<g stroke="#2e1f08" stroke-opacity=".45" stroke-width=".6">${fl.rings}${fr.rings}</g>
<ellipse cx="${f(fl.ball.x - R * 0.12)}" cy="${f(y - R * 0.42)}" rx="${f(R * 0.55)}" ry="${f(R * 0.3)}" fill="url(#${id}-glint)"/>
<ellipse cx="${f(fr.ball.x - R * 0.12)}" cy="${f(y - R * 0.42)}" rx="${f(R * 0.55)}" ry="${f(R * 0.3)}" fill="url(#${id}-glint)"/>`;
    }

    // ── cloth state ──────────────────────────────────────────────────────
    let nx = 0, ny = 0, N = 0, dx = 0, dy = 0;
    let P, Q, IM, PIN, XR;                // positions, previous, inverse mass, pinned targets, plumb x
    let cA, cB, cL, cK, nC = 0;           // constraints
    let tA, tL;                           // tethers: anchor index and max length per particle
    let NOR, AO, UV, IDX;
    let gx = 0, gz = -0.05;               // gravity direction (y is 1)
    let time = 0;

    // fringe
    let bundles = [];                      // {u, w, strands:[{o, jit, shade}], k0}
    let RP, RQ, nRope = 0, ropeK = 6, ropeSeg = 0;
    let fringeBuf = null, fringeCount = 0;

    function buildCloth() {
        const cs = Math.sqrt(cw * ch / TARGET_VERTS);
        nx = clamp(Math.round(cw / cs) + 1, 10, 110);
        ny = clamp(Math.round(ch / cs) + 1, 8, 90);
        N = nx * ny;
        dx = cw / (nx - 1);
        dy = ch / (ny - 1);
        P = new Float32Array(N * 3);
        Q = new Float32Array(N * 3);
        IM = new Float32Array(N).fill(1);
        PIN = new Float32Array(N * 3);
        XR = new Float32Array(N);
        NOR = new Float32Array(N * 3);
        AO = new Float32Array(N).fill(1);
        UV = new Float32Array(N * 2);

        const cx = side + cw / 2;
        // sleeve gathering: k soft waves across, amplitude so the arc length
        // across the top is still the cloth's own width
        // The cloth is wider than the room it is given, all the way down, so
        // it has to fold; a few broad folds whose line wanders a little.
        const k = clamp(cw / 130, 3, 6);
        for (let j = 0; j < ny; j++) {
            const v = j / (ny - 1);
            const gth = GATHER + (1 - GATHER) * 0.35 * v;          // opening a touch toward the hem
            const amp = Math.sqrt(4 * (1 / gth - 1)) * cw / (2 * Math.PI * k);
            for (let i = 0; i < nx; i++) {
                const n = j * nx + i, u = i / (nx - 1);
                let x = side + i * dx, yy = y0 + j * dy, z = z0;
                const wave = Math.sin(2 * Math.PI * k * u + 0.6 + 0.7 * Math.sin(v * 2.4 + u * 1.7));
                if (mode === 'rod') {
                    x = cx + (x - cx) * gth;
                    z = z0 * (1 - 0.35 * v) + amp * wave;
                } else {
                    z = z0 * (1 - 0.5 * v);
                }
                XR[n] = x;
                P[n * 3] = x; P[n * 3 + 1] = yy; P[n * 3 + 2] = Math.max(1, z);
                UV[n * 2] = u; UV[n * 2 + 1] = v;
            }
        }
        // pins
        if (mode === 'rod') {
            for (let i = 0; i < nx; i++) IM[i] = 0;
        } else {
            for (const t of tabs) {
                const half = Math.max(0.5, t.w / dx / 2);
                const ci = (t.x - side) / dx;
                for (let i = Math.max(0, Math.round(ci - half + 0.3)); i <= Math.min(nx - 1, Math.round(ci + half - 0.3)); i++) IM[i] = 0;
            }
            // loops sit a touch closer together than the cloth is wide: the
            // banner drapes between them
            for (let i = 0; i < nx; i++) {
                const x = P[i * 3];
                P[i * 3] = cx + (x - cx) * 0.985;
            }
        }
        for (let n = 0; n < N; n++) { PIN[n * 3] = P[n * 3]; PIN[n * 3 + 1] = P[n * 3 + 1]; PIN[n * 3 + 2] = P[n * 3 + 2]; }
        Q.set(P);

        // constraints: rest lengths from the flat cloth
        const list = [];
        const add = (a, b, kk) => {
            if (IM[a] === 0 && IM[b] === 0) return;
            const ax = (a % nx) * dx, ay = Math.floor(a / nx) * dy, bx = (b % nx) * dx, by = Math.floor(b / nx) * dy;
            list.push(a, b, Math.hypot(bx - ax, by - ay), kk);
        };
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const n = j * nx + i;
            if (i < nx - 1) add(n, n + 1, 1);
            if (j < ny - 1) add(n, n + nx, 1);
        }
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
            const n = j * nx + i;
            add(n, n + nx + 1, K_SHEAR);
            add(n + 1, n + nx, K_SHEAR);
        }
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const n = j * nx + i;
            if (i < nx - 2) add(n, n + 2, K_BEND);
            if (j < ny - 2) add(n, n + 2 * nx, K_BEND);
        }
        nC = list.length / 4;
        cA = new Int32Array(nC); cB = new Int32Array(nC); cL = new Float32Array(nC); cK = new Float32Array(nC);
        for (let c = 0; c < nC; c++) { cA[c] = list[c * 4]; cB[c] = list[c * 4 + 1]; cL[c] = list[c * 4 + 2]; cK[c] = list[c * 4 + 3]; }

        // tethers: each particle may be no farther from its nearest pin than
        // it is across the flat cloth (so wool never stretches)
        tA = new Int32Array(N).fill(-1);
        tL = new Float32Array(N);
        const pins = [];
        for (let i = 0; i < nx; i++) if (IM[i] === 0) pins.push(i);
        for (let n = 0; n < N; n++) {
            if (IM[n] === 0) continue;
            const x = (n % nx) * dx, yy = Math.floor(n / nx) * dy;
            let best = -1, bd = 1e9;
            for (const p of pins) { const d = Math.hypot(p * dx - x, yy); if (d < bd) { bd = d; best = p; } }
            tA[n] = best; tL[n] = bd * 1.01;
        }

        IDX = new Uint16Array((nx - 1) * (ny - 1) * 6);
        let q = 0;
        for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
            const n = j * nx + i;
            IDX[q++] = n; IDX[q++] = n + 1; IDX[q++] = n + nx;
            IDX[q++] = n + 1; IDX[q++] = n + nx + 1; IDX[q++] = n + nx;
        }
        buildFringe();
    }

    function buildFringe() {
        bundles = [];
        if (fringeMode === 'none') { nRope = 0; return; }
        let seed = 11;
        const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        if (fringeMode === 'tassels') {
            const n = mode === 'loops' ? tabs.length : clamp(Math.round(cw / 120) + 1, 3, 9);
            for (let b = 0; b < n; b++) {
                const u = 0.03 + 0.94 * (b / (n - 1));
                const strands = [];
                for (let s = 0; s < 34; s++) strands.push({ o: (s / 33 - 0.5), jit: rnd() - 0.5, shade: 0.7 + rnd() * 0.42, len: 0.9 + rnd() * 0.1 });
                bundles.push({ u, w: clamp(fringeL * 0.42, 9, 26), strands, knot: 0.3, spread: 0.7, head: true, len: 1 });
            }
            ropeK = 7;
        } else {
            const spacing = clamp(cw / 72, 5.5, 9);
            const n = Math.max(6, Math.round(cw / spacing));
            for (let b = 0; b < n; b++) {
                const u = (b + 0.5) / n;
                const strands = [];
                const ns = 5;
                for (let s = 0; s < ns; s++) strands.push({ o: s / (ns - 1) - 0.5, jit: rnd() - 0.5, shade: 0.66 + rnd() * 0.44, len: 0.72 + rnd() * 0.28 });
                bundles.push({ u, w: spacing * 0.78, strands, knot: 0.22, spread: 0.78, head: false, len: 0.84 + rnd() * 0.16 });
            }
            ropeK = 6;
        }
        nRope = bundles.length;
        ropeSeg = fringeL / (ropeK - 1);
        RP = new Float32Array(nRope * ropeK * 3);
        RQ = new Float32Array(nRope * ropeK * 3);
        for (let b = 0; b < nRope; b++) {
            const a = edgePoint(bundles[b].u);
            for (let k = 0; k < ropeK; k++) {
                const o = (b * ropeK + k) * 3;
                RP[o] = a[0]; RP[o + 1] = a[1] + k * ropeSeg; RP[o + 2] = Math.max(1, a[2]);
            }
        }
        RQ.set(RP);
    }

    // a point on the bottom edge of the cloth, at 0..1 across
    const _e = [0, 0, 0];
    function edgePoint(u) {
        const f = u * (nx - 1), i = Math.min(nx - 2, Math.floor(f)), t = f - i;
        const a = ((ny - 1) * nx + i) * 3, b = a + 3;
        _e[0] = P[a] + (P[b] - P[a]) * t;
        _e[1] = P[a + 1] + (P[b + 1] - P[a + 1]) * t;
        _e[2] = P[a + 2] + (P[b + 2] - P[a + 2]) * t;
        return _e;
    }

    // ── simulation ───────────────────────────────────────────────────────
    let grab = null;          // {set:[{n,w,ox,oy,oz}], tx, ty, tz}
    let scrollV = 0;          // smoothed scroll velocity, px/s
    let energy = 0;

    function wind(t) {
        // a slow breath of air: three travelling sines, gusting
        const g = 0.62 + 0.38 * Math.sin(t * 0.17) * Math.sin(t * 0.063 + 1.3);
        return g;
    }

    function step(damp) {
        const g = G_PER_H * ch;
        const dt2 = DT * DT;
        const keep = 1 - damp * DT;
        time += DT;
        const breeze = calm.matches ? 0 : cfg.breeze;
        const gust = wind(time) * breeze;
        const t = time;
        const lift = calm.matches ? 0 : clamp(scrollV / 1400, -1, 1) * cfg.lift;
        const ax0 = gx * g, ay0 = g, az0 = gz * g;
        for (let n = 0; n < N; n++) {
            if (IM[n] === 0) continue;
            const o = n * 3;
            const u = (n % nx) / (nx - 1), v = Math.floor(n / nx) / (ny - 1);
            let ax = ax0, ay = ay0, az = az0;
            if (gust > 0) {
                const wz = (0.55 * Math.sin(t * 0.83 + u * 2.6 - v * 1.4)
                    + 0.3 * Math.sin(t * 0.41 + 1.7 - u * 4.3 + v * 2.2)
                    + 0.15 * Math.sin(t * 1.37 + u * 7.1 + v * 3.3 + 0.5)) * gust * 0.075 * g;
                const wx = (0.6 * Math.sin(t * 0.29 + 2.1 + v * 1.1) + 0.4 * Math.sin(t * 0.71 + u * 3.1)) * gust * 0.022 * g;
                // cloth catches air face-on
                const nxn = NOR[o], nyn = NOR[o + 1], nzn = NOR[o + 2];
                const dot = nxn * wx + nzn * wz;
                ax += nxn * dot * 0.8 + wx * 0.2;
                ay += nyn * dot * 0.8;
                az += nzn * dot * 0.8 + wz * 0.2;
            }
            if (lift !== 0) {
                // scrolling down: the hem rises and leans out, like moving air
                const k = Math.pow(v, 1.6) * lift * g;
                ay -= k * 0.42;
                az += Math.abs(k) * 0.3;
            }
            const x = P[o], y = P[o + 1], z = P[o + 2];
            if (mode === 'rod') ax += (XR[n] - x) * PLUMB;
            P[o] = x + (x - Q[o]) * keep + ax * dt2;
            P[o + 1] = y + (y - Q[o + 1]) * keep + ay * dt2;
            P[o + 2] = z + (z - Q[o + 2]) * keep + az * dt2;
            Q[o] = x; Q[o + 1] = y; Q[o + 2] = z;
        }
        if (grab) {
            for (const s of grab.set) {
                const o = s.n * 3;
                P[o] += (grab.tx + s.ox - P[o]) * 0.32 * s.w;
                P[o + 1] += (grab.ty + s.oy - P[o + 1]) * 0.32 * s.w;
                P[o + 2] += (grab.tz + s.oz - P[o + 2]) * 0.2 * s.w;
            }
        }
        for (let it = 0; it < ITER; it++) {
            for (let c = 0; c < nC; c++) {
                const a = cA[c], b = cB[c];
                const ia = a * 3, ib = b * 3;
                const ddx = P[ib] - P[ia], ddy = P[ib + 1] - P[ia + 1], ddz = P[ib + 2] - P[ia + 2];
                const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
                if (d < 1e-6) continue;
                const k = cK[c];
                const diff = d - cL[c];
                const wa = IM[a], wb = IM[b], ws = wa + wb;
                const s = (diff / d) * k / ws;
                P[ia] += ddx * s * wa; P[ia + 1] += ddy * s * wa; P[ia + 2] += ddz * s * wa;
                P[ib] -= ddx * s * wb; P[ib + 1] -= ddy * s * wb; P[ib + 2] -= ddz * s * wb;
            }
        }
        // tethers and the wall
        for (let n = 0; n < N; n++) {
            if (IM[n] === 0) continue;
            const o = n * 3, a = tA[n] * 3;
            const ddx = P[o] - P[a], ddy = P[o + 1] - P[a + 1], ddz = P[o + 2] - P[a + 2];
            const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
            if (d > tL[n]) {
                const s = tL[n] / d;
                P[o] = P[a] + ddx * s; P[o + 1] = P[a + 1] + ddy * s; P[o + 2] = P[a + 2] + ddz * s;
            }
            if (P[o + 2] < 0.8) {
                P[o + 2] = 0.8;
                // a little friction against the wall
                Q[o] += (P[o] - Q[o]) * 0.15; Q[o + 1] += (P[o + 1] - Q[o + 1]) * 0.15;
            }
        }
        stepFringe(damp);
    }

    function stepFringe(damp) {
        if (!nRope) return;
        const g = G_PER_H * ch, dt2 = DT * DT, keep = 1 - (damp * 1.6 + 1.2) * DT;
        const ax = gx * g, ay = g, az = gz * g;
        for (let b = 0; b < nRope; b++) {
            const base = b * ropeK * 3;
            const a = edgePoint(bundles[b].u);
            RP[base] = a[0]; RP[base + 1] = a[1]; RP[base + 2] = a[2];
            for (let k = 1; k < ropeK; k++) {
                const o = base + k * 3;
                const x = RP[o], y = RP[o + 1], z = RP[o + 2];
                RP[o] = x + (x - RQ[o]) * keep + ax * dt2;
                RP[o + 1] = y + (y - RQ[o + 1]) * keep + ay * dt2;
                RP[o + 2] = z + (z - RQ[o + 2]) * keep + az * dt2;
                RQ[o] = x; RQ[o + 1] = y; RQ[o + 2] = z;
            }
            for (let it = 0; it < 2; it++) {
                for (let k = 1; k < ropeK; k++) {
                    const p = base + (k - 1) * 3, o = base + k * 3;
                    const ddx = RP[o] - RP[p], ddy = RP[o + 1] - RP[p + 1], ddz = RP[o + 2] - RP[p + 2];
                    const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) || 1e-6;
                    const s = ropeSeg / d;
                    // the parent end is held by the cloth (k = 1) or is the stiffer one
                    RP[o] = RP[p] + ddx * s; RP[o + 1] = RP[p + 1] + ddy * s; RP[o + 2] = RP[p + 2] + ddz * s;
                }
            }
            for (let k = 1; k < ropeK; k++) { const o = base + k * 3 + 2; if (RP[o] < 0.6) RP[o] = 0.6; }
        }
    }

    // normals and curvature shading, once per drawn frame
    function computeNormals() {
        const lapK = 1.15 / Math.max(dx, dy);
        for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
            const n = j * nx + i;
            const l = j * nx + Math.max(0, i - 1), r = j * nx + Math.min(nx - 1, i + 1);
            const u = Math.max(0, j - 1) * nx + i, d = Math.min(ny - 1, j + 1) * nx + i;
            const ax = P[r * 3] - P[l * 3], ay = P[r * 3 + 1] - P[l * 3 + 1], az = P[r * 3 + 2] - P[l * 3 + 2];
            const bx = P[d * 3] - P[u * 3], by = P[d * 3 + 1] - P[u * 3 + 1], bz = P[d * 3 + 2] - P[u * 3 + 2];
            let cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
            const m = Math.hypot(cx, cy, cz) || 1;
            NOR[n * 3] = cx / m; NOR[n * 3 + 1] = cy / m; NOR[n * 3 + 2] = cz / m;
            // valley shading: lower than the neighbours (further from the eye) is darker
            const l2 = j * nx + Math.max(0, i - 2), r2 = j * nx + Math.min(nx - 1, i + 2);
            const zl = (P[l * 3 + 2] + P[r * 3 + 2]) * 0.5, zl2 = (P[l2 * 3 + 2] + P[r2 * 3 + 2]) * 0.5;
            const zv = (P[u * 3 + 2] + P[d * 3 + 2]) * 0.5;
            const lap = (zl - P[n * 3 + 2]) * 0.55 + (zl2 - P[n * 3 + 2]) * 0.3 + (zv - P[n * 3 + 2]) * 0.25;
            const near = clamp(P[n * 3 + 2] / (z0 + 4), 0, 1.4);
            AO[n] = clamp(1 - lap * lapK * 1.05, 0.5, 1.08) * (0.94 + 0.06 * near);
        }
    }

    // ── GL ───────────────────────────────────────────────────────────────
    let canvas = null, gl = null, dpr = 1;
    let pCloth, pShadow, pBlur, pComp, pFringe;
    let bPos, bNor, bAo, bUv, bIdx, bQuad, bFringe, bShadowFringeUv;
    let texImg = null, fbA = null, fbB = null, txA = null, txB = null, fbW = 0, fbH = 0;
    let deriv = false, aniso = null;
    let U = {};

    function compile(vs, fs) {
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
            return s;
        };
        const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
        if (!v || !f) throw new Error('shader');
        const p = gl.createProgram();
        gl.attachShader(p, v);
        gl.attachShader(p, f);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
        const u = {}, a = {};
        const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
        const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
        for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i); a[info.name] = gl.getAttribLocation(p, info.name); }
        return { p, u, a };
    }

    function initGL() {
        gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false });
        if (!gl) return false;
        deriv = !!gl.getExtension('OES_standard_derivatives');
        aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
        pCloth = compile(CLOTH_VS, CLOTH_FS(deriv));
        pShadow = compile(SHADOW_VS, SHADOW_FS);
        pBlur = compile(QUAD_VS, BLUR_FS);
        pComp = compile(QUAD_VS, COMP_FS);
        pFringe = compile(FRINGE_VS, FRINGE_FS);
        bPos = gl.createBuffer(); bNor = gl.createBuffer(); bAo = gl.createBuffer(); bUv = gl.createBuffer();
        bIdx = gl.createBuffer(); bQuad = gl.createBuffer(); bFringe = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, bQuad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        return true;
    }

    function makeTarget(w, h) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return [fb, t];
    }

    const pow2 = (v) => 2 ** Math.ceil(Math.log2(Math.max(2, v)));

    function uploadImage() {
        const max = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096);
        const tw = Math.min(max, pow2(Math.min(img.naturalWidth, cw * dpr * 1.3)));
        const th = Math.min(max, pow2(Math.min(img.naturalHeight, ch * dpr * 1.3)));
        const c = document.createElement('canvas');
        c.width = tw; c.height = th;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, tw, th);
        if (!texImg) texImg = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);   // throws if cross-origin
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    }

    // the colours of the cloth's edges: tabs and fringe are made of them
    function sampleTones() {
        const s = document.createElement('canvas');
        s.width = 64; s.height = 64;
        const g = s.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 64, 64);
        const avg = (y0r, y1r) => {
            const d = g.getImageData(0, y0r, 64, y1r - y0r).data;
            let r = 0, gg = 0, b = 0, n = 0;
            for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
            return n ? [r / n / 255, gg / n / 255, b / n / 255] : null;
        };
        const t = avg(0, 2), b = avg(62, 64);
        if (t) clothTone = t;
        if (b) {
            // undyed wool: the bottom edge's colour, lifted toward ecru
            fringeTone = b.map((v, i) => clamp(v * 0.3 + [0.87, 0.81, 0.68][i] * 0.7));
            // tassels are dyed: the cloth's own mean colour, deepened toward madder and ochre
            const m = avg(0, 64) || b;
            tasselTone = m.map((v, i) => clamp(v * 0.45 + [0.6, 0.36, 0.22][i] * 0.55));
        }
        const css = cssColor('--ht-fringe-color');
        if (css) fringeTone = tasselTone = css;
    }

    function cssColor(name) {
        const raw = getComputedStyle(root).getPropertyValue(name).trim();
        if (!raw) return null;
        const g = document.createElement('canvas').getContext('2d');
        g.fillStyle = '#000';
        g.fillStyle = raw;
        const m = g.fillStyle.match(/^#([0-9a-f]{6})$/i);
        if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
        const p = g.fillStyle.match(/[\d.]+/g);
        return p ? p.slice(0, 3).map((x) => Number(x) / 255) : null;
    }

    function layoutGL() {
        const raw = devicePixelRatio || 1;
        dpr = Math.min(raw, 2);
        if (raw > 2 && W * Hf * raw * raw <= 3.6e6) dpr = Math.min(raw, 3);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(Hf * dpr);
        canvas.style.width = `${W}px`;
        canvas.style.height = `${Hf}px`;
        fbW = Math.max(8, Math.round(W / 4)); fbH = Math.max(8, Math.round(Hf / 4));
        if (txA) { gl.deleteTexture(txA); gl.deleteTexture(txB); gl.deleteFramebuffer(fbA); gl.deleteFramebuffer(fbB); }
        [fbA, txA] = makeTarget(fbW, fbH);
        [fbB, txB] = makeTarget(fbW, fbH);
        gl.bindBuffer(gl.ARRAY_BUFFER, bUv);
        gl.bufferData(gl.ARRAY_BUFFER, UV, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, IDX, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
        gl.bufferData(gl.ARRAY_BUFFER, P.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bNor);
        gl.bufferData(gl.ARRAY_BUFFER, NOR.byteLength, gl.DYNAMIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bAo);
        gl.bufferData(gl.ARRAY_BUFFER, AO.byteLength, gl.DYNAMIC_DRAW);
        uploadImage();
    }

    // fringe strands as thin screen-space quads: [x, y, z, shade] x 6 per segment
    function buildFringeMesh() {
        if (!nRope) { fringeCount = 0; return; }
        const segs = [];
        let total = 0;
        for (const b of bundles) total += b.strands.length * (ropeK + 1) + (b.head ? 6 : 2);
        const need = total * 6 * 4;
        if (!fringeBuf || fringeBuf.length < need) fringeBuf = new Float32Array(need);
        const F = fringeBuf;
        let q = 0;
        const sw = fringeMode === 'tassels' ? Math.max(0.5, 1.1 / dpr) : Math.max(0.3, 0.75 / dpr);
        const quad = (x1, y1, z1, x2, y2, z2, w1, w2, s1, s2) => {
            let tx = x2 - x1, ty = y2 - y1;
            const m = Math.hypot(tx, ty) || 1;
            const px = -ty / m, py = tx / m;
            const a = [x1 + px * w1, y1 + py * w1, z1, s1], b = [x1 - px * w1, y1 - py * w1, z1, s1];
            const c = [x2 + px * w2, y2 + py * w2, z2, s2], d = [x2 - px * w2, y2 - py * w2, z2, s2];
            for (const v of [a, b, c, b, d, c]) { F[q++] = v[0]; F[q++] = v[1]; F[q++] = v[2]; F[q++] = v[3]; }
        };
        // the cloth's bottom edge direction at u, for spreading roots
        for (let bi = 0; bi < nRope; bi++) {
            const B = bundles[bi], base = bi * ropeK * 3;
            const e0 = edgePoint(clamp(B.u - 0.004)).slice(), e1 = edgePoint(clamp(B.u + 0.004)).slice();
            let ex = e1[0] - e0[0], ey = e1[1] - e0[1];
            const em = Math.hypot(ex, ey) || 1; ex /= em; ey /= em;
            const kn = B.knot * (ropeK - 1);           // knot position along the rope
            for (const s of B.strands) {
                const pts = [];
                // root on the edge, spread across the bundle
                pts.push([RP[base] + ex * s.o * B.w, RP[base + 1] + ey * s.o * B.w - 1.5, RP[base + 2]]);
                for (let k = 1; k < ropeK; k++) {
                    const o = base + k * 3;
                    const pk = base + (k - 1) * 3;
                    let tx = RP[o] - RP[pk], ty = RP[o + 1] - RP[pk + 1];
                    const tm = Math.hypot(tx, ty) || 1; tx /= tm; ty /= tm;
                    // lateral: tight at the knot, opening toward the tips
                    const f = k <= kn ? 0.12 * (1 - k / kn) + 0.08 : 0.08 + (k - kn) / (ropeK - 1 - kn) * B.spread * 0.5;
                    const lat = (s.o * f * 2 + s.jit * f * 0.5) * B.w;
                    const along = k === ropeK - 1 ? s.len * B.len : 1;
                    const px = RP[pk] + (RP[o] - RP[pk]) * along, py = RP[pk + 1] + (RP[o + 1] - RP[pk + 1]) * along;
                    pts.push([px - ty * lat, py + tx * lat, RP[o + 2]]);
                }
                for (let k = 0; k < pts.length - 1; k++) {
                    const s1 = s.shade * (1 - 0.18 * k / (pts.length - 1)), s2 = s.shade * (1 - 0.18 * (k + 1) / (pts.length - 1));
                    quad(...pts[k], ...pts[k + 1], sw, k + 1 === pts.length - 1 ? sw * 0.6 : sw, s1, s2);
                }
            }
            // the knot or the tassel's bound head
            const ko = base + Math.round(kn) * 3;
            const kx = RP[ko], ky = RP[ko + 1], kz = RP[ko + 2] + 0.3;
            if (B.head) {
                // the bound head: a rounded crown, then three wraps of yarn
                const hw = B.w * 0.3;
                const top = RP[base + 1] + 1;
                for (let r = 0; r < 5; r++) {
                    const t = r / 4, yy = top + (ky - top) * t;
                    const w = hw * (0.45 + 0.55 * Math.sin(Math.min(1, t * 1.3) * Math.PI / 2));
                    quad(kx - w, yy, kz, kx + w, yy, kz, (ky - top) / 8 + 0.4, (ky - top) / 8 + 0.4, 0.82 - t * 0.1, 0.95 - t * 0.1);
                }
                for (let r = 0; r < 3; r++) {
                    const yy = ky + r * ropeSeg * 0.16;
                    quad(kx - hw * 1.08, yy, kz + 0.2, kx + hw * 1.08, yy, kz + 0.2, ropeSeg * 0.06 + 0.3, ropeSeg * 0.06 + 0.3, 0.55, 0.72);
                }
            } else {
                // the knot: a small lump where the ends are tied
                const hw = B.w * 0.17;
                quad(kx - hw, ky - 0.4, kz, kx + hw, ky - 0.4, kz, 1.25, 1.25, 0.62, 0.8);
            }
        }
        fringeCount = q / 4;
    }

    let sat = 1, satTarget = 1;
    const L = (() => { const v = [-0.58, -0.42, 0.68], m = Math.hypot(...v); return v.map((x) => x / m); })();

    function attr(prog, name, buf, size, stride = 0, offset = 0) {
        const loc = prog.a[name];
        if (loc == null || loc < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset);
    }
    function resetAttribs() { for (let i = 0; i < 6; i++) gl.disableVertexAttribArray(i); }

    function draw() {
        if (!gl) return;
        computeNormals();
        buildFringeMesh();
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P);
        gl.bindBuffer(gl.ARRAY_BUFFER, bNor); gl.bufferSubData(gl.ARRAY_BUFFER, 0, NOR);
        gl.bindBuffer(gl.ARRAY_BUFFER, bAo); gl.bufferSubData(gl.ARRAY_BUFFER, 0, AO);
        if (fringeCount) {
            gl.bindBuffer(gl.ARRAY_BUFFER, bFringe);
            gl.bufferData(gl.ARRAY_BUFFER, fringeBuf.subarray(0, fringeCount * 4), gl.DYNAMIC_DRAW);
        }
        const cxp = side + cw / 2, cyp = y0 + ch / 2, F = PERSPECTIVE * Math.max(W, Hf);

        // 1. shadow silhouette, quarter size
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbA);
        gl.viewport(0, 0, fbW, fbH);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        resetAttribs();
        gl.useProgram(pShadow.p);
        gl.uniform2f(pShadow.u.uSize, W, Hf);
        gl.uniform2f(pShadow.u.uDir, -L[0] / L[2] * 0.85, -L[1] / L[2] * 0.85);
        gl.uniform2f(pShadow.u.uBase, 0.5, 1.5);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.uniform1i(pShadow.u.uTex, 0);
        gl.uniform1f(pShadow.u.uUseTex, 1);
        attr(pShadow, 'aPos', bPos, 3);
        attr(pShadow, 'aUv', bUv, 2);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
        gl.drawElements(gl.TRIANGLES, IDX.length, gl.UNSIGNED_SHORT, 0);
        if (fringeCount) {
            resetAttribs();
            gl.uniform1f(pShadow.u.uUseTex, 0);
            attr(pShadow, 'aPos', bFringe, 3, 16, 0);
            if (pShadow.a.aUv != null) { gl.disableVertexAttribArray(pShadow.a.aUv); gl.vertexAttrib2f(pShadow.a.aUv, 0, 0); }
            gl.drawArrays(gl.TRIANGLES, 0, fringeCount);
        }
        // 2. blur, twice
        resetAttribs();
        gl.useProgram(pBlur.p);
        attr(pBlur, 'p', bQuad, 2);
        gl.uniform1i(pBlur.u.uSrc, 0);
        const blur = (src, dst, sx, sy) => {
            gl.bindFramebuffer(gl.FRAMEBUFFER, dst);
            gl.bindTexture(gl.TEXTURE_2D, src);
            gl.uniform2f(pBlur.u.uStep, sx / fbW, sy / fbH);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        blur(txA, fbB, 1.25, 0); blur(txB, fbA, 0, 1.25);
        blur(txA, fbB, 0.7, 0); blur(txB, fbA, 0, 0.7);

        // 3. the canvas: shadow, cloth, fringe
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(pComp.p);
        attr(pComp, 'p', bQuad, 2);
        gl.bindTexture(gl.TEXTURE_2D, txA);
        gl.uniform1i(pComp.u.uSrc, 0);
        gl.uniform3f(pComp.u.uCol, 0.11, 0.075, 0.04);
        gl.uniform1f(pComp.u.uK, 0.75);
        gl.uniform2f(pComp.u.uEdge, 22 / W, 22 / Hf);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        resetAttribs();
        gl.useProgram(pCloth.p);
        gl.uniform2f(pCloth.u.uSize, W, Hf);
        gl.uniform2f(pCloth.u.uC, cxp, cyp);
        gl.uniform1f(pCloth.u.uF, F);
        gl.uniform3f(pCloth.u.uL, L[0], L[1], L[2]);
        gl.uniform1f(pCloth.u.uSat, sat);
        // weft ridges ~1.9 css px apart, never finer than 3.6 device px
        const pitch = Math.max(1.9, 3.6 / dpr);
        gl.uniform2f(pCloth.u.uThreads, cw / (pitch * 0.85), ch / pitch);
        // at 1x there is no room for the relief below the pixel: keep only a hint
        gl.uniform1f(pCloth.u.uGrain, cfg.grain * clamp(dpr - 0.65, 0.35, 1));
        gl.uniform3f(pCloth.u.uLining, 0.7, 0.64, 0.53);
        gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.uniform1i(pCloth.u.uTex, 0);
        attr(pCloth, 'aPos', bPos, 3);
        attr(pCloth, 'aNor', bNor, 3);
        attr(pCloth, 'aAo', bAo, 1);
        attr(pCloth, 'aUv', bUv, 2);
        gl.frontFace(gl.CW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bIdx);
        gl.drawElements(gl.TRIANGLES, IDX.length, gl.UNSIGNED_SHORT, 0);

        if (fringeCount) {
            resetAttribs();
            gl.useProgram(pFringe.p);
            gl.uniform2f(pFringe.u.uSize, W, Hf);
            gl.uniform2f(pFringe.u.uC, cxp, cyp);
            gl.uniform1f(pFringe.u.uF, F);
            const ft = fringeMode === 'tassels' ? tasselTone : fringeTone;
            gl.uniform3f(pFringe.u.uCol, ft[0], ft[1], ft[2]);
            gl.uniform1f(pFringe.u.uSat, sat);
            attr(pFringe, 'aPos', bFringe, 3, 16, 0);
            attr(pFringe, 'aShade', bFringe, 1, 16, 12);
            gl.drawArrays(gl.TRIANGLES, 0, fringeCount);
        }
    }

    // ── loop ─────────────────────────────────────────────────────────────
    let raf = 0, last = 0, acc = 0, visible = false, quiet = 0;
    let lastScrollY = scrollY, scrollT = performance.now(), scrollRaw = 0;

    function running() {
        return visible && !document.hidden && gl;
    }
    function kick() {
        if (!raf && running()) { last = 0; raf = requestAnimationFrame(frame); }
    }
    function frame(now) {
        raf = 0;
        if (!running() || dead) return;
        const dtf = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        // scroll velocity, eased
        scrollV += (scrollRaw - scrollV) * (1 - Math.exp(-dtf / 0.12));
        scrollRaw *= Math.exp(-dtf / 0.08);
        // gravity follows the phone's tilt, a little
        if (tilt.active && !calm.matches) {
            gx += (tilt.x * 0.2 - gx) * 0.1;
            gz += (clamp(-0.05 + tilt.y * 0.22, -0.2, 0.18) - gz) * 0.1;
        }
        acc += dtf;
        let steps = 0;
        const damp = calm.matches ? DAMP_CALM : DAMP;
        while (acc >= DT && steps < 6) { step(damp); acc -= DT; steps++; }
        if (steps === 6) acc = 0;
        if (sat !== satTarget) {
            sat += (satTarget - sat) * (1 - Math.exp(-dtf / 0.85));
            if (Math.abs(sat - satTarget) < 0.004) sat = satTarget;
        }
        draw();
        // sleep when nothing can move it
        let move = 0;
        for (let n = 0; n < N; n += 7) {
            const o = n * 3;
            move = Math.max(move, Math.abs(P[o] - Q[o]) + Math.abs(P[o + 1] - Q[o + 1]) + Math.abs(P[o + 2] - Q[o + 2]));
        }
        const alive = (cfg.breeze > 0 && !calm.matches) || grab || Math.abs(scrollV) > 2 || sat !== satTarget;
        quiet = alive || move > 0.003 ? 0 : quiet + dtf;
        if (quiet < 0.6) raf = requestAnimationFrame(frame);
    }

    function settle(seconds, damp) {
        const n = Math.round(seconds * HZ);
        for (let i = 0; i < n; i++) step(damp);
    }

    // ── input ────────────────────────────────────────────────────────────
    let tilt = { x: 0, y: 0, active: false };
    let ptrDown = null;     // {id, x, y, t}
    let hover = null;       // last mouse spot over the cloth

    function local(e) {
        const r = root.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    }
    function nearest(x, y) {
        const F = PERSPECTIVE * Math.max(W, Hf), cxp = side + cw / 2, cyp = y0 + ch / 2;
        let best = -1, bd = 1e12;
        for (let n = 0; n < N; n++) {
            const o = n * 3, s = F / (F - P[o + 2]);
            const px = cxp + (P[o] - cxp) * s, py = cyp + (P[o + 1] - cyp) * s;
            const d = (px - x) ** 2 + (py - y) ** 2;
            if (d < bd) { bd = d; best = n; }
        }
        const lim = Math.max(dx, dy) * 0.9 + 4;
        if (bd <= lim * lim) return best;
        // the fringe is a handle too: it takes hold of the hem above it
        if (best >= (ny - 1) * nx && fringeL > 0) {
            const o = best * 3, ddx = Math.abs(P[o] - x), ddy = y - P[o + 1];
            if (ddy > 0 && ddy < fringeL + 6 && ddx < lim) return best;
        }
        return -1;
    }
    function startGrab(n, x, y) {
        const i0 = n % nx, j0 = Math.floor(n / nx);
        const set = [];
        const o0 = n * 3;
        for (let j = j0 - 2; j <= j0 + 2; j++) for (let i = i0 - 2; i <= i0 + 2; i++) {
            if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
            const m = j * nx + i;
            if (IM[m] === 0) continue;
            const d = Math.hypot(i - i0, j - j0);
            if (d > 2.2) continue;
            const o = m * 3;
            // the fingers pinch: neighbours close in toward the grip
            set.push({ n: m, w: d === 0 ? 1 : 0.55 * (1 - d / 2.6), ox: (P[o] - P[o0]) * 0.75, oy: (P[o + 1] - P[o0 + 1]) * 0.75, oz: 0 });
        }
        grab = { set, tx: P[o0], ty: P[o0 + 1], tz: P[o0 + 2], z: Math.min(z0 + ch * 0.08, P[o0 + 2] + ch * 0.06) };
        moveGrab(x, y);
        root.classList.add('is-grabbing');
    }
    function moveGrab(x, y) {
        if (!grab) return;
        grab.tx = clamp(x, 4, W - 4);
        grab.ty = clamp(y, 4, Hf - 4);
        grab.tz = grab.z;
        kick();
    }
    function endGrab() {
        if (!grab) return;
        grab = null;
        root.classList.remove('is-grabbing');
        kick();
    }
    function poke(n, k = 1) {
        // a press: the cloth gives under it and springs back
        const i0 = n % nx, j0 = Math.floor(n / nx);
        const rr = 3.2;
        for (let j = Math.max(0, j0 - 4); j <= Math.min(ny - 1, j0 + 4); j++) for (let i = Math.max(0, i0 - 4); i <= Math.min(nx - 1, i0 + 4); i++) {
            const m = j * nx + i;
            if (IM[m] === 0) continue;
            const d = Math.hypot(i - i0, j - j0);
            if (d > rr) continue;
            Q[m * 3 + 2] += k * 2.4 * (1 - d / rr) ** 2 * Math.min(1, ch / 400 + 0.4);
        }
        kick();
    }

    function onPointerDown(e) {
        if (!gl || e.button > 0) return;
        const [x, y] = local(e);
        const n = nearest(x, y);
        if (n < 0) return;
        ptrDown = { id: e.pointerId, x, y, t: performance.now(), n, moved: false };
        if (e.pointerType === 'mouse') {
            e.preventDefault();
            startGrab(n, x, y);
        }
        try { root.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    }
    function onPointerMove(e) {
        const [x, y] = local(e);
        if (ptrDown && e.pointerId === ptrDown.id) {
            const dd = Math.hypot(x - ptrDown.x, y - ptrDown.y);
            if (!ptrDown.moved && dd > 5) {
                ptrDown.moved = true;
                if (!grab) startGrab(ptrDown.n, ptrDown.x, ptrDown.y);
            }
            if (grab) moveGrab(x, y);
            return;
        }
        if (e.pointerType !== 'mouse' || !gl) return;
        // a hand brushing past: the faintest stir
        const n = nearest(x, y);
        root.classList.toggle('is-over', n >= 0);
        if (n >= 0 && hover && !calm.matches) {
            const vx = x - hover[0], vy = y - hover[1];
            const sp = Math.hypot(vx, vy);
            if (sp > 1.5) {
                const i0 = n % nx, j0 = Math.floor(n / nx);
                for (let j = Math.max(0, j0 - 2); j <= Math.min(ny - 1, j0 + 2); j++) for (let i = Math.max(0, i0 - 2); i <= Math.min(nx - 1, i0 + 2); i++) {
                    const m = j * nx + i;
                    if (IM[m] === 0) continue;
                    const f = Math.max(0, 1 - Math.hypot(i - i0, j - j0) / 2.5) * 0.045;
                    Q[m * 3] -= clamp(vx, -30, 30) * f;
                    Q[m * 3 + 1] -= clamp(vy, -30, 30) * f * 0.5;
                    Q[m * 3 + 2] -= sp * f * 0.15;
                }
                kick();
            }
        }
        hover = n >= 0 ? [x, y] : null;
    }
    function onPointerUp(e) {
        if (!ptrDown || e.pointerId !== ptrDown.id) return;
        const quick = performance.now() - ptrDown.t < 280 && !ptrDown.moved;
        const n = ptrDown.n;
        ptrDown = null;
        endGrab();
        if (quick && e.type === 'pointerup') poke(n);
    }
    function onLeave() { hover = null; root.classList.remove('is-over'); }
    function onKey(e) {
        if (!gl) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            // a breath of air from one side
            const dir = e.key === 'ArrowLeft' ? -1 : 1;
            for (let n = 0; n < N; n++) {
                if (IM[n] === 0) continue;
                const v = Math.floor(n / nx) / (ny - 1);
                Q[n * 3] -= dir * 1.6 * v ** 1.3 * Math.min(1, ch / 400 + 0.4);
                Q[n * 3 + 2] -= 0.6 * v * Math.sin((n % nx) / nx * Math.PI * 3);
            }
            kick();
            e.preventDefault();
        } else if (e.key === 'Enter' || e.key === ' ') {
            poke(Math.floor(ny * 0.62) * nx + (nx >> 1), 1.6);
            e.preventDefault();
        }
    }
    function onScroll() {
        const now = performance.now();
        const dt = Math.max(8, now - scrollT) / 1000;
        const v = (scrollY - lastScrollY) / dt;
        lastScrollY = scrollY; scrollT = now;
        scrollRaw = clamp(v, -4000, 4000);
        kick();
    }

    // ── fallback: no WebGL ───────────────────────────────────────────────
    function flat() {
        root.classList.add('ht-flat');
        if (cfg.bloom && !calm.matches) { root.classList.add('ht-grey'); satTarget = 0; }
    }

    // ── start ────────────────────────────────────────────────────────────
    let io = null, ro = null, sizeTimer = 0, bloomTimer = 0;
    root.classList.add('ht-on');
    measure();

    async function start() {
        try { await img.decode(); } catch (e) { if (!img.complete || !img.naturalWidth) await new Promise((res) => img.addEventListener('load', res, { once: true })); }
        if (dead || !img.naturalWidth) return;
        measure();
        try { sampleTones(); } catch (e) { /* tainted: keep the defaults */ }
        drawHardware();

        canvas = document.createElement('canvas');
        canvas.className = 'ht-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        try {
            if (!initGL()) throw new Error('no webgl');
            root.insertBefore(canvas, svg);
            buildCloth();
            layoutGL();
        } catch (e) {
            canvas.remove();
            canvas = null;
            gl = null;
            flat();
            observe();
            return;
        }
        on(canvas, 'webglcontextlost', (e) => {
            e.preventDefault();
            cancelAnimationFrame(raf); raf = 0;
            root.classList.remove('is-live');
        });
        on(canvas, 'webglcontextrestored', () => {
            try { texImg = null; txA = null; if (initGL()) { layoutGL(); root.classList.add('is-live'); draw(); kick(); } } catch (e) { /* stay on the img */ }
        });

        // hang it, and let it come to rest before anyone sees it
        settle(calm.matches ? 6 : 3.2, DAMP_CALM);
        if (!calm.matches) settle(0.6, DAMP);
        sat = satTarget = cfg.bloom && !calm.matches ? 0 : 1;
        draw();
        root.classList.add('is-live');

        const drag = img.getAttribute('draggable');
        img.draggable = false;
        off.push(() => (drag == null ? img.removeAttribute('draggable') : img.setAttribute('draggable', drag)));
        if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; root.dataset.htTab = '1'; }
        if (!root.hasAttribute('role')) { root.setAttribute('role', 'img'); root.dataset.htRole = '1'; }
        if (!root.hasAttribute('aria-label')) {
            root.setAttribute('aria-label', 'A tapestry hanging from a wooden rod. Drag to pull the cloth; arrow keys send a breath of air.');
            root.dataset.htLabel = '1';
        }

        on(root, 'pointerdown', onPointerDown);
        on(root, 'pointermove', onPointerMove);
        on(root, 'pointerup', onPointerUp);
        on(root, 'pointercancel', onPointerUp);
        on(root, 'lostpointercapture', onPointerUp);
        on(root, 'pointerleave', onLeave);
        on(root, 'keydown', onKey);
        on(root, 'dragstart', (e) => e.preventDefault());
        on(window, 'scroll', onScroll, { passive: true });
        on(document, 'visibilitychange', () => { if (!document.hidden) kick(); });
        on(calm, 'change', () => { if (calm.matches) { sat = satTarget = 1; settle(4, DAMP_CALM); draw(); } kick(); });
        import('./tilt.js').then((m) => { tilt = m.default; }).catch(() => {});
        observe();
    }

    function observe() {
        io = new IntersectionObserver((en) => {
            const e = en[en.length - 1];
            visible = e.isIntersecting;
            // colour, earned: blooms once it is properly in view
            const seen = e.isIntersecting && (e.intersectionRatio >= 0.45 || e.intersectionRect.height >= innerHeight * 0.55);
            if (cfg.bloom && seen && !bloomTimer && satTarget < 1) {
                bloomTimer = setTimeout(() => { satTarget = 1; root.classList.remove('ht-grey'); kick(); }, 700);
            } else if (bloomTimer && !seen && satTarget < 1) {
                clearTimeout(bloomTimer); bloomTimer = 0;
            }
            if (visible) kick();
        }, { threshold: [0, 0.2, 0.45, 0.7, 1] });
        io.observe(root);

        let w0 = W;
        ro = new ResizeObserver(() => {
            const w = root.getBoundingClientRect().width;
            if (Math.abs(w - w0) < 1) return;
            clearTimeout(sizeTimer);
            sizeTimer = setTimeout(() => {
                if (dead) return;
                w0 = w;
                measure();
                drawHardware();
                if (gl) {
                    buildCloth();
                    layoutGL();
                    settle(calm.matches ? 6 : 3, DAMP_CALM);
                    draw();
                    kick();
                }
            }, 160);
        });
        ro.observe(root);
    }
    start();

    return function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(sizeTimer);
        clearTimeout(bloomTimer);
        off.forEach((f) => f());
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
        if (canvas) canvas.remove();
        if (svg) svg.remove();
        root.classList.remove('ht-on', 'is-live', 'ht-flat', 'ht-grey', 'is-grabbing', 'is-over');
        root.style.padding = '';
        for (const p of ['--ht-top', '--ht-side', '--ht-bottom', '--ht-fringe']) root.style.removeProperty(p);
        if (root.dataset.htTab) { root.removeAttribute('tabindex'); delete root.dataset.htTab; }
        if (root.dataset.htRole) { root.removeAttribute('role'); delete root.dataset.htRole; }
        if (root.dataset.htLabel) { root.removeAttribute('aria-label'); delete root.dataset.htLabel; }
        delete root.dataset.htStarted;
    };
}

// Auto-start every [data-hanging-tapestry]. The figure is padded for its
// hardware at once (so nothing below it jumps later); the cloth is built when
// it comes near the viewport.
function autoStart(el) {
    if (el.dataset.htStarted) return;
    el.dataset.htStarted = '1';
    if (!('IntersectionObserver' in window)) return;
    el.classList.add('ht-on');
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        hangingTapestry(el);
    }, { rootMargin: '700px' });
    io.observe(el);
}
document.querySelectorAll('[data-hanging-tapestry]').forEach(autoStart);
