/*
 *  PRETEXT-INSCRIPTION // a Roman inscription cut into a broken stone.
 *
 *  Markup:  <figure data-pretext-inscription>
 *             <blockquote class="pi-text" lang="la">
 *               <p class="pi-row"><span class="pi-la">HOSPES QVOD DEICO …</span>
 *                  <span class="pi-en" lang="en">Stranger, what I have to say is short …</span></p>
 *               …
 *             </blockquote>
 *           </figure>
 *  Or call  pretextInscription(figure, options)  yourself; it returns destroy().
 *
 *  Each .pi-row is a unit of the text (a verse, a line of a dedication) with
 *  its translation beside it. The rows are set in Roman square capitals on an
 *  intact slab, the old way: centred, a big first line and smaller lines
 *  below, words parted by triangular interpuncts, full lines justified to the
 *  field. pretext (Cheng Lou, vendor/pretext) measures every row once at
 *  100px; its widths scale linearly, so a binary search re-sets the whole
 *  inscription at twenty trial sizes without touching the DOM and finds the
 *  largest that fills the field exactly. Then the slab is broken: a fractal
 *  break line takes away a corner, a side, the foot, and every word that was
 *  there, letters cut through at the edge.
 *
 *  The letters are V-cut. They are drawn once into a mask, and an exact
 *  Euclidean distance transform turns the mask into the depth of a chisel
 *  groove (deepest along the middle of each stroke, a crease where the walls
 *  meet). One WebGL fragment shader lights the whole stone from that height
 *  field, the moulded frame and the rough bevel of the break: a raking light,
 *  low across the surface, so one wall of every stroke is lit and the other
 *  falls into shadow, with shadows cast inside the cuts and the slab's own
 *  shadow thrown on the paper. The light follows the pointer (or the tilt of
 *  a phone, or a finger dragged sideways, or, untouched, the scroll), and the
 *  cuts change as it moves. A faint red ochre lies in the grooves, as it did
 *  in Roman letters.
 *
 *  Scrolled into view, the letters are cut one after another along the lines,
 *  a shallow scratch deepening into a clean V, pale with fresh dust; when the
 *  last letter is cut the paint goes in.
 *
 *  The real text stays in the DOM (screen readers, selection, ctrl+F); hover
 *  or tap a line to read its translation beneath the stone. Without JS or
 *  WebGL it is a plain edition: Latin in capitals, English beneath.
 *  Reduced motion: the inscription already cut and painted; the light still
 *  answers the pointer directly but nothing moves by itself.
 */

const LIB = './vendor/pretext/layout.js';
const REF = 100;              // pretext measures at 100px; widths scale linearly
const CUT = 0.42;             // seconds for one letter to go from scratch to full V
const PAINT = 1.7;            // seconds for the paint to sweep through after the last cut

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;

function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function colour(css, fallback) {
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = fallback;
    c.fillStyle = css || fallback;
    const s = c.fillStyle;
    if (s[0] === '#') return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
    const m = s.match(/[\d.]+/g) || [0, 0, 0];
    return [0, 1, 2].map((i) => Number(m[i]) / 255);
}

function loadImage(src) {
    return new Promise((ok, no) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => ok(im);
        im.onerror = no;
        im.src = src;
    });
}

// ---- distance transform ----------------------------------------------------
// Exact squared Euclidean distance transform (Felzenszwalb & Huttenlocher):
// columns, then rows. g holds 0 at sites and a big number elsewhere.
const BIG = 1e20;
function edt(g, w, h) {
    const n = Math.max(w, h);
    const f = new Float64Array(n), d = new Float64Array(n), z = new Float64Array(n + 1);
    const v = new Int32Array(n);
    const line = (len) => {
        let k = 0;
        v[0] = 0; z[0] = -BIG; z[1] = BIG;
        for (let q = 1; q < len; q++) {
            let r = v[k];
            let s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
            while (s <= z[k]) {
                k--; r = v[k];
                s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
            }
            k++; v[k] = q; z[k] = s; z[k + 1] = BIG;
        }
        k = 0;
        for (let q = 0; q < len; q++) {
            while (z[k + 1] < q) k++;
            const r = v[k];
            d[q] = (q - r) * (q - r) + f[r];
        }
    };
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) f[y] = g[y * w + x];
        line(h);
        for (let y = 0; y < h; y++) g[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
        const o = y * w;
        for (let x = 0; x < w; x++) f[x] = g[o + x];
        line(w);
        for (let x = 0; x < w; x++) g[o + x] = d[x];
    }
    return g;
}

// Chamfer distance (3-4 weights, two passes), capped: cheap and close
// enough for the width of a broken edge. 0 at sites, distance in px elsewhere.
function chamfer(inside, w, h, cap) {
    const d = new Float32Array(w * h);
    const C = cap + 2;
    for (let i = 0; i < d.length; i++) d[i] = inside[i] ? C : 0;
    const A = 1, B = Math.SQRT2;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            let v = d[i];
            if (!v) continue;
            if (x > 0) v = Math.min(v, d[i - 1] + A);
            if (y > 0) {
                v = Math.min(v, d[i - w] + A);
                if (x > 0) v = Math.min(v, d[i - w - 1] + B);
                if (x < w - 1) v = Math.min(v, d[i - w + 1] + B);
            }
            d[i] = v;
        }
    }
    for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
            const i = y * w + x;
            let v = d[i];
            if (!v) continue;
            if (x < w - 1) v = Math.min(v, d[i + 1] + A);
            if (y < h - 1) {
                v = Math.min(v, d[i + w] + A);
                if (x < w - 1) v = Math.min(v, d[i + w + 1] + B);
                if (x > 0) v = Math.min(v, d[i + w - 1] + B);
            }
            d[i] = v;
        }
    }
    return d;
}

// Separable box blur, three passes (close to a gaussian), in place.
function blur(a, w, h, r) {
    if (r < 1) return a;
    const t = new Float32Array(Math.max(w, h));
    const pass = (len, get, set) => {
        let acc = 0;
        const k = 1 / (2 * r + 1);
        for (let i = -r; i <= r; i++) acc += get(clamp(i, 0, len - 1));
        for (let i = 0; i < len; i++) {
            t[i] = acc * k;
            acc += get(Math.min(len - 1, i + r + 1)) - get(Math.max(0, i - r));
        }
        for (let i = 0; i < len; i++) set(i, t[i]);
    };
    for (let it = 0; it < 3; it++) {
        for (let y = 0; y < h; y++) { const o = y * w; pass(w, (i) => a[o + i], (i, v) => { a[o + i] = v; }); }
        for (let x = 0; x < w; x++) pass(h, (i) => a[i * w + x], (i, v) => { a[i * w + x] = v; });
    }
    return a;
}

// ---- the break -------------------------------------------------------------
// The surviving outline, in the stone box's unit square (0..1 each way).
// Intact sides are pushed well outside the box so only the break lines count.
// 'heavy': the right side, the top-right corner and the foot are lost;
// 'light': one corner chipped away; 'none': a whole block.
function outline(mode, rand, sw, sh) {
    const j = (a, b) => mix(a, b, rand());
    const O = -0.25;
    let ctrl, broken;
    if (mode === 'heavy') {
        ctrl = [
            [O, O], [j(0.66, 0.74), O],
            [j(0.66, 0.74), 0], [j(0.8, 0.86), j(0.06, 0.12)], [j(0.93, 0.97), j(0.12, 0.2)],
            [1, j(0.3, 0.36)], [j(0.93, 0.96), j(0.48, 0.56)], [j(0.97, 1), j(0.64, 0.7)],
            [j(0.88, 0.92), j(0.82, 0.88)], [j(0.74, 0.8), j(0.92, 0.95)], [j(0.58, 0.64), j(0.97, 1)],
            [j(0.42, 0.48), 1], [j(0.26, 0.32), j(0.96, 0.99)], [j(0.12, 0.16), j(0.9, 0.94)],
            [0, j(0.8, 0.86)], [O, j(0.8, 0.86)],
        ];
        broken = (i) => i >= 2 && i < ctrl.length - 1;
    } else if (mode === 'light') {
        const a = j(0.78, 0.86), b = j(0.26, 0.38);
        ctrl = [[O, O], [a, O], [a, 0], [mix(a, 1, 0.55), b * j(0.25, 0.4)], [1, b], [1 - O, b], [1 - O, 1 - O], [O, 1 - O]];
        broken = (i) => i >= 2 && i < 4;
    } else {
        return [[O, O], [1 - O, O], [1 - O, 1 - O], [O, 1 - O]].map(([u, v]) => [u * sw, v * sh]);
    }
    // Midpoint displacement along each broken segment: big bites, then grit.
    const pts = [];
    const scale = Math.min(sw, sh);
    for (let i = 0; i < ctrl.length; i++) {
        const A = [ctrl[i][0] * sw, ctrl[i][1] * sh];
        pts.push(A);
        if (!broken(i)) continue;
        const B = [ctrl[i + 1][0] * sw, ctrl[i + 1][1] * sh];
        let seg = [A, B];
        let amp = Math.hypot(B[0] - A[0], B[1] - A[1]) * 0.085;
        const facet = Math.max(7, scale * 0.03);
        while (true) {
            const L = Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]);
            if (L < facet) break;
            const out = [seg[0]];
            for (let k = 0; k < seg.length - 1; k++) {
                const p = seg[k], q = seg[k + 1];
                const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
                const off = (rand() * 2 - 1) * amp;
                const along = (rand() - 0.5) * 0.2;
                out.push([p[0] + dx * (0.5 + along) - (dy / len) * off, p[1] + dy * (0.5 + along) + (dx / len) * off], q);
            }
            seg = out;
            amp *= 0.5;
        }
        // the facets stay straight-ish, with a little grit along them
        for (let k = 0; k < seg.length - 1; k++) {
            const p = seg[k], q = seg[k + 1];
            const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
            const steps = Math.max(1, Math.round(len / 3));
            if (k) pts.push(p);
            for (let m = 1; m < steps; m++) {
                const off = (rand() - 0.5) * 0.5;
                pts.push([p[0] + (dx * m) / steps - (dy / len) * off, p[1] + (dy * m) / steps + (dx / len) * off]);
            }
        }
    }
    return pts;
}

// ---- the hedera ------------------------------------------------------------
// An ivy leaf (hedera distinguens), pointing right, with a curling stem.
function hederaPath(x, cx, cy, s) {
    x.save();
    x.translate(cx, cy);
    x.scale(s, s);
    x.beginPath();
    x.moveTo(0.52, 0);
    x.bezierCurveTo(0.24, -0.06, 0.02, -0.44, -0.22, -0.36);
    x.bezierCurveTo(-0.42, -0.3, -0.42, -0.08, -0.26, 0);
    x.bezierCurveTo(-0.42, 0.08, -0.42, 0.3, -0.22, 0.36);
    x.bezierCurveTo(0.02, 0.44, 0.24, 0.06, 0.52, 0);
    x.closePath();
    x.fill();
    x.lineWidth = 0.075;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(-0.26, 0);
    x.bezierCurveTo(-0.5, 0.02, -0.6, -0.22, -0.5, -0.4);
    x.stroke();
    x.restore();
}

// ---- WebGL -----------------------------------------------------------------
const VS = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0., 1.); }`;
const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uGlyph, uFrag, uStone, uNoise;
uniform vec2 uRes;
uniform vec4 uSlab;        // slab rect, device px (x0, y0, x1, y1), y down
uniform vec4 uStoneMap;    // stone texture uv = p * xy + zw
uniform float uFrame, uDpr, uDmax, uBmax, uK, uT, uTtot, uCut, uTend, uMean, uGuide, uReach;
uniform vec3 uL, uTint, uPaint;
uniform vec2 uShadow, uCentre, uHalf;

// value noise with a smooth (C1) cell interpolation, so its slopes have no seams
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return texture2D(uNoise, (i + f + 0.5) / 256.).r; }
float fbm(vec2 p) { return 0.5 * vn(p) + 0.3 * vn(p * 2.07 + 19.3) + 0.2 * vn(p * 4.13 + 41.7); }

// how far into its cut a groove pixel is, 0..1
float cutAt(vec4 g) {
  float st = (g.b * 65280. + g.a * 255.) / 65535. * uTtot;
  float c = clamp((uT - st) / uCut, 0., 1.);
  return c * c * (3. - 2. * c);
}
float mould(vec2 p) {
  float e = min(min(p.x - uSlab.x, uSlab.z - p.x), min(p.y - uSlab.y, uSlab.w - p.y));
  float f = uFrame, h = 0.;
  h -= (1. - smoothstep(0., 2.2 * uDpr, e)) * 1.6 * uDpr;      // the arris, eased
  h -= smoothstep(0.36 * f, 0.43 * f, e) * 0.09 * f;           // a fillet
  h -= smoothstep(0.46 * f, 0.96 * f, e) * 0.30 * f;           // the cyma down to the field
  return h;
}
float breakH(vec2 p, vec4 fr) {
  // the bevel's width wanders along the break, and its inner edge is bitten
  // by chips (noise added to the distance), so the face ends in scallops
  float w = 0.45 + 0.55 * smoothstep(0.2, 0.8, vn(p / (30. * uDpr)));
  float e = fr.g * 2. + (fbm(p / (7. * uDpr)) - 0.5) * 0.7 * w;
  float t = 1. - clamp(e / w, 0., 1.);
  float n2 = vn(p / (2.4 * uDpr)) - 0.5;      // the grain of the break
  return -(pow(t, 1.6) * 0.6 + t * n2 * 0.05) * uBmax;
}
// the structural height (mould, groove, break): used for shading and shadows
float Hs(vec2 p) {
  vec2 uv = p / uRes;
  vec4 g = texture2D(uGlyph, uv);
  vec4 fr = texture2D(uFrag, uv);
  return mould(p) - g.r * uDmax * uK * cutAt(g) + breakH(p, fr);
}
// what casts shadows across the stone: the frame and the break (a V-cut's
// own walls are lit two-tone, not drowned in their own shadow)
float Hc(vec2 p) {
  vec4 fr = texture2D(uFrag, p / uRes);
  return mould(p) + breakH(p, fr);
}
float H(vec2 p) {
  float micro = (fbm(p / (2.4 * uDpr)) - 0.5) * 0.09 * uDpr + (vn(p / (48. * uDpr)) - 0.5) * 1.5 * uDpr;
  return Hs(p) + micro;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 uv = p / uRes;
  vec4 fr = texture2D(uFrag, uv);
  float a = fr.r;
  // the slab's shadow on the paper, thrown away from the light
  float sh = texture2D(uFrag, (p + uShadow) / uRes).b * 0.36 + texture2D(uFrag, (p + uShadow * 0.3) / uRes).b * 0.16;
  vec3 shadowC = vec3(0.16, 0.12, 0.09);
  if (a < 0.003) { gl_FragColor = vec4(shadowC * sh, sh); return; }

  vec4 g = texture2D(uGlyph, uv);
  float c = cutAt(g);
  float hl = H(p - vec2(1., 0.)), hr = H(p + vec2(1., 0.));
  float hu = H(p - vec2(0., 1.)), hd = H(p + vec2(0., 1.));
  vec3 n = normalize(vec3(-(hr - hl) * 0.5, -(hd - hu) * 0.5, 1.));

  // shadows cast inside the cuts, the frame and the break: march toward the light
  float lit = 1.;
  vec2 dir = normalize(uL.xy + 1e-5);
  float tanE = uL.z / max(length(uL.xy), 1e-3);
  float h0 = Hc(p);
  if (h0 < -0.25 && tanE < 2.5) {
    for (int i = 1; i <= 10; i++) {
      float t = float(i) / 10. * uReach;
      float over = Hc(p + dir * t) - (h0 + t * tanE);
      lit = min(lit, clamp(1. - over / (1.1 * uDpr), 0., 1.));
    }
  }

  // stone: warm tint, the marble's veins, a faint weathered mottle
  vec3 st = texture2D(uStone, p * uStoneMap.xy + uStoneMap.zw).rgb;
  float lum = dot(st, vec3(0.299, 0.587, 0.114));
  vec3 alb = uTint * (1. + (lum - uMean) * 0.5);
  alb *= 1. - (fbm(p / (90. * uDpr)) - 0.5) * 0.08;
  // a weathered break is a touch darker, rough and sugary
  float edge = 1. - clamp(fr.g * 2., 0., 1.);
  alb *= 1. - edge * 0.16;

  float d = g.r * uDmax;                         // px from the groove's edge
  float cov = g.g;
  // the ordinator's brushed layout, faint, before the chisel reaches it
  alb = mix(alb, alb * vec3(0.78, 0.74, 0.72), cov * (1. - c) * uGuide);
  // fresh cut: pale stone dust in a new groove, fading
  float st0 = (g.b * 65280. + g.a * 255.) / 65535. * uTtot;
  float age = uT - st0 - uCut;
  float fresh = c * cov * exp(-max(age, 0.) / 0.9);
  // the paint: red ochre settles in the deep of the groove, worn at the lips
  float paintT = clamp((uT - uTend - st0 / uTtot * ${PAINT * 0.6}) / ${PAINT * 0.4}, 0., 1.);
  float wear = smoothstep(0.32, 0.62, fbm(p / (3.2 * uDpr)) + d / max(uDmax, 1.) * 0.55);
  float paint = cov * c * paintT * smoothstep(0.35 * uDpr, 1.2 * uDpr, d) * wear;
  alb = mix(alb, uPaint, paint * 0.62);
  alb = mix(alb, vec3(0.97, 0.955, 0.93), fresh * 0.55);

  // raking light: lambert, normalised so flat stone shows its own colour
  float ndl = dot(n, uL);
  float diff = max(ndl, 0.) / max(uL.z, 0.12) * mix(0.2, 1., lit);
  float amb = 0.5;
  // a lamp on that side: the near half of the stone a little brighter
  float side = clamp(dot((p - uCentre) / uHalf, dir), -1.2, 1.2);
  float shade = (amb + (1. - amb) * diff) * (1. + side * 0.06);
  // deep cuts collect a little grime
  shade *= 1. - 0.12 * smoothstep(0., uDmax, d) * c;
  shade = shade < 1. ? shade : 1. + (1. - exp(-(shade - 1.) * 1.2)) * mix(0.6, 0.08, paint);
  vec3 col = alb * shade;
  // a breath of sheen on the walls that face the lamp
  float spec = pow(max(dot(reflect(-uL, n), vec3(0., 0., 1.)), 0.), 18.) * 0.08 * lit;
  col += spec;
  col = clamp(col, 0., 1.);
  gl_FragColor = vec4(col * a + shadowC * sh * (1. - a), a + sh * (1. - a));
}`;

function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
}

// ---- the component -----------------------------------------------------------
export function pretextInscription(root, opts = {}) {
    const text = root && root.querySelector('.pi-text');
    if (!root || !text) return () => {};
    const ds = root.dataset;
    const opt = (k, d) => opts[k] ?? ds[k] ?? d;
    const mode = ['heavy', 'light', 'none'].includes(opt('break', 'heavy')) ? opt('break', 'heavy') : 'heavy';
    const seedOpt = String(opt('seed', '7'));
    const seed = seedOpt === 'random' ? (Math.random() * 1e9) | 0 : Number(seedOpt) || 7;
    const family = opt('font', null), weight = opt('weight', null);
    const tracking = Number(opt('tracking', 0.06));
    const leading = Number(opt('leading', 1.5));
    const durOpt = Number(opt('duration', 0));
    const hedera = String(opt('hedera', 'false')) !== 'false';
    const aspect = Number(opt('aspect', 0));
    const hint = opt('hint', null) ?? (matchMedia('(hover: hover)').matches ? 'Hover a line to read it' : 'Touch a line to read it');
    const guide = clamp(Number(opt('guide', 0.14)));
    const stoneUrl = opt('stone', new URL('./assets/marble.webp', import.meta.url).href);

    const rowEls = [...text.querySelectorAll('.pi-row')];
    if (!rowEls.length) return () => {};
    root.classList.add('pi');

    let dead = false;
    const off = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    const stage = document.createElement('div');
    stage.className = 'pi-stage';
    stage.setAttribute('aria-hidden', 'true');
    const canvas = document.createElement('canvas');
    canvas.className = 'pi-canvas';
    stage.appendChild(canvas);
    const say = document.createElement('p');
    say.className = 'pi-say';
    say.setAttribute('aria-hidden', 'true');
    say.innerHTML = '<span class="pi-hint"></span><span class="pi-tr"></span>';
    const sayHint = say.firstChild, sayTr = say.lastChild;
    sayHint.textContent = hint;

    let gl = null, prog = null, U = {}, tex = {};
    let api, stoneImg, stoneMean = 0.5;
    let font = { weight: '600', family: 'serif' };
    let tint = [0.87, 0.84, 0.78], paintC = [0.64, 0.24, 0.15];

    // geometry (CSS px unless noted) and the laid-out lines
    let G = null, lines = [], dpr = 1, Ttot = 1, Tend = 1;
    // motion
    let visible = false, started = false, raf = 0, last = 0, T = 0;
    const light = { x: -1, y: -0.9, tx: -1, ty: -0.9, src: 'scroll' };
    let tiltMod = null, sayRow = -1, pinned = false, addedTab = false;

    const spec = (s) => `${font.weight} ${s}px ${font.family}`;
    const meas = document.createElement('canvas').getContext('2d');

    // ---- layout -------------------------------------------------------------
    function rowsData() {
        return rowEls.map((el, i) => {
            const la = el.querySelector('.pi-la') || el;
            const en = el.querySelector('.pi-en');
            const words = la.textContent.replace(/[·•]/g, ' ').trim().split(/\s+/).filter(Boolean);
            const k = Number(el.dataset.scale) || [1.36, 1.1][i] || 1;
            return { words, k, fit: el.hasAttribute('data-fit'), en: en ? en.textContent.trim() : '' };
        });
    }

    function geometry(hsForce) {
        const rw = Math.max(240, root.clientWidth);
        const M = Math.round(clamp(rw * 0.035, 14, 34));
        const fx = mode === 'heavy' ? 0.86 : 1, fy = mode === 'heavy' ? 0.9 : 1;
        const sw = rw - 2 * M;
        const Ws = sw / fx;
        let Hs;
        if (hsForce) Hs = hsForce;
        else if (aspect) Hs = Ws * aspect;
        else Hs = clamp((innerHeight * 0.74 - 2 * M) / fy, Ws * 0.5, Ws * 1.75);
        const sh = Math.round(Hs * fy);
        const f = clamp(Math.min(Ws, Hs) * 0.05, 7, 34);
        const pad = f * 1.95;
        return {
            M, sw, sh, Ws, Hs, f, cw: sw + 2 * M, ch: sh + 2 * M,
            field: { x: M + pad, y: M + pad, w: Ws - 2 * pad, h: Hs - 2 * pad },
        };
    }

    function layout() {
        G = geometry();
        dpr = Math.min(2, devicePixelRatio || 1);
        if (G.cw * G.ch * 9 < 2.6e6) dpr = Math.min(3, devicePixelRatio || 1);
        const rows = rowsData();
        const ls = { letterSpacing: tracking * REF };
        for (const r of rows) {
            r.P = api.prepareWithSegments(r.words.join(' · '), spec(REF), ls);
            r.nat = api.measureNaturalWidth(r.P);
        }
        // set every row at scale s; null if a word would have to break.
        // fitAll: every row after the first on one line of its own, sized
        // to the field (the classic ordinatio, when the stone is wide enough)
        const pour = (s, fitAll) => {
            let H = 0, prev = Infinity;
            const out = [];
            for (const [i, r] of rows.entries()) {
                let size = Math.min(s * r.k, prev);
                if (r.fit || (fitAll && i > 0)) size = Math.min(size, (G.field.w * REF) / r.nat);
                const res = api.layoutWithLines(r.P, (G.field.w * REF) / size, 1);
                for (const ln of res.lines) if (ln.end.graphemeIndex > 0) return null;
                out.push({ r, size, texts: res.lines.map((l) => l.text) });
                H += res.lines.length * size * leading;
                prev = size;
            }
            return { out, H };
        };
        const search = (fitAll) => {
            let lo = 3, hi = G.field.h / leading / rows[0].k;
            for (let i = 0; i < 22; i++) {
                const mid = (lo + hi) / 2;
                const res = pour(mid, fitAll);
                if (res && res.H <= G.field.h) lo = mid; else hi = mid;
            }
            return pour(lo, fitAll) || pour(3, fitAll);
        };
        let fitAll = false;
        let set = search(false);
        if (rows.length > 2 && !rows.every((r) => r.fit)) {
            const body = set.out[set.out.length - 1].size;
            const alt = search(true);
            if (Math.min(...alt.out.map((o) => o.size)) >= body * 0.7) { set = alt; fitAll = true; }
        }
        // A free aspect: a stone no taller than its text needs
        if (!aspect && G.field.h > set.H * 1.3) {
            G = geometry(G.Hs - (G.field.h - set.H * 1.3));
            set = search(fitAll);
        }
        const F = G.field;

        // lines: justify, place glyphs and interpuncts
        meas.font = spec(100);
        const capK = (meas.measureText('H').actualBoundingBoxAscent || 70) / 100;
        const all = [];
        set.out.forEach((row, ri) => row.texts.forEach((t, li) => {
            const words = t.split(/\s+/).map((w) => w.replace(/·/g, '')).filter(Boolean);
            all.push({ ri, last: li === row.texts.length - 1, size: row.size, fit: row.r.fit, words });
        }));
        const N = all.length;
        const extra = Math.max(0, F.h - set.H);
        const avg = all.reduce((a, l) => a + l.size, 0) / Math.max(1, N);
        const gEach = Math.min(extra / (N + 1), avg * 0.45);
        let y = F.y + (extra - gEach * (N - 1)) / 2;
        lines = [];
        all.forEach((L, idx) => {
            const s = L.size, pitch = s * leading, capH = capK * s;
            const base = y + pitch / 2 + capH / 2;
            meas.font = spec(s);
            const adv = (ch) => meas.measureText(ch).width;
            const tr0 = tracking * s;
            const gapN = adv(' · ') + tr0;
            const ws = L.words.map((w) => [...w].map(adv));
            const sum = (tr) => ws.reduce((a, g) => a + g.reduce((b, c) => b + c, 0) + tr * (g.length - 1), 0);
            const chars = ws.reduce((a, g) => a + g.length - 1, 0);
            const n = ws.length;
            const isEnd = hedera && idx === N - 1;
            const hedW = isEnd ? capH * 1.15 : 0;
            let gap = gapN, tr = tr0;
            let natural = sum(tr0) + gapN * (n - 1) + (isEnd ? gapN * 0.7 + hedW : 0);
            // Full lines are justified: the slack goes to the interpunct gaps
            // (up to half again), then to tracking; a line too short for
            // that is centred, as the Romans did, rather than stretched.
            const justify = natural > F.w * 0.84 || (!L.last && n > 1 && natural > F.w * 0.7);
            let x = F.x + (F.w - natural) / 2;
            if (justify) {
                let slack = F.w - natural;
                if (slack < 0 && n > 1) gap = Math.max(gapN * 0.6, gapN + slack / (n - 1));
                else if (slack > 0) {
                    const gAdd = n > 1 ? Math.min(slack, gapN * 0.5 * (n - 1)) : 0;
                    slack -= gAdd;
                    const tAdd = chars ? Math.min(slack / chars, s * 0.08) : 0;
                    tr = tr0 + tAdd;
                    gap = gapN + (n > 1 ? gAdd / (n - 1) : 0);
                }
                natural = sum(tr) + gap * (n - 1) + (isEnd ? gapN * 0.7 + hedW : 0);
                x = F.x + (F.w - natural) / 2;
            }
            const items = [];
            ws.forEach((g, wi) => {
                const w = L.words[wi];
                [...w].forEach((ch, ci) => {
                    items.push({ ch, x, w: g[ci] });
                    x += g[ci] + (ci < g.length - 1 ? tr : 0);
                });
                if (wi < n - 1) {
                    items.push({ dot: true, x: x + gap / 2 - s * 0.08, w: s * 0.16, cx: x + gap / 2 });
                    x += gap;
                }
            });
            if (isEnd) items.push({ hed: true, x: x + gapN * 0.7, w: hedW, cx: x + gapN * 0.7 + hedW / 2 });
            lines.push({ row: L.ri, size: s, base, capH, items, top: y, bottom: y + pitch + gEach });
            y += pitch + gEach;
        });
    }

    // ---- textures -------------------------------------------------------------
    function bake() {
        const W = Math.round(G.cw * dpr), H = Math.round(G.ch * dpr);
        canvas.width = W; canvas.height = H;
        canvas.style.width = G.cw + 'px';
        canvas.style.height = G.ch + 'px';
        const R = rng(seed);
        const poly = outline(mode, R, G.sw, G.sh).map(([u, v]) => [u + G.M, v + G.M]);
        const slab = { x0: G.M, y0: G.M, x1: G.M + G.Ws, y1: G.M + G.Hs };

        const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c.getContext('2d', { willReadFrequently: true }); };
        const tracePoly = (x) => { x.beginPath(); poly.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py))); x.closePath(); };

        // the stone: the break polygon, clipped to the slab
        const sx = cv(W, H);
        sx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sx.save(); sx.beginPath(); sx.rect(slab.x0, slab.y0, slab.x1 - slab.x0, slab.y1 - slab.y0); sx.clip();
        tracePoly(sx); sx.fillStyle = '#fff'; sx.fill(); sx.restore();
        const stoneA = sx.getImageData(0, 0, W, H).data;
        // distance to the break only
        const bx = cv(W, H);
        bx.setTransform(dpr, 0, 0, dpr, 0, 0);
        tracePoly(bx); bx.fillStyle = '#fff'; bx.fill();
        const brkA = bx.getImageData(0, 0, W, H).data;
        const N = W * H;
        const Bmax = clamp(G.sw * 0.02, 6, 16) * dpr;
        const inB = new Uint8Array(N);
        for (let i = 0; i < N; i++) inB[i] = brkA[i * 4 + 3] >= 128 ? 1 : 0;
        const bd = chamfer(inB, W, H, Bmax * 2);
        const sb = new Float32Array(N);
        for (let i = 0; i < N; i++) sb[i] = stoneA[i * 4 + 3] / 255;
        blur(sb, W, H, Math.max(1, Math.round(4 * dpr)));
        const frag = new Uint8Array(N * 4);
        for (let i = 0; i < N; i++) {
            frag[i * 4] = stoneA[i * 4 + 3];
            frag[i * 4 + 1] = Math.round(clamp(bd[i] / (2 * Bmax)) * 255);
            frag[i * 4 + 2] = Math.round(sb[i] * 255);
            frag[i * 4 + 3] = 255;
        }

        // is a point on the surviving stone?
        const onStone = (x, y) => {
            const px = Math.round(x * dpr), py = Math.round(y * dpr);
            if (px < 0 || py < 0 || px >= W || py >= H) return false;
            return stoneA[(py * W + px) * 4 + 3] > 200;
        };

        // the letters: one mask, one schedule
        const gx = cv(W, H);
        gx.setTransform(dpr, 0, 0, dpr, 0, 0);
        gx.fillStyle = '#fff'; gx.strokeStyle = '#fff';
        gx.textBaseline = 'alphabetic';
        let work = 0, count = 0;
        const sched = [];
        for (const ln of lines) {
            gx.font = spec(ln.size);
            for (const it of ln.items) {
                const cy = ln.base - ln.capH * 0.5;
                if (it.dot) {
                    const r = ln.size * 0.11, yy = ln.base - ln.capH * 0.46;
                    gx.beginPath();
                    gx.moveTo(it.cx - r, yy - r * 0.7);
                    gx.lineTo(it.cx + r, yy - r * 0.7);
                    gx.lineTo(it.cx, yy + r * 0.95);
                    gx.closePath(); gx.fill();
                } else if (it.hed) hederaPath(gx, it.cx, cy, ln.capH * 1.05);
                else gx.fillText(it.ch, it.x, ln.base);
                // only letters that survive take the chisel's time
                const vis = onStone(it.x + it.w / 2, cy) || onStone(it.x + it.w * 0.15, cy) || onStone(it.x + it.w * 0.85, cy);
                it.t0 = work;
                if (vis) { work += it.dot ? it.w * 0.8 : it.w; count++; }
                sched.push(it);
            }
            work += G.field.w * 0.03;       // the cutter shifts to the next line
        }
        const D = durOpt || clamp(1.2 + count * 0.024, 2.2, 7);
        const speed = work / D;
        for (const it of sched) it.t0 /= speed;
        Ttot = D + CUT;
        Tend = D + CUT * 0.6;

        const gA = gx.getImageData(0, 0, W, H).data;
        const gd = new Float32Array(N);
        let any = false;
        for (let i = 0; i < N; i++) { const inside = gA[i * 4 + 3] >= 128; gd[i] = inside ? BIG : 0; any = any || inside; }
        if (any) edt(gd, W, H);
        let dmax = 1;
        for (let i = 0; i < N; i++) if (gd[i] > 0) { const v = Math.sqrt(gd[i]) - 0.5; gd[i] = v; if (v > dmax) dmax = v; }
        // which line owns each device row; which item owns each x within it
        const lineOfY = new Int16Array(H).fill(-1);
        lines.forEach((ln, li) => {
            for (let y = Math.max(0, Math.floor(ln.top * dpr)); y < Math.min(H, Math.ceil(ln.bottom * dpr)); y++) lineOfY[y] = li;
        });
        const glyph = new Uint8Array(N * 4);
        for (let y = 0; y < H; y++) {
            const li = lineOfY[y];
            const ln = li >= 0 ? lines[li] : null;
            let k = 0;
            for (let x = 0; x < W; x++) {
                const i = y * W + x, a = gA[i * 4 + 3];
                glyph[i * 4] = a ? Math.round(clamp(gd[i] / dmax) * 255) : 0;
                glyph[i * 4 + 1] = a;
                if (!a || !ln) continue;
                const cx = x / dpr;
                const its = ln.items;
                while (k < its.length - 1 && cx > (its[k].x + its[k].w + its[k + 1].x) / 2) k++;
                const it = its[k];
                const wipe = clamp((cx - it.x) / Math.max(1, it.w)) * CUT * 0.55;
                const s16 = Math.round(clamp((it.t0 + wipe) / Ttot) * 65535);
                glyph[i * 4 + 2] = s16 >> 8;
                glyph[i * 4 + 3] = s16 & 255;
            }
        }

        upload('uGlyph', 0, W, H, glyph, gl.NEAREST);
        upload('uFrag', 1, W, H, frag, gl.LINEAR);

        // uniforms that hold until the next layout
        gl.useProgram(prog);
        gl.viewport(0, 0, W, H);
        gl.uniform2f(U.uRes, W, H);
        gl.uniform4f(U.uSlab, slab.x0 * dpr, slab.y0 * dpr, slab.x1 * dpr, slab.y1 * dpr);
        const iw = stoneImg.naturalWidth, ih = stoneImg.naturalHeight;
        const sc = Math.max((slab.x1 - slab.x0) * dpr / iw, (slab.y1 - slab.y0) * dpr / ih);
        gl.uniform4f(U.uStoneMap, 1 / (iw * sc), 1 / (ih * sc), -slab.x0 * dpr / (iw * sc), -slab.y0 * dpr / (ih * sc));
        gl.uniform1f(U.uFrame, G.f * dpr);
        gl.uniform1f(U.uDpr, dpr);
        gl.uniform1f(U.uDmax, dmax);
        gl.uniform1f(U.uBmax, Bmax);
        gl.uniform1f(U.uK, 1.1);
        gl.uniform1f(U.uTtot, Ttot);
        gl.uniform1f(U.uCut, CUT);
        gl.uniform1f(U.uTend, Tend);
        gl.uniform1f(U.uMean, stoneMean);
        gl.uniform1f(U.uGuide, guide);
        gl.uniform3f(U.uTint, ...tint);
        gl.uniform3f(U.uPaint, ...paintC);
        gl.uniform2f(U.uCentre, (G.M + G.sw / 2) * dpr, (G.M + G.sh / 2) * dpr);
        gl.uniform2f(U.uHalf, (G.sw / 2) * dpr, (G.sh / 2) * dpr);
        G.depth = G.f * 0.39 * dpr + Bmax;
    }

    function upload(name, unit, w, h, data, filter) {
        if (!tex[name]) tex[name] = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex[name]);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    function initGL() {
        gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
        if (!gl) throw new Error('no webgl');
        prog = gl.createProgram();
        gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
        gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
        gl.useProgram(prog);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'a');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const u = gl.getActiveUniform(prog, i); U[u.name] = gl.getUniformLocation(prog, u.name); }
        gl.uniform1i(U.uGlyph, 0); gl.uniform1i(U.uFrag, 1); gl.uniform1i(U.uStone, 2); gl.uniform1i(U.uNoise, 3);
        // the stone photograph
        gl.activeTexture(gl.TEXTURE2);
        tex.stone = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex.stone);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stoneImg);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // value noise: white noise, bilinear, repeating
        const R = rng(seed * 31 + 5), nz = new Uint8Array(256 * 256 * 4);
        for (let i = 0; i < nz.length; i++) nz[i] = (R() * 256) | 0;
        gl.activeTexture(gl.TEXTURE3);
        tex.noise = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex.noise);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, nz);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        // mean luminance of the photograph, so its veins vary around the tint
        const c = document.createElement('canvas'); c.width = c.height = 32;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(stoneImg, 0, 0, 32, 32);
        const d = x.getImageData(0, 0, 32, 32).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        stoneMean = s / (d.length / 4) / 255;
    }

    // ---- light ----------------------------------------------------------------
    // The light is a direction: (x, y) is where it comes from, across the
    // stone, in units of its half-size; height is fixed, so the further out,
    // the lower it rakes.
    const LZ = 0.72;
    function scrollTarget() {
        const r = canvas.getBoundingClientRect();
        const q = clamp((r.top + r.height / 2) / innerHeight, -0.2, 1.2);
        return [mix(1.5, -1.5, q), -0.95];
    }
    function lightTarget() {
        if (light.src === 'pointer' || light.src === 'finger' || light.src === 'key') return [light.tx, light.ty];
        if (tiltMod && tiltMod.active) return [clamp(tiltMod.x * 2.4, -2.4, 2.4), clamp(-0.9 + tiltMod.y * 2, -2.4, 0.15)];
        return calm.matches ? [-1.1, -0.95] : scrollTarget();
    }
    function fromClient(cx, cy) {
        const r = canvas.getBoundingClientRect();
        const ox = r.left + (G.M + G.sw / 2), oy = r.top + (G.M + G.sh / 2);
        let x = (cx - ox) / (G.sw / 2), y = (cy - oy) / (G.sh / 2);
        const l = Math.hypot(x, y);
        if (l > 2.6) { x *= 2.6 / l; y *= 2.6 / l; }
        // the light stays in the upper half (lit from below, cuts read as
        // relief) and never climbs overhead (it must rake to show the cuts)
        y = Math.min(y, 0.15);
        const len = Math.hypot(x, y), least = 0.95;
        if (len < least) {
            if (len < 1e-3) { const c = Math.hypot(light.x, light.y) || 1; x = light.x / c; y = light.y / c; }
            else { x /= len; y /= len; }
            x *= least; y *= least;
        }
        return [x, y];
    }

    function draw() {
        if (!gl || !G) return;
        const L = [light.x, light.y, LZ];
        const l = Math.hypot(...L);
        const Ln = L.map((v) => v / l);
        gl.uniform3f(U.uL, Ln[0], Ln[1], Ln[2]);
        gl.uniform1f(U.uT, T);
        // the slab's shadow: toward the light, longer as the light drops
        const flat = Math.hypot(Ln[0], Ln[1]);
        const len = Math.min(26, G.M * 0.6, 7 * flat / Math.max(0.2, Ln[2])) * dpr;
        gl.uniform2f(U.uShadow, (Ln[0] / (flat || 1)) * len, (Ln[1] / (flat || 1)) * len);
        gl.uniform1f(U.uReach, Math.min(90 * dpr, G.depth / Math.max(0.15, Ln[2] / (flat || 1))));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function frame(now) {
        raf = 0;
        if (dead) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        let alive = false;
        if (started && T < Tend + PAINT + 1.2) {
            if (calm.matches) T = Tend + PAINT + 1.2;
            else { T += dt; alive = true; }
        }
        const [tx, ty] = lightTarget();
        const k = calm.matches ? 1 : 1 - Math.exp(-dt / 0.16);
        light.x += (tx - light.x) * k;
        light.y += (ty - light.y) * k;
        if (Math.abs(tx - light.x) + Math.abs(ty - light.y) > 0.002) alive = true;
        else { light.x = tx; light.y = ty; }
        draw();
        if (alive && visible) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    const kick = () => { if (!raf && !dead && G) raf = requestAnimationFrame(frame); };

    // ---- reading ----------------------------------------------------------------
    const rows = rowsData();
    function showRow(ri) {
        if (ri === sayRow) return;
        sayRow = ri;
        if (ri >= 0 && rows[ri] && rows[ri].en) {
            sayTr.textContent = rows[ri].en;
            say.classList.add('is-reading');
        } else say.classList.remove('is-reading');
    }
    function rowAt(cx, cy) {
        if (!G) return -1;
        const r = canvas.getBoundingClientRect();
        const x = cx - r.left, y = cy - r.top;
        if (x < G.M - 8 || x > G.M + G.sw + 8 || y < G.M - 8 || y > G.M + G.sh + 8) return -1;
        for (const ln of lines) if (y >= ln.top && y < ln.bottom) return ln.row;
        return -1;
    }

    // ---- input --------------------------------------------------------------------
    on(window, 'pointermove', (e) => {
        if (e.pointerType !== 'mouse' || !visible || !G) return;
        [light.tx, light.ty] = fromClient(e.clientX, e.clientY);
        light.src = 'pointer';
        showRow(rowAt(e.clientX, e.clientY));
        kick();
    }, { passive: true });
    on(document, 'pointerleave', () => { if (light.src === 'pointer') { light.src = 'scroll'; showRow(-1); kick(); } });
    on(document.documentElement, 'mouseleave', () => { if (light.src === 'pointer') { light.src = 'scroll'; showRow(-1); kick(); } });
    let finger = null;
    on(canvas, 'pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        finger = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
        [light.tx, light.ty] = fromClient(e.clientX, e.clientY);
        light.src = 'finger';
        kick();
    });
    on(canvas, 'pointermove', (e) => {
        if (!finger || e.pointerId !== finger.id) return;
        if (Math.abs(e.clientX - finger.x) > 8) finger.moved = true;
        [light.tx, light.ty] = fromClient(e.clientX, e.clientY);
        kick();
    });
    const lift = (e) => {
        if (!finger || e.pointerId !== finger.id) return;
        if (!finger.moved && e.type === 'pointerup') {
            const ri = rowAt(e.clientX, e.clientY);
            showRow(ri === sayRow ? -1 : ri);
        }
        finger = null;
        pinned = true;      // the light stays where the finger left it until the page scrolls
    };
    on(canvas, 'pointerup', lift);
    on(canvas, 'pointercancel', lift);
    on(window, 'scroll', () => {
        if (!visible) return;
        if (pinned && light.src === 'finger') { pinned = false; light.src = 'scroll'; }
        kick();
    }, { passive: true });
    on(window, 'deviceorientation', () => { if (visible && light.src === 'scroll') kick(); }, { passive: true });
    // keyboard: up/down read the rows, left/right swing the light
    on(root, 'keydown', (e) => {
        if (e.target !== root) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const n = rows.length, d = e.key === 'ArrowDown' ? 1 : -1;
            showRow(sayRow < 0 ? (d > 0 ? 0 : n - 1) : (sayRow + d + n) % n);
            e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (light.src !== 'key') { light.tx = light.x; light.ty = light.y; }
            light.src = 'key';
            const a = Math.atan2(light.ty, light.tx) + (e.key === 'ArrowRight' ? 0.26 : -0.26);
            const r = Math.max(1.2, Math.hypot(light.tx, light.ty));
            light.tx = Math.cos(a) * r; light.ty = Math.sin(a) * r;
            kick();
            e.preventDefault();
        } else if (e.key === 'Escape') showRow(-1);
    });
    on(root, 'blur', () => { if (light.src === 'key') light.src = 'scroll'; showRow(-1); kick(); });

    // ---- start ----------------------------------------------------------------------
    (async () => {
        try {
            const la = rowEls[0].querySelector('.pi-la') || rowEls[0];
            const cs = getComputedStyle(la);
            font = { weight: weight || cs.fontWeight, family: family || cs.fontFamily };
            const rs = getComputedStyle(root);
            tint = colour(rs.getPropertyValue('--pi-stone').trim(), '#ddd6c8');
            paintC = colour(rs.getPropertyValue('--pi-paint').trim(), '#94402a');
            [api, stoneImg] = await Promise.all([import(LIB), loadImage(new URL(stoneUrl, document.baseURI).href)]);
            try { await document.fonts.load(`${font.weight} 40px ${font.family}`, 'HOSPES'); } catch (e) { /* measure what we have */ }
            if (dead) return;
            root.insertBefore(stage, text);
            root.insertBefore(say, text);
            initGL();
            layout();
            bake();
            root.classList.add('is-live');
            if (!root.hasAttribute('tabindex')) { root.tabIndex = 0; addedTab = true; }
        } catch (e) {
            stage.remove(); say.remove();
            root.classList.remove('is-live');
            return;
        }
        if (calm.matches) { started = true; T = Tend + PAINT + 1.2; }
        [light.x, light.y] = lightTarget();
        draw();
        const io = new IntersectionObserver((en) => {
            for (const e of en) {
                visible = e.isIntersecting;
                if (e.intersectionRatio > 0.3 || (e.isIntersecting && e.intersectionRect.height > innerHeight * 0.5)) started = true;
            }
            if (visible) kick();
        }, { threshold: [0, 0.3, 0.6] });
        io.observe(stage);
        off.push(() => io.disconnect());
        import('./tilt.js').then((m) => { tiltMod = m.default; }).catch(() => {});
        on(calm, 'change', kick);
        let timer = 0, lastW = root.clientWidth, lastH = innerHeight;
        const ro = new ResizeObserver(() => {
            const w = root.clientWidth;
            if (w === lastW && Math.abs(innerHeight - lastH) < 140) return;
            lastW = w; lastH = innerHeight;
            clearTimeout(timer);
            timer = setTimeout(() => { if (!dead) { layout(); bake(); draw(); kick(); } }, 140);
        });
        ro.observe(root);
        off.push(() => { ro.disconnect(); clearTimeout(timer); });
    })();

    return function destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        off.forEach((f) => f());
        if (gl) {
            Object.values(tex).forEach((t) => gl.deleteTexture(t));
            if (prog) gl.deleteProgram(prog);
            const lose = gl.getExtension('WEBGL_lose_context');
            if (lose) lose.loseContext();
        }
        if (addedTab) root.removeAttribute('tabindex');
        stage.remove(); say.remove();
        root.classList.remove('pi', 'is-live');
    };
}

// Auto-start every [data-pretext-inscription] once it is near the viewport.
document.querySelectorAll('[data-pretext-inscription]').forEach((el) => {
    if (!('IntersectionObserver' in window)) { pretextInscription(el); return; }
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        pretextInscription(el);
    }, { rootMargin: '600px' });
    io.observe(el);
});
