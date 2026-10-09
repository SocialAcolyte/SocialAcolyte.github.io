/*
 *  SITE LAYER // random image pools, scroll scenes, portrait rotation
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
    const panImg = pan?.querySelector('.pan-img');
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

        // opening: the whole portrait in black and white, easing in and warming to colour
        if (pan && panImg) {
            const r = pan.getBoundingClientRect();
            const p = clamp01(-r.top / (r.height - vh));
            const e = ease(p);
            const ratio = 751 / 507;
            const fit = Math.max(1, vw / (vh * ratio));           // scale needed to cover
            const s = fit * (1 + 0.1 * e);
            const w = vh * ratio * s, h = vh * s;
            // keep the face centred: on narrow screens it sits left of the image centre
            const fx = 0.38 + 0.04 * e, fy = 0.42;
            const tx = Math.min(0, Math.max(vw - w, vw / 2 - fx * w));
            const ty = Math.min(0, Math.max(vh - h, vh / 2 - fy * h));
            pan.style.setProperty('--p', p.toFixed(3));
            panImg.style.setProperty('--s', s.toFixed(4));
            panImg.style.setProperty('--tx', tx.toFixed(1) + 'px');
            panImg.style.setProperty('--ty', ty.toFixed(1) + 'px');
            panImg.style.setProperty('--g', (1 - clamp01(p * 1.6)).toFixed(3));
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

    /* --- Eyes: follow the pointer, or the phone's tilt ---------------
       Gaze is in portrait pixels: (0,0) is where the irises sit in the
       original (glancing right). Looking straight out is about -9px. */

    const irisHost = panImg;
    if (irisHost && !REDUCED) {
        const REST = { x: -9, y: 0 };
        const RANGE = { left: -15, right: 1, up: -3.2, down: 3.5 };
        const target = { x: REST.x, y: REST.y };
        const gaze = { x: REST.x, y: REST.y };
        const face = { x: 277 / 751, y: 187 / 507 };          // between the eyes, as a fraction of the portrait

        function aimAt(nx, ny) {                              // nx, ny in -1..1
            const x = nx < 0 ? REST.x + nx * (REST.x - RANGE.left) : REST.x + nx * (RANGE.right - REST.x);
            target.x = Math.max(RANGE.left, Math.min(RANGE.right, x));
            target.y = Math.max(RANGE.up, Math.min(RANGE.down, ny * (ny < 0 ? -RANGE.up : RANGE.down)));
        }

        window.addEventListener('pointermove', (ev) => {
            if (ev.pointerType === 'touch') return;
            const r = irisHost.getBoundingClientRect();
            const fx = r.left + face.x * r.width, fy = r.top + face.y * r.height;
            aimAt((ev.clientX - fx) / (window.innerWidth * 0.45), (ev.clientY - fy) / (window.innerHeight * 0.45));
        }, { passive: true });
        document.addEventListener('mouseleave', () => aimAt(0, 0));

        // phone tilt, measured from however it was held at first reading
        let baseline = null;
        function onTilt(ev) {
            if (ev.beta == null || ev.gamma == null) return;
            if (!baseline) baseline = { b: ev.beta, g: ev.gamma };
            aimAt((ev.gamma - baseline.g) / 22, (ev.beta - baseline.b) / 22);
        }
        const listenTilt = () => window.addEventListener('deviceorientation', onTilt, { passive: true });
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS asks permission, and only from a tap
            window.addEventListener('touchend', function ask() {
                DeviceOrientationEvent.requestPermission().then((s) => { if (s === 'granted') listenTilt(); }).catch(() => {});
                window.removeEventListener('touchend', ask);
            }, { passive: true });
        } else {
            listenTilt();
        }

        let gazeVisible = true;
        new IntersectionObserver((en) => { gazeVisible = en[0].isIntersecting; if (gazeVisible) requestAnimationFrame(look); })
            .observe(pan);

        function look() {
            gaze.x += (target.x - gaze.x) * 0.12;
            gaze.y += (target.y - gaze.y) * 0.12;
            irisHost.style.setProperty('--gx', gaze.x.toFixed(2));
            irisHost.style.setProperty('--gy', gaze.y.toFixed(2));
            if (gazeVisible) requestAnimationFrame(look);
        }
        requestAnimationFrame(look);
    } else if (irisHost) {
        irisHost.style.setProperty('--gx', '-9');
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
