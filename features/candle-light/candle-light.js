/*
 *  CANDLE-LIGHT // a candlelit painting whose candle is alive.
 *
 *  Markup:  <figure data-candle-light data-rig="assets/magdalen.json">
 *             <img src="assets/magdalen.webp" alt="" width="1800" height="2614">
 *           </figure>
 *  Or call  candleLight(figure, { rig, flicker, draught, spill, warmth })  yourself.
 *  It returns destroy().
 *
 *  The rig (a small JSON made once, offline, from the painting) says where the
 *  painted flames were, holds a patch with them painted out, and a map of how
 *  much of the painting's light came from the flame. In the browser:
 *
 *    plate     the <img> is drawn at one texel per device px, the patch on top,
 *              into one texture: the painting with no flame in it.
 *    flame     drawn in the fragment shader over that plate, after de La
 *              Tour's own: a tall translucent column with a slow S climbing it,
 *              a dark, nearly transparent zone above the wick, a cream body
 *              with faint vertical streaks, edges that dissolve into the dark,
 *              and a top that never closes but thins into a pale thread rising
 *              toward the top of the mirror. Its height and brightness follow a
 *              flicker signal (a slow breath, a faster flutter, now and then a
 *              tall stretch).
 *    relight   each pixel is scaled by mix(1, level^k, influence), and warms
 *              as it dims (a smaller flame is a cooler, redder one). The light
 *              map is read a little shifted toward the flame's lean, and the
 *              side it leans to is lit a little more, so shadows seem to move.
 *    mirror    a second flame (the reflection) shares the same state: in sync,
 *              dimmer, softer, clipped to the glass and hidden behind the
 *              candle in front of it.
 *    draught   pointer speed near the flame (or a sideways swipe on a phone)
 *              is air: anchored at the wick, the flame's upper part lays over
 *              on a spring and tears (fast lateral noise growing with height,
 *              gaps racing up it), it shortens, widens, flickers hard, dims and
 *              turns blue, the room dims with it, and when it nearly goes out a
 *              thread of smoke rises from the wick. A hard enough gust puts it
 *              out; it relights itself after a beat, with a little flare.
 *    spill     two gradient layers centred on the flame (multiply, then screen)
 *              let a faint warm flicker fall on the paper above and right of it.
 *
 *  Runs at ~30 fps while on screen; nothing off screen or in a hidden tab.
 *  Reduced motion: one still frame of the flame, no flicker, no draught.
 *  Without JS or WebGL: the painting as it is.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const FPS = 30;

// 1D value noise, smooth, in [-1, 1]
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1; };

const VERT = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uPlate;   // the painting with its flames painted out, 1 texel = 1 device px
uniform sampler2D uLight;   // how much of each point's light came from the flame
uniform sampler2D uGrain;   // the canvas's own texture (weave, craquelure) round the flames, 128 = none
uniform vec4 uGrainR;       // where that texture lies (uv rect); w = 0 when there is none
uniform float uAspect;      // painting width / height
uniform float uPx;          // one device px, in painting heights
uniform float uT;           // seconds
uniform vec4 uRoom;         // level, k, warmth, light-map shift (painting heights)
uniform vec2 uSrc;          // the light source (uv)
uniform vec4 uMove;         // lean (tip offset, flame heights), turbulence, smoke drift, gust 0-1
uniform vec4 uS;            // height scale, brightness, flare, ember
uniform vec4 uF0;           // flame: wick uv, height (painting heights), half-width / height
uniform vec4 uF1;           // reflection
uniform vec4 uG1;           // reflection: gain, softness, on, -
uniform vec4 uClip1;        // the mirror glass (uv)
uniform vec4 uOcc1;         // what stands in front of the reflection (uv)
uniform vec4 uSmoke;        // emission start, end, strength, -
varying vec2 vUv;

float hash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
float noise(float x) { float i = floor(x), f = fract(x); f = f * f * (3. - 2. * f); return mix(hash(i), hash(i + 1.), f) * 2. - 1.; }
float box(vec2 p, vec4 r, float s) {
    vec2 a = smoothstep(r.xy - s, r.xy + s, p) * (1. - smoothstep(r.zw - s, r.zw + s, p));
    return a.x * a.y;
}

// The spine of the flame at height v (flame heights), in flame heights.
// Anchored at the wick; a slow S climbs it (so the top lags the base); a
// draught lays the upper part over and tears it with fast lateral noise.
float spine(float v, float seed) {
    float lean = uMove.x, turb = uMove.y, gust = uMove.w;
    float vs = clamp(v, 0., 1.6);
    float up = smoothstep(.14, .95, vs);                          // the first fifth stays put
    float sway = .05 * pow(vs, 1.1) * sin(vs * 4.4 - uT * 1.25 + seed)
               + .03 * pow(vs, 1.3) * noise(vs * 1.7 - uT * .6 + seed);
    float tear = gust * pow(vs, 1.5) * (.13 * noise(vs * 7.5 - uT * 13. + seed) + .045 * noise(vs * 15. - uT * 23. + seed * 2.));
    float flut = turb * .018 * pow(vs, 1.6) * noise(vs * 5.6 - uT * 4.4 + seed * 3.1);
    return lean * up * vs * 1.15 + sway * (1. - .6 * gust) + tear + flut;
}

// The flame, in its own frame: v up from the wick in flame heights, u across.
// After de La Tour: a tall translucent column, a dark near-transparent zone
// above the wick, a cream body with faint vertical streaks, edges that
// dissolve into the dark, and a top that never closes but thins into a thread.
vec4 flame(vec2 P, vec4 F, float soft, float seed, out float glow) {
    float H0 = F.z;
    float H = H0 * uS.x;
    vec2 d = P - vec2(F.x * uAspect, F.y);
    float lean = uMove.x, turb = uMove.y, gust = uMove.w;
    vec2 g = vec2(d.x - lean * H * .45, d.y + H * .45) / H0;
    glow = exp(-dot(g * vec2(9., 3.2), g * vec2(9., 3.2))) * uS.y;   // faint and close
    float v = -d.y / H;
    float u = d.x / H;
    if (v < -.08 || v > 1.12 || abs(u) > 1.6) return vec4(0.);
    float vv = v * (1. + .25 * abs(lean));
    float c = spine(v, seed);
    float base = sqrt(clamp((vv + .03) / .15, 0., 1.));            // round at the wick
    float body = (1. - .36 * smoothstep(.12, .85, vv)) * (1. + .5 * gust);  // a bulb low down, a ribbon above  // a draught makes it squat and wide
    float neck = mix(1., .2, smoothstep(.7, 1.02, vv));            // the top narrows into a thread
    float r = F.w * 1.5 * base * body * neck * (1. + .07 * turb * noise(vv * 3.3 - uT * 3.1 + seed * 7.));
    r = max(r, 1e-4);
    float e = abs(u - c) / r;
    // a crisp outline (as his brush left it, over a px or two) with the
    // translucency inside it: dense core, a mantle the dark shows through
    float pxE = uPx / (H * r);
    float ew = .05 + soft * .3;
    float a = (1. - smoothstep(1. - ew - pxE, 1. + pxE, e)) * mix(.96, .62, smoothstep(.62, .98, e));
    // the column thins upward and fades into its thread
    a *= mix(1., .6, smoothstep(.6, .98, vv)) * (1. - smoothstep(.96, 1.1, vv));
    // in a draught the upper half tears: gaps race up it and leave tongues
    float gap = smoothstep(.1, .55, noise(vv * 3.6 - uT * 9.5 + seed * 5.));
    a *= 1. - gust * smoothstep(.3, .65, vv) * gap * .95;
    // colours sampled from his flame (body ~ 230 201 137)
    vec3 rim = vec3(.84, .63, .32);
    vec3 cream = vec3(.92, .81, .58);
    vec3 core = vec3(.95, .87, .66);
    vec3 col = mix(rim, cream, smoothstep(1., .7, e));
    col = mix(col, core, smoothstep(.6, .1, e) * smoothstep(.12, .3, vv) * (1. - .5 * smoothstep(.6, 1., vv)));
    // faint vertical streaks, as his brush left them
    col *= 1. + .09 * noise((u - c) / r * 3.2 + vv * .5 + seed * 9.);
    // the dark zone: unburnt vapour round the wick, brownish and nearly transparent
    // inside a bright envelope, like a tear of smoked glass
    float dz = (1. - smoothstep(.04, .3, vv)) * (1. - smoothstep(.3, .8, e));
    col = mix(col, vec3(.3, .22, .14), dz * .85);
    a *= 1. - .5 * dz;
    // the wick inside it
    float wk = (1. - smoothstep(.0, .022, abs(u) * H / H0)) * (1. - smoothstep(.035, .07, vv)) * step(-.01, vv);
    col = mix(col, vec3(.05, .03, .02), wk * .8);
    a = max(a, wk * .8);
    // blue at the very foot, and the whole flame bluer and fainter as it starves
    vec3 blue = vec3(.30, .38, .66);
    col = mix(col, blue, (1. - smoothstep(-.02, .09, vv)) * smoothstep(.25, .9, e) * .6);
    float b = uS.y;
    col = mix(blue * .9, col, smoothstep(.12, .6, b));
    col *= .62 + .38 * b + .15 * uS.z;
    a *= mix(.45, 1., smoothstep(.05, .5, b));
    return vec4(col, clamp(a, 0., 1.));
}

// What rises from the tip of a calm flame: a pale, wavering thread (in the
// painting both flames have one), fainter as the flame starves.
float thread(vec2 P, vec4 F, float seed) {
    float H0 = F.z;
    float H = H0 * uS.x;
    vec2 d = P - vec2(F.x * uAspect, F.y);
    float s = (-d.y - H * .9) / H0;                                // from the top of the flame
    if (s < 0. || s > .9) return 0.;
    float x0 = spine(.9 + s * H0 / H, seed) * H / H0;
    float xs = x0 + uMove.x * s * .35 + .018 * s * sin(s * 11. - uT * 3.2 + seed) + .012 * noise(s * 6. - uT * 2.1 + seed);
    float th = .016 + .03 * s;
    float k = (d.x / H0 - xs) / th;
    return .36 * exp(-k * k) * exp(-s * 2.6) * smoothstep(0., .06, s) * (1. - uMove.w) * smoothstep(.3, .8, uS.y);
}

// The thread of smoke from a starved or snuffed wick: a ribbon that rises in
// a straight laminar line, then begins to wave and curl, spreading and fading.
float smoke(vec2 P, vec4 F) {
    if (uSmoke.z <= 0.) return 0.;
    float H0 = F.z;
    vec2 d = P - vec2(F.x * uAspect, F.y - H0 * .03);
    float sv = -d.y / H0;
    if (sv < 0. || sv > 3.6) return 0.;
    float su = d.x / H0;
    float te = uT - sv / 2.2 - sv * sv * .06;             // when this part left the wick
    float E = smoothstep(uSmoke.x, uSmoke.x + .15, te) * (1. - smoothstep(uSmoke.y, uSmoke.y + .9, te));
    if (E <= 0.) return 0.;
    float grow = smoothstep(.2, 1.7, sv);
    float A = .015 * sv + .11 * grow * sv;
    float xs = uMove.z * sv * (.5 + .2 * sv)
             + A * (.6 * sin(sv * 6.3 - uT * 8.1 + 1.3) + .4 * sin(sv * 2.7 - uT * 3.6 + 4.1))
             + .06 * grow * sv * noise(sv * 3.7 - uT * 4.6);
    float th = .009 + .006 * sv + .04 * grow * sv;
    float tw = sin(sv * 8.7 - uT * 6.8) * th * .9;        // the ribbon turning
    float k1 = (su - xs - tw * .5) / th, k2 = (su - xs + tw * .5) / th;
    float pr = exp(-k1 * k1) + .75 * exp(-k2 * k2);
    float a = pr * E * uSmoke.z * min(1., .02 / th) * exp(-sv * .55) * smoothstep(.0, .06, sv);
    return clamp(a * .5, 0., .75);
}

vec3 shoulder(vec3 x) { return mix(x, .86 + .14 * (1. - exp(-(x - .86) / .14)), step(.86, x)); }

void main() {
    vec2 P = vec2(vUv.x * uAspect, vUv.y);
    vec3 plate = texture2D(uPlate, vUv).rgb;
    // relight: the painted light breathes with the flame
    float level = uRoom.x;
    vec2 shift = vec2(uMove.x * uRoom.w / uAspect, 0.);
    float inf = texture2D(uLight, vUv - shift).r;
    vec2 dir = P - vec2(uSrc.x * uAspect, uSrc.y);
    float side = dir.x / (length(dir) + .04);
    // mix(1, level^k, influence): the flame's share of each point's light follows it, never below black
    float lvl = mix(1., pow(level, uRoom.y), inf) * (1. + .2 * uMove.x * side * inf);
    vec3 warm = mix(vec3(1.), vec3(1., .84, .64), clamp((1. - level) * 1.5, 0., 1.) * inf * uRoom.z);
    vec3 res = shoulder(plate * lvl * warm);

    // the canvas texture, fixed to the canvas: the flame is multiplied by it
    // so the cracks run through it as they run through his
    float grain = 0.;
    if (uGrainR.z > 0.) {
        vec2 gq = (vUv - uGrainR.xy) / uGrainR.zw;
        if (gq.x > 0. && gq.y > 0. && gq.x < 1. && gq.y < 1.) grain = texture2D(uGrain, gq).r * 2. - 1.;
    }
    vec3 glowCol = vec3(1., .6, .26);
    float onePx = uPx;

    // the reflection first: it is behind everything in front of the mirror
    if (uG1.z > .5) {
        float m = box(vUv, uClip1, onePx) * (1. - box(vUv, uOcc1, onePx));
        if (m > 0.) {
            float gl;
            vec4 f = flame(P, uF1, .32 * uG1.y, 17.3, gl);
            float s = smoke(P, uF1) * .7;
            res = mix(res, vec3(.5, .49, .47), s * m);
            res = mix(res, vec3(.74, .66, .5) * (1. + grain * .07), thread(P, uF1, 17.3) * m * uG1.x);
            res = mix(res, f.rgb * uG1.x * (1. + grain * (.07 + .06 * f.a)), f.a * m);
            res = 1. - (1. - res) * (1. - glowCol * gl * .05 * uG1.x * m);
            if (uS.w > 0.) {
                vec2 w = (P - vec2(uF1.x * uAspect, uF1.y - uF1.z * .02)) / uF1.z;
                res += vec3(1., .35, .08) * uS.w * exp(-dot(w, w) / .0012) * .6 * uG1.x * m;
            }
        }
    }
    float gl;
    vec4 f = flame(P, uF0, .25, 3.7, gl);
    float s = smoke(P, uF0);
    res = mix(res, vec3(.62, .6, .57), s);
    res = mix(res, vec3(.82, .74, .58) * (1. + grain * .07), thread(P, uF0, 3.7));
    res = mix(res, f.rgb * (1. + grain * (.07 + .06 * f.a)), f.a);
    res = 1. - (1. - res) * (1. - glowCol * gl * .07);
    // a snuffed wick still glows for a moment
    if (uS.w > 0.) {
        vec2 w = (P - vec2(uF0.x * uAspect, uF0.y - uF0.z * .02)) / uF0.z;
        res += vec3(1., .35, .08) * uS.w * exp(-dot(w, w) / .0009) * .9;
    }
    gl_FragColor = vec4(res, 1.);
}`;

export function candleLight(root, opts = {}) {
    const img = root.querySelector('img');
    if (!img) return () => {};
    const num = (k, d) => {
        const v = opts[k] ?? root.dataset[k];
        const n = Number(v);
        return v == null || v === '' || Number.isNaN(n) ? d : n;
    };
    const cfg = {
        rig: opts.rig ?? root.dataset.rig,
        flicker: num('flicker', 1),        // 0-1+, how much the still flame breathes
        draught: num('draught', 1),        // sensitivity to a passing hand
        spill: num('spill', 1),            // 0-1, light leaving the frame
        warmth: num('warmth', 1),          // 0-1, how much a dimming flame warms the room
        k: num('relight', 1.8),            // how strongly the painted light follows the flame
    };
    if (!cfg.rig) return () => {};

    let dead = false, gl, prog, U = {}, texPlate, texLight, canvas, rig, base, patchImg, lightImg, grainImg;
    let spillMul, spillScr, io, ro, raf = 0, visible = false, lastDraw = 0, lastSim = 0;
    let W = 0, H = 0, dpr = 1, ownLabel = false;
    const off = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };

    // ---- the flame's life ---------------------------------------------------
    const st = {
        t: 0, g: 0, dir: 1, lean: 0, leanV: 0, h: 1, b: 1, flare: 0, ember: 0,
        out: false, outAt: 0, stretch: 0, nextEvent: 2, ev: null,
        smoke: { t0: -99, t1: -99, k: 0, on: false },
    };

    function step(dt) {
        const t = (st.t += dt);
        const F = cfg.flicker;
        // still air: a slow breath, a faster flutter, a quick shimmer
        const fl = 1 + F * (.06 * noise(t * .55) + .05 * noise(t * 1.9 + 11) + .03 * noise(t * 4.3 + 23) + .012 * noise(t * 9.1 + 37));
        // now and then the flame stretches tall (or dips) for half a second
        if (t > st.nextEvent && !st.ev) {
            const tall = hash(t) > .35;
            st.ev = { t0: t, dur: .45 + hash(t + 1) * .5, amp: tall ? .1 + hash(t + 2) * .14 : -(.06 + hash(t + 3) * .06) };
            st.nextEvent = t + 1.4 + hash(t + 4) * 3;
        }
        let stretch = 0;
        if (st.ev) {
            const k = (t - st.ev.t0) / st.ev.dur;
            if (k >= 1) st.ev = null; else stretch = st.ev.amp * Math.sin(Math.PI * k) ** 2 * F;
        }
        // draught: decays over a couple of seconds
        st.g *= Math.exp(-dt / (st.g > 1 ? .55 : .8));
        const g = st.g, sg = smooth(0, 1.05, g);
        if (!st.out && g > 1.4) { st.out = true; st.outAt = t; }
        if (st.out && t - st.outAt > 1.1 && g < .7) { st.out = false; st.flare = 1; }
        st.flare *= Math.exp(-dt / .45);
        // lean: a spring toward the push of the air, so it whips over and settles
        const gust = g > .05 ? noise(t * 5.3 + 3) * .22 * Math.min(g, 1) : 0;
        const target = st.dir * .6 * sg + gust + .035 * noise(t * .37 + 5) * F;
        const w = 9.5, z = .38;
        st.leanV += (w * w * (target - st.lean) - 2 * z * w * st.leanV) * dt;
        st.lean += st.leanV * dt;
        st.lean = clamp(st.lean, -1.2, 1.2);
        // height and brightness, with a quick fall and a slower regrowth
        let hT = (1 + 1.2 * (fl - 1) + stretch) * (1 - .7 * sg) * (1 - .5 * smooth(.8, 1.4, g)) + .3 * st.flare;
        let bT = (1 - .72 * smooth(.15, 1.25, g)) * (1 - .32 * sg * (.5 + .5 * noise(t * 11 + 3))) + .25 * st.flare;
        if (st.out) { hT = .05; bT = .02; }
        st.h += (hT - st.h) * (1 - Math.exp(-dt / (hT < st.h ? .07 : .3)));
        st.b += (bT - st.b) * (1 - Math.exp(-dt / (bT < st.b ? .06 : .35)));
        st.ember = st.out ? Math.exp(-(t - st.outAt) / 1.2) : Math.max(0, st.ember - dt * 3);
        // smoke while starved or snuffed
        const smoking = st.out || st.b < .5;
        const sm = st.smoke;
        if (smoking && !sm.on) {
            sm.on = true; sm.k = st.out ? 1 : .7;
            if (t > sm.t1 + 4) sm.t0 = t; // a fresh thread unless the last is still rising
            sm.t1 = 1e6;
        } else if (sm.on) {
            if (st.out) sm.k = 1;
            if (!smoking) { sm.on = false; sm.t1 = t + .25; }
        }
        if (!sm.on && t > sm.t1 + 6) sm.k = 0;
        st.fl = fl;
    }
    // how much light reaches the room: a taller, brighter flame gives more
    const level = () => clamp(st.b * (.22 + .78 * st.h) * (1 + .6 * (st.fl - 1)), .3, 1.35);

    // ---- WebGL ----------------------------------------------------------------
    function initGL() {
        canvas = document.createElement('canvas');
        canvas.className = 'cl-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        gl = canvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
        if (!gl) return false;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('candle-light:', gl.getShaderInfoLog(s)); return null; }
            return s;
        };
        const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return false;
        prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        for (const n of ['uPlate', 'uLight', 'uGrain', 'uGrainR', 'uAspect', 'uPx', 'uT', 'uRoom', 'uSrc', 'uMove', 'uS', 'uF0', 'uF1', 'uG1', 'uClip1', 'uOcc1', 'uSmoke']) U[n] = gl.getUniformLocation(prog, n);
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
        texPlate = tex(0); texLight = tex(1); const texGrain = tex(2);
        gl.uniform1i(U.uPlate, 0); gl.uniform1i(U.uLight, 1); gl.uniform1i(U.uGrain, 2);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        if (grainImg) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, grainImg);
            const q = rig.grain;
            gl.uniform4f(U.uGrainR, q.x, q.y, q.w, q.h);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array([128]));
            gl.uniform4f(U.uGrainR, 0, 0, 0, 0);
        }
        gl.activeTexture(gl.TEXTURE1);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, lightImg);
        // the rig, once
        const [f0, f1] = rig.flames;
        const asp = rig.width / rig.height;
        const fl = (f) => [f.x, f.y, f.h, (f.w * asp) / 2 / f.h];
        gl.uniform1f(U.uAspect, asp);
        gl.uniform2f(U.uSrc, rig.source[0], rig.source[1]);
        gl.uniform4f(U.uF0, ...fl(f0));
        if (f1) {
            gl.uniform4f(U.uF1, ...fl(f1));
            gl.uniform4f(U.uG1, f1.gain ?? .8, f1.soft ?? 1.5, 1, 0);
            gl.uniform4f(U.uClip1, ...(f1.clip || [0, 0, 1, 1]));
            gl.uniform4f(U.uOcc1, ...(f1.occlude || [2, 2, 2, 2]));
        } else gl.uniform4f(U.uG1, 0, 1, 0, 0);
        return true;
    }

    // the plate: the img at device resolution with the flames painted out
    function uploadPlate() {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(base, 0, 0, W, H);
        const p = rig.patch;
        x.drawImage(patchImg, p.x * W, p.y * H, p.w * W, p.h * H);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texPlate);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, c);
        c.width = c.height = 0;
    }

    function layout() {
        if (!gl || dead) return;
        const cw = img.clientWidth, ch = img.clientHeight;
        if (!cw || !ch) return;
        dpr = Math.min(2, devicePixelRatio || 1);
        const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
        Object.assign(canvas.style, { left: img.offsetLeft + 'px', top: img.offsetTop + 'px', width: cw + 'px', height: ch + 'px' });
        if (w !== W || h !== H) {
            W = canvas.width = w; H = canvas.height = h;
            gl.viewport(0, 0, W, H);
            gl.uniform1f(U.uPx, 1 / H);
            uploadPlate();
        }
        layoutSpill(cw, ch);
        draw();
    }

    // ---- light leaving the frame ---------------------------------------------
    function makeSpill() {
        spillMul = document.createElement('div');
        spillScr = document.createElement('div');
        spillMul.className = 'cl-spill cl-spill-mul';
        spillScr.className = 'cl-spill cl-spill-scr';
        for (const s of [spillMul, spillScr]) s.setAttribute('aria-hidden', 'true');
        root.append(spillMul, spillScr);
    }
    function layoutSpill(cw, ch) {
        if (!spillMul || !cfg.spill) return;
        const f = rig.flames[0];
        // the flame's heart, in the figure's coordinates
        const fx = img.offsetLeft + f.x * cw, fy = img.offsetTop + (f.y - f.h * .45) * ch;
        // a candle's reach: centred on the flame itself, so the paper above and
        // to the right of the painting gets most of it
        const R = ch * .95;
        const rr = root.getBoundingClientRect();
        const docW = document.documentElement.clientWidth;
        // keep it inside the page sideways: no horizontal scroll from light
        const x0 = Math.max(fx - R, -rr.left), x1 = Math.min(fx + R, docW - rr.left);
        const RY = R;
        const y0 = fy - RY, y1 = fy + RY;
        const cx = fx - x0, cy = fy - y0;
        const cs = getComputedStyle(root);
        const mulC = (cs.getPropertyValue('--cl-spill-mul') || '255 196 128').trim();
        const scrC = (cs.getPropertyValue('--cl-spill-scr') || '255 150 60').trim();
        // inverse-square-ish falloff, with a near floor so it never ends in a ring
        const stops = (rgb, amp, r0) => {
            const s = [];
            for (let i = 0; i <= 28; i++) {
                const d = i / 28;
                const a = amp * (1 / (1 + (d / r0) ** 2)) * (1 - d * d) ** 2;   // windowed: no ring where it ends
                s.push(`rgb(${rgb} / ${a.toFixed(4)}) ${(d * 100).toFixed(1)}%`);
            }
            return `radial-gradient(${R}px ${RY}px at ${cx}px ${cy}px, ${s.join(', ')})`;
        };
        // on a dark page there is no paper to warm: only the glow
        const dark = pageLum() < .35;
        for (const [el, rgb, amp, r0] of [[spillMul, mulC, dark ? 0 : .5 * cfg.spill, .3], [spillScr, scrC, (dark ? .3 : .2) * cfg.spill, .25]]) {
            Object.assign(el.style, { left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px', backgroundImage: stops(rgb, amp, r0), transformOrigin: `${cx}px ${cy}px` });
        }
    }
    function pageLum() {
        for (let el = root.parentElement; el; el = el.parentElement) {
            const m = getComputedStyle(el).backgroundColor.match(/[\d.]+/g);
            if (m && (m[3] === undefined || Number(m[3]) > .5)) return (.2126 * m[0] + .7152 * m[1] + .0722 * m[2]) / 255;
        }
        return 1;
    }
    function drawSpill(lv) {
        if (!spillMul || !cfg.spill) return;
        const k = clamp(lv, 0, 1.4);
        // the paper follows the flame, a little exaggerated so the eye catches it
        spillMul.style.opacity = clamp(.62 + 3.4 * (k - 1), .1, 1).toFixed(3);
        spillScr.style.opacity = clamp(.55 + 3 * (k - 1), .05, 1).toFixed(3);
        const s = (.9 + .1 * Math.min(k, 1)).toFixed(3);   // never past 1: no overflow
        spillMul.style.transform = spillScr.style.transform = `scale(${s})`;
    }

    // ---- drawing -----------------------------------------------------------------
    function draw() {
        if (!gl || !W) return;
        const lv = level();
        const f0 = rig.flames[0];
        gl.uniform1f(U.uT, st.t % 600);
        gl.uniform4f(U.uRoom, lv, cfg.k, cfg.warmth, f0.h * .22);
        gl.uniform4f(U.uMove, st.lean, .55 + 1.4 * Math.min(st.g, 1.2) + .6 * st.flare, st.lean * .3, smooth(.05, .9, st.g));
        gl.uniform4f(U.uS, st.h, st.b, st.flare, st.ember);
        const sm = st.smoke;
        const T = st.t % 600;   // smoke times relative to the shader's clock
        gl.uniform4f(U.uSmoke, T + Math.max(sm.t0 - st.t, -50), T + Math.min(sm.t1 - st.t, 1e4), sm.k, 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        drawSpill(lv);
    }

    function frame(now) {
        raf = 0;
        if (dead || !visible || document.hidden || calm.matches) return;
        raf = requestAnimationFrame(frame);
        if (now - lastDraw < 1000 / FPS - 2) return;
        const dt = lastSim ? Math.min(.07, (now - lastSim) / 1000) : 1 / FPS;
        lastSim = lastDraw = now;
        step(dt);
        draw();
    }
    function wake() {
        if (raf || dead || !gl || !visible || document.hidden || calm.matches) return;
        lastSim = 0;
        raf = requestAnimationFrame(frame);
    }
    function still() {
        // one beautiful frame: the flame at rest, upright, a touch of life in its spine
        Object.assign(st, { t: 7.3, g: 0, lean: .03, leanV: 0, h: 1.04, b: 1, flare: 0, ember: 0, out: false, fl: 1 });
        st.smoke = { t0: -99, t1: -99, k: 0, on: false };
        draw();
    }

    // ---- the draught ----------------------------------------------------------------
    let lastP = null;
    function onMove(e) {
        if (calm.matches || !visible || !gl) return;
        const now = e.timeStamp;
        const p = { x: e.clientX, y: e.clientY, t: now, id: e.pointerId };
        const prev = lastP; lastP = p;
        if (!prev || prev.id !== p.id) return;
        const dt = (now - prev.t) / 1000;
        if (dt <= 0 || dt > .12) return;
        const vx = (p.x - prev.x) / dt, vy = (p.y - prev.y) / dt;
        const r = img.getBoundingClientRect();
        const f = rig.flames[0];
        const fx = r.left + f.x * r.width, fy = r.top + (f.y - f.h * .5) * r.height;
        const touch = e.pointerType !== 'mouse';
        const R = r.width * (touch ? .9 : .3);
        const dist = Math.hypot(p.x - fx, (p.y - fy) * .8);
        let near = Math.exp(-((dist / R) ** 2));
        if (touch) near = Math.max(near, root.contains(e.target) ? .45 : 0);
        const speed = Math.hypot(vx, vy * .5);
        const push = clamp((speed - (touch ? 180 : 260)) / 1500, 0, 1.6) * near * cfg.draught;
        if (push <= 0) return;
        st.g = Math.min(1.9, st.g + push * dt * 9);
        // the flame goes with the air the hand drags along
        const want = Math.abs(vx) > 40 ? Math.sign(vx) : st.dir;
        st.dir += (want - st.dir) * clamp(push * dt * 12);
        wake();
    }
    function onKey(e) {
        if (calm.matches || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        st.g = Math.min(1.9, st.g + .95);
        st.dir = hash(st.t) > .5 ? 1 : -1;
        wake();
    }

    // ---- life cycle -------------------------------------------------------------------
    function goLive() {
        if (!initGL()) { teardownGL(); return; }
        root.classList.add('is-live');
        root.append(canvas);
        if (cfg.spill) makeSpill();
        on(canvas, 'webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); raf = 0; root.classList.remove('is-live'); });
        on(canvas, 'webglcontextrestored', () => { W = H = 0; const c = canvas; c.remove(); gl = null; if (initGL()) { root.classList.add('is-live'); root.append(canvas); layout(); calm.matches ? still() : wake(); } });
        ro = new ResizeObserver(() => layout());
        ro.observe(img);
        on(window, 'resize', () => layout());
        io = new IntersectionObserver((es) => {
            visible = es[es.length - 1].isIntersecting;
            if (visible) wake(); else { cancelAnimationFrame(raf); raf = 0; }
        });
        io.observe(root);
        on(document, 'visibilitychange', () => (document.hidden ? (cancelAnimationFrame(raf), raf = 0) : wake()));
        on(document, 'pointermove', onMove, { passive: true });
        on(root, 'keydown', onKey);
        const motion = () => {
            if (calm.matches) {
                cancelAnimationFrame(raf); raf = 0;
                root.removeAttribute('tabindex'); root.removeAttribute('role');
                still();
            } else {
                root.tabIndex = 0;
                root.setAttribute('role', 'button');
                if (!root.hasAttribute('aria-label')) { root.setAttribute('aria-label', 'A candlelit painting. Press Enter to breathe on the candle.'); ownLabel = true; }
                wake();
            }
        };
        on(calm, 'change', motion);
        layout();
        motion();
    }
    function teardownGL() {
        cancelAnimationFrame(raf); raf = 0;
        if (gl) gl.getExtension('WEBGL_lose_context')?.loseContext();
        gl = null;
        canvas?.remove();
    }

    const loadImg = (src) => new Promise((res, rej) => {
        const i = new Image();
        i.decoding = 'async';
        i.onload = () => res(i); i.onerror = rej;
        i.src = src;
    });
    (async () => {
        try {
            const url = new URL(typeof cfg.rig === 'string' ? cfg.rig : '.', document.baseURI);
            rig = typeof cfg.rig === 'string' ? await (await fetch(url)).json() : cfg.rig;
            [patchImg, lightImg, grainImg] = await Promise.all([
                loadImg(new URL(rig.patch.src, url)), loadImg(new URL(rig.light, url)),
                rig.grain ? loadImg(new URL(rig.grain.src, url)).catch(() => null) : null,   // optional
            ]);
            if (!img.complete || !img.naturalWidth) await new Promise((r, j) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', j, { once: true }); });
            await img.decode?.().catch(() => {});
            base = img;
            if (!dead) goLive();
        } catch (err) {
            console.warn('candle-light: staying with the painting as it is', err);
        }
    })();

    const destroy = () => {
        dead = true;
        off.splice(0).forEach((f) => f());
        io?.disconnect(); ro?.disconnect();
        teardownGL();
        spillMul?.remove(); spillScr?.remove();
        root.classList.remove('is-live');
        root.removeAttribute('tabindex'); root.removeAttribute('role');
        if (ownLabel) root.removeAttribute('aria-label');
        delete root.candleLight;
    };
    destroy.state = st;
    root.candleLight = destroy;
    return destroy;
}

// auto-start
const boot = () => document.querySelectorAll('[data-candle-light]').forEach((el) => { if (!el.candleLight) candleLight(el); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
