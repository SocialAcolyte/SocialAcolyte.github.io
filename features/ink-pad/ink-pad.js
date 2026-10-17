/*
 *  INK-PAD // a signature field, or a page of margin notes, that writes like a
 *  pointed dip pen on good paper.
 *
 *  Markup:  <div data-ink-pad data-name="signature" data-required>
 *             <input class="ip-fallback" name="signature" placeholder="Type your full name" required>
 *           </div>
 *
 *  Margin notes over a printed page (the image is the paper):
 *           <div data-ink-pad data-variant="margin" data-name="notes">
 *             <div class="ip-surface"><img src="page.webp" alt=""></div>
 *           </div>
 *
 *  Or call  inkPad(element, options)  yourself. It returns destroy(), which
 *  also carries .undo() .redo() .clear() .toSVG() .toPNG() .isEmpty().
 *
 *  The pen. Strokes are outlined by perfect-freehand (Steve Ruiz, vendor/,
 *  MIT). Pressure comes from a real pen when there is one; otherwise it is
 *  made up the way a pointed nib behaves: fast is thin, slow is full, and
 *  downstrokes swell while upstrokes run to a hairline. Where the nib touches
 *  down, lifts slowly or rests, ink pools, and a pool keeps spreading while
 *  you hold still.
 *
 *  The ink. Fresh ink is a darker, cooler blue-black with a sheen along the
 *  side facing the light, and a glint on each pool. Every point dries on its
 *  own clock (~2s), so a long stroke dries from where it began toward the pen;
 *  pools dry last and stay a shade darker, and dried edges hold a little more
 *  pigment than the middle, as real ink does. Dry strokes are baked once into
 *  their own canvas; only wet ink is redrawn, and the loop stops when all of
 *  it is dry or the pad is off screen.
 *
 *  States:  idle -> drawing -> idle        (one stroke; two fingers cancel a
 *                                           fresh stroke and scroll the page)
 *           idle -> blotting -> idle       (Clear: a blotter presses and lifts
 *                                           the ink away, mirrored on its face)
 *           draw <-> typing                ("Type instead": the name is set in
 *                                           a script face and dries the same way)
 *
 *  As a form control it writes an SVG string to an input named data-name
 *  (and with data-png-name, a PNG data URL to a second one) and fires
 *  'input' and 'change'. data-required makes it take part in validation:
 *  an unsigned pad stops the submit, marks the line and takes focus.
 *
 *  Touch: one finger draws, two fingers scroll. A surface big enough to trap
 *  the page on a phone (data-mode="annotate", or taller than 55% of the
 *  viewport) gets a pen switch instead: off, a finger scrolls and a tap points
 *  at the switch; on, one finger writes, the edge warms, and it switches
 *  itself off after 8s idle or when scrolled away. A stylus always writes.
 *
 *  Keyboard: the pad is focusable; Enter or any letter switches to typing.
 *  Ctrl/Cmd+Z undoes, Shift+Ctrl/Cmd+Z redoes. Reduced motion: ink lands dry
 *  and Clear is instant; drawing itself is unchanged.
 */

import { getStrokePoints, getStrokeOutlinePoints } from './vendor/perfect-freehand/index.mjs';

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const LIGHT = [-0.56, -0.83];      // light from the upper left
const NIB = [-0.29, 0.957];        // a pointed nib swells pulled down and a little left
const PF = { thinning: 0.85, smoothing: 0.62, streamline: 0.4, easing: (t) => t, simulatePressure: false };
const DWELL = 150;                 // ms of stillness before ink starts to pool
const noop = Object.assign(() => {}, { undo() {}, redo() {}, clear() {}, toSVG: () => '', toPNG: () => '', isEmpty: () => true });

let lastPad = null;                // the pad Cmd+Z means when focus is on <body>

// Any CSS colour -> [r, g, b]
const probe = document.createElement('canvas').getContext('2d');
function rgb(css, fallback) {
    if (!css) return fallback;
    probe.fillStyle = '#000';
    probe.fillStyle = css.trim();
    const v = probe.fillStyle;
    if (v[0] === '#') return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    const m = v.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : fallback;
}
const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const hex = (c) => '#' + c.map((v) => (v | 0).toString(16).padStart(2, '0')).join('');
const f2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// perfect-freehand outline -> SVG path (quadratic through the midpoints)
function pathData(pts) {
    const n = pts.length;
    if (n < 3) return '';
    let d = `M${f2(pts[0][0])},${f2(pts[0][1])}Q`;
    for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        d += `${f2(a[0])},${f2(a[1])} ${f2((a[0] + b[0]) / 2)},${f2((a[1] + b[1]) / 2)} `;
    }
    return d + 'Z';
}

export function inkPad(root, opts = {}) {
    if (!root) return noop;
    if (root.__inkPad) return root.__inkPad;
    const d = root.dataset;
    const flag = (v) => v != null && v !== 'false';
    const variant = opts.variant ?? d.variant ?? 'signature';
    const margin = variant === 'margin';
    const cfg = {
        name: opts.name ?? d.name ?? '',
        pngName: opts.pngName ?? d.pngName ?? '',
        required: opts.required ?? flag(d.required),
        size: Number(opts.size ?? d.size ?? (margin ? 2.8 : 4)),
        dry: calm.matches ? 0 : Number(opts.dry ?? d.dry ?? 2000),
        typed: opts.typed ?? (d.typed != null ? flag(d.typed) : !margin),
        mode: opts.mode ?? d.mode ?? 'auto',
        label: opts.label ?? d.label ?? (margin ? 'Margin notes' : 'Signature'),
        ink: opts.ink ?? d.ink ?? '',
        wet: opts.wet ?? d.wet ?? '',
    };

    /* ---- DOM --------------------------------------------------------------- */
    const added = [];
    const make = (tag, cls, parent, attrs = {}) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        for (const k in attrs) el.setAttribute(k, attrs[k]);
        parent.appendChild(el);
        added.push(el);
        return el;
    };
    root.classList.add('ip', margin ? 'ip--margin' : 'ip--signature');

    let surface = root.querySelector('.ip-surface');
    const ownSurface = !surface;
    if (!surface) { surface = make('div', 'ip-surface', root); }
    const uid = 'ip' + Math.random().toString(36).slice(2, 8);
    surface.tabIndex = 0;
    surface.setAttribute('role', 'group');
    surface.setAttribute('aria-describedby', uid + '-help');

    if (!margin) {
        make('span', 'ip-line', surface, { 'aria-hidden': 'true' });
        make('span', 'ip-x', surface, { 'aria-hidden': 'true' }).textContent = '×';
    }
    const dryCv = make('canvas', 'ip-ink', surface, { 'aria-hidden': 'true' });
    const wetCv = make('canvas', 'ip-ink ip-wet', surface, { 'aria-hidden': 'true' });
    const txtCv = make('canvas', 'ip-ink ip-text', surface, { 'aria-hidden': 'true' });
    const dctx = dryCv.getContext('2d');
    const wctx = wetCv.getContext('2d');
    const tctx = txtCv.getContext('2d');
    const scratch = document.createElement('canvas');
    const sc = scratch.getContext('2d');
    if (!dctx || !wctx || !sc) { added.forEach((el) => el.remove()); return noop; }

    // The fallback text field becomes the "type your name" alternative.
    const fallback = root.querySelector('input.ip-fallback') || root.querySelector('input[type="text"], input:not([type])');
    const fbState = fallback && { name: fallback.name, required: fallback.required, parent: fallback.parentNode, next: fallback.nextSibling, cls: fallback.className };
    const fieldName = cfg.name || (fallback && fallback.name) || '';
    if (fallback) { fallback.removeAttribute('name'); fallback.required = false; }

    // The value the form submits: visually hidden but real, so it validates.
    const value = make('input', 'ip-value', surface, { type: 'text', tabindex: '-1', 'aria-hidden': 'true', autocomplete: 'off' });
    if (fieldName) value.name = fieldName;
    value.required = !!cfg.required;
    let png = null;
    if (cfg.pngName) png = make('input', '', root, { type: 'hidden', name: cfg.pngName });

    const bar = make('div', 'ip-bar', root);
    let toggle = null, typed = null;
    if (cfg.typed) {
        toggle = make('button', 'ip-btn ip-toggle', bar, { type: 'button', 'aria-pressed': 'false' });
        toggle.textContent = 'Type instead';
        typed = fallback || document.createElement('input');
        if (!fallback) { typed.type = 'text'; typed.placeholder = 'Type your full name'; }
        typed.classList.add('ip-typed');
        typed.setAttribute('aria-label', 'Type your name to sign');
        typed.autocomplete = 'name';
        typed.spellcheck = false;
        bar.insertBefore(typed, toggle);
        if (!fallback) added.push(typed);
    } else if (fallback) {
        fallback.hidden = true;
    }
    // Big surfaces on touch screens get a pen switch, so a finger can still scroll.
    const pen = make('button', 'ip-btn ip-pen', bar, { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Pen: write with one finger' });
    pen.hidden = true;
    pen.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M8 15 3.6 7.6 6 2.4h4l2.4 5.2Z" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M8 15V9.2" stroke="currentColor" stroke-width="1"/><circle cx="8" cy="8.1" r="1.05" fill="currentColor"/></svg><span>Pen</span>';
    const hint = make('span', 'ip-hint', bar);
    const undoBtn = make('button', 'ip-btn ip-undo', bar, { type: 'button', 'aria-keyshortcuts': 'Control+Z Meta+Z' });
    undoBtn.textContent = 'Undo';
    const clearBtn = make('button', 'ip-btn ip-clear', bar, { type: 'button' });
    clearBtn.textContent = 'Clear';
    const live = make('span', 'ip-sr', root, { 'aria-live': 'polite' });

    const helpText = margin
        ? 'Write with a finger, pen or mouse. Two fingers scroll.'
        : cfg.typed ? 'Sign with a finger, pen or mouse, or press Enter to type your name.' : 'Sign with a finger, pen or mouse.';
    make('span', 'ip-sr', root, { id: uid + '-help' }).textContent = helpText;

    /* ---- ink colours ------------------------------------------------------- */
    let INK, WET, DEEP, SHEEN;
    function readColours() {
        const cs = getComputedStyle(root);
        INK = rgb(cfg.ink || cs.getPropertyValue('--ip-ink'), [26, 23, 20]);
        const w = cfg.wet || cs.getPropertyValue('--ip-ink-wet');
        // Wet ink defaults to a deeper, cooler version of the dry colour.
        WET = rgb(w, null) || [INK[0] * 0.55, INK[1] * 0.58, INK[2] * 0.62 + 18];
        DEEP = INK.map((v) => v * 0.6);
        SHEEN = rgb(cs.getPropertyValue('--ip-sheen'), [255, 250, 240]);
    }

    /* ---- layout ------------------------------------------------------------ */
    /* ---- the pen switch ------------------------------------------------------ */
    // guarded: a touch screen and a surface big enough to trap the page
    // (data-mode="annotate", or taller than 55% of the viewport). Then:
    //   off -> a finger scrolls; a tap nudges the pen button
    //   on  -> one finger writes; off again after 8s idle or scrolled away
    // A stylus always writes, and a mouse always draws.
    let guarded = false, armed = false, idleT = 0, nudgeT = 0, tap = null;
    const touchy = () => (navigator.maxTouchPoints || 0) > 0 || matchMedia('(pointer: coarse)').matches;
    function guard(h) {
        const g = cfg.mode !== 'draw' && touchy() && (cfg.mode === 'annotate' || h > innerHeight * 0.55);
        if (g === guarded) return;
        guarded = g;
        pen.hidden = !g;
        root.classList.toggle('is-guarded', g);
        if (!g) arm(false, true);
    }
    function arm(on, quiet) {
        if (armed === on) return;
        armed = on;
        root.classList.toggle('is-armed', on);
        pen.setAttribute('aria-pressed', String(on));
        clearTimeout(idleT);
        if (on) { idleT = setTimeout(rest, 8000); hint.textContent = ''; pen.classList.remove('is-nudge'); }
        if (!quiet) live.textContent = on ? 'Pen on. One finger writes, two scroll.' : 'Pen off';
    }
    function rest() { if (cur) idleT = setTimeout(rest, 1500); else arm(false); }
    const wake = () => { if (armed) { clearTimeout(idleT); idleT = setTimeout(rest, 8000); } };
    function nudge() {
        hint.textContent = 'Tap the pen to write';
        pen.classList.add('is-nudge');
        clearTimeout(nudgeT);
        nudgeT = setTimeout(() => { if (!armed) hint.textContent = ''; pen.classList.remove('is-nudge'); }, 2400);
    }
    const onPen = () => arm(!armed);
    pen.addEventListener('click', onPen);

    let W = 0, H = 0, dpr = 1;
    function layout() {
        const r = surface.getBoundingClientRect();
        const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
        dpr = Math.min(2, devicePixelRatio || 1);
        guard(nh);
        if (nw === W && nh === H && dryCv.width === Math.round(nw * dpr)) return;
        W = nw; H = nh;
        for (const [cv, cx] of [[dryCv, dctx], [wetCv, wctx], [txtCv, tctx]]) {
            cv.width = Math.round(W * dpr);
            cv.height = Math.round(H * dpr);
            cx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        for (const s of strokes) s.g = null;
        rebake();
        drawText(performance.now());
        kick();
    }

    /* ---- strokes ----------------------------------------------------------- */
    // A stroke: pts [x, y, pressure, time, length] with x, y, length divided by
    // the pad width (so ink scales with the pad), pools, nib size / width.
    let strokes = [];        // in z-order
    let wet = [];            // strokes still drying (a tail of `strokes`)
    let history = [], future = [];
    let cur = null;          // the stroke under the pen

    function geom(s) {
        const n = s.pts.length;
        if (s.g && s.g.W === W && s.g.n === n && s.g.done === s.done && s.g.np === s.pools.length) return s.g;
        const o = { ...PF, size: s.size * W, start: { cap: true, taper: 0 }, end: { cap: true, taper: s.taper * W }, last: s.done };
        const sp = getStrokePoints(s.pts.map((q) => [q[0] * W, q[1] * W, q[2]]), o);
        const ol = getStrokeOutlinePoints(sp, o);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const [x, y] of ol) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        for (const p of s.pools) {
            const r = s.size * W * 1.2;
            x0 = Math.min(x0, p.x * W - r); y0 = Math.min(y0, p.y * W - r);
            x1 = Math.max(x1, p.x * W + r); y1 = Math.max(y1, p.y * W + r);
        }
        if (!ol.length) { x0 = y0 = 0; x1 = y1 = 1; }
        // Time at each outline-centre point, looked up by distance along the
        // stroke (perfect-freehand drops and moves points, so index won't do).
        const times = [];
        let j = 0;
        for (const q of sp) {
            const L = q.runningLength / W;
            while (j < n - 1 && s.pts[j + 1][4] <= L) j++;
            times.push(s.pts[j][3]);
        }
        const dstr = pathData(ol);
        s.g = { W, n, done: s.done, np: s.pools.length, sp, times, d: dstr, path: new Path2D(dstr || 'M0,0'), box: [x0 - 4, y0 - 4, x1 - x0 + 8, y1 - y0 + 8] };
        return s.g;
    }

    const poolR = (s, p, now) => s.size * W * 0.5 * (0.55 + 1.9 * p.s) * smooth(0, 0.05, p.s) * (cfg.dry ? 0.8 + 0.2 * smooth(0, 380, now - p.t) : 1);
    const pointWet = (t, now) => (cfg.dry ? 1 - smooth(0.12 * cfg.dry, cfg.dry, now - t) : 0);
    const poolWet = (p, now) => (cfg.dry ? 1 - smooth(0.2 * cfg.dry, cfg.dry * (1.3 + 0.7 * p.s), now - p.tEnd) : 0);
    const dryAt = (s) => Math.max(s.pts[s.pts.length - 1][3] + cfg.dry, ...s.pools.map((p) => p.tEnd + cfg.dry * (1.3 + 0.7 * p.s)));

    // Draw runs of the centre line whose (width, alpha) fall in the same
    // bucket as one path, so hundreds of points cost a handful of strokes.
    function runs(g, fn, rgbc) {
        const sp = g.sp;
        if (sp.length < 2) return;
        let key = null, started = false;
        const flush = () => { if (started) { sc.stroke(); started = false; } };
        for (let i = 0; i < sp.length - 1; i++) {
            const a = fn(i), b = fn(i + 1);
            const w = Math.round(((a[2] + b[2]) / 2) * 4) / 4;
            const al = Math.round(((a[3] + b[3]) / 2) * 16) / 16;
            if (al <= 0 || w <= 0) { flush(); key = null; continue; }
            const k = w * 100 + al;
            if (k !== key) {
                flush();
                key = k;
                sc.beginPath();
                sc.lineWidth = w;
                sc.strokeStyle = css(rgbc, al);
                sc.moveTo(a[0], a[1]);
                started = true;
            }
            sc.lineTo(b[0], b[1]);
        }
        flush();
    }

    function render(ctx, s, now, wetPass) {
        const g = geom(s);
        if (!g.d && !s.pools.length) return;
        const [bx, by, bw, bh] = g.box;
        const sw = Math.ceil(bw * dpr), sh = Math.ceil(bh * dpr);
        if (scratch.width < sw || scratch.height < sh) {
            scratch.width = Math.max(scratch.width, sw);
            scratch.height = Math.max(scratch.height, sh);
        }
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalCompositeOperation = 'source-over';
        sc.clearRect(0, 0, sw + 1, sh + 1);
        sc.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
        sc.lineCap = 'butt';
        sc.lineJoin = 'round';

        // 1. The ink, opaque, so pools and stroke merge without seams.
        sc.fillStyle = css(INK);
        if (g.d) sc.fill(g.path);
        if (s.pools.length) {
            sc.beginPath();
            for (const p of s.pools) {
                const r = poolR(s, p, now);
                sc.moveTo(p.x * W + r, p.y * W);
                sc.arc(p.x * W, p.y * W, r, 0, Math.PI * 2);
            }
            sc.fill();
        }
        sc.globalCompositeOperation = 'source-atop';

        // 2. Dried edges and pools hold more pigment.
        if (g.d) { sc.lineWidth = 1.1; sc.strokeStyle = css(DEEP, 0.3); sc.stroke(g.path); }
        for (const p of s.pools) {
            const r = poolR(s, p, now), x = p.x * W, y = p.y * W;
            const gr = sc.createRadialGradient(x, y, 0, x, y, r * 1.05);
            gr.addColorStop(0, css(DEEP, 0.42 * (0.4 + 0.6 * p.s)));
            gr.addColorStop(1, css(DEEP, 0));
            sc.fillStyle = gr;
            sc.fillRect(x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
        }

        if (wetPass) {
            const sp = g.sp, size = s.size * W;
            const rad = (i) => size * (0.5 - PF.thinning * (0.5 - sp[i].pressure));
            const wt = g.times.map((t) => pointWet(t, now));
            // 3. Wet colour laid along the centre line, each point on its own clock.
            runs(g, (i) => [sp[i].point[0], sp[i].point[1], size * 1.9 + 3, wt[i]], WET);
            for (const i of [0, sp.length - 1]) {
                if (!sp[i] || wt[i] <= 0) continue;
                sc.fillStyle = css(WET, wt[i]);
                sc.beginPath(); sc.arc(sp[i].point[0], sp[i].point[1], size + 1.5, 0, Math.PI * 2); sc.fill();
            }
            for (const p of s.pools) {
                const pw = poolWet(p, now);
                if (pw <= 0) continue;
                sc.fillStyle = css(WET, pw);
                sc.beginPath(); sc.arc(p.x * W, p.y * W, poolR(s, p, now) + 1, 0, Math.PI * 2); sc.fill();
            }
            // 4. Sheen: a soft highlight on the side of the bead facing the
            // light, fading as the ink sinks in. Hairlines glint less.
            sc.lineCap = 'round';
            // The bead catches the light most where its side faces the light.
            const face = sp.map((q) => {
                const v = q.vector || [1, 0];
                const n = Math.abs(v[1] * LIGHT[0] - v[0] * LIGHT[1]);
                return 0.15 + 0.85 * n * n;
            });
            const sheen = (k, wk, ak) => runs(g, (i) => {
                const r = rad(i);
                return [sp[i].point[0] + LIGHT[0] * r * k, sp[i].point[1] + LIGHT[1] * r * k, Math.max(0.5, r * wk),
                    wt[i] * ak * face[i] * smooth(0.45, 2.2, r)];
            }, SHEEN);
            sheen(0.4, 0.6, 0.12);
            sheen(0.5, 0.24, 0.62);
            for (const p of s.pools) {
                const pw = poolWet(p, now);
                if (pw <= 0) continue;
                const r = poolR(s, p, now);
                const x = p.x * W + LIGHT[0] * r * 0.38, y = p.y * W + LIGHT[1] * r * 0.38;
                const gr = sc.createRadialGradient(x, y, 0, x, y, r * 0.55);
                gr.addColorStop(0, css(SHEEN, 0.75 * pw));
                gr.addColorStop(1, css(SHEEN, 0));
                sc.fillStyle = gr;
                sc.fillRect(x - r, y - r, r * 2, r * 2);
            }
        }
        sc.globalCompositeOperation = 'source-over';

        // Ink lies on the paper, not over it: a touch of the grain shows through.
        ctx.globalAlpha = 0.93;
        ctx.drawImage(scratch, 0, 0, sw, sh, bx, by, bw, bh);
        ctx.globalAlpha = 1;
    }

    function rebake() {
        dctx.clearRect(0, 0, W, H);
        const now = performance.now();
        for (const s of strokes) if (!wet.includes(s)) render(dctx, s, now, false);
    }

    /* ---- typed signature ---------------------------------------------------- */
    let typing = false;
    let text = '', times = [];
    const scriptFamily = () => (getComputedStyle(root).getPropertyValue('--ip-script').trim() || '"Mrs Saint Delafield", "Snell Roundhand", cursive');
    function textLayout() {
        const fam = scriptFamily();
        const x0 = W * 0.11 + 14;
        const base = H * (parseFloat(getComputedStyle(root).getPropertyValue('--ip-line-y')) || 70) / 100;
        let px = Math.min(H * 0.5, 96);
        tctx.font = `400 ${px}px ${fam}`;
        const avail = W - x0 - W * 0.06;
        const tw = tctx.measureText(text || ' ').width;
        if (tw > avail) px *= avail / tw;
        return { fam, px, x0, base: base - px * 0.08 };
    }
    function drawText(now) {
        tctx.clearRect(0, 0, W, H);
        if (!typing || !text) return false;
        const L = textLayout();
        const font = `400 ${L.px}px ${L.fam}`;
        tctx.font = font;
        const tw = tctx.measureText(text).width;
        const bx = L.x0 - L.px * 0.4, by = L.base - L.px * 1.1, bw = tw + L.px * 0.8, bh = L.px * 1.7;
        const sw = Math.ceil(bw * dpr), sh = Math.ceil(bh * dpr);
        if (scratch.width < sw || scratch.height < sh) { scratch.width = Math.max(scratch.width, sw); scratch.height = Math.max(scratch.height, sh); }
        sc.setTransform(1, 0, 0, 1, 0, 0);
        sc.globalCompositeOperation = 'source-over';
        sc.clearRect(0, 0, sw + 1, sh + 1);
        sc.setTransform(dpr, 0, 0, dpr, -bx * dpr, -by * dpr);
        sc.font = font;
        sc.fillStyle = css(INK);
        sc.fillText(text, L.x0, L.base);
        sc.globalCompositeOperation = 'source-atop';
        // Each letter dries on its own clock: a gradient across the word.
        let alive = false;
        const wetG = sc.createLinearGradient(L.x0, 0, L.x0 + tw, 0);
        const shG = sc.createLinearGradient(L.x0, 0, L.x0 + tw, 0);
        for (let i = 0; i < text.length; i++) {
            const a = sc.measureText(text.slice(0, i)).width, b = sc.measureText(text.slice(0, i + 1)).width;
            const w = pointWet(times[i] ?? 0, now);
            if (w > 0) alive = true;
            const at = clamp(tw ? ((a + b) / 2) / tw : 0);
            wetG.addColorStop(at, css(WET, w));
            shG.addColorStop(at, css(SHEEN, 0.3 * w));
        }
        if (alive) {
            sc.fillStyle = wetG;
            sc.fillRect(bx, by, bw, bh);
            sc.strokeStyle = shG;
            sc.lineWidth = Math.max(0.6, L.px * 0.022);
            sc.strokeText(text, L.x0 - LIGHT[0] * L.px * 0.012, L.base - LIGHT[1] * L.px * 0.012);
        }
        sc.globalCompositeOperation = 'source-over';
        tctx.globalAlpha = 0.93;
        tctx.drawImage(scratch, 0, 0, sw, sh, bx, by, bw, bh);
        tctx.globalAlpha = 1;
        return alive;
    }

    /* ---- the loop ------------------------------------------------------------ */
    let raf = 0, visible = true;
    function frame() {
        raf = 0;
        const now = performance.now();
        if (cur) growPool(now);
        // Bake strokes that have dried, oldest first, so z-order holds.
        while (wet.length && wet[0].done && now >= dryAt(wet[0])) render(dctx, wet.shift(), now, false);
        wctx.clearRect(0, 0, W, H);
        for (const s of wet) render(wctx, s, now, true);
        const textWet = drawText(now);
        if ((wet.length || textWet) && visible) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

    /* ---- the pen --------------------------------------------------------------- */
    let penSeen = false;
    const touches = new Map();
    let pan = null;
    const local = (e) => {
        const r = surface.getBoundingClientRect();
        return [e.clientX - r.left, e.clientY - r.top];
    };

    function begin(e) {
        const [x, y] = local(e);
        const t = e.timeStamp || performance.now();
        const pen = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : null;
        cur = {
            pts: [[x / W, y / W, pen ?? 0.3, t, 0]],
            pools: [], size: cfg.size / W, taper: 0, done: false, g: null,
            id: e.pointerId, pen: e.pointerType === 'pen',
            last: { x, y, t }, v: 0, dx: 0, dy: 1, p: pen ?? 0.3, len: 0,
            dwell: { x, y, t: performance.now() }, pool: null,
        };
        // The nib touching down leaves a little more ink than the line.
        cur.pool = { x: x / W, y: y / W, s: 0.06, t, tEnd: t };
        cur.pools.push(cur.pool);
        strokes.push(cur);
        wet.push(cur);
        wake();
        root.classList.add('has-ink');
        markValid();
        kick();
    }

    function extend(e) {
        const [x, y] = local(e);
        const t = e.timeStamp || performance.now();
        const L = cur.last;
        const dx = x - L.x, dy = y - L.y, dist = Math.hypot(dx, dy);
        // Stillness is timed on arrival, not by event timestamps, which can lag.
        if (Math.hypot(x - cur.dwell.x, y - cur.dwell.y) > 1.4) { cur.dwell = { x, y, t: performance.now() }; cur.pool = null; }
        if (dist < 0.4) return;
        const dt = Math.max(1, t - L.t);
        const k = (tau) => 1 - Math.exp(-dt / tau);
        cur.v += (dist / dt - cur.v) * k(40);
        // Direction of travel, smoothed as a vector.
        const first = cur.pts.length === 1;
        cur.dx = first ? dx / dist : cur.dx + (dx / dist - cur.dx) * k(18);
        cur.dy = first ? dy / dist : cur.dy + (dy / dist - cur.dy) * k(18);
        const dl = Math.hypot(cur.dx, cur.dy) || 1;
        // A pointed nib: the tines only spread when pulled down along the
        // slant, so direction sets the weight; speed only trims it.
        const down = (cur.dx * NIB[0] + cur.dy * NIB[1]) / dl;
        const dirF = Math.pow(smooth(0.1, 0.9, down), 1.15);
        const speedF = 1 / (1 + Math.pow(cur.v / 1.1, 1.5));
        const target = cur.pen && e.pressure > 0
            ? 0.04 + 0.66 * e.pressure * (0.25 + 0.75 * dirF)
            : 0.04 + 0.62 * dirF * (0.7 + 0.3 * speedF);
        cur.p += (target - cur.p) * k(22);
        cur.len += dist;
        cur.pts.push([x / W, y / W, clamp(cur.p, 0.04, 1), t, cur.len / W]);
        cur.last = { x, y, t };
    }

    // Holding still lets the ink spread into a pool, slower as it grows.
    function growPool(now) {
        const held = now - cur.dwell.t;
        if (held < DWELL) return;
        if (!cur.pool) {
            const x = cur.dwell.x / W, y = cur.dwell.y / W;
            cur.pool = { x, y, s: 0, t: now, tEnd: now };
            cur.pools.push(cur.pool);
        }
        cur.pool.s = Math.max(cur.pool.s, 1 - Math.exp(-(held - DWELL) / 320));
        cur.pool.tEnd = now;
        cur.g = null;
    }

    function finish(e) {
        if (!cur) return;
        const s = cur;
        cur = null;
        const now = performance.now();
        if (now - s.dwell.t < DWELL && s.v < 0.05 && s.pts.length > 3) {
            // A slow lift leaves a small bead at the end.
            s.pools.push({ x: s.last.x / W, y: s.last.y / W, s: 0.15, t: now, tEnd: now });
        }
        // A quick flick off the page tapers to nothing.
        s.taper = s.v > 0.7 ? Math.min(34, s.v * 16) / W : 0;
        s.done = true;
        s.g = null;
        delete s.last; delete s.dwell; delete s.pool;
        history.push({ add: s });
        future = [];
        lastPad = api;
        wake();
        commit('Stroke added');
        kick();
    }

    function cancel() {
        if (!cur) return;
        strokes = strokes.filter((s) => s !== cur);
        wet = wet.filter((s) => s !== cur);
        cur = null;
        if (!strokes.length) root.classList.remove('has-ink');
        kick();
    }

    function onDown(e) {
        if (typing || blotting) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        if (e.pointerType === 'pen') penSeen = true;
        if (e.pointerType === 'touch' && guarded && !armed) {
            // The pen is off: let the finger scroll, and notice a plain tap.
            tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
            return;
        }
        if (e.pointerType === 'touch') {
            touches.set(e.pointerId, [e.clientX, e.clientY]);
            // Two fingers: a fresh stroke was the start of a scroll, not ink.
            if (touches.size === 2) {
                if (cur && !cur.pen && (performance.now() - cur.pts[0][3] < 350 || cur.len < 40)) cancel();
                if (!cur) pan = avgY();
                return;
            }
            if (penSeen || touches.size > 2) return;     // palm, when a pen is about
        }
        if (cur) return;
        e.preventDefault();
        root.classList.add('is-pointer');
        if (!W) layout();
        try { surface.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
        begin(e);
    }
    const avgY = () => { let s = 0; for (const p of touches.values()) s += p[1]; return s / touches.size; };

    function onMove(e) {
        if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
            touches.set(e.pointerId, [e.clientX, e.clientY]);
            if (pan != null) {
                const y = avgY();
                scrollBy(0, pan - y);
                pan = y;
                return;
            }
        }
        if (!cur || e.pointerId !== cur.id) return;
        const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
        for (const c of (list.length ? list : [e])) extend(c);
        kick();
    }
    function onUp(e) {
        if (tap && tap.id === e.pointerId) {
            if (e.type === 'pointerup' && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 10 && performance.now() - tap.t < 450) nudge();
            tap = null;
        }
        touches.delete(e.pointerId);
        if (touches.size < 2) pan = null;
        if (cur && e.pointerId === cur.id) {
            if (e.type === 'pointercancel' && cur.len < 3) cancel();
            else finish(e);
        }
    }
    // iOS: belt and braces against the page moving under the pen.
    const onTouchMove = (e) => { if (cur || pan != null) e.preventDefault(); };

    surface.addEventListener('pointerdown', onDown);
    surface.addEventListener('pointermove', onMove);
    surface.addEventListener('pointerup', onUp);
    surface.addEventListener('pointercancel', onUp);
    surface.addEventListener('touchmove', onTouchMove, { passive: false });
    const noMenu = (e) => { if (cur) e.preventDefault(); };
    surface.addEventListener('contextmenu', noMenu);

    /* ---- history ------------------------------------------------------------- */
    function undo() {
        if (blotting || cur) return;
        const h = history.pop();
        if (!h) return;
        if (h.add) { strokes = strokes.filter((s) => s !== h.add); wet = wet.filter((s) => s !== h.add); }
        else if (h.clear) { strokes = h.clear.slice(); wet = []; }
        future.push(h);
        rebake();
        kick();
        commit(h.add ? 'Stroke undone' : 'Ink restored');
    }
    function redo() {
        if (blotting || cur) return;
        const h = future.pop();
        if (!h) return;
        if (h.add) strokes.push(h.add);
        else if (h.clear) { strokes = []; wet = []; }
        history.push(h);
        rebake();
        kick();
        commit(h.add ? 'Stroke restored' : 'Cleared');
    }

    /* ---- clear: the blotter ---------------------------------------------------- */
    let blotting = false;
    let blotTimer = 0;
    function wipe() {
        const was = strokes.slice();
        strokes = []; wet = []; cur = null;
        dctx.clearRect(0, 0, W, H);
        wctx.clearRect(0, 0, W, H);
        if (typing) { text = ''; times = []; if (typed) typed.value = ''; drawText(0); }
        return was;
    }
    function clear(instant) {
        if (blotting || isEmpty()) return;
        const finishClear = () => {
            const was = wipe();
            if (was.length && !typing) { history.push({ clear: was }); future = []; }
            commit('Cleared');
        };
        if (instant === true || calm.matches || !surface.animate) { finishClear(); return; }
        blotting = true;
        root.classList.add('is-blotting');
        const sheet = make('div', 'ip-blotter', surface, { 'aria-hidden': 'true' });
        const cv = make('canvas', 'ip-blot-ink', sheet);
        cv.width = dryCv.width; cv.height = dryCv.height;
        const bc = cv.getContext('2d');
        // The ink it takes away shows on its face, mirrored and softened.
        bc.translate(cv.width, 0);
        bc.scale(-1, 1);
        bc.filter = `blur(${dpr * 0.9}px)`;
        for (const c of (typing ? [txtCv] : [dryCv, wetCv])) bc.drawImage(c, 0, 0);
        const ease = 'cubic-bezier(.2,.7,.2,1)';
        sheet.animate([
            { opacity: 0, transform: 'translate(1.5%, -5%) rotate(.9deg) scale(1.02)', boxShadow: '0 22px 44px rgba(20,19,18,.16)' },
            { opacity: 1, transform: 'translate(0,0) rotate(0) scale(1)', boxShadow: '0 2px 5px rgba(20,19,18,.14)', offset: 0.3 },
            { opacity: 1, transform: 'translate(0,0) rotate(0) scale(1)', boxShadow: '0 2px 5px rgba(20,19,18,.14)', offset: 0.46 },
            { opacity: 1, transform: 'translate(-.8%, -4%) rotate(-1deg) scale(1.015)', boxShadow: '0 18px 40px rgba(20,19,18,.14)', offset: 0.75 },
            { opacity: 0, transform: 'translate(-1.4%, -8%) rotate(-1.6deg) scale(1.02)', boxShadow: '0 26px 50px rgba(20,19,18,0)' },
        ], { duration: 1050, easing: ease, fill: 'forwards' });
        cv.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 0.5 }, { opacity: 0.5 }],
            { duration: 1050, offsets: [0, 0.28, 0.45, 1], fill: 'forwards' });
        blotTimer = setTimeout(() => {
            finishClear();
            blotTimer = setTimeout(() => {
                sheet.remove();
                blotting = false;
                root.classList.remove('is-blotting');
            }, 760);
        }, 300);
    }

    /* ---- typing ------------------------------------------------------------- */
    function setTyping(on, focus = true) {
        if (!typed || on === typing || blotting) return;
        typing = on;
        root.classList.toggle('is-typing', on);
        toggle.setAttribute('aria-pressed', String(on));
        toggle.textContent = on ? 'Draw instead' : 'Type instead';
        if (on && focus) typed.focus();
        if (!on && focus) surface.focus();
        drawText(performance.now());
        kick();
        commit(on ? 'Typing your name' : 'Drawing');
    }
    function onTypedInput() {
        const v = typed.value;
        const now = performance.now();
        // Keep the drying clocks of letters that did not change.
        let a = 0;
        while (a < v.length && a < text.length && v[a] === text[a]) a++;
        let b = 0;
        while (b < v.length - a && b < text.length - a && v[v.length - 1 - b] === text[text.length - 1 - b]) b++;
        times = times.slice(0, a).concat(Array(v.length - a - b).fill(now), times.slice(times.length - b));
        text = v;
        if (text) markValid();
        commit(null, true);
        kick();
    }
    const onTypedChange = () => commit(null);
    const onTypedKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); setTyping(false); } };
    if (typed) {
        typed.addEventListener('input', onTypedInput);
        typed.addEventListener('change', onTypedChange);
        typed.addEventListener('keydown', onTypedKey);
        toggle.addEventListener('click', () => setTyping(!typing));
        const fam = scriptFamily();
        if (document.fonts) document.fonts.load(`400 48px ${fam}`).then(() => { drawText(performance.now()); kick(); }).catch(() => {});
    }

    /* ---- keyboard ------------------------------------------------------------ */
    function onSurfaceKey(e) {
        root.classList.remove('is-pointer');
        if (e.metaKey || e.ctrlKey || e.altKey || !typed || typing) return;
        if (e.key === 'Enter' || e.key.length === 1) {
            e.preventDefault();
            setTyping(true);
            if (e.key.length === 1 && e.key !== ' ') { typed.value += e.key; onTypedInput(); }
        }
    }
    surface.addEventListener('keydown', onSurfaceKey);
    function onDocKey(e) {
        if (!(e.metaKey || e.ctrlKey) || e.altKey || (e.key !== 'z' && e.key !== 'Z')) return;
        const a = document.activeElement;
        const mine = a && root.contains(a) && a !== typed;
        const idle = (!a || a === document.body) && lastPad === api;
        if (!(mine || idle) || typing) return;
        e.preventDefault();
        e.shiftKey ? redo() : undo();
    }
    document.addEventListener('keydown', onDocKey);

    /* ---- the form value --------------------------------------------------------- */
    function isEmpty() { return typing ? !text.trim() : !strokes.length; }

    function toSVG() {
        if (isEmpty()) return '';
        const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
        if (typing) {
            const L = textLayout();
            return `${head}<text x="${f2(L.x0)}" y="${f2(L.base)}" font-family="${esc(L.fam.replace(/"/g, "'"))}" font-size="${f2(L.px)}" fill="${hex(INK)}">${esc(text)}</text></svg>`;
        }
        const now = performance.now() + 1e7;
        let body = '';
        for (const s of strokes) {
            const g = geom(s);
            if (g.d) body += `<path d="${g.d}"/>`;
            for (const p of s.pools) {
                const r = poolR(s, p, now);
                if (r > 0.2) body += `<circle cx="${f2(p.x * W)}" cy="${f2(p.y * W)}" r="${f2(r)}"/>`;
            }
        }
        return `${head}<g fill="${hex(INK)}" opacity="0.93">${body}</g></svg>`;
    }

    function toPNG() {
        if (isEmpty()) return '';
        const cv = document.createElement('canvas');
        cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
        const cx = cv.getContext('2d');
        if (typing) cx.drawImage(txtCv, 0, 0);
        else {
            cx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const later = performance.now() + 1e7;
            for (const s of strokes) render(cx, s, later, false);
        }
        return cv.toDataURL('image/png');
    }

    function commit(say, quiet) {
        const svg = toSVG();
        root.classList.toggle('has-ink', !isEmpty() || !!cur);
        undoBtn.disabled = typing || !history.length;
        clearBtn.disabled = isEmpty();
        surface.setAttribute('aria-label', `${cfg.label}, ${isEmpty() ? 'empty' : typing ? 'typed' : 'signed'}`);
        if (svg === value.value) return;
        value.value = svg;
        if (png) png.value = toPNG();
        value.dispatchEvent(new Event('input', { bubbles: true }));
        if (!quiet) value.dispatchEvent(new Event('change', { bubbles: true }));
        if (say) live.textContent = say;
        if (!isEmpty()) markValid();
    }

    /* ---- validation ---------------------------------------------------------- */
    function markValid() {
        if (!root.classList.contains('is-invalid')) return;
        root.classList.remove('is-invalid');
        hint.textContent = '';
    }
    function onInvalid(e) {
        e.preventDefault();
        root.classList.add('is-invalid');
        hint.textContent = margin ? 'Add a note' : 'Please sign above the line';
        live.textContent = hint.textContent;
        // Take focus only as the form's first invalid control, as the browser would.
        const f = value.form;
        if (f && f.querySelector(':invalid') !== value) return;
        (typing ? typed : surface).focus({ preventScroll: true });
        surface.scrollIntoView({ block: 'center', behavior: calm.matches ? 'auto' : 'smooth' });
    }
    value.addEventListener('invalid', onInvalid);
    const form = value.form;
    const onReset = () => {
        setTimeout(() => {
            wipe(); history = []; future = []; text = ''; times = [];
            if (typing) setTyping(false, false);
            markValid();
            commit(null);
        });
    };
    if (form) form.addEventListener('reset', onReset);

    undoBtn.addEventListener('click', undo);
    clearBtn.addEventListener('click', () => clear());

    /* ---- lifecycle --------------------------------------------------------------- */
    const ro = new ResizeObserver(() => layout());
    ro.observe(surface);
    const io = new IntersectionObserver((en) => {
        visible = en[0].isIntersecting;
        if (visible) kick();
    }, { rootMargin: '60px' });
    io.observe(surface);
    // Scrolled mostly away: put the pen down.
    const away = new IntersectionObserver((en) => {
        if (armed && en[0].intersectionRect.height < Math.min(H, innerHeight) * 0.3) arm(false);
    }, { threshold: [0, 0.1, 0.2, 0.3, 0.45, 0.6] });
    away.observe(surface);
    const onScheme = () => { readColours(); rebake(); kick(); };
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', onScheme);

    readColours();
    layout();
    commit(null, true);
    root.classList.add('is-live');

    function destroy() {
        cancelAnimationFrame(raf);
        clearTimeout(blotTimer);
        ro.disconnect(); io.disconnect(); away.disconnect();
        clearTimeout(idleT); clearTimeout(nudgeT);
        pen.removeEventListener('click', onPen);
        scheme.removeEventListener('change', onScheme);
        document.removeEventListener('keydown', onDocKey);
        if (form) form.removeEventListener('reset', onReset);
        surface.removeEventListener('pointerdown', onDown);
        surface.removeEventListener('pointermove', onMove);
        surface.removeEventListener('pointerup', onUp);
        surface.removeEventListener('pointercancel', onUp);
        surface.removeEventListener('touchmove', onTouchMove);
        surface.removeEventListener('contextmenu', noMenu);
        surface.removeEventListener('keydown', onSurfaceKey);
        if (typed) {
            typed.removeEventListener('input', onTypedInput);
            typed.removeEventListener('change', onTypedChange);
            typed.removeEventListener('keydown', onTypedKey);
        }
        if (fallback && fbState) {
            fallback.className = fbState.cls;
            fallback.hidden = false;
            fallback.removeAttribute('aria-label');
            if (fbState.name) fallback.name = fbState.name;
            fallback.required = fbState.required;
            fbState.parent.insertBefore(fallback, fbState.next && fbState.next.parentNode === fbState.parent ? fbState.next : null);
        }
        for (const el of added.reverse()) el.remove();
        if (!ownSurface) {
            surface.removeAttribute('tabindex'); surface.removeAttribute('role');
            surface.removeAttribute('aria-describedby'); surface.removeAttribute('aria-label');
        }
        root.classList.remove('ip', 'ip--margin', 'ip--signature', 'is-live', 'has-ink', 'is-typing', 'is-invalid', 'is-blotting', 'is-pointer', 'is-guarded', 'is-armed');
        if (lastPad === api) lastPad = null;
        delete root.__inkPad;
    }
    const api = Object.assign(destroy, { undo, redo, clear: (instant) => clear(instant), toSVG, toPNG, isEmpty });
    root.__inkPad = api;
    return api;
}

document.querySelectorAll('[data-ink-pad]').forEach((el) => inkPad(el));
