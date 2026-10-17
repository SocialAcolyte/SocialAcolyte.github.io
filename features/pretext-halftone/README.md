# pretext-halftone

A portrait made of nothing but a paragraph. The text is set as a justified
block the shape of the picture, and every letter takes its own weight on a
variable font's `wght` axis from the picture underneath: hairlines where it is
light, black where it is dark. There is one ink and no dots, so the face comes
from density alone. It starts as a plain grey paragraph. As you scroll, the
weights flow toward the portrait from the middle outward, and a face condenses
out of the page. A pointer or a finger is a lamp with a reading glass in it.
Around the lamp the face dissolves back into plain text, and at its centre the
words are magnified enough to read, even at phone size.

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,100..900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="pretext-halftone.css">
<section data-pretext-halftone data-src="assets/eutyches.webp"
         data-crop="0 0 1 0.83" data-crop-tall="0.07 0 0.93 1"
         data-focus="0.55 0.47" data-gamma="1.35" data-local="0.25">
  <div class="ph-stage">
    <p class="ph-text">They painted him while he was alive, most likely…</p>
  </div>
</section>
<script type="module" src="pretext-halftone.js"></script>
```

Or `import { pretextHalftone } from './pretext-halftone.js'` and call
`pretextHalftone(section, { src, morph, lines, … })`. It returns `destroy()`.

**It needs a variable font with a wide weight range.** The canvas uses the
`<p>`'s font family (or `data-font`). The demo loads Fraunces (100-900, with an
optical-size axis). With a static fallback such as Georgia there are only two
weights, and no portrait appears.

## Options

| attribute       | option     | default     | what it does |
|-----------------|------------|-------------|--------------|
| `data-src`      | `src`      | required    | The picture, from the same origin. It is never shown; it only decides how dark each letter is. The block takes its aspect ratio. |
| `data-morph`    | `morph`    | `scroll`    | `scroll`: a tall runway with a pinned stage, and the face condenses as you scroll. `view`: plays once (over `data-duration` ms, default 2600) when a third of it is on screen. `static`: already composed. |
| `data-focus`    | `focus`    | `0.5 0.42`  | Where the face condenses from, as fractions of the block (usually between the eyes). |
| `data-crop`     | `crop`     | `0 0 1 1`   | The part of the picture to use: `x0 y0 x1 y1` as fractions. It sets the block's aspect ratio. |
| `data-crop-tall`| `cropTall` | `data-crop` | A crop for tall stages (phones, where the stage is more than 1.3 times as tall as it is wide). The demo uses a wide head-and-shoulders crop on desktop, so the portrait fills most of the screen, and a narrower, taller one on phones. |
| `data-lines`    | `lines`    | auto        | Lines in the block. Fine grain is what makes a face. Auto is type of about 5.6px with at least 110 lines. The type size follows from this and has a floor of 4px. |
| `data-size`     | `size`     | none        | A fixed type size in px, instead of `lines`. |
| `data-font`     | `font`     | the `<p>`'s | The canvas font family. |
| `data-weights`  | `weights`  | `100 900`   | The ends of the wght axis to use. |
| `data-read`     | `read`     | `400`       | The reading weight: the plain paragraph before the scroll, and the text under the lamp. |
| `data-fade`     | `fade`     | `0.34`      | Ink fade below 100: the lightest tones keep the hairline but print it in a thinner ink, down to this fraction of full ink, so highlights (forehead, cheeks, the tunic) read as light planes. It is the same hue, only lighter. Under the lamp everything returns to full ink. `1` turns it off. |
| `data-gain`     | `gain`     | `0.18`      | Ink gain past 900, in em of stroke. This makes the deepest blacks: the black weight is spread like over-inked letterpress. `0` turns it off. |
| `data-opsz`     | `opsz`     | `48`        | The optical size the type is drawn at (it is drawn large and scaled down). A display size gives true hairlines at 100 and a fat black at 900, which roughly doubles the tone range compared with text-size optics. |
| `data-levels`   | `levels`   | `0.28 0.86` | The tone map's black and white points, after the contrast stretch. Anything lighter than the first value becomes hairline; anything darker than the second becomes solid ink. |
| `data-gamma`    | `gamma`    | `1`         | Above 1 lightens the mid tones; below 1 darkens them. |
| `data-local`    | `local`    | `0.3`       | Local contrast. Large-scale shading is pulled down so that eyes, brows and the line of the mouth keep their strength. |
| `data-lamp`     | `lamp`     | `auto`      | Lamp radius in px (`auto` is about a third of the block width). |
| `data-magnify`  | `magnify`  | `auto`      | Magnification of the reading glass. `auto` brings the type to about 11px; `1` gives a lamp with no glass. |

## How it works

1. **Tone map.** The picture is drawn at half a CSS pixel per sample and
   turned into darkness. It is contrast-stretched (1st to 99th percentile),
   given some local contrast, lightly blurred to about a line's height, passed
   through the levels with a gentle S-curve, then stored as a summed-area
   table so that any letter's cell averages in four reads.
2. **Ink calibration.** A sample line is set at nine weights, plus four
   ink-fade steps below them and four ink-gain steps above, on a scratch
   canvas, and its ink coverage is measured. That makes one virtual axis
   from a pale hairline (about 3.5% ink) to over-inked black (about 60%). The
   inverse of that curve turns darkness into weight, so the mid tones are even
   and not crushed into the heavy half of the axis.
3. **Layout with pretext.** The text, repeated after an interpunct as often as
   the block needs, is prepared by pretext at the nine weights. Every segment's
   width is then rebuilt from its own letters at their own weights, and
   pretext's `layoutNextLineRange` breaks the block. The picture is sampled
   under every letter and the weights are updated. This repeats until no
   weight moves by more than 30 units (two to four passes); the last pass is
   capped so that no letter outgrows its box.
4. **Boxes that never move.** Each letter's box is as wide as the letter at
   the wider of its reading weight and its portrait weight. Lines are
   justified from those boxes once. During the morph, and under the lamp, a
   word changes weight inside its box, with a whisper of letter-spacing and
   the rest as space around it, so the paragraph never reflows.
5. **Drawing.** Each frame the weights are computed per letter (the
   staggered morph, the lamp's pull), bucketed, and drawn with one font switch
   per bucket. When only the lamp moves, just the square around it is
   repainted; that square is snapped to whole device pixels so its clip
   never leaves a seam. A test confirmed that once the lamp has dimmed, the
   canvas matches a fresh full repaint pixel for pixel. The reading glass is a small offscreen canvas. It holds the
   words near the lamp at the reading weight, magnified, on a disc of lamp
   light with a soft round edge.

## Theming

| variable      | default                  | used for |
|---------------|--------------------------|----------|
| `--paper`     | `#f3f0e8`                | background |
| `--ink`       | `#141312`                | the ink. The canvas copies `.ph-text`'s `color`, so one ink per instance. The demo's wave uses a deep Prussian `#18233a`. |
| `--ph-serif`  | `"Fraunces", Georgia, serif` | the face, through `.ph-text`'s font family |
| `--ph-lamp`   | `255, 252, 243`          | the lamp's light (an `r, g, b` triple), a shade above the paper |
| `--ph-runway` | `260svh`                 | length of the scroll runway |
| `--gutter`    | `clamp(16px, 3vw, 32px)` | side padding of the stage |

## Tuning

- **The squint test is the whole game.** Shrink a screenshot to 25%: hair,
  eyes, nose shadow and mouth should read before you see any text. Two
  settings matter most. `lines` (more is finer; 100-130 suits a face) and
  `levels` (push the background into hairlines, and keep the mid tones
  light so the features stand out). The demo's portrait uses `gamma 1.35`
  and `local 0.25`. Too much local contrast draws halos around the eyes,
  and they start to read as spectacles.
- **Pick strong, frontal sources.** A light background, dark hair and large
  dark eyes give the best results. Fayum portraits are ideal. Don't let a
  museum-black surround into the crop, or it turns into a slab of ink. The
  demo's asset has its chipped corners filled with the panel's own ground
  colour.
- **Text.** Write 400-900 words. The block loops it, so on a 120-line block a
  700-word text comes round about two and a half times. The real `<p>` holds
  it once.
- **Gain.** At 0.18em the darkest passages become smeared, over-inked
  letterpress: illegible blobs, but true black. Lower it if the hair should
  stay readable up close.
- **Cost.** A full repaint is about 15,000 `fillText` calls on a phone-sized
  block (about 12ms on a desktop Mac). Full repaints happen only while the
  morph is moving. A layout (load and resize) takes about 150ms on a desktop.

## Accessibility and motion

- The real `<p>` stays in the DOM and is visually hidden once the canvas is
  live, so it is still read aloud, found by find-in-page and printed. The
  canvas is `aria-hidden`.
- Without JS, or if the image, the font or pretext fails to load, the
  paragraph is a plain justified column.
- Reduced motion: no runway. The portrait is shown already composed and still.
  The lamp still works (it is direct manipulation) but follows instantly.
- Phone: touch to light the lamp; it sits a little above your finger so you
  can read the glass. A sideways slide carries it, and a vertical drag
  scrolls the page as usual. To carry the lamp anywhere, hold still for a
  moment first: the page then stays put under your finger until you lift.
  After you lift, the lamp lingers briefly and then dims.
- The lamp is pointer-only. It is decoration over text that is already in the
  DOM, so it has no keyboard equivalent.
- The rAF loop runs only while the morph or the lamp is moving and the piece
  is on screen. The canvas goes up to DPR 3, or 2 on very large blocks.

## Credits

- [pretext](https://github.com/chenglou/pretext) by Cheng Lou, MIT
  (`vendor/pretext`, unmodified; see its `LICENSE` and `VERSION`).
- Fraunces by Undercase Type, SIL Open Font License, via Google Fonts.
- *Portrait of the Boy Eutyches* (100-150 CE), The Metropolitan Museum of Art
  Open Access, CC0. *The Great Wave off Kanagawa*, after Hokusai, public
  domain, via Wikimedia Commons. See `assets/credits.json`.
