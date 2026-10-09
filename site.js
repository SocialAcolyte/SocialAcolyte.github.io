/*
 *  SITE LAYER // flower-tile opening, image pools, scroll scenes, portrait rotation
 *  Vanilla, no dependencies. effects.js (letter swap, click burst) runs alongside.
 */

(() => {
    'use strict';

    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* --- Image pools — every visit draws a different set ------------- */

    const md = (n) => `ornaments/md/${n}.jpg`;
    const sm = (g, n) => `ornaments/sm/${n}.jpg`;
    const sticker = (n) => `ornaments/stickers/${n}.png`;

    const STATUES = ['nike-samothrace', 'venus-milo', 'laocoon', 'discobolus', 'apollo-belvedere',
        'artemision-bronze', 'riace-bronze-a', 'hermes-praxiteles', 'dying-gaul', 'barberini-faun',
        'farnese-hercules', 'kritios-boy'];
    const ALEXANDER = ['alexander-azara-herm', 'alexander-bust-bm', 'alexander-capitoline',
        'alexander-pella-head', 'alexander-sarcophagus', 'alexander-tetradrachm', 'alexander-mosaic-detail'];
    const MOSAICS = ['alexander-mosaic', 'pella-stag-hunt', 'pella-dionysus-panther', 'nile-mosaic',
        'san-vitale-justinian', 'san-vitale-theodora', 'galla-placidia-stars', 'unswept-floor',
        'hagia-sophia-deesis', 'capitoline-doves', 'monreale-pantocrator', 'sant-apollinare-virgins'];
    const TAROT = ['00-fool', '01-magician', '02-popess', '06-love', '07-chariot', '08-justice',
        '09-time', '10-fortune', '13-death', '14-temperance', '17-star', '18-moon', '19-sun', '21-world'];
    const STICKERS = ['armor', 'angel', 'shark', 'hood'];

    const POOLS = {
        // directory cells: everything, small
        dir: [...STATUES.map((n) => sm('', n)), ...ALEXANDER.map((n) => sm('', n)),
            ...MOSAICS.map((n) => sm('', n)), ...TAROT.map((n) => `tarot/sm/${n}.jpg`),
            ...STICKERS.map(sticker)],
        // full-bleed portrait stand-ins until there's a photo of Connor
        person: [...ALEXANDER.filter((n) => n !== 'alexander-tetradrachm').map(md),
            md('laocoon'), md('dying-gaul'), md('artemision-bronze')],
    };

    const shuffle = (arr) => {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    };
    const decks = Object.fromEntries(Object.entries(POOLS).map(([k, v]) => [k, shuffle(v)]));
    const draw = (pool) => decks[pool].pop() || POOLS[pool][0];

    function fadeIn(img) {
        const done = () => img.classList.add('is-in');
        img.complete && img.naturalWidth ? done() : img.addEventListener('load', done, { once: true });
    }

    document.querySelectorAll('img[data-pool="dir"]').forEach((img) => {
        img.loading = 'lazy';
        img.src = draw(img.dataset.pool);
        fadeIn(img);
    });

    /* --- Portrait: slow crossfade, hover a line to swap ---------------- */

    const person = document.querySelector('.person');
    const layers = person ? [...person.querySelectorAll('.person-bg img')] : [];
    const personDeck = shuffle(POOLS.person);
    let front = 0;
    let at = 0;

    function show(src) {
        if (!layers.length) return;
        const next = layers[1 - front];
        next.onload = () => {
            next.classList.add('is-on');
            layers[front].classList.remove('is-on');
            front = 1 - front;
        };
        next.src = src;
    }
    const advance = () => show(personDeck[at++ % personDeck.length]);

    if (person) {
        // load the first portrait only when the section comes near
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) { advance(); io.disconnect(); }
        }, { rootMargin: '400px 0px' });
        io.observe(person);

        let timer = REDUCED ? null : setInterval(advance, 6000);

        const lines = person.querySelector('.person-lines');
        lines.querySelectorAll('li').forEach((li, i) => {
            li.addEventListener('mouseenter', () => {
                clearInterval(timer);
                lines.classList.add('is-hovering');
                li.classList.add('is-active');
                show(personDeck[(i * 3) % personDeck.length]);
            });
            li.addEventListener('mouseleave', () => {
                li.classList.remove('is-active');
                lines.classList.remove('is-hovering');
                if (!REDUCED) timer = setInterval(advance, 6000);
            });
        });
    }

    /* --- Scroll scenes: opening pan, mosaic bloom, procession --------
       One rAF loop reads each scene's position and writes CSS variables. */

    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const ease = (t) => t * t * (3 - 2 * t);
    const pan = document.querySelector('[data-scroll="pan"]');
    let bloomProgress = 0;
    const bands = [...document.querySelectorAll('[data-scroll="band"]')];
    const proc = document.querySelector('[data-scroll="procession"]');
    const track = proc?.querySelector('.procession-track');

    function sizeProcession() {
        if (!proc || !track) return;
        const extra = Math.max(0, track.scrollWidth - window.innerWidth);
        proc.style.height = (window.innerHeight + extra) + 'px';
    }

    function scenes() {
        const vh = window.innerHeight;
        const vw = document.documentElement.clientWidth;

        // opening: publish scroll progress (title fade + flower growth read it)
        if (pan) {
            const r = pan.getBoundingClientRect();
            const p = clamp01(-r.top / (r.height - vh));
            pan.style.setProperty('--p', p.toFixed(3));
            bloomProgress = p;
        }

        // bands: parallax drift + bloom into colour near the middle of the screen
        for (const b of bands) {
            const r = b.getBoundingClientRect();
            if (r.bottom < -200 || r.top > vh + 200) continue;
            const centre = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);  // -1..1
            const bloom = clamp01(1 - Math.abs(centre) * 1.6);
            b.style.setProperty('--bloom', ease(bloom).toFixed(3));
            b.style.setProperty('--t', clamp01(bloom * 1.8).toFixed(3));
            b.querySelector('.band-img')?.style.setProperty('--py', (centre * r.height * 0.12).toFixed(1) + 'px');
        }

        // procession: vertical scroll becomes sideways travel
        if (proc && track) {
            const r = proc.getBoundingClientRect();
            const span = r.height - vh;
            const p = span > 0 ? clamp01(-r.top / span) : 0;
            track.style.setProperty('--x', (-p * Math.max(0, track.scrollWidth - vw)).toFixed(1) + 'px');
        }
    }

    let queued = false;
    const tick = () => { queued = false; scenes(); };
    const queue = () => { if (!queued) { queued = true; requestAnimationFrame(tick); } };

    if (REDUCED) {
        bands.forEach((b) => { b.style.setProperty('--bloom', '1'); b.style.setProperty('--t', '1'); });
    } else {
        window.addEventListener('scroll', queue, { passive: true });
        window.addEventListener('resize', () => { sizeProcession(); queue(); }, { passive: true });
        track?.querySelectorAll('img').forEach((i) => i.addEventListener('load', () => { sizeProcession(); queue(); }, { once: true }));
        sizeProcession();
        queue();
    }

    /* --- Opening: the flower mosaic as live tiles --------------------
       A random flower mosaic is cut into a grid of tiles drawn on a canvas.
       Scrolling grows the tiles outward from the centre and blooms them
       from black and white into colour; tiles near the pointer (or the
       spot the phone's tilt points at) lift and turn toward it.          */

    const canvas = document.querySelector('.bloom');
    if (canvas) {
        const FLOWERS = ['00', '06', '07', '08', '18', '20', '23', '44', '46']
            .map((n) => `ornaments/flowers/flower-${n}.jpg`);
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.src = FLOWERS[Math.floor(Math.random() * FLOWERS.length)];

        let W = 0, H = 0, dpr = 1, T = 20, cols = 0, rows = 0;
        let tiles = [];
        let grey = null;                                   // black-and-white copy of the mosaic
        const pointer = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, active: false };
        let intro = REDUCED ? 1 : 0;                       // the first small blossom on arrival
        let introStart = 0;
        let visible = true;
        let running = false;

        function layout() {
            const r = canvas.getBoundingClientRect();
            W = r.width; H = r.height;
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            canvas.width = Math.round(W * dpr);
            canvas.height = Math.round(H * dpr);
            T = W < 720 ? 15 : Math.max(18, Math.min(26, W / 64));
            cols = Math.ceil(W / T) + 1;
            rows = Math.ceil(H / T) + 1;
            const cx = W / 2, cy = H * 0.46;
            const maxD = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
            tiles = [];
            for (let j = 0; j < rows; j++) {
                for (let i = 0; i < cols; i++) {
                    // offset alternate rows a little, like laid tesserae
                    const x = i * T + (j % 2 ? T * 0.18 : 0), y = j * T;
                    const d = Math.hypot(x + T / 2 - cx, y + T / 2 - cy) / maxD;
                    tiles.push({
                        x, y, d,
                        jit: Math.random(),
                        rot: (Math.random() - 0.5) * 0.09,     // settled tilt, hand-laid
                        size: 0.86 + Math.random() * 0.1,
                        lift: 0,
                    });
                }
            }
            makeGrey();
            kick();
        }

        // cover-fit the mosaic to the canvas; returns source rect for a tile
        let fit = null;
        function computeFit() {
            if (!img.naturalWidth) return;
            const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
            fit = { s, ox: (W - img.naturalWidth * s) / 2, oy: (H - img.naturalHeight * s) / 2 };
        }
        function makeGrey() {
            computeFit();
            if (!fit) return;
            const g = document.createElement('canvas');
            g.width = img.naturalWidth; g.height = img.naturalHeight;
            const gc = g.getContext('2d');
            gc.filter = 'grayscale(1) contrast(1.08)';
            gc.drawImage(img, 0, 0);
            grey = g;
        }

        function frame(now) {
            running = false;
            if (!fit || !grey) return;
            if (intro < 1) {
                if (!introStart) introStart = now;
                intro = Math.min(1, (now - introStart) / 1600);
            }
            pointer.x += (pointer.tx - pointer.x) * 0.18;
            pointer.y += (pointer.ty - pointer.y) * 0.18;

            const p = bloomProgress;
            // growth front: a small blossom on arrival, the full field by ~70% scroll
            const grow = 0.36 * ease(intro) + p * 1.15;
            const colour = p * 1.35;                        // colour wave trails the growth
            const R = Math.max(W, H) * 0.16;
            let busy = intro < 1 || Math.abs(pointer.tx - pointer.x) > 0.5;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = '#15120e';
            ctx.fillRect(0, 0, W, H);

            for (const t of tiles) {
                const g = clamp01((grow - t.d * 0.92 - t.jit * 0.08) / 0.09);
                if (g <= 0) { t.lift = 0; continue; }
                const e = 1 - Math.pow(1 - g, 3);             // ease out
                // pointer lens
                const dx = t.x + T / 2 - pointer.x, dy = t.y + T / 2 - pointer.y;
                const near = pointer.active ? Math.max(0, 1 - Math.hypot(dx, dy) / R) : 0;
                const target = near * near;
                t.lift += (target - t.lift) * 0.2;
                if (Math.abs(target - t.lift) > 0.01) busy = true;

                const sz = T * t.size * e * (1 + t.lift * 0.55);
                const ang = t.rot * (2 - e) + t.lift * Math.atan2(dy, dx) * 0.25 + (1 - e) * (t.jit - 0.5) * 1.6;
                const cx = t.x + T / 2 - (dx / (Math.hypot(dx, dy) + 1)) * t.lift * T * 0.6;
                const cy = t.y + T / 2 - (dy / (Math.hypot(dx, dy) + 1)) * t.lift * T * 0.6;
                // source square in the image under this tile
                const sx = (t.x - fit.ox) / fit.s, sy = (t.y - fit.oy) / fit.s, ss = T / fit.s;
                const c = clamp01((colour - t.d * 0.9) / 0.25);

                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(ang);
                if (c < 1) ctx.drawImage(grey, sx, sy, ss, ss, -sz / 2, -sz / 2, sz, sz);
                if (c > 0) {
                    ctx.globalAlpha = c;
                    ctx.drawImage(img, sx, sy, ss, ss, -sz / 2, -sz / 2, sz, sz);
                }
                if (t.lift > 0.05) {                           // a glint on lifted tiles
                    ctx.globalAlpha = t.lift * 0.22;
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
                }
                ctx.restore();
            }
            if (busy && visible) kick();
        }

        function kick() {
            if (!running && visible) { running = true; requestAnimationFrame(frame); }
        }

        img.addEventListener('load', () => { layout(); }, { once: true });
        if (img.complete && img.naturalWidth) layout();
        window.addEventListener('resize', () => { clearTimeout(layout.t); layout.t = setTimeout(layout, 150); }, { passive: true });
        window.addEventListener('scroll', kick, { passive: true });
        new IntersectionObserver((en) => { visible = en[0].isIntersecting; kick(); }).observe(canvas);

        if (!REDUCED) {
            window.addEventListener('pointermove', (ev) => {
                if (ev.pointerType === 'touch') return;
                const r = canvas.getBoundingClientRect();
                pointer.tx = ev.clientX - r.left; pointer.ty = ev.clientY - r.top;
                if (!pointer.active) { pointer.x = pointer.tx; pointer.y = pointer.ty; }
                pointer.active = true;
                kick();
            }, { passive: true });
            document.addEventListener('mouseleave', () => { pointer.active = false; kick(); });

            // phone: tilt steers a point across the mosaic, from however it was first held
            let base = null;
            const onTilt = (ev) => {
                if (ev.beta == null || ev.gamma == null) return;
                if (!base) base = { b: ev.beta, g: ev.gamma };
                const nx = Math.max(-1, Math.min(1, (ev.gamma - base.g) / 20));
                const ny = Math.max(-1, Math.min(1, (ev.beta - base.b) / 20));
                pointer.tx = W / 2 + nx * W * 0.45;
                pointer.ty = H * 0.46 + ny * H * 0.4;
                if (!pointer.active) { pointer.x = pointer.tx; pointer.y = pointer.ty; }
                pointer.active = true;
                kick();
            };
            const listenTilt = () => window.addEventListener('deviceorientation', onTilt, { passive: true });
            if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
                // iOS asks permission, and only from a tap
                window.addEventListener('touchend', function ask() {
                    DeviceOrientationEvent.requestPermission().then((st) => { if (st === 'granted') listenTilt(); }).catch(() => {});
                    window.removeEventListener('touchend', ask);
                }, { passive: true });
            } else {
                listenTilt();
            }
        }
    }

    /* --- Surface extension easter egg -------------------------------- */

    const gem = document.querySelector('.srf-gem');
    if (gem) {
        const activate = () => gem.classList.add('srf-active');
        if (document.getElementById('srf-highlight-styles')) {
            activate();
        } else {
            const mo = new MutationObserver((muts) => {
                for (const m of muts) for (const n of m.addedNodes) {
                    if (n.nodeType === 1 && n.id === 'srf-highlight-styles') { activate(); mo.disconnect(); return; }
                }
            });
            mo.observe(document.head, { childList: true });
        }
    }
})();
