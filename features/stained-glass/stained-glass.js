/*
 *  STAINED-GLASS // sunlight through a real glass panel, landing on the page in colour.
 *
 *  Markup:  <article data-stained-glass>
 *             <figure class="sg-window"><img src="panel.webp" alt="" data-sg-glass></figure>
 *             … the essay …
 *           </article>
 *  Or call  stainedGlass(el, { glass, sun, clouds, … })  yourself.
 *  It returns destroy(), with destroy.set({ … }) to change options live.
 *
 *  Options (data attributes, all optional; the options object wins):
 *    data-glass="url"       the panel: a cut-out with alpha (same origin). Default:
 *                           the host's own img[data-sg-glass]
 *    data-sun="-50 30"      azimuth (screen degrees, 0 = from the top, -90 = from the
 *                           left) and elevation above the page. Default depends on aspect.
 *    data-at=".7 .62"       where the middle of the patch lands, fractions of the area
 *                           (default .7 .62 wide, .66 .74 tall)
 *    data-size="1"          scales the window (and the patch)
 *    data-softness="3"      penumbra: 1 is the bare 0.53° sun; more adds the aureole
 *    data-clouds=".45"      0-1, slow breathing and the odd passing cloud
 *    data-warmth=".35"      0-1, colour of the sun: noon white to late-afternoon
 *    data-intensity="1"     scales the light
 *    data-depth="1"         how deeply the glass colours the paper
 *    data-shade=".05"       0-1, the room's shade outside the beam
 *    data-haze=".25"        0-1, coloured shafts in the air above the page
 *    data-motes=".4"        0-1, dust in the beam (0 = none)
 *    data-drift=".7"        0-1, the day moves on as you scroll: the sun swings and lowers
 *    data-tilt              on by default; "off" ignores the phone's tilt
 *    data-static            a frozen beam
 *    data-attach            viewport (on <body>) | element
 *
 *  The panel stands in a wall off the page. A page point is lit through the
 *  panel point (u, v) its ray came through; the sun is a 0.53° disc, so each
 *  point sees the panel through a disc of radius  length × 0.0093 / 2 × softness,
 *  and its light is the panel's transmittance averaged over that disc. The panel
 *  is uploaded once, linearised and premultiplied, and blurred by discs of
 *  growing radius into a stack of six textures (each smaller than the last, like
 *  mipmaps). Each pixel reads the level its own penumbra needs: near the sill the
 *  lead lines are crisp black seams, further out they thin and vanish and the
 *  colours run together, as they do on a church floor.
 *
 *  Two layers from one WebGL context: a multiply layer (the room's faint shade,
 *  the shadows of lead and paint, and the colour of the glass laid over the
 *  paper), copied to a 2D canvas, and over it a screen layer (the coloured light
 *  itself through a filmic shoulder, a little halation, shafts in the air and
 *  the dust). Paper turns ruby, cobalt and gold; ink under the light is tinted.
 *
 *  Cheap when idle: ~30 fps while clouds pass, 60 while dust drifts, nothing
 *  off screen or in a hidden tab, a single still frame with data-static or
 *  reduced motion. Without WebGL a 2D canvas lays a still, softened picture of
 *  the panel over the page.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => { const k = clamp((x - a) / (b - a)); return k * k * (3 - 2 * k); };
const RAD = Math.PI / 180;

const SUN = 0.0093;        // the sun's angular diameter (0.53°) in radians
const SKEW = 20;           // degrees the wall stands off square to the light: the lean of the patch
const TEXW = 1024;         // the crisp level's width, texels (panel plus a margin for the blur)
// blur stack: radius (in crisp texels) and resolution of each level
const LEVELS = [
    { r: 0, k: 1 },
    { r: 2.5, k: 1 },
    { r: 7, k: 0.5 },
    { r: 17, k: 0.25 },
    { r: 40, k: 0.125 },
    { r: 92, k: 0.0625 },
];
const PAD = 112;           // texels of clear margin round the panel, so the widest blur has room
const LEN = 0.5;           // patch length as a fraction of the area's diagonal (no panel in the page)
const AREA = 1.6;          // patch area as a multiple of the panel's area on the page

function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
const hash1 = (n) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
function vnoise(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(hash1(i + seed * 101.3), hash1(i + 1 + seed * 101.3), u);
}

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

// The light on the page: the panel's transmittance seen through the sun's disc.
const ILLUM = `
uniform vec2 uW0;            // the foot of the window's centre line on the page (css px)
uniform vec2 uInvA, uInvB;   // page -> panel plane: u along the wall, v up it
uniform float uSinEl;
uniform float uSoftK;        // penumbra radius per px of ray (sun's half-angle x softness)
uniform float uAA;           // the smallest radius, about half a device pixel
uniform vec4 uOpen;          // half width, sill, height, crisp texels per panel px
uniform vec4 uTexXf;         // panel (0-1) -> texture: offset, scale
uniform sampler2D uG0, uG1, uG2, uG3, uG4, uG5;
uniform vec4 uGR; uniform float uGR5;   // radii of levels 1-5, crisp texels
float gInner;                // how far inside the panel's outline (not its rim)
vec3 gWide;                  // the light a little way round, for local contrast
float gRt;                   // the penumbra here, in crisp texels

// rgb: transmitted light (linear, premultiplied); a: how much of the disc is panel
vec4 glass(vec2 a, float r) {
    vec2 q = vec2((a.x + uOpen.x) / (2. * uOpen.x), 1. - (a.y - uOpen.y) / uOpen.z);
    vec2 tc = uTexXf.xy + q * uTexXf.zw;
    float rt = r * uOpen.w;
    gRt = rt;
    vec4 s0 = texture2D(uG0, tc), s1 = texture2D(uG1, tc), s2 = texture2D(uG2, tc);
    vec4 s3 = texture2D(uG3, tc), s4 = texture2D(uG4, tc), s5 = texture2D(uG5, tc);
    gInner = smoothstep(.72, .97, s4.a);
    gWide = s4.rgb;
    if (rt < uGR.x) return mix(s0, s1, rt / uGR.x);
    if (rt < uGR.y) return mix(s1, s2, (rt - uGR.x) / (uGR.y - uGR.x));
    if (rt < uGR.z) return mix(s2, s3, (rt - uGR.y) / (uGR.z - uGR.y));
    if (rt < uGR.w) return mix(s3, s4, (rt - uGR.z) / (uGR.w - uGR.z));
    return mix(s4, s5, clamp((rt - uGR.w) / (uGR5 - uGR.w), 0., 1.));
}

vec4 illum(vec2 P) {
    vec2 d = P - uW0;
    vec2 a = vec2(dot(uInvA, d), dot(uInvB, d));
    float l = max(a.y, 0.) / uSinEl;            // the ray's length back to the panel
    float r = max(l * uSoftK, uAA);
    return glass(a, r);
}
`;

// low-resolution copy of the light over a margin round the area: shafts, halation, motes
const MAP_FS = HEAD + ILLUM + `
uniform vec4 uMapXf;   // map uv -> page: origin, size
varying vec2 vUv;
void main() {
    vec2 P = uMapXf.xy + vUv * uMapXf.zw;
    gl_FragColor = vec4(min(illum(P).rgb * 1.5, 1.), 1.);
}`;

const MAIN_FS = HEAD + ILLUM + `
uniform sampler2D uMap;
uniform vec4 uMapK;          // page -> map uv: (P + xy) * zw
uniform vec2 uView;          // css px of the area
uniform vec2 uT;             // the way the light travels
uniform vec3 uSun;           // its colour x strength (screen)
uniform vec3 uShade;         // the room's shade (multiply) where no sun falls, at its deepest
uniform vec2 uBeamA, uBeamB; // the patch's centre line on the page: sill to far end
uniform float uBeamS;        // how far round the beam the shade reaches
uniform vec3 uTint;          // the sun's colour as a filter
uniform float uHaze, uReach, uGrain, uBloom;
uniform float uDeep;         // how strongly the glass colours the paper
uniform float uSeam;         // how dark the lead and paint shadows read inside the light
uniform float uPass;         // 0: the multiply layer, 1: the screen layer
uniform float uGain;         // exposure: the photographed glass is darker than the sun through it
uniform float uLit;          // how much sun is getting through now (clouds)
uniform float uPale;         // saturation left at the far end of the patch
varying vec2 vUv;

vec3 mapL(vec2 P) { return texture2D(uMap, (P + uMapK.xy) * uMapK.zw).rgb; }
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

void main() {
    vec2 P = vUv * uView;
    vec4 g = illum(P);
    // how far the light has come: near the sill crisp and rich, far out mixed and pale
    float far = smoothstep(6., 80., gRt);
    // far out the lead and paint are averaged into the light and dim it a little;
    // the eye, adapted to the patch, hardly sees that
    vec3 T = g.rgb * uGain * (1. + .5 * far);
    float lum = max(max(T.r, T.g), T.b);
    vec3 hue = T / max(lum, .002);                   // its colour, brightest channel = 1
    hue = mix(vec3(1.), hue, mix(1., uPale, far));   // colours pale as they mix
    float dith = (hash(gl_FragCoord.yx + 17.17) - .5) / 255.;
    if (uPass < .5) {
        // multiply: the room is in shade; where the sun comes through the glass
        // the paper is lifted back to its own brightness, filtered by the glass
        float lit = smoothstep(0., .6, lum) * uLit;
        vec3 F = (1. - uDeep * (1. - pow(hue, vec3(.85)))) * mix(vec3(1.), uTint, .5);
        // the room is not evenly dark: deepest round the beam and beyond it,
        // easing off far from it into the warm paper
        vec2 ab = uBeamB - uBeamA;
        float sB = clamp(dot(P - uBeamA, ab) / max(dot(ab, ab), 1.), -.2, 1.3);
        float dB = length(P - (uBeamA + ab * sB)) / uBeamS;
        float deep = (.22 + .78 * exp(-dB * dB)) * (.85 + .15 * smoothstep(0., 1., sB));
        vec3 shade = mix(vec3(1.), uShade, deep);
        vec3 m = mix(shade, F, lit);
        // near the sill a lead line or a painted stroke reads dark against the
        // glass beside it (the eye adapted to the bright patch); far out, nothing
        vec3 Tw = gWide * uGain;
        float lumW = max(max(Tw.r, Tw.g), Tw.b);
        float seam = gInner * clamp((lumW - lum) * 1.6, 0., 1.) * (1. - far);
        m *= 1. - uSeam * seam;
        gl_FragColor = vec4(clamp(m + dith, 0., 1.), 1.);
        return;
    }
    // shafts: the air above P is lit where the beam crosses it, the patch seen a
    // little further toward the sun; thinner toward the top of the slab
    float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(.06711056, .00583715))));
    vec3 sh = vec3(0.); float ws = 0.;
    for (int i = 0; i < 12; i++) {
        float z = (float(i) + j) / 12.;
        float w = 1. - z;
        sh += w * mapL(P + uT * uReach * z);
        ws += w;
    }
    sh /= ws;
    // halation: bright glass bleeds its colour a few px, as glare does
    vec3 halo = vec3(0.);
    for (int i = 0; i < 8; i++) {
        float an = (float(i) + j) * .7853982;
        vec2 d = vec2(cos(an), sin(an));
        halo += mapL(P + d * 7.) + .6 * mapL(P + d * 20.);
    }
    halo /= 12.8;
    // the screen's own matte surface catches the sun in a fine, still grain
    float gr = hash(gl_FragCoord.xy) - .5;
    // the light itself, in its own (paling) colour, through the shoulder
    vec3 lift = lum * hue * (1. + uGrain * gr);
    vec3 x = uSun * (lift + uHaze * sh + uBloom * halo);
    gl_FragColor = vec4(clamp(1. - exp(-1.25 * x) + dith, 0., 1.), 1.);
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
uniform sampler2D uMap;
uniform vec3 uSun;
varying vec2 vMap; varying vec2 vG;
void main() {
    vec3 c = texture2D(uMap, vMap).rgb;
    float lum = max(max(c.r, c.g), c.b);
    // a mote in a coloured beam glints in that colour
    vec3 lit = c / max(lum, .01) * smoothstep(.12, .7, lum);
    float d = length(gl_PointCoord - .5) * 2.;
    float f = 1. - smoothstep(.15, 1., d);
    gl_FragColor = vec4(uSun * lit * (vG.x * vG.y * f * f), 1.);
}`;

// Prepare the crisp level: linear light, premultiplied by the panel's alpha.
const PREP_FS = HEAD + `
uniform sampler2D uSrc;
varying vec2 vUv;
void main() {
    vec4 c = texture2D(uSrc, vUv);
    vec3 lin = pow(c.rgb, vec3(2.2));
    gl_FragColor = vec4(lin * c.a, c.a);
}`;
// Disc blur for the stack: a Vogel spiral read from the level above.
const BLUR_FS = HEAD + `
uniform sampler2D uSrc; uniform vec2 uR;
varying vec2 vUv;
void main() {
    vec4 s = vec4(0.);
    for (int i = 0; i < 80; i++) {
        float fi = float(i) + .5;
        float rr = sqrt(fi / 80.), an = fi * 2.3999632;
        s += texture2D(uSrc, vUv + uR * rr * vec2(cos(an), sin(an)));
    }
    gl_FragColor = s / 80.;
}`;

// ── the component ─────────────────────────────────────────────────────

const scoped = new Set();

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
    const tilt = get('tilt');
    return {
        glass: get('glass') || '',
        sun: pair('sun'),
        at: pair('at'),
        size: Math.max(0.2, num('size', 1)),
        softness: Math.max(0, num('softness', 5.5)),
        clouds: clamp(num('clouds', 0.45)),
        warmth: clamp(num('warmth', 0.35)),
        intensity: Math.max(0, num('intensity', 1)),
        depth: clamp(num('depth', 1), 0, 1.4),
        shade: clamp(num('shade', 0.19)),
        haze: clamp(num('haze', 0.25)),
        motes: clamp(num('motes', 0.4)),
        drift: clamp(num('drift', 0.7)),
        tilt: !(tilt === false || tilt === 'off' || tilt === 'false' || tilt === '0'),
        static: flag('static'),
        attach: get('attach') === 'viewport' || get('attach') === 'element' ? get('attach')
            : host === document.body || host === document.documentElement ? 'viewport' : 'element',
        seed: num('seed', 7),
    };
}

export function stainedGlass(host, opts = {}) {
    if (!host) return Object.assign(() => {}, { set() {} });
    let given = { ...opts };
    let cfg = readCfg(host, given);
    const viewportMode = () => cfg.attach === 'viewport';

    let dead = false;
    let canvas = null, gl = null, fallback = null;
    let mulCanvas = null, mulCtx = null;
    let W = 0, H = 0, dpr = 1;
    let P = {};
    let quad = null;
    let map = null;
    let stack = null;            // { tex: [6], R: [radii], panel: { x, y, w, h } (texels), w, h }
    let img = null, panelEl = null;
    let room = null, ref = null;
    let motes = null, moteBuf = null, moteData = null;
    let visible = false, raf = 0, last = 0, lastDraw = 0, clock = 0;
    let presence = 1, presenceT = 1;
    let driftNow = 0, driftV = 0;
    let tilt = null, tiltNow = [0, 0];
    let sunVar = -1;
    let dark = false;
    let clouds = { events: [], next: 0 };
    let sizeTimer = 0;
    const off = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };
    const frozen = () => cfg.static || calm.matches;
    const self = { vis: 0 };

    // ── GL plumbing ───────────────────────────────────────────────────
    function compile(vs, fs) {
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('stained-glass:', gl.getShaderInfoLog(s)); return null; }
            return s;
        };
        const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
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
    function texture(w, h, src) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

    function buildPrograms() {
        P.main = compile(QUAD_VS, MAIN_FS);
        P.map = compile(QUAD_VS_FBO, MAP_FS);
        P.prep = compile(QUAD_VS_FBO, PREP_FS);
        P.blur = compile(QUAD_VS_FBO, BLUR_FS);
        P.mote = compile(MOTE_VS, MOTE_FS);
        return P.main && P.map && P.prep && P.blur && P.mote;
    }

    // The panel, drawn once into a canvas with a clear margin round it, then
    // linearised and blurred by discs of growing radius. Each level is half the
    // size of the last once the blur is wide enough not to need the texels.
    function buildStack() {
        freeStack();
        if (!img) return;
        const iw = img.naturalWidth, ih = img.naturalHeight;
        const pw = TEXW - 2 * PAD;
        const ph = Math.round((pw * ih) / iw);
        const tw = TEXW, th = ph + 2 * PAD;
        const c = document.createElement('canvas');
        c.width = tw; c.height = th;
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, PAD, PAD, pw, ph);
        const src = texture(tw, th, c);
        gl.disable(gl.BLEND);
        const tex = [];
        // level 0: linear, premultiplied
        let t = texture(tw, th);
        let f = target(t);
        useQuad(P.prep);
        gl.viewport(0, 0, tw, th);
        bindTex(P.prep, 'uSrc', 0, src);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.deleteFramebuffer(f);
        gl.deleteTexture(src);
        tex.push(t);
        let prevR = 0;
        for (let i = 1; i < LEVELS.length; i++) {
            const { r, k } = LEVELS[i];
            const w = Math.max(4, Math.round(tw * k)), h = Math.max(4, Math.round(th * k));
            t = texture(w, h);
            f = target(t);
            useQuad(P.blur);
            gl.viewport(0, 0, w, h);
            bindTex(P.blur, 'uSrc', 0, tex[i - 1]);
            const inc = Math.sqrt(Math.max(0.25, r * r - prevR * prevR));
            gl.uniform2f(P.blur.u('uR'), inc / tw, inc / th);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.deleteFramebuffer(f);
            tex.push(t);
            prevR = r;
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        stack = { tex, R: LEVELS.map((l) => l.r), panel: { x: PAD, y: PAD, w: pw, h: ph }, w: tw, h: th };
    }
    function freeStack() {
        if (stack && gl) stack.tex.forEach((t) => gl.deleteTexture(t));
        stack = null;
    }

    // ── geometry ──────────────────────────────────────────────────────
    function defaultSun() { return W >= H ? [-50, 30] : [-14, 38]; }
    const baseSun = () => cfg.sun || defaultSun();
    // the sun now: as given, plus the day moving on with scroll and time, plus tilt
    function sunNow() {
        const base = baseSun();
        let az = base[0], el = base[1];
        az += -driftNow * 18 * Math.sign(az || -1) + clock * 0.004 + tiltNow[0] * 7;
        el += -driftNow * 12 + tiltNow[1] * 5;
        return [az, clamp(el, 8, 78)];
    }
    const travel = (az) => [-Math.sin(az * RAD), Math.cos(az * RAD)];
    const aspect = () => (img ? img.naturalWidth / img.naturalHeight : 0.53);

    // The panel in its wall off the page, laid out once for the reference sun so
    // that its patch lands at data-at. When the sun moves the window stays and
    // the patch moves, as it would.
    function layoutRoom() {
        const D = Math.hypot(W, H);
        const [az, el] = ref;
        const t = travel(az), cot = 1 / Math.tan(el * RAD);
        const perp = [-t[1], t[0]];
        const s = SKEW * RAD;
        const wd = [perp[0] * Math.cos(s) - perp[1] * Math.sin(s), perp[0] * Math.sin(s) + perp[1] * Math.cos(s)];
        // the patch is this window's light: about AREA times the panel's own area
        // on the page (the window and the floor it lights are much of a size);
        // without a panel in the page, a fraction of the area's diagonal
        const pr = panelEl && panelEl.isConnected ? panelEl.getBoundingClientRect() : null;
        const Hw = pr && pr.height > 24
            ? pr.height * Math.sqrt(AREA / (cot * Math.cos(s))) * cfg.size
            : (LEN * D * cfg.size) / cot;
        const hw = (aspect() * Hw) / 2;
        const v0 = 0.02 * Hw;
        const at = cfg.at || (W >= H ? [0.7, 0.62] : [0.66, 0.74]);
        const c = [at[0] * W, at[1] * H];
        const vc = v0 + Hw * 0.5;
        const W0 = [c[0] - vc * cot * t[0], c[1] - vc * cot * t[1]];
        room = { W0, wd, hw, v0, Hw };
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
        dpr = Math.min(devicePixelRatio || 1, 2);
        if (W * H * dpr * dpr > 4.6e6) dpr = Math.sqrt(4.6e6 / (W * H));
        layoutRoom();
        dark = isDark();
        if (fallback) return draw2d();
        canvas.width = mulCanvas.width = Math.round(W * dpr);
        canvas.height = mulCanvas.height = Math.round(H * dpr);
        const D = Math.hypot(W, H);
        const M = Math.round(D * 0.4);
        if (map) { gl.deleteTexture(map.tex); gl.deleteFramebuffer(map.fbo); }
        const ew = W + 2 * M, eh = H + 2 * M;
        const mw = Math.max(8, Math.round(ew * 0.25)), mh = Math.max(8, Math.round(eh * 0.25));
        const tex = texture(mw, mh);
        map = { tex, fbo: target(tex), w: mw, h: mh, x: -M, y: -M, ew, eh, M };
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

    // ── motes ─────────────────────────────────────────────────────────
    function makeMotes() {
        const n = frozen() || !gl ? 0 : Math.min(360, Math.round((cfg.motes * W * H) / 2600));
        if (!n) { motes = null; return; }
        const R = rng(cfg.seed * 13 + 1);
        const T = Math.hypot(W, H) * 0.3;
        const m = [];
        for (let i = 0; i < n; i++) {
            m.push({
                x: R() * W, y: R() * H, z: R() * T,
                vx: 0, vy: 0, vz: 0,
                s: 0.6 + Math.pow(R(), 2.2) * 1.6,
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
    // A slow breath of a few percent, and now and then a cloud that dims the
    // light by 35-65% for five to ten seconds, softening every edge as it passes.
    function cloudAt(t) {
        const c = cfg.clouds;
        if (!c) return 0;
        const ev = clouds.events;
        while (clouds.next < t + 30) {
            const first = !ev.length;
            const start = first ? 7 + Math.random() * 4 : clouds.next;
            const dur = 5 + Math.random() * 5;
            ev.push({ start, dur, depth: (0.35 + Math.random() * 0.3) * Math.min(1, c * 1.4) });
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
        gl.uniform1f(prog.u('uAA'), (0.6 / Math.max(dpr, 1)) * Math.max(1, 1 / cot));
        const s = stack;
        gl.uniform4f(prog.u('uOpen'), r.hw, r.v0, r.Hw, s.panel.w / (2 * r.hw));
        gl.uniform4f(prog.u('uTexXf'), s.panel.x / s.w, s.panel.y / s.h, s.panel.w / s.w, s.panel.h / s.h);
        for (let i = 0; i < 6; i++) bindTex(prog, 'uG' + i, 2 + i, s.tex[i]);
        gl.uniform4f(prog.u('uGR'), s.R[1], s.R[2], s.R[3], s.R[4]);
        gl.uniform1f(prog.u('uGR5'), s.R[5]);
    }

    function render(dt) {
        const sun = sunNow();
        const [az, el] = sun;
        const t = travel(az), cot = 1 / Math.tan(el * RAD);
        const cloud = frozen() ? 0 : cloudAt(clock);
        setPanelLight(cloud);
        const soft = cfg.softness * (1 + 1.4 * cloud) * (1 + (1 - presence) * 2);

        // the light map
        gl.disable(gl.BLEND);
        gl.bindFramebuffer(gl.FRAMEBUFFER, map.fbo);
        gl.viewport(0, 0, map.w, map.h);
        useQuad(P.map);
        uniformsGeo(P.map, sun, soft);
        gl.uniform4f(P.map.u('uMapXf'), map.x, map.y, map.ew, map.eh);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        // the page
        gl.viewport(0, 0, canvas.width, canvas.height);
        const m = P.main;
        useQuad(m);
        uniformsGeo(m, sun, soft);
        bindTex(m, 'uMap', 0, map.tex);
        const mapK = [-map.x, -map.y, 1 / map.ew, 1 / map.eh];
        gl.uniform4f(m.u('uMapK'), ...mapK);
        gl.uniform2f(m.u('uView'), W, H);
        gl.uniform2f(m.u('uT'), t[0], t[1]);
        const sunRGB = sunColour(cloud);
        gl.uniform3f(m.u('uSun'), ...sunRGB);
        gl.uniform3f(m.u('uShade'), ...shadeRGB(cloud));
        const rm = room, f0 = rm.v0 * cot, f1 = (rm.v0 + rm.Hw) * cot;
        gl.uniform2f(m.u('uBeamA'), rm.W0[0] + f0 * t[0], rm.W0[1] + f0 * t[1]);
        gl.uniform2f(m.u('uBeamB'), rm.W0[0] + f1 * t[0], rm.W0[1] + f1 * t[1]);
        gl.uniform1f(m.u('uBeamS'), Math.hypot(W, H) * 0.32);
        gl.uniform3f(m.u('uTint'), ...kelvin(warmthK() + cloud * 900));
        gl.uniform1f(m.u('uHaze'), cfg.haze * 0.22);
        gl.uniform1f(m.u('uReach'), Math.min(map.M, Math.hypot(W, H) * 0.3 * cot));
        gl.uniform1f(m.u('uGrain'), 0.07);
        gl.uniform1f(m.u('uBloom'), 0.2);
        const lit = (1 - cloud * 0.75) * presence;
        gl.uniform1f(m.u('uDeep'), (dark ? 0.45 : 0.8) * cfg.depth);
        gl.uniform1f(m.u('uSeam'), (dark ? 0.3 : 0.62) * lit);
        gl.uniform1f(m.u('uLit'), lit);
        gl.uniform1f(m.u('uPale'), 0.55);
        gl.uniform1f(m.u('uGain'), 1.5);
        gl.uniform1f(m.u('uPass'), 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        mulCtx.globalCompositeOperation = 'copy';
        mulCtx.drawImage(canvas, 0, 0);
        gl.uniform1f(m.u('uPass'), 1);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        if (motes && presence > 0.01) {
            stepMotes(dt);
            drawMotes(t, cot, sunRGB, mapK);
        }
    }

    // the day moves on as you read: the light warms toward afternoon
    const warmthK = () => lerp(5900, 3400, clamp(cfg.warmth + driftNow * 0.35));
    function sunColour(cloud) {
        const c = kelvin(warmthK() + cloud * 900);
        const I = (dark ? 0.5 : 0.62) * cfg.intensity * (1 - cloud) * presence;
        return c.map((x) => Math.pow(x, 1.4) * I);
    }
    function shadeRGB(cloud) {
        // the room is in shade: lit only by skylight, a little cool, so that the
        // patch can be brighter than the floor round it, as in a church
        // warm: sandstone and old vellum, never grey
        const s = cfg.shade * (dark ? 0.3 : 1) * presence;
        return [0.47, 0.68, 1].map((k) => 1 - s * k);
    }
    // the panel in the page dims and flattens with the light behind it
    function setPanelLight(cloud) {
        const v = Math.round((1 - cloud) * 100) / 100;
        if (v === sunVar) return;
        sunVar = v;
        host.style.setProperty('--sg-sun', String(v));
    }

    function drawMotes(t, cot, sunRGB, mapK) {
        const { list, T } = motes;
        const d = moteData;
        let o = 0;
        for (const m of list) {
            const near = m.z / T;
            const blur = 1 + 2.4 * near * near;
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
        gl.uniform3f(p.u('uSun'), ...sunRGB.map((x) => x * 2.6));
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArrays(gl.POINTS, 0, list.length);
        gl.disable(gl.BLEND);
        gl.disableVertexAttribArray(aM); gl.disableVertexAttribArray(aG);
    }

    // ── 2D fallback: the panel laid over the page, softened ───────────
    function draw2d() {
        const g = fallback;
        const k = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.round(W * k);
        canvas.height = Math.round(H * k);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = '#fff';
        g.fillRect(0, 0, canvas.width, canvas.height);
        if (!img) return;
        const [az, el] = sunNow();
        const t = travel(az), cot = 1 / Math.tan(el * RAD);
        const r = room;
        const iw = img.naturalWidth, ih = img.naturalHeight;
        // image px -> page: u = -hw + 2hw x/iw, v = v0 + Hw (1 - y/ih)
        const ox = r.W0[0] - r.hw * r.wd[0] + (r.v0 + r.Hw) * cot * t[0];
        const oy = r.W0[1] - r.hw * r.wd[1] + (r.v0 + r.Hw) * cot * t[1];
        g.setTransform(k * (2 * r.hw / iw) * r.wd[0], k * (2 * r.hw / iw) * r.wd[1],
            -k * (r.Hw / ih) * cot * t[0], -k * (r.Hw / ih) * cot * t[1], k * ox, k * oy);
        if ('filter' in g) g.filter = `blur(${Math.round(iw * 0.006)}px) saturate(1.3)`;
        g.globalAlpha = 0.55 * cfg.intensity;
        g.drawImage(img, 0, 0);
        g.globalAlpha = 1;
        g.filter = 'none';
        g.setTransform(1, 0, 0, 1, 0, 0);
    }

    // ── loop ──────────────────────────────────────────────────────────
    function animating() {
        if (frozen()) return false;
        return cfg.clouds > 0 || !!(motes && cfg.motes > 0);
    }

    function updateMotion(dt) {
        presenceT = targetPresence();
        if (frozen()) presence = presenceT;
        else presence += (presenceT - presence) * (1 - Math.exp(-dt / 0.7));
        if (Math.abs(presence - presenceT) < (presenceT ? 0.002 : 0.015)) presence = presenceT;
        // the day moves on as you read (a soft spring, no jitter)
        const goal = cfg.drift && !frozen() ? scrollProgress() * cfg.drift : 0;
        const k = 9, c = 6;
        driftV += ((goal - driftNow) * k - driftV * c) * dt;
        driftNow += driftV * dt;
        if (Math.abs(goal - driftNow) < 1e-4 && Math.abs(driftV) < 1e-4) { driftNow = goal; driftV = 0; }
        // a tilt of the phone nudges the sun a little
        const tg = cfg.tilt && tilt && tilt.active && !frozen() ? [tilt.x, tilt.y] : [0, 0];
        const s = 1 - Math.exp(-dt / 0.35);
        tiltNow[0] += (tg[0] - tiltNow[0]) * s;
        tiltNow[1] += (tg[1] - tiltNow[1]) * s;
    }
    const tiltMoving = () => cfg.tilt && tilt && tilt.active && !frozen() &&
        (Math.abs(tilt.x - tiltNow[0]) + Math.abs(tilt.y - tiltNow[1]) > 0.004);

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
        const moving = Math.abs(presence - presenceT) > 0.002 || Math.abs(driftV) > 1e-4 || tiltMoving();
        const lit = presence > 0.002 || presenceT > 0.002;
        if (visible && !document.hidden && (moving || (lit && animating() && !fallback))) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    function kick() {
        if (!raf && !dead && canvas) raf = requestAnimationFrame(frame);
    }

    // ── start ─────────────────────────────────────────────────────────
    let io = null, ro = null;
    function makeCanvas(cls) {
        const c = document.createElement('canvas');
        c.className = cls + (viewportMode() ? ' sg-viewport' : '');
        c.setAttribute('aria-hidden', 'true');
        if (viewportMode()) document.body.appendChild(c);
        else { host.classList.add('sg-host'); host.appendChild(c); }
        return c;
    }
    function start() {
        canvas = makeCanvas('sg-canvas');
        gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'low-power' });
        let ok = false;
        if (gl) {
            try {
                ok = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 8;
                quad = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, quad);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
                ok = ok && buildPrograms();
                if (ok) {
                    mulCanvas = document.createElement('canvas');
                    mulCanvas.className = canvas.className + ' sg-mul';
                    mulCanvas.setAttribute('aria-hidden', 'true');
                    canvas.parentNode.insertBefore(mulCanvas, canvas);
                    mulCtx = mulCanvas.getContext('2d');
                    ok = !!mulCtx;
                }
                if (ok) { buildStack(); layout(); }
            } catch (e) { ok = false; }
        }
        if (!ok) {
            gl = null;
            canvas.remove();
            if (mulCanvas) { mulCanvas.remove(); mulCanvas = null; }
            canvas = makeCanvas('sg-canvas sg-mul');
            fallback = canvas.getContext('2d');
            if (!fallback) { canvas.remove(); canvas = null; return; }
            layout();
        }
        host.classList.add('is-lit');

        if (gl) {
            on(canvas, 'webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; });
            on(canvas, 'webglcontextrestored', () => {
                P = {}; map = null; stack = null; moteBuf = null;
                try {
                    quad = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
                    if (buildPrograms()) { buildStack(); layout(); lastDraw = 0; kick(); }
                } catch (e) { /* stay dark */ }
            });
        }

        on(document, 'visibilitychange', () => { if (!document.hidden) { last = 0; kick(); } });
        on(calm, 'change', () => { if (!dead) { if (gl) makeMotes(); lastDraw = 0; kick(); } });
        on(window, 'scroll', () => { if (viewportMode() || cfg.drift) kick(); }, { passive: true });
        const scheme = matchMedia('(prefers-color-scheme: dark)');
        on(scheme, 'change', () => { dark = isDark(); lastDraw = 0; kick(); });
        on(window, 'deviceorientation', () => { if (tiltMoving()) kick(); }, { passive: true });

        if (viewportMode()) {
            visible = true;
            on(window, 'resize', () => {
                clearTimeout(sizeTimer);
                sizeTimer = setTimeout(() => { if (!dead) relayout(); }, 120);
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
        if (cfg.tilt && !frozen()) {
            import('./tilt.js').then((m) => {
                if (dead) return;
                tilt = m.default;
                const fn = () => kick();
                tilt.listeners.add(fn);
                off.push(() => tilt.listeners.delete(fn));
            }).catch(() => {});
        }
        presence = presenceT = targetPresence();
        lastDraw = 0;
        kick();
    }
    function relayout() {
        try { layout(); } catch (e) { return; }
        lastDraw = 0;
        kick();
    }

    // the panel in the page: the window, above its light, dimming with it
    function dressPanel() {
        panelEl = host.querySelector('[data-sg-glass]');
        if (!panelEl || !panelEl.parentNode) return;
        panelEl.classList.add('sg-glass');
    }

    // the panel must load first
    function load() {
        const el = host.querySelector('[data-sg-glass]');
        const url = cfg.glass || (el && (el.currentSrc || el.src)) || '';
        if (!url) return start();
        img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => { if (!dead) start(); };
        img.onerror = () => { img = null; };
        img.src = url;
    }
    dressPanel();
    if (document.fonts && document.fonts.status !== 'loaded') document.fonts.ready.then(() => { if (!dead) load(); });
    else load();

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
        if (panelEl) panelEl.classList.remove('sg-glass');
        host.style.removeProperty('--sg-sun');
        host.classList.remove('is-lit', 'sg-host');
    }
    // Change options live: destroy.set({ sun: [-40, 28], clouds: .8 }).
    destroy.set = (next = {}) => {
        if (dead) return;
        const before = cfg;
        given = { ...given, ...next };
        cfg = readCfg(host, given);
        if (gl && cfg.glass && cfg.glass !== before.glass) {
            const n = new Image();
            n.crossOrigin = 'anonymous';
            n.onload = () => { if (!dead) { img = n; buildStack(); relayout(); } };
            n.src = cfg.glass;
            return;
        }
        if (String(cfg.sun) !== String(before.sun)) ref = null;
        const shape = ['size', 'motes', 'seed'].some((k) => String(cfg[k]) !== String(before[k])) ||
            String(cfg.at) !== String(before.at) || String(cfg.sun) !== String(before.sun);
        if (shape && (gl || fallback)) relayout();
        else { lastDraw = 0; kick(); }
    };
    Object.defineProperty(destroy, 'sun', { get: () => (ref ? sunNow() : null) });
    Object.defineProperty(destroy, 'state', { get: () => ({ running: !!raf, visible, presence: +presence.toFixed(3), motes: motes ? motes.list.length : 0, drift: +driftNow.toFixed(3) }) });
    return destroy;
}

// Auto-start every [data-stained-glass] on the page once it is near the viewport.
function autoStart(el) {
    if (el.__stainedGlass) return;
    el.__stainedGlass = true;
    const go = () => { el.stainedGlass = stainedGlass(el); };
    if (el === document.body || el.dataset.attach === 'viewport' || !('IntersectionObserver' in window)) return go();
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        go();
    }, { rootMargin: '400px' });
    io.observe(el);
}
const boot = () => document.querySelectorAll('[data-stained-glass]').forEach(autoStart);
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
