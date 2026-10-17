/*
 *  LIGHT-RAYS // sunlight falling on the page.
 *
 *  Markup:  <article data-light-rays data-preset="window" data-branch="olive"> … </article>
 *           (on <body>, or with data-attach="viewport", the light lies on the
 *           screen itself and the page scrolls under it; on any other element
 *           it lies on that element and scrolls with it)
 *  Or call  lightRays(el, { preset, sun, clouds, warmth, … })  yourself.
 *  It returns destroy(), with destroy.set({ … }) to change options live.
 *
 *  Options (data attributes, all optional; the options object wins):
 *    data-preset="window"   window | arch | lattice | leaves
 *    data-aperture="url"    a mask image (alpha, or dark = stone) to use as the window
 *    data-sun="-58 34"      azimuth (screen degrees, 0 = from the top, -90 = from the
 *                           left) and elevation above the page. Default depends on aspect.
 *    data-at="0.56 0.5"     where the middle of the patch lands, fractions of the area
 *    data-size="1"          scales the window (and the patch)
 *    data-softness="2.2"    penumbra: 1 is the bare 0.53° sun; more adds the aureole
 *    data-clouds="0.4"      0-1, slow breathing and the odd passing cloud
 *    data-wind="0.5"        0-1, sways the leaves and the branch
 *    data-warmth="0.6"      0-1, colour of the light: noon white to late-afternoon
 *    data-golden            golden hour: lower sun, longer patch, orange light
 *    data-intensity="1"     scales the light
 *    data-shade="0.03"      0-1, how much the room outside the beam is in shade
 *    data-haze="0.35"       0-1, shafts in the air above the page
 *    data-motes="0.5"       0-1, dust in the beam (0 = none)
 *    data-branch="none"     olive | twig: a branch outside the window (not leaves)
 *    data-drift="0"         0-1, the sun moves on as you scroll, like time passing
 *    data-static            a frozen beam
 *    data-attach            viewport | element
 *
 *  The light is two canvases from one WebGL context. Underneath, a multiply
 *  layer: the room's faint shade (a few percent, a touch cool, so paper stays
 *  paper) and, where the sun falls, the warm filter of its colour. Over it a
 *  screen layer: the light itself through a filmic shoulder (1 - e^-x), plus a
 *  little halation past bright edges. Paper goes cream-gold, ink lifts to warm
 *  grey, pictures go warmer and softer but keep their texture.
 *
 *  The window stands in a wall off the page. A point on the page is lit through
 *  the aperture point (u, v) its ray came through; the sun is a 0.53° disc, so
 *  each point sees the aperture through a disc of radius  length × 0.0093 / 2,
 *  and its light is the share of that disc that is open. Window and arch do
 *  that analytically (the exact chord area of a disc cut by each bar's edges),
 *  so the patch is crisp at the sill and soft at its far end. The lattice (a
 *  jali), a custom mask and the branch outside are drawn once, crisp, then
 *  blurred by discs of growing radius into a stack, and each point reads the
 *  level its own penumbra needs: near stars are stars, far ones become round
 *  pinhole images of the sun. Leaves are pinhole suns outright: ellipses
 *  (circles stretched by 1 / sin(elevation)), one per gap in the canopy.
 *
 *  Shafts: the air above a point is lit where the beam passes through it, which
 *  is the patch seen from a little further toward the sun; the shader averages
 *  a low-resolution copy of the light along that line. Dust is a few hundred
 *  motes in a slab of air, drifting on a slow divergence-free current, lit only
 *  where their own ray reaches the page through the opening.
 *
 *  Cheap when idle: ~30 fps (60 while motes drift), nothing off screen or in a
 *  hidden tab, a single still frame with data-static or reduced motion.
 *  Without WebGL a 2D canvas draws a still, softened patch.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const RAD = Math.PI / 180;

const SUN = 0.0093;        // the sun's angular diameter (0.53°) in radians: penumbra = distance × SUN
const SKEW = 22;           // degrees the wall stands off square to the light: the lean of the patch
const PRESETS = ['window', 'arch', 'lattice', 'leaves'];
const TILE = 256;          // jali tile, texels per period
const BTEX = 1024;         // branch / mask texture
// blur stack radii, texels (level 0 is the crisp drawing)
const JR = [1.5, 4, 9, 20, 44];
const BR = [3, 8, 18, 40, 88];

// Where the patch sits and how big it is, as fractions of the area's diagonal.
const SHAPE = {
    window: { len: 0.74, wid: 0.27 },
    arch: { len: 0.8, wid: 0.25 },
    lattice: { len: 0.56, wid: 0.32 },
    leaves: { len: 0, wid: 0 },
};

function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const hash1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function vnoise(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash1(i + seed * 101.3), hash1(i + 1 + seed * 101.3), u);
}
function vnoise2(x, y) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const h = (a, b) => hash1(a * 157.31 + b * 37.77);
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(lerp(h(i, j), h(i + 1, j), ux), lerp(h(i, j + 1), h(i + 1, j + 1), ux), uy);
}
const fbm2 = (x, y) => vnoise2(x, y) * 0.6 + vnoise2(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise2(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.1;

// Colour of sunlight at a colour temperature (after Tanner Helland's fit).
function kelvin(K) {
    const t = K / 100;
    const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
    const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
    return [r, g, b].map((v) => clamp(v / 255));
}

// ── shaders ───────────────────────────────────────────────────────────
const HEAD = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;
const QUAD_VS = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;
const QUAD_VS_FBO = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

// The light on the page, for every preset but leaves.
const ILLUM = `
uniform vec2 uW0;            // the foot of the window's centre line on the page (css px)
uniform vec2 uInvA, uInvB;   // page -> aperture plane: u along the wall, v up it
uniform float uSinEl;
uniform float uSoftK;        // penumbra radius per px of ray (sun's half-angle x softness)
uniform float uAA;           // the smallest radius, about half a device pixel
uniform vec4 uOpen;          // half width, sill, height, arch radius
uniform vec4 uBars;          // glazing bar, rail, columns, rows
uniform float uTime;
#ifdef BRANCH
uniform sampler2D uB0, uB1;  // the branch's blur stack, four levels and two
uniform vec4 uBR; uniform vec2 uBR2;
uniform vec3 uBOff;          // branch plane: (u, v) offset, extra ray length
uniform vec4 uBXf;           // branch plane -> texture
uniform vec4 uSway;          // anchor (texture), bend angle, flutter
#endif
#ifdef STACK
uniform sampler2D uJ0, uJ1;  // jali tile or mask: blur stack
uniform vec4 uJR; uniform vec2 uJR2;
uniform vec2 uJK;            // texels per aperture px; 1 = tile repeats
#endif

// Share of a disc of radius 1 lying left of s (the chord area, normalised):
// a straight edge seen through the sun's disc.
float G(float s) { s = clamp(s, -1., 1.); return .5 + (s * sqrt(1. - s * s) + asin(s)) * .3183099; }
float span(float x, float a, float b, float r) { return G((b - x) / r) - G((a - x) / r); }
float strip(float d, float hw, float r) { return G((hw - d) / r) - G((-hw - d) / r); }

// A blur stack read at radius r: level 0 crisp, then discs of radius R.
float lev(vec4 A, vec4 B, float r, vec4 R, vec2 R2) {
    if (r < R.x) return mix(A.r, A.g, r / R.x);
    if (r < R.y) return mix(A.g, A.b, (r - R.x) / (R.y - R.x));
    if (r < R.z) return mix(A.b, A.a, (r - R.y) / (R.z - R.y));
    if (r < R.w) return mix(A.a, B.r, (r - R.z) / (R.w - R.z));
    return mix(B.r, B.g, clamp((r - R.w) / (R2.x - R.w), 0., 1.));
}

float opening(vec2 a, float r) {
    float hw = uOpen.x, v0 = uOpen.y, H = uOpen.z;
#if SHAPE == 0
    // a sash window: columns x rows of panes between glazing bars
    float bw = uBars.x, rw = uBars.y;
    float pw = (2. * hw - (uBars.z - 1.) * bw) / uBars.z;
    float ph = (H - (uBars.w - 1.) * rw) / uBars.w;
    float X = 0., Y = 0.;
    for (int i = 0; i < 4; i++) {
        if (float(i) >= uBars.z) break;
        float a0 = -hw + float(i) * (pw + bw);
        X += span(a.x, a0, a0 + pw, r);
    }
    for (int i = 0; i < 4; i++) {
        if (float(i) >= uBars.w) break;
        float b0 = v0 + float(i) * (ph + rw);
        Y += span(a.y, b0, b0 + ph, r);
    }
    return X * Y;
#elif SHAPE == 1
    // a Roman arched window: two lights and a fanlight
    float vs = v0 + H - hw;                     // the springing line
    vec2 q = vec2(a.x, a.y - vs);
    float d = q.y < 0. ? min(hw - abs(q.x), a.y - v0) : hw - length(q);
    float T = G(d / r);
    float b = uBars.x * .5;
    T *= 1. - strip(q.x, b, r);                                   // mullion
    T *= 1. - strip(q.y, uBars.y * .5, r);                        // transom at the springing
    T *= 1. - strip(a.y - (v0 + (vs - v0) * .5), b, r) * step(q.y, 0.);   // rail across the lights
    float rho = length(q), up = smoothstep(-r, r, q.y);
    float hub = hw * .36;
    T *= 1. - up * strip(rho - hub, b, r);                        // the fan's hub
    float spoke = up * smoothstep(hub - r, hub + r, rho);
    T *= 1. - spoke * strip(dot(q, vec2(.7071, -.7071)), b, r);
    T *= 1. - spoke * strip(dot(q, vec2(.7071, .7071)), b, r);
    return T;
#elif SHAPE == 2
    // a jali: a pointed arch of pierced stone
    float R = uOpen.w, c = R - hw;
    float vs = v0 + H - sqrt(R * R - c * c);
    vec2 q = vec2(a.x, a.y - vs);
    float d = q.y < 0. ? min(hw - abs(q.x), a.y - v0)
                       : min(R - length(q - vec2(c, 0.)), R - length(q + vec2(c, 0.)));
    float T = G(d / r);
    if (T <= 0.) return 0.;
    vec2 tc = vec2(a.x * uJK.x + .5, (a.y - v0) * uJK.x);
    float rt = r * uJK.x * ${TILE.toFixed(1)};
    return T * lev(texture2D(uJ0, tc), texture2D(uJ1, tc), rt, uJR, uJR2);
#else
    // a mask image filling the opening
    float T = span(a.x, -hw, hw, r) * span(a.y, v0, v0 + H, r);
    if (T <= 0.) return 0.;
    vec2 tc = vec2((a.x + hw) / (2. * hw), 1. - (a.y - v0) / H);
    float rt = r * uJK.x;
    return T * lev(texture2D(uJ0, tc), texture2D(uJ1, tc), rt, uJR, uJR2);
#endif
}

#ifdef BRANCH
float branch(vec2 a, float l, float r0) {
    vec2 q = a + uBOff.xy;
    vec2 bu = (q - uBXf.xy) * uBXf.zw;
    bu.y = 1. - bu.y;
    // it bends from where it is held: the tips swing furthest
    vec2 d = bu - uSway.xy;
    float dist = length(d);
    float ang = -uSway.z * pow(dist / 1.2, 1.5);
    float cs = cos(ang), sn = sin(ang);
    bu = uSway.xy + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
    // and the leaves tremble
    float f = uSway.w * dist;
    bu += f * .0042 * vec2(sin(bu.y * 57. + uTime * 7.3) + .5 * sin(bu.x * 131. - uTime * 11.), cos(bu.x * 49. + uTime * 6.1));
    if (bu.x < 0. || bu.y < 0. || bu.x > 1. || bu.y > 1.) return 0.;
    float rt = max((l + uBOff.z) * uSoftK, r0) * uBXf.z * ${BTEX.toFixed(1)};
    return lev(texture2D(uB0, bu), texture2D(uB1, bu), rt, uBR, uBR2);
}
#endif

float illum(vec2 P) {
    vec2 d = P - uW0;
    vec2 a = vec2(dot(uInvA, d), dot(uInvB, d));
    float l = max(a.y, 0.) / uSinEl;            // the ray's length back to the aperture
    float r = max(l * uSoftK, uAA);
    float T = opening(a, r);
#ifdef BRANCH
    if (T > .001) T *= 1. - branch(a, l, uAA);
#endif
    return T;
}
`;

// low-resolution copy of the light over a margin round the area: for shafts and motes
const MAP_FS = HEAD + ILLUM + `
uniform vec4 uMapXf;   // map uv -> page: origin, size
varying vec2 vUv;
void main() {
    vec2 P = uMapXf.xy + vUv * uMapXf.zw;
    gl_FragColor = vec4(illum(P));
}`;

const MAIN_FS = (leaves) => HEAD + (leaves ? '' : ILLUM) + `
uniform sampler2D uMap;
uniform vec4 uMapK;          // page -> map uv: (P + xy) * zw
uniform float uMapInv;       // leaves store darkness
uniform vec2 uView;          // css px of the area
uniform vec2 uT;             // the way the light travels
uniform vec3 uSun;           // its colour x strength
uniform vec3 uShade;         // the room's shade (multiply) where no sun falls
uniform float uHaze, uReach, uGrain, uBloom;
uniform vec3 uGold;          // the filter sunlight lays over what it falls on (multiply)
uniform float uPass;         // 0: the multiply layer, 1: the screen layer
${leaves ? 'uniform float uTime;' : ''}
varying vec2 vUv;

float mapL(vec2 P) { return abs(uMapInv - texture2D(uMap, (P + uMapK.xy) * uMapK.zw).r); }
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

void main() {
    vec2 P = vUv * uView;
${leaves ? '    float L = mapL(P);' : '    float L = illum(P);'}
    // shafts: the air above P is lit where the beam crosses it, the patch
    // seen a little further toward the sun; thinner toward the top of the slab
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    float sh = 0., ws = 0.;
    for (int i = 0; i < 14; i++) {
        float z = (float(i) + j) / 14.;
        float w = 1. - z;
        sh += w * mapL(P + uT * uReach * z);
        ws += w;
    }
    sh /= ws;
    float dith = (hash(gl_FragCoord.yx + 17.17) - .5) / 255.;
    if (uPass < .5) {
        // multiply: the room's faint shade where no sun falls, and where it
        // does, the warm filter of its colour (paper turns cream-gold)
        gl_FragColor = vec4(clamp(mix(uShade, uGold, L) + dith, 0., 1.), 1.);
        return;
    }
    // halation: bright edges bleed a few px, as glare does in the eye or a lens
    float halo = 0.;
    for (int i = 0; i < 8; i++) {
        float an = (float(i) + j) * .7853982;
        vec2 d = vec2(cos(an), sin(an));
        halo += mapL(P + d * 7.) + .6 * mapL(P + d * 20.);
    }
    halo /= 12.8;
    // the screen's own matte surface catches the sun in a fine, still grain
    float g = hash(gl_FragCoord.xy) - .5;
    vec3 x = uSun * (L * (1. + uGrain * g) + uHaze * sh + uBloom * halo);
    // screen, through a filmic shoulder: lit things lift and warm, never flatten
    gl_FragColor = vec4(clamp(1. - exp(-1.3 * x) + dith, 0., 1.), 1.);
}`;

// Pinhole suns: one ellipse per gap in the canopy, multiplied into the map
// (it stores darkness, so overlaps add light and saturate as light does).
const DISC_VS = `
attribute vec2 aC; attribute vec2 aK; attribute vec4 aS;   // centre; corner; radius, softness, weight, -
uniform vec2 uT; uniform float uLong;                       // travel; 1 / sin(elevation)
uniform vec4 uMapXf;
varying vec2 vK; varying vec2 vS;
void main() {
    vec2 n = vec2(-uT.y, uT.x);
    vec2 P = aC + aK.x * aS.x * n + aK.y * aS.x * uLong * uT;
    vec2 m = (P - uMapXf.xy) / uMapXf.zw;
    vK = aK; vS = aS.yz;
    gl_Position = vec4(m * 2. - 1., 0., 1.);
}`;
const DISC_FS = HEAD + `
varying vec2 vK; varying vec2 vS;
void main() {
    float rho = length(vK);
    float s = vS.x;
    float disc = 1. - smoothstep(1. - s, 1. + s * .6, rho);
    // the sun's limb is darker than its middle, and so is every pinhole image of it
    float mu = sqrt(max(0., 1. - min(rho, 1.) * min(rho, 1.)));
    disc *= .62 + .38 * mu;
    gl_FragColor = vec4(vec3(1. - vS.y * disc), 1.);
}`;

const MOTE_VS = `
attribute vec4 aM;   // x, y, height, size (device px)
attribute vec2 aG;   // glint, alpha
uniform vec2 uView; uniform vec2 uT; uniform float uCot;
uniform vec4 uMapK;
varying vec2 vMap; varying vec2 vG;
void main() {
    vec2 ground = aM.xy + uT * uCot * aM.z;     // where this mote's ray reaches the page
    vMap = (ground + uMapK.xy) * uMapK.zw;
    vG = aG;
    gl_Position = vec4(aM.x / uView.x * 2. - 1., 1. - aM.y / uView.y * 2., 0., 1.);
    gl_PointSize = aM.w;
}`;
const MOTE_FS = HEAD + `
uniform sampler2D uMap; uniform float uMapInv;
uniform vec3 uSun;
varying vec2 vMap; varying vec2 vG;
void main() {
    float lit = abs(uMapInv - texture2D(uMap, vMap).r);
    lit = smoothstep(.25, .9, lit);
    float d = length(gl_PointCoord - .5) * 2.;
    float f = 1. - smoothstep(.15, 1., d);
    gl_FragColor = vec4(uSun * (lit * vG.x * vG.y * f * f), 1.);
}`;

// Disc blur for the stacks: Vogel spiral, wrapping or clamped by the texture.
const BLUR_FS = HEAD + `
uniform sampler2D uSrc; uniform vec2 uR;
varying vec2 vUv;
void main() {
    float s = 0.;
    for (int i = 0; i < 96; i++) {
        float fi = float(i) + .5;
        float rr = sqrt(fi / 96.), an = fi * 2.3999632;
        s += texture2D(uSrc, vUv + uR * rr * vec2(cos(an), sin(an))).a;
    }
    gl_FragColor = vec4(s / 96.);
}`;
const PACK_FS = HEAD + `
uniform sampler2D uA, uB, uC, uD;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(uA, vUv).a, texture2D(uB, vUv).a, texture2D(uC, vUv).a, texture2D(uD, vUv).a); }`;

// ── drawings ──────────────────────────────────────────────────────────

// A jali tile: the 8-fold star pattern of the 4.8.8 tiling by Hankin's method
// (rays from every edge's midpoint, meeting inside each polygon), cut as ribs
// of stone. One period, seamless; alpha = open.
function drawJali(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    const e = 1 / (1 + Math.SQRT2);               // octagon edge, period 1
    const THETA = 67.5 * RAD;
    const polys = [];
    const ngon = (cx, cy, n, R, a0) => {
        const v = [];
        for (let k = 0; k < n; k++) { const a = a0 + (k * 2 * Math.PI) / n; v.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]); }
        return v;
    };
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        polys.push(ngon(i + 0.5, j + 0.5, 8, e / (2 * Math.sin(Math.PI / 8)), Math.PI / 8));
        polys.push(ngon(i, j, 4, e / Math.SQRT2, 0));
    }
    const segs = [];
    for (const v of polys) {
        const n = v.length;
        const cx = v.reduce((s, p) => s + p[0], 0) / n, cy = v.reduce((s, p) => s + p[1], 0) / n;
        const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        const dir = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], m = Math.hypot(dx, dy); return [dx / m, dy / m]; };
        const inward = (m, d) => { let nx = -d[1], ny = d[0]; if ((cx - m[0]) * nx + (cy - m[1]) * ny < 0) { nx = -nx; ny = -ny; } return [nx, ny]; };
        for (let k = 0; k < n; k++) {
            const A = v[(k + n - 1) % n], B = v[k], C = v[(k + 1) % n];
            const ma = mid(A, B), mb = mid(B, C);
            const da = dir(A, B), db = dir(B, C);
            const na = inward(ma, da), nb = inward(mb, db);
            const ra = [Math.cos(THETA) * da[0] + Math.sin(THETA) * na[0], Math.cos(THETA) * da[1] + Math.sin(THETA) * na[1]];
            const rb = [-Math.cos(THETA) * db[0] + Math.sin(THETA) * nb[0], -Math.cos(THETA) * db[1] + Math.sin(THETA) * nb[1]];
            // ma + s ra = mb + t rb
            const den = ra[0] * -rb[1] - ra[1] * -rb[0];
            if (Math.abs(den) < 1e-6) continue;
            const dx = mb[0] - ma[0], dy = mb[1] - ma[1];
            const s = (dx * -rb[1] - dy * -rb[0]) / den;
            const X = [ma[0] + s * ra[0], ma[1] + s * ra[1]];
            segs.push([ma, X], [mb, X]);
        }
    }
    g.globalCompositeOperation = 'destination-out';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = '#000';
    g.lineWidth = size * 0.105;
    g.beginPath();
    for (const [p, q] of segs) {
        g.moveTo(p[0] * size, p[1] * size);
        g.lineTo(q[0] * size, q[1] * size);
    }
    g.stroke();
    return c;
}

// A branch outside the window, in its own plane: an olive bough with narrow
// leaves in pairs, or a bare twig. Drawn black on clear; alpha = shadow.
function drawBranch(kind, size, seed) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const R = rng(seed);
    const S = size;
    g.fillStyle = g.strokeStyle = '#000';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const bez = (p, t) => {
        const u = 1 - t;
        return [
            u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
            u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
        ];
    };
    const limb = (p, w0, w1, n = 48) => {
        let prev = bez(p, 0);
        for (let i = 1; i <= n; i++) {
            const t = i / n, q = bez(p, t);
            g.lineWidth = lerp(w0, w1, Math.pow(t, 0.8)) * S;
            g.beginPath();
            g.moveTo(prev[0] * S, prev[1] * S);
            g.lineTo(q[0] * S, q[1] * S);
            g.stroke();
            prev = q;
        }
    };
    const leaf = (x, y, ang, L, W) => {
        const dx = Math.cos(ang), dy = Math.sin(ang), nx = -dy, ny = dx;
        const bend = (R() - 0.5) * 0.3;
        const tip = [x + dx * L + nx * L * bend * 0.3, y + dy * L + ny * L * bend * 0.3];
        g.beginPath();
        g.moveTo(x * S, y * S);
        g.quadraticCurveTo((x + dx * L * 0.45 + nx * W * (1 + bend)) * S, (y + dy * L * 0.45 + ny * W * (1 + bend)) * S, tip[0] * S, tip[1] * S);
        g.quadraticCurveTo((x + dx * L * 0.5 - nx * W * (1 - bend)) * S, (y + dy * L * 0.5 - ny * W * (1 - bend)) * S, x * S, y * S);
        g.fill();
    };
    const tangent = (p, t) => { const a = bez(p, Math.max(0, t - 0.01)), b = bez(p, Math.min(1, t + 0.01)); return Math.atan2(b[1] - a[1], b[0] - a[0]); };

    // twig with leaves (olive) or buds (twig), recursive
    const shoot = (x, y, ang, len, w, depth) => {
        const curl = (R() - 0.5) * 0.7;
        const p = [[x, y],
            [x + Math.cos(ang) * len * 0.35, y + Math.sin(ang) * len * 0.35],
            [x + Math.cos(ang + curl * 0.5) * len * 0.7, y + Math.sin(ang + curl * 0.5) * len * 0.7],
            [x + Math.cos(ang + curl) * len, y + Math.sin(ang + curl) * len]];
        limb(p, w, w * 0.35, 20);
        if (kind === 'olive') {
            const pairs = Math.round(len / 0.03);
            for (let k = 1; k <= pairs; k++) {
                const t = 0.15 + (0.85 * k) / pairs;
                const [px, py] = bez(p, t), ta = tangent(p, t);
                const L = (0.05 + R() * 0.03) * (k === pairs ? 1.1 : 1);
                for (const side of [-1, 1]) {
                    if (R() < 0.12) continue;
                    leaf(px, py, ta + side * (0.45 + R() * 0.45), L, L * (0.12 + R() * 0.05));
                }
            }
            const [ex, ey] = bez(p, 1);
            leaf(ex, ey, tangent(p, 1) + (R() - 0.5) * 0.3, 0.06, 0.009);
        } else if (depth < 3) {
            const n = 2 + Math.floor(R() * 2);
            for (let k = 0; k < n; k++) {
                const t = 0.35 + R() * 0.6, [px, py] = bez(p, t), ta = tangent(p, t);
                shoot(px, py, ta + (R() < 0.5 ? -1 : 1) * (0.4 + R() * 0.5), len * (0.45 + R() * 0.25), w * 0.55, depth + 1);
            }
        } else {
            const [ex, ey] = bez(p, 1);
            g.beginPath(); g.arc(ex * S, ey * S, w * 0.9 * S, 0, 7); g.fill();
        }
    };

    // the bough: in from the upper right, drooping across the upper panes
    const bough = [[1.1, -0.06], [0.8, 0.08], [0.55, 0.3], [0.2, 0.5]];
    limb(bough, kind === 'olive' ? 0.03 : 0.026, 0.006, 80);
    const n = kind === 'olive' ? 9 : 7;
    for (let k = 0; k < n; k++) {
        const t = 0.12 + (0.86 * k) / n + R() * 0.04;
        const [px, py] = bez(bough, t), ta = tangent(bough, t);
        const side = k % 2 ? 1 : -1;
        shoot(px, py, ta + side * (0.5 + R() * 0.45), (kind === 'olive' ? 0.14 : 0.18) + R() * 0.1, 0.009 * (1 - t * 0.5), 1);
    }
    shoot(0.2, 0.5, tangent(bough, 1), 0.12, 0.007, 1);
    return c;
}

// ── the component ─────────────────────────────────────────────────────

const scoped = new Set();   // element-attached lights on the page: a viewport light gives way to them

function readCfg(host, opts) {
    const ds = host.dataset;
    const get = (k) => (opts[k] !== undefined ? opts[k] : ds[k]);
    const num = (k, d) => { const v = get(k); return v == null || v === '' || !isFinite(Number(v)) ? d : Number(v); };
    const flag = (k) => { const v = get(k); return v === true || v === '' || v === 'true' || v === '1'; };
    const pair = (k) => {
        const v = get(k);
        if (Array.isArray(v) && v.length >= 2 && v.every((x) => isFinite(x))) return v.map(Number);
        if (typeof v === 'string' && v.trim()) { const p = v.trim().split(/[\s,]+/).map(Number); if (p.length >= 2 && p.every(isFinite)) return p.slice(0, 2); }
        return null;
    };
    const preset = PRESETS.includes(get('preset')) ? get('preset') : 'window';
    const panes = String(get('panes') || '2x2').split('x').map((n) => clamp(Math.round(Number(n)) || 2, 1, 4));
    return {
        preset,
        aperture: get('aperture') || '',
        sun: pair('sun'),
        at: pair('at'),
        size: Math.max(0.2, num('size', 1)),
        softness: Math.max(0, num('softness', 2.2)),
        clouds: clamp(num('clouds', 0.4)),
        wind: clamp(num('wind', 0.5)),
        warmth: clamp(num('warmth', 0.6)),
        golden: flag('golden'),
        intensity: Math.max(0, num('intensity', 1)),
        shade: clamp(num('shade', 0.03)),
        haze: clamp(num('haze', 0.35)),
        motes: clamp(num('motes', 0.5)),
        branch: ['olive', 'twig'].includes(get('branch')) && preset !== 'leaves' ? get('branch') : 'none',
        drift: clamp(num('drift', 0)),
        static: flag('static'),
        panes: [panes[0], panes[1] || panes[0]],
        attach: get('attach') === 'viewport' || get('attach') === 'element' ? get('attach')
            : host === document.body || host === document.documentElement ? 'viewport' : 'element',
        seed: num('seed', 7),
    };
}

export function lightRays(host, opts = {}) {
    if (!host) return Object.assign(() => {}, { set() {} });
    let given = { ...opts };
    let cfg = readCfg(host, given);
    const viewportMode = () => cfg.attach === 'viewport';

    let dead = false;
    let canvas = null, gl = null, fallback = null;
    let mulCanvas = null, mulCtx = null;     // the multiply layer, under the light
    let W = 0, H = 0, dpr = 1;
    let P = {};                  // programs
    let quad = null;
    let map = null;              // { tex, fbo, w, h, x, y, ew, eh, inv }
    let jali = null, bstack = null, mask = null;    // blur stacks
    let maskImg = null;
    let room = null;             // the window in its wall
    let ref = null;              // the sun the room was laid out for
    let canopy = null, discBuf = null, discData = null;
    let motes = null, moteBuf = null, moteData = null;
    let visible = false, raf = 0, last = 0, lastDraw = 0, clock = 0;
    let presence = 1, presenceT = 1;
    let driftNow = 0, driftV = 0;
    let dark = false;
    let clouds = { events: [], next: 0 };
    let sizeTimer = 0;
    const off = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };
    const frozen = () => cfg.static || calm.matches;
    const self = { vis: 0 };

    // ── GL plumbing ───────────────────────────────────────────────────
    function compile(vs, fs, defs = '') {
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('light-rays:', gl.getShaderInfoLog(s)); return null; }
            return s;
        };
        const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, defs + fs);
        if (!v || !f) return null;
        const p = gl.createProgram();
        gl.attachShader(p, v);
        gl.attachShader(p, f);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
        const cache = {};
        return {
            p,
            u: (n) => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))),
            a: (n) => gl.getAttribLocation(p, n),
        };
    }
    function texture(w, h, wrap, src) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        return t;
    }
    function target(tex) {
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return f;
    }
    function useQuad(prog) {
        gl.useProgram(prog.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        const loc = prog.a('p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }
    function bindTex(prog, name, unit, tex) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(prog.u(name), unit);
    }

    // Draw once crisp, then blur by discs of growing radius (each level from
    // the last, so the big ones stay smooth), packed four levels to a texture.
    function makeStack(src, size, wrap, radii) {
        const t0 = texture(size, size, wrap, src);
        const levels = [t0];
        const blur = P.blur;
        useQuad(blur);
        gl.viewport(0, 0, size, size);
        gl.disable(gl.BLEND);
        let prevR = 0;
        const fbos = [];
        for (const R of radii) {
            const t = texture(size, size, wrap);
            const f = target(t);
            fbos.push(f);
            bindTex(blur, 'uSrc', 0, levels[levels.length - 1]);
            const inc = Math.sqrt(Math.max(0.25, R * R - prevR * prevR));
            gl.uniform2f(blur.u('uR'), inc / size, inc / size);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            levels.push(t);
            prevR = R;
        }
        const pack = P.pack;
        const out = [];
        for (const group of [levels.slice(0, 4), levels.slice(4, 8)]) {
            const t = texture(size, size, wrap);
            const f = target(t);
            useQuad(pack);
            gl.viewport(0, 0, size, size);
            ['uA', 'uB', 'uC', 'uD'].forEach((n, i) => bindTex(pack, n, i, group[Math.min(i, group.length - 1)]));
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.deleteFramebuffer(f);
            out.push(t);
        }
        fbos.forEach((f) => gl.deleteFramebuffer(f));
        levels.forEach((t) => gl.deleteTexture(t));
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { a: out[0], b: out[1], R: radii };
    }
    const freeStack = (s) => { if (s && gl) { gl.deleteTexture(s.a); gl.deleteTexture(s.b); } };

    function buildPrograms() {
        const shape = { window: 0, arch: 1, lattice: 2 }[cfg.preset];
        const leaves = cfg.preset === 'leaves';
        let defs = `#define SHAPE ${cfg.aperture && !leaves ? 3 : shape}\n`;
        if (!leaves && (shape === 2 || cfg.aperture)) defs += '#define STACK\n';
        if (!leaves && cfg.branch !== 'none') defs += '#define BRANCH\n';
        for (const k of ['map', 'main', 'disc']) if (P[k]) { gl.deleteProgram(P[k].p); P[k] = null; }
        P.main = compile(QUAD_VS, MAIN_FS(leaves), defs);
        if (leaves) P.disc = compile(DISC_VS, DISC_FS);
        else P.map = compile(QUAD_VS_FBO, MAP_FS, defs);
        if (!P.blur) P.blur = compile(QUAD_VS_FBO, BLUR_FS);
        if (!P.pack) P.pack = compile(QUAD_VS_FBO, PACK_FS);
        if (!P.mote) P.mote = compile(MOTE_VS, MOTE_FS);
        return P.main && (leaves ? P.disc : P.map) && P.blur && P.pack && P.mote;
    }

    function buildStacks() {
        freeStack(jali); freeStack(bstack); freeStack(mask);
        jali = bstack = mask = null;
        if (cfg.preset === 'leaves') return;
        if (cfg.aperture && maskImg) {
            const c = document.createElement('canvas');
            c.width = c.height = BTEX;
            const g = c.getContext('2d');
            g.drawImage(maskImg, 0, 0, BTEX, BTEX);
            const d = g.getImageData(0, 0, BTEX, BTEX);
            let solid = true;
            for (let i = 3; i < d.data.length; i += 64) if (d.data[i] < 250) { solid = false; break; }
            if (solid) {   // an opaque image: light where it is light
                for (let i = 0; i < d.data.length; i += 4) {
                    d.data[i + 3] = 0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2];
                }
                g.putImageData(d, 0, 0);
            }
            mask = makeStack(c, BTEX, gl.CLAMP_TO_EDGE, BR);
        } else if (cfg.preset === 'lattice') {
            jali = makeStack(drawJali(TILE), TILE, gl.REPEAT, JR);
        }
        if (cfg.branch !== 'none') bstack = makeStack(drawBranch(cfg.branch, BTEX, cfg.seed), BTEX, gl.CLAMP_TO_EDGE, BR);
    }

    // ── geometry ──────────────────────────────────────────────────────
    function defaultSun() {
        if (cfg.preset === 'leaves') return W >= H ? [-50, 52] : [-25, 55];
        return W >= H ? [-58, 34] : [-30, 38];
    }
    // the sun now: as given, plus golden hour, plus the drift with scroll and time
    const baseSun = () => cfg.sun || defaultSun();
    function sunNow() {
        const base = baseSun();
        let az = base[0], el = base[1];
        if (cfg.golden) el -= 12;
        az += driftNow * 14 * Math.sign(az || -1) * -1 + clock * 0.0042;
        el -= driftNow * 11;
        return [az, clamp(el, 6, 80)];
    }
    const travel = (az) => [-Math.sin(az * RAD), Math.cos(az * RAD)];

    // The room: a window in a wall off the page, laid out once for the
    // reference sun so that its patch lands at data-at. When the sun moves,
    // the window stays where it is and the patch moves, as it would.
    function layoutRoom() {
        const D = Math.hypot(W, H);
        const [az, el] = ref;
        const t = travel(az), cot = 1 / Math.tan(el * RAD);
        const perp = [-t[1], t[0]];
        const s = SKEW * RAD;
        const wd = [perp[0] * Math.cos(s) - perp[1] * Math.sin(s), perp[0] * Math.sin(s) + perp[1] * Math.cos(s)];
        const shp = SHAPE[cfg.preset] || SHAPE.window;
        const portrait = H > W * 1.15;
        const len = shp.len * D * cfg.size * (portrait ? (cfg.preset === 'lattice' ? 1.12 : 0.92) : 1);
        const Hw = len / cot;
        let hw = (shp.wid * D * cfg.size * (portrait ? 0.95 : 1)) / Math.cos(s) / 2;
        if (cfg.aperture && maskImg) hw = Math.min(hw * 1.6, (Hw * maskImg.naturalWidth) / maskImg.naturalHeight / 2);
        const v0 = 0.03 * Hw;
        const at = cfg.at || [0.56, 0.5];
        const c = [at[0] * W, at[1] * H];
        // on a tall screen a jali's crisp near half is what should land on the spot
        const vc = v0 + Hw * (portrait && cfg.preset === 'lattice' ? 0.34 : 0.5);
        const W0 = [c[0] - vc * cot * t[0], c[1] - vc * cot * t[1]];
        const [cols, rows] = cfg.panes;
        room = {
            W0, wd, hw, v0, Hw,
            bar: hw * 2 * 0.034, rail: hw * 2 * (rows === 2 ? 0.05 : 0.034), cols, rows,
            archR: hw * 1.3,
            jP: (hw * 2) / 4.6,        // jali period: four and a half stars across
        };
    }

    // ── layout ────────────────────────────────────────────────────────
    function measure() {
        if (viewportMode()) {
            W = Math.max(1, document.documentElement.clientWidth || innerWidth);
            H = Math.max(1, innerHeight);
        } else {
            const r = host.getBoundingClientRect();
            W = Math.max(1, r.width);
            H = Math.max(1, r.height);
        }
    }

    function layout() {
        measure();
        if (!ref) ref = baseSun();
        const raw = Math.min(devicePixelRatio || 1, 2);
        dpr = raw;
        if (W * H * dpr * dpr > 4.6e6) dpr = Math.sqrt(4.6e6 / (W * H));    // big hosts: fewer pixels
        layoutRoom();
        dark = isDark();
        if (fallback) return draw2d();
        canvas.width = mulCanvas.width = Math.round(W * dpr);
        canvas.height = mulCanvas.height = Math.round(H * dpr);

        // the light map: a margin round the area so shafts and motes can look
        // toward the sun past the edge
        const leaves = cfg.preset === 'leaves';
        const D = Math.hypot(W, H);
        const M = Math.round(D * (leaves ? 0.22 : 0.42));
        // texels per css px: the pinhole suns need about one, shafts far less
        const k = leaves ? Math.min(1, Math.sqrt(3.2e6 / ((W + 2 * M) * (H + 2 * M)))) : 0.25;
        if (map) { gl.deleteTexture(map.tex); gl.deleteFramebuffer(map.fbo); }
        const ew = W + 2 * M, eh = H + 2 * M;
        const mw = Math.max(8, Math.round(ew * k)), mh = Math.max(8, Math.round(eh * k));
        const tex = texture(mw, mh, gl.CLAMP_TO_EDGE);
        map = { tex, fbo: target(tex), w: mw, h: mh, x: -M, y: -M, ew, eh, M, inv: leaves ? 1 : 0 };
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        if (leaves) makeCanopy(); else canopy = null;
        makeMotes();
    }

    function isDark() {
        let el = viewportMode() ? document.body : host;
        while (el && el.nodeType === 1) {
            const c = getComputedStyle(el).backgroundColor;
            const m = c && c.match(/[\d.]+/g);
            if (m && (m.length < 4 || Number(m[3]) > 0.5)) {
                const [r, g, b] = m.slice(0, 3).map((x) => Number(x) / 255);
                return 0.3 * r + 0.59 * g + 0.11 * b < 0.4;
            }
            el = el.parentElement;
        }
        return matchMedia('(prefers-color-scheme: dark)').matches;
    }

    // ── canopy (leaves) ───────────────────────────────────────────────
    // Gaps in a canopy high above. Each is a pinhole that throws an image of
    // the sun: an ellipse whose size is set by the gap's height, not its shape.
    // They cluster where the leaves are thin, and sway with the branches.
    function makeCanopy() {
        const R = rng(cfg.seed * 7 + 3);
        const D = Math.hypot(W, H);
        const R0 = clamp(D * 0.0105, 7, 19) * cfg.size;
        const cell = R0 * 0.95;
        const list = [];
        const x0 = map.x, y0 = map.y, x1 = map.x + map.ew, y1 = map.y + map.eh;
        const fs = R0 * 15;
        for (let y = y0; y < y1; y += cell) {
            for (let x = x0; x < x1; x += cell) {
                const px = x + (R() - 0.5) * cell * 1.2, py = y + (R() - 0.5) * cell * 1.2;
                const dens = fbm2(px / fs + 3.1, py / fs + 8.7);
                // most gaps are where the leaves are thin; a few strays elsewhere
                // and inside a thin patch, single leaves and twigs still shade it in a lace
                const lace = smooth(0.3, 0.62, vnoise2(px / (R0 * 3.2) + 1.7, py / (R0 * 3.2) + 4.1) * 0.7 + vnoise2(px / (R0 * 1.6), py / (R0 * 1.6)) * 0.3);
                if (R() > smooth(0.46, 0.68, dens) * (0.2 + 0.8 * lace) * 0.55 + 0.005) continue;
                const h = 0.8 + R() * 0.5;           // one canopy: the suns are much of a size
                // most gaps are partly covered by a leaf: dimmer suns, a few bright ones
                list.push({
                    x: px, y: py, r: R0 * h, soft: 0.1 + R() * 0.22,
                    w: (0.12 + 0.78 * Math.pow(R(), 1.7)) * (0.75 + 0.25 * dens), ph: R() * 6.283, fq: 0.6 + R() * 1.7,
                    sway: 0.6 + R() * 0.8,
                });
            }
        }
        // a few larger openings: big soft suns
        const nb = Math.round((map.ew * map.eh) / (R0 * R0 * 900));
        for (let i = 0; i < nb; i++) {
            const px = x0 + R() * map.ew, py = y0 + R() * map.eh;
            if (fbm2(px / fs + 3.1, py / fs + 8.7) < 0.48) continue;
            list.push({ x: px, y: py, r: R0 * (1.8 + R() * 1.2), soft: 0.35 + R() * 0.25, w: 0.2 + R() * 0.15, ph: R() * 6.283, fq: 0.3 + R() * 0.5, sway: 1 });
        }
        canopy = { list, R0 };
        discData = new Float32Array(list.length * 6 * 8);
        if (!discBuf) discBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, discBuf);
        gl.bufferData(gl.ARRAY_BUFFER, discData.byteLength, gl.DYNAMIC_DRAW);
    }

    // ── motes ─────────────────────────────────────────────────────────
    function makeMotes() {
        const n = frozen() ? 0 : Math.min(420, Math.round((cfg.motes * W * H) / 2600));
        if (!n) { motes = null; return; }
        const R = rng(cfg.seed * 13 + 1);
        const T = Math.hypot(W, H) * 0.3;
        const m = [];
        for (let i = 0; i < n; i++) {
            m.push({
                x: R() * W, y: R() * H, z: R() * T,
                vx: 0, vy: 0, vz: 0,
                s: 0.6 + Math.pow(R(), 2.2) * 1.6,       // most are specks, a few are flakes
                ph: R() * 6.283, spin: 0.5 + R() * 2.6, b: 0.5 + R() * 0.5,
            });
        }
        motes = { list: m, T };
        moteData = new Float32Array(n * 6);
        if (!moteBuf) moteBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, moteBuf);
        gl.bufferData(gl.ARRAY_BUFFER, moteData.byteLength, gl.DYNAMIC_DRAW);
    }

    // A slow, divergence-free current (the curl of a few drifting sines), a
    // little rise where the air is warm, and Brownian jostling on top.
    function stepMotes(dt) {
        const { list, T } = motes;
        const t = clock;
        const k1 = 0.0042, k2 = 0.0071, k3 = 0.0113;
        for (const m of list) {
            const x = m.x, y = m.y;
            // stream function psi = sum a sin(kx x + ...) cos(ky y + ...): v = (dpsi/dy, -dpsi/dx)
            const a1 = k1 * x + t * 0.05, b1 = k1 * 1.3 * y - t * 0.04;
            const a2 = k2 * x * 0.8 - t * 0.07 + 1.7, b2 = k2 * y + t * 0.06 + 0.4;
            const a3 = k3 * (x + y) * 0.7 + t * 0.11, b3 = k3 * (x - y) * 0.7 - t * 0.09;
            const ux = -1.3 * k1 * Math.sin(a1) * Math.sin(b1) * 900 - k2 * Math.sin(a2) * Math.sin(b2) * 500 + Math.cos(a3) * Math.cos(b3) * 3;
            const uy = -k1 * Math.cos(a1) * Math.cos(b1) * 900 - 0.8 * k2 * Math.cos(a2) * Math.cos(b2) * 500 + Math.sin(a3) * Math.sin(b3) * 3 - 2.2;
            const relax = 1 - Math.exp(-dt / 1.6);
            m.vx += (ux - m.vx) * relax + (Math.random() - 0.5) * 9 * Math.sqrt(dt);
            m.vy += (uy - m.vy) * relax + (Math.random() - 0.5) * 9 * Math.sqrt(dt);
            m.vz += -m.vz * relax + (Math.random() - 0.5) * 7 * Math.sqrt(dt);
            m.x += m.vx * dt;
            m.y += m.vy * dt;
            m.z += m.vz * dt;
            if (m.z < 0) { m.z = -m.z; m.vz = Math.abs(m.vz); }
            if (m.z > T) { m.z = 2 * T - m.z; m.vz = -Math.abs(m.vz); }
            const pad = 24;
            if (m.x < -pad) m.x += W + 2 * pad; else if (m.x > W + pad) m.x -= W + 2 * pad;
            if (m.y < -pad) m.y += H + 2 * pad; else if (m.y > H + pad) m.y -= H + 2 * pad;
            m.ph += m.spin * dt;
        }
    }

    // ── weather ───────────────────────────────────────────────────────
    // Thin cloud: a slow breath of a few percent, and now and then a cloud
    // that dims the light by 30-60% (scaled by data-clouds) for a few seconds,
    // softening every edge while it passes (the sun's disc swells into haze).
    function cloudAt(t) {
        const c = cfg.clouds;
        if (!c) return 0;
        const ev = clouds.events;
        while (clouds.next < t + 30) {
            const first = !ev.length;
            const start = first ? 6 + Math.random() * 4 : clouds.next;
            const dur = 4.5 + Math.random() * 5;
            ev.push({ start, dur, depth: (0.3 + Math.random() * 0.3) * Math.min(1, c * 1.4) });
            clouds.next = start + dur + lerp(70, 16, c) * (0.6 + Math.random() * 0.8);
        }
        while (ev.length && ev[0].start + ev[0].dur < t - 1) ev.shift();
        let dip = 0;
        for (const e of ev) {
            const k = (t - e.start) / e.dur;
            if (k <= 0 || k >= 1) continue;
            const s = k < 0.35 ? smooth(0, 0.35, k) : k > 0.65 ? 1 - smooth(0.65, 1, k) : 1;
            dip = Math.max(dip, e.depth * s);
        }
        const breath = (vnoise(t / 21, 1) - 0.5) * 0.07 + (vnoise(t / 6.7, 2) - 0.5) * 0.03;
        return clamp(dip + breath * c);
    }
    // Wind: a breeze that rises into gusts and falls away.
    function gustAt(t) {
        const n = vnoise(t / 4.3, 3) * 0.55 + vnoise(t / 1.7, 4) * 0.3 + vnoise(t / 0.71, 5) * 0.15;
        return Math.pow(n, 1.8) * 1.6;
    }

    // ── render ────────────────────────────────────────────────────────
    function uniformsGeo(prog, sun, soft) {
        const [az, el] = sun;
        const t = travel(az), cot = 1 / Math.tan(el * RAD), sinEl = Math.sin(el * RAD);
        const r = room;
        // page = W0 + u wd + v cot t  ->  invert
        const a = r.wd[0], b = cot * t[0], c = r.wd[1], d = cot * t[1];
        const det = a * d - b * c || 1e-6;
        gl.uniform2f(prog.u('uW0'), r.W0[0], r.W0[1]);
        gl.uniform2f(prog.u('uInvA'), d / det, -b / det);
        gl.uniform2f(prog.u('uInvB'), -c / det, a / det);
        gl.uniform1f(prog.u('uSinEl'), sinEl);
        gl.uniform1f(prog.u('uSoftK'), (SUN / 2) * soft);
        gl.uniform1f(prog.u('uAA'), 0.6 / Math.max(dpr, 1) * Math.max(1, 1 / cot));
        gl.uniform4f(prog.u('uOpen'), r.hw, r.v0, r.Hw, r.archR);
        gl.uniform4f(prog.u('uBars'), r.bar, r.rail, r.cols, r.rows);
        gl.uniform1f(prog.u('uTime'), clock);
        let unit = 2;
        const st = jali || mask;
        if (st) {
            bindTex(prog, 'uJ0', unit++, st.a);
            bindTex(prog, 'uJ1', unit++, st.b);
            gl.uniform4f(prog.u('uJR'), st.R[0], st.R[1], st.R[2], st.R[3]);
            gl.uniform2f(prog.u('uJR2'), st.R[4], 0);
            gl.uniform2f(prog.u('uJK'), jali ? 1 / r.jP : BTEX / (2 * r.hw), 0);
        }
        if (bstack) {
            bindTex(prog, 'uB0', unit++, bstack.a);
            bindTex(prog, 'uB1', unit++, bstack.b);
            gl.uniform4f(prog.u('uBR'), bstack.R[0], bstack.R[1], bstack.R[2], bstack.R[3]);
            gl.uniform2f(prog.u('uBR2'), bstack.R[4], 0);
            // the branch hangs a little way outside the window, so its shadow
            // is softer than the bars' and slides against them as the sun moves
            const Db = r.Hw * 0.42;
            const nrm = Math.abs(r.wd[0] * t[1] - r.wd[1] * t[0]) || 0.3;
            const E = Db / (Math.cos(el * RAD) * nrm);
            const du = -E * Math.cos(el * RAD) * (t[0] * r.wd[0] + t[1] * r.wd[1]);
            gl.uniform3f(prog.u('uBOff'), du, E * sinEl - r.Hw * 0.25, E);
            const bx = -r.hw * 1.5, by = r.v0 - r.Hw * 0.1, bw = r.hw * 3, bh = r.Hw * 1.3;
            gl.uniform4f(prog.u('uBXf'), bx, by, 1 / bw, 1 / bh);
            const g = gustAt(clock * 0.9) * cfg.wind;
            const sway = frozen() ? 0.012 : (0.012 + 0.05 * g + 0.012 * Math.sin(clock * 0.9)) * cfg.wind;
            gl.uniform4f(prog.u('uSway'), 1.1, -0.06, sway, frozen() ? 0 : cfg.wind * (0.4 + g));
        }
    }

    function render(dt) {
        const leaves = cfg.preset === 'leaves';
        const sun = sunNow();
        const [az, el] = sun;
        const t = travel(az), cot = 1 / Math.tan(el * RAD);
        const cloud = frozen() ? 0 : cloudAt(clock);
        // a jali stands close to the floor it lights: its penumbrae are narrower
        const soft = cfg.softness * (cfg.preset === 'lattice' ? 0.6 : 1) * (1 + 1.6 * cloud) * (1 + (1 - presence) * 2);

        // the light map
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, map.fbo);
        gl.viewport(0, 0, map.w, map.h);
        if (leaves) {
            gl.clearColor(1, 1, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            drawCanopy(t, el, cloud);
        } else {
            useQuad(P.map);
            uniformsGeo(P.map, sun, soft);
            gl.uniform4f(P.map.u('uMapXf'), map.x, map.y, map.ew, map.eh);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // the page
        gl.viewport(0, 0, canvas.width, canvas.height);
        const m = P.main;
        useQuad(m);
        if (!leaves) uniformsGeo(m, sun, soft);
        bindTex(m, 'uMap', 0, map.tex);
        const mapK = [-map.x, -map.y, 1 / map.ew, 1 / map.eh];
        gl.uniform4f(m.u('uMapK'), ...mapK);
        gl.uniform1f(m.u('uMapInv'), map.inv);
        gl.uniform2f(m.u('uView'), W, H);
        gl.uniform2f(m.u('uT'), t[0], t[1]);
        const sunRGB = sunColour(cloud);
        gl.uniform3f(m.u('uSun'), ...sunRGB);
        gl.uniform3f(m.u('uShade'), ...shadeRGB(cloud));
        gl.uniform1f(m.u('uHaze'), cfg.haze * 0.16 * (cfg.golden ? 1.4 : 1));
        const reach = Math.min(map.M, Math.hypot(W, H) * 0.3 * cot);
        gl.uniform1f(m.u('uReach'), reach);
        gl.uniform1f(m.u('uGrain'), 0.07);
        gl.uniform3f(m.u('uGold'), ...goldRGB(cloud));
        gl.uniform1f(m.u('uBloom'), 0.22);
        if (leaves) gl.uniform1f(m.u('uTime'), clock);
        // two layers from one context: the multiply layer is drawn, copied to
        // its own 2D canvas, then the screen layer is drawn over the buffer
        gl.uniform1f(m.u('uPass'), 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        mulCtx.globalCompositeOperation = 'copy';
        mulCtx.drawImage(canvas, 0, 0);
        gl.uniform1f(m.u('uPass'), 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // dust in the beam
        if (motes && presence > 0.01) {
            stepMotes(dt);
            drawMotes(t, cot, sunRGB, mapK);
        }
    }

    function sunColour(cloud) {
        const K = cfg.golden ? 2450 : lerp(5900, 3300, cfg.warmth);
        const c = kelvin(K + cloud * 900);
        const I = (dark ? 0.42 : 0.56) * cfg.intensity * (1 - cloud) * presence * (cfg.preset === 'leaves' ? 0.95 : 1);
        // the lift is warmer than the white point: glare on a screen reads gold
        return c.map((x) => Math.pow(x, 1.5) * I);
    }
    function shadeRGB(cloud) {
        // the room's ambient is skylight: a faint dimming, a touch cool, that
        // keeps the paper's own colour. Under a canopy the shade is deeper.
        const deep = cfg.preset === 'leaves' ? 4 : 1;
        const s = cfg.shade * deep * (dark ? 0.35 : 1) * (1 - cloud * 0.5) * presence;
        // (under leaves an even dimming, so the paper keeps its colour in the shade)
        return (cfg.preset === 'leaves' ? [1, 1, 0.97] : [1, 0.97, 0.82]).map((k) => 1 - s * k);
    }
    // what the sun's colour does to the things it lights: a warm filter
    function goldRGB(cloud) {
        const K = cfg.golden ? 2450 : lerp(5900, 3300, cfg.warmth);
        const c = kelvin(K + cloud * 900);
        const G = (dark ? 0.06 : 0.24) * cfg.intensity * (1 - cloud) * presence * (cfg.golden ? 1.4 : 1);
        return c.map((x) => 1 - G * (1 - x));
    }

    function drawCanopy(t, el, cloud) {
        const { list, R0 } = canopy;
        const n = [-t[1], t[0]];
        const wind = frozen() ? 0 : cfg.wind;
        const tm = clock;
        const ww = [0.8, 0.6];       // the way the wind blows across the page
        const long = 1 / Math.sin(el * RAD);
        const grow = 1 + cloud * 0.5;
        let o = 0;
        const d = discData;
        for (const g of list) {
            // gusts travel across the canopy as a wave; each spray of leaves
            // lags and overshoots a little
            const lag = (g.x * ww[0] + g.y * ww[1]) / 260;
            const gust = gustAt(tm - lag) * wind;
            const sway = (gust * 0.9 + 0.25 * wind * Math.sin(tm * 0.8 * g.sway + g.ph)) * R0 * 0.9 * g.sway;
            const flut = wind * R0 * 0.12 * Math.sin(tm * g.fq * (2 + 3 * gust) + g.ph);
            const cx = g.x + ww[0] * sway + n[0] * flut;
            const cy = g.y + ww[1] * sway + n[1] * flut;
            // leaves crossing a gap close it for a moment
            const blink = wind ? smooth(0.15, 0.55, 0.5 + 0.5 * Math.sin(tm * g.fq * (1.3 + 2.2 * gust) + g.ph * 3.1)) : 1;
            const w = g.w * lerp(1, blink, 0.65 * wind) / (grow * grow);
            const r = g.r * grow, s = Math.min(0.9, g.soft * grow);
            const k = 1 + s * 0.6 + 0.05;
            const corners = [[-k, -k], [k, -k], [-k, k], [k, -k], [k, k], [-k, k]];
            for (const [kx, ky] of corners) {
                d[o++] = cx; d[o++] = cy; d[o++] = kx; d[o++] = ky;
                d[o++] = r; d[o++] = s; d[o++] = w; d[o++] = 0;
            }
        }
        const p = P.disc;
        gl.useProgram(p.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, discBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
        const stride = 32;
        const aC = p.a('aC'), aK = p.a('aK'), aS = p.a('aS');
        gl.enableVertexAttribArray(aC); gl.vertexAttribPointer(aC, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(aK); gl.vertexAttribPointer(aK, 2, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(aS); gl.vertexAttribPointer(aS, 4, gl.FLOAT, false, stride, 16);
        gl.uniform2f(p.u('uT'), t[0], t[1]);
        gl.uniform1f(p.u('uLong'), long);
        gl.uniform4f(p.u('uMapXf'), map.x, map.y, map.ew, map.eh);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ZERO, gl.SRC_COLOR);
        gl.drawArrays(gl.TRIANGLES, 0, list.length * 6);
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(aC); gl.disableVertexAttribArray(aK); gl.disableVertexAttribArray(aS);
    }

    function drawMotes(t, cot, sunRGB, mapK) {
        const { list, T } = motes;
        const d = moteData;
        let o = 0;
        for (const m of list) {
            const near = m.z / T;
            const blur = 1 + 2.4 * near * near;            // closer to the eye, out of focus
            const glint = 0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(m.ph), 14);
            d[o++] = m.x; d[o++] = m.y; d[o++] = m.z;
            d[o++] = Math.max(1.5, (m.s * 2.2 + 1) * blur * dpr);
            d[o++] = glint * m.b;
            d[o++] = 0.9 / Math.pow(blur, 1.3);
        }
        const p = P.mote;
        gl.useProgram(p.p);
        gl.bindBuffer(gl.ARRAY_BUFFER, moteBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, d);
        const aM = p.a('aM'), aG = p.a('aG');
        gl.enableVertexAttribArray(aM); gl.vertexAttribPointer(aM, 4, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(aG); gl.vertexAttribPointer(aG, 2, gl.FLOAT, false, 24, 16);
        gl.uniform2f(p.u('uView'), W, H);
        gl.uniform2f(p.u('uT'), t[0], t[1]);
        gl.uniform1f(p.u('uCot'), cot);
        gl.uniform4f(p.u('uMapK'), ...mapK);
        bindTex(p, 'uMap', 0, map.tex);
        gl.uniform1f(p.u('uMapInv'), map.inv);
        gl.uniform3f(p.u('uSun'), ...sunRGB.map((x) => x * 2.4));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, list.length);
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(aM); gl.disableVertexAttribArray(aG);
    }

    // ── 2D fallback: a still, softened patch ──────────────────────────
    function draw2d() {
        const g = fallback;
        const k = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * k);
        canvas.height = Math.round(H * k);
        g.setTransform(k, 0, 0, k, 0, 0);
        const sun = sunNow();
        const t = travel(sun[0]), cot = 1 / Math.tan(sun[1] * RAD);
        const c = sunColour(0), s = shadeRGB(0);
        const css = (v) => `rgb(${v.map((x) => Math.round(clamp(x) * 255)).join(',')})`;
        g.fillStyle = css(s.map((x) => x / 2));
        g.fillRect(0, 0, W, H);
        g.fillStyle = css(c.map((x) => (1 + x) / 2));
        if ('filter' in g) g.filter = `blur(${Math.round(Math.hypot(W, H) * 0.006)}px)`;
        const r = room;
        const pt = (u, v) => [r.W0[0] + u * r.wd[0] + v * cot * t[0], r.W0[1] + u * r.wd[1] + v * cot * t[1]];
        const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.fill(); };
        if (cfg.preset === 'leaves') {
            const R = rng(5);
            const R0 = clamp(Math.hypot(W, H) * 0.017, 9, 30);
            for (let i = 0; i < (W * H) / (R0 * R0 * 6); i++) {
                const x = R() * W, y = R() * H;
                if (fbm2(x / (R0 * 11) + 3.1, y / (R0 * 11) + 8.7) < 0.5) continue;
                g.globalAlpha = 0.5;
                g.beginPath(); g.ellipse(x, y, R0, R0 * 1.3, Math.atan2(t[1], t[0]), 0, 7); g.fill();
            }
            g.globalAlpha = 1;
        } else if (cfg.preset === 'window' && !cfg.aperture) {
            const pw = (2 * r.hw - (r.cols - 1) * r.bar) / r.cols, ph = (r.Hw - (r.rows - 1) * r.rail) / r.rows;
            for (let i = 0; i < r.cols; i++) for (let j = 0; j < r.rows; j++) {
                const u0 = -r.hw + i * (pw + r.bar), v0 = r.v0 + j * (ph + r.rail);
                poly([pt(u0, v0), pt(u0 + pw, v0), pt(u0 + pw, v0 + ph), pt(u0, v0 + ph)]);
            }
        } else {
            const pts = [pt(-r.hw, r.v0), pt(r.hw, r.v0), pt(r.hw, r.v0 + r.Hw - r.hw)];
            for (let a = 0; a <= 16; a++) { const an = (a / 16) * Math.PI; pts.push(pt(Math.cos(an) * r.hw, r.v0 + r.Hw - r.hw + Math.sin(an) * r.hw)); }
            pts.push(pt(-r.hw, r.v0 + r.Hw - r.hw));
            poly(pts);
        }
        g.filter = 'none';
    }

    // ── loop ──────────────────────────────────────────────────────────
    function animating() {
        if (frozen()) return false;
        return cfg.clouds > 0 || (motes && cfg.motes > 0) ||
            (cfg.wind > 0 && (cfg.preset === 'leaves' || cfg.branch !== 'none'));
    }

    function updateMotion(dt) {
        // where the visitor is: a viewport light dims as its host leaves the
        // screen, and gives way to any scoped light that fills it
        presenceT = targetPresence();
        if (frozen()) presence = presenceT;
        else presence += (presenceT - presence) * (1 - Math.exp(-dt / 0.7));
        if (Math.abs(presence - presenceT) < (presenceT ? 0.002 : 0.015)) presence = presenceT;
        // the sun moves on as you read (a soft spring, no jitter)
        const goal = cfg.drift && !frozen() ? scrollProgress() * cfg.drift : 0;
        const k = 9, c = 6;
        driftV += ((goal - driftNow) * k - driftV * c) * dt;
        driftNow += driftV * dt;
        if (Math.abs(goal - driftNow) < 1e-4 && Math.abs(driftV) < 1e-4) { driftNow = goal; driftV = 0; }
    }

    function targetPresence() {
        if (!viewportMode()) return 1;
        let p = 1;
        if (host !== document.body && host !== document.documentElement) {
            const r = host.getBoundingClientRect();
            const cover = clamp((Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / innerHeight);
            p = smooth(0.2, 0.75, cover);
        }
        let other = 0;
        for (const s of scoped) other = Math.max(other, s.vis);
        return p * (1 - smooth(0.2, 0.6, other));
    }

    function scrollProgress() {
        if (host === document.body || host === document.documentElement) {
            const max = document.documentElement.scrollHeight - innerHeight;
            return max > 0 ? clamp(scrollY / max) : 0;
        }
        const r = host.getBoundingClientRect();
        const span = r.height - (viewportMode() ? innerHeight * 0.5 : 0);
        return span > 0 ? clamp(-r.top / span) : 0;
    }

    function frame(now) {
        raf = 0;
        if (dead) return;
        if (gl && gl.isContextLost()) return;
        const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
        last = now;
        if (!frozen()) clock += dt;
        updateMotion(dt);
        const show = presence > 0.002;
        canvas.style.visibility = show ? '' : 'hidden';
        if (mulCanvas) mulCanvas.style.visibility = canvas.style.visibility;
        const motesOn = motes && show;
        if (show && now - lastDraw >= (motesOn ? 0 : 31)) {
            const step = lastDraw ? Math.min(0.1, (now - lastDraw) / 1000) : dt;
            if (fallback) draw2d(); else render(frozen() ? 0 : step);
            lastDraw = now;
        }
        const moving = Math.abs(presence - presenceT) > 0.002 || Math.abs(driftV) > 1e-4;
        const lit = presence > 0.002 || presenceT > 0.002;
        if (visible && !document.hidden && (moving || (lit && animating()))) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    function kick() {
        if (!raf && !dead && canvas) raf = requestAnimationFrame(frame);
    }

    // ── start ─────────────────────────────────────────────────────────
    let io = null, ro = null;
    function start() {
        canvas = document.createElement('canvas');
        canvas.className = 'lr-canvas' + (viewportMode() ? ' lr-viewport' : '');
        canvas.setAttribute('aria-hidden', 'true');
        if (viewportMode()) document.body.appendChild(canvas);
        else { host.classList.add('lr-host'); host.appendChild(canvas); }

        gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
        let ok = false;
        if (gl) {
            try {
                quad = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, quad);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
                ok = buildPrograms();
                if (ok) {
                    mulCanvas = document.createElement('canvas');
                    mulCanvas.className = canvas.className + ' lr-mul';
                    mulCanvas.setAttribute('aria-hidden', 'true');
                    canvas.parentNode.insertBefore(mulCanvas, canvas);
                    mulCtx = mulCanvas.getContext('2d');
                    ok = !!mulCtx;
                }
                if (ok) { buildStacks(); layout(); }
            } catch (e) { ok = false; }
        }
        if (!ok) {
            // no WebGL: a still patch from a 2D canvas
            gl = null;
            canvas.remove();
            if (mulCanvas) { mulCanvas.remove(); mulCanvas = null; }
            canvas = document.createElement('canvas');
            canvas.className = 'lr-canvas' + (viewportMode() ? ' lr-viewport' : '');
            canvas.setAttribute('aria-hidden', 'true');
            if (viewportMode()) document.body.appendChild(canvas); else host.appendChild(canvas);
            fallback = canvas.getContext('2d');
            canvas.style.mixBlendMode = 'hard-light';   // one layer: multiply below grey, screen above
            if (!fallback) { canvas.remove(); canvas = null; return; }
            cfg.motes = 0;
            layout();
        }
        host.classList.add('is-lit');

        if (gl) {
            on(canvas, 'webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
            on(canvas, 'webglcontextrestored', () => {
                P = {}; map = null; jali = bstack = mask = null; discBuf = moteBuf = null;
                try {
                    quad = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
                    if (buildPrograms()) { buildStacks(); layout(); lastDraw = 0; kick(); }
                } catch (e) { /* stay dark */ }
            });
        }

        on(document, 'visibilitychange', () => { if (!document.hidden) { last = 0; kick(); } });
        on(calm, 'change', () => { if (!dead) { makeMotesSafe(); lastDraw = 0; kick(); } });
        on(window, 'scroll', () => { if (viewportMode() || cfg.drift) kick(); }, { passive: true });
        const scheme = matchMedia('(prefers-color-scheme: dark)');
        on(scheme, 'change', () => { dark = isDark(); lastDraw = 0; kick(); });

        if (viewportMode()) {
            visible = true;      // the screen is always there; presence says whether the sun is
            on(window, 'resize', () => {
                clearTimeout(sizeTimer);
                sizeTimer = setTimeout(() => { if (!dead) { relayout(); } }, 120);
            });
        } else {
            scoped.add(self);
            io = new IntersectionObserver((en) => {
                const e = en[0];
                visible = e.isIntersecting;
                self.vis = e.isIntersecting ? clamp(e.intersectionRect.height / innerHeight) : 0;
                if (visible) { last = 0; kick(); }
            }, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
            io.observe(host);
            let w0 = 0, h0 = 0;
            ro = new ResizeObserver(() => {
                const r = host.getBoundingClientRect();
                if (Math.abs(r.width - w0) < 1 && Math.abs(r.height - h0) < 1) return;
                w0 = r.width; h0 = r.height;
                clearTimeout(sizeTimer);
                sizeTimer = setTimeout(() => { if (!dead) relayout(); }, 120);
            });
            ro.observe(host);
        }
        presence = presenceT = targetPresence();
        lastDraw = 0;
        kick();
    }
    function makeMotesSafe() { if (gl) makeMotes(); }
    function relayout() {
        try { layout(); } catch (e) { return; }
        lastDraw = 0;
        kick();
    }

    // a mask image, if any, must load first
    if (cfg.aperture && cfg.preset !== 'leaves') {
        maskImg = new Image();
        maskImg.crossOrigin = 'anonymous';
        maskImg.onload = () => { if (!dead) start(); };
        maskImg.onerror = () => { maskImg = null; cfg.aperture = ''; if (!dead) start(); };
        maskImg.src = cfg.aperture;
    } else start();

    function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(sizeTimer);
        off.forEach((f) => f());
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        scoped.delete(self);
        if (gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
        if (canvas) canvas.remove();
        if (mulCanvas) mulCanvas.remove();
        host.classList.remove('is-lit', 'lr-host');
    }
    // Change options live: destroy.set({ preset: 'arch', warmth: .8 }).
    destroy.set = (next = {}) => {
        if (dead) return;
        const before = cfg;
        given = { ...given, ...next };
        cfg = readCfg(host, given);
        if (fallback) cfg.motes = 0;
        const rebuild = cfg.preset !== before.preset || cfg.branch !== before.branch || cfg.aperture !== before.aperture;
        if (gl && rebuild) {
            if (cfg.aperture !== before.aperture && cfg.aperture) {
                maskImg = new Image();
                maskImg.crossOrigin = 'anonymous';
                maskImg.onload = () => { if (!dead) { buildStacks(); relayout(); } };
                maskImg.src = cfg.aperture;
            }
            if (cfg.preset !== before.preset) ref = null;
            buildPrograms();
            buildStacks();
        }
        // sun, weather and colour are only uniforms; shape and dust need a new layout
        const shape = rebuild || ['size', 'panes', 'motes', 'seed'].some((k) => String(cfg[k]) !== String(before[k])) ||
            String(cfg.at) !== String(before.at);
        if (shape && (gl || fallback)) relayout();
        else { lastDraw = 0; kick(); }
    };
    Object.defineProperty(destroy, 'sun', { get: () => (ref ? sunNow() : null) });
    Object.defineProperty(destroy, 'state', { get: () => ({ running: !!raf, visible, presence: +presence.toFixed(3), motes: motes ? motes.list.length : 0, preset: cfg.preset }) });
    return destroy;
}

// Auto-start every [data-light-rays] on the page once it is near the viewport.
function autoStart(el) {
    if (el.__lightRays) return;
    el.__lightRays = true;
    const go = () => { el.lightRays = lightRays(el); };
    if (el === document.body || el.dataset.attach === 'viewport' || !('IntersectionObserver' in window)) return go();
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        go();
    }, { rootMargin: '400px' });
    io.observe(el);
}
const boot = () => document.querySelectorAll('[data-light-rays]').forEach(autoStart);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
