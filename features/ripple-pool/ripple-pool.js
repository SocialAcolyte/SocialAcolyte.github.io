/*
 *  RIPPLE-POOL // a mosaic floor seen through a shallow pool of clear water.
 *
 *  Markup:  <figure data-ripple-pool>
 *             <img src="assets/milreu-frigidarium.webp" alt="">
 *           </figure>
 *  Or call  ripplePool(figure, { damping, strength, rain, caustics, ambient })  yourself.
 *  It returns destroy().
 *
 *  Options (data attributes, all optional; the options object wins):
 *    data-damping="3.5"    roughly how many seconds a disturbance takes to die
 *    data-strength="1"     scales every stone, wake and slosh
 *    data-rain="7000"      ms between idle drops, jittered; 0 = never
 *    data-caustics="0.7"   0-1, how strongly the surface focuses light
 *    data-ambient="0.35"   0-1, the sunlit swell when nobody touches it; 0 = off
 *
 *  After Evan Wallace's WebGL Water. A height field of water (about 256 cells
 *  on the long side) is simulated on the CPU: the wave equation with a little
 *  surface tension and viscosity, its edges reflecting like a basin's walls. Each frame the slope and the
 *  light focus of every cell are packed into a small 8-bit texture, and one
 *  fragment shader looks down through it at the mosaic:
 *
 *    refraction  the floor is sampled where a ray bent by the surface lands.
 *                The mosaic is pre-cropped to the canvas at one texel per
 *                device pixel, so at rest every tessera is exactly the image.
 *    caustics    light through a crest converges, through a trough spreads.
 *                Brightness is 1 / det(I + k * Hessian(h)): the area a patch of
 *                sunlight shrinks or grows to on the floor, folds and all.
 *    glint       a soft fixed light, reflected only by facets steep enough to
 *                catch it, so flat water shows nothing.
 *    depth       troughs (thicker water) take on a little of the mosaic's own
 *                darkened mean colour. No blue wash.
 *    swell       ambient life, computed in the shader, not the sim: five long
 *                slow waves whose exact Hessian gives the drifting net of
 *                sunlight a real shallow pool always has, and a pixel or two
 *                of refraction. Drawn at ~30 fps while the pool is on screen.
 *
 *  Light is tone-mapped both ways (1 - exp(-kx)) and pale stones take less of
 *  it, so a bright band warms a white tessera rather than burning it out.
 *
 *  A pointer or finger drawn across leaves a wake: it is pressed into the
 *  water to a fixed depth and dragged, and the water closing behind it draws
 *  its own V. Hovering trails a lighter fingertip. A click or tap drops a
 *  stone: a crater, the rebound a moment later, a smaller bob. Tilting a phone
 *  sloshes the whole basin. Idle, a slow drop lands now and then. The sim
 *  stops when the water is still and everything stops off screen; with
 *  data-ambient="0" the loop stops entirely when the water is still.
 *
 *  Without WebGL (or with a cross-origin image) the <img> simply stays.
 *  Reduced motion: the still mosaic under a faint, frozen surface and a frozen
 *  net of light; nothing moves.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const SPEED = 1.0;         // wave stiffness: long waves run sqrt(SPEED / 4) = 0.5 cells a step
const TENSION = 0.26;      // surface tension: short ripples run ahead, so a stone sends a train
                           // of rings, not one. Stable while 2 * SPEED + 4 * TENSION < 4.
const VISCOSITY = 0.012;   // takes the finest, grid-sized ripples out quickly, as real water does
const WAVE = 300;          // css px a second the long waves travel, whatever the cell size
const SLOPE = 0.32;        // slope (height per cell) at the edge of the 8-bit encoding
const FOCUS = 2;           // light focus range of the encoding (I - 1)
const REFRACT = 44;        // css px the floor shifts at the steepest encoded slope
const FOCUS_K = 30;        // how hard the surface bends light for caustics

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
uniform sampler2D uImg;      // the mosaic, cropped to the canvas, 1 texel = 1 device px
uniform sampler2D uWater;    // r g slope, b light focus, a height. 128 = flat.
uniform vec2 uShift;         // uv of floor shift at full encoded slope
uniform vec2 uCell;          // one water cell, in uv
uniform vec2 uSize;          // the pool in css px
uniform float uCaustics;
uniform float uAmbient;      // 0 = no sunlit swell
uniform float uTime;
uniform vec3 uTint;
uniform vec3 uGlint;
uniform vec3 uLight;
varying vec2 vUv;
float dec(float v) { return (v * 255. - 128.) / 127.; }

// A shoulder for added light: identity below .78, then eases toward 1, so a
// bright band on a pale tessera warms it without burning it to white.
vec3 shoulder(vec3 x) { return mix(x, .78 + .22 * (1. - exp(-(x - .78) / .22)), step(.78, x)); }

// The sunlit swell: five long, slow waves crossing at odd angles. Their
// slope and Hessian are exact, and the same 1 / det(I + kH) as the simulated
// water turns them into the drifting net of light on the floor of a pool.
void swell(vec2 q, float t, out vec2 grad, out float light) {
    float hxx = 0., hyy = 0., hxy = 0.;
    grad = vec2(0.);
    vec2 D[5]; vec3 W[5];       // direction; (wavelength px, speed px/s, phase)
    D[0] = vec2( .96,  .28); W[0] = vec3(150., 21., 0.);
    D[1] = vec2(-.44,  .90); W[1] = vec3(124., 17., 1.7);
    D[2] = vec2( .63, -.78); W[2] = vec3(102., 24., 4.1);
    D[3] = vec2(-.99, -.12); W[3] = vec3( 86., 15., 2.6);
    D[4] = vec2( .20,  .98); W[4] = vec3( 71., 19., 5.3);
    for (int i = 0; i < 5; i++) {
        float k = 6.2831853 / W[i].x;
        float ph = k * (dot(D[i], q) - W[i].y * t) + W[i].z;
        float a = 1. / (k * k);             // so each wave bends light alike
        grad += D[i] * (.5 * cos(ph));       // slope, normalised per wave
        float c = -a * k * k * sin(ph);
        hxx += c * D[i].x * D[i].x; hyy += c * D[i].y * D[i].y; hxy += c * D[i].x * D[i].y;
    }
    float f = .36;                          // ~ how deep the pool is: where the net folds
    float det = (1. + f * hxx) * (1. + f * hyy) - f * f * hxy * hxy;
    // thin bright folds bounding dim cells; the folds carry the light
    light = min(1. / max(abs(det), .05) - 1., 6.) * .5 - .25;
}

void main() {
    // a soft five-tap read: a crease narrower than a cell would fold the
    // floor into a seam; real water is never that sharp
    vec4 w = texture2D(uWater, vUv) * .4
           + (texture2D(uWater, vUv + vec2(uCell.x, 0.)) + texture2D(uWater, vUv - vec2(uCell.x, 0.))
            + texture2D(uWater, vUv + vec2(0., uCell.y)) + texture2D(uWater, vUv - vec2(0., uCell.y))) * .15;
    vec2 s = vec2(dec(w.r), dec(w.g));
    float focus = dec(w.b) * ${FOCUS.toFixed(1)};
    float h = dec(w.a);

    vec2 sw = vec2(0.);
    float net = 0.;
    if (uAmbient > 0.) {
        swell(vUv * uSize, uTime, sw, net);
        sw *= uAmbient * 1.6 / uSize;       // a pixel or two of drift, no more
    }

    vec3 base = texture2D(uImg, vUv + s * uShift + sw).rgb;

    // light: the sim's focus, plus the ambient net. Tone-mapped both ways:
    // brightening by 1 - exp(-kx), dimming the same, so it never clips.
    float L = focus * uCaustics + net * uAmbient * .32;
    float up = 1. - exp(-1.3 * max(L, 0.));
    float dn = 1. - exp(-1.6 * max(-L, 0.));
    // the net takes its light from the cells around it: the floor is a touch
    // dimmer on average while the sun is on it
    // pale stones take less of the added light (there is no headroom left)
    // and lean on the darkening for contrast instead
    float lum = dot(base, vec3(.3, .55, .15));
    vec3 lit = base * (1. - .45 * dn) * (1. + .52 * up * clamp(1.25 - lum, .3, 1.));
    vec3 c = base + shoulder(lit) - shoulder(base);

    // depth: a trough is thicker water and keeps a little more of the floor's own shade
    c = mix(c, uTint, clamp(-h * 1.4, 0., 1.) * .26);

    // glint: the fixed light, mirrored only by facets tilted enough to catch it
    vec3 n = normalize(vec3(-s * .5, 1.));
    vec3 r = reflect(vec3(0., 0., -1.), n);
    float g = smoothstep(.988, .999, dot(r, uLight));
    c += uGlint * g * .05;

    gl_FragColor = vec4(c, 1.);
}`;

export function ripplePool(root, opts = {}) {
    const img = root && root.querySelector('img');
    if (!img) return () => {};
    const num = (k, d) => {
        const v = opts[k] ?? root.dataset[k];
        return v == null || v === '' || !isFinite(Number(v)) ? d : Number(v);
    };
    const cfg = {
        damping: Math.max(0.3, num('damping', 3.5)),
        strength: Math.max(0, num('strength', 1)),
        rain: Math.max(0, num('rain', 7000)),
        caustics: clamp(num('caustics', 0.7)),
        ambient: calm.matches ? Math.min(clamp(num('ambient', 0.35)), 0.35) : clamp(num('ambient', 0.35)),
    };

    let dead = false;
    let gl = null, prog = null, texImg = null, texWater = null, buf = null, U = {};
    let canvas = null;
    let W = 0, H = 0, dpr = 1, cell = 4, cols = 0, rows = 0, longCells = 0;
    let h, v, lap, lapV, px;            // height, velocity, laplacians, packed texture
    let mean = 0, maxV = 0, maxS = 0;
    let visible = false, raf = 0, last = 0, acc = 0, simT = 0;
    let HZ = 180, STEP = 1 / 180;       // steps a second, set by the cell size
    let flat = true, ambT = 7.3, lastDraw = 0;   // ambient clock (s), last ambient frame
    let rainTimer = 0, sizeTimer = 0, firstDrop = true;
    let tint = [0.2, 0.18, 0.16], glint = [1, 0.98, 0.94];
    const events = [];                  // timed disturbances (stone rebounds, drops)
    let segs = [];                      // wake path since the last frame
    let ptr = null;                     // last pointer spot, in grid cells
    let touch0 = null;
    let press = null;
    let tilt = { x: 0, y: 0, active: false };
    const tiltUsed = { x: 0, y: 0 };
    let tiltResume = true;
    const off = [];                     // listeners to remove on destroy
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };

    // ── GL ────────────────────────────────────────────────────────────
    function initGL() {
        gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false });
        if (!gl) return false;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
        };
        const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return false;
        prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
        gl.useProgram(prog);
        buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        for (const n of ['uImg', 'uWater', 'uShift', 'uCell', 'uSize', 'uCaustics', 'uAmbient', 'uTime', 'uTint', 'uGlint', 'uLight']) U[n] = gl.getUniformLocation(prog, n);
        const tex = () => {
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            return t;
        };
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        texImg = tex();
        texWater = tex();
        gl.uniform1i(U.uImg, 0);
        gl.uniform1i(U.uWater, 1);
        const L = [-0.42, -0.5, 1], m = Math.hypot(...L);
        gl.uniform3f(U.uLight, L[0] / m, L[1] / m, L[2] / m);
        return true;
    }

    // The visible crop of the image (honouring object-fit / object-position),
    // drawn once at device resolution so the shader samples it 1:1.
    function prepareImage() {
        const cs = getComputedStyle(img);
        const iw = img.naturalWidth, ih = img.naturalHeight;
        let sx = 0, sy = 0, sw = iw, sh = ih;
        if (cs.objectFit === 'cover') {
            const k = Math.max(W / iw, H / ih);
            sw = W / k; sh = H / k;
            const pos = (cs.objectPosition || '50% 50%').split(' ');
            const frac = (s, room) => (s.endsWith('%') ? parseFloat(s) / 100 : room > 0 ? clamp(parseFloat(s) / room) : 0.5);
            sx = (iw - sw) * frac(pos[0] || '50%', (iw - sw) * k);
            sy = (ih - sh) * frac(pos[1] || '50%', (ih - sh) * k);
        }
        const c = document.createElement('canvas');
        c.width = canvas.width;
        c.height = canvas.height;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);

        // the mosaic's own mean colour, darkened, is the colour of depth
        const s = document.createElement('canvas');
        s.width = s.height = 8;
        const sg = s.getContext('2d');
        sg.drawImage(c, 0, 0, 8, 8);
        const d = sg.getImageData(0, 0, 8, 8).data;
        let r = 0, gg = 0, b = 0;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
        const n = (d.length / 4) * 255;
        tint = cssColor('--rp-tint') || [r / n * 0.42, gg / n * 0.42, b / n * 0.42];
        glint = cssColor('--rp-glint') || [1, 0.98, 0.94];

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, c);   // throws if the image is cross-origin
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

    // ── layout ────────────────────────────────────────────────────────
    function layout() {
        const r = root.getBoundingClientRect();
        W = Math.max(1, r.width);
        H = Math.max(1, r.height);
        // DPR is capped at 2, except on a 3x phone when the pool stays under
        // ~3.4 megapixels: the tesserae have to be as sharp as the <img>.
        const raw = devicePixelRatio || 1;
        dpr = Math.min(raw, 2);
        if (raw > 2 && W * H * raw * raw <= 3.4e6) dpr = Math.min(raw, 3);
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
        dpr = Math.min(dpr, max / W, max / H);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);

        // About 256 cells on the long side, never smaller than 3 css px.
        const long = Math.max(W, H);
        cell = Math.max(long / 256, 3);
        cols = Math.max(8, Math.round(W / cell));
        rows = Math.max(8, Math.round(H / cell));
        cell = W / cols;                 // square enough; keeps the grid flush
        longCells = Math.max(cols, rows);
        // ripples cross the floor at the same real speed in any size of pool
        HZ = clamp(WAVE / (Math.sqrt(SPEED / 4) * cell), 60, 240);
        STEP = 1 / HZ;
        h = new Float32Array(cols * rows);
        v = new Float32Array(cols * rows);
        lap = new Float32Array(cols * rows);
        lapV = new Float32Array(cols * rows);
        px = new Uint8Array(cols * rows * 4).fill(128);
        mean = 0;
        events.length = 0;
        segs = [];
        ptr = null;

        prepareImage();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texWater);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
        // full encoded slope -> floor shift, in uv
        gl.uniform2f(U.uShift, REFRACT / W, REFRACT / H);
        gl.uniform2f(U.uCell, 1 / cols, 1 / rows);
        gl.uniform1f(U.uCaustics, cfg.caustics);
        gl.uniform2f(U.uSize, W, H);
        gl.uniform1f(U.uAmbient, cfg.ambient);
        gl.uniform3f(U.uTint, ...tint);
        gl.uniform3f(U.uGlint, ...glint);
    }

    // ── simulation ────────────────────────────────────────────────────
    const stonePx = () => clamp(Math.max(W, H) * 0.034, 14, 56);
    const stoneR = () => stonePx() / cell;   // in cells
    // Heights scale with the stone in cells, so the slope (what the eye sees)
    // is the same on any grid, and with the stone in px, so a small pool gets
    // a small splash rather than the same 44 px of shift as a big one.
    const lift = () => (stoneR() / 5) * clamp(stonePx() / 40, 0.6, 1);

    // a smooth raised-cosine dent or lift of radius r cells
    function bump(arr, gx, gy, r, amp) {
        const x0 = Math.max(0, Math.floor(gx - r)), x1 = Math.min(cols - 1, Math.ceil(gx + r));
        const y0 = Math.max(0, Math.floor(gy - r)), y1 = Math.min(rows - 1, Math.ceil(gy + r));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / r;
                if (d < 1) arr[y * cols + x] += amp * (0.5 + 0.5 * Math.cos(Math.PI * d));
            }
        }
    }

    // A stone: the crater, the little column of water that springs back, and
    // a smaller bob or two after it, so it sends out a train of rings.
    function stone(gx, gy, k = 1) {
        const r = stoneR(), s = cfg.strength * k * lift();
        ring(gx, gy, r, s);
        const later = (t, rr, a) => events.push({ t: simT + t, fn: () => bump(h, gx, gy, r * rr, a * s) });
        later(0.1, 0.4, 0.3);              // the column of water that springs back
        later(0.26, 0.45, -0.14);
        flat = false;
        kick();
    }
    // A slow drop from nowhere in particular.
    function drop() {
        const m = 0.15;
        const gx = cols * (m + Math.random() * (1 - 2 * m));
        const gy = rows * (m + Math.random() * (1 - 2 * m));
        const r = stoneR() * 0.8, s = cfg.strength * lift();
        ring(gx, gy, r, 0.5 * s);
        flat = false;
        kick();
    }

    // The splash itself: a crater ringed by a lip and a second, fainter
    // trough, a Gaussian-windowed cosine. It spreads as a train of three or
    // four rings rather than one bump, and keeps them as it goes.
    function ring(gx, gy, r, amp) {
        const R = r * 2.4, k = Math.PI / (r * 0.62);
        const x0 = Math.max(0, Math.floor(gx - R)), x1 = Math.min(cols - 1, Math.ceil(gx + R));
        const y0 = Math.max(0, Math.floor(gy - R)), y1 = Math.min(rows - 1, Math.ceil(gy + R));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy);
                if (d < R) h[y * cols + x] -= amp * 0.42 * Math.cos(k * d) * Math.exp(-(d * d) / (r * r * 1.1));
            }
        }
    }

    // The wake: something pressed into the water to a fixed depth and drawn
    // along. The water under it is pulled toward that depth (never pushed past
    // it), so however fast the hand goes the dent stays a dent, and the water
    // closing in behind is what makes the wake.
    function wake(seg, f0, f1) {
        const ax = seg.ax + (seg.bx - seg.ax) * f0, ay = seg.ay + (seg.by - seg.ay) * f0;
        const bx = seg.ax + (seg.bx - seg.ax) * f1, by = seg.ay + (seg.by - seg.ay) * f1;
        const len = Math.hypot(bx - ax, by - ay);
        // a fast hand skims: it rides shallower and spreads wider, so a flick
        // leaves a soft furrow, not a bright crease
        const fast = clamp(len / (stoneR() * 0.18), 0, 1);
        const r = stoneR() * (0.85 + 0.35 * fast);
        const n = Math.max(1, Math.ceil(len / (r * 0.3)));
        const depth = 0.42 * cfg.strength * seg.k * lift() * (1 - 0.45 * fast);
        for (let i = 0; i < n; i++) {
            const f = n === 1 ? 1 : (i + 1) / n;
            sink(ax + (bx - ax) * f, ay + (by - ay) * f, r, depth);
        }
    }
    function sink(gx, gy, r, depth) {
        const x0 = Math.max(0, Math.floor(gx - r)), x1 = Math.min(cols - 1, Math.ceil(gx + r));
        const y0 = Math.max(0, Math.floor(gy - r)), y1 = Math.min(rows - 1, Math.ceil(gy + r));
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const d = Math.hypot(x + 0.5 - gx, y + 0.5 - gy) / r;
                if (d >= 1) continue;
                const w = 0.5 + 0.5 * Math.cos(Math.PI * d);
                const j = y * cols + x, t = -depth * w;
                if (h[j] > t) h[j] += (t - h[j]) * 0.5 * w;
            }
        }
    }

    function step(i, n, tdx, tdy) {
        simT += STEP;
        for (let k = events.length - 1; k >= 0; k--) {
            if (events[k].t <= simT) { events[k].fn(); events.splice(k, 1); }
        }
        for (const s of segs) wake(s, i / n, (i + 1) / n);

        let damp = Math.exp(Math.log(0.3) / (cfg.damping * HZ));     // 30% left by then; spreading does the rest
        // the last faint shimmer (under ~2 px of shift) settles quickly, so
        // the loop can stop a few seconds after the last touch, not ten
        if (maxS < 12 / 127 && !segs.length && !events.length) damp *= Math.exp(Math.log(0.25) / HZ);
        const C = cols, R = rows;
        // tilt sloshes the basin: the surface takes the change of tilt as a
        // ramp, and the walls turn that into a wave that runs back and forth
        const sl = 7 * cfg.strength / longCells;
        const fx = tdx * sl, fy = tdy * sl;
        const tilted = fx !== 0 || fy !== 0;
        // walls reflect: a missing neighbour is the cell itself
        const L = (a, out) => {
            for (let y = 0; y < R; y++) {
                const row = y * C;
                const up = y > 0 ? row - C : row, dn = y < R - 1 ? row + C : row;
                for (let x = 0; x < C; x++) {
                    const j = row + x, aj = a[j];
                    out[j] = ((x > 0 ? a[j - 1] : aj) + (x < C - 1 ? a[j + 1] : aj) + a[up + x] + a[dn + x]) * 0.25 - aj;
                }
            }
        };
        L(h, lap);
        // gravity pulls toward the neighbours' level; tension (the laplacian
        // of the laplacian) stiffens the short ripples
        for (let y = 0; y < R; y++) {
            const row = y * C;
            const up = y > 0 ? row - C : row, dn = y < R - 1 ? row + C : row;
            for (let x = 0; x < C; x++) {
                const j = row + x, dj = lap[j];
                const ll = ((x > 0 ? lap[j - 1] : dj) + (x < C - 1 ? lap[j + 1] : dj) + lap[up + x] + lap[dn + x]) * 0.25 - dj;
                v[j] = (v[j] + dj * SPEED - ll * TENSION) * damp;
            }
        }
        L(v, lapV);
        // integrate, keep the mean level at zero, and note how lively it is
        let sum = 0, mv = 0;
        for (let y = 0; y < R; y++) {
            const row = y * C;
            const ty = tilted ? (y + 0.5 - R / 2) * fy - mean : -mean;
            for (let x = 0; x < C; x++) {
                const j = row + x;
                const vj = (v[j] += lapV[j] * VISCOSITY);
                const hj = (h[j] += vj + ty + (tilted ? (x + 0.5 - C / 2) * fx : 0));
                sum += hj;
                if (vj > mv) mv = vj; else if (-vj > mv) mv = -vj;
            }
        }
        mean = sum / (C * R);
        maxV = mv;
    }

    // Pack slope, light focus and height into the water texture.
    function encode() {
        const C = cols, R = rows;
        const kc = FOCUS_K;
        let ms = 0;
        for (let y = 0; y < R; y++) {
            const row = y * C;
            const up = y > 0 ? row - C : row, dn = y < R - 1 ? row + C : row;
            for (let x = 0; x < C; x++) {
                const j = row + x;
                const hj = h[j];
                const xl = x > 0 ? x - 1 : x, xr = x < C - 1 ? x + 1 : x;
                const l = h[row + xl], r = h[row + xr], u = h[up + x], d = h[dn + x];
                const gx = (r - l) * 0.5, gy = (d - u) * 0.5;
                const hxx = l + r - 2 * hj, hyy = u + d - 2 * hj;
                const hxy = (h[dn + xr] - h[dn + xl] - h[up + xr] + h[up + xl]) * 0.25;
                // area ratio of a patch of light on the floor: 1 / det(I + k H)
                const det = (1 + kc * hxx) * (1 + kc * hyy) - kc * kc * hxy * hxy;
                const I = 1 / Math.max(det, 1 / (1 + FOCUS));
                const sx = Math.tanh(gx / SLOPE), sy = Math.tanh(gy / SLOPE);   // steep crater faces ease, not clip
                const a = Math.abs(sx) + Math.abs(sy);
                if (a > ms) ms = a;
                const o = j * 4;
                px[o] = 128 + Math.round(sx * 127);
                px[o + 1] = 128 + Math.round(sy * 127);
                px[o + 2] = 128 + Math.round(clamp((I - 1) / FOCUS, -1, 1) * 127);
                px[o + 3] = 128 + Math.round(clamp(hj, -1, 1) * 127);
            }
        }
        maxS = ms;
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texWater);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }

    function draw() {
        gl.uniform1f(U.uTime, ambT);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texImg);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texWater);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    function flatten() {
        h.fill(0); v.fill(0); px.fill(128); mean = 0; maxV = maxS = 0; flat = true;
        encode();
        draw();
    }

    // ── loop ──────────────────────────────────────────────────────────
    function frame(t) {
        raf = 0;
        if (dead || !gl || gl.isContextLost()) return;
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
        last = t;
        acc += dt;
        let n = Math.floor(acc / STEP);
        if (n > 8) { n = 8; acc = 0; } else acc -= n * STEP;

        let tdx = 0, tdy = 0;
        if (tilt.active) {
            if (tiltResume) { tiltUsed.x = tilt.x; tiltUsed.y = tilt.y; tiltResume = false; }
            tdx = clamp(tilt.x - tiltUsed.x, -0.08, 0.08);
            tdy = clamp(tilt.y - tiltUsed.y, -0.08, 0.08);
            tiltUsed.x = tilt.x; tiltUsed.y = tilt.y;
        }
        const tilting = Math.abs(tdx) + Math.abs(tdy) > 0.002;
        if (tilting || segs.length || events.length) flat = false;
        if (cfg.ambient) ambT += dt;

        if (!flat && n > 0) {
            for (let i = 0; i < n; i++) step(i, n, tdx / n, tdy / n);
            segs = [];
            encode();
            draw();
            lastDraw = t;
        } else if (cfg.ambient && t - lastDraw >= 32) {
            draw();                       // the sunlit swell alone: ~30 frames a second
            lastDraw = t;
        }
        // below about a third of a pixel of shift the water is, to the eye, still
        const lively = !flat && (maxV > 1e-3 || maxS > 2 / 127 || events.length > 0 || segs.length > 0 || tilting);
        if (!flat && !lively) flatten();
        if (visible && (lively || cfg.ambient)) raf = requestAnimationFrame(frame);
        else { last = 0; acc = 0; tiltResume = true; }
    }
    function kick() {
        if (!raf && visible && gl && !calm.matches) raf = requestAnimationFrame(frame);
    }

    function scheduleRain() {
        clearTimeout(rainTimer);
        if (!cfg.rain || calm.matches || !visible) return;
        // the first drop comes soon, so a visitor sees it is water
        const wait = firstDrop ? 1200 : cfg.rain * (0.6 + Math.random() * 0.8);
        rainTimer = setTimeout(() => {
            firstDrop = false;
            if (visible && !document.hidden) drop();
            scheduleRain();
        }, wait);
    }

    // ── input ─────────────────────────────────────────────────────────
    const toGrid = (cx, cy) => {
        const r = root.getBoundingClientRect();
        return { x: ((cx - r.left) / r.width) * cols, y: ((cy - r.top) / r.height) * rows };
    };
    const inside = (p) => p.x >= 0 && p.y >= 0 && p.x <= cols && p.y <= rows;
    function trail(p, k) {
        if (ptr && inside(p)) {
            const len = Math.hypot(p.x - ptr.x, p.y - ptr.y);
            if (len > 0.05 && (k === 1 || len < longCells * 0.3)) segs.push({ ax: ptr.x, ay: ptr.y, bx: p.x, by: p.y, k });
            if (len > 0.05) kick();
        }
        ptr = inside(p) ? p : null;
    }

    function onPointerMove(e) {
        if (e.pointerType === 'touch' || calm.matches) return;
        trail(toGrid(e.clientX, e.clientY), e.buttons ? 1 : 0.35);   // hovering trails a fingertip; dragging pushes
    }
    function onPointerDown(e) {
        if (e.pointerType === 'touch' || calm.matches || e.button !== 0) return;
        e.preventDefault();          // no native image drag, no text selection
        const p = toGrid(e.clientX, e.clientY);
        stone(p.x, p.y, 0.3);        // the fingertip goes in; a click lets the stone go
        ptr = p;
        press = { x: e.clientX, y: e.clientY, at: performance.now(), p };
    }
    function onPointerUp(e) {
        if (!press || e.pointerType === 'touch') return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < 6 && performance.now() - press.at < 450) stone(press.p.x, press.p.y);
        press = null;
    }
    const onPointerLeave = (e) => { if (e.pointerType !== 'touch') ptr = null; };

    // Touch uses touch events, not pointer events: they keep coming while the
    // page scrolls, and a finger resting on the water as it scrolls past
    // leaves a wake, the way it would.
    function onTouchStart(e) {
        if (calm.matches) return;
        const t = e.changedTouches[0];
        const p = toGrid(t.clientX, t.clientY);
        touch0 = { id: t.identifier, x: t.clientX, y: t.clientY, at: performance.now(), moved: 0 };
        ptr = p;
    }
    function onTouchMove(e) {
        if (!touch0 || calm.matches) return;
        for (const t of e.changedTouches) {
            if (t.identifier !== touch0.id) continue;
            touch0.moved = Math.max(touch0.moved, Math.hypot(t.clientX - touch0.x, t.clientY - touch0.y));
            trail(toGrid(t.clientX, t.clientY), 1);
        }
    }
    function onTouchEnd(e) {
        if (!touch0) return;
        for (const t of e.changedTouches) {
            if (t.identifier !== touch0.id) continue;
            if (e.type === 'touchend' && touch0.moved < 10 && performance.now() - touch0.at < 350) {
                const p = toGrid(t.clientX, t.clientY);
                if (inside(p)) stone(p.x, p.y);
            }
            touch0 = null;
            ptr = null;
        }
    }

    // Keyboard: Enter or Space drops a stone, arrows draw a wake across.
    function onKey(e) {
        if (calm.matches || !gl) return;
        const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            stone(cols * (0.3 + Math.random() * 0.4), rows * (0.3 + Math.random() * 0.4));
        } else if (dirs[e.key]) {
            e.preventDefault();
            const [dx, dy] = dirs[e.key];
            const L = Math.min(cols, rows) * 0.45;
            const cx = cols / 2 - (dx * L) / 2, cy = rows / 2 - (dy * L) / 2;
            // spread over a few frames so it travels like a hand would
            for (let i = 0; i < 12; i++) {
                setTimeout(() => {
                    if (dead) return;
                    const a = i / 12, b = (i + 1) / 12;
                    segs.push({ ax: cx + dx * L * a, ay: cy + dy * L * a, bx: cx + dx * L * b, by: cy + dy * L * b, k: 1 });
                    kick();
                }, i * 22);
            }
        }
    }

    function onOrient() {
        if (tilt.active && Math.abs(tilt.x - tiltUsed.x) + Math.abs(tilt.y - tiltUsed.y) > 0.02) kick();
    }

    // Reduced motion: one frozen, gentle surface. Two faint rings, caught
    // part way out, so it reads as water without anything moving.
    function still() {
        const r = stoneR() * 1.4;
        bump(h, cols * 0.3, rows * 0.36, r, -0.16);
        bump(h, cols * 0.74, rows * 0.7, r * 0.8, -0.1);
        for (let i = 0; i < 70; i++) step(0, 1, 0, 0);
        encode();
        draw();
    }

    // ── start ─────────────────────────────────────────────────────────
    let io = null, ro = null;
    async function start() {
        try { await img.decode(); } catch (e) { if (!img.complete || !img.naturalWidth) await new Promise((res) => img.addEventListener('load', res, { once: true })); }
        if (dead || !img.naturalWidth) return;

        canvas = document.createElement('canvas');
        canvas.className = 'rp-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        try {
            if (!initGL()) throw new Error('no webgl');
            root.appendChild(canvas);
            layout();
        } catch (e) {
            canvas.remove();
            canvas = null;
            gl = null;
            return;      // the <img> stays: that is the fallback
        }

        on(canvas, 'webglcontextlost', (e) => {
            e.preventDefault();
            cancelAnimationFrame(raf); raf = 0;
            root.classList.remove('is-live');
        });
        on(canvas, 'webglcontextrestored', () => {
            try { if (initGL()) { layout(); calm.matches ? still() : flatten(); root.classList.add('is-live'); kick(); } } catch (e) { /* stay on the img */ }
        });

        if (calm.matches) still(); else flatten();
        root.classList.add('is-live');
        const drag = img.getAttribute('draggable');
        img.draggable = false;
        off.push(() => (drag == null ? img.removeAttribute('draggable') : img.setAttribute('draggable', drag)));

        if (!calm.matches) {
            root.tabIndex = 0;
            root.setAttribute('role', 'button');
            if (!root.hasAttribute('aria-label')) {
                root.setAttribute('aria-label', 'Water over a mosaic. Press Enter to drop a stone, arrow keys to stir.');
                root.dataset.rpLabel = '1';
            }
            root.dataset.rpAdded = '1';
        }

        on(root, 'pointermove', onPointerMove);
        on(root, 'pointerdown', onPointerDown);
        on(root, 'pointerleave', onPointerLeave);
        on(window, 'pointerup', onPointerUp);
        on(root, 'touchstart', onTouchStart, { passive: true });
        on(window, 'touchmove', onTouchMove, { passive: true });
        on(window, 'touchend', onTouchEnd, { passive: true });
        on(window, 'touchcancel', onTouchEnd, { passive: true });
        on(root, 'keydown', onKey);
        on(window, 'deviceorientation', onOrient, { passive: true });
        on(document, 'visibilitychange', () => { if (!document.hidden) { last = 0; kick(); } });
        on(calm, 'change', () => { if (gl) { layout(); calm.matches ? still() : flatten(); scheduleRain(); } });

        import('./tilt.js').then((m) => { tilt = m.default; }).catch(() => {});

        io = new IntersectionObserver((en) => {
            visible = en[0].isIntersecting;
            if (visible) { last = 0; kick(); scheduleRain(); } else { clearTimeout(rainTimer); }
        }, { rootMargin: '40px' });
        io.observe(root);

        let w0 = W, h0 = H;
        ro = new ResizeObserver(() => {
            const r = root.getBoundingClientRect();
            if (Math.abs(r.width - w0) < 1 && Math.abs(r.height - h0) < 1) return;
            clearTimeout(sizeTimer);
            sizeTimer = setTimeout(() => {
                if (dead || !gl) return;
                layout(); w0 = W; h0 = H;
                calm.matches ? still() : flatten();
            }, 150);
        });
        ro.observe(root);
    }
    start();

    return function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(rainTimer);
        clearTimeout(sizeTimer);
        off.forEach((f) => f());
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
        if (canvas) canvas.remove();
        root.classList.remove('is-live');
        if (root.dataset.rpAdded) {
            root.removeAttribute('tabindex');
            root.removeAttribute('role');
            if (root.dataset.rpLabel) root.removeAttribute('aria-label');
            delete root.dataset.rpAdded;
            delete root.dataset.rpLabel;
        }
    };
}

// Auto-start every [data-ripple-pool] on the page, each once it is near the
// viewport. (No need to wait for window load: each pool waits on its own img.)
function autoStart(el) {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        ripplePool(el);
    }, { rootMargin: '600px' });
    io.observe(el);
}
document.querySelectorAll('[data-ripple-pool]').forEach(autoStart);
