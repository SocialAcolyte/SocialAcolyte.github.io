# pretext-spiral

A paragraph wound onto a disc of fired clay, like the Phaistos Disc. The words
are stamped along an Archimedean spiral from the rim inward (or from the centre
out), phrases closed by a small stamped tick and the turns parted by an incised
groove. The disc is lit, not painted: a fixed lamp at the top left rakes across
the impressions as it turns, so the shadows always sit on the far wall of each
letter. Drag it, scroll past it or use the arrow keys to turn it. A short
pointer above the rim marks twelve o'clock, a fine tick and bead ride the
groove of the turn being read, the word under it
fills with ink, and the same passage slides by, set flat, in a line beneath.

```html
<link rel="stylesheet" href="pretext-spiral.css">
<section data-pretext-spiral data-src="assets/clay.webp">
  <div class="ps-stage">
    <p class="ps-text">Someone cut forty-five little stamps…</p>
  </div>
</section>
<script type="module" src="pretext-spiral.js"></script>
```

A coin or seal: add a legend, which is set round the edge (repeated if it is
short, as on coins) with a beaded border, and the spiral fills the field inside.

```html
<section class="coin" data-pretext-spiral data-src="assets/bronze.webp"
         data-material="bronze" data-from="centre" data-scroll="flow">
  <div class="ps-stage">
    <p class="ps-legend">And this too shall pass</p>
    <p class="ps-text">A king, the story goes, asked his wise men…</p>
  </div>
</section>
```

Or `import { pretextSpiral } from './pretext-spiral.js'` and call
`pretextSpiral(section, options)`; it returns `destroy()`.

## Options

Data attributes, or the options object (which wins).

| attribute | option | default | what it does |
|---|---|---|---|
| `data-src` | `src` | required | The material: a square photograph whose inscribed circle becomes the disc's face (same origin). About 1500px is sharp at 2x. |
| `data-material` | `material` | `clay` | `clay`: matte. `bronze`: metal, more gloss, shallower letters, a finer rim. |
| `data-from` | `from` | `rim` | `rim`: the text starts at the edge and winds in to a rosette, as on the Phaistos Disc. `centre`: it starts at the rosette and winds out. |
| `data-scroll` | `scroll` | `pin` | `pin`: a runway (`--ps-runway`) with the stage pinned; scrolling turns the disc. `flow`: it sits in the page and turns as the page goes by. `none`: only drag and keys. |
| `data-trail` | `trail` | `0.5` | Ink left in the words already read (0 = none). Gives the disc a visible record of how far you have read. |
| `data-reader` | `reader` | `true` | The flat line of the same text beneath the disc. `false` to leave the disc alone. |
| `data-font` | `font` | the `<p>`'s | Canvas-only family. The demo uses `'EB Garamond', serif`, which keeps its shape when impressed small. |
| `data-weight` | `weight` | the `<p>`'s | Canvas-only weight. 600 cuts a clear impression. |
| `data-dividers` | `dividers` | `phrases` | `phrases`: a tick only where a word ends a phrase (after punctuation), plain spaces inside, as the Phaistos Disc's strokes part sign groups. `words`: a tick after every word (busier; reads like a table). |
| `data-lead` | `lead` | `1.22` | Pitch of the spiral as a multiple of the type size (the minimum; see Tuning). |
| `data-label` | `label` | "Inscribed disc. Turn it to read…" | Accessible name of the disc. |

## Theming

| variable | default | used for |
|---|---|---|
| `--ps-size` | `min(100vw − 2 gutters, 68svh, 660px)` | Diameter of the disc. The demo's coin sets `min(…, 46svh, 380px)`. |
| `--ps-ink` | `#161311` | The ink rubbed into the words (6-digit hex; read once at start). |
| `--ps-runway` | `250svh` | Length of the pinned runway (`data-scroll="pin"`). |
| `--ps-serif` | `var(--serif)` | Face of the no-JS paragraph and the reading line. |
| `--paper`, `--ink`, `--ink-3`, `--accent`, `--gutter`, `--sans` | house values | Background, the reading line (read word in ink, the rest in ink-3), the focus ring, padding, the no-JS legend. |

## How it works

1. **Winding.** The centreline of the band is `r(t) = a ± (pitch / 2π) t`. Each
   turn is one line: pretext's `layoutNextLineRange` breaks the paragraph with
   `maxWidth` = that turn's arc length (closed form for a spiral), less the
   gaps (a wide one with a tick at a phrase end, a space elsewhere), so a turn takes exactly the words that fit. Each full turn is
   then justified: its slack goes into letter-spacing (up to 0.14em), the rest
   into the gaps, so the last letter of a turn meets the first of the next.
   The last turn is set at its natural spacing and simply ends.
2. **Fitting.** pretext measures once at 100px; widths scale, so a binary search
   finds the largest type that fits between the rim and the rosette in about
   eighteen trial windings without touching the DOM. Turns come in whole
   numbers, which would leave an empty band before the centre, so a second
   search opens the pitch (up to 30%) until the words reach the rosette.
3. **Placing.** Every glyph is measured on its own and set at its arc position,
   converted back to the spiral parameter (a quadratic), rotated to the
   tangent with its top toward the rim.
4. **Baking.** One canvas holds the impressions: glyphs in red; grooves,
   dividers, the five start dots, the end ring, the dotted border, the rosette
   (Phaistos sign 38) and a coin's legend and beads in green; the disc's
   silhouette blurred in blue, which becomes a rounded rim; and the face's
   luminance as fine grain in alpha. The face is the photograph cut to a gently
   irregular outline.
5. **Lighting.** A fragment shader turns the disc each frame, takes the slope of
   that height map as a normal (rotated into screen space), lights it from a
   fixed lamp 35° up at the top left, darkens the floors of the impressions,
   and marches eight steps toward the lamp so each letter casts a short shadow
   into itself. Flat clay comes out exactly the photograph's colour. The same
   pass draws the disc's two-layer shadow on the paper, and the pointer and
   reading tick with their own small shadows (never a line across the face).
6. **Ink.** For every pixel the shader knows which turn it is on, and so its
   place along the text; the word under the needle, any words still fading,
   and the trail of words read are passed as ranges of that parameter. Ink
   goes into the floor of the letters before lighting, so the walls still
   catch the light.

Turning is one state: dragging sets it directly (an angular grip around the
centre, eased near the hub); on release it coasts with friction (τ = 1s, like a
heavy disc on a spindle), then a critically damped spring brings the nearest
word to rest under the needle. Scrolling turns the disc as if the page were a
belt on its rim (the rim moves about twice as far as the page), and when the
scrolling stops the nearest word settles under the needle. Ink soaks in fast
(90ms) and lifts slowly (420ms).

## Tuning

- **Text length.** 250-350 words make 12-14 turns on the big disc, 13-15px type
  on a desktop and 7-8px on a phone (crisp at 3x, and the reading line carries
  it). The coin's ~130 words make a dense field because its legend takes the
  outer ring.
- **Depth and light.** `MATERIALS` at the top of the script: glyph depth (as a
  fraction of the type size), rim height, grain, ambient, specular. `L` in the
  shader is the lamp. Deeper letters read louder but start to look moulded
  rather than stamped; 0.15em is the clay's.
- **The face.** Pick a photograph with even light and little relief of its own,
  flattened of large-scale shading. Busy relief (a bulla, rough patina) fights
  the letters; the shader adds the photograph's grain as micro-relief anyway.
- **Scroll speed.** `2.1` in the scroll handler is the belt ratio. Mapping the
  whole text to the runway spun the disc a turn every few dozen pixels, which
  is not calm; this way scroll gives the disc life and dragging does the reading.

## Accessibility and reduced motion

- The real `<p>` (and the legend) stay in the DOM, visually hidden once the
  disc is live: read aloud, found by find, printed. The canvas and the reading
  line are `aria-hidden`.
- The disc is a focusable `role="slider"` over the words: arrows move a word,
  Page Up/Down about a turn, Home/End to the ends; `aria-valuetext` gives the
  word under the tick ("flower (word 22 of 303)"). A clay-coloured ring shows
  focus.
- Phone: one finger sideways turns the disc; vertical swipes scroll the page
  (`touch-action: pan-y`), so the large surface never traps scrolling.
- Without JS, or without WebGL, the paragraph is a plain column of prose.
- Reduced motion: no runway, scrolling does not turn it and nothing coasts or
  springs; the disc rests at the first word. Dragging still turns it (direct
  manipulation) and lets go dead on the nearest word; keys jump.
- The rAF loop runs only while the disc or the ink is moving and the disc is
  on screen; at rest nothing runs. The canvas is at most 2048px square.

## Credits

- [pretext](https://github.com/chenglou/pretext) by Cheng Lou, MIT
  (`vendor/pretext`, unmodified, see its `LICENSE` and `VERSION`).
- The clay is the floor of a Minoan terracotta plate of ca. 1750-1600 BCE, the
  period of the Phaistos Disc, and the bronze is the patinated face of a
  Tarentine disk mirror of the 3rd century BCE, both The Metropolitan Museum
  of Art Open Access (CC0). See `assets/credits.json`.
- The texts are written for this component.
