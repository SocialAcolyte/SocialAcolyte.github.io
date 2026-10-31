/* wet-on-wet — a Winslow Homer watercolour painted in front of you as you scroll.
 *
 *   <section data-wet-on-wet data-src="assets/sloop.json">
 *     <div class="ww-stage"><img class="ww-img" src="assets/sloop.webp" alt="" aria-hidden="true"></div>
 *   </section>
 *
 * The sheet starts as white paper with a light pencil drawing on it, and is painted the
 * way Homer worked in Nassau: clear water swept over the sky and the sea, colour dropped
 * into the wet paper in a few broad, pale, flat areas with feathered edges; the wash drying
 * matte with a rim and granulation; then, object by object (sky, shore, hull, sails, figures,
 * dinghy, sea), the mid-tones and darks laid wet-on-dry, each object finished before the next;
 * and last the lights scraped back to white paper with a knife.
 * The last frame is the painting itself, pixel for pixel. Scroll back and it un-paints.
 *
 * Everything heavy is offline (see README): the painting split, in optical density, into a
 * first wash, a mid-tone pass and the rest, the wash under the scraped lights, a pencil
 * drawing, and maps of when each pass reaches each point of the sheet.
 *
 * Options (data-* or the options object, which wins):
 *   src      the painting's JSON (required); images are <name>.webp, -wash, -mid, -fill,
 *            -lines, -mapa, -mapb (.webp) beside it
 *   mode     'scroll' (default: a pinned stage on a runway) | 'static' (the finished painting)
 *   runway   section height in svh (default 350)
 *   webgl    'off' leaves the finished painting as an image
 *
 * Events (bubbling, for sound later): 'wet-on-wet:stage' {stage} as each pass begins while
 * scrolling forward ('wash', 'strokes', 'scrape'), and 'wet-on-wet:done' at the end.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function loadImage(url) {
    return new Promise((res, rej) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('wet-on-wet: could not load ' + url));
        im.src = url;
    });
}
function loadExact(url) {
    return fetch(url).then((r) => { if (!r.ok) throw new Error('wet-on-wet: could not load ' + url); return r.blob(); })
        .then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
}

/* ── Paper noise: one tileable 512² RGBA texture, made once ────────────────
 * R  fibres / fine speckle   G  mid mottle (sizing unevenness)
 * B  tooth (the grain that catches pigment and graphite)   A  broad, for the sheen */
let noiseCache = null;
function makeNoise() {
    if (noiseCache) return noiseCache;
    const S = 512, out = new Uint8Array(S * S * 4);
    let seed = 7411;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    function lattice(p) {
        const g = new Float32Array(p * p);
        for (let i = 0; i < g.length; i++) g[i] = rnd();
        return (u, v) => {
            const fx = u * p, fy = v * p, ix = Math.floor(fx), iy = Math.floor(fy);
            const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
            const x0 = ((ix % p) + p) % p, x1 = (x0 + 1) % p, y0 = ((iy % p) + p) % p, y1 = (y0 + 1) % p;
            const a = g[y0 * p + x0], b = g[y0 * p + x1], c = g[y1 * p + x0], d = g[y1 * p + x1];
            return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
        };
    }
    const f1 = lattice(256), f2 = lattice(128), m1 = lattice(8), m2 = lattice(20), m3 = lattice(48), t1 = lattice(170), t2 = lattice(64), b1 = lattice(3), b2 = lattice(7);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S, k = (y * S + x) * 4;
        out[k] = clamp(f1(u, v) * .6 + f2(u, v) * .4, 0, 1) * 255;
        out[k + 1] = clamp(.5 + (m1(u, v) * .5 + m2(u, v) * .32 + m3(u, v) * .18 - .5) * 1.6, 0, 1) * 255;
        out[k + 2] = clamp(.5 + (t1(u, v) * .55 + t2(u, v) * .3 + rnd() * .15 - .5) * 2.1, 0, 1) * 255;
        out[k + 3] = clamp(b1(u, v) * .65 + b2(u, v) * .35, 0, 1) * 255;
    }
    noiseCache = { S, data: out };
    return noiseCache;
}

const VERT = `attribute vec2 aP; uniform vec2 uStage; varying vec2 vQ;
void main(){ vQ = vec2(aP.x * .5 + .5, .5 - aP.y * .5) * uStage; gl_Position = vec4(aP, 0., 1.); }`;

/* One quad. Everything is in optical density (linear light): D = -ln(colour / paper).
 * The painting O splits as  L1 (first wash) + L2 (mid-tones) + L3 (the rest) - Ls (scraped),
 * and each pass is shown as it arrives:  D = c1·L1' + c2·L2' + c3·L3' - cs·Ls.
 * The pixel is O · exp(-(D - D_O)), so when every pass is down and dry it is O exactly. */
const FRAG = `precision highp float;
varying vec2 vQ;
uniform sampler2D uO, uW1, uW2, uF, uL, uA, uB, uNz, uWet;
uniform vec4 uView;        // the sheet in the stage: x, y, w, h (css px, camera applied)
uniform vec3 uPage, uPaper;
uniform float uG;          // the gamma used to go to linear light
uniform vec4 uT;           // local times: wash front, wash drying, mid strokes, darks
uniform vec4 uU;           // scrape, pencil left, paper grain left, wet-blur bias
uniform float uPxA;        // asset px per css px

vec3 lin(vec3 c){ return max(pow(max(c, vec3(0.)), vec3(uG)), vec3(1e-6)); }
vec3 dens(vec3 c){ return -log(c / uPaper); }
float lum(vec3 d){ return dot(d, vec3(.2126, .7152, .0722)); }

void main(){
  vec2 sp = vQ - uView.xy;
  vec2 uv = sp / uView.zw;
  float inS = min(min(sp.x, uView.z - sp.x), min(sp.y, uView.w - sp.y));
  // the page, with the sheet's tight shadow (light from above)
  vec2 sq = sp - vec2(0., 2.5);
  float ox = max(max(-sq.x, sq.x - uView.z), 0.), oy = max(max(-sq.y, sq.y - uView.w), 0.);
  float dsh = length(vec2(ox, oy));
  // (inside the sheet's rectangle, where a worn corner is rounded off, the page shows plain)
  vec3 page = inS >= 0. ? uPage : mix(uPage, vec3(.157, .118, .07), .12 * exp(-dsh / 7.) + .09 * exp(-dsh / 1.6));
  if (inS < -1.) { gl_FragColor = vec4(page, 1.); return; }
  vec2 uvc = clamp(uv, vec2(0.), vec2(1.));
  vec4 ln = texture2D(uL, uvc);                  // r pencil, g scrape mask, b the sheet's real edge
  float edge = ln.b * clamp(inS + 1., 0., 1.);
  vec3 o = texture2D(uO, uvc).rgb;
  vec3 Ol = lin(o);
  vec3 DO = dens(Ol);
  vec4 A = texture2D(uA, uvc) * (255. / 254.);   // water sweep, colour bloom, mid strokes
  vec4 B = texture2D(uB, uvc) * (255. / 254.);   // darks, scrapes
  vec2 q = uv * uView.zw;                          // css px on the sheet: noise scale
  vec4 nz1 = texture2D(uNz, q / 512.);
  vec4 nz2 = texture2D(uNz, q / 1400. + .37);
  float nz3 = texture2D(uNz, q / 380. + .61).g;
  float tooth = nz1.b, fib = nz1.r, mott = nz2.g;

  vec3 D1 = dens(lin(texture2D(uW1, uvc).rgb));
  vec3 D2 = dens(lin(texture2D(uW2, uvc).rgb));
  vec3 DF = dens(lin(texture2D(uF, uvc).rgb));
  float m = ln.g;
  vec3 D3 = mix(DO, DF, m);
  vec3 L1 = D1, L2 = D2 - D1, L3 = D3 - D2, Ls = D3 - DO;

  // ── 1. the first wash, wet-in-wet ──────────────────────────────────────────
  float fW = uT.x, gW = uT.y;
  float Tw = A.r + (mott - .5) * .03 + (fib - .5) * .012;
  float water = smoothstep(Tw - .012, Tw + .004, fW);            // clear water swept on
  float T1 = A.g + (mott - .5) * .02 + (nz3 - .5) * .025 + (fib - .5) * .012;   // feathered, branching edge
  float c1 = smoothstep(T1 - .012, T1 + .004, fW);
  float dryAt = .1 + .55 * A.r + (mott - .5) * .32 + (nz3 - .5) * .06;
  float g1 = smoothstep(dryAt, dryAt + .28, gW);
  float wet1 = max(water, c1) * (1. - g1);
  // in suspension the colour is soft and fused; reserved whites keep their crisp edge
  vec3 L1b = dens(lin(texture2D(uWet, uvc).rgb));
  float hold = smoothstep(.006, .05, lum(L1));
  vec3 L1w = L1b * hold * (1.3 + .2 * (1. - c1));
  // the bead: where the wet stops at dry paper the pigment pools in a hard, darker edge;
  // when the next band of water joins it, it melts away
  float bead = c1 * exp(-max(fW - A.r, 0.) / .012) * (1. - g1);
  float b1 = 4. * g1 * (1. - g1);
  vec3 L1s = mix(L1w, L1, g1) * (1. + .55 * bead) + b1 * max(L1 - L1b, 0.) * .9      // pigment drawn to the drying edges
           + b1 * (tooth - .5) * .35 * L1;                         // and into the tooth
  // ── 2. mid-tones, wet-on-dry ───────────────────────────────────────────────
  float fM = uT.z;
  float T2 = A.b + (mott - .5) * .025 + (nz3 - .5) * .02 + (fib - .5) * .006;   // a brush's ragged end
  float c2 = smoothstep(T2 - .01, T2 + .002, fM);
  float g2 = smoothstep(T2 + .035, T2 + .13 + (mott - .5) * .04, fM);
  vec3 D1s = dens(lin(texture2D(uW1, uvc, uU.w - .6).rgb));
  vec3 D2s = dens(lin(texture2D(uW2, uvc, uU.w - .6).rgb));
  vec3 L2b = D2s - D1s;
  float sh2 = smoothstep(.02, .09, lum(L2));
  vec3 L2w = mix(L2, max(L2b, 0.) * sh2, .55) * 1.3;
  float b2 = 4. * g2 * (1. - g2);
  vec3 L2s = mix(L2w, L2, g2) + b2 * max(L2 - L2b, 0.) * .8;
  float wet2 = c2 * (1. - g2) * sh2;
  // ── 3. the darks ───────────────────────────────────────────────────────────
  float fD = uT.w;
  float T3 = B.r + (mott - .5) * .015 + (nz3 - .5) * .012 + (fib - .5) * .006;
  float c3 = smoothstep(T3 - .006, T3 + .002, fD);
  float g3 = smoothstep(T3 + .035, T3 + .12 + (mott - .5) * .04, fD);
  float sh3 = smoothstep(.03, .12, lum(L3));
  vec3 L3s = mix(L3 * 1.22, L3, g3);
  float wet3 = c3 * (1. - g3) * sh3;
  // ── 4. scraped back to the paper ───────────────────────────────────────────
  float Ts = B.g + (fib - .5) * .02 + (tooth - .5) * .02;
  float cs = smoothstep(Ts - .004, Ts + .001, uU.x);      // (Ls already carries the mask)

  vec3 D = c1 * L1s + c2 * L2s + c3 * L3s - cs * Ls;
  vec3 col = Ol * exp(-(D - DO));
  // the water itself: wet paper a touch darker, and a faint sheen of the window on the film
  float wet = max(wet1, max(wet2, wet3));
  col *= 1. - .05 * wet;
  float sheen = smoothstep(.45, .9, texture2D(uNz, q / 2600. + vec2(.13, .71)).a) * (.55 + .45 * fib);
  col = mix(col, vec3(1., .995, .985), wet * (.03 + .16 * sheen));
  // the paper's tooth, raked, while it is still mostly paper
  col *= 1. + uU.z * (tooth - .5) * .05 * exp(-lum(D) * 2.);
  // graphite on the tooth's peaks: grey, a little cool; washes run over it
  float pen = ln.r * uU.y * (1. - .45 * c1) * (.55 + .7 * tooth);
  col *= 1. - pen * vec3(.78, .78, .75);
  vec3 s = pow(max(col, vec3(0.)), vec3(1. / uG));
  gl_FragColor = vec4(mix(page, s, edge), 1.);
}`;

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
}

export function wetOnWet(root, opts = {}) {
    const ds = root.dataset;
    const o = {
        src: opts.src ?? ds.src,
        mode: opts.mode ?? ds.mode ?? 'scroll',
        runway: +(opts.runway ?? ds.runway ?? 350),
        webgl: (opts.webgl ?? ds.webgl ?? 'on') !== 'off' && opts.webgl !== false,
    };
    if (!o.src) return () => {};
    const base = o.src.replace(/\.json$/, '');
    const stage = root.querySelector('.ww-stage') || root;
    let dead = false, cleanup = [];
    const on = (t, ev, fn, opt) => { t.addEventListener(ev, fn, opt); cleanup.push(() => t.removeEventListener(ev, fn, opt)); };
    root.classList.add('ww');
    const still = () => calm.matches || o.mode === 'static' || !o.webgl;
    if (still()) root.classList.add('ww-still');

    const canvas = document.createElement('canvas');
    canvas.className = 'ww-canvas';
    canvas.setAttribute('aria-hidden', 'true');

    let meta, ims = {}, st = null;
    let gl = null, prog = null, U = {}, tex = {};
    let dpr = 1, texW = 0;
    let target = 0, shown = 0, vel = 0, visible = false, raf = 0, last = 0, lastShown = -1;
    const fired = new Set();

    /* ── the camera (narrow screens): follow the work, as a function of scroll only ── */
    let cam = null;
    function buildCamera() {
        const n = 600, fx = new Float32Array(n + 1), fy = new Float32Array(n + 1);
        const tracks = meta.cam, S = st;
        let lx = .5, ly = .4;
        const at = (tr, f) => {
            const j = clamp(f) * (tr.length - 1), j0 = Math.floor(j), j1 = Math.min(tr.length - 1, j0 + 1), t = j - j0;
            const a = tr[j0], b = tr[j1] || a;
            if (!a || !b) return a || b;
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        };
        for (let j = 0; j <= n; j++) {
            const s = j / n;
            let sw = 0, sx = 0, sy = 0;
            for (const k of ['wash', 'strokes', 'scrape']) {
                const [a, b] = S[k], f = (s - a) / (b - a);
                if (f < -.02 || f > 1.02) continue;
                const p = at(tracks[k], f);
                if (!p) continue;
                const wgt = Math.sqrt(Math.max(p[2], 1e-4));
                sw += wgt; sx += wgt * p[0]; sy += wgt * p[1];
            }
            if (sw > 0) { lx = sx / sw; ly = sy / sw; }
            fx[j] = lx; fy[j] = ly;
        }
        const sm = (a) => {
            const o2 = new Float32Array(a.length), r = 40;
            for (let j = 0; j < a.length; j++) {
                let s2 = 0, w2 = 0;
                for (let k = -r; k <= r; k++) {
                    const jj = clamp(j + k, 0, a.length - 1), w = Math.exp(-(k * k) / (2 * 14 * 14));
                    s2 += a[jj] * w; w2 += w;
                }
                o2[j] = s2 / w2;
            }
            return o2;
        };
        cam = { n, fx: sm(fx), fy: sm(fy) };
    }
    function camAt(S) {
        const j = clamp(S) * cam.n, j0 = Math.floor(j), j1 = Math.min(cam.n, j0 + 1), t = j - j0;
        const zin = smooth(.005, st.wash[0] + .02, S), zout = smooth(st.scrape[1] + .005, st.scrape[1] + .055, S);
        return { x: cam.fx[j0] + (cam.fx[j1] - cam.fx[j0]) * t, y: cam.fy[j0] + (cam.fy[j1] - cam.fy[j0]) * t, z: 1 + (zMax - 1) * zin * (1 - zout) };
    }

    let fit = { x: 0, y: 0, w: 0, h: 0 }, stg = { w: 0, h: 0 }, zMax = 1, mips = false;
    function layout() {
        const r = stage.getBoundingClientRect();
        const cs = getComputedStyle(stage);
        const pl = parseFloat(cs.paddingLeft), pr = parseFloat(cs.paddingRight), pt = parseFloat(cs.paddingTop), pb = parseFloat(cs.paddingBottom);
        const H = root.classList.contains('ww-scroll') ? innerHeight : (r.height || innerHeight);
        stg = { w: Math.max(120, Math.round(r.width)), h: Math.max(120, Math.round(H)) };
        const availW = Math.max(100, stg.w - pl - pr), availH = Math.max(100, stg.h - pt - pb);
        const scale = Math.min(availW / meta.w, availH / meta.h, 1);
        fit = { w: meta.w * scale, h: meta.h * scale };
        fit.x = pl + (availW - fit.w) / 2; fit.y = pt + (availH - fit.h) / 2;
        // on a narrow screen the landscape sheet is small: go in close while it is painted
        zMax = mips ? clamp((stg.h * .7) / fit.h, 1, 2.1) : 1;
        if (zMax < 1.15) zMax = 1;
        dpr = Math.min(2, devicePixelRatio || 1);
        canvas.style.width = stg.w + 'px'; canvas.style.height = stg.h + 'px';
        canvas.width = Math.round(stg.w * dpr); canvas.height = Math.round(stg.h * dpr);
        const want = Math.min(meta.w, Math.round(fit.w * zMax * dpr));
        gl.viewport(0, 0, canvas.width, canvas.height);
        if (Math.abs(want - texW) > 2) pack(want, Math.round(want * meta.h / meta.w));
    }
    function viewAt(S) {
        if (zMax === 1) return [fit.x, fit.y, fit.w, fit.h];
        const c = camAt(S), w = fit.w * c.z, h = fit.h * c.z;
        const m = Math.min(fit.x, 12);
        const place = (stageLen, len, f) => len <= stageLen - 2 * m ? (stageLen - len) / 2 : clamp(stageLen / 2 - f * len, stageLen - m - len, m);
        return [place(stg.w, w, c.x), place(stg.h, h, c.y), w, h];
    }

    // The pictures are resampled to the size they are shown at (good downsampling, so the
    // pencil and the scraped marks never alias) and mipmapped (WebGL2): the mips give the
    // soft, fused look of pigment in suspension and keep the zoomed-out sheet clean.
    // The time maps go up once at their own size, exact, and are sampled linearly.
    function setTex(img, mip) {
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        if (mip) gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    function pack(w, h) {
        texW = w;
        for (const k of ['mapa', 'mapb', 'wet']) {
            if (tex[k]) continue;
            tex[k] = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex[k]); setTex(ims[k], false);
        }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        for (const k of ['orig', 'wash', 'mid', 'fill', 'lines']) {
            cx.clearRect(0, 0, w, h);
            cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
            cx.drawImage(ims[k], 0, 0, w, h);
            if (!tex[k]) tex[k] = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex[k]);
            setTex(cv, mips);
        }
        cv.width = cv.height = 0;
    }

    function initGL() {
        const ca = { alpha: false, antialias: false, preserveDrawingBuffer: false };
        const g2 = canvas.getContext('webgl2', ca);
        const g = g2 || canvas.getContext('webgl', ca);
        if (!g) return false;
        gl = g; mips = !!g2;
        try {
            prog = gl.createProgram();
            gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
            gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
            gl.linkProgram(prog);
            if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        } catch (err) { console.warn('wet-on-wet: shader failed', err); gl = null; return false; }
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        tex.buf = buf;
        const loc = gl.getAttribLocation(prog, 'aP');
        gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        for (const n of ['uO', 'uW1', 'uW2', 'uF', 'uL', 'uA', 'uB', 'uNz', 'uWet', 'uStage', 'uView', 'uPage', 'uPaper', 'uG', 'uT', 'uU', 'uPxA']) U[n] = gl.getUniformLocation(prog, n);
        const nz = makeNoise();
        tex.nz = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex.nz);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nz.S, nz.S, 0, gl.RGBA, gl.UNSIGNED_BYTE, nz.data);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        ['uO', 'uW1', 'uW2', 'uF', 'uL', 'uA', 'uB', 'uNz', 'uWet'].forEach((n, i) => gl.uniform1i(U[n], i));
        const p = meta.paper.map((v) => Math.pow(v, meta.gamma));
        gl.uniform3fv(U.uPaper, p);
        gl.uniform1f(U.uG, meta.gamma);
        return true;
    }

    let pageRGB = null;
    function pageColour() {
        if (pageRGB) return pageRGB;
        const m = getComputedStyle(root).backgroundColor.match(/[\d.]+/g) || [243, 240, 232];
        pageRGB = m.slice(0, 3).map((v) => +v / 255);
        return pageRGB;
    }

    const loc = (k, S, end = 1.15) => ((S - st[k][0]) / (st[k][1] - st[k][0])) * end;
    function draw() {
        const S = shown;
        const order = ['orig', 'wash', 'mid', 'fill', 'lines', 'mapa', 'mapb', 'nz', 'wet'];
        order.forEach((k, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, tex[k]); });
        const view = viewAt(S);
        gl.uniform2f(U.uStage, stg.w, stg.h);
        gl.uniform4f(U.uView, ...view);
        gl.uniform3fv(U.uPage, pageColour());
        gl.uniform1f(U.uPxA, meta.w / view[2]);
        // the blur of pigment in suspension, as a mip bias: about 7 css px at any zoom
        const bias = Math.log2(7 * dpr);
        const fS = clamp(loc('strokes', S, 1.12), -1, 2);
        gl.uniform4f(U.uT, clamp(loc('wash', S, 1.12), -1, 2), clamp(loc('washDry', S, 1.22), -1, 2), fS, fS);
        const pencil = 1 - smooth(st.strokes[0], st.strokes[1], S);
        const grain = 1 - smooth(st.strokes[0], st.scrape[1], S);
        gl.uniform4f(U.uU, clamp(loc('scrape', S, 1.06), -1, 2), pencil, grain, mips ? clamp(bias, 0, 6) : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        // events: each pass beginning (forward only), and the painting finished
        if (S > lastShown) {
            for (const k of ['wash', 'strokes', 'scrape']) {
                if (!fired.has(k) && S >= st[k][0]) { fired.add(k); root.dispatchEvent(new CustomEvent('wet-on-wet:stage', { bubbles: true, detail: { stage: k } })); }
            }
            if (!fired.has('done') && S >= st.scrape[1]) { fired.add('done'); root.dispatchEvent(new CustomEvent('wet-on-wet:done', { bubbles: true })); }
        } else {
            for (const k of ['wash', 'strokes', 'scrape']) if (S < st[k][0]) fired.delete(k);
            if (S < st.scrape[1]) fired.delete('done');
        }
        lastShown = S;
    }

    function frame(now) {
        raf = 0;
        const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
        // critically damped spring toward the scroll position; going back it is quicker
        const w = target < shown ? 15 : 10, x0 = shown - target, c2 = vel + w * x0, e = Math.exp(-w * dt);
        shown = target + (x0 + c2 * dt) * e;
        vel = (c2 - w * (x0 + c2 * dt)) * e;
        if (Math.abs(target - shown) < 2e-5 && Math.abs(vel) < 2e-5) { shown = target; vel = 0; }
        draw();
        if (shown !== target && visible && !document.hidden) kick();
        else last = 0;
    }
    function kick() { if (!raf && !dead) raf = requestAnimationFrame(frame); }

    function readScroll() {
        const r = root.getBoundingClientRect();
        const run = r.height - innerHeight;
        target = run > 0 ? clamp(-r.top / run) : 1;
    }

    let live = false;
    async function start() {
        if (still()) return;                        // the finished painting, as an image
        try {
            meta = await (await fetch(o.src)).json();
            const [orig, wash, mid, fill, lines, mapa, mapb, wet] = await Promise.all([
                loadImage(base + '.webp'), loadImage(base + '-wash.webp'), loadImage(base + '-mid.webp'),
                loadImage(base + '-fill.webp'), loadImage(base + '-lines.webp'),
                loadExact(base + '-mapa.webp'), loadExact(base + '-mapb.webp'), loadImage(base + '-wet.webp')]);
            ims = { orig, wash, mid, fill, lines, mapa, mapb, wet };
        } catch (err) { console.warn(err); return; }
        if (dead || still()) return;
        st = meta.stages;
        root.classList.add('ww-scroll');
        root.style.setProperty('--ww-runway', o.runway + 'svh');
        stage.appendChild(canvas);
        if (!initGL()) { canvas.remove(); root.classList.remove('ww-scroll'); root.style.removeProperty('--ww-runway'); return; }
        buildCamera();
        layout();
        root.classList.add('is-live'); live = true;
        readScroll(); shown = target; lastShown = shown;
        for (const k of ['wash', 'strokes', 'scrape']) if (shown >= st[k][0]) fired.add(k);
        if (shown >= st.scrape[1]) fired.add('done');
        draw();

        const io = new IntersectionObserver((en) => {
            visible = en[0].isIntersecting;
            if (visible) { readScroll(); kick(); }
        }, { rootMargin: '10% 0px' });
        io.observe(root); cleanup.push(() => io.disconnect());
        on(window, 'scroll', () => { if (!visible) return; readScroll(); kick(); }, { passive: true });
        let rt = 0;
        const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { if (dead || !gl) return; layout(); readScroll(); shown = target; draw(); }, 80); });
        ro.observe(stage); cleanup.push(() => { ro.disconnect(); clearTimeout(rt); });
        on(document, 'visibilitychange', () => { if (!document.hidden) kick(); });
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); root.classList.remove('is-live'); });
        canvas.addEventListener('webglcontextrestored', () => {
            tex = {}; texW = 0; U = {};
            if (initGL()) { layout(); root.classList.add('is-live'); draw(); }
        });
    }
    // reduced motion switched on mid-visit: settle on the finished painting
    on(calm, 'change', () => {
        if (calm.matches && live) { root.classList.add('ww-still'); root.classList.remove('ww-scroll', 'is-live'); root.style.removeProperty('--ww-runway'); }
        else if (!calm.matches && live) { root.classList.remove('ww-still'); root.classList.add('ww-scroll', 'is-live'); root.style.setProperty('--ww-runway', o.runway + 'svh'); pageRGB = null; layout(); readScroll(); shown = target; draw(); }
        else if (!calm.matches && !live && o.mode !== 'static' && o.webgl) { root.classList.remove('ww-still'); start(); }
    });
    start();

    return function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        cleanup.forEach((f) => f()); cleanup = [];
        if (gl) {
            Object.values(tex).forEach((t) => (t instanceof WebGLTexture ? gl.deleteTexture(t) : gl.deleteBuffer(t)));
            if (prog) gl.deleteProgram(prog);
            gl.getExtension('WEBGL_lose_context')?.loseContext();
        }
        ims.mapa?.close?.(); ims.mapb?.close?.();
        canvas.remove();
        root.classList.remove('ww', 'is-live', 'ww-scroll', 'ww-still');
        root.style.removeProperty('--ww-runway');
    };
}

/* auto-start */
const started = new WeakMap();
function boot() {
    document.querySelectorAll('[data-wet-on-wet]').forEach((el) => {
        if (!started.has(el)) started.set(el, wetOnWet(el));
    });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
