/*
 *  DROP-CAP-GILT // an illuminated-manuscript drop cap for article openings.
 *  The first letter stands ~4 lines tall in ink-grey serif; when the
 *  paragraph scrolls into view, a gold gradient sweeps across it once and a
 *  hand-drawn vine underline draws itself beneath the first line.
 *
 *  Markup:   <p data-drop-cap>Once upon a time&hellip;</p>
 *
 *  Options (data attributes, all optional):
 *    data-threshold="0.35"   fraction of the paragraph visible to trigger
 *
 *  Or call  init(element, { threshold })  yourself (also exported as
 *  dropCapGilt for convention). Returns a destroy() that removes listeners,
 *  observers, and everything added to the DOM, restoring the original text.
 *
 *  Progressive enhancement: without JS the paragraph is plain text. Reduced
 *  motion: the gilded end state is shown immediately, nothing animates.
 *  No dependencies.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

// A gently wandering stem with a curled tendril at the end, drawn in a
// 200x16 box and stretched to the first line's width (non-scaling stroke
// keeps the line weight even). pathLength="1" lets CSS draw it with a
// dashoffset transition, no measuring needed.
const STEM_D = 'M3 10 C 30 5, 52 13, 82 9 S 132 5, 158 9 S 182 12, 190 8 ' +
    'c 3 -2, 2 -6, -1 -6 c -2 1, -2 3, 0 4';
// Two small leaves placed along the stem; they fade in near the draw's end.
const LEAF_1_D = 'M64 8.5 c 3 -6, 11 -8, 16 -7 c -2, 5 -10, 8 -16, 7 Z';
const LEAF_2_D = 'M128 7.5 c 4 5, 12 6, 17 4 c -3 -5 -11 -6 -17 -4 Z';

function firstTextNode(host) {
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            return /\S/.test(node.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
    });
    return walker.nextNode();
}

function buildVine() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'dcg-vine');
    svg.setAttribute('viewBox', '0 0 200 16');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const stem = document.createElementNS(SVG_NS, 'path');
    stem.setAttribute('class', 'dcg-stem');
    stem.setAttribute('d', STEM_D);
    stem.setAttribute('pathLength', '1');
    stem.setAttribute('vector-effect', 'non-scaling-stroke');

    const leaf1 = document.createElementNS(SVG_NS, 'path');
    leaf1.setAttribute('class', 'dcg-leaf');
    leaf1.setAttribute('d', LEAF_1_D);

    const leaf2 = document.createElementNS(SVG_NS, 'path');
    leaf2.setAttribute('class', 'dcg-leaf');
    leaf2.setAttribute('d', LEAF_2_D);

    svg.append(stem, leaf1, leaf2);
    return svg;
}

export function init(host, opts = {}) {
    if (!host || host.dataset.dcgDone === '1') return () => {};
    const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const threshold = Number(opts.threshold ?? host.dataset.threshold ?? 0.35);

    // Wrap the opening letter (plus any opening quote) in the floated cap.
    const textNode = firstTextNode(host);
    if (!textNode) return () => {};
    const match = textNode.data.match(/^(\s*)(["'“‘]?)([^\s])/);
    if (!match) return () => {};
    const [, spaces, quote, letter] = match;
    const capText = quote + letter;
    const cutAt = spaces.length + capText.length;
    textNode.splitText(cutAt); // remainder stays in place after the cap
    textNode.data = spaces;
    const cap = document.createElement('span');
    cap.className = 'dcg-cap';
    cap.textContent = capText;
    textNode.after(cap);

    host.dataset.dcgDone = '1';

    const vine = buildVine();
    host.appendChild(vine);

    // Place the vine: just past the cap, just under the first line's
    // baseline. Absolute positioning means it never affects layout.
    function place() {
        const capWidth = cap.getBoundingClientRect().width;
        const hostRect = host.getBoundingClientRect();
        const capRect = cap.getBoundingClientRect();
        const lineHeight = parseFloat(getComputedStyle(host).lineHeight) ||
            parseFloat(getComputedStyle(host).fontSize) * 1.5;
        vine.style.left = `${Math.max(0, capRect.left - hostRect.left + capWidth + 6)}px`;
        vine.style.top = `${lineHeight - 7}px`;
    }

    let ro = null;
    if ('ResizeObserver' in window) {
        ro = new ResizeObserver(place);
        ro.observe(host);
    }
    addEventListener('resize', place);
    place();
    if (document.fonts?.ready) {
        document.fonts.ready.then(place).catch(() => {});
    }

    let io = null;
    function destroy() {
        io?.disconnect();
        ro?.disconnect();
        removeEventListener('resize', place);
        vine.remove();
        cap.replaceWith(document.createTextNode(capText));
        host.normalize();
        host.classList.remove('is-gilt');
        delete host.dataset.dcgDone;
    }

    if (REDUCED) {
        host.classList.add('is-gilt');
        return destroy;
    }

    io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                host.classList.add('is-gilt');
                io.disconnect(); // gilt once; the class stays put
            }
        }
    }, { threshold });
    io.observe(host);

    return destroy;
}

// Convention alias: the factory's camelCase name for this component.
export const dropCapGilt = init;

document.querySelectorAll('[data-drop-cap]').forEach((el) => init(el));
