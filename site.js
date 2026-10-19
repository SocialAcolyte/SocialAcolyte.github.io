/*
 *  SITE LAYER // opening mosaic, image pools, scroll scenes, portrait rotation
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

    /* --- Collections from ornaments/pools.json ------------------------
       Stamps for the album and textiles for the weave tiles. */

    fetch('ornaments/pools.json').then((r) => r.json()).then((P) => {
        const stamps = shuffle(P.stamps || []);
        document.querySelectorAll('.album-row').forEach((row, ri) => {
            // each row gets a rotated slice of the collection, doubled so it's long enough to slide
            const slice = stamps.slice(ri * 3).concat(stamps.slice(0, ri * 3));
            slice.concat(slice).forEach((st, i) => {
                const f = document.createElement('figure');
                f.className = 'stamp';
                f.style.setProperty('--tilt', ((Math.random() - 0.5) * 6).toFixed(1) + 'deg');
                f.style.setProperty('--delay', (i * 40) + 'ms');
                const img = new Image();
                img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
                img.src = st.lg;
                img.style.aspectRatio = st.r;
                img.addEventListener('load', () => window.dispatchEvent(new Event('scroll')), { once: true });
                f.appendChild(img);
                const item = document.createElement('div');
                item.className = 'stamp-item';
                const cap = document.createElement('p');
                cap.className = 'stamp-cap';
                cap.innerHTML = `<b>${st.label || ''}</b><span>${st.meta || ''}</span>`;
                item.append(f, cap);
                row.appendChild(item);
            });
        });

        // each weave tile shows a textile of its own kind (data-match), else any unused one
        const textiles = shuffle(P.textiles || []);
        const used = new Set();
        document.querySelectorAll('img[data-pool="textile"]').forEach((img) => {
            const re = new RegExp(img.dataset.match || '.', 'i');
            const pick = textiles.find((t) => !used.has(t) && re.test(t.lg))
                || textiles.find((t) => !used.has(t)) || textiles[0];
            if (!pick) return;
            used.add(pick);
            img.src = pick.lg;
            fadeIn(img);
        });
        window.dispatchEvent(new Event('scroll'));
    }).catch(() => {});

    /* --- Scroll scenes: mosaic bloom, album, procession --------
       One rAF loop reads each scene's position and writes CSS variables. */

    const clamp01 = (v) => Math.min(1, Math.max(0, v));
    const ease = (t) => t * t * (3 - 2 * t);
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

        // album: rows of stamps slide in opposite directions while the album is pinned
        const album = document.querySelector('[data-scroll="album"]');
        if (album) {
            const r = album.getBoundingClientRect();
            const p = clamp01(-r.top / Math.max(1, r.height - vh));
            if (r.top < vh * 0.7) album.classList.add('is-in');
            for (const row of album.querySelectorAll('.album-row')) {
                const extra = Math.max(0, row.scrollWidth - vw);
                const x = Number(row.dataset.dir) > 0 ? -p * extra : -(1 - p) * extra;
                row.style.setProperty('--x', x.toFixed(1) + 'px');
            }
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

    /* --- Opening: one flower mosaic, a different one each visit ------ */

    const opening = document.querySelector('.pan-img');
    if (opening) {
        // high-resolution webp, so the mosaic stays crisp on large and retina screens
        const FLOWERS = ['flower-06', 'flower-07', 'flower-08', 'flower-18', 'flower-20', 'flower-23',
            'flower-44', 'flower-46', 'florence-pietra-dura', 'cuerda-seca-tiles', 'blake-flowers', 'floral-brooch'];
        opening.src = `ornaments/flowers/${FLOWERS[Math.floor(Math.random() * FLOWERS.length)]}.webp`;
        fadeIn(opening);
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
