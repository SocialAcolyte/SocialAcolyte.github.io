/*
 *  DETAILS // ornate things gathered into one rosette.
 *
 *  A pinned stage. The cards start as a single stack at the centre and, as you
 *  scroll, spiral outward through a full turn, each a little behind the one
 *  before, and settle into a ring facing outward like petals. Grey to colour
 *  as each one lands. Afterwards the ring turns slowly, and the card under the
 *  pointer lifts toward you.
 *
 *  Everything is centred on the stage and sized from the viewport, so nothing
 *  is cut off at any width. With reduced motion the finished ring is shown and
 *  nothing moves. Without JS the cards fall back to a plain grid.
 */
(() => {
    'use strict';
    const root = document.querySelector('[data-details]');
    if (!root) return;
    const stage = root.querySelector('.details-stage');
    const cards = [...root.querySelectorAll('.d-card')];
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const N = cards.length;
    if (!N) return;

    root.classList.add('is-live');

    // Phone orientation: the ring parallaxes in depth and tilting spins it like a wheel.
    let tilt = { x: 0, y: 0, active: false };
    import('./tilt.js?v=2').then((m) => { tilt = m.default; kick(); }).catch(() => {});
    let spinV = 0;

    const TAU = Math.PI * 2;
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const easeOut = (t) => 1 - Math.pow(1 - t, 3);
    const easeInOut = (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    // Stable pseudo-random start pose per card, so the stack looks hand-dropped.
    const seed = cards.map((_, i) => {
        const s = Math.sin((i + 1) * 91.7) * 10000;
        return s - Math.floor(s);
    });

    let W = 0;
    let H = 0;
    let cw = 0;
    let ch = 0;
    let Rx = 0;          // ring half-width
    let Ry = 0;          // ring half-height (a tall phone gets an ellipse)
    let p = 0;           // scroll progress 0..1
    let idle = 0;        // slow turn once the ring is formed, radians
    let hover = -1;
    let px = -1e9;       // pointer, stage-relative, from centre
    let py = -1e9;
    let visible = false;
    let raf = 0;
    let last = 0;

    function size() {
        const r = stage.getBoundingClientRect();
        W = r.width;
        H = r.height;
        const narrow = W < 700;
        if (narrow) {
            // Phone: a tall ellipse using most of the screen, so there is room
            // between the cards and in the middle for words.
            cw = W * 0.2;
            ch = cw * 4 / 3;
            Rx = W * 0.5 - cw * 0.66 - 12;
            Ry = H * 0.5 - ch * 0.62 - 18;
        } else {
            const U = Math.min(W, H);
            cw = U * 0.19;
            ch = cw * 4 / 3;
            Rx = Ry = Math.max(40, U * 0.5 - ch * 0.5 - U * 0.035);
        }
        Rx = Math.max(40, Rx);
        Ry = Math.max(40, Ry);
        buildArc();
        // Set on the stage itself: the stylesheet declares fallbacks there, so
        // a value set on the section would be shadowed.
        stage.style.setProperty('--cw', cw.toFixed(1) + 'px');
        stage.style.setProperty('--ch', ch.toFixed(1) + 'px');
        fitWord();
    }

    /* ---------------------------------------------------- the words, fitted
       pretext measures the phrase without touching the DOM, so the biggest
       size that fits the hole is found by arithmetic, then the width is
       tightened to the narrowest that keeps the same line count (balanced
       lines, no orphan). Recomputed on every resize. */
    const word = root.querySelector('.details-word h2');
    let api = null;
    let fitToken = 0;

    async function fitWord() {
        if (!word) return;
        const token = ++fitToken;
        try {
            api = api || await import('./vendor/pretext/layout.js');
            await document.fonts.load('400 40px "Cormorant Garamond"');
        } catch (e) { return; }              // CSS fallback size stays
        if (token !== fitToken) return;

        const text = word.textContent.trim();
        // Largest box the words may fill: inside the ring, clear of the cards.
        const bw = 2 * (Rx - ch * 0.5) * (W < 700 ? 0.82 : 0.9);
        const bh = 2 * (Ry - ch * 0.5) * (W < 700 ? 0.5 : 0.66);
        if (bw < 60 || bh < 40) return;

        const family = getComputedStyle(word).fontFamily;
        const prep = (px) => api.prepare(text, `400 ${px}px ${family}`);
        const fits = (px) => api.layout(prep(px), bw, px * 1.04).height <= bh;

        let lo = 14;
        let hi = Math.min(96, bw / 2.4);
        for (let i = 0; i < 8; i++) {
            const mid = (lo + hi) / 2;
            fits(mid) ? (lo = mid) : (hi = mid);
        }
        const px = Math.floor(lo);
        const P = prep(px);
        const lines = api.layout(P, bw, px * 1.04).lineCount;

        // Narrowest width that still gives the same number of lines.
        let a = 40;
        let b = bw;
        for (let i = 0; i < 9; i++) {
            const mid = (a + b) / 2;
            api.layout(P, mid, px * 1.04).lineCount <= lines ? (b = mid) : (a = mid);
        }
        word.style.fontSize = px + 'px';
        word.style.lineHeight = '1.04';
        word.style.width = Math.ceil(b + 6) + 'px';
        word.style.maxWidth = 'none';
    }

    /* Equal spacing round the ring. Stepping evenly in angle bunches cards up
       at the ends of a tall ellipse, so seats are placed by arc length instead:
       thetaAt(f) is the angle of the point a fraction f round the perimeter,
       starting at the top. On a circle it is the same as stepping in angle. */
    const ARC = 256;
    const arc = new Float32Array(ARC + 1);
    let arcLen = 1;
    function buildArc() {
        let acc = 0;
        let lx = 0;
        let ly = -Ry;
        arc[0] = 0;
        for (let k = 1; k <= ARC; k++) {
            const t = -Math.PI / 2 + (k / ARC) * TAU;
            const x = Math.cos(t) * Rx;
            const y = Math.sin(t) * Ry;
            acc += Math.hypot(x - lx, y - ly);
            arc[k] = acc;
            lx = x;
            ly = y;
        }
        arcLen = acc || 1;
    }
    function thetaAt(f) {
        const target = (((f % 1) + 1) % 1) * arcLen;
        let lo = 0;
        let hi = ARC;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            arc[mid] <= target ? (lo = mid) : (hi = mid);
        }
        const span = arc[hi] - arc[lo] || 1;
        const k = lo + (target - arc[lo]) / span;
        return -Math.PI / 2 + (k / ARC) * TAU;
    }

    function progress() {
        if (calm) return 1;
        const r = root.getBoundingClientRect();
        const run = r.height - innerHeight;
        return run > 0 ? clamp(-r.top / (run * 0.78)) : 1;
    }

    function frame(t) {
        raf = 0;
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016;
        last = t;
        p = progress();

        // The ring only starts turning once it has formed.
        const formed = clamp((p - 0.86) / 0.14);
        spinV += ((0.07 + (tilt.active ? tilt.x * 0.9 : 0)) - spinV) * Math.min(1, dt * 3);
        if (!calm) idle += dt * spinV * easeInOut(formed);

        const stagger = 0.016;
        // The whole ring turns as one on the way out; each card adds a little
        // lag of its own, so the arms read as a spiral, not an arc.
        const g = easeInOut(clamp(p / 0.92));
        const span = 1 - stagger * (N - 1);

        for (let i = 0; i < N; i++) {
            const q = easeInOut(clamp((p - ((i * 5) % N) * stagger) / span));   // interleaved departures
            const seat = i / N;                                      // fraction round the ring
            // Each card makes one full revolution on its way out: it starts a
            // turn behind its seat and arrives exactly on it.
            const lag = idle / TAU - (1 - g) * 1.25 - (1 - q) * (0.9 + seed[i] * 0.7) / TAU;
            const ang = thetaAt(seat + lag);
            const e = easeOut(q);
            // Depth layers drift against the tilt, so the ring has thickness.
            const depth = 0.4 + (i % 3) * 0.3;
            const par = tilt.active ? formed : 0;
            const x = Math.cos(ang) * Rx * e - tilt.x * depth * 13 * par;
            const y = Math.sin(ang) * Ry * e - tilt.y * depth * 13 * par;

            // Face outward on the ring; tumble loosely while in flight.
            const startRot = (seed[i] - 0.5) * 38;
            // Outward = along the ring's normal (not the polar angle) on an ellipse.
            const outward = W < 700
                ? Math.cos(ang) * 14        // phone: upright, leaning a little outward
                : (Math.atan2(Math.sin(ang) / Ry, Math.cos(ang) / Rx) * 180) / Math.PI + 90;
            const rot = startRot * (1 - q) + outward * q;
            const scale = 0.5 + 0.5 * easeOut(q);

            // Hover: the card under the pointer lifts toward you.
            const hv = thetaAt(seat + idle / TAU);
            const gx = Math.cos(hv) * Rx;
            const gy = Math.sin(hv) * Ry;
            let lift = 0;
            if (formed > 0.9 && !calm) {
                const d = Math.hypot(px - gx, py - gy);
                lift = clamp(1 - d / (ch * 0.62));
            }
            lift = lift * lift * (3 - 2 * lift);
            const k = cards[i];
            k._lift = k._lift == null ? lift : k._lift + (lift - k._lift) * 0.18;

            k.style.transform =
                `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${(scale * (1 + k._lift * 0.2)).toFixed(3)})`;
            k.style.zIndex = String(10 + i + Math.round(k._lift * 100));
            k.style.setProperty('--c', q.toFixed(3));              // colour blooms with arrival
        }

        root.style.setProperty('--p', p.toFixed(4));
        root.style.setProperty('--formed', formed.toFixed(3));
        stage.style.setProperty('--tx', (tilt.active ? tilt.x : 0).toFixed(3));
        stage.style.setProperty('--ty', (tilt.active ? tilt.y : 0).toFixed(3));

        const moving = !calm && visible;
        if (moving) raf = requestAnimationFrame(frame);
    }

    const kick = () => { if (!raf && (visible || calm)) raf = requestAnimationFrame(frame); };

    stage.addEventListener('pointermove', (e) => {
        const r = stage.getBoundingClientRect();
        px = e.clientX - r.left - r.width / 2;
        py = e.clientY - r.top - r.height / 2;
    });
    stage.addEventListener('pointerleave', () => { px = py = -1e9; });

    new IntersectionObserver((en) => {
        visible = en[0].isIntersecting;
        if (visible) { last = 0; kick(); }
    }, { rootMargin: '80px' }).observe(root);

    addEventListener('resize', () => { size(); kick(); }, { passive: true });
    addEventListener('scroll', kick, { passive: true });
    document.fonts && document.fonts.ready.then(() => { size(); kick(); });

    size();
    kick();
})();
