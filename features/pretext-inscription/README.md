# pretext-inscription

A Roman inscription cut into a broken stone. The text is set in square
capitals the way a Roman ordinator laid out a titulus: centred, a big first
line and smaller lines below, words parted by triangular interpuncts, full
lines justified to the field, with pretext measuring for an exact fit. Then
the slab is broken, and every word that stood on the lost part goes with it,
letters cut through at the edge. Each letter is a V-cut groove lit by a raking
light that follows the pointer (or the tilt of a phone, a finger, or the
scroll), so one wall of every stroke catches the light and the other falls
into shadow, and the cuts change as the light moves. Scrolled into view, the
letters are cut one after another; when the last is cut, red ochre goes into
the grooves.

```html
<link rel="stylesheet" href="pretext-inscription.css">
<figure data-pretext-inscription>
  <blockquote class="pi-text" lang="la">
    <p class="pi-row"><span class="pi-la">HOSPES QVOD DEICO PAVLLVM EST ASTA AC PELLEGE</span>
       <span class="pi-en" lang="en">Stranger, what I have to say is short: stop and read it through.</span></p>
    <p class="pi-row"><span class="pi-la">HEIC EST SEPVLCRVM HAV PVLCRVM PVLCRAI FEMINAE</span>
       <span class="pi-en" lang="en">Here is the unlovely tomb of a lovely woman.</span></p>
    …
  </blockquote>
</figure>
<script type="module" src="pretext-inscription.js"></script>
```

Each `.pi-row` is one unit of the text (a verse, a line of a dedication):
the Latin in `.pi-la`, its English in `.pi-en`. Write the Latin as the Romans
did, in capitals, V for U; spaces become interpuncts on the stone.

Or `import { pretextInscription } from './pretext-inscription.js'` and call
`pretextInscription(figure, options)`; it returns `destroy()`.

## Options

Data attributes on the figure, or the options object (which wins).

| attribute       | option     | default | what it does |
|-----------------|------------|---------|--------------|
| `data-break`    | `break`    | `heavy` | `heavy`: the right side, the top-right corner and the foot are lost (about 14% of the width, 10% of the height). `light`: one corner chipped. `none`: a whole block. |
| `data-seed`     | `seed`     | `7`     | Shapes the break. `random` gives a new fragment each visit. |
| `data-aspect`   | `aspect`   | auto    | Slab height / width. Auto: as tall as the screen allows (74% of the viewport) and no taller than the text needs. |
| `data-hedera`   | `hedera`   | off     | Ends the text with a hedera, the ivy-leaf stop of Roman inscriptions. |
| `data-tracking` | `tracking` | `0.06`  | Letter-spacing in em, before justification. |
| `data-leading`  | `leading`  | `1.5`   | Line pitch, x the font size. |
| `data-duration` | `duration` | auto    | Seconds for the cutting (auto: about 0.024 s a letter, 2.2 to 7 s). The paint follows in 1.7 s. |
| `data-guide`    | `guide`    | `0.14`  | How visible the ordinator's brushed layout is before the chisel reaches it (0 to hide). |
| `data-font`, `data-weight` | `font`, `weight` | the `.pi-la`'s | Canvas type, if it should differ from the fallback's. |
| `data-stone`    | `stone`    | `assets/marble.webp` | A stone photograph (same origin); only its veining is used, around `--pi-stone`. |
| `data-hint`     | `hint`     | "Hover / Touch a line to read it" | The small label beneath the stone. `data-hint=""` hides it. |
| row `data-scale`| (per row)  | `1.36`, `1.1`, then `1` | Relative size of a row; each row is also never larger than the one above. |
| row `data-fit`  | (per row)  | off     | This row on a single line, sized to fill the field. |

## How it works

1. **Ordinatio.** pretext prepares each row once at 100px. Its widths are
   linear in size, so a binary search re-sets the whole inscription at
   twenty-two trial sizes without touching the DOM and keeps the largest that
   fills the field. When the stone is wide enough that every row after the
   first fits on a line of its own at no less than 70% of the flowing size
   (desktop), each row gets its own line, sized to the field, never larger
   than the row above: the classic look. On a narrow stone (phone) the rows
   flow onto several lines instead. Full lines are justified with the slack
   in the interpunct gaps (up to half again), then a little tracking; a line
   too short for that is centred rather than stretched.
2. **The break.** A polygon in the stone's box: the intact sides follow the
   slab (with its moulded frame), the broken ones are fractal break lines
   (midpoint displacement down to facets of about 3% of the stone, then a
   little grit). The text is laid out on the whole slab, so the lost part
   takes its words with it.
3. **The cut.** The letters are drawn into a mask at device resolution; an
   exact Euclidean distance transform (Felzenszwalb) gives every pixel its
   distance to the edge of its stroke: the depth of a V-groove, deepest
   along the middle, a crease where the walls meet. Each groove pixel also
   carries the moment the chisel reaches it (16 bits), from the letter's
   place in the reading order and a short sweep across the letter.
4. **The light.** One WebGL1 fragment shader builds a height field from the
   groove, the moulded frame (computed from the slab rectangle: an arris, a
   fillet, a cyma, mitred at the corners for free by `min()`), a rough bevel
   along the break (a chamfer distance, its width and inner edge bitten by
   noise) and a faint stone relief, and lights it with a raking directional
   light. Shadows cast by the frame and the break are marched toward the
   light; the grooves' own walls are left two-tone. The slab throws a soft
   shadow on the paper away from the light. Lambert is normalised so flat
   stone shows `--pi-stone` exactly; lit walls roll off softly.
5. **Colour.** The stone is `--pi-stone` with the marble photograph's veining
   (its luminance only). Before the cut, a faint brushed layout; a new groove
   is pale with dust for a moment; after the last cut the paint
   (`--pi-paint`, red ochre) settles in the deep of every groove, worn at the
   lips by noise, sweeping through in reading order.

## Theming

| variable      | default    | used for |
|---------------|------------|----------|
| `--pi-stone`  | `#ddd6c8`  | the stone (warm marble). Limestone: `#d8cdb4`; a grey slate-ish stone: `#b9b7b0`. |
| `--pi-paint`  | `#94402a`  | the paint in the grooves (red ochre). Gilded letters: `#b08a3e`. |
| `--pi-caps`   | Cinzel     | the capitals (canvas and fallback) |
| `--serif`     | Cormorant Garamond | the translation |
| `--sans`, `--ink-2`, `--ink-3` | | the hint and translation colours |
| `--accent`    | `#c96f4a`  | keyboard focus ring |

The canvas is transparent outside the stone, so it sits on any paper.

## Tuning

- **The rake.** `LZ` (0.72) is the light's height: lower is more dramatic and
  darker, higher flatter. The light never climbs overhead (it is pushed out
  to at least 0.95 of the stone's half-size) and never comes from below the
  middle, where the eye would read the cuts as raised letters.
- **The groove.** `uK` (1.1) is the wall slope; 0.8 reads as a soft
  inscription, 1.4 as a crisp one. Weight 700 Cinzel gives strokes wide
  enough for two visible walls at phone sizes.
- **The paint.** Its strength is `paint * 0.62` in the shader and how deep it
  starts (`smoothstep(0.35, 1.2 dpr)` of the groove's depth).
- **The break.** `outline()` holds the control points of each mode and the
  facet size; the bevel width is `Bmax` (2% of the stone, 6-16 px).
- **Cost.** Building the textures (two distance passes and a blur over the
  canvas) takes about half a second for a 1100px stone at 2x, once per
  layout, before anything moves. Frames are one full-screen shader pass with
  about twenty texture reads a pixel, drawn only while something changes.

## Accessibility and motion

- The `<blockquote>` stays in the DOM with its `lang="la"` Latin and
  `lang="en"` translations: read aloud, found by ctrl+F, printed. Once the
  stone is live it is visually hidden; the canvas and the translation line
  are `aria-hidden`.
- Without JS or WebGL, or if pretext or the stone image fails, the page shows
  a plain edition: Latin in capitals, each row's English beneath in italics.
- The figure is focusable: Up/Down read the rows one by one (the translation
  appears beneath), Left/Right swing the light, Esc hides the translation.
- Phone: tap a line to read it (tap again to hide); drag sideways to move the
  light. `touch-action: pan-y`, so vertical swipes scroll the page. Tilting
  the phone moves the light too (iOS asks on the first tap). Untouched, the
  light sweeps slowly from left to right as the stone travels up the screen.
- Reduced motion: the inscription is shown already cut and painted, the
  light rests upper left and does not follow the scroll. The pointer, a
  finger and the keys still move it, directly, without easing.
- The rAF loop runs only while the cutting is under way or the light is
  moving, and only while the stone is on screen (cutting pauses off screen).
  Canvas DPR is capped at 2 (3 for small stones).

## Credits

- [pretext](https://github.com/chenglou/pretext) by Cheng Lou, MIT
  (`vendor/pretext`, unmodified, see its `LICENSE` and `VERSION`).
- `tilt.js` copied from the house components.
- The marble: "White Carrara Marble" by James St. John, CC BY 2.0, via
  Wikimedia Commons (only its veining is used, at low contrast). See
  `assets/credits.json`.
- The texts: the epitaph of Claudia (Rome, 2nd century BC, CIL VI 15346) and
  the Pantheon's dedication (CIL VI 896). Translations written for this
  component.
