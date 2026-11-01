/* The opening: a wall of paintings drifting in columns, the name across it. */
const $ = (s, r = document) => r.querySelector(s);
const root = $('#hero');
const big = (f) => `ornaments/wc/${f}.webp`;
const P = {
  darkRigi: 'the-dark-rigi-the-lake-of-lucerne-showing-the-ri', redRigi: 'j-m-w-turner-the-red-rigi-google-art-project',
  salute: 'barcelona-santa-maria-della-salute-and-the-dogan', tell: 'joseph-mallord-william-turner-tell-s-chapel-lake',
  lucerne: 'joseph-mallord-william-turner-lucerne-from-the-l', storm: 'storm-bahamas-by-winslow-homer-1885',
  tornado: 'winslow-homer-tornado-bahamas-1885', boat: 'winslow-homer-the-blue-boat-google-art-project',
  dory: 'winslow-homer-boy-with-blue-dory-1880', hunter: 'winslow-homer-hunter-in-the-adirondacks-1892',
  shot: 'winslow-homer-a-good-shot-adirondacks', fishing: 'winslow-homer-fishing-in-the-adirondacks-1889',
  rio: 'john-singer-sargent-rio-dei-mendicanti-venice-go', frari: 'john-singer-sargent-campo-dei-frari-venice-c-188',
  chalets: 'sargent-simplon-pass-chalets-about-1909-11-12-21', terrace: 'sargent-corfu-the-terrace-1909-12-208',
  cypress: 'sargent-corfu-cypresses-1909-12-206', lights: 'sargent-corfu-lights-and-shadows-1909-12-207',
  kairuan: 'paul-klee-kairuan-1916', germain: 'st-germain-b-tunis-landeinw-rts-paul-klee-1914',
  hammamet: 'hammamet-with-its-mosque-1914-paul-klee-met-dp-8', cezanne: 'cezanne-mont-sainte-victoire-von-lauves-aus-gese',
  signac: 'paul-signac-rodez', zardrieux: 'paul-signac-l-zardrieux-watercolor-over-cont-cra',
  larsson: 'carl-larsson-lath-rnet', frukost: 'frukost-under-stora-bj-rken-av-carl-larsson-1896', jul: 'julaftonen-av-carl-larsson-1904',
  girtin: 'thomas-girtin-chalfont-house-buckinghamshire-goo', bolton: 'thomas-girtin-near-bolton-abbey', cotman: 'john-sell-cotman-004',
  demuth: 'charles-demuth-fruit-and-flower', merian: 'maria-sibylla-merian-plant-study-with-peppers',
  durer: 'albrecht-d-rer-the-large-piece-of-turf-1503-goog', plantain: 'plantain-with-metamorphosis-of-the-brigh-line-br',
};
const TAG = 'Connor Hood. I make tools, and the data that teaches machines.';
const NAME = 'Social <em>Acolyte</em>';
const shuffle = (a) => [...a].sort(() => Math.random() - .5);

/* ── 3. Columns: a wall of paintings drifting up and down, the name across it ── */
function columns(el) {
  const pool = shuffle(Object.values(P));
  const n = innerWidth < 760 ? 3 : innerWidth < 1200 ? 4 : 6;
  let html = '';
  for (let c = 0; c < n; c++) {
    const mine = Array.from({ length: 7 }, (_, k) => pool[(c * 5 + k * 2) % pool.length]);
    const tiles = mine.concat(mine).map((f, k) => `<figure><img src="${big(f)}" alt="" aria-hidden="true" loading="${k < 3 ? 'eager' : 'lazy'}" decoding="async"></figure>`).join('');
    html += `<div class="c-col ${c % 2 ? 'dn' : 'up'}" style="--d:${96 + c * 17}s;--o:${-(c * 11)}%"><div class="c-run">${tiles}</div></div>`;
  }
  el.innerHTML = `<div class="c-wall">${html}</div><div class="c-band"><h1>${NAME}</h1><p>${TAG}</p></div>`;
}

columns(root);
root.className = 'hero v-columns';
