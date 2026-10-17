/*
 *  PRETEXT-HALFTONE // a portrait made of the weight of words.
 *
 *  Markup:  <section data-pretext-halftone data-src="assets/eutyches.webp">
 *             <div class="ph-stage">
 *               <p class="ph-text">The paragraph.</p>
 *             </div>
 *           </section>
 *  data-src is the picture (same origin). It is never shown: it only says
 *  how dark each word should be. Or call pretextHalftone(element, opts)
 *  yourself; it returns destroy().
 *
 *  The paragraph is set as a justified block the shape of the picture, in a
 *  variable serif (Fraunces). The words are the unit of layout; the glyphs
 *  are the unit of tone: every letter takes its own weight on the wght axis
 *  from the picture under it, a hairline where it is light, black where it
 *  is dark, so the image is carried by density alone: one ink, no colour,
 *  no dots. Past 900 the weight keeps going as "ink gain", the black weight
 *  spread by a stroke like over-inked letterpress, so the hair and the eyes
 *  can reach a real black. Below 100 it keeps going the other way as "ink
 *  fade", the hairline printed in a thinner ink, so highlights go nearly to
 *  paper (same hue, only lighter). Darkness is turned into weight through a
 *  measured ink-coverage curve, so the mid tones fall evenly.
 *
 *  Line breaks come from pretext (Cheng Lou, vendor/pretext): the text is
 *  measured at nine weights, each word is measured at its own weights, the
 *  block is broken, the picture is sampled under every letter, and that
 *  repeats until the weights stop moving lines (2-4 passes).
 *
 *  Each word keeps one box for its whole life, as wide as the word at the
 *  wider of its two weights (the reading weight and its portrait weight).
 *  As the weights change the word is re-spaced inside its box, so nothing
 *  ever reflows: the paragraph stays still and only the ink moves.
 *
 *  Scroll: the block starts as a plain paragraph at the reading weight and,
 *  as you scroll, the weights flow toward the portrait, staggered from the
 *  middle of the face outward, so a face condenses out of the page.
 *  Pointer or finger: a lamp with a reading glass in it. Around it the
 *  weights relax to the reading weight and the face dissolves; at its heart
 *  the words are magnified enough to read, even at phone size.
 *
 *  The real <p> stays in the DOM (screen readers, find, selection, no-JS).
 *  Reduced motion: the portrait is shown composed; the lamp still works.
 */

const LIB = './vendor/pretext/layout.js';
const STEPS = 9;            // weights the text is measured at, wMin..wMax
const LEADING = 1.06;       // line pitch, x font size

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (i) => { let x = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return (x >>> 0) / 4294967296; };

function loadImage(src) {
    return new Promise((ok, no) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => ok(im);
        im.onerror = no;
        im.src = src;
    });
}

// Separable box blur, in place, radius r (px of the map). Three passes of
// a box are close to a gaussian.
function blur(a, w, h, r, passes = 3) {
    if (r < 1) return a;
    const tmp = new Float32Array(Math.max(w, h));
    const run = (get, set, n) => {
        let acc = 0;
        const span = 2 * r + 1;
        for (let i = -r; i <= r; i++) acc += get(clamp(i, 0, n - 1));
        for (let i = 0; i < n; i++) {
            tmp[i] = acc / span;
            acc += get(Math.min(n - 1, i + r + 1)) - get(Math.max(0, i - r));
        }
        for (let i = 0; i < n; i++) set(i, tmp[i]);
    };
    for (let p = 0; p < passes; p++) {
        for (let y = 0; y < h; y++) { const o = y * w; run((i) => a[o + i], (i, v) => { a[o + i] = v; }, w); }
        for (let x = 0; x < w; x++) run((i) => a[i * w + x], (i, v) => { a[i * w + x] = v; }, h);
    }
    return a;
}

// Stretch values so the lo/hi quantiles land on 0 and 1.
function stretch(a, lo, hi) {
    const s = Float32Array.from(a).sort();
    const a0 = s[Math.floor(lo * (s.length - 1))], a1 = s[Math.floor(hi * (s.length - 1))];
    const k = 1 / Math.max(1e-4, a1 - a0);
    for (let i = 0; i < a.length; i++) a[i] = clamp((a[i] - a0) * k);
}

// The picture as a tone map: darkness 0..1 at (tw x th), contrast-stretched,
// with its large-scale shading pulled down a little so local detail (eyes,
// brows, the line of the mouth) keeps its strength, then lightly blurred to
// about a line's height, and shaped by gamma. Returned as a summed-area
// table so any word's box averages in four reads.
function toneMap(img, crop, tw, th, lineMapPx, gamma, local, levels) {
    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    const iw = img.naturalWidth, ih = img.naturalHeight;
    x.drawImage(img, crop[0] * iw, crop[1] * ih, (crop[2] - crop[0]) * iw, (crop[3] - crop[1]) * ih, 0, 0, tw, th);
    const d = x.getImageData(0, 0, tw, th).data;
    const t = new Float32Array(tw * th);
    for (let i = 0; i < t.length; i++) t[i] = 1 - (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    stretch(t, 0.01, 0.99);
    if (local > 0) {
        const big = blur(Float32Array.from(t), tw, th, Math.max(2, Math.round(tw / 9)), 2);
        for (let i = 0; i < t.length; i++) t[i] = t[i] + local * (t[i] - big[i]);
    }
    blur(t, tw, th, Math.max(1, Math.round(lineMapPx * 0.35)), 2);
    stretch(t, 0.005, 0.995);
    // Levels: everything lighter than lo is paper (hairlines), darker than
    // hi is solid ink; between, a gentle S so the mid tones keep shape.
    for (let i = 0; i < t.length; i++) {
        let v = clamp((t[i] - levels[0]) / (levels[1] - levels[0]));
        v = mix(v, v * v * (3 - 2 * v), 0.35);
        t[i] = gamma !== 1 ? Math.pow(v, gamma) : v;
    }
    const W = tw + 1, sat = new Float64Array(W * (th + 1));
    for (let y = 0; y < th; y++) {
        let row = 0;
        for (let px = 0; px < tw; px++) {
            row += t[y * tw + px];
            sat[(y + 1) * W + px + 1] = sat[y * W + px + 1] + row;
        }
    }
    return {
        tw, th,
        avg(x0, y0, x1, y1) {
            x0 = clamp(Math.round(x0), 0, tw); x1 = clamp(Math.round(x1), 0, tw);
            y0 = clamp(Math.round(y0), 0, th); y1 = clamp(Math.round(y1), 0, th);
            if (x1 <= x0) x1 = Math.min(tw, x0 + 1), x0 = x1 - 1;
            if (y1 <= y0) y1 = Math.min(th, y0 + 1), y0 = y1 - 1;
            const s = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
            return s / ((x1 - x0) * (y1 - y0));
        },
    };
}

export function pretextHalftone(root, opts = {}) {
    const src = root && root.querySelector('.ph-text');
    const stage = (root && root.querySelector('.ph-stage')) || root;
    const url = opts.src ?? (root && root.dataset.src);
    if (!root || !src || !url) return () => {};

    const ds = root.dataset;
    const num = (o, d, fb) => { const v = Number(o ?? d); return Number.isFinite(v) && (o ?? d) !== undefined && (o ?? d) !== '' ? v : fb; };
    const modeRaw = String(opts.morph ?? ds.morph ?? 'scroll');
    const mode = modeRaw === 'static' || modeRaw === 'view' ? modeRaw : 'scroll';
    const wantLines = num(opts.lines, ds.lines, 0);
    const fixedSize = num(opts.size, ds.size, 0);
    const family = opts.font ?? ds.font ?? null;
    const [wMin, wMax] = String(opts.weights ?? ds.weights ?? '100 900').split(/[\s,]+/).map(Number);
    const readW = num(opts.read, ds.read, 400);
    const gamma = num(opts.gamma, ds.gamma, 1);
    const local = num(opts.local, ds.local, 0.3);
    const opsz = num(opts.opsz, ds.opsz, 48);
    const gainEm = num(opts.gain, ds.gain, 0.18);
    const fadeTo = clamp(num(opts.fade, ds.fade, 0.34), 0.05, 1);
    const parseCrop = (v) => { const c = String(v || '').split(/[\s,]+/).map(Number); return c.length === 4 && c.every(Number.isFinite) ? c : null; };
    const cropWide = parseCrop(opts.crop ?? ds.crop) || [0, 0, 1, 1];
    const cropTall = parseCrop(opts.cropTall ?? ds.cropTall) || cropWide;
    const magnifyOpt = opts.magnify ?? ds.magnify ?? 'auto';
    let magnify = 1.6;
    const levels = String(opts.levels ?? ds.levels ?? '0.28 0.86').split(/[\s,]+/).map(Number);
    const lampSpec = opts.lamp ?? ds.lamp ?? 'auto';
    const duration = num(opts.duration, ds.duration, 2600);
    const focus = String(opts.focus ?? ds.focus ?? '0.5 0.42').split(/[\s,]+/).map(Number);
    root.classList.add('ph', `ph-${mode}`);

    let dead = false;
    const off = [];
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    const canvas = document.createElement('canvas');
    canvas.className = 'ph-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};

    let api, img, text = '', fam = 'serif', ink = '#141312', lampRGB = '255, 252, 243';
    // Geometry (CSS px). M is a margin around the block on the canvas (none).
    const M = 0;
    let bw = 0, bh = 0, dpr = 1, size = 9, L = 10;
    let words = [];
    const KW = Array.from({ length: STEPS }, (_, k) => wMin + (wMax - wMin) * k / (STEPS - 1));
    // Past the axis: "ink gain". Above wMax the virtual weight keeps going,
    // drawn as the black weight spread by a stroke (up to data-gain em), like
    // over-inked letterpress, so the darkest passages can reach a real black.
    const G = gainEm > 0 ? (wMax - wMin) * 0.5 : 0;
    // Below the axis: "ink fade". Under wMin the virtual weight keeps going
    // down as the hairline printed in a thinner ink (to data-fade of full),
    // so the highlights can go nearly to paper. Same hue, only lighter.
    const F = fadeTo < 1 ? (wMax - wMin) * 0.5 : 0;
    const VK = [
        ...(F ? [1, 0.75, 0.5, 0.25].map((e) => wMin - F * e) : []),
        ...KW,
        ...(G ? [0.25, 0.5, 0.75, 1].map((e) => wMax + G * e) : []),
    ];
    const NV = VK.length;
    const gainOf = (v) => (G ? clamp((v - wMax) / G) : 0);
    const alphaOf = (v) => (F && v < wMin ? mix(fadeTo, 1, clamp((v - (wMin - F)) / F)) : 1);
    // Coverage (ink per area) at each virtual weight, and its inverse as a LUT.
    let cov = VK.map((w) => w / 1000), invLUT = new Float32Array(257);

    // Type is drawn and measured at size x K and scaled down, so the optical
    // size axis sees a display size: true hairlines at 100, full black at 900.
    let K = 1;
    const fontAt = (w, s = size * K) => `${Math.round(clamp(w, wMin, wMax))} ${Math.round(s * 100) / 100}px ${fam}`;
    const vIndex = (v) => {
        let k = 0;
        while (k < NV - 2 && VK[k + 1] < v) k++;
        return [k, clamp((v - VK[k]) / (VK[k + 1] - VK[k]))];
    };
    const covAt = (v) => { const [k, f] = vIndex(v); return mix(cov[k], cov[k + 1], f); };
    const weightFor = (c) => {   // coverage -> virtual weight, through the LUT
        const f = clamp((c - cov[0]) / (cov[NV - 1] - cov[0])) * 256, k = Math.min(255, Math.floor(f));
        return mix(invLUT[k], invLUT[k + 1], f - k);
    };

    // How much ink each weight lays down: a sample line set at every weight
    // on a scratch canvas, its alpha summed over the line's box. The portrait
    // asks for darkness; this turns darkness into weight evenly, so the mid
    // tones are not crushed by the bolder half of the axis.
    function calibrate() {
        const s = size * K, sample = 'the painted face of a boy in wax';
        const c = document.createElement('canvas'), x = c.getContext('2d', { willReadFrequently: true });
        c.width = Math.ceil(s * 22); c.height = Math.ceil(s * LEADING);
        cov = VK.map((v) => {
            x.clearRect(0, 0, c.width, c.height);
            x.font = fontAt(v, s);
            x.textBaseline = 'alphabetic';
            x.fillStyle = x.strokeStyle = '#000';
            x.lineJoin = 'round';
            const y = c.height * 0.5 + s * 0.28;
            x.globalAlpha = alphaOf(v);
            x.fillText(sample, 0, y);
            x.globalAlpha = 1;
            const e = gainOf(v);
            if (e > 0) { x.lineWidth = e * gainEm * s; x.strokeText(sample, 0, y); }
            const tw = Math.min(c.width, Math.ceil(x.measureText(sample).width));
            const d = x.getImageData(0, 0, tw, c.height).data;
            let a = 0;
            for (let i = 3; i < d.length; i += 4) a += d[i];
            return a / 255 / (tw * c.height);
        });
        for (let k = 1; k < NV; k++) cov[k] = Math.max(cov[k], cov[k - 1] + 1e-5);
        for (let i = 0; i <= 256; i++) {
            const c0 = mix(cov[0], cov[NV - 1], i / 256);
            let k = 0;
            while (k < NV - 2 && cov[k + 1] < c0) k++;
            const f = clamp((c0 - cov[k]) / (cov[k + 1] - cov[k]));
            invLUT[i] = mix(VK[k], VK[k + 1], f);
        }
    }

    // ---- layout ---------------------------------------------------------------
    // Glyph advances at the nine weights, cached per character.
    let gcache = new Map();
    const mctx = document.createElement('canvas').getContext('2d');
    function glyph9(ch) {
        let v = gcache.get(ch);
        if (!v) {
            v = new Float32Array(STEPS);
            for (let k = 0; k < STEPS; k++) { mctx.font = fontAt(KW[k]); v[k] = mctx.measureText(ch).width / K; }
            gcache.set(ch, v);
        }
        return v;
    }
    const at9 = (arr9, w) => {
        const f = clamp((w - wMin) / (wMax - wMin)) * (STEPS - 1), k = Math.min(STEPS - 2, Math.floor(f));
        return mix(arr9[k], arr9[k + 1], f - k);
    };

    let tone = null, crop = [0, 0, 1, 1];
    function layout() {
        const cs = getComputedStyle(stage);
        const gx = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const gy = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const r = stage.getBoundingClientRect();
        const availW = Math.max(160, r.width - gx);
        const availH = Math.max(200, (mode === 'scroll' && !calm.matches ? r.height : Math.min(innerHeight, 1100)) - gy);
        // A tall stage (a phone) may use its own, taller crop of the picture.
        crop = availH / availW > 1.3 ? cropTall : cropWide;
        const aspect = ((crop[3] - crop[1]) * img.naturalHeight) / ((crop[2] - crop[0]) * img.naturalWidth);
        bw = Math.floor(Math.min(availW, availH / aspect));
        bh = Math.floor(bw * aspect);

        // Density: lines in the block. Fine enough grain for a face, big
        // enough to read under the lamp.
        if (fixedSize) size = fixedSize;
        // Default density: type of about 5.6px, at least 110 lines.
        else size = wantLines ? bh / (wantLines * LEADING) : Math.min(5.6, bh / (110 * LEADING));
        size = Math.round(clamp(size, 4, 40) * 100) / 100;
        L = size * LEADING;
        K = Math.max(1, opsz / size);
        const N = Math.floor(bh / L);
        const top = (bh - N * L) / 2;

        dpr = Math.min(3, devicePixelRatio || 1);
        if ((bw + 2 * M) * (bh + 2 * M) * dpr * dpr > 3.2e6) dpr = Math.min(dpr, 2);

        gcache = new Map();
        calibrate();
        const scale = 0.5;   // tone map at half a CSS px
        tone = toneMap(img, crop, Math.max(8, Math.round(bw * scale)), Math.max(8, Math.round(bh * scale)), L * scale, gamma, local, levels);

        // The text, repeated after an interpunct as often as the block needs.
        const perLine = bw / (size * 0.46);
        const copies = Math.max(1, Math.ceil((N * perLine * 1.25) / text.length));
        const body = copies > 1 ? Array(copies).fill(text).join(' · ') : text;
        const P = KW.map((w) => api.prepareWithSegments(body, fontAt(w)));
        const base = P[0], nSeg = base.widths.length;

        // Every segment's graphemes, their advances at the nine weights, and
        // a kerning factor so the glyph sum matches pretext's segment width.
        const seg = [];
        for (let i = 0; i < nSeg; i++) {
            const kind = base.kinds[i];
            if (kind === 'space' || kind === 'zero-width-break' || kind === 'soft-hyphen' || kind === 'hard-break') { seg.push(null); continue; }
            const gl = [...base.segments[i]];
            const g9 = gl.map(glyph9);
            const n9 = new Float32Array(STEPS);
            for (let k = 0; k < STEPS; k++) n9[k] = P[k].widths[i] / K;
            const sumR = g9.reduce((a, v) => a + at9(v, readW), 0);
            const kf = sumR > 0 ? at9(n9, readW) / sumR : 1;
            seg.push({ gl, g9, kf, wT: new Float32Array(gl.length).fill(readW) });
        }
        // A glyph's box: its advance at the wider of the reading weight and
        // its portrait weight. Boxes never change while the weights move.
        const gbox = (s, j) => s.kf * Math.max(at9(s.g9[j], readW), at9(s.g9[j], s.wT[j]));
        const spaceW = P.map((p) => (p.widths[base.kinds.indexOf('space')] || size * K * 0.25) / K);
        const sp = at9(spaceW, readW);
        const hybrid = {
            ...base,
            widths: new Array(nSeg), lineEndFitAdvances: new Array(nSeg), lineEndPaintAdvances: new Array(nSeg),
        };
        const fx = focus[0] * bw, fy = focus[1] * bh, fr = Math.hypot(Math.max(fx, bw - fx), Math.max(fy, bh - fy));

        let converged = false;
        for (let pass = 0; pass < 6; pass++) {
            const last = converged || pass === 5;
            // Measure every segment at its own weights, then let pretext break.
            for (let i = 0; i < nSeg; i++) {
                const s = seg[i];
                let wd = sp;
                if (s) { wd = 0; for (let j = 0; j < s.gl.length; j++) wd += gbox(s, j); }
                hybrid.widths[i] = wd;
                hybrid.lineEndFitAdvances[i] = base.lineEndFitAdvances[i] === 0 ? 0 : wd;
                hybrid.lineEndPaintAdvances[i] = base.lineEndPaintAdvances[i] === 0 ? 0 : wd;
            }
            const lines = [];
            let cursor = { segmentIndex: 0, graphemeIndex: 0 };
            for (let j = 0; j < N; j++) {
                const range = api.layoutNextLineRange(hybrid, cursor, bw);
                if (!range) break;
                lines.push(range);
                cursor = range.end;
            }
            // Words, their boxes and places; then the picture under each glyph.
            const next = [];
            let moved = 0;
            lines.forEach((range, li) => {
                const ws = [];
                let cur = null;
                const end = range.end.segmentIndex + (range.end.graphemeIndex > 0 ? 1 : 0);
                for (let i = range.start.segmentIndex; i < end; i++) {
                    if (!seg[i]) { cur = null; continue; }
                    if (!cur) { cur = { segs: [] }; ws.push(cur); }
                    cur.segs.push(i);
                }
                const boxes = ws.map((w) => w.segs.reduce((b, i) => { const s = seg[i]; for (let j = 0; j < s.gl.length; j++) b += gbox(s, j); return b; }, 0));
                const sum = boxes.reduce((a, b) => a + b, 0);
                const gaps = ws.length - 1;
                const gap = gaps ? (bw - sum) / gaps : 0;
                let x = gaps ? 0 : (bw - sum) / 2;
                const y0 = top + li * L;
                ws.forEach((w, wi) => {
                    const g = [];
                    let gx0 = x;
                    for (const i of w.segs) {
                        const s = seg[i];
                        for (let j = 0; j < s.gl.length; j++) {
                            const b = gbox(s, j);
                            // The cell a glyph owns: its box (the first and last
                            // reach half into the gaps) and the line's band.
                            const t = tone.avg(gx0 * scale, y0 * scale, (gx0 + b) * scale, (y0 + L) * scale);
                            let cT = mix(cov[0], cov[NV - 1], t);
                            let wT = weightFor(cT);
                            if (Math.abs(s.wT[j] - wT) > 30) moved++;
                            // Last pass: never heavier than the box was measured for.
                            const cap = Math.max(readW, s.wT[j]);
                            if (last && wT > cap) { wT = cap; cT = covAt(cap); }
                            s.wT[j] = wT;
                            g.push({ ch: s.gl[j], g9: s.g9[j], kf: s.kf, b, cT, wT });
                            gx0 += b;
                        }
                    }
                    next.push({ g, x, box: boxes[wi], y: y0 + L * 0.5 + size * 0.3, line: li, t: g.map((q) => q.ch).join('') });
                    x += boxes[wi] + gap;
                });
            });
            words = next;
            if (last) break;
            if (pass > 0 && moved === 0) converged = true;
        }

        // Per word: its centre and its place in the stagger (from the focus
        // outward, a little shuffled).
        const cR = covAt(readW);
        words.forEach((w, i) => {
            w.cx = w.x + w.box / 2; w.cy = w.y - size * 0.3;
            const d = Math.hypot(w.cx - fx, (w.cy - fy) * 1.15) / fr;
            w.delay = clamp(d * 0.8 + hash(i) * 0.2);
            for (const q of w.g) q.cR = cR;
        });

        const CW = Math.round((bw + 2 * M) * dpr), CH = Math.round((bh + 2 * M) * dpr);
        canvas.width = CW; canvas.height = CH;
        canvas.style.width = bw + 2 * M + 'px';
        canvas.style.height = bh + 2 * M + 'px';
        lamp.R = lampSpec === 'auto' ? clamp(bw * 0.32, 96, 200) : Number(lampSpec) || 110;
        magnify = magnifyOpt === 'auto' ? clamp(11 / size, 1.25, 2.6) : Math.max(1, Number(magnifyOpt) || 1);
        full = true;
    }
    // ---- drawing --------------------------------------------------------------
    const lamp = { x: 0, y: 0, tx: 0, ty: 0, s: 0, ts: 0, R: 110, px: 0, py: 0, ps: 0 };
    let P = 0;              // morph progress 0 (paragraph) .. 1 (portrait)
    let full = true;        // the next draw repaints everything

    // The word's morph (staggered) and the lamp's pull at its centre.
    function stateOf(w) {
        const m = P >= 1 ? 1 : smooth(0, 1, (P - w.delay * 0.55) / 0.45);
        let l = 0;
        if (lamp.s > 0.001) {
            const d = Math.hypot(w.cx - lamp.x, w.cy - lamp.y);
            if (d < lamp.R * 1.15) l = lamp.s * (1 - smooth(lamp.R * 0.55, lamp.R * 1.15, d));
        }
        return m * (1 - l);
    }

    const buckets = new Map();
    function draw(rect) {
        ctx.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
        // Snap a partial repaint to whole device pixels, so its clip edge is
        // never antialiased (a soft clip edge would leave a faint seam).
        if (rect) rect = [Math.floor(rect[0] * dpr) / dpr, Math.floor(rect[1] * dpr) / dpr, Math.ceil(rect[2] * dpr) / dpr, Math.ceil(rect[3] * dpr) / dpr];
        if (rect) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
            ctx.clip();
            ctx.clearRect(rect[0], rect[1], rect[2] - rect[0], rect[3] - rect[1]);
        } else ctx.clearRect(-M, -M, bw + 2 * M, bh + 2 * M);

        // The lamp's light on the paper: a soft warm pool under the words.
        if (lamp.s > 0.004) {
            const g = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, lamp.R * 1.15);
            g.addColorStop(0, `rgba(${lampRGB}, ${0.85 * lamp.s})`);
            g.addColorStop(0.55, `rgba(${lampRGB}, ${0.4 * lamp.s})`);
            g.addColorStop(1, `rgba(${lampRGB}, 0)`);
            ctx.fillStyle = g;
            ctx.fillRect(lamp.x - lamp.R * 1.2, lamp.y - lamp.R * 1.2, lamp.R * 2.4, lamp.R * 2.4);
        }

        // Each glyph's weight, then its place: the word is tracked evenly so
        // its glyphs fill the word's fixed box.
        buckets.clear();
        const y0 = rect ? rect[1] - L : -1e9, y1 = rect ? rect[3] + L : 1e9;
        const x0 = rect ? rect[0] - size : -1e9, x1 = rect ? rect[2] + size : 1e9;
        for (const w of words) {
            if (w.y < y0 || w.y > y1 || w.x > x1 || w.x + w.box < x0) continue;
            const m = stateOf(w);
            const n = w.g.length;
            let sum = 0;
            for (let j = 0; j < n; j++) {
                const q = w.g[j];
                const wt = Math.round(weightFor(mix(q.cR, q.cT, m)) / 6) * 6;
                q.wd = wt;
                q.a = q.kf * at9(q.g9, wt);
                sum += q.a;
            }
            // Spare room goes to a whisper of letter-spacing; anything beyond
            // that sits either side of the word, as a slightly wider space.
            const slack = w.box - sum;
            const tr = n > 1 ? clamp(slack / (n - 1), 0, size * 0.045) : 0;
            let x = w.x + (slack - tr * (n - 1)) / 2;
            for (let j = 0; j < n; j++) {
                const q = w.g[j];
                let b = buckets.get(q.wd);
                if (!b) buckets.set(q.wd, (b = []));
                b.push(q.ch, x, w.y);
                x += q.a + tr;
            }
        }
        ctx.fillStyle = ink;
        ctx.textBaseline = 'alphabetic';
        ctx.setTransform(dpr / K, 0, 0, dpr / K, M * dpr, M * dpr);
        ctx.strokeStyle = ink;
        ctx.lineJoin = 'round';
        for (const [wt, list] of buckets) {
            ctx.font = fontAt(wt);
            const e = gainOf(wt);
            if (e > 0) ctx.lineWidth = e * gainEm * size * K;
            ctx.globalAlpha = alphaOf(wt);
            for (let i = 0; i < list.length; i += 3) {
                ctx.fillText(list[i], list[i + 1] * K, list[i + 2] * K);
                if (e > 0) ctx.strokeText(list[i], list[i + 1] * K, list[i + 2] * K);
            }
        }
        ctx.globalAlpha = 1;
        if (lamp.s > 0.01 && magnify > 1.01) lens();
        if (rect) ctx.restore();
    }

    // The reading glass in the lamp: the words at its heart, at the reading
    // weight, magnified so even phone-sized type can be read, and cross-faded
    // into the page through a soft round edge (so it reads as light and a
    // lens, not a cut-out disc).
    const lensL = document.createElement('canvas');
    function lens() {
        const Mg = mix(1, magnify, lamp.s), Rl = lamp.R * 0.62, half = Math.ceil(Rl * dpr);
        if (lensL.width !== half * 2) { lensL.width = lensL.height = half * 2; }
        const x = lensL.getContext('2d');
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(0, 0, half * 2, half * 2);
        // paper light under the magnified words, so the page beneath is hidden
        x.fillStyle = `rgb(${lampRGB})`;
        x.fillRect(0, 0, half * 2, half * 2);
        const k = (dpr * Mg) / K;
        x.setTransform(k, 0, 0, k, half - lamp.x * dpr * Mg, half - lamp.y * dpr * Mg);
        x.fillStyle = ink;
        x.textBaseline = 'alphabetic';
        x.font = fontAt(readW);
        const reach = Rl / Mg + size * 2;
        for (const w of words) {
            if (Math.abs(w.cy - lamp.y) > reach || w.x > lamp.x + reach || w.x + w.box < lamp.x - reach) continue;
            let sum = 0;
            for (const q of w.g) sum += q.kf * at9(q.g9, readW);
            const n = w.g.length, slack = w.box - sum;
            const tr = n > 1 ? clamp(slack / (n - 1), 0, size * 0.045) : 0;
            let gx = w.x + (slack - tr * (n - 1)) / 2;
            for (const q of w.g) {
                x.fillText(q.ch, gx * K, w.y * K);
                gx += q.kf * at9(q.g9, readW) + tr;
            }
        }
        // soft round edge
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.globalCompositeOperation = 'destination-in';
        const g = x.createRadialGradient(half, half, 0, half, half, half);
        g.addColorStop(0, 'rgba(0,0,0,1)');
        g.addColorStop(0.8, 'rgba(0,0,0,1)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g;
        x.fillRect(0, 0, half * 2, half * 2);
        x.globalCompositeOperation = 'source-over';
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = clamp(lamp.s * 1.4);
        ctx.drawImage(lensL, Math.round((lamp.x + M) * dpr) - half, Math.round((lamp.y + M) * dpr) - half);
        ctx.globalAlpha = 1;
    }

    // ---- motion ---------------------------------------------------------------
    let visible = false, raf = 0, last = 0;
    const spring = { v: 0 };
    let viewStart = 0;
    function target() {
        if (calm.matches || mode === 'static') return 1;
        if (mode === 'view') return viewStart ? clamp((performance.now() - viewStart) / duration) : 0;
        const r = root.getBoundingClientRect();
        const run = r.height - innerHeight;
        const p = run > 0 ? clamp(-r.top / run) : 1;
        return smooth(0.04, 0.72, p);
    }

    function frame(now) {
        raf = 0;
        if (dead) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const still = calm.matches;
        let alive = false;

        // The morph follows the scroll on a critically damped spring.
        const T = target();
        const P0 = P;
        if (still || mode === 'view') { P = T; spring.v = 0; if (mode === 'view' && T < 1 && viewStart) alive = true; }
        else {
            const K = 18, D = 2 * Math.sqrt(K);
            spring.v += (K * (T - P) - D * spring.v) * dt;
            P += spring.v * dt;
            if (Math.abs(T - P) > 0.0008 || Math.abs(spring.v) > 0.0008) alive = true;
            else { P = T; spring.v = 0; }
        }
        P = clamp(P, 0, 1);

        // The lamp trails the pointer a touch; it brightens fast and dims slowly.
        const f = still ? 1 : 1 - Math.exp(-dt / 0.08);
        lamp.x += (lamp.tx - lamp.x) * f;
        lamp.y += (lamp.ty - lamp.y) * f;
        lamp.s += (lamp.ts - lamp.s) * (still ? 1 : 1 - Math.exp(-dt / (lamp.ts > lamp.s ? 0.18 : 0.6)));
        if (Math.abs(lamp.tx - lamp.x) + Math.abs(lamp.ty - lamp.y) > 0.25 || Math.abs(lamp.ts - lamp.s) > 0.003) alive = true;
        else { lamp.x = lamp.tx; lamp.y = lamp.ty; lamp.s = lamp.ts; }

        const morphing = Math.abs(P - P0) > 1e-5;
        if (full || morphing) { draw(null); full = false; }
        else if (lamp.s !== lamp.ps || lamp.x !== lamp.px || lamp.y !== lamp.py) {
            // Only the lamp moved: repaint the square around where it was and is.
            const R = lamp.R * 1.25;
            draw([Math.min(lamp.x, lamp.px) - R, Math.min(lamp.y, lamp.py) - R, Math.max(lamp.x, lamp.px) + R, Math.max(lamp.y, lamp.py) + R]);
        }
        lamp.px = lamp.x; lamp.py = lamp.y; lamp.ps = lamp.s;

        if (alive && (visible || still)) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    const kick = () => { if (!raf && !dead && words.length) raf = requestAnimationFrame(frame); };

    // ---- input ------------------------------------------------------------------
    // Mouse: the lamp follows the pointer. Touch: a touch lights the lamp
    // under the finger; sideways slides carry it, vertical drags scroll the
    // page as usual. Hold still for a moment first and the lamp is yours:
    // the finger carries it anywhere and the page stays put until you lift.
    let carry = false, holdTimer = 0, downAt = null, linger = 0;
    function point(e, show) {
        const r = canvas.getBoundingClientRect();
        lamp.tx = e.clientX - r.left - M;
        lamp.ty = e.clientY - r.top - M;
        // A finger would cover the glass: hold it a little above the touch.
        if (e.pointerType !== 'mouse') lamp.ty -= lamp.R * 0.55;
        if (lamp.s < 0.02) { lamp.x = lamp.tx; lamp.y = lamp.ty; }
        const pad = lamp.R * 0.4;
        const inside = lamp.tx > -pad && lamp.tx < bw + pad && lamp.ty > -pad && lamp.ty < bh + pad;
        lamp.ts = show && inside ? 1 : 0;
        clearTimeout(linger);
        kick();
    }
    const dim = (after) => { clearTimeout(linger); linger = setTimeout(() => { lamp.ts = 0; kick(); }, after); };
    on(canvas, 'pointermove', (e) => {
        if (e.pointerType === 'mouse') return point(e, true);
        if (downAt && !carry && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 8) clearTimeout(holdTimer);
        point(e, true);
    });
    on(canvas, 'pointerdown', (e) => {
        point(e, true);
        if (e.pointerType === 'mouse') return;
        downAt = [e.clientX, e.clientY];
        carry = false;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { carry = true; root.classList.add('is-carrying'); }, 280);
    });
    // While carrying, the page does not scroll under the finger.
    on(canvas, 'touchmove', (e) => { if (carry && e.cancelable) e.preventDefault(); }, { passive: false });
    const up = (e) => {
        clearTimeout(holdTimer);
        downAt = null;
        if (carry) { carry = false; root.classList.remove('is-carrying'); }
        if (e.pointerType === 'mouse') { if (e.type === 'pointerleave') { lamp.ts = 0; kick(); } return; }
        dim(e.type === 'pointercancel' ? 900 : 1400);   // the lamp lingers, then dims
    };
    on(canvas, 'pointerleave', up);
    on(canvas, 'pointerup', up);
    on(canvas, 'pointercancel', up);
    on(canvas, 'contextmenu', (e) => { if (carry || downAt) e.preventDefault(); });

    // ---- start ------------------------------------------------------------------
    (async () => {
        try {
            api = await import(LIB);
            img = await loadImage(new URL(url, document.baseURI).href);
            const cs = getComputedStyle(src);
            fam = family || cs.fontFamily;
            ink = cs.color;
            const lv = getComputedStyle(root).getPropertyValue('--ph-lamp').trim();
            if (lv) lampRGB = lv;
            text = src.textContent.replace(/\s+/g, ' ').trim();
            try {
                await Promise.all([wMin, readW, wMax].map((w) => document.fonts.load(`${Math.round(w)} 16px ${fam}`)));
                await document.fonts.ready;
            } catch (e) { /* measure what we have */ }
            if (dead || !text) return;
            stage.appendChild(canvas);
            root.classList.add('is-live');
            layout();
        } catch (e) {
            canvas.remove();
            root.classList.remove('is-live');
            return;
        }
        P = target() >= 1 && (calm.matches || mode === 'static') ? 1 : (mode === 'scroll' ? target() : 0);
        draw(null); full = false;

        const io = new IntersectionObserver((en) => {
            for (const e of en) {
                visible = e.isIntersecting;
                if (mode === 'view' && !viewStart && e.intersectionRatio >= 0.35) viewStart = performance.now();
            }
            if (visible) kick();
        }, { rootMargin: '60px', threshold: [0, 0.35] });
        io.observe(root);
        off.push(() => io.disconnect());
        on(window, 'scroll', () => { if (visible) kick(); }, { passive: true });
        let timer = 0, lastW = -1, lastH = innerHeight;
        const ro = new ResizeObserver((en) => {
            const w = Math.round(en[0].contentRect.width);
            if (lastW < 0) { lastW = w; return; }
            if (w === lastW && Math.abs(innerHeight - lastH) < 140) return;
            lastW = w; lastH = innerHeight;
            clearTimeout(timer);
            timer = setTimeout(() => { if (!dead) { layout(); kick(); } }, 140);
        });
        ro.observe(stage);
        off.push(() => { ro.disconnect(); clearTimeout(timer); clearTimeout(holdTimer); clearTimeout(linger); });
        on(calm, 'change', () => { full = true; kick(); });
    })();

    return function destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        off.forEach((f) => f());
        canvas.remove();
        root.classList.remove('ph', 'is-live', 'is-carrying', `ph-${mode}`);
    };
}

// Auto-start every [data-pretext-halftone] once it is near the viewport.
document.querySelectorAll('[data-pretext-halftone]').forEach((el) => {
    if (!('IntersectionObserver' in window)) return pretextHalftone(el);
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        pretextHalftone(el);
    }, { rootMargin: '800px' });
    io.observe(el);
});
