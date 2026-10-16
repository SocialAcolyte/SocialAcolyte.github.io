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
    let R = 0;
    let p = 0;           // scroll progress 0..1
    let idle = 0;        // slow turn once the ring is formed, radians
    let hover = -1;
    let px = -1e9;       // pointer, stage-relative, from centre
    let py = -1e9;
    let tilt = 0;
    let visible = false;
    let raf = 0;
    let last = 0;

    function size() {
        const r = stage.getBoundingClientRect();
        W = r.width;
        H = r.height;
        const narrow = W < 700;
        const U = Math.min(W, H * (narrow ? 0.78 : 1));
        cw = U * (narrow ? 0.27 : 0.19);
        ch = cw * 4 / 3;
        // Ring radius leaves the outermost card's far corner inside the stage.
        R = Math.max(40, U * 0.5 - ch * 0.5 - U * 0.035);
        root.style.setProperty('--cw', cw.toFixed(1) + 'px');
        root.style.setProperty('--ch', ch.toFixed(1) + 'px');
        root.style.setProperty('--ring', R.toFixed(1) + 'px');
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
        if (!calm) idle += dt * 0.07 * easeInOut(formed);

        const stagger = 0.016;
        // The whole ring turns as one on the way out; each card adds a little
        // lag of its own, so the arms read as a spiral, not an arc.
        const g = easeInOut(clamp(p / 0.92));
        const span = 1 - stagger * (N - 1);

        for (let i = 0; i < N; i++) {
            const q = easeInOut(clamp((p - ((i * 5) % N) * stagger) / span));   // interleaved departures
            const home = (i / N) * TAU - Math.PI / 2;            // seat on the ring
            // Each card makes one full revolution on its way out: it starts a
            // turn behind its seat and arrives exactly on it.
            const ang = home + idle - (1 - g) * TAU * 1.25 - (1 - q) * (0.9 + seed[i] * 0.7);
            const rad = R * easeOut(q);
            const x = Math.cos(ang) * rad;
            const y = Math.sin(ang) * rad;

            // Face outward on the ring; tumble loosely while in flight.
            const startRot = (seed[i] - 0.5) * 38;
            const outward = (ang * 180) / Math.PI + 90;
            const rot = startRot * (1 - q) + outward * q;
            const scale = 0.5 + 0.5 * easeOut(q);

            // Hover: the card under the pointer lifts toward you.
            const gx = Math.cos(home + idle) * R;
            const gy = Math.sin(home + idle) * R;
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
        stage.style.setProperty('--tilt', tilt.toFixed(2) + 'deg');

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
