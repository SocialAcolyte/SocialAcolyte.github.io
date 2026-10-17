/*
 *  PRETEXT-GLOSS // the glossed page.
 *
 *  Markup:  <article class="pg" data-pretext-gloss data-initial="assets/initial-t.webp">
 *             <header class="pg-head">…running head…</header>
 *             <div class="pg-main">
 *               <p>…<span data-lemma="vanity">Vanity of vanities</span>…</p>
 *             </div>
 *             <aside class="pg-gloss" aria-label="Glossa">            (inner)
 *               <p data-gloss="vanity"><b>Vanity of vanities.</b> The word is hevel…</p>
 *             </aside>
 *             <aside class="pg-gloss" aria-label="Postilla">…</aside>   (outer)
 *             <footer class="pg-foot">…catchword…</footer>
 *           </article>
 *  Or call pretextGloss(article, options) yourself; it returns destroy().
 *
 *  The page of a glossed Bible or a Talmud folio, laid out live. The main
 *  text is a central block in larger type; the two commentaries wrap round
 *  it, the inner on the left and the outer on the right, taking the full
 *  half-measure above and below it and a narrow column beside it. Every
 *  commentary line sits on one baseline grid, and a line of the main text
 *  is exactly two of them, so the baselines of both sizes line up across
 *  the page.
 *
 *  The layout is solved, not set. Cheng Lou's pretext (vendor/pretext, MIT)
 *  measures each text once; after that a line is pure arithmetic
 *  (layoutNextLineRange), so the whole page can be poured hundreds of times
 *  a frame. Two nested binary searches:
 *    - the split: where the main block sits across the page. Moving it
 *      right widens the inner column and narrows the outer, so the inner
 *      commentary gets shorter and the outer longer; bisect until both end
 *      on the same row. Then the split of the band below the block is
 *      nudged on its own until they do, and among the splits that tie, the
 *      one whose last lines are fullest wins.
 *    - the measure: how wide the main block is. Wider is shorter, and the
 *      commentaries beside it get narrower and longer, so the rows of
 *      commentary left under the block grow with it; bisect for the
 *      narrowest block that leaves data-tail rows beneath.
 *  Lines are justified by the browser (text-align-last: justify on a line
 *  of exactly pretext's text), with hanging punctuation: a line that ends
 *  in a stop or comma is made that much wider, so the letters, not the
 *  points, make the edge.
 *
 *  Each gloss is keyed to its lemma with a red letter (a, b, c … in the
 *  Latin alphabet, no j or u). Hover a gloss or a lemma, or tap it, or tab
 *  to its key: the page quiets, the pair stays dark, and a red hairline is
 *  drawn from one key to the other. Click or tap pins it; Esc or a click
 *  elsewhere lets go. The state is a small statechart (CHART).
 *
 *  Narrower than data-stack-below (a phone), the folio becomes a column:
 *  the main text in paragraphs, the glosses folded under each paragraph.
 *
 *  The source markup stays in the DOM (screen readers, find, no JS); the
 *  folio is drawn beside it and aria-hidden. Reduced motion: no inking in,
 *  no drawing, the initial already in colour.
 */

const LIB = './vendor/pretext/layout.js';
let uid = 0;
const REF = 100;                       // pretext measures at 100px; widths scale linearly
const KEYS = 'abcdefghiklmnopqrstxyz'; // the Latin alphabet: no j, u, w
const HANG_R = { '.': 1, ',': 1, '-': 1, '’': 1, '”': 1, ';': .5, ':': .5, '!': .4, '?': .35, ')': .4 };
const HANG_L = { '‘': 1, '“': 1, '(': .5 };

const calm = matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---- the statechart -------------------------------------------------------
 * Which gloss is lit, and why. Inputs (pointer, touch, keys, focus) only
 * send events; the chart decides what they mean now. Events a state does
 * not list are ignored.                                                   */
export const CHART = {
    initial: 'idle',
    states: {
        idle:       { on: { POINT: 'previewing', TAP: 'pinned', FOCUS: 'focused' } },
        previewing: { on: { POINT: 'previewing', LEAVE: 'idle', TAP: 'pinned', FOCUS: 'focused', ESC: 'idle' } },
        pinned:     { on: { POINT: [{ target: 'pinned', guard: 'onPin' }, { target: 'peeking' }],
                            TAP: [{ target: 'idle', guard: 'onPin' }, { target: 'pinned' }],
                            DISMISS: 'idle', ESC: 'idle', FOCUS: 'focused' } },
        peeking:    { on: { POINT: [{ target: 'pinned', guard: 'onPin' }, { target: 'peeking' }],
                            LEAVE: 'pinned', TAP: [{ target: 'idle', guard: 'onPin' }, { target: 'pinned' }],
                            DISMISS: 'idle', ESC: 'idle', FOCUS: 'focused' } },
        focused:    { on: { FOCUS: 'focused', BLUR: 'idle', ESC: 'idle', TAP: 'pinned' } },
    },
};

function interpret(chart, guards, onChange) {
    let state = chart.initial;
    return {
        get state() { return state; },
        send(event, k) {
            let t = (chart.states[state].on || {})[event];
            if (Array.isArray(t)) t = t.find((c) => !c.guard || guards[c.guard](k));
            if (!t) return false;
            const from = state;
            state = typeof t === 'string' ? t : t.target;
            onChange(state, from, event, k);
            return true;
        },
    };
}

/* ---- reading the source ---------------------------------------------------
 * Each flow becomes one plain string for pretext plus a list of marks
 * {a, b, c: class, k: gloss name} that say how to dress its ranges.        */
function flowBuilder() {
    const f = { text: '', marks: [] };
    f.add = (t) => {
        t = t.replace(/\s+/g, ' ');
        if (!f.text || /[  ]$/.test(f.text)) t = t.replace(/^ /, '');
        f.text += t;
    };
    f.mark = (a, b, c, k) => { if (b > a) f.marks.push({ a, b, c, k }); };
    f.trim = () => { f.text = f.text.replace(/ +$/, ''); };
    return f;
}

function readSource(mainEl, asides, opts) {
    const keyOf = new Map();   // lemma name -> key letter(s)
    const letter = (i) => (i < KEYS.length ? KEYS[i] : KEYS[i % KEYS.length].repeat(1 + Math.floor(i / KEYS.length)));

    // The main text: run-in paragraphs parted by red pilcrows; a key after each lemma.
    const M = flowBuilder();
    const paras = [];
    const lemmas = [];
    const walkMain = (node) => {
        for (const n of node.childNodes) {
            if (n.nodeType === 3) M.add(n.nodeValue);
            else if (n.nodeType === 1 && !n.classList.contains('pg-ref')) {
                const name = n.dataset.lemma;
                if (name && /[ ]$/.test(M.text)) { /* keep */ }
                const a = M.text.length;
                walkMain(n);
                if (name && !keyOf.has(name)) {
                    let b = M.text.length;
                    while (b > a && M.text[b - 1] === ' ') b--;
                    const tail = M.text.slice(b);
                    M.text = M.text.slice(0, b);
                    const L = letter(keyOf.size);
                    keyOf.set(name, L);
                    lemmas.push({ name, a, b, key: L });
                    M.mark(a, b, 'pg-lemma', name);
                    M.mark(b, b + L.length, 'pg-key', name);
                    M.text += L + tail;
                }
            }
        }
    };
    [...mainEl.querySelectorAll('p')].forEach((p, i) => {
        M.trim();
        if (i > 0) {
            M.text += ' ';
            M.mark(M.text.length, M.text.length + 1, 'pg-pil');
            M.text += '¶ ';
        }
        const a = M.text.length;
        walkMain(p);
        M.trim();
        paras.push({ a, b: M.text.length, el: p });
    });

    // The initial: the first letter leaves the text (the picture is the
    // letter); the rest of the first word goes into small capitals.
    let initialLetter = '';
    if (opts.initial !== 'none' && M.text) {
        initialLetter = M.text[0];
        M.text = M.text.slice(1);
        for (const m of M.marks) { m.a = Math.max(0, m.a - 1); m.b = Math.max(0, m.b - 1); }
        for (const l of lemmas) { l.a = Math.max(0, l.a - 1); l.b = Math.max(0, l.b - 1); }
        for (const p of paras) { p.a = Math.max(0, p.a - 1); p.b = Math.max(0, p.b - 1); }
        const end = M.text.search(/[\s,.;:!?]|$/);
        if (end > 0) {
            M.text = M.text.slice(0, end).toUpperCase() + M.text.slice(end);
            M.mark(0, end, 'pg-sc');
        }
    }
    M.marks = M.marks.filter((m) => m.b > m.a);

    // The commentaries: run-in glosses, each opening with its red key and
    // its lemma underlined; the commentary's name in red at the head.
    const flows = asides.map((aside) => {
        const C = flowBuilder();
        const items = [];
        const label = aside.dataset.label ?? aside.getAttribute('aria-label') ?? '';
        if (label) {
            const t = label.toUpperCase().replace(/\.?$/, '.');
            C.mark(0, t.length, 'pg-lab');
            C.text += t + ' ';
        }
        for (const p of aside.querySelectorAll('p')) {
            const name = p.dataset.gloss || '';
            const L = keyOf.get(name);
            C.trim();
            if (C.text) C.text += ' ';
            const a = C.text.length;
            if (L) { C.mark(a, a + L.length, 'pg-key', name); C.text += L; }
            const walk = (node) => {
                for (const n of node.childNodes) {
                    if (n.nodeType === 3) {
                        // no space between the key and the lemma
                        const t = n.nodeValue;
                        if (C.text.length === a + (L ? L.length : 0)) C.add(t.replace(/^\s+/, ''));
                        else C.add(t);
                    } else if (n.nodeType === 1 && !n.classList.contains('pg-ref-k')) {
                        const s = C.text.length;
                        walk(n);
                        if (n.tagName === 'B' || n.tagName === 'STRONG' || n.classList.contains('pg-lem')) {
                            let e = C.text.length;
                            while (e > s && C.text[e - 1] === ' ') e--;
                            C.mark(s, e, 'pg-glem', name || undefined);
                        }
                    }
                }
            };
            walk(p);
            C.trim();
            if (name) C.mark(a, C.text.length, 'pg-g', name);
            items.push({ name, a, b: C.text.length, el: p, hand: p.hasAttribute('data-hand') });
        }
        C.trim();
        return { text: C.text, marks: C.marks, items, label, aside };
    });

    return { main: { text: M.text, marks: M.marks }, paras, lemmas, initialLetter, flows, keyOf };
}

/* ---- dressing a range of a flow as HTML ----------------------------------- */
function dress(flow, a, b, extra = '') {
    const cuts = new Set([a, b]);
    const ms = [];
    for (const m of flow.marks) {
        if (m.b <= a || m.a >= b) continue;
        ms.push(m);
        if (m.a > a) cuts.add(m.a);
        if (m.b < b) cuts.add(m.b);
    }
    const xs = [...cuts].sort((p, q) => p - q);
    let html = '';
    for (let i = 0; i < xs.length - 1; i++) {
        const x = xs[i], y = xs[i + 1];
        let t = flow.text.slice(x, y);
        if (!t) continue;
        t = esc(t.replace(/­/g, ''));
        let cls = '', k = '';
        for (const m of ms) if (m.a <= x && m.b >= y) { cls += ' ' + m.c; if (m.k) k = m.k; }
        if (!cls) { html += t; continue; }
        const tag = cls.includes('pg-key') ? 'sup' : 'span';
        html += `<${tag} class="${cls.trim()}${extra}"${k ? ` data-k="${esc(k)}"` : ''}>${t}</${tag}>`;
    }
    return html;
}

function loadImage(src) {
    return new Promise((ok, no) => {
        const im = new Image();
        im.decoding = 'async';
        im.onload = () => ok(im);
        im.onerror = no;
        im.src = src;
    });
}

// The pointing hand, drawn as an engraver would: a cuff, a fist, one finger.
// Points left; mirrored for the inner margin.
const HAND = `<svg class="pg-hand" viewBox="0 0 64 28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round" stroke-linejoin="round">
<path d="M5.4 9.1 L26.8 8.2 C30.2 6.1 34.6 5.2 39 5.6 L47.6 6.4"/>
<path d="M5.4 9.1 C2.6 9.2 2.4 13.2 5.3 13.3 L24.6 13.2"/>
<path d="M5.2 9.6 C6.6 9.9 7.2 10.9 7.1 12.6"/>
<path d="M24.6 13.2 C27.4 13.3 28.1 15.6 26.6 16.8 C27.1 17.8 28.6 18.1 30.6 18 L34.4 17.8"/>
<path d="M34.4 17.8 C36.6 18.1 36.9 20.4 35.3 21.3 C35.9 22.2 37.3 22.4 39.2 22.2 L41.8 22"/>
<path d="M41.8 22 C43.8 22.4 43.8 24.6 42.1 25.1 L47.6 24.6"/>
<path d="M28.4 13.4 C31.6 12.6 35.4 12.3 40.4 12.9 C42.4 13.2 44.4 12.3 45.4 10.6"/>
<path d="M30.8 18 C31.9 16.6 33.4 15.6 35.4 15.4 M39.2 22.2 C40 20.6 41.4 19.6 43.4 19.3"/>
<path d="M47.6 6.4 L47.6 24.6 M47.6 6.4 L56.6 5.2 L57.2 25.6 L47.6 24.6"/>
<path d="M50.6 6 L50.9 25 M53.6 5.6 L54 25.3"/>
<path d="M57 5.2 C59.4 7.6 58.2 9.8 60.2 11.4 C58.6 13.2 60.4 15.4 58.6 17.2 C60.4 19.2 58.8 21.4 60.4 23.4 C59.2 24.4 58.4 25 57.2 25.6"/>
</svg>`;

export function pretextGloss(root, opts = {}) {
    if (!root) return () => {};
    const mainEl = root.querySelector('.pg-main');
    const asides = [...root.querySelectorAll('.pg-gloss')].slice(0, 2);
    if (!mainEl || !asides.length) return () => {};

    const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
    const o = {
        initial: opts.initial ?? root.dataset.initial ?? '',
        initialLines: num(opts.initialLines ?? root.dataset.initialLines, 4),
        lead: num(opts.lead ?? root.dataset.lead, 3),
        tail: num(opts.tail ?? root.dataset.tail, 7),
        size: num(opts.size ?? root.dataset.size, 0),
        scale: num(opts.scale ?? root.dataset.scale, 1.6),
        stackBelow: num(opts.stackBelow ?? root.dataset.stackBelow, 640),
        hang: String(opts.hang ?? root.dataset.hang ?? 'true') !== 'false',
    };

    const me = ++uid;
    let dead = false;
    const off = [];
    const on = (t, ev, fn, op) => { t.addEventListener(ev, fn, op); off.push(() => t.removeEventListener(ev, fn, op)); };
    const added = [];   // nodes we put in the source, removed on destroy

    let api = null, src = null, img = null;
    let PM = null, PC = [];
    let fonts = null;
    let mode = '';      // 'folio' | 'stack'
    let block = null, stack = null, thread = null;
    let index = new Map();   // name -> { lemma: [], mkey: [], gloss: [], gkey: [] }
    let lit = null, focusK = null;
    let shown = false, bloomed = false;

    /* ---- keyboard links in the source --------------------------------- */
    function wireSource() {
        let n = 0;
        for (const span of mainEl.querySelectorAll('[data-lemma]')) {
            const name = span.dataset.lemma;
            const L = src.keyOf.get(name);
            const g = root.querySelector(`.pg-gloss [data-gloss="${CSS.escape(name)}"]`);
            if (!L || !g) continue;
            if (!g.id) { g.id = `pg-${me}-${n++}`; added.push(() => g.removeAttribute('id')); }
            const a = document.createElement('a');
            a.className = 'pg-ref';
            a.href = '#' + g.id;
            a.dataset.k = name;
            a.textContent = L;
            a.setAttribute('aria-label', `gloss ${L}`);
            span.after(a);
            added.push(() => a.remove());
            const k = document.createElement('span');
            k.className = 'pg-ref-k';
            k.textContent = L + ' ';
            g.prepend(k);
            added.push(() => k.remove());
            g.dataset.k = name;
            g.tabIndex = -1;
            added.push(() => { delete g.dataset.k; g.removeAttribute('tabindex'); });
        }
    }

    /* ---- fonts and measuring ------------------------------------------ */
    const measureCtx = document.createElement('canvas').getContext('2d');
    function fontOf(el) {
        const cs = getComputedStyle(el);
        return { style: cs.fontStyle, weight: cs.fontWeight, family: cs.fontFamily };
    }
    const spec = (f, s) => `${f.style} ${f.weight} ${s}px ${f.family}`;
    const widthCache = new Map();
    function charW(f, s, ch) {
        const key = spec(f, s) + '|' + ch;
        let w = widthCache.get(key);
        if (w === undefined) { measureCtx.font = spec(f, s); w = measureCtx.measureText(ch).width; widthCache.set(key, w); }
        return w;
    }
    function metrics(f, s) {
        measureCtx.font = spec(f, s);
        const m = measureCtx.measureText('Hxgp');
        const cap = measureCtx.measureText('H');
        return {
            asc: m.fontBoundingBoxAscent ?? s * 0.9,
            desc: m.fontBoundingBoxDescent ?? s * 0.25,
            cap: cap.actualBoundingBoxAscent ?? s * 0.66,
        };
    }

    // Char offset of a pretext cursor in the flow's string.
    function offsets(P, text) {
        const seg = P.segments || [];
        const off = new Int32Array(seg.length + 1);
        for (let i = 0; i < seg.length; i++) off[i + 1] = off[i] + seg[i].length;
        P._off = off;
        P._ok = off[seg.length] === text.length;
        return P;
    }
    const gseg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    function posOf(P, cur) {
        let p = P._off[cur.segmentIndex] ?? P._off[P._off.length - 1];
        if (cur.graphemeIndex > 0 && P.segments[cur.segmentIndex]) {
            const s = P.segments[cur.segmentIndex];
            if (gseg) { let i = 0; for (const g of gseg.segment(s)) { if (i++ >= cur.graphemeIndex) break; p += g.segment.length; } }
            else p += cur.graphemeIndex;
        }
        return p;
    }

    /* ---- the solve ---------------------------------------------------- */
    const START = { segmentIndex: 0, graphemeIndex: 0 };
    let geo = null;

    function solve(T) {
        const cs = o.size || clamp(Math.round((T / 74) * 4) / 4, 11, 14);
        const ms = Math.round(cs * o.scale * 4) / 4;
        const p = Math.round(cs * 1.36);       // the row: one commentary line
        const g = Math.round(cs * 1.55);       // gutter
        const minCol = cs * 8.5;
        const kc = REF / cs, km = REF / ms;
        const mm = metrics(fonts.main, ms), mc = metrics(fonts.gloss, cs);

        // The initial: initialLines lines tall, from the first cap-height to
        // the last baseline; the first lines of the main text are indented.
        // On a narrow measure the initial drops a line, so the lines beside
        // it keep enough words to justify.
        const iniFor = (m) => {
            let lines = Math.max(0, Math.round(o.initialLines));
            if (!src.initialLetter || !lines) return { lines: 0, H: 0, W: 0, gap: 0 };
            if (m / ms < 21) lines = Math.min(lines, 3);
            const H = (lines - 1) * 2 * p + mm.cap;
            const W = img ? H * img.naturalWidth / img.naturalHeight : charW(fonts.main, H / 0.66 * 0.98, src.initialLetter);
            return { lines, H, W, gap: ms * 0.38 };
        };

        const mainCache = new Map();
        const mainLines = (m) => {
            const key = Math.round(m * 4);
            if (mainCache.has(key)) return mainCache.get(key);
            const out = [];
            const ini = iniFor(m);
            let cur = START;
            for (let i = 0; i < 600; i++) {
                const ind = i < ini.lines && ini.W ? ini.W + ini.gap : 0;
                const r = api.layoutNextLineRange(PM, cur, Math.max(1, m - ind) * km);
                if (!r) break;
                out.push({ r, ind });
                cur = r.end;
            }
            mainCache.set(key, out);
            return out;
        };

        const lead = Math.max(0, Math.round(o.lead));
        // Columns at row r: [x, width] for inner (0) and outer (1).
        const cols = (side, r, m, s, t, end) => {
            if (r < lead) return side ? [s + g / 2, T - s - g / 2] : [0, s - g / 2];
            if (r < end) return side ? [s + m / 2 + g, T - s - m / 2 - g] : [0, s - m / 2 - g];
            return side ? [t + g / 2, T - t - g / 2] : [0, t - g / 2];
        };
        // Pour one commentary; returns rows used (and the lines when asked).
        const pour = (side, m, s, t, end, keep) => {
            const P = PC[side];
            if (!P) return { rows: 0, fill: 1, lines: [] };
            let cur = START, r = 0, last = null;
            const lines = keep ? [] : null;
            for (; r < 3000; r++) {
                const [x, w] = cols(side, r, m, s, t, end);
                const line = api.layoutNextLineRange(P, cur, Math.max(1, w) * kc);
                if (!line) break;
                if (keep) lines.push({ line, r, x, w });
                last = { line, w };
                cur = line.end;
            }
            return { rows: r, fill: last ? (last.line.width / kc) / last.w : 1, lines };
        };
        const two = (m, s, t, end) => [pour(0, m, s, t, end), PC[1] ? pour(1, m, s, t, end) : null];
        const diff = (m, s, t, end) => {
            const [a, b] = two(m, s, t, end);
            return b ? a.rows - b.rows : 0;
        };

        // For a block of width m: the split s where both commentaries end on
        // one row, then the tail split t to make it exact, then the best fill.
        const place = (m) => {
            const n = mainLines(m).length;
            const end = lead + 2 * n + 2;
            const sLo = m / 2 + g + minCol, sHi = T - m / 2 - g - minCol;
            if (sLo > sHi) return null;
            let s, best;
            if (!PC[1]) { s = sHi; best = 0; }
            else {
                let lo = sLo, hi = sHi;
                const dLo = diff(m, lo, lo, end), dHi = diff(m, hi, hi, end);
                if (dLo <= 0) { s = lo; best = dLo; }
                else if (dHi >= 0) { s = hi; best = dHi; }
                else {
                    s = (lo + hi) / 2; best = Infinity;
                    for (let i = 0; i < 16; i++) {
                        const mid = (lo + hi) / 2;
                        const d = diff(m, mid, mid, end);
                        if (Math.abs(d) < Math.abs(best)) { best = d; s = mid; }
                        if (d === 0) break;
                        if (d > 0) lo = mid; else hi = mid;
                    }
                }
            }
            let t = s;
            if (best !== 0 && PC[1]) {
                let lo = Math.max(minCol + g / 2, s - T * 0.14), hi = Math.min(T - minCol - g / 2, s + T * 0.14);
                for (let i = 0; i < 16; i++) {
                    const mid = (lo + hi) / 2;
                    const d = diff(m, s, mid, end);
                    if (Math.abs(d) < Math.abs(best)) { best = d; t = mid; }
                    if (d === 0) break;
                    if (d > 0) lo = mid; else hi = mid;
                }
            }
            return { m, s, t, end, n, flush: best === 0 };
        };
        const rowsOf = (pl) => Math.max(...two(pl.m, pl.s, pl.t, pl.end).filter(Boolean).map((x) => x.rows));

        // The measure: the narrowest block that leaves `tail` rows beneath it.
        const mLo = Math.min(Math.max(T * 0.32, ms * 17), T - 2 * (g + minCol));
        const mHi = Math.max(mLo, Math.min(T * 0.66, T - 2 * (g + minCol)));
        let pick = place(mHi);
        if (!pick) return null;
        if (rowsOf(pick) - pick.end >= o.tail) {
            let lo = mLo, hi = mHi;
            const pLo = place(mLo);
            if (pLo && rowsOf(pLo) - pLo.end >= o.tail) pick = pLo;
            else {
                for (let i = 0; i < 12; i++) {
                    const mid = (lo + hi) / 2;
                    const pl = place(mid);
                    if (pl && rowsOf(pl) - pl.end >= o.tail) { hi = mid; pick = pl; } else lo = mid;
                    if (hi - lo < 1) break;
                }
            }
        }

        // Among the splits that still tie, take the one whose last lines are fullest.
        if (pick.flush && PC[1]) {
            // (a small grid round the solution: the block's split, and the
            // tail's split on its own, which only moves the last rows)
            let bestScore = -1, bestS = pick.s, bestT = pick.t;
            const step = T * 0.004;
            for (let i = -4; i <= 4; i++) {
                const s = pick.s + i * step;
                if (s < pick.m / 2 + g + minCol || s > T - pick.m / 2 - g - minCol) continue;
                for (let j = -6; j <= 6; j++) {
                    const t = pick.t + (i + j) * step;
                    if (t < minCol + g / 2 || t > T - minCol - g / 2) continue;
                    const [a, b] = two(pick.m, s, t, pick.end);
                    if (a.rows !== b.rows) continue;
                    const score = Math.min(a.fill, b.fill) + 0.25 * Math.max(a.fill, b.fill) - (Math.abs(i) + Math.abs(j) * 0.5) * 0.006;
                    if (score > bestScore) { bestScore = score; bestS = s; bestT = t; }
                }
            }
            pick.s = bestS; pick.t = bestT;
        }

        const main = mainLines(pick.m);
        const comm = [pour(0, pick.m, pick.s, pick.t, pick.end, true), PC[1] ? pour(1, pick.m, pick.s, pick.t, pick.end, true) : null];
        const rows = Math.max(pick.end, ...comm.filter(Boolean).map((c) => c.rows));
        const ini = iniFor(pick.m);
        return { T, cs, ms, p, g, mm, mc, iniH: ini.H, iniW: ini.W, lead, main, comm, rows, ...pick };
    }

    /* ---- drawing the folio -------------------------------------------- */
    function lineHTML(flow, P, range, cls, left, top, w, h, last, f, size, extraStyle) {
        const a0 = posOf(P, range.start), b0 = posOf(P, range.end);
        let a = a0, b = b0;
        while (a < b && /[  ]/.test(flow.text[a])) a++;
        while (b > a && /[  ]/.test(flow.text[b - 1])) b--;
        const hy = range.end.graphemeIndex === 0 && P.kinds && P.kinds[range.end.segmentIndex - 1] === 'soft-hyphen';
        let html = dress(flow, a, b) + (hy ? '-' : '');
        let hl = 0, hr = 0;
        if (o.hang) {
            const lastCh = hy ? '-' : flow.text[b - 1];
            const firstCh = flow.text[a];
            if (!last && HANG_R[lastCh]) hr = charW(f, size, lastCh) * HANG_R[lastCh];
            if (HANG_L[firstCh]) hl = charW(f, size, firstCh === '¶' ? '¶ ' : firstCh) * HANG_L[firstCh];
        }
        return { a, b, html: `<div class="pg-ln ${cls}${last ? ' is-last' : ''}" style="left:${(left - hl).toFixed(2)}px;top:${top.toFixed(2)}px;width:${(w + hl + hr).toFixed(2)}px;height:${h}px;line-height:${h}px${extraStyle}">${html}</div>` };
    }

    function drawFolio(L) {
        const { p, cs, ms, mm, mc } = L;
        const firstTime = !block;
        if (!block) {
            block = document.createElement('div');
            block.className = 'pg-block';
            block.setAttribute('aria-hidden', 'true');
            const head = root.querySelector('.pg-head');
            (head ? head.after(block) : root.prepend(block));
        }
        const reveal = firstTime && !shown && !calm.matches;
        block.style.height = L.rows * p + 'px';
        block.style.fontSize = cs + 'px';
        let html = '';
        const stagger = (r) => (reveal ? `;animation-delay:${Math.round(r * 16)}ms` : '');

        // Main: each line two rows tall, baseline on the second row's baseline.
        const x0 = L.s - L.m / 2;
        const shift = p / 2 + (mc.asc - mc.desc) / 2 - (mm.asc - mm.desc) / 2;
        const mainFlow = src.main;
        L.main.forEach((ln, i) => {
            const r = L.lead + 1 + 2 * i;
            const top = r * p + shift;
            const out = lineHTML(mainFlow, PM, ln.r, 'pg-ln-m', x0 + ln.ind, top, L.m - ln.ind, 2 * p, i === L.main.length - 1, fonts.main, ms, `;font-size:${ms}px` + stagger(r));
            html += out.html;
        });

        // Commentaries.
        const hands = [];
        L.comm.forEach((c, side) => {
            if (!c) return;
            const flow = src.flows[side];
            const P = PC[side];
            const handItems = flow.items.filter((it) => it.hand);
            c.lines.forEach((ln, i) => {
                const out = lineHTML(flow, P, ln.line, 'pg-ln-c', ln.x, ln.r * p, ln.w, p, i === c.lines.length - 1, fonts.gloss, cs, stagger(ln.r));
                html += out.html;
                for (const it of handItems) if (it.a >= out.a && it.a < Math.max(out.b, out.a + 1)) hands.push({ side, r: ln.r, x: ln.x, w: ln.w, k: it.name });
            });
        });

        // The initial.
        if (src.initialLetter && L.iniW) {
            const firstBase = (L.lead + 1) * p + shift + p + (2 * p - (mm.asc + mm.desc)) / 2 + mm.asc - p;
            const top = firstBase - mm.cap;
            if (img) {
                html += `<img class="pg-ini" alt="" src="${esc(img.src)}" style="left:${x0.toFixed(2)}px;top:${top.toFixed(2)}px;width:${L.iniW.toFixed(2)}px;height:${L.iniH.toFixed(2)}px">`;
            } else {
                const fs = L.iniH / (mm.cap / ms);
                html += `<span class="pg-ini-letter" style="left:${x0.toFixed(2)}px;top:${(top - fs * ((mm.asc / ms) - (mm.cap / ms)) * 0.5).toFixed(2)}px;font-size:${fs.toFixed(2)}px">${esc(src.initialLetter)}</span>`;
            }
        }

        // The hand points at the first line of a gloss marked data-hand.
        for (const h of hands) {
            const hw = cs * 3.3, hh = hw * 28 / 64;
            const cy = h.r * p + p / 2 - hh / 2 + cs * 0.06;
            const gap = cs * 0.7;
            const left = h.side ? L.T + gap : -gap - hw;
            const flip = h.side ? '' : 'transform:scaleX(-1);';
            html += HAND.replace('<svg class="pg-hand"', `<svg class="pg-hand" data-hand="${esc(h.k || '')}" style="left:${left.toFixed(2)}px;top:${cy.toFixed(2)}px;width:${hw.toFixed(2)}px;height:${hh.toFixed(2)}px;${flip}"`);
        }

        html += `<svg class="pg-thread" width="${L.T}" height="${L.rows * p}" aria-hidden="true"><path class="pg-halo" pathLength="1" d=""/><path class="pg-line" pathLength="1" d=""/><circle class="pg-from" r="0"/><circle class="pg-to" r="0"/></svg>`;
        block.innerHTML = html;
        thread = block.querySelector('.pg-thread');
        buildIndex(block);
        if (reveal) {
            block.classList.add('is-veiled');
            if (visible) inkIn();
        } else if (firstTime) {
            shown = true;
        }
        if (bloomed || calm.matches) block.classList.add('is-bloomed');
        if (firstTime && !reveal && visible) bloom();
        paintLit(true);
    }

    function inkIn() {
        if (shown || !block) return;
        shown = true;
        block.classList.remove('is-veiled');
        block.classList.add('is-inking');
        const t = setTimeout(() => { block && block.classList.remove('is-inking'); }, 2600);
        off.push(() => clearTimeout(t));
        bloom(900);
    }
    function bloom(delay = 300) {
        if (bloomed) return;
        bloomed = true;
        const t = setTimeout(() => {
            if (block) block.classList.add('is-bloomed');
            if (stack) stack.classList.add('is-bloomed');
        }, calm.matches ? 0 : delay);
        off.push(() => clearTimeout(t));
    }

    function buildIndex(el) {
        index = new Map();
        for (const n of el.querySelectorAll('[data-k]')) {
            const k = n.dataset.k;
            if (!index.has(k)) index.set(k, { lemma: [], mkey: [], gloss: [], gkey: [], all: [] });
            const e = index.get(k);
            const inMain = n.closest('.pg-ln-m, .pg-s-p');
            if (n.classList.contains('pg-key')) (inMain ? e.mkey : e.gkey).push(n);
            else if (inMain) e.lemma.push(n);
            else e.gloss.push(n);
            if (n.classList.contains('pg-s-g')) e.card = n;
            e.all.push(n);
        }
    }

    /* ---- drawing the stack (phones) ----------------------------------- */
    function drawStack() {
        const firstTime = !stack;
        if (!stack) {
            stack = document.createElement('div');
            stack.className = 'pg-stack';
            const head = root.querySelector('.pg-head');
            (head ? head.after(stack) : root.prepend(stack));
        }
        const M = src.main;
        const byName = new Map();
        src.flows.forEach((f, side) => f.items.forEach((it) => byName.set(it.name, { it, f, side })));
        let html = '';
        src.paras.forEach((para, pi) => {
            let a = para.a;
            // leave the pilcrow to the folio; paragraphs are paragraphs here
            while (a < para.b && /[¶  ]/.test(M.text[a])) a++;
            let body = dress(M, a, para.b);
            // keys become links to their glosses
            body = body.replace(/<sup class="pg-key" data-k="([^"]*)">([^<]*)<\/sup>/g,
                (_, k, L) => `<a class="pg-key" data-k="${k}" href="#pg-s-${me}-${k}" aria-label="gloss ${L}">${L}</a>`);
            let ini = '';
            if (pi === 0 && src.initialLetter) {
                if (img) {
                    const fs = parseFloat(getComputedStyle(root).getPropertyValue('--pg-stack-size')) || 21;
                    const h = fs * 1.5 * 2 + fs * 0.66;
                    ini = `<img class="pg-s-ini" alt="" aria-hidden="true" src="${esc(img.src)}" style="height:${h}px;width:${(h * img.naturalWidth / img.naturalHeight).toFixed(1)}px">`;
                    ini += `<span class="pg-ref">${esc(src.initialLetter)}</span>`;
                } else ini = `<span class="pg-s-ini pg-ini-letter" style="position:static;font-size:4.1em;line-height:.8;float:left;margin:.08em .08em 0 0">${esc(src.initialLetter)}</span>`;
            }
            html += `<p class="pg-s-p">${ini}${body}</p>`;
            const names = src.lemmas.filter((l) => l.a >= para.a && l.a < para.b).map((l) => l.name).filter((n) => byName.has(n));
            if (names.length) {
                const keys = names.map((n) => src.keyOf.get(n)).join(' ');
                html += `<details class="pg-s-d" data-names="${esc(names.join(' '))}"><summary><span class="pg-s-sum"><span>Glosses</span><span class="pg-s-keys">${esc(keys)}</span><span class="pg-s-tog" aria-hidden="true"></span></span></summary><div class="pg-s-body">`;
                for (const n of names) {
                    const { it, f } = byName.get(n);
                    const inner = dress(f, it.a, it.b).replace(/ data-k="[^"]*"/g, '').replace(/class="pg-g\b ?/g, 'class="');
                    html += `<p class="pg-s-g" id="pg-s-${me}-${esc(n)}" data-k="${esc(n)}">${inner} <span class="pg-side">${esc(f.label)}</span></p>`;
                }
                html += `</div></details>`;
            }
        });
        stack.innerHTML = html;
        buildIndex(stack);
        if (firstTime && visible) bloom(600);
        else if (bloomed) stack.classList.add('is-bloomed');
        paintLit(true);
    }

    /* ---- lighting a pair ---------------------------------------------- */
    function paintLit(redraw) {
        const host = mode === 'folio' ? block : stack;
        if (!host) return;
        for (const n of host.querySelectorAll('.is-on')) n.classList.remove('is-on');
        for (const n of host.querySelectorAll('.is-focus')) n.classList.remove('is-focus');
        const e = lit && index.get(lit);
        host.classList.toggle('is-lit', !!e);
        if (thread) thread.classList.remove('is-drawn');
        if (!e) return;
        for (const n of e.all) n.classList.add('is-on');
        for (const n of host.querySelectorAll('.pg-hand')) n.classList.toggle('is-on', n.dataset.hand === lit);
        if (focusK && focusK === lit) for (const n of e.mkey) n.classList.add('is-focus');
        if (mode === 'folio' && thread && e.gkey[0] && e.mkey[0]) drawThread(e.gkey[0], e.mkey[0], redraw);
    }

    function drawThread(from, to, instant) {
        const br = block.getBoundingClientRect();
        const ra = from.getBoundingClientRect(), rb = to.getBoundingClientRect();
        const A = { x: ra.left + ra.width / 2 - br.left, y: ra.top + ra.height * 0.52 - br.top };
        const B = { x: rb.left + rb.width / 2 - br.left, y: rb.top + rb.height * 0.52 - br.top };
        const rA = Math.max(ra.width, ra.height) * 0.62 + 1.5, rB = Math.max(rb.width, rb.height) * 0.62 + 1.5;
        // Leave each key vertically, so the hairline slips between lines
        // instead of striking through the lemma: an S between rows apart, an
        // arch over the text when the two keys sit near one line.
        const dx = B.x - A.x, dy = B.y - A.y;
        let C1, C2;
        if (Math.abs(dy) < 40) {
            const k = clamp(Math.abs(dx) * 0.28, 22, 90);
            C1 = { x: A.x + dx * 0.15, y: A.y - k };
            C2 = { x: B.x - dx * 0.15, y: B.y - k };
        } else {
            const k = clamp(Math.abs(dy) * 0.55, 26, 160), sg = Math.sign(dy);
            C1 = { x: A.x, y: A.y + sg * k };
            C2 = { x: B.x, y: B.y - sg * k };
        }
        const toward = (P, Q, r) => { const ux = Q.x - P.x, uy = Q.y - P.y, l = Math.hypot(ux, uy) || 1; return { x: P.x + ux / l * r, y: P.y + uy / l * r }; };
        const S = toward(A, C1, rA), E = toward(B, C2, rB);
        const f = (P) => `${P.x.toFixed(1)} ${P.y.toFixed(1)}`;
        const d = `M${f(S)} C${f(C1)} ${f(C2)} ${f(E)}`;
        for (const path of thread.querySelectorAll('path')) path.setAttribute('d', d);
        const [ca, cb] = thread.querySelectorAll('circle');
        ca.setAttribute('cx', A.x.toFixed(1)); ca.setAttribute('cy', A.y.toFixed(1)); ca.setAttribute('r', rA.toFixed(1));
        cb.setAttribute('cx', B.x.toFixed(1)); cb.setAttribute('cy', B.y.toFixed(1)); cb.setAttribute('r', rB.toFixed(1));
        if (instant || calm.matches) {
            thread.style.transition = 'none';
            for (const n of thread.children) n.style.transition = 'none';
            thread.classList.add('is-drawn');
            void thread.getBoundingClientRect();
            thread.style.transition = '';
            for (const n of thread.children) n.style.transition = '';
        } else {
            void thread.getBoundingClientRect();
            thread.classList.add('is-drawn');
        }
    }

    let pinK = null, hoverK = null;
    const chart = interpret(CHART, { onPin: (k) => k === pinK }, (state, from, event, k) => {
        if (event === 'TAP' && state === 'pinned') pinK = k;
        if (state === 'idle') { pinK = null; hoverK = null; }
        if (event === 'POINT') hoverK = k;
        if (event === 'LEAVE') hoverK = null;
        if (event === 'FOCUS') focusK = k;
        if (event === 'BLUR' || event === 'ESC') focusK = null;
        if (state !== 'focused') focusK = event === 'FOCUS' ? k : null;
        const next = state === 'previewing' || state === 'peeking' ? hoverK
            : state === 'pinned' ? pinK
            : state === 'focused' ? focusK : null;
        root.dataset.pgState = state;
        if (next !== lit || event === 'FOCUS') {
            lit = next;
            paintLit(false);
            if (lit && mode === 'stack' && (event === 'TAP' || event === 'FOCUS')) reveal(lit, event);
        }
    });

    // On a phone, tapping a lemma opens its fold and brings the gloss into view.
    function reveal(k, event) {
        const e = index.get(k);
        if (!e || !e.card) return;
        const d = e.card.closest('details');
        const fromMain = lastTapInMain;
        const opening = d && !d.open;
        if (opening) d.open = true;
        if (!fromMain && event === 'TAP') return;
        // wait for the fold to finish sliding open before judging where it is
        const t = setTimeout(() => {
            const r = e.card.getBoundingClientRect();
            if (r.bottom > innerHeight - 16 || r.top < 0) {
                e.card.scrollIntoView({ block: 'nearest', behavior: calm.matches ? 'auto' : 'smooth' });
            }
        }, opening && !calm.matches ? 560 : 30);
        off.push(() => clearTimeout(t));
    }

    /* ---- input ---------------------------------------------------------- */
    let leaveTimer = 0, lastTapInMain = false;
    const keyAt = (t) => {
        const n = t && t.closest && t.closest('[data-k]');
        if (!n || !root.contains(n)) return null;
        if (n.closest('.pg-main, .pg-gloss')) return null;   // the hidden source
        return n.dataset.k;
    };
    on(root, 'pointerover', (e) => {
        if (e.pointerType !== 'mouse') return;
        const k = keyAt(e.target);
        if (!k) return;
        clearTimeout(leaveTimer);
        if (k !== hoverK || chart.state === 'pinned') chart.send('POINT', k);
    });
    on(root, 'pointerout', (e) => {
        if (e.pointerType !== 'mouse') return;
        if (!keyAt(e.target)) return;
        const to = keyAt(e.relatedTarget);
        if (to) return;
        clearTimeout(leaveTimer);
        leaveTimer = setTimeout(() => chart.send('LEAVE'), 110);
    });
    on(root, 'click', (e) => {
        const k = keyAt(e.target);
        if (k) {
            lastTapInMain = !!e.target.closest('.pg-s-p, .pg-ln-m');
            if (e.target.closest('a.pg-key')) e.preventDefault();
            chart.send('TAP', k);
        } else if (!e.target.closest('summary, .pg-ref, a')) chart.send('DISMISS');
    });
    on(document, 'pointerdown', (e) => { if (!root.contains(e.target)) chart.send('DISMISS'); });
    on(document, 'keydown', (e) => { if (e.key === 'Escape') { chart.send('ESC'); } });
    on(root, 'focusin', (e) => {
        const n = e.target.closest && e.target.closest('[data-k]');
        if (n && (n.classList.contains('pg-ref') || n.closest('.pg-gloss') || n.matches('a.pg-key'))) chart.send('FOCUS', n.dataset.k);
    });
    on(root, 'focusout', (e) => {
        const n = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-k]');
        if (n && root.contains(n)) return;
        chart.send('BLUR');
    });

    /* ---- layout on size --------------------------------------------- */
    let visible = false, lastW = -1, raf = 0;
    function contentWidth() {
        const cs = getComputedStyle(root);
        return root.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    }
    function relayout(force) {
        raf = 0;
        if (dead || !api) return;
        const want = contentWidth() < o.stackBelow ? 'stack' : 'folio';
        if (want !== mode) {
            // switching measures: padding changes with the mode, so look again
            root.classList.toggle('is-folio', want === 'folio');
            root.classList.toggle('is-stack', want === 'stack');
            mode = want;
            if (want === 'stack' && block) { block.remove(); block = null; thread = null; }
            if (want === 'folio' && stack) { stack.remove(); stack = null; }
            force = true;
        }
        const T = Math.floor(contentWidth());
        if (!force && T === lastW) return;
        lastW = T;
        if (mode === 'stack') { drawStack(); return; }
        const t0 = performance.now();
        const L = solve(T);
        if (!L) { root.classList.remove('is-folio'); root.classList.add('is-stack'); mode = 'stack'; if (block) { block.remove(); block = null; } drawStack(); return; }
        drawFolio(L);
        root.dataset.pgSolve = `${(performance.now() - t0).toFixed(1)}ms ${L.flush ? 'flush' : 'unflush'} rows=${L.rows} m=${Math.round(L.m)} s=${Math.round(L.s)} t=${Math.round(L.t)}`;
    }

    /* ---- start -------------------------------------------------------- */
    (async () => {
        try {
            api = await import(LIB);
            src = readSource(mainEl, asides, o);
            if (o.initial && o.initial !== 'none') {
                try { img = await loadImage(new URL(o.initial, document.baseURI).href); } catch (e) { img = null; }
            }
            fonts = { main: fontOf(mainEl), gloss: fontOf(asides[0]) };
            try {
                await Promise.all([
                    document.fonts.load(`${fonts.main.style} ${fonts.main.weight} 24px ${fonts.main.family}`),
                    document.fonts.load(`${fonts.gloss.style} ${fonts.gloss.weight} 14px ${fonts.gloss.family}`),
                    document.fonts.load(`${fonts.gloss.style} 600 14px ${fonts.gloss.family}`),
                ]);
                await document.fonts.ready;
            } catch (e) { /* measure what we have */ }
            if (dead) return;
            PM = offsets(api.prepareWithSegments(src.main.text, spec(fonts.main, REF)), src.main.text);
            PC = src.flows.map((f) => offsets(api.prepareWithSegments(f.text, spec(fonts.gloss, REF)), f.text));
            if (![PM, ...PC].every((P) => P._ok)) console.warn('pretext-gloss: segment offsets do not match the text');
            wireSource();
        } catch (e) {
            console.warn('pretext-gloss: left as plain text', e);
            return;
        }
        const io = new IntersectionObserver((en) => {
            visible = en[0].isIntersecting;
            if (visible && block && !shown) inkIn();
            if (visible && !bloomed && (mode === 'stack' || shown)) bloom(mode === 'stack' ? 500 : 300);
        }, { threshold: 0.12 });
        io.observe(root);
        off.push(() => io.disconnect());
        relayout(true);
        const ro = new ResizeObserver(() => { if (!raf && !dead) raf = requestAnimationFrame(() => relayout(false)); });
        ro.observe(root);
        off.push(() => { ro.disconnect(); cancelAnimationFrame(raf); });
        on(calm, 'change', () => relayout(true));
    })();

    return function destroy() {
        dead = true;
        clearTimeout(leaveTimer);
        off.forEach((f) => f());
        added.forEach((f) => f());
        if (block) block.remove();
        if (stack) stack.remove();
        block = stack = thread = null;
        root.classList.remove('is-folio', 'is-stack');
        delete root.dataset.pgState;
        delete root.dataset.pgSolve;
    };
}

// Auto-start every [data-pretext-gloss] once it is near the viewport.
function autoStart(el) {
    if (!('IntersectionObserver' in window)) return pretextGloss(el);
    const io = new IntersectionObserver((en) => {
        if (!en[0].isIntersecting) return;
        io.disconnect();
        pretextGloss(el);
    }, { rootMargin: '600px' });
    io.observe(el);
}
document.querySelectorAll('[data-pretext-gloss]').forEach(autoStart);
