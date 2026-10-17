# split-flap

A Solari board, the clattering departures display of old stations and
airports, for headlines, counters, clocks and rotating words. Each character
is a real mechanism. The upper half-flap falls forward on its hinge in 3D,
dimming as it tips away from the light. Its back carries the bottom of the
next character, it lands with one small rebound, and it throws a shadow on
the half below. To reach a letter a cell turns its drum in order (A, B,
C…), so a long change takes longer, and at speed two or three flaps flutter
in the air at once.

```html
<link rel="stylesheet" href="split-flap.css">

<span data-split-flap>ROMA</span>
<span data-split-flap data-theme="light" data-drum="alpha" data-align="center"
      data-words="WANDER, ARRIVE, LINGER, DEPART, RETURN"></span>
<span data-split-flap data-clock="HH:MM:SS"></span>
<span data-split-flap data-counter="4218" data-length="6"></span>
<span data-split-flap data-mask="99:99">09:35</span>

<script type="module" src="split-flap.js"></script>
```

```js
import { splitFlap } from './split-flap.js';
const flap = splitFlap(el, { length: 10, drum: 'alpha' });
flap.setText('ALEXANDRIA');                 // turns each drum forward to it
flap.setText('KNOSSOS', { delay: 140 });    // also: stagger, jitter (ms), instant
flap.setValue(4290);                        // counter mode
flap.sound(true);                           // soft clicks (only after the visitor has touched the page)
flap.pause(); flap.play();                  // the word rotation or the clock
flap.text;                                  // the text it is heading for
el.addEventListener('split-flap:settle', (e) => e.detail.text);
flap();                                     // destroy: restores the original text
```

The element's own text is the content. Without JS it stays a line of
condensed capitals; with JS it gets `.sf` and the cells. `el.splitFlap` is
the same handle as the return value.

## Options

Data attributes, or the options object (which wins).

| Option | Attribute | Default | |
|---|---|---|---|
| `length` | `data-length` | the text's length (the longest word; 4 for a counter) | Number of cells. Longer text is cut; shorter is padded with blank flaps. |
| `align` | `data-align` | `left` | `left`, `center` or `right` within the cells. |
| `drum` | `data-drum` | `full` (`digits` for a counter) | The characters on each drum, in order: `full` (blank, A–Z, 0–9, `.,:-/&'`), `alpha` (blank, A–Z), `digits` (0–9), `blankdigits` (blank, 0–9), or your own string. Letters-only drums keep a word from rolling through digits on the way round. |
| `mask` | `data-mask` | none | One character per position: `A` full drum, `a` letters, `9` digits, `_` blank+digits; anything else is printed on the housing as a separator, like the colon of a clock (`99:99`). |
| `words` | `data-words` | none | Comma- or `\|`-separated list to rotate through. |
| `interval` | `data-interval` | `2600` | ms a word stays once it has landed. |
| `clock` | `data-clock` | none | `HH:MM` or `HH:MM:SS`; live local time, ticking on the second or minute. |
| `hour12` | `data-hour12` | `false` | 12-hour clock. |
| `counter` | `data-counter` | none | Starting value for counter mode; change it with `setValue(n)`. Zero-padded to `length`. |
| `theme` | `data-theme` | `dark` | `light`: cream flaps and ink type, for paper pages. |
| `intro` | `data-intro` | `true` | Start blank and flip to the text the first time it is on screen. |
| `live` | `data-live` | `polite` (`off` for a clock) | `aria-live` of the hidden text. |
| `sound` | `data-sound` | `false` | Synthesised clicks on landing. Never autoplays. |

## Theming

The element's `font-size` is the cell height; `--sf-size` sets it on `.sf`
(default `2.6em`).

| Variable | Default (dark / light) | |
|---|---|---|
| `--sf-flap`, `--sf-flap-hi`, `--sf-flap-lo` | charcoal `#262422` / cream `#efe9dc`, with lighter and darker ends | Flap colour and its gentle top-to-bottom gradient. |
| `--sf-ink` | `#ece5d3` / `#1b1918` | Glyphs. |
| `--sf-board` | `#121110` / `#d8d0bf` | The housing behind the cells. `transparent` when the cells sit in your own housing (the demo's board). |
| `--sf-pad`, `--sf-board-r` | `.075em`, `.1em` | Housing padding and radius. |
| `--sf-w` | `.64em` | Cell width (as a fraction of the height). |
| `--sf-gap` | `.055em` | Gap between cells. |
| `--sf-r` | `.06em` | Flap corner radius. |
| `--sf-type` | `.84` | Glyph size as a fraction of the cell height. |
| `--sf-font`, `--sf-weight` | `'Barlow Condensed'`, `600` | The face. Load it yourself (the demo uses Google Fonts). |
| `--sf-split` | dark hairline | The split between the halves. |
| `--sf-notch` | near-black / warm grey | The hinge notches at each side of the split. |
| `--sf-under` | soft dark | The upper flap's resting shadow on the lower half. |
| `--sf-tint` | umber `#5a4632` | Light theme only: the warm shade laid over a falling cream flap (its opacity follows the light curve), so the shadow side reads as card in shade, not grey. |
| `--sf-cast-c` | black / warm brown | Colour of the shadow a falling flap casts. |
| `--sf-edge-hi` | faint warm white | The bevel highlight on each flap's top edge. |
| `--sf-grain` | an inline SVG noise | Matte grain on the flaps; `none` to remove. |
| `--sf-persp` | `3.4em` | Perspective of the fall. Smaller is more dramatic. |
| `--sf-sep` | `--sf-ink` | Colour of printed separators. |

## How a cell works

A cell is two static halves (the next character's top, the current
character's bottom) and, while it moves, a few **leaves**. A leaf is a
full-cell wrapper that carries the perspective and the cast shadow, plus the
flap itself: two faces back to back (`preserve-3d`, `backface-visibility:
hidden`). The front face shows the top of the character it is leaving, the
back the bottom of the next one, so the drum reads right at every moment.

- **The fall** is an inverted pendulum (θ'' = g sin θ) given a small push
  past the stop, integrated once at load into a lookup table. The flap
  leaves slowly and arrives fast. It then makes one ballistic hop of 9°
  and a second of 2°. Only the last flap of a change keeps its bounce. The
  ones before it are covered by the next flap, so they are put away as they
  land.
- **The light** is one lamp above and in front, at 36° (Lambert plus
  ambient, relative to a face at rest). The front face darkens as it tips
  away (on cream flaps through a warm umber overlay, since `brightness()`
  would turn them grey). The back comes up out of shadow, catches a little more light than
  rest just before it lands, then settles. A falling flap darkens the half
  beneath it, and a resting flap always shades the top of the lower half.
- **The drum** releases a flap every ~58ms (±12%), and a flap takes 172ms
  to fall. That gives ~17 flaps a second and the flutter of two or three in
  the air. Cells start 26ms apart, left to right, plus up to 60ms at
  random.
- **Cheap**: all of the above is sampled once into keyframes and played as
  Web Animations on transform, filter and opacity, which the compositor
  runs. Each cell keeps up to four leaves and reuses them. For each flap
  the main thread sets two glyphs, rewinds four animations and swaps one
  z-index at 90° (from that point a later flap lies over an earlier one).
  Idle leaves have their animations cancelled, so a resting board holds no
  extra layers. One shared rAF drives every cell on the page and stops
  when nothing moves. Offscreen or in a hidden tab, changes apply at once.
- **Centring**: when fonts are ready, the cap height of the face is
  measured on a canvas (`fontBoundingBox` vs `actualBoundingBoxAscent` of
  "H") and the glyphs are shifted so the split crosses the middle of the
  capitals, whatever face you choose.

## Tuning notes

- Timing constants are at the top of `split-flap.js`: `STEP`, `FALL`,
  `BOUNCE`, `STAGGER`, `JITTER`, `LIGHT`. A slower `STEP` (80–100ms) feels
  more like an old station; below ~45ms the flutter turns to blur.
- Use `data-drum="alpha"` for words (no detour through digits),
  `blankdigits` for platform numbers, a `mask` for times.
- Wide letters (M, W) need `--sf-w` of about `.6em` in a condensed face; a
  regular-width face needs `.75em` or more.
- Measured in headless Chrome at 1440×900, DPR 2, on a busy machine. A
  ~100-cell change, rows 70ms apart, ran at ~58 fps (146 frames in 2.5s)
  with no long tasks. The extreme case, all 190 demo cells flipping at
  once and many going through half the alphabet, has a few 50–120ms
  tasks; nearly all of that is painting new glyphs, not script. A big board
  should change in waves, as the demo's does.

## Accessibility and reduced motion

The cells are `aria-hidden`. A visually hidden span inside the element holds
the text, and it changes only when every flap has landed, never once per
flap. That span is `aria-live="polite"` by default. A clock gets
`role="timer"` and `aria-live="off"`. Set `data-live="off"` on anything
that updates on its own (rotating words, every cell of a board) and
announce a summary yourself, as the demo does with "Now boarding…". The
element gets `translate="no"`. Word rotation pauses offscreen and in hidden
tabs, and `pause()` / `play()` are there for a visible control (WCAG 2.2.2).

Sound is off by default. With `data-sound` or `sound(true)` the
AudioContext is created only inside a pointer or key gesture, so nothing
ever plays on load. Clicks are soft: a 30ms noise burst through a bandpass
over a low knock, at most one per frame, a little louder when many flaps
land together.

Reduced motion: every change is instant, with no flaps. Rotating words stay
on the first word. A clock and a counter still update, since they carry
information, but they swap without moving.

## Credits

No libraries, no images. The demo's face is Barlow Condensed by Jeremy
Tribby (SIL Open Font License), loaded from Google Fonts; see
`assets/credits.json`. Destinations are classical: Roma, Alexandria,
Knossos, Byzantium and others.
