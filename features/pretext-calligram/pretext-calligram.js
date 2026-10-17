/*
 *  PRETEXT-CALLIGRAM // a paragraph poured into a vessel.
 *
 *  Markup:  <section data-pretext-calligram data-src="assets/amphora.webp">
 *             <div class="pc-stage">
 *               <p class="pc-text">The paragraph.</p>
 *             </div>
 *           </section>
 *  data-src is a transparent cut-out (PNG/WebP, same origin): its alpha
 *  channel is the vessel, its picture fills the type. Or call
 *  pretextCalligram(element, { src, fill, minRun, lines, size }) yourself;
 *  it returns destroy().
 *
 *  Options (data attributes, all optional):
 *    data-fill="scroll"     scroll: a tall runway, the colour rises as you go.
 *                           static: no runway, the vessel is shown painted.
 *    data-lines="60"        at least this many lines (fine grain draws the
 *                           shape); the text loops on the canvas if short.
 *    data-size="11"         or a fixed font size in px.
 *    data-font, data-weight, data-tracking (em)   canvas-only type: heavy
 *                           strokes carry the picture like a halftone.
 *    data-ghost="0.08"      the photo, faint, behind the painted letters.
 *    data-min-run="1.6em"   narrowest run worth a line (em of the size, or
 *                           px). Thinner parts are stippled with small dots.
 *
 *  Inspired by Cheng Lou's pretext (vendor/pretext, MIT). For every line the
 *  silhouette is scanned at that height: one run across the belly, two where
 *  a handle cuts the row, none at a narrow foot. pretext's layoutNextLineRange
 *  fills each run in reading order, by arithmetic over cached glyph widths,
 *  so the whole paragraph can be re-poured at a dozen trial sizes in a frame:
 *  a binary search finds the largest size whose text fits, and data-lines
 *  sets the density from there.
 *  Lines are justified by spreading the slack between words (the last line
 *  sits centred), so the edges of the words are the edge of the pot.
 *
 *  The words start in ink (the <p>'s own colour; a soft grey ink makes the
 *  colour's arrival read best on dark-glazed pots). As you scroll, colour rises from the foot like
 *  liquid, with a soft wavy meniscus that sloshes when you scroll fast and
 *  settles when you stop. Below the surface the letters are a mask and the
 *  photograph is poured through them, so the painted figures and brushwork
 *  appear inside the type. A pointer (or a finger) brings the picture into
 *  the letters around it and shows the photograph faintly between them.
 *
 *  The real <p> stays in the DOM (screen readers, selection, ctrl+F, no-JS).
 *  Reduced motion: the vessel already painted, still.
 */

const LIB = './vendor/pretext/layout.js';
const REF = 100;            // pretext measures once at 100px; other sizes scale
const LEADING = 1.08;       // line height, x font size: tight, so many lines draw the shape
const ALPHA = 150;          // alpha (0-255) above which a mask pixel is vessel

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// The picture that fills the type, lifted so it reads in thin strokes on
// paper: a gentle S-curve on lightness, highlights eased down toward a
// ceiling (white porcelain stays a pale tint instead of vanishing into the
// page), and saturation raised. One pass over the pixels per layout.
function lifted(img, w, h, dpr) {
    const c = document.createElement('canvas');
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    const im = x.getImageData(0, 0, c.width, c.height), d = im.data;
    const lut = new Float32Array(256), ceil = 0.7, knee = 0.48;
    for (let i = 0; i < 256; i++) {
        let t = i / 255;
        t = mix(t, t * t * (3 - 2 * t), 0.35);
        if (t > knee) t = knee + (ceil - knee) * (1 - Math.exp(-(t - knee) / (ceil - knee)));
        lut[i] = t * 255;
    }
    // Black glaze is lifted to a warm charcoal (#2a2420), so painted black
    // never reads as the plain ink above the surface.
    const sat = 1.3, F = [42, 36, 32], fk = F.map((f) => 1 - f / 255);
    for (let i = 0; i < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const Y2 = lut[Y | 0], k = Y2 / Math.max(1, Y);
        d[i] = F[0] + clamp(Y2 + (r * k - Y2) * sat, 0, 255) * fk[0];
        d[i + 1] = F[1] + clamp(Y2 + (g * k - Y2) * sat, 0, 255) * fk[1];
        d[i + 2] = F[2] + clamp(Y2 + (b * k - Y2) * sat, 0, 255) * fk[2];
    }
    x.putImageData(im, 0, 0);
    return c;
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

export function pretextCalligram(root, opts = {}) {
    const src = root && root.querySelector('.pc-text');
    const stage = (root && root.querySelector('.pc-stage')) || root;
    const url = opts.src ?? (root && root.dataset.src);
    if (!root || !src || !url) return () => {};

    const fill = (opts.fill ?? root.dataset.fill ?? 'scroll') === 'static' ? 'static' : 'scroll';
    const minRunSpec = String(opts.minRun ?? root.dataset.minRun ?? '1.6em');
    const wantLines = Number(opts.lines ?? root.dataset.lines ?? 0) || 0;
    const fixedSize = Number(opts.size ?? root.dataset.size ?? 0) || 0;
    const weight = opts.weight ?? root.dataset.weight ?? null;
    const family = opts.font ?? root.dataset.font ?? null;
    const tracking = Number(opts.tracking ?? root.dataset.tracking ?? 0) || 0;
    const ghost = clamp(Number(opts.ghost ?? root.dataset.ghost ?? 0) || 0);
    root.classList.add('pc', fill === 'static' ? 'pc-static' : 'pc-scroll');

    let dead = false;
    const off = [];             // teardown callbacks
    const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); off.push(() => t.removeEventListener(ev, fn, o)); };

    const canvas = document.createElement('canvas');
    canvas.className = 'pc-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => {};
    const layer = () => document.createElement('canvas');
    const inkL = layer(), paintL = layer(), maskL = layer(), tmpL = layer(), bandL = layer();
    let photoL = layer();

    let api, img, text = '';
    let font = { style: 'normal', weight: '400', family: 'serif' };
    let inkColour = '#141312';
    let repeats = false;

    // Geometry, in CSS px. The canvas is the vessel's box plus a margin M.
    const M = 10;
    let vw = 0, vh = 0, dpr = 1, size = 16, lh = 18;
    let textTop = 0, textBottom = 0;

    // Motion state.
    let visible = false, raf = 0, last = 0, t0 = 0;
    const liq = { y: 0, v: 0, amp: 0, phase: 0, ready: false };
    const lens = { x: 0, y: 0, tx: 0, ty: 0, s: 0, ts: 0, R: 120 };

    // Narrowest run worth a line at font size s: "3em" scales with the type,
    // "40" or "40px" is fixed.
    const minRunAt = (s) => {
        const v = parseFloat(minRunSpec) || 3;
        return /em\s*$/.test(minRunSpec) ? v * s : v;
    };

    // ---- the vessel ---------------------------------------------------------
    // The cut-out scaled to the box at 1 px per CSS px: RGBA for the paint and,
    // per pixel, how many vessel pixels run straight down from it. A column is
    // inside a band of rows when its run downward is at least the band's height,
    // which makes each line's scan O(width).
    let maskW = 0, maskH = 0, rgba = null, down = null;
    function readVessel() {
        maskW = Math.max(1, Math.round(vw));
        maskH = Math.max(1, Math.round(vh));
        const c = layer();
        c.width = maskW; c.height = maskH;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0, maskW, maskH);
        rgba = x.getImageData(0, 0, maskW, maskH).data;
        down = new Uint16Array(maskW * maskH);
        for (let y = maskH - 1; y >= 0; y--) {
            for (let px = 0; px < maskW; px++) {
                const i = y * maskW + px;
                down[i] = rgba[i * 4 + 3] > ALPHA ? (y + 1 < maskH ? down[i + maskW] : 0) + 1 : 0;
            }
        }
    }

    // Horizontal runs of vessel across the band [y0, y1), inset by `pad`.
    function runsAt(y0, y1, pad, least) {
        const a0 = Math.max(0, Math.floor(y0)), need = Math.ceil(y1) - a0;
        if (a0 >= maskH || a0 + need > maskH) return [];
        const row = a0 * maskW, out = [];
        let start = -1;
        for (let px = 0; px <= maskW; px++) {
            const inside = px < maskW && down[row + px] >= need;
            if (inside && start < 0) start = px;
            else if (!inside && start >= 0) {
                const a = start + pad, b = px - pad;
                if (b - a >= least) out.push([a, b]);
                start = -1;
            }
        }
        return out;
    }

    // ---- pouring -----------------------------------------------------------
    // Fill the shape with the paragraph at font size s. Returns the placed
    // line ranges and whether the whole text fitted.
    // With `spare`, also collects the runs no words went into (handles,
    // a narrow rim, the foot below the last line).
    function pour(P, s, spare, loop) {
        const L = Math.round(s * LEADING * 100) / 100;
        const k = REF / s, least = minRunAt(s), pad = s * 0.08;
        let cursor = { segmentIndex: 0, graphemeIndex: 0 }, done = false;
        const lines = [], empty = [];
        for (let top = 0; top + L <= maskH; top += L) {
            const base = top + L * 0.5 + s * 0.3;
            for (const [a, b] of runsAt(base - s * 0.7, base + s * 0.1, pad, spare ? s * 0.3 : least)) {
                if (!done && b - a >= least) {
                    const range = api.layoutNextLineRange(P, cursor, (b - a) * k);
                    if (range === null) done = true;
                    // A word too long for this run would be split mid-word;
                    // leave the run to the ornament instead.
                    else if (!(range.end.graphemeIndex > 0 && range.end.segmentIndex === cursor.segmentIndex)) {
                        lines.push({ range, a, b, base });
                        cursor = range.end;
                        continue;
                    }
                }
                if (spare) empty.push({ a, b, base });
                else if (done) return { lines, done, L };
            }
        }
        done = done || loop || api.layoutNextLineRange(P, cursor, 1e9) === null;
        return { lines, done, L, empty };
    }

    let words = [];
    function layout() {
        const cs = getComputedStyle(stage);
        const gx = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const gy = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        const r = stage.getBoundingClientRect();
        const availW = Math.max(120, r.width - gx);
        const availH = Math.max(160, (fill === 'scroll' ? r.height : Math.min(innerHeight, 1100)) - gy);
        const aspect = img.naturalHeight / img.naturalWidth;
        vw = Math.floor(Math.min(availW, availH / aspect));
        vh = Math.floor(vw * aspect);
        // Up to 3x on a phone so 9px type stays crisp; 2x when the box is big.
        dpr = Math.min(3, devicePixelRatio || 1);
        if ((vw + 2 * M) * (vh + 2 * M) * dpr * dpr > 2.8e6) dpr = Math.min(dpr, 2);
        readVessel();

        // Largest size whose text fits the shape. pretext's widths are linear
        // in font size, so one prepare at REF px serves every trial.
        const spec = (s) => `${font.style} ${font.weight} ${s}px ${font.family}`;
        const ls = { letterSpacing: tracking * REF };
        const P = api.prepareWithSegments(text, spec(REF), ls);
        size = 16;
        let lo = 4, hi = Math.min(64, vw / 6);
        for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2;
            size = mid;
            pour(P, mid).done ? (lo = mid) : (hi = mid);
        }
        size = Math.floor(lo * 20) / 20;
        // data-size fixes the size; data-lines caps it so the shape gets at
        // least that many lines (vh / lines is the pitch). Either can ask for
        // more lines than the text fills, and then the text begins again.
        let target = size;
        if (fixedSize) target = fixedSize;
        else if (wantLines) target = Math.min(size, vh / (wantLines * LEADING));
        const fit = size;
        repeats = target < fit - 0.01;
        size = Math.max(4, target);
        // Looping text: the paragraph again after an interpunct, as many times
        // as the shape needs (the real <p> is unchanged).
        let Q = P;
        if (repeats) {
            const copies = Math.ceil(Math.pow(fit / size, 2) * 1.3) + 1;
            Q = api.prepareWithSegments(Array(copies).fill(text).join(' \u00b7 '), spec(REF), ls);
        }
        let res = pour(Q, size, true, repeats);
        while (!res.done && size > 4) { size -= 0.25; res = pour(Q, size, true, repeats); }
        lh = res.L;

        // Justify. Each line's slack goes first to its word gaps (up to about
        // two spaces), then a little to letter-spacing, then back to the gaps,
        // so the edges of the words land exactly on the edge of the run. A
        // lone word is tracked out a touch and centred; the last line sits
        // centred and ragged.
        ctx.font = spec(size);
        // Width of a word with letter-spacing tr (px). Canvas letterSpacing
        // also turns ligatures off, so a tracked word is measured tracked;
        // the spacing after the last glyph is not part of the word.
        const LS = 'letterSpacing' in ctx;
        const meas = (w, tr = 0) => {
            if (!tr || !LS) return ctx.measureText(w).width + (tr ? tr * ([...w].length - 1) : 0);
            ctx.letterSpacing = tr + 'px';
            const v = ctx.measureText(w).width - tr;
            ctx.letterSpacing = '0px';
            return v;
        };
        const space = meas(' ');
        words = [];
        const N = res.lines.length;
        const glyphs = (w) => [...w];
        res.lines.forEach((ln, li) => {
            const t = api.materializeLineRange(Q, ln.range).text.trim();
            if (!t) return;
            const parts = t.split(/\s+/);
            const base = tracking * size;      // data-tracking, in em
            const ws = parts.map((w) => meas(w, base));
            const chars = parts.reduce((n, w) => n + glyphs(w).length - 1, 0);
            const sum = ws.reduce((a, b) => a + b, 0);
            const run = ln.b - ln.a, gaps = parts.length - 1;
            let gap = space, track = 0, x = ln.a;
            if (li === N - 1 && !repeats) {
                x = ln.a + (run - sum - gap * gaps) / 2;
            } else if (!gaps) {
                track = chars ? clamp((run - sum) / chars, 0, size * 0.06) : 0;
                x = ln.a + (run - sum - track * chars) / 2;
            } else {
                let slack = run - sum - space * gaps;
                if (slack <= 0) gap = (run - sum) / gaps;
                else {
                    const g = Math.min(slack, space * 1.4 * gaps);
                    slack -= g;
                    track = chars ? Math.min(slack / chars, size * (gaps <= 2 ? 0.04 : 0.025)) : 0;
                    slack -= track * chars;
                    gap = space + (g + slack) / gaps;
                }
            }
            // Re-measure at the final tracking and give the residue to the
            // gaps, so a justified line still ends exactly on its run.
            const tr = track + base;
            const fw = parts.map((w) => meas(w, tr));
            if (gaps && !(li === N - 1 && !repeats)) gap = (run - fw.reduce((a, b) => a + b, 0)) / gaps;
            else if (!gaps) x = ln.a + (run - fw[0]) / 2;
            parts.forEach((w, wi) => {
                const gl = glyphs(w);
                // Tracked words use canvas letterSpacing where it exists; the
                // fallback sets glyphs one by one on their own advances (no
                // prefix measuring: a ligature like Th would overlap the next).
                let at = null;
                if (tr && !LS) {
                    let p = 0;
                    at = gl.map((g, i) => { const v = p + i * tr; p += meas(g); return v; });
                }
                const width = fw[wi];
                words.push({ t: w, gl, at, track: tr, x, y: ln.base, w: width });
                x += width + gap;
            });
        });
        // Where no line could go (handles, a thin rim, the foot) the vessel
        // is stippled with small dots on a staggered grid, like the
        // interpuncts Greek inscriptions set between words, so the silhouette
        // stays whole. Decoration only: the real <p> never contains them.
        const cover = new Uint8Array(maskW * maskH);
        const block = (x0, x1, y0, y1) => {
            for (let y = Math.max(0, y0 | 0); y < Math.min(maskH, Math.ceil(y1)); y++)
                cover.fill(1, y * maskW + Math.max(0, x0 | 0), y * maskW + Math.min(maskW, Math.ceil(x1)));
        };
        // Dots go only into the runs no words took, never beside a line.
        const allow = new Uint8Array(maskW * maskH);
        for (const r of res.empty) {
            for (let y = Math.max(0, (r.base - size * 0.85) | 0); y < Math.min(maskH, Math.ceil(r.base + size * 0.3)); y++)
                allow.fill(1, y * maskW + Math.max(0, r.a | 0), y * maskW + Math.min(maskW, Math.ceil(r.b)));
        }
        const gapX = size * 0.6, gapY = size * 0.25;
        for (const ln of res.lines) block(ln.a - gapX, ln.b + gapX, ln.base - size * 0.78 - gapY, ln.base + size * 0.22 + gapY);
        const pitch = size * 0.44, rowH = pitch * 0.866, inset = size * 0.12, dots = [];
        for (let j = 0, y = rowH / 2; y < maskH; j++, y += rowH) {
            for (let x = (j % 2 ? pitch : pitch / 2); x < maskW; x += pitch) {
                const xi = x | 0, yi = y | 0;
                if (cover[yi * maskW + xi] || !allow[yi * maskW + xi]) continue;
                // solid vessel all round the dot, not just under its centre
                const yt = Math.max(0, (y - inset) | 0);
                if (down[yt * maskW + xi] < inset * 2) continue;
                if (down[yt * maskW + Math.max(0, (x - inset) | 0)] < inset * 2) continue;
                if (down[yt * maskW + Math.min(maskW - 1, (x + inset) | 0)] < inset * 2) continue;
                dots.push({ dot: size * 0.075, x: x - 1, y, w: 2, orn: true });
            }
        }
        // a lone dot at the end of a line is noise, not outline
        const near = pitch * 1.2;
        for (const d of dots) if (dots.some((e) => e !== d && Math.abs(e.x - d.x) < near && Math.abs(e.y - d.y) < near)) words.push(d);
        textTop = words.reduce((m, w) => Math.min(m, w.y - size), vh);
        textBottom = words.reduce((m, w) => Math.max(m, w.y + size * 0.2), 0);

        // Static layers, drawn once per layout: the words in ink, the picture
        // itself (lifted) on the vessel's box, and the picture seen through
        // the words: the glyphs are a mask and the artwork is poured in
        // (source-in), so the figures and the brushwork appear in the type.
        const CW = Math.round((vw + 2 * M) * dpr), CH = Math.round((vh + 2 * M) * dpr);
        for (const c of [canvas, inkL, paintL, tmpL]) { c.width = CW; c.height = CH; }
        // The liquid mask is drawn small and scaled up: the upscale's
        // smoothing is the soft edge, and no blur runs per frame.
        maskK = Math.max(4, Math.round(lh * dpr * 0.45));
        maskL.width = Math.ceil(CW / maskK) + 1; maskL.height = Math.ceil(CH / maskK) + 1;
        canvas.style.width = vw + 2 * M + 'px';
        canvas.style.height = vh + 2 * M + 'px';
        const draw = (c, colour) => {
            const x = c.getContext('2d');
            x.setTransform(dpr, 0, 0, dpr, M * dpr, M * dpr);
            x.font = spec(size);
            x.textBaseline = 'alphabetic';
            for (const wd of words) {
                x.fillStyle = colour;
                if (wd.dot) { x.beginPath(); x.arc(wd.x + 1, wd.y, wd.dot, 0, Math.PI * 2); x.fill(); }
                else if (wd.track && !wd.at) {
                    x.letterSpacing = wd.track + 'px';
                    x.fillText(wd.t, wd.x, wd.y);
                    x.letterSpacing = '0px';
                } else if (!wd.at) x.fillText(wd.t, wd.x, wd.y);
                else wd.gl.forEach((g, i) => x.fillText(g, wd.x + wd.at[i], wd.y));
            }
        };
        draw(inkL, inkColour);
        photoL = lifted(img, vw, vh, dpr);
        const px = paintL.getContext('2d');
        px.setTransform(1, 0, 0, 1, 0, 0);
        px.drawImage(inkL, 0, 0);
        px.globalCompositeOperation = 'source-in';
        px.drawImage(photoL, Math.round(M * dpr), Math.round(M * dpr));
        px.globalCompositeOperation = 'source-over';

        lens.R = clamp(vw * 0.24, 70, 160);
        if (!liq.ready) { liq.y = levelTarget(); liq.ready = true; }
    }

    // ---- motion ------------------------------------------------------------
    function fillProgress() {
        if (fill === 'static' || calm.matches) return 1;
        const r = root.getBoundingClientRect();
        const run = r.height - innerHeight;
        const p = run > 0 ? clamp(-r.top / run) : 1;
        return smooth(0.06, 0.8, p);
    }
    // The surface's height in vessel px: below the last line when empty, above
    // the first when full (the meniscus and its soft edge clear the words).
    function levelTarget() {
        const clear = lh * 1.4;
        return mix(textBottom + clear, textTop - clear, fillProgress());
    }

    let wave = null, maskK = 6;
    function surface(c) {
        // The liquid region, as a path under a gentle two-wave surface, filled
        // into the small mask canvas (scaled up later, which softens it).
        const x = c.getContext('2d');
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(0, 0, c.width, c.height);
        const q = dpr / maskK;
        x.setTransform(q, 0, 0, q, M * q, M * q);
        const k = (Math.PI * 2) / Math.max(160, vw * 0.62);
        wave = new Path2D();
        for (let px = -M - 40; px <= vw + M + 40; px += 6) {
            const w = Math.sin(px * k + liq.phase) * 0.62 + Math.sin(px * k * 2.37 - liq.phase * 1.61 + 1.3) * 0.38;
            px === -M - 40 ? wave.moveTo(px, liq.y + w * liq.amp) : wave.lineTo(px, liq.y + w * liq.amp);
        }
        const body = new Path2D(wave);
        body.lineTo(vw + M + 40, vh + M + 40);
        body.lineTo(-M - 40, vh + M + 40);
        body.closePath();
        x.fillStyle = '#000';
        x.fill(body);
    }

    // Light catching the surface: a soft pale band along the wave, painted
    // only onto the letters it crosses (source-atop), so the meniscus reads
    // even where the paint is as dark as the ink.
    function meniscus() {
        const x = bandL.getContext('2d');
        if (bandL.width !== maskL.width || bandL.height !== maskL.height) { bandL.width = maskL.width; bandL.height = maskL.height; }
        const q = dpr / maskK;
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.clearRect(0, 0, bandL.width, bandL.height);
        x.setTransform(q, 0, 0, q, M * q, M * q);
        x.strokeStyle = 'rgba(255, 244, 222, 0.6)';
        x.lineWidth = lh * 0.55;
        x.stroke(wave);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.drawImage(bandL, 0, 0, bandL.width * maskK, bandL.height * maskK);
    }

    function render() {
        const W = canvas.width, H = canvas.height;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(inkL, 0, 0);
        const t = tmpL.getContext('2d');
        t.setTransform(1, 0, 0, 1, 0, 0);

        // Paint below the surface: ink faded out, paint added in (lighter on
        // premultiplied layers is an exact cross-fade over the same glyphs).
        if (liq.y < textBottom + lh * 1.3) {
            if (liq.y < textTop - lh * 1.3) {
                ctx.drawImage(paintL, 0, 0);
            } else {
                surface(maskL);
                t.globalCompositeOperation = 'copy';
                t.drawImage(paintL, 0, 0);
                t.globalCompositeOperation = 'destination-in';
                t.imageSmoothingQuality = 'high';
                t.drawImage(maskL, 0, 0, maskL.width * maskK, maskL.height * maskK);
                ctx.globalCompositeOperation = 'destination-out';
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(maskL, 0, 0, maskL.width * maskK, maskL.height * maskK);
                ctx.globalCompositeOperation = 'lighter';
                ctx.drawImage(tmpL, 0, 0);
                meniscus();
            }
            // data-ghost: the photograph itself, very faint, behind the
            // painted letters, so the eye fuses type and picture.
            if (ghost) {
                const full = liq.y < textTop - lh * 1.3;
                t.globalCompositeOperation = 'copy';
                t.drawImage(photoL, Math.round(M * dpr), Math.round(M * dpr));
                if (!full) {
                    t.globalCompositeOperation = 'destination-in';
                    t.drawImage(maskL, 0, 0, maskL.width * maskK, maskL.height * maskK);
                }
                ctx.globalCompositeOperation = 'destination-over';
                ctx.globalAlpha = ghost;
                ctx.drawImage(tmpL, 0, 0);
                ctx.globalAlpha = 1;
            }
        }

        // Around the pointer: the letters take the picture even above the
        // surface, and the photograph itself shows faintly between them.
        if (lens.s > 0.004) {
            const cx = (lens.x + M) * dpr, cy = (lens.y + M) * dpr, R = lens.R * dpr;
            const ring = (a) => {
                const g = t.createRadialGradient(cx, cy, 0, cx, cy, R);
                g.addColorStop(0, `rgba(0,0,0,${a})`);
                g.addColorStop(0.5, `rgba(0,0,0,${a * 0.75})`);
                g.addColorStop(1, 'rgba(0,0,0,0)');
                return g;
            };
            const g1 = ring(lens.s);
            t.globalCompositeOperation = 'copy';
            t.drawImage(paintL, 0, 0);
            t.globalCompositeOperation = 'destination-in';
            t.fillStyle = g1;
            t.fillRect(0, 0, W, H);
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = g1;
            ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
            ctx.globalCompositeOperation = 'lighter';
            ctx.drawImage(tmpL, 0, 0);
            const g2 = ring(0.34 * lens.s);
            t.globalCompositeOperation = 'copy';
            t.drawImage(photoL, Math.round(M * dpr), Math.round(M * dpr));
            t.globalCompositeOperation = 'destination-in';
            t.fillStyle = g2;
            t.fillRect(0, 0, W, H);
            ctx.globalCompositeOperation = 'destination-over';   // behind the letters
            ctx.drawImage(tmpL, 0, 0);
        }
        ctx.globalCompositeOperation = 'source-over';
    }

    function frame(now) {
        raf = 0;
        if (dead) return;
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const still = calm.matches;
        let alive = false;

        // The surface follows the scroll on a critically damped spring; its
        // speed stirs the waves, which settle back to a slight ripple.
        const target = levelTarget();
        const base = lh * 0.22, extra = lh * 0.9;
        if (still) {
            liq.y = target; liq.v = 0; liq.amp = base;
        } else {
            const K = 26, D = 2 * Math.sqrt(K);
            liq.v += (K * (target - liq.y) - D * liq.v) * dt;
            liq.y += liq.v * dt;
            const stir = clamp(Math.abs(liq.v) / (lh * 14));
            const ampT = base + extra * stir;
            liq.amp += (ampT - liq.amp) * (1 - Math.exp(-dt / (ampT > liq.amp ? 0.18 : 0.9)));
            const energy = clamp((liq.amp - base) / extra);
            liq.phase += dt * 4.2 * energy * (liq.v < 0 ? 1 : -1);
            if (Math.abs(target - liq.y) > 0.3 || Math.abs(liq.v) > 0.3 || energy > 0.004) alive = true;
            else { liq.y = target; liq.v = 0; }
        }

        // The lens trails the pointer a touch and fades in and out.
        const f = still ? 1 : 1 - Math.exp(-dt / 0.07);
        lens.x += (lens.tx - lens.x) * f;
        lens.y += (lens.ty - lens.y) * f;
        lens.s += (lens.ts - lens.s) * (still ? 1 : 1 - Math.exp(-dt / (lens.ts > lens.s ? 0.16 : 0.45)));
        if (Math.abs(lens.tx - lens.x) + Math.abs(lens.ty - lens.y) > 0.3 || Math.abs(lens.ts - lens.s) > 0.004) alive = true;
        else lens.s = lens.ts;

        render();
        if (alive && (visible || still)) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    const kick = () => { if (!raf && !dead && words.length) raf = requestAnimationFrame(frame); };

    // ---- input -------------------------------------------------------------
    function point(e, show) {
        const r = canvas.getBoundingClientRect();
        lens.tx = e.clientX - r.left - M;
        lens.ty = e.clientY - r.top - M;
        if (lens.s < 0.02) { lens.x = lens.tx; lens.y = lens.ty; }
        const inside = lens.tx > -lens.R * 0.3 && lens.tx < vw + lens.R * 0.3 && lens.ty > -lens.R * 0.3 && lens.ty < vh + lens.R * 0.3;
        lens.ts = show && inside ? 1 : 0;
        kick();
    }
    let holding = false;
    on(canvas, 'pointermove', (e) => { if (e.pointerType === 'mouse' || holding) point(e, true); });
    on(canvas, 'pointerdown', (e) => { holding = e.pointerType !== 'mouse'; point(e, true); });
    const away = (e) => {
        if (e.type !== 'pointerleave' && e.pointerType === 'mouse') return;
        holding = false; lens.ts = 0; kick();
    };
    on(canvas, 'pointerleave', away);
    on(canvas, 'pointerup', away);
    on(canvas, 'pointercancel', away);

    // ---- start -------------------------------------------------------------
    (async () => {
        try {
            api = await import(LIB);
            img = await loadImage(new URL(url, document.baseURI).href);
            const cs = getComputedStyle(src);
            font = { style: cs.fontStyle, weight: weight || cs.fontWeight, family: family || cs.fontFamily };
            inkColour = cs.color;
            text = src.textContent.replace(/\s+/g, ' ').trim();
            try { await document.fonts.load(`${font.style} ${font.weight} 24px ${font.family}`); await document.fonts.ready; } catch (e) { /* measure what we have */ }
            if (dead || !text) return;
            stage.appendChild(canvas);
            root.classList.add('is-live');      // the pinned stage sizes the vessel
            layout();
        } catch (e) {
            canvas.remove();
            root.classList.remove('is-live');
            return;
        }
        render();

        const io = new IntersectionObserver((en) => {
            visible = en[0].isIntersecting;
            if (visible) kick();
        }, { rootMargin: '60px' });
        io.observe(root);
        off.push(() => io.disconnect());
        on(window, 'scroll', () => { if (visible) kick(); }, { passive: true });
        let timer = 0, lastW = -1, lastH = innerHeight;
        const ro = new ResizeObserver((en) => {
            // Re-pour when the stage changes width, or the window changes
            // height a lot; ignore the phone's URL bar sliding in and out.
            const w = Math.round(en[0].contentRect.width);
            if (lastW < 0) { lastW = w; return; }
            if (w === lastW && Math.abs(innerHeight - lastH) < 140) return;
            lastW = w; lastH = innerHeight;
            clearTimeout(timer);
            timer = setTimeout(() => { if (!dead) { layout(); render(); kick(); } }, 120);
        });
        ro.observe(stage);
        off.push(() => { ro.disconnect(); clearTimeout(timer); });
        const mq = () => kick();
        on(calm, 'change', mq);
    })();

    return function destroy() {
        dead = true;
        if (raf) cancelAnimationFrame(raf);
        off.forEach((f) => f());
        canvas.remove();
        root.classList.remove('pc', 'is-live', 'pc-static', 'pc-scroll');
    };
}

// Auto-start every [data-pretext-calligram] once it is near the viewport.
function autoStart(el) {
    const go = () => {
        if (!('IntersectionObserver' in window)) return pretextCalligram(el);
        const io = new IntersectionObserver((en) => {
            if (!en[0].isIntersecting) return;
            io.disconnect();
            pretextCalligram(el);
        }, { rootMargin: '800px' });
        io.observe(el);
    };
    go();          // module scripts run after parsing; fonts and the image are awaited inside
}
document.querySelectorAll('[data-pretext-calligram]').forEach(autoStart);
