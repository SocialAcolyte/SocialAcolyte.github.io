# pretext-tesserae

A paragraph laid as a mosaic. The picture is cut into stones the way a Roman
mosaicist set them: a row or two of stones hugging every outline and
following its curve, and the ground filled in straight courses. Every stone
is a small frame of type, turned to run along its row, and Cheng Lou's
pretext breaks the paragraph into the lines each stone can hold. At arm's
length it is the black-and-white Neptune floor from Ostia; up close it is
prose, with paper-coloured words on the black stones and ink on the white.
When it scrolls into view the stones are pressed into a faint red
underdrawing one by one, outlines first, in grey, and colour comes up behind
them. Hover a stone and it comes up off the bed toward you so you can read it.

```html
<link rel="stylesheet" href="pretext-tesserae.css">
<figure data-pretext-tesserae data-src="assets/neptune.webp"
        data-src-narrow="assets/neptune-tall.webp" data-colours="2" data-wash="0.92"
        data-font="'EB Garamond', serif" data-weight="800" data-tracking="-0.01">
  <p class="tes-text">You came in from the street out of the heat…</p>
</figure>
<script type="module" src="pretext-tesserae.js"></script>
```

Or `import { pretextTesserae } from './pretext-tesserae.js'` and call
`pretextTesserae(figure, { src, … })`. It returns `destroy()`, which removes
the canvas and every listener and gives the paragraph back.

Write 500-700 words. A desktop mosaic holds about twice that, so the
paragraph runs on after an interpunct (`·`), on the canvas only.

## Options

| attribute          | option      | default | what it does |
|--------------------|-------------|---------|--------------|
| `data-src`         | `src`       | required | The picture, same origin. Only its colours and outlines are used, so 900-1400px is plenty. Bold, flat designs read best: a black-and-white floor, tiles, a textile. |
| `data-src-narrow`  | `srcNarrow` | none    | A second crop for columns under 560px (a phone). The demo gives phones Neptune alone. Switches on resize. |
| `data-colours`     | `colours`   | `4`     | How many colours the picture is read in (2-8). Its outlines are the boundaries between them. `2` for black and white; the Iznik demo uses `5`. |
| `data-rows`        | `rows`      | `2`     | How many rows of stones follow each outline before the ground goes straight. `0` gives plain courses everywhere. |
| `data-lines`       | `lines`     | `2`     | Lines of type across a hugging stone (ground stones take a little more). Sets the stone size. |
| `data-size`        | `size`      | auto    | Type size in px. Auto is the width / 210, between 4.2 and 7 (about 6.5px on a 1440px desktop, 4.2px on a phone; crisp at 2-3x, read by lifting). |
| `data-grain`       | `grain`     | `1`     | Stone size multiplier. Smaller grain gives more stones and a sharper picture, with fewer words in each. |
| `data-wash`        | `wash`      | `0.72`  | How much of its colour a strong stone's face shows (pale stones show a little over half of this). The Neptune demo uses `0.92`, so the black reads as black. |
| `data-deepen`      | `deepen`    | `0.28`  | How much darker than its face a stone's words are; pale stones are deepened more, toward ink. Dark stones take paper-coloured words instead. |
| `data-detail`      | `detail`    | `0`     | Mix some of the photograph itself into the glyphs (0-1). Off by default: one stone, one colour. |
| `data-grout`       | `grout`     | auto    | Gap between stones in px (auto: 0.3 x type size, 1.4-3px). |
| `data-height`      | `height`    | `0.88`  | Largest height, as a fraction of the window. |
| `data-build`       | `build`     | `enter` | `none` shows the finished mosaic straight away. |
| `data-font`        | `font`      | the `<p>`'s | Canvas-only family. The demo uses EB Garamond (loaded in the page). |
| `data-weight`      | `weight`    | the `<p>`'s | Canvas-only weight. The demo uses `800`. |
| `data-tracking`    | `tracking`  | `0`     | Canvas letter-spacing in em (pretext lays out with it). |
| `data-label`       | `label`     | a sentence | `aria-label` of the focusable mosaic. |
| `data-debug`       |             |         | Logs stone count, type size, layout time and the longest slice. |

## How it works

1. **Regions.** The picture is read at about 2.2 CSS px a sample, softened
   by half a real tessera (so a photograph's grout and stains don't count),
   and split into `colours` regions by k-means. A majority filter and a pass
   that merges any island smaller than a couple of stones into its
   surroundings leave clean shapes.
2. **Rows.** An exact distance transform (Felzenszwalb) gives every sample
   its distance to the nearest outline, the frame included. Within `rows`
   stone-heights of an outline a sample's row is its band of distance, so
   rows run parallel to the outline at every bend. Beyond that, the ground
   is laid in straight horizontal courses.
3. **Stones.** Seeds go along each hugging row's centre line about 1.75
   stone-heights apart, and along each course every 2.2, every other course
   offset half a stone. Every sample goes to the nearest seed in its own row.
   Where no seed is near enough, a new one is set. Then three relaxation
   steps move each seed to the middle of what it owns, so the stones even
   out. Each stone is the hull of what it owns, trimmed against its
   neighbours' bisectors so nothing overlaps, then inset for grout. Slivers
   too thin for a stone stay grout.
4. **Colour.** A stone takes the colour of its main region (its own pixels,
   pulled toward the region's palette colour). The palette is stretched from
   near-black to a pale marble, so a weathered white floor is still white
   stone.
5. **Setting.** Each stone has a direction: along the outline it hugs (the
   distance field's gradient turned a quarter, with a hair of hand-set
   wobble), or level in the ground. Its text frame is turned into that
   direction and line bands are tried at four offsets. Each band's width is
   the frame's span at the top and bottom of the glyph band (exact for a
   convex stone), and `layoutNextLineRange` fills it. A word too long for a
   stone is set smaller on that line (down to 70%) or the band stays empty.
   Long words get canvas-only soft hyphens. The reading order runs along
   each row, stone to stone, and the rows go from the top of the picture
   down.
6. **Drawing.** There is one colour layer per layout, plus a grey copy
   (through a canvas `grayscale` filter) until the floor is laid. Each
   stone's words are set in its own turned frame. Sizes sit on a
   quarter-pixel grid and stones are drawn grouped by size, so setting the
   fonts stays cheap. Layout yields to the page between stages: about 1s
   in all for 2,100 stones on a desktop, no slice above about 110ms.

## Theming

| variable      | default                  | used for |
|---------------|--------------------------|----------|
| `--paper`     | `#f3f0e8`                | the grout, the words on dark stones, the face of a lifted stone |
| `--ink`       | `#141312`                | via the `<p>`'s `color`: the words on pale stones and the reading ink of a lifted one |
| `--accent`    | `#c96f4a`                | the focus ring |
| `--tes-serif` | `var(--serif)`           | the `<p>`'s face (no-JS and screen readers); the canvas uses `data-font` if given |
| `--gutter`    | `clamp(16px, 3vw, 32px)` | side padding |

## Tuning

- **Pictures.** At 600-2,000 stones a painterly, many-coloured photograph
  turns to noise. Bold flat designs survive: Ostia's black-and-white floors,
  Iznik tiles, carpets, a geometric border. Crop to the figure: the phone gets
  one figure, not the whole floor. Squint test: shrink a screenshot to 25%.
- **Andamento.** `rows="1"` gives a single outline row and a lot of straight
  ground, which is calmer. `rows="3"` gives the swirling, vermiculatum look.
  `lines` and `grain` set the stone size; the type sets the reading.
- **The build.** `LAY`, `PRESS`, `WET` and `BLOOM` set the feel, about two
  seconds in all. The order is outline rows first, then the ground, spreading
  from the middle of the figures with a little hand jitter.
- **The lift.** A lifted stone comes up until its type is about 10.5px (up
  to 2.3x for the smallest), on a critically damped spring, with a shadow and
  a darker hollow left behind. A raised stone keeps the pointer until it
  leaves the stone's raised outline.

## Accessibility and motion

- The real `<p>` stays in the DOM, visually hidden once the canvas is live:
  read aloud, found by find, printed. The canvas is `aria-hidden`. Without
  JS, or if the picture or pretext fails, the paragraph is a plain column.
- The mosaic is focusable (`role="group"`, `aria-roledescription="mosaic"`).
  Arrow keys lift one stone at a time in reading order (Home and End jump,
  Esc sets it down). Each lifted stone's words are read out through a polite
  live region. The focus ring is visible.
- Phone: tap a stone to lift it, then tap it again or anywhere else to set it
  down. Drags are the page's: it scrolls and pinch-zooms over the mosaic
  (`touch-action: manipulation`).
- Reduced motion: no build. The finished mosaic is there from the start.
  Lifting still works and is instant.
- The rAF loop runs only while stones are being laid or a lift is moving,
  and only on screen. Canvas DPR is 3 on phones and 2 above about 2.8M
  pixels. The grey layer is freed once the floor is laid.

## Credits

- [pretext](https://github.com/chenglou/pretext) by Cheng Lou, MIT
  (`vendor/pretext`, unmodified, see its `LICENSE` and `VERSION`).
- Neptune mosaic, Baths of Neptune, Ostia (2nd century AD), photograph by
  Justin Benttinen, CC BY-SA 4.0, via Wikimedia Commons; cropped and
  resized.
- Iznik tile panel (Cinquantenaire Museum, Brussels), photograph by Daderot,
  public domain, via Wikimedia Commons; cropped and resized.
- See `assets/credits.json`.
