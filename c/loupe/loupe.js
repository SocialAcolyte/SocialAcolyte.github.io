/*
 *  LOUPE // a reading glass lying on a print.
 *
 *  The artwork sits on the paper in black and white. A round glass lens shows
 *  it in full colour and magnified, with the optics of a real reading glass:
 *  the picture bulges toward the rim (barrel distortion), splits into faint
 *  colour fringes only at the very edge, a thin bright glass edge catches the
 *  light from the top left, the rim shades the print just inside it, and the
 *  lens casts a soft shadow onto the page that lengthens when it is lifted.
 *
 *  Markup:  <figure data-loupe>
 *             <img src="large.webp" alt="...">
 *           </figure>
 *
 *  Options (data attributes, all optional):
 *    data-zoom="2.4"         starting magnification
 *    data-zoom-min="1.5"     } wheel / + - limits
 *    data-zoom-max="5"       }
 *    data-radius="15vmin"    lens radius, px or vmin (at least 76px)
 *    data-mono="1"           0 shows the print in colour too
 *    data-rest="0.5,0.5"     where the lens lies when nobody is using it (0..1)
 *    data-src="huge.webp"    a larger file for the lens than the <img> shows
 *
 *  Or call  loupe(element, { zoom, zoomMin, zoomMax, radius, mono, rest, src })
 *  yourself. Returns a function that undoes it.
 *
 *  Behaviour, as a small state machine:
 *    rest    nobody is using it: the lens lies at data-rest, a little smaller.
 *    follow  a mouse or pen hovers: the lens trails the pointer on a spring.
 *    drag    a finger holds the lens: it lifts above the fingertip (so the
 *            finger never covers what you look at) and follows on the spring.
 *    placed  put down by a finger, a tap or the keyboard: it stays there.
 *  In rest and placed, tilting a phone glides the lens across the print.
 *  Fast movement lifts the glass a little (it grows, its shadow lengthens);
 *  stillness lets it settle back onto the paper.
 *
 *  The WebGL2 lens samples the full-resolution texture, so the magnified view
 *  is as sharp as the file. Without WebGL2 a plain CSS lens (round, colour,
 *  magnified, no distortion) takes over; without JS the figure is the image.
 *
 *  Accessibility: the <img> and its alt stay; the figure is focusable, arrow
 *  keys move the lens (Shift for bigger steps), + and - zoom, 0 resets, and
 *  the magnification is announced. Reduced motion: the lens is drawn where it
 *  lies and moves only when you move it, without spring or drift.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// Poimandres-style springs: a little under critical, so the lens trails,
// overshoots by a hair and settles.
const MOVE = { k: 150, c: 22 };
const GROW = { k: 210, c: 25 };
const LIFT = { k: 120, c: 20 };
const REST_SCALE = 0.88;
const LIGHT = [-0.55, -0.835];              // toward the light: top left

const num = (v, d) => (v == null || v === '' || isNaN(+v) ? d : +v);
const pair = (v, d) => {
    if (Array.isArray(v)) return v;
    const p = String(v || '').split(/[ ,]+/).map(Number);
    return p.length === 2 && p.every((x) => !isNaN(x)) ? p : d;
};

export function loupe(host, opts = {}) {
    const img = host && host.querySelector('img');
    if (!host || !img || host.classList.contains('lp')) return () => {};

    const ds = host.dataset;
    const cfg = {
        zoom: num(opts.zoom ?? ds.zoom, 2.4),
        zoomMin: num(opts.zoomMin ?? ds.zoomMin, 1.5),
        zoomMax: num(opts.zoomMax ?? ds.zoomMax, 5),
        radius: String(opts.radius ?? ds.radius ?? '15vmin'),
        mono: !['0', 'false', 'off'].includes(String(opts.mono ?? ds.mono ?? '1')),
        rest: pair(opts.rest ?? ds.rest, [0.5, 0.5]),
        src: opts.src ?? ds.src ?? null,
    };
    cfg.zoom = clamp(cfg.zoom, cfg.zoomMin, cfg.zoomMax);

    /* ---- DOM ------------------------------------------------------------- */
    const added = [];
    const had = { tabindex: host.getAttribute('tabindex'), describedby: host.getAttribute('aria-describedby') };
    const uid = 'lp' + Math.random().toString(36).slice(2, 8);

    const stage = document.createElement('div');
    stage.className = 'lp-stage';
    stage.setAttribute('aria-hidden', 'true');
    const hit = document.createElement('div');
    hit.className = 'lp-hit';
    const readout = document.createElement('div');
    readout.className = 'lp-zoom';
    const hint = document.createElement('span');
    hint.className = 'lp-sr';
    hint.id = uid + '-hint';
    hint.textContent = 'Magnifying glass. Arrow keys move it, plus and minus change the magnification.';
    const live = document.createElement('span');
    live.className = 'lp-sr';
    live.setAttribute('aria-live', 'polite');
    stage.append(hit, readout);
    host.append(stage, hint, live);
    added.push(stage, hint, live);
    host.classList.add('lp');
    if (cfg.mono) host.classList.add('is-mono');
    if (had.tabindex == null) host.tabIndex = 0;
    host.setAttribute('aria-describedby', [had.describedby, hint.id].filter(Boolean).join(' '));

    /* ---- state ------------------------------------------------------------ */
    let W = 1, H = 1, R = 100, dpr = 1, S = 0;
    let ox = 0, oy = 0;                 // image box inside the host
    let overL = 0, overR = 0, overV = 0; // how far the lens may hang off the image
    let mode = 'rest';
    let anchor = cfg.rest.slice();      // where rest/placed lie, 0..1
    let aim = cfg.rest.slice();         // where follow/drag want to be, 0..1
    const pos = { u: cfg.rest[0], v: cfg.rest[1], vx: 0, vy: 0 };   // u,v 0..1; vx,vy px/s
    const grow = { x: REST_SCALE, v: 0 };
    const lift = { x: 0, v: 0 };
    let zoom = cfg.zoom, zoomT = cfg.zoom;
    let speed = 0, alpha = 0, alphaT = 1;
    let visible = false, raf = 0, last = 0, ready = false, dead = false;
    let renderer = null;
    let tilt = { x: 0, y: 0, active: false };
    let lastDrawn = '';

    // tilt.js tells its listeners once, when a real sensor first reports
    const onTilt = () => kick();
    import('./tilt.js').then((m) => {
        if (dead) return;
        tilt = m.default;
        if (tilt.listeners) tilt.listeners.add(onTilt);
        kick();
    }).catch(() => {});

    /* ---- geometry --------------------------------------------------------- */
    function radiusPx() {
        const m = /^\s*([\d.]+)\s*(vmin|px)?\s*$/.exec(cfg.radius);
        const v = m ? +m[1] : 15;
        const r = !m || m[2] === 'vmin' ? (v / 100) * Math.min(innerWidth, innerHeight) : v;
        return clamp(r, Math.min(76, Math.min(W, H) * 0.3), Math.min(W, H) * 0.42);
    }

    function layout() {
        const hr = host.getBoundingClientRect();
        const ir = img.getBoundingClientRect();
        W = Math.max(1, ir.width);
        H = Math.max(1, ir.height);
        ox = ir.left - hr.left;
        oy = ir.top - hr.top;
        dpr = Math.min(2, devicePixelRatio || 1);
        R = radiusPx();
        // The lens (and its shadow) may hang off the image onto the paper, but
        // never past the page's sides: no sideways scroll on a phone.
        const vw = document.documentElement.clientWidth;
        const spill = R * 1.45;
        overL = clamp(ir.left, 0, spill);
        overR = clamp(vw - ir.right, 0, spill);
        overV = spill;
        Object.assign(stage.style, {
            left: ox - overL + 'px', top: oy - overV + 'px',
            width: W + overL + overR + 'px', height: H + 2 * overV + 'px',
        });
        S = Math.ceil(R * 2 * 1.12 + R * 0.9);
        if (renderer) renderer.size(S, dpr);
        if (natW) zoomT = Math.min(zoomT, zoomCap());
        lastDrawn = '';
    }

    // Keep the lens mostly over the image (it may hang off by a little over
    // half its width, like a glass slid to the edge of a print) and fully
    // inside the area it may spill into.
    function clampU(u) {
        const lo = Math.max(R * 0.25, R - overL), hi = Math.min(W - R * 0.25, W + overR - R);
        return clamp(u * W, Math.min(lo, W / 2), Math.max(hi, W / 2)) / W;
    }
    const clampV = (v) => clamp(v * H, Math.min(R * 0.25, H / 2), Math.max(H - R * 0.25, H / 2)) / H;

    function local(e) {
        const r = img.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
    }

    /* ---- the loop ---------------------------------------------------------- */
    function targets() {
        let tu, tv, scale, lifted;
        if (mode === 'follow' || mode === 'drag') { tu = aim[0]; tv = aim[1]; }
        else {
            tu = anchor[0]; tv = anchor[1];
            if (tilt.active && !calm.matches) {
                const reach = Math.min(W, H) * 0.34;
                tu += (tilt.x * reach) / W;
                tv += (tilt.y * reach) / H;
            }
        }
        scale = mode === 'rest' ? REST_SCALE : 1;
        lifted = mode === 'drag' ? 1 : 0;
        return { tu: clampU(tu), tv: clampV(tv), scale, lifted };
    }

    function spring(s, target, p, dt) {
        s.v += (p.k * (target - s.x) - p.c * s.v) * dt;
        s.x += s.v * dt;
    }

    function step(dt) {
        const t = targets();
        if (calm.matches) {
            pos.u = t.tu; pos.v = t.tv; pos.vx = pos.vy = 0;
            grow.x = t.scale; grow.v = 0; lift.x = t.lifted * 0.5; lift.v = 0;
            zoom = zoomT; alpha = 1; speed = 0;
            return false;
        }
        // substeps keep the springs stable on a slow frame
        const n = Math.ceil(dt / (1 / 240));
        const h = dt / n;
        for (let i = 0; i < n; i++) {
            const x = pos.u * W, y = pos.v * H;
            pos.vx += (MOVE.k * (t.tu * W - x) - MOVE.c * pos.vx) * h;
            pos.vy += (MOVE.k * (t.tv * H - y) - MOVE.c * pos.vy) * h;
            pos.u = (x + pos.vx * h) / W;
            pos.v = (y + pos.vy * h) / H;
        }
        // fast movement lifts the glass; stillness lets it settle
        const sp = Math.hypot(pos.vx, pos.vy);
        speed += (sp - speed) * (1 - Math.exp(-dt / 0.12));
        const hurry = smooth(250, 2600, speed);
        for (let i = 0; i < n; i++) {
            spring(grow, t.scale * (1 + 0.075 * hurry + 0.04 * t.lifted), GROW, h);
            spring(lift, Math.max(t.lifted, hurry * 0.55), LIFT, h);
        }
        const zk = 1 - Math.exp(-dt / 0.13);
        zoom = Math.exp(Math.log(zoom) + (Math.log(zoomT) - Math.log(zoom)) * zk);
        alpha += (alphaT - alpha) * (1 - Math.exp(-dt / 0.09));

        const still = Math.abs(t.tu - pos.u) * W + Math.abs(t.tv - pos.v) * H < 0.05
            && sp < 0.5 && Math.abs(grow.v) + Math.abs(lift.v) < 0.002
            && Math.abs(grow.x - t.scale * (1 + 0.04 * t.lifted)) < 0.0005
            && Math.abs(lift.x - t.lifted) < 0.002
            && Math.abs(zoom - zoomT) < 0.0005 && Math.abs(alpha - alphaT) < 0.002;
        if (still) {
            pos.u = t.tu; pos.v = t.tv; pos.vx = pos.vy = 0;
            zoom = zoomT; alpha = alphaT;
        }
        return !still || (tilt.active && (mode === 'rest' || mode === 'placed'));
    }

    function draw() {
        const x = pos.u * W + overL, y = pos.v * H + overV;
        const r = R * grow.x;
        const key = [x, y, r, zoom, lift.x, alpha].map((v) => v.toFixed(3)).join();
        if (key === lastDrawn) return;
        lastDrawn = key;
        renderer.draw({ x, y, r, zoom, lift: lift.x, alpha, u: pos.u, v: pos.v, W, H });
        // the touch target rides along with the glass
        const hr = r * 1.08;
        hit.style.width = hit.style.height = hr * 2 + 'px';
        hit.style.transform = `translate3d(${x - hr}px, ${y - hr}px, 0)`;
        readout.style.transform = `translate3d(${x}px, ${y + r + 14 + lift.x * 6}px, 0) translateX(-50%)`;
    }

    function frame(t) {
        raf = 0;
        if (dead || !ready) return;
        const dt = last ? clamp((t - last) / 1000, 0.001, 1 / 30) : 1 / 60;
        last = t;
        const more = step(dt);
        draw();
        if (more && visible) raf = requestAnimationFrame(frame);
        else last = 0;
    }
    const kick = () => { if (!raf && ready && !dead && visible) raf = requestAnimationFrame(frame); };

    /* ---- zoom ------------------------------------------------------------ */
    let readTimer = 0, liveTimer = 0;
    // Sharp or nothing: never magnify past ~1.3x the file's own pixels.
    let natW = 0;
    const zoomCap = () => (natW ? Math.max(cfg.zoomMin, Math.min(cfg.zoomMax, (natW / (W * dpr)) * 1.3)) : cfg.zoomMax);
    function setZoom(z) {
        const nz = clamp(z, cfg.zoomMin, zoomCap());
        if (Math.abs(nz - zoomT) < 1e-4) return false;
        zoomT = nz;
        readout.textContent = zoomT.toFixed(1) + '×';
        readout.classList.add('is-on');
        clearTimeout(readTimer);
        readTimer = setTimeout(() => readout.classList.remove('is-on'), 900);
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => { live.textContent = `Magnification ${zoomT.toFixed(1)} times`; }, 450);
        kick();
        return true;
    }

    /* ---- input: mouse and pen hover --------------------------------------- */
    let engaged = false;   // has the pointer actually moved over the print since the page last scrolled?
    let lastWheel = 0;

    function onMove(e) {
        if (e.pointerType === 'touch' || mode === 'drag') return;
        const p = local(e);
        const inside = p.x >= 0 && p.y >= 0 && p.x <= p.w && p.y <= p.h;
        if (!inside) { if (mode === 'follow') leave(); return; }
        engaged = true;
        mode = 'follow';
        aim = [p.x / p.w, p.y / p.h];
        kick();
    }
    function leave() {
        if (mode !== 'follow') return;
        // reduced motion: nothing moves by itself, so the glass stays put
        if (calm.matches) { mode = 'placed'; anchor = [pos.u, pos.v]; return; }
        mode = 'rest';
        anchor = cfg.rest.slice();
        kick();
    }
    function onLeave(e) { if (e.pointerType !== 'touch') leave(); }

    function onWheel(e) {
        const p = local(e);
        if (p.x < 0 || p.y < 0 || p.x > p.w || p.y > p.h) return;
        if (!engaged && !e.ctrlKey) return;            // just scrolling past: let the page scroll
        const now = performance.now();
        const fresh = now - lastWheel > 320;
        lastWheel = now;
        let dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
        if (e.ctrlKey) dy *= 4;                        // trackpad pinch
        const changed = setZoom(zoomT * Math.exp(-dy * 0.0016));
        // At a limit, a new wheel gesture belongs to the page again, so the
        // print never traps the scroll.
        if (!changed && fresh && !e.ctrlKey) { engaged = false; return; }
        e.preventDefault();
    }
    const onScroll = () => { if (performance.now() - lastWheel > 120) engaged = false; };

    /* ---- input: touch ----------------------------------------------------- */
    let dragId = null;
    let grab = null;
    let tap = null;
    const liftBy = () => R * grow.x + 18;          // the lens floats this far above the fingertip

    function onHitDown(e) {
        if (e.pointerType === 'mouse') return;
        e.preventDefault();
        e.stopPropagation();
        dragId = e.pointerId;
        try { hit.setPointerCapture(dragId); } catch (_) { /* old browsers */ }
        grab = { x: e.clientX, y: e.clientY, t: performance.now(), at: [pos.u, pos.v], moved: false };
        mode = 'drag';
        const p = local(e);
        aim = [p.x / p.w, (p.y - (R + 18)) / p.h];
        host.classList.add('is-holding');
        kick();
    }
    function onHitMove(e) {
        if (e.pointerId !== dragId) return;
        if (Math.hypot(e.clientX - grab.x, e.clientY - grab.y) > 8) grab.moved = true;
        const p = local(e);
        aim = [p.x / p.w, (p.y - liftBy()) / p.h];
        kick();
    }
    function onHitUp(e) {
        if (e.pointerId !== dragId) return;
        dragId = null;
        mode = 'placed';
        // a quick tap on the glass leaves it where it was
        const tapped = !grab.moved && performance.now() - grab.t < 260;
        anchor = tapped ? grab.at : [clampU(aim[0]), clampV(aim[1])];
        host.classList.remove('is-holding');
        kick();
    }

    // A tap anywhere on the print sets the lens down there.
    function onDown(e) {
        if (e.pointerType !== 'touch' || e.target === hit) return;
        tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    }
    function onUp(e) {
        if (!tap || e.pointerId !== tap.id) return;
        const ok = performance.now() - tap.t < 350 && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 12;
        tap = null;
        if (!ok || mode === 'drag') return;
        const p = local(e);
        if (p.x < 0 || p.y < 0 || p.x > p.w || p.y > p.h) return;
        mode = 'placed';
        anchor = [p.x / p.w, p.y / p.h];
        kick();
    }
    const onCancel = () => { tap = null; };

    /* ---- input: keyboard -------------------------------------------------- */
    function onKey(e) {
        if (e.altKey || e.metaKey || (e.ctrlKey && !['+', '=', '-'].includes(e.key))) return;
        const big = e.shiftKey ? 3 : 1;
        const stepX = (R * 0.4 * big) / W, stepY = (R * 0.4 * big) / H;
        const from = mode === 'follow' || mode === 'drag' ? [pos.u, pos.v] : anchor;
        let next = null;
        switch (e.key) {
            case 'ArrowLeft': next = [from[0] - stepX, from[1]]; break;
            case 'ArrowRight': next = [from[0] + stepX, from[1]]; break;
            case 'ArrowUp': next = [from[0], from[1] - stepY]; break;
            case 'ArrowDown': next = [from[0], from[1] + stepY]; break;
            case 'Home': next = cfg.rest.slice(); break;
            case '+': case '=': setZoom(zoomT * 1.2); break;
            case '-': case '_': setZoom(zoomT / 1.2); break;
            case '0': setZoom(cfg.zoom); break;
            default: return;
        }
        e.preventDefault();
        if (next) {
            mode = 'placed';
            anchor = [clampU(next[0]), clampV(next[1])];
            kick();
        }
    }

    /* ---- renderers ---------------------------------------------------------- */
    function paperRGB() {
        const cs = getComputedStyle(host);
        let c = cs.getPropertyValue('--lp-paper').trim() || cs.getPropertyValue('--paper').trim();
        if (!c) {
            for (let el = host; el; el = el.parentElement) {
                const b = getComputedStyle(el).backgroundColor;
                if (b && !/rgba\(.*,\s*0\)|transparent/.test(b)) { c = b; break; }
            }
        }
        return rgbOf(c || '#f3f0e8');
    }
    function inkRGB() {
        const c = getComputedStyle(host).getPropertyValue('--ink').trim();
        return rgbOf(c || '#141312');
    }

    async function start() {
        let source = img;
        try {
            if (cfg.src && cfg.src !== img.currentSrc) {
                source = new Image();
                source.crossOrigin = img.crossOrigin;
                source.src = cfg.src;
            }
            await source.decode();
        } catch (_) {
            if (!img.complete || !img.naturalWidth) { host.classList.remove('is-mono'); return; }  // no image, no lens
            source = img;
        }
        if (dead) return;
        natW = source.naturalWidth || 0;
        layout();
        zoom = zoomT = clamp(zoomT, cfg.zoomMin, zoomCap());
        renderer = makeGL(source, paperRGB(), inkRGB()) || makeCSS(source.currentSrc || source.src, paperRGB());
        stage.prepend(renderer.el);
        renderer.size(S, dpr);
        host.classList.add('is-live', renderer.gl ? 'is-gl' : 'is-css');
        ready = true;
        if (calm.matches) { alpha = alphaT = 1; grow.x = REST_SCALE; }
        else { alpha = 0; grow.x = 1.05; lift.x = 1; }  // lowered onto the print
        kick();
        if (!visible) draw();
    }

    /* ---- wiring ----------------------------------------------------------- */
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerdown', onDown);
    host.addEventListener('pointerup', onUp);
    host.addEventListener('pointercancel', onCancel);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('keydown', onKey);
    hit.addEventListener('pointerdown', onHitDown);
    hit.addEventListener('pointermove', onHitMove);
    hit.addEventListener('pointerup', onHitUp);
    hit.addEventListener('pointercancel', onHitUp);
    addEventListener('scroll', onScroll, { passive: true });
    const onCalm = () => { lastDrawn = ''; kick(); };
    calm.addEventListener?.('change', onCalm);

    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { layout(); if (ready) { draw(); kick(); } }, 60);
    });
    ro.observe(img);
    const io = new IntersectionObserver((en) => {
        visible = en[0].isIntersecting;
        if (visible) { last = 0; kick(); }
    }, { rootMargin: '120px' });
    io.observe(host);

    layout();
    start();

    return function destroy() {
        dead = true;
        cancelAnimationFrame(raf);
        clearTimeout(readTimer); clearTimeout(liveTimer); clearTimeout(resizeTimer);
        ro.disconnect(); io.disconnect();
        host.removeEventListener('pointermove', onMove);
        host.removeEventListener('pointerleave', onLeave);
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onCancel);
        host.removeEventListener('wheel', onWheel);
        host.removeEventListener('keydown', onKey);
        removeEventListener('scroll', onScroll);
        calm.removeEventListener?.('change', onCalm);
        if (tilt.listeners) tilt.listeners.delete(onTilt);
        if (renderer) renderer.destroy();
        added.forEach((el) => el.remove());
        host.classList.remove('lp', 'is-mono', 'is-live', 'is-gl', 'is-css', 'is-holding');
        if (had.tabindex == null) host.removeAttribute('tabindex');
        if (had.describedby == null) host.removeAttribute('aria-describedby');
        else host.setAttribute('aria-describedby', had.describedby);
    };
}

/* ---- WebGL2 lens ----------------------------------------------------------- */

const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uCanvas;   // device px
uniform float uDpr;
uniform vec2 uOff;      // lens centre inside the canvas, css px
uniform float uR;       // lens radius, css px
uniform float uZoom;
uniform vec2 uUV;       // lens centre on the image, 0..1
uniform vec2 uImg;      // image box, css px
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uLift;    // 0 lying on the paper .. 1 held above it
uniform float uAlpha;
uniform vec2 uLight;    // unit vector toward the light (y down)
out vec4 outColor;

// premultiplied texel, faded out past the image edge (anti-aliased in device px)
vec4 tap(vec2 uv, float pxPerUv) {
  vec4 c = texture(uTex, uv);
  vec2 e = min(uv, 1.0 - uv) * pxPerUv;
  return c * clamp(min(e.x * uImg.x, e.y * uImg.y) + 0.5, 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uCanvas.y - gl_FragCoord.y) / uDpr;
  vec2 q = p - uOff;
  float r = length(q);
  float d = r / uR;
  float px = 1.0 / uDpr;
  vec2 n = q / max(r, 1e-3);
  float lit = dot(n, uLight);              // +1 on the rim facing the light

  // ---- shadow on the page: a soft drop shadow away from the light, plus a
  //      tight contact shadow where the glass meets the paper
  vec2 so = -uLight * uR * (0.07 + 0.12 * uLift);
  float sd = length(q - so) / uR;
  float soft = 0.09 + 0.22 * uLift;
  float drop = (1.0 - smoothstep(1.0 - soft * 0.8, 1.0 + soft * 1.5, sd)) * (0.34 - 0.12 * uLift);
  float contact = (1.0 - smoothstep(0.0, 2.5 + 9.0 * uLift, r - uR)) * 0.20 * (1.0 - 0.7 * uLift);
  float sh = 1.0 - (1.0 - drop) * (1.0 - contact);
  vec4 shadow = vec4(uInk * sh, sh);

  float cover = 1.0 - smoothstep(uR - 0.6 * px, uR + 0.6 * px, r);
  vec3 g = vec3(0.0);
  if (cover > 0.0) {
    float dd = min(d, 1.0);
    // barrel distortion: the picture bulges and crowds toward the rim
    float f = 1.0 + 0.07 * dd * dd + 0.30 * pow(dd, 12.0);
    vec2 s = q / (uZoom * uImg) * f;
    float pxPerUv = uDpr * uZoom / f;
    // lateral colour, only in the outer band
    float ca = smoothstep(0.55, 1.0, dd);
    ca = ca * ca * ca * 0.018;
    vec4 tr = tap(uUV + s * (1.0 + ca), pxPerUv);
    vec4 tg = tap(uUV + s, pxPerUv);
    vec4 tb = tap(uUV + s * (1.0 - ca), pxPerUv);
    vec3 c = vec3(tr.r, tg.g, tb.b);              // premultiplied
    float a = tg.a;
    // colour is the payoff: a touch more contrast and saturation than the
    // file (the paper seen past the image's edge is left as it is)
    vec3 u = c / max(a, 1e-4);
    float luma = dot(u, vec3(0.2126, 0.7152, 0.0722));
    u = clamp(mix(vec3(luma), u, 1.08) * 1.05 - 0.025, 0.0, 1.0);
    g = u * a + uPaper * (1.0 - a);

    // the rim shades the print just inside it, most on the lit side
    float inner = smoothstep(0.80, 1.0, d);
    g *= 1.0 - inner * inner * (0.06 + 0.22 * max(lit, 0.0));
    // light gathered by the glass falls on the far inside
    g += smoothstep(0.72, 0.98, d) * pow(max(-lit, 0.0), 2.0) * 0.07 * (vec3(1.0) - g);
    // a broad, faint sheen near the lit rim
    g = mix(g, vec3(1.0), smoothstep(0.6, 0.98, d) * pow(max(lit, 0.0), 6.0) * 0.05);

    // the glass edge: a thin bright line with a darker thread just inside it
    float fromEdge = uR - r;                                  // css px
    float bright = 1.0 - smoothstep(0.4 * px, 1.6 + 0.6 * px, fromEdge);
    float thread = smoothstep(1.4, 2.4, fromEdge) * (1.0 - smoothstep(2.6, 4.4, fromEdge));
    g *= 1.0 - thread * 0.16;
    g = mix(g, vec3(1.0, 0.995, 0.98), bright * (0.42 + 0.5 * max(lit, 0.0)));
  }
  vec4 lens = vec4(g, 1.0) * cover;
  outColor = (lens + shadow * (1.0 - cover)) * uAlpha;
}`;

function makeGL(source, paper, ink) {
    const canvas = document.createElement('canvas');
    canvas.className = 'lp-canvas';
    let gl = null;
    try { gl = canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: false, alpha: true }); } catch (_) { gl = null; }
    if (!gl) return null;

    const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('loupe:', gl.getShaderInfoLog(s)); return null; }
        return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    // the texture: the whole file (or as much as the GPU allows), mipmapped so
    // the crowded rim never shimmers
    let pic = source;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const nw = source.naturalWidth, nh = source.naturalHeight;
    if (Math.max(nw, nh) > max) {
        const k = max / Math.max(nw, nh);
        const c = document.createElement('canvas');
        c.width = Math.floor(nw * k); c.height = Math.floor(nh * k);
        const x = c.getContext('2d');
        x.imageSmoothingQuality = 'high';
        x.drawImage(source, 0, 0, c.width, c.height);
        pic = c;
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pic);
    } catch (_) {
        return null;   // a cross-origin image without CORS: use the CSS lens
    }
    if (gl.getError() !== gl.NO_ERROR) return null;
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));

    const U = {};
    ['uTex', 'uCanvas', 'uDpr', 'uOff', 'uR', 'uZoom', 'uUV', 'uImg', 'uPaper', 'uInk', 'uLift', 'uAlpha', 'uLight']
        .forEach((k) => { U[k] = gl.getUniformLocation(prog, k); });
    gl.uniform1i(U.uTex, 0);
    gl.uniform3f(U.uPaper, paper[0] / 255, paper[1] / 255, paper[2] / 255);
    gl.uniform3f(U.uInk, ink[0] / 255, ink[1] / 255, ink[2] / 255);
    gl.uniform2f(U.uLight, LIGHT[0], LIGHT[1]);

    let S = 0, dpr = 1, lost = false;
    const onLost = (e) => { e.preventDefault(); lost = true; canvas.style.visibility = 'hidden'; };
    canvas.addEventListener('webglcontextlost', onLost);

    return {
        el: canvas, gl: true,
        size(s, d) {
            S = s; dpr = d;
            canvas.width = Math.round(S * dpr);
            canvas.height = Math.round(S * dpr);
            canvas.style.width = canvas.style.height = S + 'px';
            gl.viewport(0, 0, canvas.width, canvas.height);
        },
        draw(st) {
            if (lost) return;
            // Park the canvas on whole device pixels; the shader takes the
            // remainder, so the glass glides without shimmering.
            const left = Math.round((st.x - S / 2) * dpr) / dpr;
            const top = Math.round((st.y - S / 2) * dpr) / dpr;
            canvas.style.transform = `translate3d(${left}px, ${top}px, 0)`;
            gl.uniform2f(U.uCanvas, canvas.width, canvas.height);
            gl.uniform1f(U.uDpr, dpr);
            gl.uniform2f(U.uOff, st.x - left, st.y - top);
            gl.uniform1f(U.uR, st.r);
            gl.uniform1f(U.uZoom, st.zoom);
            gl.uniform2f(U.uUV, st.u, st.v);
            gl.uniform2f(U.uImg, st.W, st.H);
            gl.uniform1f(U.uLift, clamp(st.lift));
            gl.uniform1f(U.uAlpha, clamp(st.alpha));
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        },
        destroy() {
            canvas.removeEventListener('webglcontextlost', onLost);
            gl.deleteTexture(tex); gl.deleteBuffer(buf); gl.deleteProgram(prog);
            const lc = gl.getExtension('WEBGL_lose_context');
            if (lc) lc.loseContext();
            canvas.remove();
        },
    };
}

/* ---- CSS lens (no WebGL2): round, magnified, colour, no distortion ---------- */

function makeCSS(url, paper) {
    const el = document.createElement('div');
    el.className = 'lp-glass';
    el.style.backgroundImage = `url("${String(url).replace(/"/g, '%22')}")`;
    el.style.backgroundColor = `rgb(${paper.join(',')})`;
    return {
        el, gl: false,
        size() {},
        draw(st) {
            const d = st.r * 2;
            const bw = st.W * st.zoom, bh = st.H * st.zoom;
            Object.assign(el.style, {
                width: d + 'px', height: d + 'px',
                transform: `translate3d(${st.x - st.r}px, ${st.y - st.r}px, 0)`,
                backgroundSize: `${bw}px ${bh}px`,
                backgroundPosition: `${st.r - st.u * bw}px ${st.r - st.v * bh}px`,
                opacity: st.alpha,
            });
            el.style.setProperty('--lp-lift', clamp(st.lift).toFixed(3));
        },
        destroy() { el.remove(); },
    };
}

function rgbOf(c) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const x = cv.getContext('2d');
    x.fillStyle = '#f3f0e8';
    x.fillStyle = c;
    x.fillRect(0, 0, 1, 1);
    const d = x.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
}

// Auto-start every [data-loupe] once it is near the viewport.
function autoStart(el) {
    if (!('IntersectionObserver' in window)) return loupe(el);
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        loupe(el);
    }, { rootMargin: '800px' });
    io.observe(el);
}
document.querySelectorAll('[data-loupe]').forEach(autoStart);
