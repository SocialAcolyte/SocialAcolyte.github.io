import { WC } from './wc.js';

const $ = (s, r = document) => r.querySelector(s);
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const src = (w) => `ornaments/wc/${w.f}.webp`;
const credit = (w) => `${w.a}, <em>${w.t}</em>, ${w.y}`;

/* bar: a paper ground behind it once the hero has gone */
const bar = $('.bar');
const onScroll = () => bar.classList.toggle('is-down', scrollY > innerHeight * 0.6);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ─── 2. The main things settle in as they arrive ─────────────────────────── */
const io = new IntersectionObserver((es) => es.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}), { threshold: .25 });
document.querySelectorAll('.thing').forEach((el) => calm ? el.classList.add('is-in') : io.observe(el));

/* ─── 3. Projects: a watercolour for each row ──────────────────────────── */
const plate = $('#plate'), cap = $('#plate-cap');
const rowWC = WC.filter((w) => w.plate);
const rows = [...document.querySelectorAll('#list [data-wc]')];
const plates = rows.map((r, i) => {
  const w = rowWC[i % rowWC.length];
  const im = new Image(); im.alt = ''; im.decoding = 'async'; im.loading = i ? 'lazy' : 'eager';
  im.src = src(w); im.style.objectPosition = w.pos || '50% 50%';
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
