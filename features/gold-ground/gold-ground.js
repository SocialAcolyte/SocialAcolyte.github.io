/*
 *  GOLD-GROUND // a Byzantine gold mosaic that glints like the real wall.
 *
 *  Markup:  <figure data-gold-ground>
 *             <img src="assets/justinian.webp" alt="">
 *           </figure>
 *  The tile data sits beside the image as <name>-tiles.png (or data-tiles="url").
 *  Or call  goldGround(figure, { tiles, distance, candle, window, bloom, glow })
 *  yourself. It returns destroy().
 *
 *  Options (data attributes, all optional; the options object wins):
 *    data-tiles="…png"      the baked tile data (default: <img name>-tiles.png)
 *    data-distance="2.2"    how far away you stand, in screen sizes. Nearer = sparks
 *                           change faster as you scroll
 *    data-candle="1"        0-2, strength of the moving candle
 *    data-window="1"        0-2, strength of the broad window light
 *    data-glow=".5"         0-1, the bloom round the brightest sparks
 *    data-bloom             arrive greyed and warm into gold as it reaches the middle
 *                           of the screen
 *
 *  Gold tesserae are gold leaf sealed under a skin of glass, cut into cubes and
 *  pressed into the plaster by hand, each a few degrees off true. Every cube is a
 *  small tilted mirror, so as you move, or the light does, single cubes flash and
 *  go out. The photograph is the albedo. Offline (see README) the real tesserae
 *  were segmented from the photograph: the grout network, a watershed, one region
 *  per cube, and each cube was given a material (gold, silver or leafless glass,
 *  coloured glass, stone), a hand-set tilt (gold more, the field leaning a little
 *  downward toward people below) and a roughness. That is baked into one lossless
 *  PNG at the image's resolution:
 *
 *    R, G  the cube's normal, x and y (128 = straight out, +-127 = +-0.5)
 *    B     material in the top two bits, roughness in the low six
 *
 *  Per pixel the shader finds the cube's normal, the eye (the middle of the
 *  screen, so it moves as you scroll; the phone's tilt moves it too) and two
 *  lights: a candle (it follows the pointer) and a broad window. The gold
 *  reflects each as a lobe on the half-vector, gold-tinted, near white at the
 *  peak; coloured glass gives a weaker white glint, stone almost none. Gold not
 *  catching goes deeper and browner than the flash-lit photo, and each cube
 *  reflects a slightly different part of a dim church, so the field is never
 *  even. Joints get a hair of shadow (the cube's edge is found where the data
 *  changes). A half-resolution pass keeps only the brightest sparks, blurs them
 *  and lays them back over as a little bloom.
 *
 *  Draws only while scroll, pointer or tilt are moving it, and only on screen.
 *  Reduced motion: one still frame with a fixed, flattering set of glints.
 *  Without JS or WebGL: the photograph.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const VERT = `
attribute vec2 p;
varying vec2 vUv;
void main() { vUv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;

const COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uAlb;     // the photograph, cropped to the canvas
uniform sampler2D uData;    // tile data, at the image's own resolution (nearest)
uniform vec4 uCrop;         // data uv = uCrop.xy + vUv * uCrop.zw
uniform vec2 uTexel;        // one data texel, in uv
uniform vec2 uSize;         // the figure, css px
uniform vec3 uEye;          // css px from the figure's top left; z out of the wall
uniform vec3 uCandle;
uniform vec3 uWin;          // the window: a broad opening high in the wall, css px like the eye
uniform float uCurve;       // radius of the wall's gentle concave curve, css px
uniform float uCandleK;
uniform float uWinK;
uniform float uColor;       // 0 grey .. 1 gold
varying vec2 vUv;

const vec3 CANDLE = vec3(1., .8, .56);
const vec3 DAY = vec3(1., .93, .82);

void decode(vec3 d, out vec2 t, out float mat, out float conf, out float rough) {
    t = (d.rg * 255. - 128.) / 127. * .5;
    float b = floor(d.b * 255. + .5);
    mat = floor(b / 64. + .001);
    float r = b - mat * 64.;
    conf = floor(r / 32. + .001);
    rough = (r - conf * 32.) / 31.;
}

float lobe(vec3 N, vec3 H, float w2) { return exp(-(1. - dot(N, H)) * 2. / w2); }

// light off one cube. spec = what the glass and the leaf mirror; base = the cube
// itself, lit by the dim church
void light(vec2 uv, vec3 alb, out vec3 base, out vec3 spec, out float mat) {
    vec3 d = texture2D(uData, uCrop.xy + uv * uCrop.zw).rgb;
    vec2 t; float conf, rough;
    decode(d, t, mat, conf, rough);
    vec3 P = vec3(uv * uSize, 0.);
    // the wall is not flat: a gentle concave curve, like the inside of an apse,
    // turns its surface slowly across the field. The cube's own tilt rides on that.
    vec2 macro = -(P.xy - uSize * .5) / uCurve;
    vec3 Nm = normalize(vec3(macro, 1.));
    vec3 N = normalize(vec3(macro + t, 1.));
    vec3 V = normalize(uEye - P);
    vec3 Hc = normalize(normalize(uCandle - P) + V);
    vec3 Hw = normalize(normalize(uWin - P) + V);
    float lum = dot(alb, vec3(.3, .55, .15));
    float gold = step(2.5, mat), silver = step(1.5, mat) * (1. - gold);

    // Each light makes a pool: across the wall the mirror angle drifts slowly
    // through the angle the cubes are set at, and where it passes, many cubes
    // catch at once, at every strength, the lobe being about as wide as the
    // spread of the setting. Outside it only the steepest-set cubes still catch.
    float wr = mix(.07, .1, rough * rough);
    float wc = wr * wr + .0004;                // candle: a small flame
    float ww = wr * wr + .0025;                // window: a broad opening
    float lc = lobe(N, Hc, wc) * uCandleK;
    float lw = lobe(N, Hw, ww) * uWinK;
    // a cube whose outline is not trusted (two run together, a sliver) never
    // flashes alone: it takes the pool's average light, which has no shape
    float sp = .022;                           // 2 x the spread of the setting, squared
    float mc = lobe(Nm, Hc, wc + sp) * uCandleK * wc / (wc + sp);
    float mw = lobe(Nm, Hw, ww + sp) * uWinK * ww / (ww + sp);
    lc = mix(mc, lc, conf);
    lw = mix(mw, lw, conf);

    // what each cube reflects of the room around: tipped toward the vault and
    // the window side it is lighter, tipped toward the floor darker
    float env = clamp(.9 + 1.8 * dot(t, vec2(-.45, -.89)) * conf, .66, 1.16);

    if (gold > .5) {
        // the leaf, seen through its glass: deeper and browner than the flash photo
        // (and a brightly photographed gold more so)
        base = alb * vec3(.84, .74, .58) * env * (1. - .24 * smoothstep(.45, .85, lum));
        vec3 tint = mix(vec3(1., .8, .44), alb / max(lum, .08) * .62, .3);
        // the leaf mirrors gold; the glass over it adds a little white of its own,
        // so the very peak of a flash goes nearly white
        spec = (tint * (.7 + .45 * lum) + .12) * (lc * CANDLE * 3.6 + lw * DAY * 1.5);
    } else if (silver > .5) {
        base = alb * .82 * env;
        spec = vec3(.92, .94, .97) * (lc * CANDLE * 2.4 + lw * DAY * 1.) * (.5 + .6 * lum) * conf;
    } else {
        // coloured glass and stone: only a faint, shapeless gloss from the pool
        base = alb * .95;
        spec = vec3(1.) * (lobe(Nm, Hc, .05) * uCandleK * .05 + lobe(Nm, Hw, .06) * uWinK * .03) * step(.5, mat);
    }
}
`;

const FRAG_MAIN = COMMON + `
uniform sampler2D uBloom;
uniform vec2 uRes;
uniform float uGlow;

// joints: where the tile data changes within a texel or two, the cube's edge
float edginess(vec2 duv) {
    vec3 c = texture2D(uData, duv).rgb;
    float e = 0.;
    vec2 o = uTexel * 1.1;
    e += step(.001, length(texture2D(uData, duv + vec2(o.x, 0.)).rgb - c));
    e += step(.001, length(texture2D(uData, duv - vec2(o.x, 0.)).rgb - c));
    e += step(.001, length(texture2D(uData, duv + vec2(0., o.y)).rgb - c));
    e += step(.001, length(texture2D(uData, duv - vec2(0., o.y)).rgb - c));
    vec2 q = uTexel * 2.2;
    float f = 0.;
    f += step(.001, length(texture2D(uData, duv + vec2(q.x, q.y)).rgb - c));
    f += step(.001, length(texture2D(uData, duv - vec2(q.x, q.y)).rgb - c));
    f += step(.001, length(texture2D(uData, duv + vec2(q.x, -q.y)).rgb - c));
    f += step(.001, length(texture2D(uData, duv - vec2(q.x, -q.y)).rgb - c));
    return clamp(e * .25 + f * .12, 0., 1.);
}

void main() {
    vec3 alb = texture2D(uAlb, vUv).rgb;
    vec3 base, spec; float mat;
    light(vUv, alb, base, spec, mat);
    float e = edginess(uCrop.xy + vUv * uCrop.zw);
    // a cube's rounded rim does not catch what its face does, and casts a hair of shadow
    // (only metal cubes: elsewhere the photo's own joints are enough)
    float metal = step(1.5, mat);
    spec *= 1. - .75 * e;
    base *= 1. - .12 * e * metal;
    vec3 c = base + spec;
    // highlights roll off toward white instead of clipping
    vec3 hi = max(c - .72, 0.);
    c = min(c, .72) + .28 * (1. - exp(-hi / .28));
    c += texture2D(uBloom, gl_FragCoord.xy / uRes).rgb * uGlow;
    float l = dot(c, vec3(.3, .59, .11));
    c = mix(vec3(l) * vec3(1.02, 1., .96), c, uColor);
    gl_FragColor = vec4(c, 1.);
}`;

// half resolution: only the brightest sparks, for the bloom
const FRAG_SPARK = COMMON + `
void main() {
    vec3 alb = texture2D(uAlb, vUv).rgb;
    vec3 base, spec; float mat;
    light(vUv, alb, base, spec, mat);
    vec3 c = base + spec;
    gl_FragColor = vec4(max(c - 1.05, 0.) * .9, 1.);
}`;

const FRAG_BLUR = `
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uDir;
void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    vec3 s = texture2D(uSrc, uv).rgb * .227;
    s += (texture2D(uSrc, uv + uDir * 1.38).rgb + texture2D(uSrc, uv - uDir * 1.38).rgb) * .316;
    s += (texture2D(uSrc, uv + uDir * 3.23).rgb + texture2D(uSrc, uv - uDir * 3.23).rgb) * .070;
    gl_FragColor = vec4(s, 1.);
}`;

export function goldGround(root, opts = {}) {
    const img = root && root.querySelector('img');
    if (!img) return () => {};
    const num = (k, d) => {
        const v = opts[k] ?? root.dataset[k];
        return v == null || v === '' || !isFinite(Number(v)) ? d : Number(v);
    };
    const cfg = {
        tiles: opts.tiles || root.dataset.tiles || (img.getAttribute('src') || '').replace(/\.[a-z0-9]+(\?.*)?$/i, '-tiles.png'),
        distance: Math.max(0.6, num('distance', 2.2)),
        candle: clamp(num('candle', 1), 0, 2),
        window: clamp(num('window', 1), 0, 2),
        glow: clamp(num('glow', 0.5)),
        bloom: opts.bloom ?? (root.dataset.bloom != null && root.dataset.bloom !== 'false'),
    };

    let dead = false, gl = null, canvas = null, quad = null;
    let progMain = null, progSpark = null, progBlur = null;
    let texAlb = null, texData = null, fbA = null, fbB = null, texA = null, texB = null;
    let dataImg = null;
    let W = 0, H = 0, dpr = 1, cw = 0, ch = 0, hw = 0, hh = 0;
    let visible = false, raf = 0, last = 0;
    const off = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };

    // the moving state: candle eases toward its target; eye comes straight from the page
    const candle = { x: 0, y: 0, tx: 0, ty: 0, set: false };
    let pointer = null;           // last pointer, viewport px
    let color = cfg.bloom ? 0 : 1;
    let tilt = { x: 0, y: 0, active: false };
    let tiltEye = { x: 0, y: 0 };
    let lastKey = '';

    // ── GL ────────────────────────────────────────────────────────────
    function program(fsrc, names) {
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
            return s;
        };
        const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, fsrc);
        if (!vs || !fs) return null;
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.bindAttribLocation(p, 0, 'p');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
        p.u = {};
        for (const n of names) p.u[n] = gl.getUniformLocation(p, n);
        return p;
    }
    const LIGHT_U = ['uAlb', 'uData', 'uCrop', 'uTexel', 'uSize', 'uEye', 'uCandle', 'uWin', 'uCurve', 'uCandleK', 'uWinK', 'uColor'];

    function tex(filter) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }

    function initGL() {
        gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
        if (!gl) return false;
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048;
        if (dataImg.naturalWidth > max || dataImg.naturalHeight > max) return false;
        progMain = program(FRAG_MAIN, [...LIGHT_U, 'uBloom', 'uRes', 'uGlow']);
        progSpark = program(FRAG_SPARK, LIGHT_U);
        progBlur = program(FRAG_BLUR, ['uSrc', 'uRes', 'uDir']);
        if (!progMain || !progSpark || !progBlur) return false;
        quad = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        texAlb = tex(gl.LINEAR);
        // the data must arrive exactly as baked: no colour management, no premultiply
        texData = tex(gl.NEAREST);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, dataImg);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
        texA = tex(gl.LINEAR); texB = tex(gl.LINEAR);
        fbA = gl.createFramebuffer(); fbB = gl.createFramebuffer();
        return true;
    }

    // ── layout ────────────────────────────────────────────────────────
    let crop = [0, 0, 1, 1];
    function layout() {
        const r = root.getBoundingClientRect();
        W = Math.max(1, r.width);
        H = Math.max(1, r.height);
        const iw = img.naturalWidth, ih = img.naturalHeight;
        // the visible part of the image, honouring object-fit: cover / object-position
        const cs = getComputedStyle(img);
        let sx = 0, sy = 0, sw = iw, sh = ih;
        if (cs.objectFit === 'cover') {
            const k = Math.max(W / iw, H / ih);
            sw = W / k; sh = H / k;
            const pos = (cs.objectPosition || '50% 50%').split(' ');
            const frac = (s, room) => (s.endsWith('%') ? parseFloat(s) / 100 : room > 0 ? clamp(parseFloat(s) / room) : 0.5);
            sx = (iw - sw) * frac(pos[0] || '50%', (iw - sw) * k);
            sy = (ih - sh) * frac(pos[1] || '50%', (ih - sh) * k);
        }
        crop = [sx / iw, sy / ih, sw / iw, sh / ih];
        // DPR capped at 2, and never finer than the photograph itself
        dpr = Math.min(devicePixelRatio || 1, 2, Math.max(1, sw / W));
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
        dpr = Math.min(dpr, max / W, max / H);
        cw = canvas.width = Math.round(W * dpr);
        ch = canvas.height = Math.round(H * dpr);
        hw = Math.max(1, Math.round(cw / 2)); hh = Math.max(1, Math.round(ch / 2));

        // the albedo, cropped and resampled once at device resolution
        const c = document.createElement('canvas');
        c.width = cw; c.height = ch;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texAlb);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, c);   // throws if cross-origin

        for (const [t, f] of [[texA, fbA], [texB, fbB]]) {
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, hw, hh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindFramebuffer(gl.FRAMEBUFFER, f);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (!candle.set) home();
        lastKey = '';
    }

    // where the candle stands when nobody is pointing: low and to the left, in
    // front of the wall, the way a stand of candles is
    // The candle is carried: it lives in screen space, so as the page scrolls it
    // walks along the wall with you and its pool of light travels across the
    // gold, the way a taper's does down a nave. Unpointed, it is held a little high and
    // and a little right of the middle of the screen.
    function home() {
        candle.tx = candle.x = innerWidth * 0.56;
        candle.ty = candle.y = innerHeight * 0.4;
        candle.set = true;
    }

    // ── draw ──────────────────────────────────────────────────────────
    function view() {
        const r = root.getBoundingClientRect();
        const vw = innerWidth, vh = innerHeight;
        const D = cfg.distance * Math.max(vw, vh, 600);
        // the eye: in the middle of the screen, so as the page scrolls the wall
        // slides past it; the phone's tilt leans it
        const ex = vw / 2 - r.left + tiltEye.x * D * 0.35;
        const ey = vh * 0.5 - r.top + tiltEye.y * D * 0.35;
        return { r, D, ex, ey, vh };
    }

    function setLight(p, v) {
        gl.useProgram(p);
        const u = p.u;
        gl.uniform1i(u.uAlb, 0);
        gl.uniform1i(u.uData, 1);
        gl.uniform4f(u.uCrop, ...crop);
        gl.uniform2f(u.uTexel, 1 / dataImg.naturalWidth, 1 / dataImg.naturalHeight);
        gl.uniform2f(u.uSize, W, H);
        gl.uniform3f(u.uEye, v.ex, v.ey, v.D);
        gl.uniform3f(u.uCandle, candle.x - v.r.left, candle.y - v.r.top, v.D * 0.2);
        // the window belongs to the church, not to you: high and to the right,
        // out in front of the wall, so its pool slides slowly as you walk while
        // the candle's keeps pace with you
        gl.uniform3f(u.uWin, W * 0.86, H * 0.12, v.D * 0.25);
        gl.uniform1f(u.uCurve, v.D * 8.);
        gl.uniform1f(u.uCandleK, cfg.candle);
        gl.uniform1f(u.uWinK, cfg.window);
        gl.uniform1f(u.uColor, color);
    }

    function draw(v) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texAlb);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texData);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const glow = cfg.glow > 0;
        if (glow) {
            // sparks at half resolution, blurred both ways
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbA);
            gl.viewport(0, 0, hw, hh);
            setLight(progSpark, v);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            gl.useProgram(progBlur);
            gl.uniform1i(progBlur.u.uSrc, 2);
            gl.uniform2f(progBlur.u.uRes, hw, hh);
            gl.activeTexture(gl.TEXTURE2);
            for (let i = 0; i < 2; i++) {
                const s = 1 + i * 1.6;
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbB);
                gl.bindTexture(gl.TEXTURE_2D, texA);
                gl.uniform2f(progBlur.u.uDir, s / hw, 0);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
                gl.bindFramebuffer(gl.FRAMEBUFFER, fbA);
                gl.bindTexture(gl.TEXTURE_2D, texB);
                gl.uniform2f(progBlur.u.uDir, 0, s / hh);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, cw, ch);
        setLight(progMain, v);
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_2D, texA);
        gl.uniform1i(progMain.u.uBloom, 2);
        gl.uniform2f(progMain.u.uRes, cw, ch);
        gl.uniform1f(progMain.u.uGlow, glow ? cfg.glow * 2.6 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ── loop ──────────────────────────────────────────────────────────
    function frame(t) {
        raf = 0;
        if (dead || !gl || gl.isContextLost() || !visible) { last = 0; return; }
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
        last = t;
        const v = view();

        // the pointer carries the candle (anywhere on the screen: a flame held
        // above the wall still lights it)
        if (pointer) {
            candle.tx = pointer.x;
            candle.ty = pointer.y;
        }
        const k = 1 - Math.exp(-dt / 0.14);
        candle.x += (candle.tx - candle.x) * k;
        candle.y += (candle.ty - candle.y) * k;

        if (tilt.active) {
            const kt = 1 - Math.exp(-dt / 0.12);
            tiltEye.x += (tilt.x - tiltEye.x) * kt;
            tiltEye.y += (tilt.y - tiltEye.y) * kt;
        }

        // colour arrives as the wall reaches the middle of the screen
        let ct = 1;
        if (cfg.bloom) {
            const mid = v.r.top + v.r.height / 2;
            const d = Math.abs(mid - v.vh / 2) / (v.vh * 0.5 + v.r.height * 0.25);
            ct = 1 - clamp((d - 0.12) / 0.75);
            ct = ct * ct * (3 - 2 * ct);
        }
        color += (ct - color) * (1 - Math.exp(-dt / 0.35));

        const moving = Math.abs(candle.tx - candle.x) > 0.3 || Math.abs(candle.ty - candle.y) > 0.3
            || Math.abs(ct - color) > 0.002
            || (tilt.active && Math.abs(tilt.x - tiltEye.x) + Math.abs(tilt.y - tiltEye.y) > 0.001);
        const key = [v.ex, v.ey, candle.x, candle.y, color, W, H].map((x) => x.toFixed(2)).join();
        if (key !== lastKey) { draw(v); lastKey = key; }
        if (moving) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    function kick() {
        if (!raf && visible && gl && !dead) raf = requestAnimationFrame(frame);
    }

    // Reduced motion: one still frame. The eye a little above the middle and the
    // candle low and left: a scatter of lit cubes across the gold, a few ablaze.
    function still() {
        color = 1;
        tiltEye = { x: 0, y: 0 };
        const r0 = root.getBoundingClientRect();
        candle.x = candle.tx = r0.left + W * 0.3;
        candle.y = candle.ty = r0.top + H * 0.78;
        const vw = innerWidth, vh = innerHeight;
        const D = cfg.distance * Math.max(vw, vh, 600);
        draw({ r: root.getBoundingClientRect(), D, ex: W * 0.56, ey: H * 0.32, vh });
    }

    // ── start ─────────────────────────────────────────────────────────
    let io = null, ro = null, sizeTimer = 0;
    const loadData = () => new Promise((res, rej) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = new URL(cfg.tiles, document.baseURI).href;
    });

    async function start() {
        try { await img.decode(); } catch (e) { if (!img.complete || !img.naturalWidth) await new Promise((res) => img.addEventListener('load', res, { once: true })); }
        if (dead || !img.naturalWidth) return;
        try { dataImg = await loadData(); } catch (e) { return; }      // no data: the photo stays
        if (dead) return;

        canvas = document.createElement('canvas');
        canvas.className = 'gg-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        try {
            if (!initGL()) throw new Error('no webgl');
            root.appendChild(canvas);
            layout();
        } catch (e) {
            if (canvas) canvas.remove();
            canvas = null; gl = null;
            return;
        }

        on(canvas, 'webglcontextlost', (e) => {
            e.preventDefault();
            cancelAnimationFrame(raf); raf = 0;
            root.classList.remove('is-live');
        });
        on(canvas, 'webglcontextrestored', () => {
            try { if (initGL()) { layout(); calm.matches ? still() : kick(); root.classList.add('is-live'); } } catch (e) { /* the photo stays */ }
        });

        if (calm.matches) still(); else { const v = view(); draw(v); }
        root.classList.add('is-live');

        on(window, 'scroll', () => { if (!calm.matches) kick(); }, { passive: true });
        on(window, 'pointermove', (e) => {
            if (e.pointerType === 'touch' || calm.matches) return;
            pointer = { x: e.clientX, y: e.clientY };
            kick();
        }, { passive: true });
        on(window, 'deviceorientation', () => { if (tilt.active && !calm.matches) kick(); }, { passive: true });
        on(document, 'visibilitychange', () => { if (!document.hidden) { last = 0; kick(); } });
        on(calm, 'change', () => { if (!gl) return; lastKey = ''; calm.matches ? still() : kick(); });

        import('./tilt.js').then((m) => { tilt = m.default; }).catch(() => {});

        io = new IntersectionObserver((en) => {
            visible = en[0].isIntersecting;
            if (visible && !calm.matches) { last = 0; lastKey = ''; kick(); }
        }, { rootMargin: '60px' });
        io.observe(root);

        let w0 = W, h0 = H;
        ro = new ResizeObserver(() => {
            const r = root.getBoundingClientRect();
            if (Math.abs(r.width - w0) < 1 && Math.abs(r.height - h0) < 1) return;
            clearTimeout(sizeTimer);
            sizeTimer = setTimeout(() => {
                if (dead || !gl) return;
                candle.set = false;
                layout(); w0 = W; h0 = H;
                calm.matches ? still() : (draw(view()), kick());
            }, 150);
        });
        ro.observe(root);
    }
    start();

    return function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(sizeTimer);
        off.forEach((f) => f());
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
        if (canvas) canvas.remove();
        root.classList.remove('is-live');
    };
}

// Auto-start every [data-gold-ground], each once it comes near the viewport.
function autoStart(el) {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        goldGround(el);
    }, { rootMargin: '600px' });
    io.observe(el);
}
document.querySelectorAll('[data-gold-ground]').forEach(autoStart);
