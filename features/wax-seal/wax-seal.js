/*
 *  WAX-SEAL // a confirm button you press and hold to seal.
 *
 *  Markup:  <button data-wax-seal data-done="Signed">Hold to sign</button>
 *  Or call  waxSeal(button, options)  yourself. Returns destroy(), which also
 *  carries destroy.reset() and destroy.state.
 *
 *  At rest it is a plain pill with a small grey seal matrix (an ancient coin
 *  or intaglio, cropped to its face) at its left end. Hold it: the matrix sinks
 *  and warm wax oozes out from under it, spreading as an irregular blob that
 *  grows with the hold. Let go early and it springs back. Hold the whole
 *  ~900ms and the matrix lifts away to leave the emblem embossed in the wax,
 *  lit like real relief: the emblem's luminance becomes a height map
 *  (feColorMatrix, luminance into alpha) for feDiffuseLighting and
 *  feSpecularLighting, so the light rakes across it and the gloss sits on its
 *  ridges. The wax then cools from molten to set.
 *
 *  The behaviour is an explicit statechart (CHART below; the README draws it)
 *  run by a twenty-line interpreter. Every input becomes an event, and the
 *  chart alone decides what an event means in the current state:
 *
 *    idle ⇄ armed (hover / focus) → pressing (progress 0..1 while held)
 *      pressing → recoiling (released early, pointer left, pointercancel, Esc)
 *      recoiling → pressing (pressed again: resumes from where the wax is)
 *      pressing → lifting → cooling → sealed (announced, 'seal' event, form)
 *      sealed → resetting → idle (only with data-reset or destroy.reset())
 *      idle / armed / recoiling ⇄ disabled (the disabled attribute)
 *
 *  Pointer leaving the button while pressing cancels, as a native button does,
 *  and coming back while still held resumes. Space or Enter held works the
 *  same. Touch: no long-press menu, no selection; a scroll that starts on the
 *  button scrolls (the browser's pointercancel recoils the seal). A short
 *  vibration marks the moment it seals, where navigator.vibrate exists.
 *
 *  Inside a <form>, completing the seal submits it (requestSubmit, so
 *  validation runs first: an invalid form recoils instead of sealing), or
 *  with data-input="name" it only fills a hidden input. The 'seal' event is
 *  cancelable: preventDefault() keeps the form from submitting.
 *
 *  Without JS it is a normal button that submits on click. Reduced motion:
 *  the hold still takes its time (that is the safety), but nothing animates
 *  by itself; release snaps back and the impression appears without the lift.
 *  No dependencies. rAF runs only while something is moving.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const DEFAULT_EMBLEM = new URL('./assets/carnelian-intaglio.webp', import.meta.url).href;
const LIFT_MS = 620;
const COOL_MS = 1500;
const CLEAR_MS = 520;

/* ---- the statechart -------------------------------------------------------
 * A plain object: states, the events each one answers, where they lead.
 * A transition is a target, or a list of { target, guard } tried in order.
 * entry names actions run on arriving. Events a state doesn't list are
 * ignored, which is most of the safety: a stray RELEASE in idle, a COMPLETE
 * after a cancel, a second PRESS while lifting all simply mean nothing.     */
export const CHART = {
    initial: 'idle',
    states: {
        idle:      { on: { ENGAGE: 'armed', PRESS: 'pressing', DISABLE: 'disabled' } },
        armed:     { on: { DISENGAGE: 'idle', PRESS: 'pressing', DISABLE: 'disabled' } },
        pressing:  {
            entry: 'hold',
            on: {
                RELEASE: 'recoiling', CANCEL: 'recoiling', DISABLE: 'disabled',
                COMPLETE: [{ target: 'lifting', guard: 'formValid' }, { target: 'recoiling' }],
            },
        },
        recoiling: {
            entry: 'recoil',
            on: {
                PRESS: 'pressing', DISABLE: 'disabled',
                SETTLED: [{ target: 'armed', guard: 'engaged' }, { target: 'idle' }],
            },
        },
        lifting:   { entry: ['commit', 'lift'], on: { LIFTED: 'cooling' } },
        cooling:   { entry: ['submit', 'cool'], on: { COOLED: 'sealed' } },
        sealed:    { entry: 'rest', on: { RESET: 'resetting' } },
        resetting: { entry: 'clear', on: { CLEARED: 'idle' } },
        disabled:  { entry: 'snap', on: { ENABLE: 'idle' } },
    },
};

function interpret(chart, { actions = {}, guards = {}, onChange }) {
    let state = chart.initial;
    return {
        get state() { return state; },
        send(event) {
            let t = (chart.states[state].on || {})[event];
            if (Array.isArray(t)) t = t.find((c) => !c.guard || guards[c.guard]());
            if (!t) return false;
            const from = state;
            state = typeof t === 'string' ? t : t.target;
            onChange && onChange(state, from, event);
            [].concat(chart.states[state].entry || []).forEach((a) => actions[a] && actions[a]());
            return true;
        },
    };
}

/* ---- the wax outline ------------------------------------------------------
 * A polar blob: a few low harmonics (the wax never spreads evenly) and a few
 * lobes that ooze out later in the press, all growing with the spread so the
 * edge starts round and ends irregular. Closed Catmull-Rom into cubics.     */
function rng(seed) {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
function blobShape(seed) {
    const r = rng(seed);
    return {
        harm: [3, 4, 5, 7, 11].map((k, i) => ({ k, a: [0.03, 0.02, 0.018, 0.01, 0.005][i] * (0.6 + r() * 0.8), ph: r() * 6.283, drift: (r() - 0.5) * 1.2 })),
        lobes: Array.from({ length: 3 + Math.floor(r() * 2) }, () => ({ at: r() * 6.283, w: 0.2 + r() * 0.28, a: 0.035 + r() * 0.07, from: 0.25 + r() * 0.45 })),
    };
}
function blobPath(shape, R, e) {
    const N = 56, pts = [];
    for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2;
        let k = 1;
        for (const h of shape.harm) k += h.a * e * Math.sin(h.k * th + h.ph + h.drift * e);
        for (const l of shape.lobes) {
            const d = Math.atan2(Math.sin(th - l.at), Math.cos(th - l.at)) / l.w;
            k += l.a * smooth(l.from, 1, e) * Math.exp(-d * d);
        }
        pts.push([100 + Math.cos(th) * R * k, 100 + Math.sin(th) * R * k]);
    }
    const f = (v) => v.toFixed(2);
    let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 0; i < N; i++) {
        const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N], p3 = pts[(i + 2) % N];
        d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])} ${f(p2[1])}`;
    }
    return d + 'Z';
}

/* ---- colour: any CSS colour to rgb, and the molten version of it ---------- */
function rgbOf(css, el) {
    const probe = document.createElement('i');
    probe.style.color = css;
    probe.style.display = 'none';
    el.appendChild(probe);
    const m = getComputedStyle(probe).color.match(/[\d.]+/g) || [163, 38, 29];
    probe.remove();
    return m.slice(0, 3).map(Number);
}
const molten = ([r, g, b]) => [r + (255 - r) * 0.1, g + (255 - g) * 0.035, b + (255 - b) * 0.02];
const rgbStr = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;

/* ---- the SVG: wax blob, impression, matrix shadow, matrix ------------------
 * 200-unit box, matrix radius 60 (so the medallion is 60% of the box and the
 * wax can spread to ~95 around it). Two lit layers that share one light:
 * the blob (its blurred alpha is a dome, plus a little grain) and the
 * impression (a pressed plateau, a ridge of displaced wax at its rim, and the
 * emblem's luminance as relief). Flat areas of both come out the same colour,
 * so the seam between them is just the ridge.                               */
const RM = 60;
function svgMarkup(id, emblem, seed, relief) {
    const light = '<feDistantLight azimuth="225" elevation="44"/>';
    const lit = (scaleCls, spec, exp) => `
        <feDiffuseLighting in="h" class="${scaleCls}" surfaceScale="4" diffuseConstant="1" lighting-color="#fff" result="diff">${light}</feDiffuseLighting>
        <feSpecularLighting in="h" class="${scaleCls} ws-spec" surfaceScale="4" specularConstant="${spec}" specularExponent="${exp}" lighting-color="#fff4e6" result="spec">${light}</feSpecularLighting>
        <feFlood class="ws-flood" flood-color="#a3261d" result="wax"/>
        <feComposite class="ws-body" in="wax" in2="diff" operator="arithmetic" k1="1.44" result="body"/>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="gloss"/>
        <feComposite in="body" in2="gloss" operator="arithmetic" k2="1" k3=".8" result="all"/>
        <feComposite in="all" in2="SourceAlpha" operator="in"/>`;
    const inv = relief === 'sunk' ? `filter="url(#${id}-inv)"` : '';
    return `<svg class="ws-svg" viewBox="0 0 200 200" focusable="false" aria-hidden="true">
  <defs>
    <clipPath id="${id}-face"><circle cx="100" cy="100" r="${RM - 0.6}"/></clipPath>
    <radialGradient id="${id}-rim" gradientUnits="userSpaceOnUse" cx="100" cy="100" r="76">
      <stop offset="0" stop-color="#4d4d4d"/><stop offset=".775" stop-color="#4d4d4d"/>
      <stop offset=".81" stop-color="#3a3a3a"/><stop offset=".835" stop-color="#9a9a9a"/>
      <stop offset=".9" stop-color="#7a7a7a"/><stop offset="1" stop-color="#6c6c6c"/>
    </radialGradient>
    <radialGradient id="${id}-fade" gradientUnits="userSpaceOnUse" cx="100" cy="100" r="76">
      <stop offset=".86" stop-color="#fff"/><stop offset=".98" stop-color="#000"/>
    </radialGradient>
    <mask id="${id}-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
      <circle cx="100" cy="100" r="76" fill="url(#${id}-fade)"/>
    </mask>
    <radialGradient id="${id}-sheen" gradientUnits="userSpaceOnUse" cx="78" cy="72" r="96">
      <stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity=".18"/>
    </radialGradient>
    <filter id="${id}-inv" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="-1 0 0 0 1  0 -1 0 0 1  0 0 -1 0 1  0 0 0 1 0"/>
    </filter>
    <filter id="${id}-soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="5"/>
    </filter>
    <filter id="${id}-wax" filterUnits="userSpaceOnUse" x="0" y="0" width="200" height="200" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="4.2" result="dome"/>
      <feTurbulence type="fractalNoise" baseFrequency=".11" numOctaves="2" seed="${seed % 997}" result="grain"/>
      <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .045 0 0 0 0" result="grainA"/>
      <feComposite in="dome" in2="grainA" operator="arithmetic" k2="1" k3="1" result="h"/>
      ${lit('ws-sw', 1.5, 60)}
    </filter>
    <filter id="${id}-imp" filterUnits="userSpaceOnUse" x="0" y="0" width="200" height="200" color-interpolation-filters="sRGB">
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  .2126 .7152 .0722 0 0" result="h0"/>
      <feGaussianBlur in="h0" stdDeviation=".7" result="h"/>
      ${lit('ws-si', 1.35, 50)}
    </filter>
  </defs>
  <g class="ws-wax">
    <path class="ws-blob" d="" filter="url(#${id}-wax)"/>
    <g class="ws-imp" filter="url(#${id}-imp)" mask="url(#${id}-mask)" opacity="0">
      <circle cx="100" cy="100" r="76" fill="url(#${id}-rim)"/>
      <image class="ws-relief" href="${esc(emblem)}" x="${100 - RM}" y="${100 - RM}" width="${RM * 2}" height="${RM * 2}" clip-path="url(#${id}-face)" preserveAspectRatio="xMidYMid slice" opacity=".8" ${inv}/>
    </g>
  </g>
  <circle class="ws-shadow" cx="100" cy="100" r="${RM}" filter="url(#${id}-soft)"/>
  <g class="ws-matrix">
    <circle class="ws-disc" cx="100" cy="100" r="${RM}"/>
    <image class="ws-face" href="${esc(emblem)}" x="${100 - RM}" y="${100 - RM}" width="${RM * 2}" height="${RM * 2}" clip-path="url(#${id}-face)" preserveAspectRatio="xMidYMid slice"/>
    <circle cx="100" cy="100" r="${RM - 0.5}" fill="url(#${id}-sheen)"/>
    <circle class="ws-ring" cx="100" cy="100" r="${RM - 0.5}"/>
  </g>
</svg>`;
}

let uid = 0;

export function waxSeal(btn, opts = {}) {
    if (!btn || btn.__waxSeal) return () => {};
    const o = (k, d) => opts[k] ?? btn.dataset[k] ?? d;
    const pool = String(o('emblem', DEFAULT_EMBLEM)).split(',').map((s) => s.trim()).filter(Boolean);
    const cfg = {
        emblem: pool[Math.floor(Math.random() * pool.length)] || DEFAULT_EMBLEM,
        duration: Math.max(200, Number(o('duration', 900))),
        done: o('done', 'Sealed'),
        announce: o('announce', null),
        hint: o('hint', 'Press and hold to confirm.'),
        submit: String(o('submit', 'auto')),
        input: o('input', null),
        reset: Number(o('reset', 0)),
        relief: o('relief', 'raised'),
        wax: o('wax', null),
        layout: o('layout', 'pill'),
        haptic: String(o('haptic', 'true')) !== 'false',
    };
    if (cfg.wax) btn.style.setProperty('--ws-wax', cfg.wax);

    /* ---- build ---- */
    const id = `ws${++uid}`;
    let seed = (Math.random() * 1e9) | 0;
    const span = (cls) => { const s = document.createElement('span'); s.className = cls; return s; };
    const kids = [...btn.childNodes];
    const label = span('ws-label');
    const lIdle = span('ws-l ws-l-idle');
    lIdle.append(...kids);
    const lDone = span('ws-l ws-l-done');
    lDone.textContent = cfg.done;
    lDone.setAttribute('aria-hidden', 'true');
    label.append(lIdle, lDone);
    const seal = span('ws-seal');
    seal.setAttribute('aria-hidden', 'true');
    seal.innerHTML = svgMarkup(id, cfg.emblem, seed, cfg.relief);
    btn.append(seal, label);

    const hint = span('ws-sr');
    hint.id = `${id}-hint`;
    hint.textContent = cfg.hint;
    const live = span('ws-sr');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    btn.after(live);
    btn.append(hint);
    const describedBefore = btn.getAttribute('aria-describedby');
    btn.setAttribute('aria-describedby', [describedBefore, hint.id].filter(Boolean).join(' '));
    btn.classList.add('ws');
    if (cfg.layout === 'medallion') btn.classList.add('ws--medallion');
    for (const im of seal.querySelectorAll('image')) im.setAttribute('draggable', 'false');

    const form = btn.form || btn.closest('form');
    let hidden = null;
    if (form && cfg.input) {
        hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = cfg.input;
        hidden.value = '';
        btn.after(hidden);
    }

    const $ = (s) => seal.querySelector(s);
    const blob = $('.ws-blob'), imp = $('.ws-imp'), shadow = $('.ws-shadow'), matrix = $('.ws-matrix'), waxG = $('.ws-wax');
    const floods = seal.querySelectorAll('.ws-flood');
    const specs = seal.querySelectorAll('.ws-spec');
    const specK = [...specs].map((n) => Number(n.getAttribute('specularConstant')));
    const scW = seal.querySelectorAll('.ws-sw'), scI = seal.querySelectorAll('.ws-si');

    let shape = blobShape(seed);
    let waxSet = rgbOf(getComputedStyle(btn).getPropertyValue('--ws-wax').trim() || '#8a1c16', btn);
    let waxHot = molten(waxSet);
    const bodies = seal.querySelectorAll('.ws-body');
    // Dark wax (black, bottle green) would swallow the relief: multiply by
    // the light alone gives black on black. Add a little of the light itself,
    // offset so flat wax keeps its true colour and only slopes change, and
    // more gloss, which is how you read relief on black wax in real life.
    let dark = 0;
    function tone() {
        const lum = (0.2126 * waxSet[0] + 0.7152 * waxSet[1] + 0.0722 * waxSet[2]) / 255;
        dark = clamp(1 - lum / 0.3);
        const q = 0.05 + 0.2 * dark, flat = Math.sin(44 * Math.PI / 180);
        bodies.forEach((n) => { n.setAttribute('k3', q.toFixed(3)); n.setAttribute('k4', (-q * flat).toFixed(3)); });
    }
    tone();

    /* ---- context ---- */
    let prog = 0, vel = 0;          // hold progress 0..1 and its spring velocity
    let hov = 0, hovV = 0;          // hover lift 0..1 (spring)
    let lt = 0, ct = 0, rt = 0;     // lifting, cooling, clearing timelines 0..1
    let hover = false, focused = false;
    let pointer = null;             // the pointerId holding the button
    let keyHeld = false;
    let resetTimer = 0;
    const engaged = () => (hover || focused) && !btn.disabled;

    const emit = (name, extra = {}) => btn.dispatchEvent(new CustomEvent(name, {
        bubbles: true, cancelable: name === 'seal', detail: { state: m.state, form, emblem: cfg.emblem, ...extra },
    }));
    let submitAllowed = true;

    const m = interpret(CHART, {
        guards: {
            engaged,
            formValid: () => {
                if (!form || !wantsSubmit()) return true;
                if (form.checkValidity()) return true;
                form.reportValidity();
                return false;
            },
        },
        actions: {
            hold() { holdT = performance.now(); kick(); },
            recoil() { if (calm.matches) { prog = 0; vel = 0; m.send('SETTLED'); } else kick(); },
            commit() {
                const at = new Date().toISOString();
                if (hidden) hidden.value = at;
                live.textContent = cfg.announce || cfg.done;
                lIdle.setAttribute('aria-hidden', 'true');
                lDone.removeAttribute('aria-hidden');
                btn.setAttribute('aria-disabled', 'true');
                // Chrome only lets a page vibrate after a first tap; a touch hold is not
                // one until it lifts, so the very first hold on a page stays silent.
                const ua = navigator.userActivation;
                if (cfg.haptic && navigator.vibrate && (!ua || ua.hasBeenActive)) { try { navigator.vibrate(12); } catch (e) { /* not allowed */ } }
                submitAllowed = emit('seal', { at });
            },
            lift() { lt = 0; if (calm.matches) { lt = 1; m.send('LIFTED'); } else kick(); },
            submit() {
                if (!form || !submitAllowed || !wantsSubmit()) return;
                try { btn.type === 'submit' ? form.requestSubmit(btn) : form.requestSubmit(); } catch (e) { form.submit(); }
            },
            cool() { ct = 0; if (calm.matches) { ct = 1; m.send('COOLED'); } else kick(); },
            rest() {
                render();
                if (cfg.reset > 0) resetTimer = setTimeout(() => m.send('RESET'), cfg.reset);
            },
            clear() {
                clearTimeout(resetTimer);
                live.textContent = '';
                if (hidden) hidden.value = '';
                lDone.setAttribute('aria-hidden', 'true');
                lIdle.removeAttribute('aria-hidden');
                btn.removeAttribute('aria-disabled');
                rt = 0;
                if (calm.matches) { rt = 1; finishClear(); } else kick();
            },
            snap() { pointer = null; keyHeld = false; prog = 0; vel = 0; render(); },
        },
        onChange(state, from, event) {
            btn.dataset.state = state;
            if (state !== 'idle' && state !== 'armed') emit('wax-seal:state', { from, event });
        },
    });
    const wantsSubmit = () => cfg.submit === 'true' || (cfg.submit === 'auto' && !cfg.input && btn.type === 'submit');
    function finishClear() {
        prog = vel = lt = ct = 0;
        seed = (Math.random() * 1e9) | 0;
        shape = blobShape(seed);
        m.send('CLEARED');
        if (engaged()) m.send('ENGAGE');
        render();
    }

    /* ---- surface scale follows the rendered size ----
     * The lighting's normals are taken per filter pixel, which Chrome counts
     * in CSS pixels whatever the DPR (checked at DPR 1 and 3: same relief). A
     * fixed surfaceScale would make a small seal look steeper than a big one,
     * so scale it by CSS pixels per SVG unit.                                  */
    function rescale() {
        const w = seal.getBoundingClientRect().width / 0.6;
        const k = clamp(w / 200, 0.1, 3);
        scW.forEach((n) => n.setAttribute('surfaceScale', (5.2 * k).toFixed(2)));
        scI.forEach((n) => n.setAttribute('surfaceScale', (3.4 * k).toFixed(2)));
    }

    /* ---- draw the current context ---- */
    function render() {
        const s = m.state;
        const sealedish = s === 'lifting' || s === 'cooling' || s === 'sealed' || s === 'resetting';
        const e = sealedish ? 1 : 1 - Math.pow(1 - prog, 2);         // spread of the wax
        const le = easeOut(lt);
        if (e > 0.004) {
            blob.setAttribute('d', blobPath(shape, RM * (0.9 + 0.46 * e), e));
            blob.style.display = '';
        } else blob.style.display = 'none';

        // matrix: lifts a hair on hover, sinks with the press, rises off at the end
        const dip = s === 'lifting' ? Math.sin(Math.PI * clamp(lt / 0.16)) * 0.012 : 0;
        const sc = 1 + 0.028 * hov - 0.045 * e * (1 - le) - dip + 0.11 * le;
        const ty = -2.5 * hov - 16 * le;
        const tx = -6 * le;
        matrix.setAttribute('transform', `translate(${100 + tx} ${100 + ty}) scale(${sc.toFixed(4)}) translate(-100 -100)`);
        const gone = sealedish ? smooth(0.06, 0.52, lt) : 0;           // gone before it reads as a cross-fade
        matrix.setAttribute('opacity', (s === 'resetting' ? rt : sealedish ? 1 - gone : 1).toFixed(3));

        // its shadow: close and dark when pressed, wide and faint when lifted
        const press = e * (1 - le);
        const off = (1 + 1.6 * hov) * (1 - 0.85 * press) + 16 * le;
        const ssc = 1 + 0.03 * hov - 0.04 * press + 0.14 * le;
        shadow.setAttribute('transform', `translate(${100 + off * 0.7} ${100 + off}) scale(${ssc.toFixed(4)}) translate(-100 -100)`);
        const so = (0.2 + 0.05 * hov + 0.16 * press) * (sealedish ? (s === 'resetting' ? rt : 1 - smooth(0.04, 0.6, lt)) : 1);
        shadow.setAttribute('opacity', so.toFixed(3));

        // the impression shows as the matrix leaves; the wax cools from molten
        imp.setAttribute('opacity', (sealedish ? smooth(0, 0.3, lt) : 0).toFixed(3));
        const c = sealedish ? smooth(0, 1, ct) : 0;
        const col = rgbStr(waxHot.map((v, i) => mix(v, waxSet[i], c)));
        floods.forEach((f) => f.setAttribute('flood-color', col));
        // wet gloss settles as it cools. The exponents are high enough that a
        // flat surface gets almost no gloss (cos 23° ^ 60 ≈ 0.007), so flat wax
        // stays its true colour and only slopes and ridges shine.
        specs.forEach((n, i) => n.setAttribute('specularConstant', (specK[i] * (1 + 0.8 * dark) * mix(1.2, 1, c)).toFixed(3)));
        waxG.setAttribute('opacity', (s === 'resetting' ? 1 - rt : 1).toFixed(3));

        btn.style.setProperty('--ws-p', (sealedish ? 1 : prog).toFixed(4));
        btn.style.setProperty('--ws-hl', (sealedish ? 1 - smooth(0.2, 1, s === 'lifting' ? lt : 1) : 1).toFixed(3));
    }

    /* ---- the clock: runs only while something moves ---- */
    let raf = 0, last = 0, holdT = 0;
    function tick(t) {
        raf = 0;
        const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
        last = t;
        let more = false;
        const s = m.state;
        if (s === 'pressing') {
            // the hold is timed by the wall clock, not by frames: a dropped
            // frame must not make the visitor hold longer than promised
            prog = Math.min(1, prog + clamp(t - holdT, 0, 250) / cfg.duration);
            holdT = Math.max(holdT, t);
            vel = 0;
            more = true;
            if (prog >= 1) m.send('COMPLETE');
        } else if (s === 'recoiling') {
            const k = 120, c = 2 * Math.sqrt(k);              // critically damped: home, no bounce
            vel += (-k * prog - c * vel) * dt;
            prog = Math.max(0, prog + vel * dt);
            if (prog < 0.002 && Math.abs(vel) < 0.02) { prog = 0; vel = 0; m.send('SETTLED'); } else more = true;
        } else if (s === 'lifting') {
            lt = Math.min(1, lt + (dt * 1000) / LIFT_MS);
            more = true;
            if (lt >= 1) m.send('LIFTED');
        } else if (s === 'cooling') {
            ct = Math.min(1, ct + (dt * 1000) / COOL_MS);
            more = true;
            if (ct >= 1) m.send('COOLED');
        } else if (s === 'resetting') {
            rt = Math.min(1, rt + (dt * 1000) / CLEAR_MS);
            if (rt >= 1) finishClear(); else more = true;
        }
        const target = !calm.matches && engaged() && (s === 'armed' || s === 'pressing' || s === 'recoiling') ? 1 : 0;
        hovV += (-170 * (hov - target) - 2 * Math.sqrt(170) * hovV) * dt;
        hov += hovV * dt;
        if (Math.abs(hov - target) + Math.abs(hovV) > 0.001) more = true; else { hov = target; hovV = 0; }
        render();
        if (more) raf = requestAnimationFrame(tick);
        else last = 0;
    }
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

    /* ---- inputs become events ---- */
    const ac = new AbortController();
    const on = (target, type, fn, o2 = {}) => target.addEventListener(type, fn, { signal: ac.signal, ...o2 });
    const engage = () => { m.send(engaged() ? 'ENGAGE' : 'DISENGAGE'); kick(); };
    const inside = (e, slop = 0) => {
        const r = btn.getBoundingClientRect();
        return e.clientX >= r.left - slop && e.clientX <= r.right + slop && e.clientY >= r.top - slop && e.clientY <= r.bottom + slop;
    };

    on(btn, 'pointerenter', (e) => {
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') { hover = true; engage(); }
        // back over the button with the same press still held: carry on, like a native button
        if (pointer === e.pointerId && (e.buttons & 1)) m.send('PRESS');
    });
    on(btn, 'pointerleave', (e) => {
        if (e.pointerType === 'mouse' || e.pointerType === 'pen') { hover = false; engage(); }
        // only a real exit counts: a leave reported with the pointer still over
        // the button (a layer appearing above it, a screenshot) is not one
        if (pointer === e.pointerId && !inside(e)) m.send('CANCEL');
    });
    on(btn, 'pointerdown', (e) => {
        if (!e.isPrimary || e.button !== 0 || pointer !== null) return;
        pointer = e.pointerId;
        m.send('PRESS');
    });
    on(btn, 'pointermove', (e) => {
        // touch keeps the pointer captured to the button, so leave never fires: check by hand
        if (pointer !== e.pointerId || e.pointerType === 'mouse') return;
        if (!inside(e, 14)) m.send('CANCEL');
        else if (m.state === 'recoiling') m.send('PRESS');
    });
    const up = (e) => {
        if (pointer !== e.pointerId) return;
        pointer = null;
        m.send('RELEASE');
    };
    on(btn, 'pointerup', up);
    on(window, 'pointerup', up);
    on(btn, 'pointercancel', (e) => { if (pointer === e.pointerId) { pointer = null; m.send('CANCEL'); } });
    on(btn, 'contextmenu', (e) => e.preventDefault());
    on(btn, 'dragstart', (e) => e.preventDefault());
    on(btn, 'click', (e) => e.preventDefault());       // only the hold submits; requestSubmit sends no click

    const isKey = (e) => e.key === ' ' || e.key === 'Enter' || e.key === 'Spacebar';
    on(btn, 'keydown', (e) => {
        if (e.key === 'Escape' && (m.state === 'pressing')) { keyHeld = false; m.send('CANCEL'); return; }
        if (!isKey(e)) return;
        e.preventDefault();
        if (e.repeat || keyHeld) return;
        keyHeld = true;
        m.send('PRESS');
    });
    on(btn, 'keyup', (e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        if (!keyHeld) return;
        keyHeld = false;
        m.send('RELEASE');
    });
    on(btn, 'focus', () => { focused = btn.matches(':focus-visible'); engage(); });
    on(btn, 'blur', () => {
        focused = false;
        if (keyHeld) { keyHeld = false; m.send('CANCEL'); }
        engage();
    });
    const lose = () => { if (pointer !== null || keyHeld) { pointer = null; keyHeld = false; m.send('CANCEL'); } };
    on(window, 'blur', lose);
    on(document, 'visibilitychange', () => { if (document.hidden) lose(); });

    const ro = new ResizeObserver(rescale);
    ro.observe(seal);
    const mo = new MutationObserver(() => {
        if (btn.disabled) m.send('DISABLE');
        else if (m.send('ENABLE') && engaged()) m.send('ENGAGE');
    });
    mo.observe(btn, { attributes: true, attributeFilter: ['disabled'] });
    const reread = () => { waxSet = rgbOf(getComputedStyle(btn).getPropertyValue('--ws-wax').trim() || '#8a1c16', btn); waxHot = molten(waxSet); tone(); render(); };
    on(calm, 'change', () => render());

    btn.dataset.state = 'idle';
    if (btn.disabled) m.send('DISABLE');
    rescale();
    render();
    btn.__waxSeal = true;

    function destroy() {
        ac.abort();
        ro.disconnect();
        mo.disconnect();
        cancelAnimationFrame(raf);
        clearTimeout(resetTimer);
        seal.remove();
        hint.remove();
        live.remove();
        if (hidden) hidden.remove();
        btn.replaceChildren(...lIdle.childNodes);
        btn.classList.remove('ws', 'ws--medallion');
        btn.removeAttribute('data-state');
        btn.removeAttribute('aria-disabled');
        describedBefore ? btn.setAttribute('aria-describedby', describedBefore) : btn.removeAttribute('aria-describedby');
        btn.style.removeProperty('--ws-p');
        btn.style.removeProperty('--ws-hl');
        if (cfg.wax) btn.style.removeProperty('--ws-wax');
        if (!btn.classList.length) btn.removeAttribute('class');
        if (!btn.getAttribute('style')) btn.removeAttribute('style');
        delete btn.__waxSeal;
    }
    destroy.reset = () => m.send('RESET');
    destroy.send = (ev) => m.send(ev);
    destroy.recolor = reread;
    Object.defineProperty(destroy, 'state', { get: () => m.state });
    return destroy;
}

document.querySelectorAll('[data-wax-seal]').forEach((el) => waxSeal(el));
