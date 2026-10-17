# scroll-stage

A very small Theatre.js for scroll. A section becomes a tall runway with a
pinned stage inside it, and how far you have scrolled through the runway is the
playhead. Each layer declares its own keyframes in a data attribute; every
property is its own track, eased and interpolated across units, and the whole
stage is written in one rAF pass. Press <kbd>`</kbd> for a timeline you can scrub.

The demo is a toy theatre: velvet curtains part on Hokusai's and Hiroshige's
seas, printed in ink at first. The colour blooms mid-scene, the moon rises,
night falls, and the curtains close.

```html
<link rel="stylesheet" href="scroll-stage.css">
<section data-scroll-stage data-length="600svh" data-still=".6">
  <div class="ss-stage">
    <img src="wave.webp" alt="" data-name="wave"
         data-keys='{"0":{"y":"40%","gray":1}, ".45":{"y":"0%","gray":1,"ease":"out"}, ".6":{"gray":0}}'
         data-keys-sm='{"0":{"y":"30%"}, ".45":{"y":"0%","ease":"out"}}'>
  </div>
</section>
<script type="module" src="scroll-stage.js"></script>
```

Or call `scrollStage(section, opts)` yourself. It returns `destroy()`.
`toggleTimeline(true)` opens the panel from code.

## Keyframes

`data-keys` is JSON: time (0 to 1, or `"35%"`) mapped to the values at that
moment. A key names only what changes. Each property's track is built from the
keys that mention it, so `x` can travel from 0.2 to 0.9 while `r` rocks on keys
of its own in between.

| prop | what | bare number means |
|---|---|---|
| `x` `y` | translate | px. Anything CSS takes: `vw`, `%` (of the layer), `rem`… |
| `s` `sx` `sy` | scale, uniform and per axis | |
| `r` | rotate | deg |
| `o` | opacity | |
| `blur` | filter blur | px |
| `gray` | filter grayscale, 0 to 1 | |
| `clip` | any `clip-path` (`inset()`, `circle()`, `polygon()`) | keep the same shape and point count on both sides |
| `--name` | a custom property written on the layer, for your own CSS | |

- **Mixed units** interpolate through `calc()`, so `"-30vw"` to `"50%"` works.
  A bare `0` takes its neighbour's unit.
- **Easing**: `"ease"` on a key shapes the segment that *arrives* at it:
  `linear` `in` `out` `inOut` (cubic), `inQuad` `outQuad` `inOutQuad`,
  `inSine` `outSine` `inOutSine`, `inExpo` `outExpo` `inOutExpo`, `hold`, the
  CSS keywords, or `"cubic-bezier(.2,.7,.2,1)"`. Per property: `"x":["0","out"]`.
- **Before the first key / after the last** a track holds its end value.
- **Phone variant**: `data-keys-sm` is laid over `data-keys` while the `sm`
  media query holds. A key at the same time replaces that property's value
  there, and any other key is added. So a phone variant only says what differs,
  usually a start or end `x`/`y`.
- JSON wants `0.5`, not `.5`. The parser forgives `.5` and trailing commas.
- Transform order is `translate rotate scale`. Set `transform-origin` in CSS.

## Options

On the section as `data-` attributes, or in the options object (which wins).

| option | default | |
|---|---|---|
| `length` | `500svh` | runway height (the CSS default, `--ss-length`) |
| `smooth` | `0.12` | seconds for the playhead to catch the scroll. `0` = raw |
| `still` | `0.5` | the moment drawn under reduced motion |
| `sm` | `(max-width: 699px)` | media query for `data-keys-sm` |
| `ease` | `inOut` | ease for keys that do not name one |
| `name` | id or "stage" | the title in the timeline |

Layers are named in the timeline by `data-name`, then id, then class.
`--ss-t` (0 to 1) is set on the section every frame for CSS that wants it.

## Timeline

Press <kbd>`</kbd>, or add `?timeline` to the URL. A panel along the bottom
shows the stage in view: one row per layer, a diamond per keyframe (filled once
passed; hover one for what it sets), the playhead, and the time to three
places. Press anywhere on the lanes and drag to scrub. It moves the page's
scroll, so what you see is exactly what a visitor scrolling there sees. It snaps
to keys within 6px, and clicking a diamond lands on it exactly. The playhead is
a focusable slider: arrows step 0.005 (Shift for 0.05), Home and End, and
<kbd>[</kbd> <kbd>]</kbd> jump to the previous and next key. <kbd>Esc</kbd> closes it.

## Stage dressing

`scroll-stage.css` also carries the theatre used in the demo, as plain classes
you can borrow: `.ss-proscenium` › `.ss-frame` (ink frame, gilt hairline) ›
`.ss-opening` (clips the scene), `.ss-curtain--l` / `--r` (velvet with 17
uneven folds and a fine nap; animate `sx` and the folds gather as they would),
`.ss-valance` + `.ss-fringe` (swags with gilt fringe, three on a phone).

## Theming

`--paper`, `--paper-2`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--accent`
(the playhead), `--sans`, `--gutter`, plus `--ss-velvet`, `--ss-velvet-2`,
`--ss-gilt`, `--ss-scene-paper`, `--ss-swag` (swag width, as a % of the stage).

## Tuning notes

- Give the stage a long runway (600 to 800svh). Slow scenes read as cinema,
  short ones read as a slideshow.
- The ship is an engraving with a hatched sky, so it is cut with a traced
  silhouette and a levels curve that turns the light hatching white, and saved
  as ink only (an alpha mask). The page paints it through `mask-image` with
  `background: var(--ink)`, and an `--ink` track turns it from ink-grey to
  Hokusai's Prussian blue as the colour arrives, so it reads as part of the
  print. The moon is a flat paper disc with a bokashi halo, in CSS.
- The demo prints are cut from their sky with a flood fill from the top edge
  through sky-coloured pixels, so foam enclosed by the key-block lines stays
  opaque, and spray dots stay as dots. They overlap and occlude properly rather
  than relying on `mix-blend-mode`. Without JS they sit at their CSS positions
  in full colour, which is the composed still.
- Animating `gray` or `blur` repaints the layer every frame. Keep those
  segments short, as the demo's bloom does.

## Accessibility and reduced motion

The layers are decoration (`alt=""`, `aria-hidden`). Under
`prefers-reduced-motion` there is no runway and no pinning. The stage is drawn
once at `still` as a single composed picture, and the timeline can still scrub
it by hand. Without JS the section is one screen tall with the layers where the
CSS puts them. The timeline is a labelled region with a real slider and a close
button.

## Credits

The idea of keyframed tracks and a scrubbable sequence editor is from
[Theatre.js](https://www.theatrejs.com/). No code from it is used. Images are
from Wikimedia Commons: Katsushika Hokusai's *The Great Wave off Kanagawa*,
Utagawa Hiroshige's *The Sea at Satta*, and a wood engraving of the frigate
USS Sabine from *Harper's Weekly* (1861), all public domain. See
`assets/credits.json`.
