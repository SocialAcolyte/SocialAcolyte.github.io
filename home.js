import { WC } from './wc.js';

const $ = (s, r = document) => r.querySelector(s);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const src = (w) => `ornaments/wc/${w.f}.webp`;
const credit = (w) => `${w.a}, <em>${w.t}</em>, ${w.y}`;

/* bar: a paper wash behind it once the hero has gone */
const bar = $('.bar');
const onScroll = () => bar.classList.toggle('is-down', scrollY > innerHeight * 0.6);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ─── 1. Hero: one StyleFeatures piece, a different one each visit ─────────────
   In turn: Hokusai's peonies printing themselves block by block, a reading glass
   over the unicorn tapestry, a lamp raking across the Nimrud relief, and a dish
   that breaks and is mended with gold. Each sits on a pale wash. */
const hero = $('.hero'), stage = $('#stage');
const PIECES = [
  { name: 'peony-print', fit: 2100 / 2882, credit: 'Katsushika Hokusai, <em>Peonies and Canary</em>, c. 1834',
    html: '<section data-peony-print data-src="c/peony-print/assets/peony.json" data-play="9"><div class="pp-stage"><img class="pp-img" src="c/peony-print/assets/peony.webp" alt="" aria-hidden="true" width="2100" height="2882"></div></section>' },
  { name: 'loupe', fit: 3755 / 3658, credit: '<em>The Unicorn Is Found</em>, South Netherlandish tapestry, c. 1495–1505. Move the glass.',
    html: '<figure data-loupe data-zoom="2.4" data-rest="0.585,0.66"><img src="c/loupe/assets/unicorn-fountain.webp" width="3755" height="3658" alt="A woven hunting scene: hunters and hounds gather around a fountain where a white unicorn kneels among flowering trees."></figure>' },
  { name: 'raking-light', fit: 0, credit: 'Ashurnasirpal II with attendants and a winged genie, Nimrud, c. 883–859 BCE. Move the lamp.',
    html: '<figure data-raking-light data-kind="surface" data-height="32.33" data-material="stone" data-light="-55 11" data-ambient=".5" data-falloff="4.4" data-normal="c/raking-light/assets/nimrud-relief-normal.png" data-albedo="c/raking-light/assets/nimrud-relief-albedo.webp"><img src="c/raking-light/assets/nimrud-relief.webp" width="2400" height="977" alt="" aria-hidden="true"></figure>' },
  { name: 'kintsugi', fit: () => (stage.clientWidth < 600 ? 1 : 16 / 10), credit: '<em>Dish with Hydrangeas</em>, Japan, c. 1690–1730. Break it; mend it with gold.',
    html: '<figure data-kintsugi data-label="Break the dish" data-mend-label="Mend it with gold"><img src="c/kintsugi/assets/hydrangea-dish.webp" alt="" width="1600" height="1592"></figure>' },
];
// in turn, visit to visit (storage can be missing or blocked: then a random one)
let turn = Math.random() * PIECES.length | 0;
try { const k = 'sa-hero', n = (+localStorage.getItem(k) + 1) % PIECES.length; if (!Number.isNaN(n)) turn = n; localStorage.setItem(k, turn); } catch (e) { /* random it is */ }
const PIECE = PIECES[+(new URLSearchParams(location.search).get('hero') ?? NaN)] || PIECES[turn];
stage.dataset.piece = PIECE.name;
stage.insertAdjacentHTML('beforeend', PIECE.html);
$('#hero-credit').innerHTML = PIECE.credit;
const held = stage.lastElementChild;
// the piece is fitted whole inside the stage at its own shape (raking light fills it, cropped)
function fit() {
  const a = typeof PIECE.fit === 'function' ? PIECE.fit() : PIECE.fit;
  if (!a) return;
  const W = stage.clientWidth, H = stage.clientHeight;
  const w = Math.min(W, H * a);
  held.style.width = Math.round(w) + 'px';
  held.style.height = Math.round(w / a) + 'px';
}
fit();
new ResizeObserver(fit).observe(stage);
import(`./c/${PIECE.name}/${PIECE.name}.js`).then(() => hero.classList.add('is-live')).catch((e) => console.warn(e));

/* ─── 2. The main things wash in as they arrive ─────────────────────────── */
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}), { threshold: .25 });
document.querySelectorAll('.thing').forEach((el) => calm ? el.classList.add('is-in') : io.observe(el));

/* ─── 3. Projects: a watercolour for each row ──────────────────────────── */
const plate = $('#plate'), cap = $('#plate-cap');
const rowWC = WC.filter((w) => w.plate);
const rows = [...document.querySelectorAll('#list [data-wc]')];
const WASH = ['blue', 'sienna', 'green', 'rose', 'slate', 'ochre', 'violet'];
const plates = rows.map((r, i) => {
  const w = rowWC[i % rowWC.length];
  r.style.setProperty('--wash', `url(img/wash/${WASH[i % WASH.length]}.webp)`);
  const im = new Image(); im.alt = ''; im.decoding = 'async'; im.loading = i ? 'lazy' : 'eager';
  im.src = src(w); im.style.objectPosition = w.pos || '50% 50%';
  im.style.setProperty('-webkit-mask', `url(img/edge/e${i % 6}.png) 0 0/100% 100%`);
  im.style.setProperty('mask', `url(img/edge/e${i % 6}.png) 0 0/100% 100%`);
  plate.append(im);
  return { im, w };
});
let cur = -1;
const show = (i) => {
  if (i === cur) return; cur = i;
  plates.forEach((p, k) => p.im.classList.toggle('on', k === i));
  rows.forEach((r, k) => r.classList.toggle('on', k === i));
  cap.innerHTML = credit(plates[i].w);
};
rows.forEach((r, i) => { r.addEventListener('pointerenter', () => show(i)); r.addEventListener('focus', () => show(i)); });
show(0);
// on a phone (no hover) the row nearest the middle of the screen leads
if (!matchMedia('(hover: hover)').matches) {
  addEventListener('scroll', () => {
    const mid = innerHeight * .55;
    let best = 0, bd = 1e9;
    rows.forEach((r, i) => { const b = r.getBoundingClientRect(); const d = Math.abs(b.top + b.height / 2 - mid); if (d < bd) { bd = d; best = i; } });
    show(best);
  }, { passive: true });
}

/* ─── 5. The drift: two rows of watercolours, each sheet with its own edge ─ */
const fill = (el, list) => {
  const html = list.map((w, i) => `<figure style="--e:url(img/edge/e${i % 6}.png)"><img src="ornaments/wc/sm/${w.f}.jpg" alt="${w.a}, ${w.t}" loading="lazy" decoding="async" width="${w.w || 400}" height="${w.h || 300}"></figure>`).join('');
  el.innerHTML = html + html.replace(/alt="[^"]*"/g, 'alt="" aria-hidden="true"');
};
const all = [...WC].sort(() => Math.random() - .5);
fill($('#row-a'), all.filter((_, i) => i % 2 === 0));
fill($('#row-b'), all.filter((_, i) => i % 2 === 1));
