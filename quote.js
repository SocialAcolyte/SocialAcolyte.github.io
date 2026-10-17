/*
 *  QUOTE // a sentence that assembles itself as you scroll.
 *
 *  Inspired by Cheng Lou's pretext (vendor/pretext, MIT). pretext breaks the
 *  quote into balanced lines by arithmetic, at whatever width the screen is, so
 *  the final layout is exact on every phone and desktop. Each word then flies
 *  in from its own scattered pose, grey to ink, and lands on its measured spot.
 *  Once assembled, a finger or pointer pushes words aside and a spring brings
 *  them home.
 *
 *  The real <p> stays in the DOM (screen readers, selection, no-JS, print).
 *  Reduced motion: the finished sentence, still.
 */

const root = document.querySelector('[data-quote]');
const src = root && root.querySelector('.quote-src');
const stage = root && root.querySelector('.quote-stage');
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const mix = (a, b, t) => a + (b - a) * t;

async function boot() {
    let api;
    try { api = await import('./vendor/pretext/layout.js'); } catch (e) { return; }

    const text = src.textContent.replace(/\s+/g, ' ').trim();
    const cs = getComputedStyle(src);
    const family = cs.fontFamily;
    try { await document.fonts.load(`400 48px ${family}`); await document.fonts.ready; } catch (e) { /* fall through */ }

    const canvas = document.createElement('canvas');
    canvas.className = 'quote-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    stage.appendChild(canvas);

    let W = 0, H = 0, dpr = 1, px = 0, lh = 0;
    let words = [];
    let p = 0;
    let visible = false;
    let raf = 0;
    let last = 0;
    const ptr = { x: -1e9, y: -1e9 };
    let tilt = { x: 0, y: 0, active: false };
    import('./tilt.js?v=2').then((m) => { tilt = m.default; kick(); }).catch(() => {});

    const seed = (i, k) => {
        const s = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
        return s - Math.floor(s);
    };

    function layout() {
        const r = stage.getBoundingClientRect();
        W = Math.round(r.width);
        H = Math.round(r.height);
        dpr = Math.min(2, devicePixelRatio || 1);
        canvas.width = W * dpr;
        canvas.height = H * dpr;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        // Biggest size that fits the box, then the narrowest width that keeps
        // the same line count: balanced lines, no orphan.
        const bw = W * (W < 700 ? 0.86 : 0.74);
        const bh = H * (W < 700 ? 0.5 : 0.56);
        const spec = (s) => `400 ${s}px ${family}`;
        const prep = (s) => api.prepareWithSegments(text, spec(s));
        let lo = 18, hi = Math.min(150, bw / 3);
        for (let i = 0; i < 9; i++) {
            const mid = (lo + hi) / 2;
            api.layout(prep(mid), bw, mid * 1.08).height <= bh ? (lo = mid) : (hi = mid);
        }
        px = Math.floor(lo);
        lh = Math.round(px * 1.08);
        const P = prep(px);
        const n = api.layout(P, bw, lh).lineCount;
        let a = 60, b = bw;
        for (let i = 0; i < 9; i++) {
            const mid = (a + b) / 2;
            api.layout(P, mid, lh).lineCount <= n ? (b = mid) : (a = mid);
        }
        const bwTight = Math.ceil(b + 4);
        const lines = api.layoutWithLines(P, bwTight, lh).lines;

        ctx.font = spec(px);
        const total = lines.length * lh;
        const y0 = (H - total) / 2 - (W < 700 ? 6 : 0);
        words = [];
        let wi = 0;
        lines.forEach((ln, li) => {
            const lineX = (W - ln.width) / 2;
            const parts = ln.text.split(' ');
            let at = 0;
            parts.forEach((w) => {
                const before = ln.text.slice(0, at);
                const x = lineX + ctx.measureText(before).width;
                const hx = x;
                const hy = y0 + li * lh + px * 0.82;
                const ang = seed(wi, 1) * Math.PI * 2;
                const dist = Math.min(W, H) * (0.35 + seed(wi, 2) * 0.55);
                words.push({
                    t: w, hx, hy,
                    sx: hx + Math.cos(ang) * dist, sy: hy + Math.sin(ang) * dist,
                    sr: (seed(wi, 3) - 0.5) * 1.6,
                    ox: 0, oy: 0, vx: 0, vy: 0,
                    w: ctx.measureText(w).width,
                    depth: 0.5 + seed(wi, 4) * 0.8,
                    i: wi
                });
                at += w.length + 1;
                wi++;
            });
        });
        ctx.textBaseline = 'alphabetic';
    }

    function progress() {
        if (calm.matches) return 1;
        const r = root.getBoundingClientRect();
        const run = r.height - innerHeight;
        return run > 0 ? clamp(-r.top / (run * 0.72)) : 1;
    }

    function frame(t) {
        raf = 0;
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
        last = t;
        p = progress();
        ctx.clearRect(0, 0, W, H);
        ctx.font = `400 ${px}px ${getComputedStyle(src).fontFamily}`;
        const N = words.length;
        const stagger = 0.55 / Math.max(1, N - 1);
        let alive = false;

        for (const wd of words) {
            const q = easeInOut(clamp((p - wd.i * stagger) / 0.45));
            const settled = q >= 1;

            // Pointer pushes settled words aside; a spring brings them home.
            if (settled && !calm.matches) {
                const cx = wd.hx + wd.w / 2 + wd.ox;
                const cy = wd.hy - px * 0.3 + wd.oy;
                const dx = cx - ptr.x;
                const dy = cy - ptr.y;
                const d = Math.hypot(dx, dy);
                const reach = px * 1.6;
                if (d < reach && d > 0.01) {
                    const f = (1 - d / reach) * 900;
                    wd.vx += (dx / d) * f * dt;
                    wd.vy += (dy / d) * f * dt;
                }
                // Phone orientation: each word has its own depth and slides to
                // a resting place that moves with the tilt, like loose type.
                const tx = tilt.active ? tilt.x * wd.depth * px * 0.17 : 0;
                const ty = tilt.active ? tilt.y * wd.depth * px * 0.12 : 0;
                wd.vx += (-60 * (wd.ox - tx) - 9 * wd.vx) * dt;
                wd.vy += (-60 * (wd.oy - ty) - 9 * wd.vy) * dt;
                wd.ox += wd.vx * dt;
                wd.oy += wd.vy * dt;
                if (tilt.active || Math.abs(wd.ox) + Math.abs(wd.oy) + Math.abs(wd.vx) + Math.abs(wd.vy) > 0.05) alive = true;
                else wd.ox = wd.oy = wd.vx = wd.vy = 0;
            }

            const e = easeOut(q);
            const x = mix(wd.sx, wd.hx, e) + wd.ox;
            const y = mix(wd.sy, wd.hy, e) + wd.oy;
            const rot = wd.sr * (1 - e);
            const sc = 0.6 + 0.4 * e;
            const g = Math.round(mix(150, 20, q));          // grey to ink
            ctx.save();
            ctx.translate(x + wd.w / 2, y - px * 0.3);
            ctx.rotate(rot);
            ctx.scale(sc, sc);
            ctx.globalAlpha = clamp(q * 3);
            ctx.fillStyle = `rgb(${g},${g - 1},${g - 2})`;
            ctx.fillText(wd.t, -wd.w / 2, px * 0.3);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
        root.style.setProperty('--by', clamp((p - 0.9) / 0.1).toFixed(3));

        const moving = visible && !calm.matches;
        if (moving) raf = requestAnimationFrame(frame);
        else if (alive) raf = requestAnimationFrame(frame);
    }
    const kick = () => { if (!raf && (visible || calm.matches)) raf = requestAnimationFrame(frame); };

    stage.addEventListener('pointermove', (e) => {
        const r = stage.getBoundingClientRect();
        ptr.x = e.clientX - r.left;
        ptr.y = e.clientY - r.top;
        kick();
    });
    stage.addEventListener('pointerleave', () => { ptr.x = ptr.y = -1e9; });
    stage.addEventListener('pointerup', () => { ptr.x = ptr.y = -1e9; });
    stage.addEventListener('pointercancel', () => { ptr.x = ptr.y = -1e9; });

    new IntersectionObserver((en) => {
        visible = en[0].isIntersecting;
        if (visible) { last = 0; kick(); }
    }, { rootMargin: '80px' }).observe(root);
    addEventListener('scroll', kick, { passive: true });
    let timer = 0;
    addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { layout(); kick(); }, 150);
    }, { passive: true });

    layout();
    root.classList.add('is-live');
    kick();
}

if (root && src && stage) {
    const go = () => {
        if (!('IntersectionObserver' in window)) return boot();
        const io = new IntersectionObserver((en) => {
            if (!en[0].isIntersecting) return;
            io.disconnect();
            boot();
        }, { rootMargin: '600px' });
        io.observe(root);
    };
    document.readyState === 'complete' ? go() : addEventListener('load', go, { once: true });
}
