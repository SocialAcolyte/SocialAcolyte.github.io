# pretext-calligram

A paragraph poured into a vessel. The text is set inside the silhouette of a
real object, a cut-out amphora or vase, line by line, justified so the edges
of the words are the edge of the pot. It starts in grey ink; as you scroll,
the picture rises from the foot like liquid, with a soft wavy meniscus: the
letters are a mask and the photograph of the vessel is poured through them,
so the painted figures and the brushwork appear inside the type. A pointer
(or a finger) brings the picture into the letters around it, and shows the
photograph faintly between them.

```html
<link rel="stylesheet" href="pretext-calligram.css">
<section data-pretext-calligram data-src="assets/amphora.webp">
  <div class="pc-stage">
    <p class="pc-text">Before it held anything it was mud from the river…</p>
  </div>
</section>
<script type="module" src="pretext-calligram.js"></script>
```

Or `import { pretextCalligram } from './pretext-calligram.js'` and call
`pretextCalligram(section, { src, fill, minRun, lines, size, font, weight, tracking, ghost })`; it returns `destroy()`.

## Options

| attribute       | option   | default  | what it does |
|-----------------|----------|----------|--------------|
| `data-src`      | `src`    | required | The cut-out: a transparent PNG/WebP on the same origin. Its alpha is the shape; the picture is what fills the type. |
| `data-fill`     | `fill`   | `scroll` | `scroll`: a tall runway with a pinned stage; the colour rises as you go. `static`: no runway, the vessel sits in the flow already painted. |
| `data-lines`    | `lines`  | none     | At least this many lines. Without it the size is the largest at which the text fits; with it the type is made small enough for that many lines, and if the text runs out first it begins again after an interpunct (only on the canvas). The demo uses `60`: calligrams need fine grain to draw the shape. |
| `data-size`     | `size`   | none     | A fixed font size in px (the text loops if it is short, as above). |
| `data-font`     | `font`   | the `<p>`'s | Canvas-only font family; the `<p>` keeps its own styling for no-JS and screen readers. The demo uses `'EB Garamond'` (loaded in the page), which carries the picture better than Cormorant. |
| `data-weight`   | `weight` | the `<p>`'s | Canvas-only weight. Heavy strokes act like a halftone screen: the demo uses `700`. |
| `data-tracking` | `tracking` | `0`    | Canvas letter-spacing in em (pretext lays out with it). The demo uses `-0.01`. |
| `data-ghost`    | `ghost`  | `0`      | Opacity of the photograph drawn faintly behind the painted letters (below the surface only), so the eye fuses type and picture. The demo uses `0.08`. |
| `data-min-run`  | `minRun` | `1.6em`  | The narrowest run worth a line, in em of the font size (`1.6em`) or px (`40`). Handles take short words; parts thinner than this (or where the next word will not fit) are stippled with small dots. |

## How it works

1. The cut-out is scaled to the box at one pixel per CSS pixel. For each
   pixel the script stores how many vessel pixels run straight down from it,
   so asking "which columns are solid across this line's band" is one pass
   along a row.
2. For every line it scans the silhouette at that height: one run across the
   belly, two where a handle cuts the row, none at the foot. pretext's
   `layoutNextLineRange` fills each run that is wide enough, in reading order.
3. pretext measures the text once at 100px; its widths are linear in size,
   so a binary search re-pours the whole paragraph at sixteen trial sizes
   without touching the DOM and finds the largest that fits. `data-lines`
   (or `data-size`) then sets the density; leading is a tight 1.08.
4. Each line is justified: the slack goes to the word gaps (up to about two
   spaces), then a whisper of letter-spacing (canvas `letterSpacing`, so
   ligatures stay intact), then back to the gaps. A lone word is tracked out
   and centred; the last line (when the text does not loop) is centred and
   ragged. Words too long for a narrow run leave
   the run to the ornament rather than break mid-word; put soft hyphens
   (`&shy;`) in long words and pretext will use them.
5. Wherever no line could go (the thin part of a handle, a rim) the run is
   stippled with small dots on a staggered grid, like the interpuncts Greek
   inscriptions set between words, so the whole silhouette reads. Dots are
   canvas-only; the `<p>` never contains them.
6. Three layers are drawn once per layout: the words in ink, the picture
   (lifted, below), and the picture poured into the words (`source-in` over
   the glyph mask). Each frame only composites them: a blurred wave mask
   cross-fades ink to picture (`destination-out` + `lighter`, exact on
   premultiplied pixels), a pale blurred band along the wave catches the
   letters it crosses (the meniscus), and around the pointer a radial mask
   fills the letters with the picture and lays the photograph faintly
   behind them (`destination-over`).

## Theming

| variable      | default                 | used for |
|---------------|-------------------------|----------|
| `--paper`     | `#f3f0e8`               | background |
| `--ink`       | `#141312`               | the words before the colour arrives (the canvas copies `.pc-text`'s `color`; the demo sets a soft grey ink, `#5e5953`, so the paint visibly arrives even on black glaze) |
| `--pc-serif`  | `var(--serif)`          | the face; the canvas copies `.pc-text`'s family, weight and style |
| `--pc-runway` | `240svh`                | length of the scroll runway |
| `--gutter`    | `clamp(16px, 3vw, 32px)`| side padding of the stage |

## Tuning

- **Density.** The shape is drawn by the grain of the lines, so more is
  better: 55-80 lines on a desktop, 40+ on a phone. Line count barely
  depends on screen size (everything scales); the demo's `data-lines="75"`
  gives about 10px type on a desktop and 7-8px on a phone (crisp at 3x).
  Write 400-500 words so the loop seam (a single `·`) comes late; the
  demo's paragraphs are about 470 each, so they loop about one and a half
  times.
- **Picture.** `lifted()` gives the photograph a gentle S-curve, eases
  highlights down toward a ceiling (`ceil`, `knee`) so white porcelain reads
  as a pale blue on the paper instead of vanishing, and raises saturation
  (`sat`) so thin strokes still carry colour. Black glaze is lifted to a warm
  charcoal (`#2a2420`, `F` in `lifted()`), so painted black never reads as
  the grey ink above the surface. One pass per layout.
- **Halftone.** The picture shows only where there is ink, so weight is
  everything: 700 with a hair of negative tracking and ~75 lines lets the
  orange field and the black-figure fighters read at arm's length. Squint
  test: shrink a screenshot to 25%.
- **Ink.** Near-black ink is faithful, but on a black-figure pot most of the
  paint is near-black too and the rising colour barely shows. A soft grey
  ink on `.pc-text` makes the arrival legible everywhere.
- **The surface.** `LEADING`, the wave amplitude (`base`, `extra` in `frame`)
  and the spring (`K`) set the feel; the surface sloshes in proportion to how
  fast it is rising and settles to a still, slight ripple.
- **The cut-out.** Trim it tight, keep the edge clean and the alpha solid
  inside (holes in the mask become holes in the text; the gap inside a
  handle should be transparent). Around 1400-1600px tall keeps the picture
  sharp inside the letters on a 3x phone.

## Accessibility and motion

- The real `<p>` stays in the DOM, visually hidden once the canvas is live:
  read aloud, selectable via find, printed. The canvas is `aria-hidden`.
- Without JS, or if the image or pretext fails to load, the paragraph is a
  plain column of prose.
- Reduced motion: no runway; the vessel is shown already painted and still.
  The pointer lens still works (direct manipulation) but follows instantly.
- Phone: touch the vessel to see the photograph under your finger; slide
  sideways to move it (vertical drags scroll the page as usual).
- The rAF loop runs only while the surface or lens is moving and the piece
  is on screen; at rest nothing runs. Canvas DPR goes up to 3 so phone-size
  type stays crisp, and drops to 2 when the canvas would exceed ~2.8M pixels.

## Credits

- [pretext](https://github.com/chenglou/pretext) by Cheng Lou, MIT
  (`vendor/pretext`, unmodified, see its `LICENSE` and `VERSION`).
- Images from Wikimedia Commons (the Panathenaic amphora, Met photograph, CC0)
  and The Metropolitan Museum of Art Open Access (the gourd vase, CC0); both
  cut out for this component. See `assets/credits.json`.
