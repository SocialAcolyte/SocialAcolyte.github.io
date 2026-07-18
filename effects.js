/*
 *  ======================================================================
 *  INTERACTION LAYER // CLICK BURST + LETTER SWAP + PIXELATE REVEAL
 *  Vanilla ports of the Originkit components — no GSAP, no framer-motion,
 *  no build step. Zero dependencies.
 *  ======================================================================
 */

(() => {
    'use strict';

    const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const SVG_NS = 'http://www.w3.org/2000/svg';

    /* --- Shared easing ------------------------------------------------ */

    // GSAP power2.out
    const cubicOut = (t) => 1 - Math.pow(1 - t, 3);

    // cubic-bezier solver (ported from the Pixelate Image component)
    function cubicBezier(x1, y1, x2, y2) {
        const cx = 3 * x1;
        const bx = 3 * (x2 - x1) - cx;
        const ax = 1 - cx - bx;
        const cy = 3 * y1;
        const by = 3 * (y2 - y1) - cy;
        const ay = 1 - cy - by;
        const fx = (t) => ((ax * t + bx) * t + cx) * t;
        const dfx = (t) => (3 * ax * t + 2 * bx) * t + cx;
        return (x) => {
            if (x <= 0) return 0;
            if (x >= 1) return 1;
            let t = x;
            for (let i = 0; i < 8; i++) {
                const e = fx(t) - x;
                const d = dfx(t);
                if (Math.abs(e) < 1e-5 || d === 0) break;
                t -= e / d;
            }
            return ((ay * t + by) * t + cy) * t;
        };
    }
    const easeOut = cubicBezier(0, 0, 0.58, 1);


    /* --- 1. Click burst ------------------------------------------------
       Four short strokes fling outward from every click.
       Mode: "burst", rotation 357, otherwise component defaults.       */

    const BURST = {
        color: '#f0ece4',
        duration: 300,           // ms
        strokeWidth: 2,
        size: 90,
        rotation: 357,
        angles: [45, 80, 115, 150].map((a) => (a * Math.PI) / 180),
    };

    function initBurst() {
        if (REDUCED) return;

        const layer = document.createElement('div');
        layer.style.cssText =
            'position:fixed;inset:0;pointer-events:none;z-index:9999;overflow:visible;';
        document.body.appendChild(layer);

        document.addEventListener('click', (e) => spawn(e.clientX, e.clientY));

        function spawn(x, y) {
            const s = BURST.size;
            const c = s / 2;

            const svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('width', s);
            svg.setAttribute('height', s);
            svg.style.cssText =
                `position:absolute;left:${x - c}px;top:${y - c}px;` +
                `overflow:visible;transform:rotate(${BURST.rotation}deg);` +
                'transform-origin:center;';

            const lines = BURST.angles.map((a) => {
                const el = document.createElementNS(SVG_NS, 'line');
                el.setAttribute('stroke', BURST.color);
                el.setAttribute('stroke-linecap', 'square');
                svg.appendChild(el);
                return {
                    el,
                    sx: c + s * 0.1 * Math.cos(a),
                    sy: c - s * 0.1 * Math.sin(a),
                    ex: c + s * 0.25 * Math.cos(a),
                    ey: c - s * 0.25 * Math.sin(a),
                    tx: (s / 4) * Math.cos(a),
                    ty: (-s / 4) * Math.sin(a),
                };
            });
            layer.appendChild(svg);

            const t0 = performance.now();
            (function frame(now) {
                const t = Math.min((now - t0) / BURST.duration, 1);
                const e = cubicOut(t);
                // stroke thins to nothing over the final 40% of the run
                const sw = t < 0.6
                    ? BURST.strokeWidth
                    : BURST.strokeWidth * (1 - (t - 0.6) / 0.4);

                for (const l of lines) {
                    l.el.setAttribute('x1', l.sx + (l.ex - l.sx) * e);
                    l.el.setAttribute('y1', l.sy + (l.ey - l.sy) * e);
                    l.el.setAttribute('x2', l.ex);
                    l.el.setAttribute('y2', l.ey);
                    l.el.setAttribute('stroke-width', Math.max(sw, 0));
                    l.el.style.transform =
                        `translate(${l.tx * e}px, ${l.ty * e}px)`;
                }

                if (t < 1) requestAnimationFrame(frame);
                else svg.remove();
            })(t0);
        }
    }


    /* --- 2. Random letter swap -----------------------------------------
       The h1 letters roll upward in shuffled order on hover, roll back
       on leave (pingpong mode). Hover handlers are debounced leading +
       trailing (100ms), matching the source component.                 */

    const SWAP = {
        stagger: 100,   // ms between letters in the shuffled order
        debounce: 100,  // ms
    };

    function initLetterSwap() {
        const host = document.querySelector('.الاسم');
        if (!host || REDUCED) return null;

        const label = host.textContent.trim();
        host.textContent = '';

        const wrap = document.createElement('span');
        wrap.className = 'lsw';

        // screen readers get the intact label; letter cells are decoration
        const sr = document.createElement('span');
        sr.className = 'lsw-sr';
        sr.textContent = label;
        wrap.appendChild(sr);

        const chars = [];
        for (const ch of label) {
            const cell = document.createElement('span');
            cell.className = 'lsw-char';
            cell.setAttribute('aria-hidden', 'true');
            const p = document.createElement('span');
            p.className = 'lsw-p';
            p.textContent = ch;
            const s = document.createElement('span');
            s.className = 'lsw-s';
            s.textContent = ch;
            cell.append(p, s);
            wrap.appendChild(cell);
            if (ch !== ' ') chars.push({ cell, p, s });
        }
        host.appendChild(wrap);

        // CSS guard: if the .lsw rules aren't live (stale cached styles.css),
        // the doubled letter DOM renders as garbage text — fall back to the
        // plain label instead.
        if (getComputedStyle(wrap).display !== 'inline-flex') {
            host.textContent = label;
            return null;
        }

        const shuffled = () => [...chars].sort(() => Math.random() - 0.5);

        function run(entering) {
            shuffled().forEach((c, i) => {
                const delay = `${i * SWAP.stagger}ms`;
                c.p.style.transitionDelay = delay;
                c.s.style.transitionDelay = delay;
                c.p.style.transform = entering ? 'translateY(-115%)' : 'translateY(0)';
                c.s.style.transform = entering ? 'translateY(0)' : 'translateY(115%)';
            });
        }

        // leading + trailing debounce, one per direction
        function debounced(fn) {
            let timer = null;
            let trailing = false;
            return () => {
                if (!timer) {
                    fn();
                    timer = setTimeout(() => {
                        if (trailing) fn();
                        trailing = false;
                        timer = null;
                    }, SWAP.debounce);
                } else {
                    trailing = true;
                }
            };
        }

        host.addEventListener('mouseenter', debounced(() => run(true)));
        host.addEventListener('mouseleave', debounced(() => run(false)));

        return chars;
    }


    /* --- 2b. Variable weight proximity ---------------------------------
       Each h1 letter morphs its wght axis toward the cursor — linear
       falloff over `reach`, eased per-frame with exponential smoothing
       (tau from the component's Transition duration). Weights stamped
       directly on the DOM nodes, bypassing any transition. Runs on the
       letter cells the swap effect builds; both the visible and the
       swap-in copy of each letter get the same weight.

       Adapted from the component defaults (400→900, Inter Variable) to
       Cormorant Garamond's variable range: 300 (resting) → 700.       */

    const WGHT = {
        from: 300,
        to: 700,
        reach: 200,     // strength 25 of MAX_REACH 800
        tau: 0.3,       // transition duration → smoothing rate
    };

    function initWeightProximity(chars) {
        if (REDUCED || !chars || !chars.length) return;

        const mouse = { x: -99999, y: -99999 };
        window.addEventListener('mousemove', (e) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        });
        window.addEventListener('touchmove', (e) => {
            if (!e.touches.length) return;
            mouse.x = e.touches[0].clientX;
            mouse.y = e.touches[0].clientY;
        });

        const factors = new Array(chars.length).fill(0);
        // double quotes: matches the browser's serialized form, so the
        // at-rest comparison below actually short-circuits
        const rest = `"wght" ${WGHT.from}`;
        let last = 0;

        (function frame(now) {
            const dt = Math.min(0.1, Math.max(0, (now - (last || now)) / 1000));
            last = now;
            const a = 1 - Math.exp(-dt / WGHT.tau);

            for (let i = 0; i < chars.length; i++) {
                const c = chars[i];
                const r = c.cell.getBoundingClientRect();
                const dx = mouse.x - (r.left + r.width / 2);
                const dy = mouse.y - (r.top + r.height / 2);
                const target = Math.min(
                    Math.max(1 - Math.hypot(dx, dy) / WGHT.reach, 0), 1);

                const f = factors[i] + (target - factors[i]) * a;
                factors[i] = f;

                if (f < 0.001) {
                    if (c.p.style.fontVariationSettings !== rest) {
                        c.p.style.fontVariationSettings = rest;
                        c.s.style.fontVariationSettings = rest;
                    }
                    continue;
                }
                const w = Math.round(WGHT.from + (WGHT.to - WGHT.from) * f);
                const v = `"wght" ${w}`;
                c.p.style.fontVariationSettings = v;
                c.s.style.fontVariationSettings = v;
            }
            requestAnimationFrame(frame);
        })(performance.now());
    }


    /* --- 3. Pixelate reveal --------------------------------------------
       The field photo starts as coarse blocks and resolves to sharp when
       scrolled into view. Hovering re-pixelates briefly, then resolves.
       Filter graph is the NORMAL branch of the Originkit pixelate SVG
       filter, with block size driven per-frame from JS.                */

    const PXL = {
        maxSize: 28,       // starting block size, CSS px
        enterMs: 1100,
        hoverMs: 550,
    };

    function initPixelate() {
        const img = document.querySelector('.field-photo img');
        if (!img || REDUCED) return;

        const holder = document.createElementNS(SVG_NS, 'svg');
        holder.setAttribute('aria-hidden', 'true');
        holder.style.cssText = 'position:absolute;width:0;height:0;';
        holder.innerHTML =
            `<defs><filter id="pxl" x="-50%" y="-50%" width="200%" height="200%">` +
            `<feConvolveMatrix kernelMatrix="1 1 1 1 1 1 1 1 1" result="AVG"/>` +
            `<feFlood x="1" y="1" width="1" height="1"/>` +
            `<feComposite operator="arithmetic" k1="0" k2="1" k3="0" k4="0" ` +
            `width="${PXL.maxSize}" height="${PXL.maxSize}"/>` +
            `<feTile result="TILE"/>` +
            `<feComposite in="AVG" in2="TILE" operator="in"/>` +
            `<feMorphology operator="dilate" radius="${PXL.maxSize / 2}" result="NORMAL"/>` +
            `<feMerge><feMergeNode in="NORMAL"/></feMerge>` +
            `</filter></defs>`;
        document.body.appendChild(holder);

        const tile = holder.querySelectorAll('feComposite')[0];
        const morph = holder.querySelector('feMorphology');

        function setSize(px) {
            const v = Math.max(1, Math.round(px));
            tile.setAttribute('width', v);
            tile.setAttribute('height', v);
            morph.setAttribute('radius', v / 2);
        }

        let raf = null;
        function resolveFrom(from, dur) {
            cancelAnimationFrame(raf);
            img.style.filter = 'url(#pxl)';
            setSize(from);
            const t0 = performance.now();
            (function frame(now) {
                const t = Math.min((now - t0) / dur, 1);
                const size = from * (1 - easeOut(t));
                if (t >= 1 || size <= 1) {
                    img.style.filter = '';
                    return;
                }
                setSize(size);
                raf = requestAnimationFrame(frame);
            })(t0);
        }

        // start coarse, resolve on first scroll into view
        img.style.filter = 'url(#pxl)';
        setSize(PXL.maxSize);

        let revealed = false;
        const io = new IntersectionObserver((entries) => {
            for (const en of entries) {
                if (en.isIntersecting && !revealed) {
                    revealed = true;
                    resolveFrom(PXL.maxSize, PXL.enterMs);
                    io.disconnect();
                }
            }
        }, { threshold: 0.35 });
        io.observe(img);

        img.closest('.field-photo').addEventListener('mouseenter', () => {
            if (revealed) resolveFrom(PXL.maxSize * 0.6, PXL.hoverMs);
        });
    }


    /* --- 5. Wave arcs background ----------------------------------------
       Port of the Originkit InteractiveHeroCanvas: concentric arcs sweep
       up from below the fold, tilting with cursor Y. Runs on the fixed
       #الخلفية canvas. Site adaptations: transparent canvas (clearRect,
       not an opaque fill) so the corner glows stay visible, line color
       from the site palette. Defers start to idle, pauses when the tab
       is hidden. With reduced motion the static blueprint border from
       script.js remains instead.                                       */

    const WAVE = {
        lineColor: { r: 240, g: 236, b: 228 },   // #f0ece4
        lineWidth: 1.5,
        lineCount: 76,
        speed: 6,
        glow: 10,
        interactive: true,
        dim: 0.45,   // site adaptation: full component brightness washes
                     // out body text — raise toward 1 for the full look
    };

    function initWaveArcs() {
        const canvas = document.getElementById('الخلفية');
        if (!canvas || REDUCED) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        const map = (v, a, b, c, d) => ((v - a) / (b - a)) * (d - c) + c;
        const TWO_PI = 2 * Math.PI;

        const st = { width: 0, height: 0, dpr: 1, frame: 0, rafId: 0 };
        const mouse = { y: 0, targetY: 0 };

        function setup() {
            st.dpr = Math.min(window.devicePixelRatio || 1, 2);
            st.width = window.innerWidth;
            st.height = window.innerHeight;
            canvas.width = st.width * st.dpr;
            canvas.height = st.height * st.dpr;
            canvas.style.width = st.width + 'px';
            canvas.style.height = st.height + 'px';
            ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
        }

        function draw() {
            st.frame += 1;
            const w = st.width;
            const ht = st.height;
            mouse.y += (mouse.targetY - mouse.y) * 0.1;

            ctx.clearRect(0, 0, w, ht);

            const isMobile = w < 768;
            const u = 55000 / WAVE.glow;
            const { r: cr, g: cg, b: cb } = WAVE.lineColor;

            ctx.save();
            ctx.globalAlpha = WAVE.dim;
            ctx.lineWidth = WAVE.lineWidth;
            ctx.translate(w / 2, ht + (isMobile ? 60 : 40));

            const f = WAVE.interactive ? map(mouse.y, 0, ht, 1.2, -1.2) : 0;
            const m = Math.max(320, Math.min(1440, w));
            const rate = map(m, 320, 1440, 0.002, 5e-4) * (WAVE.speed / 5);
            const p = st.frame * rate;
            const h = w / 2;
            const x = isMobile
                ? Math.round(WAVE.lineCount * 0.6)
                : WAVE.lineCount;

            for (let k = 0; k < x; k++) {
                let ang = map(k, 0, x, 0, Math.PI) + p;
                ang %= Math.PI;
                const l = (Math.tan(ang) - f) * ht;
                const a = Math.abs(l) / 2;
                const yCenter = -ht / 2 + l / 2;
                const bright = Math.max(0,
                    Math.min(255, map(Math.abs(l), 0, u, -20, 255))) / 255;
                if (bright <= 0) continue;

                ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, ${bright})`;

                if (a > 499999.5) {
                    ctx.beginPath();
                    ctx.moveTo(-h, -ht / 2);
                    ctx.lineTo(h, -ht / 2);
                    ctx.stroke();
                    continue;
                }

                const c2 = Math.acos(Math.min(1, (h + 50) / a));
                const segTotal = Math.max(Math.ceil(a / 120), 200);
                const spans = [
                    [c2, Math.PI - c2],
                    [Math.PI + c2, TWO_PI - c2],
                ];
                for (const [start, end] of spans) {
                    const span = end - start;
                    const n3 = Math.max(
                        Math.ceil((span / TWO_PI) * segTotal), 60);
                    const step = span / n3;
                    ctx.beginPath();
                    for (let s = 0; s <= n3; s++) {
                        const aa = start + step * s;
                        const xx = Math.cos(aa) * a;
                        const yy = yCenter + Math.sin(aa) * a;
                        s === 0 ? ctx.moveTo(xx, yy) : ctx.lineTo(xx, yy);
                    }
                    ctx.stroke();
                }
            }
            ctx.restore();

            st.rafId = requestAnimationFrame(draw);
        }

        function start() {
            if (!st.rafId && document.visibilityState === 'visible') {
                st.rafId = requestAnimationFrame(draw);
            }
        }
        function stop() {
            if (st.rafId) {
                cancelAnimationFrame(st.rafId);
                st.rafId = 0;
            }
        }

        setup();
        mouse.y = st.height / 2;
        mouse.targetY = st.height / 2;

        // defer first frame to idle so it never competes with page load
        if (typeof requestIdleCallback !== 'undefined') {
            requestIdleCallback(start);
        } else {
            setTimeout(start, 150);
        }

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(setup, 100);
        }, { passive: true });

        document.addEventListener('visibilitychange', () => {
            document.visibilityState === 'visible' ? start() : stop();
        });

        if (WAVE.interactive) {
            document.addEventListener('mousemove', (e) => {
                mouse.targetY = e.clientY;   // canvas is fixed at inset 0
            }, { passive: true });
        }
    }


    initBurst();
    initWeightProximity(initLetterSwap());
    initPixelate();
    initWaveArcs();
})();
