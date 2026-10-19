# pretext-burn

A handwritten letter burning slowly from one corner as you scroll, the way
paper burns: the sheet browns ahead of the fire, a thin broken line of
embers creeps across it, behind that the paper goes to glossy black char
that cracks into plates, then to grey ash, and the ash lifts away a flake at
a time and leaves holes onto the page. The words glow for a moment as the
embers cross them, and the ink is still faintly there in the ash, rust on
grey. Scroll back and the letter unburns through exactly the same states.
Near the end the fire goes out and leaves a scorched fragment with the
greeting on it.

```html
<link rel="stylesheet" href="pretext-burn.css">
<section data-pretext-burn>
  <div class="pb-stage">
    <article class="pb-letter">
      <p class="pb-date">Hollins Farm, 3rd October</p>
      <p class="pb-greet">Dear Nell,</p>
      <p>The pears are in …</p>
      <p>When you came to help …</p>
      <p class="pb-close">With my love, which is old and quiet,</p>
      <p class="pb-sign">Alice</p>
    </article>
  </div>
</section>
<script type="module" src="pretext-burn.js"></script>
```

Or `import { pretextBurn } from './pretext-burn.js'` and call
`pretextBurn(section, options)`; it returns `destroy()`.

The letter's paragraphs are read in order. Classes set their place on the
sheet: `pb-date` (right-aligned), `pb-greet` (left, no indent), plain `<p>`
(body, first line indented), `pb-close` (from a third of the way in),
`pb-sign` (from just past half). 150-220 words fit well. The face is the
`.pb-letter`'s own `font-family` (the demo loads Homemade Apple from Google
Fonts: it reads as a real pen, and stays legible at 10px on a phone).

## Options

Data attributes on the section, or the options object (which wins).

| attribute | option | default | what it does |
|---|---|---|---|
| `data-seed` | `seed` | `11` | The paper: its thick and thin spots, fibre direction, blots of size, the plates and flakes, the hand's wobble. `random` gives a new sheet each visit. |
| `data-ignite` | `ignite` | `right` | The corner the fire starts from: `right` (bottom right) or `left` (bottom left). |
| `data-keep` | `keep` | `0.22` | The fraction of the sheet that never burns: the fire goes out with this much left, in the far corner. `0` burns nearly everything. |
| `data-rest` | `rest` | `0.36` | With reduced motion, how far the fire has got (fraction of the whole burn) in the still frame. |
| `data-aspect` | `aspect` | `1.38` | Sheet height / width (a phone may make it taller, up to 1.5). |
| `data-leading` | `leading` | `1.9` | Line pitch, x the font size. |
| `data-font`, `data-weight` | `font`, `weight` | the letter's | Canvas-only face, if it should differ from the fallback's. |

## How it works

1. **Writing.** pretext (Cheng Lou) prepares each paragraph once at 100px;
   its widths are linear in size, so a binary search re-sets the letter at
   eighteen trial sizes and keeps the largest that fills the sheet. Lines go
   out ragged, as handwriting does, with `layoutNextLine`. Each line is
   written onto a 2D canvas at device resolution with a hand's small
   irregularities: a baseline that drifts, a slight slope, words a hair off
   the line, and ink that is dark after each dip of the pen and runs drier
   over the next five to eleven words. That canvas is the ink texture.
2. **The burn-time field.** In a Worker (built from a Blob; on the main
   thread if a worker can't be made), a 16-neighbour Dijkstra over a grid of
   about 330 cells across the sheet, from the ignition corner. The local
   speed of burning is a product of: slow large-scale variation (thick and
   thin spots in the sheet), medium noise, streaks along a fibre direction
   (noise stretched 11:1), a few slow blots of size that the front has to
   go round, more air along the cut edges, a touch faster through ink. Steps
   along the fibres cost less (up to a quarter), and steps upward a little
   less (heat climbs). Each cell stores the time the fire reaches it. The
   fire goes out with the far fragment left (`data-keep`); any other pocket
   of paper the front has closed round is made faster and the field re-run
   until none is left inside the char. A second channel stores the front's
   local speed (one over the gradient), so the shader can measure distance
   to the front in pixels, and a third a blurred copy of the field, for the
   scorch.
3. **One shader thresholds it by t.** Per pixel, the distance ahead of the
   front in css px (plus fibre-scale noise, so the burnt edge is ragged):
   - ahead: the **scorch**, a heat gradient taken from the blurred field so
     it follows the front's broad shape rather than every finger:
     paper → straw → tan → brown, darkest in a narrow band against the
     char, mottled at fibre scale; ink in it darkens;
   - at the front: the **ember line**, a gaussian a couple of pixels wide,
     broken into beads by noise that slowly boils (two noise fields
     cross-faded, drifting in different directions), with dark gaps, a few
     hot yellow points inside the beads, a dull red tail in the char behind,
     and a faint orange light on the paper close by. The writing has a wider
     glow band than the paper, so words light up red as the line reaches
     them and stay lit a moment longer;
   - behind: **char**, near-black and satin: the sheet buckles as it chars
     into gentle ridges a few mm across (warped noise, loosely along the
     fibres), and broad soft highlights ride them. A few long splits follow
     the fibres in places. The leading edge rolls up off the sheet: a ridge
     just behind the embers whose lip catches the light, with a soft shadow
     on the paper ahead of it. Ink on char is a shade glossier;
   - **ash**, a narrow band about a third of the char's width: thin, pale
     silver-grey, finely wrinkled, the ink a rust ghost on it;
   - then it breaks into small flakes (a jittered Voronoi net, about 85 to
     the sheet's width), each lifting at its own moment (its centre's burn
     time + a jitter), cupping and showing hairline breaks just before it
     goes. The hole shows the page with a soft shadow from the sheet's
     lifted edges and a little fallen ash; its edge is antialiased against
     the neighbour that has lifted.
4. **Particles.** Each flake that lifts may (45%) leave as a particle:
   the very cell whose hole has just opened, rising on the convection,
   fluttering, turning over (one face paler than the other), shrinking and
   fading over 2.5-5 s. Smoke is soft grey sprites rising from points on the
   current ember line, growing and fading over 5-7 s; sparks are rare
   pin-points that rise fast and die in under a second. Flakes only leave
   when scrolling forward.
5. **Time.** Scroll progress through the runway maps to t (the fire starts
   5% in, slows toward the end, and goes out between 84% and 96%). t
   follows the scroll with a 0.12 s ease. A `heat` value goes to 1 while you
   scroll and decays over a few seconds when you stop: the ember brightness,
   its flicker and the noise clock all follow it, so the embers breathe on
   for a few seconds and then settle, dim and frozen, and the loop stops.

Nothing burns per frame: the sheet is a pure function of t, so scrolling
back unburns it exactly.

## Tuning

- **Bands** are in `bands()`: scorch and ember widths in px (scaled to the
  sheet), char, ash and lift jitter as fractions of the whole burn.
- **The front's shape**: the weights `0.42 big, 0.3 mid, 0.34 fibre` in the
  worker's speed (more contrast = more fingers), the blots, the edge boost
  (`0.45`), the fibre anisotropy (`0.5`).
- **Embers**: `core`, `bead` thresholds and `wid` in the ember block of the
  shader; `ramp()` is the colour of temperature.
- **Smoke, flakes, sparks**: spawn rates in `frame()`, looks in `PART_FS`.

## Theming

| variable | default | used for |
|---|---|---|
| `--pb-sheet` | `#f7f0df` | the sheet (the shader adds fibres, laid and chain lines, toned edges, foxing and two fold creases) |
| `--pb-ink` | `#2a1d14` | the ink |
| `--pb-hand` | Homemade Apple | the face for the plain letter (and the canvas, which copies the `.pb-letter`'s font) |
| `--pb-runway` | `460svh` | length of the scroll runway |
| `--gutter` | | side padding of the plain letter |

The page itself shows through the holes, so the piece takes whatever paper
it sits on.

## Accessibility and motion

- The letter is real text in the DOM: read aloud, found by ctrl+F, printed.
  Once the canvas is live it is visually hidden; the canvas is
  `aria-hidden` and never takes input (`pointer-events: none`).
- Without JS or WebGL2 it is the plain letter on an ivory sheet.
- Reduced motion: no runway; one still frame of the letter with its corner
  burned and the edge glowing (`data-rest`), no particles, no loop.
- The stage is `touch-action: pan-y`; nothing captures a swipe.

## Cost

- Precompute once per layout in a Worker: the Dijkstra over ~150k cells at
  1440x900, run once or twice (~0.3-0.6 s), the ink canvas, and three small textures. Until
  it is ready the plain letter shows; on a resize the old frame stays up.
- A frame is one fragment pass over the sheet (plus a 14px shadow margin):
  about 25 texture reads per burned pixel (Voronoi 3x3 twice, the field at
  five points, the shadow at four, the buckling at four), far fewer on fresh paper, then up to
  420 point sprites. Drawn only while the scroll moves, for the few seconds
  of afterglow, or while particles are in the air, and only while the piece
  is on screen and the tab visible. Canvas DPR capped at 2.
- Textures: burn time (R32F, fetched exactly and interpolated by hand), the
  same with speed and the blurred field (RGBA16F, filtered), the ink (RGBA8 at device
  size), the plates (RGBA8), noise (256²).

## Credits

- [pretext](https://github.com/chenglou/pretext) by Cheng Lou, MIT
  (`vendor/pretext`, unmodified, see its `LICENSE` and `VERSION`).
- Homemade Apple by Font Diner, via Google Fonts (Apache 2.0), loaded by
  the demo.
- No images: the paper, the fire and the ash are drawn in the shader.
  `assets/credits.json` is empty.
- The letter and the paragraphs around it were written for this component.
