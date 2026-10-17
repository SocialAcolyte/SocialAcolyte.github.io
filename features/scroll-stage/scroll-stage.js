/*
 *  SCROLL-STAGE // a pinned stage whose layers play keyframes as you scroll.
 *
 *  A very small Theatre.js. The section is a tall runway with a sticky stage
 *  inside it; how far you have scrolled through the runway is the playhead,
 *  0 at the top, 1 at the bottom. Every layer declares its own keyframes, and
 *  each property is its own track, so a key only has to name what changes:
 *
 *    <section data-scroll-stage data-length="600svh">
 *      <div class="ss-stage">
 *        <img data-name="ship" src="ship.webp" alt=""
 *             data-keys='{"0":{"x":"-30vw","o":0}, ".35":{"x":0,"o":1,"ease":"out"}}'
 *             data-keys-sm='{"0":{"x":"-50vw"}}'>
 *      </div>
 *    </section>
 *
 *  Properties:  x y (translate)  s sx sy (scale)  r (rotate)  o (opacity)
 *               blur  gray (grayscale 0..1)  clip (any clip-path: inset,
 *               circle, polygon; same shape on both sides)  --any (a CSS
 *               custom property, written on the layer for your own CSS).
 *  Units:       anything CSS takes. Bare numbers are px for x/y/blur and deg
 *               for r. Mixed units interpolate through calc(), so
 *               "-30vw" -> "50%" is fine. 0 takes the unit of its neighbour.
 *  Easing:      "ease" on a key shapes the segment that arrives at it.
 *               linear in out inOut (cubic), inSine..inOutSine, inQuad..,
 *               inExpo.., hold, the CSS keywords, or "cubic-bezier(a,b,c,d)".
 *               Per property: "x":["0","out"].
 *  Phone:       data-keys-sm overrides keys while data-sm (a media query,
 *               default max-width 699px) holds: a key at the same time
 *               replaces that value, any other key is added.
 *
 *  Options on the section (data-), or scrollStage(el, opts) (opts win):
 *    length  "500svh"  runway height
 *    smooth  0.12      seconds the playhead takes to catch the scroll (0 = raw)
 *    still   0.5       the moment shown, unpinned, under reduced motion
 *    sm      "(max-width: 699px)"   when data-keys-sm applies
 *    ease    "inOut"   default ease for keys that do not say
 *
 *  All layers are written in one rAF pass, and only what changed is written.
 *  The loop runs while the playhead is catching up and stops when it settles
 *  or the stage leaves the screen.
 *
 *  Timeline: press ` (or add ?timeline to the URL) for a dev panel along the
 *  bottom: one row per layer with its keyframes, the playhead, the time. Drag
 *  the playhead (or anywhere on the lanes) to scrub; it snaps to keys; arrow
 *  keys step, [ and ] jump between keys, Esc closes.
 *
 *  Reduced motion: no runway, no pinning; the stage is drawn once at `still`
 *  (the timeline can still scrub it, by hand). Without JS the layers sit at
 *  their CSS positions, so make those the composed still.
 */

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const mix = (a, b, t) => a + (b - a) * t;
const round = (v) => Math.round(v * 1e4) / 1e4;

/* ── Easing ─────────────────────────────────────────────────────────── */

function bezier(x1, y1, x2, y2) {
    // Solve x(u) = t for u (Newton, then bisection), return y(u).
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (u) => ((ax * u + bx) * u + cx) * u;
    const dX = (u) => (3 * ax * u + 2 * bx) * u + cx;
    const Y = (u) => ((ay * u + by) * u + cy) * u;
    return (t) => {
        if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1;
        let u = t;
        for (let i = 0; i < 6; i++) {
            const d = dX(u);
            if (Math.abs(d) < 1e-6) break;
            const nu = u - (X(u) - t) / d;
            if (nu < 0 || nu > 1) break;
            u = nu;
        }
        if (Math.abs(X(u) - t) > 1e-5) {
            let a = 0, b = 1;
            for (let i = 0; i < 24; i++) { u = (a + b) / 2; X(u) < t ? (a = u) : (b = u); }
        }
        return Y(u);
    };
}

const EASE = {
    linear: (t) => t,
    in: (t) => t * t * t,
    out: (t) => 1 - Math.pow(1 - t, 3),
    inOut: (t) => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    inQuad: (t) => t * t,
    outQuad: (t) => 1 - (1 - t) * (1 - t),
    inOutQuad: (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
    inSine: (t) => 1 - Math.cos((t * Math.PI) / 2),
    outSine: (t) => Math.sin((t * Math.PI) / 2),
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOutExpo: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t < .5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2),
    hold: (t) => (t < 1 ? 0 : 1),
    ease: bezier(.25, .1, .25, 1),
    'ease-in': bezier(.42, 0, 1, 1),
    'ease-out': bezier(0, 0, .58, 1),
    'ease-in-out': bezier(.42, 0, .58, 1)
};

function easing(name) {
    if (!name) return null;
    if (EASE[name]) return EASE[name];
    const m = /cubic-bezier\(([^)]+)\)/.exec(name);
    if (m) {
        const p = m[1].split(',').map(Number);
        if (p.length === 4 && p.every(isFinite)) return (EASE[name] = bezier(p[0], p[1], p[2], p[3]));
    }
    return null;
}

/* ── Values ─────────────────────────────────────────────────────────── */

// A value is a template with numbers in it: "inset(0% 12% 0% 12%)" becomes
// gaps ["inset(", " ", " ", " ", ")"] around four {n, u} numbers. Two values
// with the same count of numbers interpolate number by number.
const NUM = /(-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)([a-z%]*)/gi;
const BASE_UNIT = { x: 'px', y: 'px', blur: 'px', r: 'deg' };
const DEFAULTS = { x: 0, y: 0, s: 1, sx: 1, sy: 1, r: 0, o: 1, blur: 0, gray: 0 };

function parse(v, prop) {
    const s = String(v).trim();
    const gaps = [], nums = [];
    let at = 0, m;
    NUM.lastIndex = 0;
    while ((m = NUM.exec(s))) {
        gaps.push(s.slice(at, m.index));
        nums.push({ n: parseFloat(m[1]), u: m[2] || '' });
        at = m.index + m[0].length;
    }
    gaps.push(s.slice(at));
    if (nums.length === 1 && BASE_UNIT[prop] && !nums[0].u && !gaps[0] && !gaps[1]) nums[0].u = BASE_UNIT[prop];
    return { s, gaps, nums };
}

function lerp(a, b, t) {
    if (t <= 0) return a.s;
    if (t >= 1) return b.s;
    if (a.nums.length !== b.nums.length || !a.nums.length) return t < 1 ? a.s : b.s;
    let out = a.gaps[0];
    for (let i = 0; i < a.nums.length; i++) {
        const A = a.nums[i], B = b.nums[i];
        let ua = A.u, ub = B.u;
        if (!ua && A.n === 0) ua = ub;
        if (!ub && B.n === 0) ub = ua;
        if (ua === ub) out += round(mix(A.n, B.n, t)) + ua;
        else out += `calc(${A.n}${ua} * ${round(1 - t)} + ${B.n}${ub} * ${round(t)})`;
        out += a.gaps[i + 1];
    }
    return out;
}

/* ── Tracks ─────────────────────────────────────────────────────────── */

function readKeys(json) {
    if (!json) return null;
    if (typeof json !== 'string') return json;
    try { return JSON.parse(json); } catch (e) { /* try once more, forgivingly */ }
    // Hand-written keys often say .5 for 0.5, or leave a trailing comma.
    const fixed = json.replace(/([:\[,]\s*)(-?)\.(\d)/g, (m, a, s, d) => `${a}${s}0.${d}`).replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch (e) {
        console.warn('scroll-stage: could not read keyframes', json);
        return null;
    }
}

// {"0":{...}, ".35":{...}} -> { prop: [{t, v, ease}] } sorted by time.
function tracksFrom(keys, defEase) {
    const tracks = {};
    if (!keys) return tracks;
    for (const [time, frame] of Object.entries(keys)) {
        const t = clamp(String(time).endsWith('%') ? parseFloat(time) / 100 : parseFloat(time));
        if (!isFinite(t) || !frame) continue;
        const keyEase = easing(frame.ease) || defEase;
        for (const [prop, raw] of Object.entries(frame)) {
            if (prop === 'ease') continue;
            const [val, e] = Array.isArray(raw) ? raw : [raw, null];
            (tracks[prop] ||= []).push({ t, v: parse(val, prop), raw: val, ease: easing(e) || keyEase, label: frame.ease || '' });
        }
    }
    for (const k in tracks) tracks[k].sort((a, b) => a.t - b.t);
    return tracks;
}

// The phone variant overrides key by key: a key at the same time replaces
// that property's value there, any other key is added to the track.
function mergeTracks(base, over) {
    for (const [p, keys] of Object.entries(over)) {
        const tr = (base[p] ||= []);
        for (const k of keys) {
            const i = tr.findIndex((q) => Math.abs(q.t - k.t) < 1e-6);
            i >= 0 ? (tr[i] = k) : tr.push(k);
        }
        tr.sort((a, b) => a.t - b.t);
    }
    return base;
}

function sample(track, t) {
    const n = track.length;
    if (t <= track[0].t) return track[0].v.s;
    if (t >= track[n - 1].t) return track[n - 1].v.s;
    let i = 1;
    while (i < n - 1 && track[i].t < t) i++;
    const a = track[i - 1], b = track[i];
    const span = b.t - a.t;
    return lerp(a.v, b.v, span > 0 ? b.ease((t - a.t) / span) : 1);
}

/* ── The stage ──────────────────────────────────────────────────────── */

const live = new Set();          // running instances, for the timeline

export function scrollStage(root, opts = {}) {
    const stage = root && (root.querySelector('.ss-stage') || root.firstElementChild);
    if (!root || !stage || root.__scrollStage) return () => {};
    const d = root.dataset;
    const cfg = {
        length: opts.length ?? d.length ?? '',
        smooth: Number(opts.smooth ?? d.smooth ?? 0.12),
        still: Number(opts.still ?? d.still ?? 0.5),
        sm: opts.sm ?? d.sm ?? '(max-width: 699px)',
        ease: opts.ease ?? d.ease ?? 'inOut'
    };
    const small = matchMedia(cfg.sm);
    const defEase = easing(cfg.ease) || EASE.inOut;

    const inst = { root, stage, layers: [], t: 0, target: 0, seek, name: d.name || root.id || 'stage' };
    root.__scrollStage = inst;

    function build() {
        const els = [stage, ...stage.querySelectorAll('[data-keys]')].filter((el) => el.dataset.keys);
        // Clear what the previous build wrote, so a track that vanished on a
        // breakpoint change does not leave its last value behind.
        for (const L of inst.layers) clearStyles(L);
        inst.layers = els.map((el) => {
            const tracks = tracksFrom(readKeys(el.dataset.keys), defEase);
            if (small.matches && el.dataset.keysSm) mergeTracks(tracks, tracksFrom(readKeys(el.dataset.keysSm), defEase));
            const props = Object.keys(tracks);
            const times = [...new Set(props.flatMap((p) => tracks[p].map((k) => k.t)))].sort((a, b) => a - b);
            const cls = [...el.classList].find((c) => !/^ss-layer$/.test(c));
            return {
                el, tracks, props, times,
                name: el.dataset.name || el.id || cls || el.tagName.toLowerCase(),
                hasT: props.some((p) => /^(x|y|s|sx|sy|r)$/.test(p)),
                hasF: props.some((p) => p === 'blur' || p === 'gray'),
                last: {}
            };
        });
    }

    function clearStyles(L) {
        const st = L.el.style;
        if (L.last.transform != null) st.transform = '';
        if (L.last.opacity != null) st.opacity = '';
        if (L.last.filter != null) st.filter = '';
        if (L.last.clip != null) st.clipPath = '';
        for (const k in L.last) if (k.startsWith('--')) st.removeProperty(k);
        L.last = {};
    }

    const val = (L, p, t) => (L.tracks[p] ? sample(L.tracks[p], t) : DEFAULTS[p]);

    function write(L, key, v, apply) {
        if (L.last[key] === v) return;
        L.last[key] = v;
        apply(v);
    }

    function render(t) {
        for (const L of inst.layers) {
            const st = L.el.style;
            if (L.hasT) {
                const s = Number(val(L, 's', t));
                const sx = Number(val(L, 'sx', t)) * s, sy = Number(val(L, 'sy', t)) * s;
                const x = L.tracks.x ? val(L, 'x', t) : '0px', y = L.tracks.y ? val(L, 'y', t) : '0px';
                const r = L.tracks.r ? val(L, 'r', t) : '0deg';
                const tf = `translate3d(${x}, ${y}, 0) rotate(${r})` + (sx !== 1 || sy !== 1 ? ` scale(${round(sx)}, ${round(sy)})` : '');
                write(L, 'transform', tf, (v) => (st.transform = v));
            }
            if (L.tracks.o) write(L, 'opacity', String(round(clamp(Number(val(L, 'o', t))))), (v) => (st.opacity = v));
            if (L.hasF) {
                const b = L.tracks.blur ? val(L, 'blur', t) : '0px';
                const g = clamp(Number(L.tracks.gray ? val(L, 'gray', t) : 0));
                const f = (parseFloat(b) > 0.01 ? `blur(${b}) ` : '') + (g > 0.001 ? `grayscale(${round(g)})` : '');
                write(L, 'filter', f.trim() || 'none', (v) => (st.filter = v));
            }
            if (L.tracks.clip) write(L, 'clip', val(L, 'clip', t), (v) => (st.clipPath = v));
            for (const p of L.props) {
                if (p.startsWith('--')) write(L, p, val(L, p, t), (v) => st.setProperty(p, v));
            }
        }
        root.style.setProperty('--ss-t', round(t));
        if (inst.onFrame) inst.onFrame(inst);
    }

    /* Playhead */
    function progress() {
        if (calm.matches) return manual ?? cfg.still;
        const r = root.getBoundingClientRect();
        const run = r.height - stage.offsetHeight;
        return run > 0 ? clamp(-r.top / run) : 0;
    }

    let manual = null;              // reduced motion: a time set by the timeline
    function seek(t) {
        t = clamp(t);
        if (calm.matches) { manual = t; kick(); return; }
        const top = root.getBoundingClientRect().top + scrollY;
        const run = root.offsetHeight - stage.offsetHeight;
        scrollTo({ top: Math.round(top + t * run), behavior: 'instant' });
        inst.target = t;
        kick();
    }

    let raf = 0, lastTs = 0, visible = false, first = true;
    function frame(ts) {
        raf = 0;
        const dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0.016;
        lastTs = ts;
        inst.target = progress();
        if (first || calm.matches || cfg.smooth <= 0) inst.t = inst.target;
        else {
            inst.t += (inst.target - inst.t) * (1 - Math.exp(-dt / cfg.smooth));
            if (Math.abs(inst.target - inst.t) < 2e-4) inst.t = inst.target;
        }
        first = false;
        render(inst.t);
        if (inst.t !== inst.target && (visible || calm.matches)) raf = requestAnimationFrame(frame);
        else lastTs = 0;
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    inst.kick = kick;

    const onScroll = () => { if (visible) kick(); };
    const onMedia = () => { build(); first = true; kick(); };
    const onCalm = () => { root.classList.toggle('is-still', calm.matches); first = true; kick(); };
    let resizeT = 0;
    const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(() => { first = true; kick(); }, 120); };

    const io = new IntersectionObserver((en) => {
        visible = en[0].isIntersecting;
        if (visible) { first = true; kick(); }
    }, { rootMargin: '120px' });

    if (cfg.length) root.style.setProperty('--ss-length', cfg.length);
    build();
    root.classList.add('is-live');
    root.classList.toggle('is-still', calm.matches);
    io.observe(root);
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onResize, { passive: true });
    small.addEventListener('change', onMedia);
    calm.addEventListener('change', onCalm);
    live.add(inst);
    timeline.refresh();
    kick();

    return function destroy() {
        cancelAnimationFrame(raf);
        io.disconnect();
        removeEventListener('scroll', onScroll);
        removeEventListener('resize', onResize);
        small.removeEventListener('change', onMedia);
        calm.removeEventListener('change', onCalm);
        for (const L of inst.layers) clearStyles(L);
        root.classList.remove('is-live', 'is-still');
        root.style.removeProperty('--ss-length');
        root.style.removeProperty('--ss-t');
        live.delete(inst);
        delete root.__scrollStage;
        timeline.refresh();
    };
}

/* ── Timeline (dev panel) ───────────────────────────────────────────── */

const timeline = (() => {
    let panel = null, cur = null, rows = [], head, readout, lanes, ruler, label;
    let open = false, dragging = false;

    const fmt = (t) => t.toFixed(3);
    const keyText = (L, t) => L.props
        .filter((p) => L.tracks[p].some((k) => k.t === t))
        .map((p) => {
            const k = L.tracks[p].find((q) => q.t === t);
            return `${p} ${k.raw}`;
        }).join('  ·  ');

    // The stage the visitor is looking at: the most of it on screen.
    function pick() {
        let best = null, area = -1;
        for (const s of live) {
            const r = s.root.getBoundingClientRect();
            const a = Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
            if (a > area) { area = a; best = s; }
        }
        return best;
    }

    function make() {
        panel = document.createElement('div');
        panel.className = 'ss-tl';
        panel.setAttribute('role', 'region');
        panel.setAttribute('aria-label', 'Scroll stage timeline');
        panel.innerHTML = `
          <div class="ss-tl-bar">
            <span class="ss-tl-name"></span>
            <output class="ss-tl-time" aria-live="off">0.000</output>
            <button class="ss-tl-x" type="button" aria-label="Close timeline">×</button>
          </div>
          <div class="ss-tl-body">
            <div class="ss-tl-ruler"><div class="ss-tl-lane"></div></div>
            <div class="ss-tl-rows"></div>
            <div class="ss-tl-headwrap"><div class="ss-tl-head" role="slider" tabindex="0"
                 aria-label="Playhead" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"></div></div>
          </div>`;
        label = panel.querySelector('.ss-tl-name');
        readout = panel.querySelector('.ss-tl-time');
        lanes = panel.querySelector('.ss-tl-rows');
        ruler = panel.querySelector('.ss-tl-ruler .ss-tl-lane');
        head = panel.querySelector('.ss-tl-head');
        for (let i = 0; i <= 10; i++) {
            const tick = document.createElement('span');
            tick.className = 'ss-tl-tick';
            tick.style.left = `${i * 10}%`;
            tick.textContent = i === 0 ? '0' : i === 10 ? '1' : `.${i}`;
            ruler.appendChild(tick);
        }
        panel.querySelector('.ss-tl-x').addEventListener('click', () => toggle(false));

        // Scrub: press anywhere on the ruler, lanes or playhead and drag.
        const body = panel.querySelector('.ss-tl-body');
        body.addEventListener('pointerdown', (e) => {
            if (!cur || e.button > 0) return;
            dragging = true;
            body.setPointerCapture(e.pointerId);
            panel.classList.add('is-scrub');
            scrubTo(e, e.target.closest('.ss-tl-key'));
            e.preventDefault();
        });
        body.addEventListener('pointermove', (e) => { if (dragging) scrubTo(e); });
        const end = () => { dragging = false; panel.classList.remove('is-scrub'); };
        body.addEventListener('pointerup', end);
        body.addEventListener('pointercancel', end);

        head.addEventListener('keydown', (e) => {
            if (!cur) return;
            const step = e.shiftKey ? 0.05 : 0.005;
            const map = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step };
            if (e.key in map) { cur.seek(cur.target + map[e.key]); e.preventDefault(); }
            else if (e.key === 'Home') { cur.seek(0); e.preventDefault(); }
            else if (e.key === 'End') { cur.seek(1); e.preventDefault(); }
        });
        document.body.appendChild(panel);
    }

    // Lane x -> time, with a gentle snap to any keyframe within 6px.
    function scrubTo(e, keyEl) {
        const r = ruler.getBoundingClientRect();
        let t = clamp((e.clientX - r.left) / r.width);
        if (keyEl) t = Number(keyEl.dataset.t);
        else {
            let best = null, bd = 6 / r.width;
            for (const L of cur.layers) for (const k of L.times) {
                const dd = Math.abs(k - t);
                if (dd < bd) { bd = dd; best = k; }
            }
            if (best != null) t = best;
        }
        cur.seek(t);
    }

    function rowsFor(inst) {
        lanes.textContent = '';
        rows = inst.layers.map((L) => {
            const row = document.createElement('div');
            row.className = 'ss-tl-row';
            const name = document.createElement('span');
            name.className = 'ss-tl-label';
            name.textContent = L.name;
            name.title = L.props.join(' ');
            const lane = document.createElement('div');
            lane.className = 'ss-tl-lane';
            if (L.times.length > 1) {
                const span = document.createElement('i');
                span.className = 'ss-tl-span';
                span.style.left = `${L.times[0] * 100}%`;
                span.style.width = `${(L.times[L.times.length - 1] - L.times[0]) * 100}%`;
                lane.appendChild(span);
            }
            const keys = L.times.map((t) => {
                const k = document.createElement('b');
                k.className = 'ss-tl-key';
                k.dataset.t = t;
                k.style.left = `${t * 100}%`;
                k.title = `${fmt(t)}   ${keyText(L, t)}`;
                lane.appendChild(k);
                return k;
            });
            row.append(name, lane);
            lanes.appendChild(row);
            return { L, keys, passed: -1 };
        });
        label.textContent = inst.name;
    }

    function update(inst) {
        if (!open || inst !== cur) return;
        const t = inst.t;
        head.style.left = `${t * 100}%`;
        head.setAttribute('aria-valuenow', fmt(t));
        head.setAttribute('aria-valuetext', `time ${fmt(t)}`);
        readout.textContent = fmt(t);
        for (const row of rows) {
            let n = 0;
            while (n < row.L.times.length && row.L.times[n] <= t + 1e-4) n++;
            if (n === row.passed) continue;
            row.keys.forEach((k, i) => k.classList.toggle('is-past', i < n));
            row.passed = n;
        }
    }

    function refresh() {
        if (!open) return;
        const inst = pick();
        if (inst !== cur) {
            if (cur) cur.onFrame = null;
            cur = inst;
            if (cur) { cur.onFrame = update; rowsFor(cur); }
            else { lanes.textContent = ''; label.textContent = ''; }
        }
        if (cur) update(cur);
    }

    function toggle(on = !open) {
        open = on;
        if (open && !panel) make();
        if (panel) panel.hidden = !open;
        document.documentElement.classList.toggle('ss-timeline-open', open);
        if (!open && cur) { cur.onFrame = null; cur = null; }
        refresh();
    }

    let pickT = 0;
    addEventListener('scroll', () => { if (open) { cancelAnimationFrame(pickT); pickT = requestAnimationFrame(refresh); } }, { passive: true });
    addEventListener('keydown', (e) => {
        if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
        if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey) { toggle(); e.preventDefault(); return; }
        if (!open || !cur) return;
        if (e.key === 'Escape') toggle(false);
        else if (e.key === '[' || e.key === ']') {
            const all = [...new Set(cur.layers.flatMap((L) => L.times))].sort((a, b) => a - b);
            const t = cur.target;
            const next = e.key === ']' ? all.find((k) => k > t + 1e-4) : [...all].reverse().find((k) => k < t - 1e-4);
            if (next != null) cur.seek(next);
        }
    });
    if (/[?&]timeline\b/.test(location.search)) queueMicrotask(() => toggle(true));
    return { refresh, toggle };
})();

export const toggleTimeline = (on) => timeline.toggle(on);

document.querySelectorAll('[data-scroll-stage]').forEach((el) => scrollStage(el));
