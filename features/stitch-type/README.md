# stitch-type

A heading sewn in silk on linen. The text is rasterised offscreen and turned
into real embroidery: satin stitches laid edge to edge across every stroke at a
slant, a fine split-stitch outline round each glyph, a dark padding beneath.
Each stitch is shaded as silk floss, so its sheen depends on which way it runs
against the light. The light follows the pointer, the phone's tilt and the
scroll, so strokes running different ways glint in turn. Scrolling it into view
sews it: glyph by glyph, outline then fill, with a steel needle and a loop of
trailing thread. At the end the needle goes down through the cloth and leaves
the finished work.

```html
<link rel="stylesheet" href="stitch-type.css">
<section class="st" data-stitch-type data-thread="#8f1d22">
  <h1 class="st-text">Hand made</h1>
</section>
<script type="module" src="stitch-type.js"></script>
```

Or `import { stitchType } from './stitch-type.js'` and call
`stitchType(section, { thread, outline, angle, density, duration, transfer })`.
It returns `destroy()`.

The section is the cloth and the heading is laid out by CSS as usual: any
loaded font, size, weight, italic, wrapping or nested `<em>`. The stitches land
exactly where the glyphs are. Optional: put
`<script>document.documentElement.classList.add('st-js')</script>` in `<head>`
so the ink stays hidden while the stitches are prepared, instead of showing for
a moment and then vanishing. If the script never runs, the ink comes back by
itself after 3s.

## Options

| attribute | default | |
|---|---|---|
| `data-thread` | `#8f1d22` | Silk colour. A list (`"#b5832e, #ecd08a, #8f6420"`) is a variegated thread that drifts through the colours in sewing order. |
| `data-outline` | thread, deeper | Colour of the split-stitch outline. |
| `data-angle` | `24` | Satin slant in degrees, measured off square-across the stroke. `0` is straight across. Negative leans the other way. |
| `data-density` | `1` | Stitches per stroke. `1.5` gives finer silk, `0.7` coarser. Spacing is relative to the font size, so the look holds at any size. |
| `data-duration` | auto (2.1–3.3s) | Seconds to sew the whole heading. |
| `data-transfer` | `#5d6f93` | The transfer line traced on the cloth before sewing (water-soluble blue on pale cloth, chalk white such as `#ece6d6` on dark). It washes out when the work is done. |

## Theming

| variable | default | |
|---|---|---|
| `--st-ground` | `url(assets/linen.webp)` | The cloth texture. |
| `--st-ground-size` | `512px 512px` | Tile size. The tile is 1536px, so it stays sharp at DPR 3. |
| `--st-cloth` | `#cdbfa6` | Cloth colour under or with the texture. |
| `--st-blend` | `normal` | `multiply` dyes the linen with `--st-cloth`, e.g. `--st-cloth:#2a3550` gives indigo linen. |
| `--st-font`, `--st-weight`, `--st-style`, `--st-size`, `--st-leading`, `--st-tracking` | Cormorant 700 | The heading type. |
| `--st-ink` | `--ink` | The heading colour without JS. |
| `--st-pad` | `clamp(56px,12vw,160px)` | Space round the heading. |

## How it works

1. **Mask.** Each word is drawn with `fillText` at the position the browser
   gave it (`Range.getClientRects`), at about 170 mask pixels per em.
2. **Direction field.** A Felzenszwalb distance transform gives each inside
   pixel its distance to the edge. The gradient points across the stroke. It
   is smoothed as an orientation tensor (doubled angle), so the two sides of a
   stroke agree and the direction turns smoothly through bowls and junctions,
   then rotated by the slant.
3. **Satin.** Dense candidate points cast chords edge to edge along the field.
   A chord is kept only if it sits a spacing away from similar chords already
   laid and crosses none. A second pass fills what is still bare with short
   stitches that follow their neighbours, the way real fans are filled. Very
   long chords are split long-and-short.
4. **Outline and transfer.** Marching squares give sub-pixel contours. Short
   overlapping stitches run along them, each coming up through the last, which
   makes the split stitch.
5. **Sewing order.** Glyphs go in reading order. Within each glyph the satin
   is a nearest-neighbour chain, so the needle travels along the strokes, and
   each stitch comes up on the same side as the one before.
6. **Render.** WebGL2 draws one instanced capsule per stitch, at device
   resolution with analytic edges, so it is sharp at any DPR. The silk is a
   flattened round cross-section with a raised arch and fine fibres, lit by a
   two-lobe Kajiya-Kay sheen (white primary, tinted secondary). The outline is
   twisted two-ply. Shadows are cast away from the lamp by height. Padding is
   one textured quad. Static stitches are uploaded once and each frame only
   changes uniforms, plus about 20 instances for the needle and thread.

A heading of two words is about 1,600 stitches. It builds in about 100–130ms
on a laptop and is re-laid only when the width changes.

## Tuning notes

- Bold, rounded or soft serifs sew best. Hairlines thinner than a thread are
  carried by the outline alone, which is also what embroiderers do. Very wide
  strokes (black weights) get long-and-short splits.
- On dark cloth, lift the thread colours a little. Silk reads darker than its
  hex.
- The canvas DPR cap is **3**, not the house 2, because the brief is to be
  sharp at DPR 3. Pixel count is guarded at 14M, and the canvas falls back
  toward DPR 2 for very large sections.

## Behaviour and accessibility

- The real heading stays in the DOM and is read aloud and selectable. Once
  live its ink is transparent and the canvas is `aria-hidden`.
- Without JS, or if nothing can render, it is a normal heading in ink on
  linen.
- Without WebGL2, a 2D canvas draws the same stitches more simply (two-tone
  strokes with a per-stitch sheen, no needle). If the WebGL context is lost,
  it switches to the 2D canvas.
- **Reduced motion**: the finished embroidery, still. The sheen still follows
  the pointer, since that is direct manipulation.
- Phone: tilt moves the lamp (via `tilt.js`; iOS asks on first tap). A
  horizontal drag over the cloth moves it too. Scrolling slides the lamp
  everywhere.
- rAF runs only while sewing, while the light is still settling, or while tilt
  is live and the piece is on screen. Otherwise it stops.

## Credits

No libraries. `tilt.js` is the house helper. Images are from Wikimedia
Commons (the Bayeux Tapestry band in the demo, public domain), see
`assets/credits.json`. The linen texture is procedural, made for this
component.
