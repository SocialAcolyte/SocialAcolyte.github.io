/*
 *  RAKING-LIGHT // a carved surface relit by a low lamp.
 *
 *  Markup:  <figure data-raking-light data-height="66.7"
 *                   data-normal="assets/round-tablet-normal.png"
 *                   data-albedo="assets/round-tablet-albedo.webp">
 *             <img src="assets/round-tablet.webp" alt="">
 *           </figure>
 *  Or call  rakingLight(figure, { normal, albedo, height, kind, material, light, cast, relief, muted, reach })
 *  It returns destroy().
 *
 *  Epigraphers read worn inscriptions by raking light: a lamp held low at the
 *  edge of the stone, so every wedge and chisel cut throws a long shadow and
 *  the marks leap out. Here the pointer is that lamp (on a phone, the tilt of
 *  the phone and a sideways drag), and a single photograph is the surface.
 *
 *  Offline, each photograph was turned into three maps (see the README):
 *    albedo   the photo with its own soft studio light divided out
 *    normal   r g = surface normal, b = height (in texels: data-height is the
 *             full range of b), from a monocular depth model for the large form
 *             and a multi-scale luminance band-pass for the fine carving
 *    img      the plain photo, which is what shows without JS or WebGL
 *
 *  One fragment shader relights it:
 *    diffuse     albedo x (ambient + lamp x N.L), exposed for a low lamp and
 *                rolled off with a soft shoulder, so faces turned to the lamp
 *                glow and faces turned away fall to the ambient
 *    shadows     22 steps of a height-field ray toward the lamp, geometric
 *                steps (0.6 to ~130 texels) with a penumbra that widens with
 *                distance: every wedge, ridge and raised figure throws its
 *                shadow, long and soft-ended, as real raking light does
 *    falloff     the lamp is a hand-held one a couple of widths away, so the
 *                near side is brighter than the far
 *    sheen       a faint Blinn-Phong highlight: clay is matte, stone a little more
 *    cast        a cut-out object lies on the page and throws its own shadow
 *                across the paper (and the text) away from the lamp
 *
 *  The lamp eases after the pointer with a critically damped spring, like a lamp
 *  in a hand. It never rises above 25 degrees (a frontal light would just be the
 *  photo again) or drops below 5. At rest it rakes from the upper left.
 *  The loop runs only while the lamp is moving, and nothing runs off screen.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const RAD = Math.PI / 180;
const EL_MIN = 5, EL_MAX = 25;     // degrees: the lamp is always low
const STIFF = 6.5;                 // spring rate (1/s): a hand-held lamp's lag
const MATERIALS = {                // specular strength, shininess
    clay: [0.05, 14],
    stone: [0.1, 34],
};

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
uniform sampler2D uAlb;     // albedo, premultiplied
uniform sampler2D uNrm;     // rg normal, b height
uniform sampler2D uBody;    // a: the object's silhouette, blurred (its body, for the cast shadow)
uniform vec2 uCanvas;       // canvas, css px
uniform vec4 uRect;         // the image within the canvas, css px (x y w h)
uniform vec4 uCrop;         // the part of the texture shown in the image (u v du dv)
uniform vec2 uTex;          // texture size, texels
uniform float uZ;           // height of b = 1, in texels
uniform vec3 uL;            // toward the lamp (x right, y down, z out of the page)
uniform vec2 uD;            // its direction on the page
uniform float uTanEl;
uniform float uExpo;
uniform vec2 uCentre;       // falloff centre, canvas css px
uniform float uFallR;
uniform vec3 uLamp;
uniform vec3 uAmb;
uniform vec2 uSpec;
uniform float uMuted;
uniform float uObject;      // 1: a cut-out on the page, 0: a surface
uniform float uThick;       // css px: how high the object stands off the paper
uniform float uCastLen;     // css px: the furthest its shadow is drawn
uniform float uCast;        // 0-1 strength of the shadow on the paper
uniform float uFallK;       // surfaces: how fast the lamp's light dies across the band (exponential)
uniform float uLampR;       // the lamp's angular radius (radians): the penumbra
varying vec2 vUv;

float ign(vec2 q) { return fract(52.9829189 * fract(dot(q, vec2(.06711056, .00583715)))); }
vec3 shoulder(vec3 x) { return mix(x, .8 + .2 * (1. - exp(-(x - .8) / .2)), step(.8, x)); }

void main() {
    vec2 p = vUv * uCanvas;
    vec2 ou = (p - uRect.xy) / uRect.zw;
    vec2 tu = uCrop.xy + ou * uCrop.zw;
    bool inside = ou.x >= 0. && ou.y >= 0. && ou.x <= 1. && ou.y <= 1.;
    vec4 a = texture2D(uAlb, tu) * (inside ? 1. : 0.);   // read unconditionally: mipmaps need derivatives
    float alpha = uObject > .5 ? a.a : 1.;
    float jit = ign(gl_FragCoord.xy);
    vec3 col = vec3(0.);

    // the lamp is a couple of widths away: the near side gets more of it
    float along = clamp(dot(p - uCentre, uD) / uFallR, -1.4, 1.4);
    // an object: a lamp a little way off its near edge. A wall: the lamp at one
    // end, the far end of the room falling away into the dark.
    float fall = uObject > .5 ? 4. / pow(1. + 2.2 * (1. - along), 2.) : exp(uFallK * along - .35);

    {
        vec3 alb = pow(a.rgb / max(a.a, .002), vec3(2.2));
        float lum = dot(alb, vec3(.2126, .7152, .0722));
        alb = mix(alb, vec3(lum), uMuted);
        vec3 t3 = texture2D(uNrm, tu).rgb;
        vec3 n = vec3(t3.xy * 2. - 1., 0.);
        n.z = sqrt(max(1. - dot(n.xy, n.xy), 0.));
        float h0 = t3.z * uZ;
        float ndl = max(dot(n, uL), 0.);

        // shadow: march the height field toward the lamp
        float occ = 0.;
        float t = .6 + .5 * jit;
        vec2 stepUv = uD / uTex;
        for (int i = 0; i < 26; i++) {
            float hs = texture2D(uNrm, tu + stepUv * t).b * uZ;
            occ = max(occ, (hs - h0 - t * uTanEl) / (.12 * t + 1.6));
            t *= 1.27;
        }
        // a shadow in a room is never quite black: some light comes back off the walls
        float sh = 1. - .86 * clamp(occ, 0., 1.);

        float x = uExpo * ndl * sh * fall;
        float diff = 1. - exp(-1.25 * x);
        vec3 hv = normalize(uL + vec3(0., 0., 1.));
        float sp = pow(max(dot(n, hv), 0.), uSpec.y) * uSpec.x * sh * fall;
        // bounce: the lamp's light comes back off the walls and the floor near it, so
        // a groove turned away from the lamp is dark, not black, at the lit end
        vec3 bounce = uLamp * .045 * min(fall, 3.) * (.6 + .4 * n.z);
        vec3 c = alb * (uAmb * (.82 + .18 * n.z) + bounce + uLamp * diff * 1.7) + uLamp * sp;
        col = pow(shoulder(c), vec3(1. / 2.2));
    }

    // the object's shadow on the paper, and its contact with it
    float shade = 0.;
    if (uObject > .5 && alpha < .998) {
        // How much of the lamp (a disc uLampR across, uL's elevation) the object
        // hides from this point of paper: the steepest angle up to the object's
        // top along the way to the lamp, against the lamp's own elevation. Near
        // the object the angle is steep and the shadow is black and sharp; further
        // out it falls toward the lamp's height and the shadow thins and softens.
        // Five taps across the light widen its sides the same way.
        vec2 side = vec2(-uD.y, uD.x);
        float el = asin(uL.z);
        float occl = 0.;
        float tNear = uCastLen;           // how far off the object is, along the light
        float jside = ign(gl_FragCoord.yx + 17.) - .5;   // dithers the taps into one smooth penumbra
        for (int k = -2; k <= 2; k++) {
            float best = -1.;
            for (int i = 0; i < 14; i++) {
                float f = (float(i) + jit) / 14.;
                float t = f * f * uCastLen + 1.;
                vec2 q = p + uD * t + side * ((float(k) + jside) * .9 * t * uLampR);
                float body = smoothstep(.45, 1., texture2D(uBody, (q - uRect.xy) / uRect.zw).a);
                float ang = atan(uThick * body, t);
                best = max(best, ang);
                if (body > .02) tNear = min(tNear, t);
            }
            occl += clamp((best - el) / (2. * uLampR) + .5, 0., 1.);
        }
        occl /= 5.;
        // and the room's own light fills it in with distance: black at the foot
        // of the object, a thin grey by about its own size, then nothing
        float fade = 1. - smoothstep(0., uCastLen, tNear);
        float s = occl * mix(.3, 1., fade * fade) * (1. - smoothstep(.6 * uCastLen, uCastLen, tNear));
        float contact = texture2D(uBody, ou).a;
        shade = min(max(s * uCast * .78, smoothstep(.2, .65, contact) * .3), .5);
    }
    vec3 ink = vec3(.075, .065, .055);
    gl_FragColor = vec4(col * alpha, alpha) + (1. - alpha) * vec4(ink * shade, shade);
}`;

export function rakingLight(root, opts = {}) {
    const img = root && root.querySelector('img');
    if (!img) return () => {};
    const ds = root.dataset;
    const pick = (k, d) => opts[k] ?? ds[k] ?? d;
    const num = (k, d) => {
        const v = pick(k, null);
        return v == null || v === '' || !isFinite(Number(v)) ? d : Number(v);
    };
    const lightOpt = String(pick('light', '-45 12')).trim().split(/[\s,]+/).map(Number);
    const cfg = {
        normal: pick('normal', ''),
        albedo: pick('albedo', ''),
        height: Math.max(0.1, num('height', 20)),
        kind: pick('kind', 'object') === 'surface' ? 'surface' : 'object',
        material: MATERIALS[pick('material', 'clay')] ? pick('material', 'clay') : 'clay',
        restAz: isFinite(lightOpt[0]) ? lightOpt[0] : -45,
        restEl: clamp(isFinite(lightOpt[1]) ? lightOpt[1] : 12, EL_MIN, EL_MAX),
        cast: clamp(num('cast', 0.6)),
        relief: Math.max(0, num('relief', 1)),
        muted: clamp(num('muted', 0.2)),
        reach: Math.max(1, num('reach', 6)),
        ambient: Math.max(0, num('ambient', 1)),
        falloff: Math.max(0, num('falloff', 2)),
    };
    if (!cfg.normal || !cfg.albedo) return () => {};
    const isObject = cfg.kind === 'object';

    // screen azimuth (0 = from the top, -90 = from the left) -> angle of the
    // direction toward the lamp, in page coordinates (x right, y down)
    const toTheta = (az) => Math.atan2(-Math.cos(az * RAD), Math.sin(az * RAD));
    const restTheta = toTheta(cfg.restAz);

    let dead = false;
    let canvas = null, gl = null, prog = null, buf = null, U = {};
    let texAlb = null, texNrm = null, texBody = null;
    let bmAlb = null, bmNrm = null, bodyCanvas = null;
    let texW = 1, texH = 1;
    let W = 0, H = 0, dpr = 1;               // canvas css size
    let rectIn = [0, 0, 1, 1];                // image within canvas
    let crop = [0, 0, 1, 1];
    let visible = false, raf = 0, last = 0;
    let sizeTimer = 0;
    let tilt = { x: 0, y: 0, active: false };

    // the lamp: angle and elevation (radians), with spring velocities
    const lamp = { th: restTheta, el: cfg.restEl * RAD, vth: 0, vel: 0 };
    let target = { th: restTheta, el: cfg.restEl * RAD };
    let mode = 'rest';                        // rest | pointer | touch | keys
    let ptr = null;                           // last mouse position (client px)
    let drag = null;                          // { id, x, th0 }
    let dragTh = 0;                           // touch: drag offset to the angle
    let keyAim = null;                        // keys: { th, el }
    let lastTouch = 0, idleTimer = 0;

    const off = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); off.push(() => t.removeEventListener(type, fn, o)); };

    // ── GL ────────────────────────────────────────────────────────────
    function initGL() {
        // WebGL2 where there is one: it mipmaps textures of any size, so an
        // object drawn smaller than its maps keeps a clean edge
        const attrs = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false };
        gl = canvas.getContext('webgl2', attrs) || canvas.getContext('webgl', attrs);
        if (!gl) return false;
        const sh = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
            return s;
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
        for (const n of ['uAlb', 'uNrm', 'uBody', 'uCanvas', 'uRect', 'uCrop', 'uTex', 'uZ', 'uL', 'uD', 'uTanEl', 'uExpo',
            'uCentre', 'uFallR', 'uLamp', 'uAmb', 'uSpec', 'uMuted', 'uObject', 'uThick', 'uCastLen', 'uCast', 'uFallK', 'uLampR']) U[n] = gl.getUniformLocation(prog, n);
        const gl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        const tex = (unit, source, edge, mip) => {
            const t = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0 + unit);
            gl.bindTexture(gl.TEXTURE_2D, t);
            mip = mip && gl2;
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, edge);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, edge);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            if (mip) gl.generateMipmap(gl.TEXTURE_2D);
            return t;
        };
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        // ImageBitmaps carry their own premultiply / colour-space choice
        texAlb = tex(0, bmAlb, gl.CLAMP_TO_EDGE, true);
        texNrm = tex(1, bmNrm, gl.CLAMP_TO_EDGE, true);
        texBody = tex(2, bodyCanvas, gl.CLAMP_TO_EDGE);
        gl.uniform1i(U.uAlb, 0);
        gl.uniform1i(U.uNrm, 1);
        gl.uniform1i(U.uBody, 2);
        gl.uniform2f(U.uTex, texW, texH);
        gl.uniform1f(U.uZ, cfg.height * cfg.relief);
        gl.uniform1f(U.uMuted, cfg.muted);
        gl.uniform1f(U.uObject, isObject ? 1 : 0);
        gl.uniform1f(U.uCast, cfg.cast);
        gl.uniform2f(U.uSpec, MATERIALS[cfg.material][0], MATERIALS[cfg.material][1]);
        gl.uniform3f(U.uLamp, 1.0, 0.92, 0.82);       // a warm lamp, about 3400 K
        gl.uniform3f(U.uAmb, 0.08 * cfg.ambient, 0.083 * cfg.ambient, 0.09 * cfg.ambient);
        gl.uniform1f(U.uFallK, cfg.falloff);
        gl.uniform1f(U.uLampR, 6.5 * RAD);   // a lamp with a shade, close by: about 13 degrees across     // the room: dim and a touch cool
        gl.clearColor(0, 0, 0, 0);
        return true;
    }

    async function loadMaps() {
        const get = async (url, o) => {
            const r = await fetch(new URL(url, document.baseURI));
            if (!r.ok) throw new Error(url + ' ' + r.status);
            return createImageBitmap(await r.blob(), o);
        };
        [bmAlb, bmNrm] = await Promise.all([
            get(cfg.albedo, { premultiplyAlpha: 'premultiply' }),
            // the normal map is data, not a picture: no colour management, no premultiply
            get(cfg.normal, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }),
        ]);
        texW = bmNrm.width; texH = bmNrm.height;
        // the object's body: its silhouette, softened by drawing it small. Its
        // value is how high the object stands at that point, for the shadow it
        // throws on the paper.
        bodyCanvas = document.createElement('canvas');
        const bw = 192, bh = Math.max(8, Math.round(192 * texH / texW));
        bodyCanvas.width = bw; bodyCanvas.height = bh;
        if (isObject) {
            // drawn small and scaled back up: a soft, smooth silhouette (the
            // first and last texels stay empty for CLAMP_TO_EDGE)
            const sw = Math.max(8, Math.round(bw / 4)), sh = Math.max(8, Math.round(bh / 4));
            const sm = document.createElement('canvas');
            sm.width = sw; sm.height = sh;
            const sg = sm.getContext('2d');
            sg.imageSmoothingEnabled = true; sg.imageSmoothingQuality = 'high';
            sg.drawImage(bmAlb, 1, 1, sw - 2, sh - 2);
            const g = bodyCanvas.getContext('2d');
            g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
            g.drawImage(sm, 0, 0, bw, bh);
        }
    }

    // ── layout ────────────────────────────────────────────────────────
    function layout() {
        const r = root.getBoundingClientRect();
        const iw = Math.max(1, r.width), ih = Math.max(1, r.height);
        let mL = 0, mR = 0, mT = 0, mB = 0;
        if (isObject) {
            // room around the object for its shadow, but never past the sides
            // of the page (no sideways scroll)
            const m = Math.round(Math.max(iw, ih) * 1.0);
            const docW = document.documentElement.clientWidth;
            mL = Math.max(0, Math.min(m, Math.floor(r.left)));
            mR = Math.max(0, Math.min(m, Math.floor(docW - r.right)));
            mT = m; mB = m;
        }
        W = iw + mL + mR;
        H = ih + mT + mB;
        canvas.style.left = -mL + 'px';
        canvas.style.top = -mT + 'px';
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        dpr = Math.min(devicePixelRatio || 1, 2);
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
        dpr = Math.min(dpr, max / W, max / H);
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);

        // the image box, and the part of the texture it shows (object-fit: cover)
        const ir = img.getBoundingClientRect();
        rectIn = [ir.left - r.left + mL, ir.top - r.top + mT, Math.max(1, ir.width), Math.max(1, ir.height)];
        crop = [0, 0, 1, 1];
        const cs = getComputedStyle(img);
        if (cs.objectFit === 'cover') {
            const k = Math.max(rectIn[2] / texW, rectIn[3] / texH);
            const sw = rectIn[2] / k / texW, sh = rectIn[3] / k / texH;
            const pos = (cs.objectPosition || '50% 50%').split(' ');
            const frac = (s, room) => (s.endsWith('%') ? parseFloat(s) / 100 : room > 0 ? clamp(parseFloat(s) / room) : 0.5);
            crop = [(1 - sw) * frac(pos[0] || '50%', (1 - sw) * texW * k), (1 - sh) * frac(pos[1] || '50%', (1 - sh) * texH * k), sw, sh];
        }
        gl.uniform2f(U.uCanvas, W, H);
        gl.uniform4f(U.uRect, ...rectIn);
        gl.uniform4f(U.uCrop, ...crop);
        // falloff: from the middle of what is shown, over about half its long side
        gl.uniform2f(U.uCentre, rectIn[0] + rectIn[2] / 2, rectIn[1] + rectIn[3] / 2);
        gl.uniform1f(U.uFallR, Math.max(rectIn[2], rectIn[3]) * 0.5);
        // the tablet stands about a sixth of its size off the page (a real one
        // is thicker); its shadow is followed out to about its own size
        gl.uniform1f(U.uThick, Math.max(rectIn[2], rectIn[3]) * 0.16);
        gl.uniform1f(U.uCastLen, Math.max(rectIn[2], rectIn[3]) * 0.9);
    }

    function draw() {
        if (!gl || gl.isContextLost()) return;
        const c = Math.cos(lamp.el), s = Math.sin(lamp.el);
        const dx = Math.cos(lamp.th), dy = Math.sin(lamp.th);
        gl.uniform3f(U.uL, c * dx, c * dy, s);
        gl.uniform2f(U.uD, dx, dy);
        gl.uniform1f(U.uTanEl, Math.tan(lamp.el));
        // exposed for a low lamp: flat clay under it reads near its own colour
        gl.uniform1f(U.uExpo, 1.3 / Math.max(s, 0.08));
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // ── where the lamp wants to be ────────────────────────────────────
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    function aimFromPointer(cx, cy) {
        const r = img.getBoundingClientRect();
        // an object: its radius. A band: half its height, so a sweep along it runs from low to high to low
        const R = Math.max(1, 0.5 * (isObject ? Math.max(r.width, r.height) : Math.min(r.width, r.height)));
        const dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2);
        const d = Math.hypot(dx, dy) / R;
        // too near the middle to say which side the lamp is on: keep the side it was
        let th = d < 0.18 ? target.th : Math.atan2(dy, dx);
        let el = (21 - 15 * smooth(0, 2.4, d)) * RAD;
        // far away the pointer is not this lamp any more: drift back to rest
        const w = 1 - smooth(cfg.reach * 0.6, cfg.reach, d);
        th = restTheta + wrap(th - restTheta) * w;
        el = cfg.restEl * RAD + (el - cfg.restEl * RAD) * w;
        return { th, el };
    }
    function aimFromTouch() {
        let th = restTheta + dragTh, el = cfg.restEl * RAD;
        if (tilt.active && !calm.matches) {
            th += tilt.x * 100 * RAD;
            el -= tilt.y * 9 * RAD;
        }
        return { th, el };
    }
    function retarget() {
        let t;
        if (mode === 'keys' && keyAim) t = keyAim;
        else if (mode === 'pointer' && ptr) t = aimFromPointer(ptr.x, ptr.y);
        else if (mode === 'touch') t = aimFromTouch();
        else t = { th: restTheta, el: cfg.restEl * RAD };
        // take the short way round, and never leave the low band
        target = { th: lamp.th + wrap(t.th - lamp.th), el: clamp(t.el, EL_MIN * RAD, EL_MAX * RAD) };
        if (calm.matches) {
            // reduced motion: no easing; the lamp is where the hand put it
            lamp.th = target.th; lamp.el = target.el; lamp.vth = lamp.vel = 0;
            if (visible) draw();
            return;
        }
        kick();
    }

    // ── loop ──────────────────────────────────────────────────────────
    function frame(t) {
        raf = 0;
        if (dead || !gl) return;
        const dt = last ? Math.min(1 / 30, (t - last) / 1000) : 1 / 60;
        last = t;
        if (mode === 'touch' && tilt.active && !calm.matches) {
            const a = aimFromTouch();
            target.th = lamp.th + wrap(a.th - lamp.th);
            target.el = clamp(a.el, EL_MIN * RAD, EL_MAX * RAD);
        }
        // critically damped spring: the lamp follows like a lamp in a hand
        const k = STIFF;
        lamp.vth += (k * k * (target.th - lamp.th) - 2 * k * lamp.vth) * dt;
        lamp.vel += (k * k * (target.el - lamp.el) - 2 * k * lamp.vel) * dt;
        lamp.th += lamp.vth * dt;
        lamp.el += lamp.vel * dt;
        const settled = Math.abs(target.th - lamp.th) < 1e-3 && Math.abs(target.el - lamp.el) < 5e-4 &&
            Math.abs(lamp.vth) < 2e-3 && Math.abs(lamp.vel) < 1e-3;
        if (settled) { lamp.th = target.th; lamp.el = target.el; lamp.vth = lamp.vel = 0; }
        draw();
        if (visible && !document.hidden && !settled) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    function kick() {
        if (!raf && visible && gl && !document.hidden) raf = requestAnimationFrame(frame);
    }

    // ── input ─────────────────────────────────────────────────────────
    function onMove(e) {
        if (e.pointerType === 'touch') return;
        ptr = { x: e.clientX, y: e.clientY };
        if (calm.matches && !drag) return;          // reduced motion: only a deliberate drag moves it
        if (calm.matches && drag) { dragMouse(e); return; }
        mode = 'pointer';
        if (visible) retarget();
    }
    function onLeave(e) {
        if (e.pointerType === 'touch' || calm.matches) return;
        if (e.relatedTarget == null) { ptr = null; if (mode === 'pointer') { mode = 'rest'; retarget(); } }
    }
    function onScroll() {
        if (mode === 'pointer' && ptr && visible) retarget();
    }

    // touch: a sideways drag turns the lamp around the object; vertical is scroll
    function onDown(e) {
        if (e.pointerType === 'touch') {
            drag = { id: e.pointerId, x: e.clientX, th0: dragTh };
            lastTouch = performance.now();
            if (mode !== 'touch') { mode = 'touch'; dragTh = wrap(lamp.th - restTheta); drag.th0 = dragTh; }
        } else if (calm.matches && e.button === 0) {
            e.preventDefault();
            drag = { id: e.pointerId, x: e.clientX, y: e.clientY, mouse: true };
            dragMouse(e);
        }
    }
    function dragMouse(e) {
        const a = aimFromPointer(e.clientX, e.clientY);
        keyAim = a; mode = 'keys';
        retarget();
    }
    function onDrag(e) {
        if (!drag || e.pointerId !== drag.id) return;
        if (drag.mouse) { dragMouse(e); return; }
        const r = root.getBoundingClientRect();
        const span = Math.max(220, Math.min(r.width, innerWidth));
        dragTh = drag.th0 + ((e.clientX - drag.x) / span) * 260 * RAD;
        lastTouch = performance.now();
        mode = 'touch';
        retarget();
    }
    function onUp(e) {
        if (!drag || e.pointerId !== drag.id) return;
        drag = null;
        lastTouch = performance.now();
        scheduleIdle();
    }
    // a phone left alone: after a while the lamp goes back to rest
    function scheduleIdle() {
        clearTimeout(idleTimer);
        if (calm.matches) return;
        idleTimer = setTimeout(() => {
            if (dead || drag || mode !== 'touch') return;
            if (performance.now() - lastTouch < 6000) { scheduleIdle(); return; }
            dragTh = 0;
            retarget();
        }, 6500);
    }

    function onKey(e) {
        const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
        if (!steps[e.key]) { if (e.key === 'Escape') { mode = 'rest'; keyAim = null; retarget(); } return; }
        e.preventDefault();
        const [da, de] = steps[e.key];
        const base = keyAim || { th: lamp.th, el: lamp.el };
        keyAim = { th: base.th + da * 20 * RAD, el: clamp(base.el + de * 3 * RAD, EL_MIN * RAD, EL_MAX * RAD) };
        mode = 'keys';
        retarget();
    }

    // the phone reports its angle many times a second even when held still:
    // wake the loop only when the lamp should actually go somewhere
    function onTilt() {
        if (!tilt.active || calm.matches || !visible) return;
        if (mode === 'rest') mode = 'touch';
        if (mode !== 'touch') return;
        const a = aimFromTouch();
        if (Math.abs(wrap(a.th - target.th)) > 0.004 || Math.abs(a.el - target.el) > 0.003) kick();
    }

    // ── start ─────────────────────────────────────────────────────────
    let io = null, ro = null;
    async function start() {
        try {
            if (!img.complete) await new Promise((res) => { img.addEventListener('load', res, { once: true }); img.addEventListener('error', res, { once: true }); });
            await loadMaps();
        } catch (e) {
            return;                                   // the <img> stays: that is the fallback
        }
        if (dead) return;
        canvas = document.createElement('canvas');
        canvas.className = 'rl-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        try {
            if (!initGL()) throw new Error('no webgl');
            root.appendChild(canvas);
            layout();
            draw();
        } catch (e) {
            if (canvas) canvas.remove();
            canvas = null; gl = null;
            return;
        }
        root.classList.add('is-live');

        on(canvas, 'webglcontextlost', (e) => {
            e.preventDefault();
            cancelAnimationFrame(raf); raf = 0;
            root.classList.remove('is-live');
        });
        on(canvas, 'webglcontextrestored', () => {
            try { if (initGL()) { layout(); draw(); root.classList.add('is-live'); } } catch (e) { /* stay on the img */ }
        });

        root.tabIndex = 0;
        if (!root.hasAttribute('aria-label')) {
            root.setAttribute('aria-label', 'A carved surface under a low lamp. Arrow keys move the lamp around it.');
            root.dataset.rlLabel = '1';
        }
        root.dataset.rlAdded = '1';
        const drg = img.getAttribute('draggable');
        img.draggable = false;
        off.push(() => (drg == null ? img.removeAttribute('draggable') : img.setAttribute('draggable', drg)));

        on(window, 'pointermove', onMove, { passive: true });
        on(document.documentElement, 'pointerleave', onLeave);
        on(document, 'pointerout', onLeave);
        on(window, 'scroll', onScroll, { passive: true });
        on(root, 'pointerdown', onDown);
        on(window, 'pointermove', onDrag, { passive: true });
        on(window, 'pointerup', onUp);
        on(window, 'pointercancel', onUp);
        on(root, 'keydown', onKey);
        on(window, 'deviceorientation', onTilt, { passive: true });
        on(document, 'visibilitychange', () => { if (!document.hidden) { last = 0; kick(); } });
        on(calm, 'change', () => { mode = 'rest'; keyAim = null; drag = null; lamp.th = restTheta; lamp.el = cfg.restEl * RAD; retarget(); draw(); });

        import('./tilt.js').then((m) => { tilt = m.default; }).catch(() => {});

        io = new IntersectionObserver((en) => {
            visible = en[0].isIntersecting;
            if (visible) { last = 0; retarget(); draw(); }
        }, { rootMargin: '60px' });
        io.observe(root);

        let w0 = 0, h0 = 0, x0 = 0;
        ro = new ResizeObserver(() => {
            const r = root.getBoundingClientRect();
            if (Math.abs(r.width - w0) < 1 && Math.abs(r.height - h0) < 1 && Math.abs(r.left - x0) < 1) return;
            w0 = r.width; h0 = r.height; x0 = r.left;
            clearTimeout(sizeTimer);
            sizeTimer = setTimeout(() => { if (!dead && gl) { layout(); draw(); } }, 120);
        });
        ro.observe(root);
        ro.observe(document.documentElement);
    }
    start();

    return function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(sizeTimer);
        clearTimeout(idleTimer);
        off.forEach((f) => f());
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (gl) { const x = gl.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
        if (canvas) canvas.remove();
        for (const b of [bmAlb, bmNrm]) if (b && b.close) b.close();
        root.classList.remove('is-live');
        if (root.dataset.rlAdded) {
            root.removeAttribute('tabindex');
            if (root.dataset.rlLabel) root.removeAttribute('aria-label');
            delete root.dataset.rlAdded;
            delete root.dataset.rlLabel;
        }
    };
}

// Auto-start every [data-raking-light], each once it is near the viewport (the
// maps are a few megabytes; nothing is fetched for a piece nobody scrolls to).
function autoStart(el) {
    if (!('IntersectionObserver' in window) || !('createImageBitmap' in window)) return;
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        rakingLight(el);
    }, { rootMargin: '800px' });
    io.observe(el);
}
document.querySelectorAll('[data-raking-light]').forEach(autoStart);
