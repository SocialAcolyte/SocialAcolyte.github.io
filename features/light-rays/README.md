# light-rays

Sunlight falling on the page, meant to pass for the real thing: a warm,
washed-out patch in the shape of the window it came through, crisp at the sill
and soft at its far end, with ink lifted to grey inside it and the room's shade
outside. A cloud passes now and then, the branch outside the window stirs, and
dust drifts through the beam. Presets give a sash window, a Roman arched
window, a carved jali screen, and dappled light through leaves. On `<body>` the
light lies on the screen itself and the page scrolls underneath it.

```html
<link rel="stylesheet" href="light-rays.css">

<!-- on the screen: the page scrolls under the light (fades out when the article leaves) -->
<article data-light-rays data-attach="viewport" data-preset="window" data-branch="olive" data-drift=".6">
  …
</article>

<!-- on one section: the light belongs to it and scrolls with it -->
<section data-light-rays data-preset="lattice" data-sun="-40 32">…</section>
<section data-light-rays data-preset="leaves">…</section>

<script type="module" src="light-rays.js"></script>
```

Or call it yourself:

```js
import { lightRays } from './light-rays.js';
const light = lightRays(el, { preset: 'arch', warmth: .8 });
light.set({ clouds: .9, sun: [-50, 22] });   // live: sun, weather and colour are cheap
light.state;                                  // { running, visible, presence, motes, preset }
light();                                      // destroy: canvas, listeners, loop
```

The canvas never takes input (`pointer-events: none`). Without JS there is no
sun, and the page is untouched.

## Options

On the element (`data-*`) or in the options object, which wins.

| attribute | option | default | |
|---|---|---|---|
| `data-preset` | `preset` | `window` | `window` (four-pane sash), `arch` (Roman arched window with a fanlight), `lattice` (a jali: 8-fold star screen in a pointed arch), `leaves` (komorebi) |
| `data-aperture` | `aperture` | | URL of a mask image used as the window: alpha if it has any, otherwise light = open. Same origin (WebGL refuses cross-origin images) |
| `data-sun` | `sun` | `-58 34` wide, `-30 38` tall (`leaves`: `-50 52`) | azimuth and elevation in degrees. Azimuth is on the screen: 0 = light from the top, -90 = from the left. Elevation is above the page; lower is longer |
| `data-at` | `at` | `.56 .5` | where the middle of the patch lands, as fractions of the area |
| `data-size` | `size` | `1` | scales the window and its patch |
| `data-panes` | `panes` | `2x2` | columns x rows for `window`, up to `4x4` |
| `data-softness` | `softness` | `2.2` | penumbra. `1` is the bare 0.53° disc of the sun; the default adds the bright aureole round it. The jali uses 0.6 of it (it stands closer to the floor) |
| `data-clouds` | `clouds` | `.4` | 0-1. A slow breath of a few percent, and now and then a cloud that dims the light by 30-60% over five to ten seconds and softens every edge while it passes. The first comes 6-10 s in |
| `data-wind` | `wind` | `.5` | 0-1. Sways the leaves and the branch, in gusts that travel across the canopy |
| `data-warmth` | `warmth` | `.6` | 0-1, colour temperature from 5900 K (noon) to 3300 K (late afternoon) |
| `data-golden` | `golden` | off | golden hour: the sun 12° lower (a longer patch), 2450 K, a little more haze |
| `data-intensity` | `intensity` | `1` | scales the light |
| `data-shade` | `shade` | `.03` | 0-1, the room's shade outside the beam: a faint, slightly cool multiply that keeps the paper's colour (four times deeper, and even, under leaves) |
| `data-haze` | `haze` | `.35` | 0-1, shafts in the air above the page |
| `data-motes` | `motes` | `.5` | 0-1, dust in the beam; `0` = none (and a cheaper loop) |
| `data-branch` | `branch` | none | `olive` or `twig`: a branch outside the window, swaying (not for `leaves`) |
| `data-drift` | `drift` | `0` | 0-1. The sun moves on as you scroll through the host, like time passing as you read: the patch swings and lengthens |
| `data-static` | `static` | off | a frozen beam: one frame, no loop, no motes |
| `data-attach` | `attach` | `viewport` on `<body>`, else `element` | `viewport`: fixed to the screen, fading out as the host leaves it and giving way to any element-attached light that fills the screen. `element`: covers the element and scrolls with it |
| `data-seed` | `seed` | `7` | the branch drawing, the canopy and the dust |

## Theming

The light has no colours to theme beyond `warmth` and `golden`: it is
sunlight. It adapts to the page under it: on a dark background (read from the
host's or body's computed `background-color`) the light is softer and the
shade almost nil, so it becomes a warm glow.

| variable | default | |
|---|---|---|
| `--lr-z` | `3` (element), `2147483000` (viewport) | z-index of the canvases. The viewport light lies over everything, fixed UI included, as real sun does |

## How it works

- **Two layers, one context.** Each frame the shader runs twice: a multiply
  pass (the room's faint shade, and where the sun falls the warm filter of its
  colour, so paper turns cream-gold rather than white) is copied to a 2D canvas
  blended `multiply`; then the screen pass (the light, through a filmic shoulder
  `1 - e^-1.3x`, plus halation: 16 taps of the light map 7 and 20 px out, so
  bright edges bleed a little as glare does in an eye or a lens) stays in the
  WebGL canvas, blended `screen`. Lit ink lifts to a warm grey, pictures go
  warmer and lower in contrast but keep their texture, and shadow bars return to
  exactly the ambient level. Blends compared on the way: a single hard-light
  layer read but greyed the whole page; plain screen barely shows on near-white
  paper; soft-light hardly lifts the ink; plus-lighter blows out like an
  overexposed photo.
- **The window is in a wall.** A page point maps back (an affine inverse) to
  the aperture point `(u, v)` its ray came through, `v` being the height up the
  wall. The ray's length is `v / sin(elevation)`, and the sun's 0.53° disc seen
  from the page covers a disc of radius `length × 0.0093 / 2` on the aperture.
  The light is the share of that disc that is open.
- **Analytic penumbra (window, arch).** For a straight edge that share is the
  chord area of a disc, `G(s) = ½ + (s√(1-s²) + asin s) / π`. A grid of panes is
  separable: `Σ G-spans across × Σ G-spans up`. So the sill is razor sharp, the
  far end is soft, and a thin glazing bar's shadow thins to a grey seam and
  vanishes once the penumbra is wider than the bar, while the heavier meeting
  rail holds on longer. The arch uses the same function on a signed distance
  (rect + half-disc) with strips for the mullion, transom, rail, hub and spokes.
- **Blur stacks (lattice, mask, branch).** The jali (Hankin's method on the
  4.8.8 tiling, ribs cut at 10.5% of the period, one seamless 256² tile) and the
  branch are drawn once, crisp, then blurred by discs of growing radius (96-tap
  Vogel spiral, each level from the last), packed four levels to an RGBA
  texture. Each pixel reads the level its own penumbra needs, plus half a pixel
  of footprint so nothing aliases. Near stars are stars; far ones round off
  into pinhole images of the sun.
- **Branch.** It hangs outside the window, a third of the window's height
  beyond the glass, so its shadow is softer than the bars' and slides against
  them as the sun moves. It bends from where it is held (tips swing furthest,
  `angle × (dist / 1.2)^1.5`) and the leaves tremble.
- **Leaves.** Every gap in the canopy is a pinhole that throws an image of the
  sun: an ellipse stretched by `1 / sin(elevation)` along the light, with a
  darkened limb like the sun's own. Gaps cluster where a noise field says the
  canopy is thin, with a finer lace of single leaves inside; most are partly
  covered by a leaf, so brightness runs from faint to full. They are drawn as
  quads multiplied into a darkness map, so overlaps add light and saturate. Gusts
  travel across the canopy as a wave; each spray lags and overshoots; leaves
  crossing a gap blink it shut.
- **Shafts.** The air above a point is lit where the beam crosses it, which is
  the patch seen from a little further toward the sun. The shader averages a
  quarter-resolution copy of the light (with a margin past the edges) along that
  line, 14 jittered taps, thinner toward the top of the slab.
- **Dust.** A few hundred motes in a slab of air (30% of the diagonal deep)
  drift on a divergence-free current (the curl of drifting sines), rise a little,
  and jostle (Brownian kicks). Each is lit only where its own ray reaches the
  page through the opening, glints as it tumbles, and grows soft and dim the
  nearer it is to the eye. Like real dust they show against dark ink and images
  and almost vanish on bright paper.
- **Clouds** dim the light, cool it slightly (+900 K) and widen every penumbra
  (the sun's disc swells into haze). **Matte grain**: a fine, still 7% grain
  inside the light, the screen's own anti-glare surface catching the sun.

## Tuning

- `SHAPE` at the top of the script sets each preset's patch length and width as
  fractions of the area's diagonal; phones get a slightly smaller patch so the
  panes still read. `SKEW` (22°) is how far the wall stands off square to the
  light: the lean of the parallelogram.
- The jali's star count is `jP` in `layoutRoom` (4.6 periods across); the rib
  width is `lineWidth` in `drawJali`. Thicker ribs give smaller, crisper stars.
- Canopy: `R0` (sun-image radius, about 1% of the diagonal), the cluster scale
  `fs`, and the keep rule in `makeCanopy`.
- Strength: `sunColour()` (0.56 on light pages, 0.42 on dark; the colour is
  raised to the power 1.5 so the lift reads gold), `goldRGB()` (the warm filter),
  `shadeRGB()`, `uBloom` and the haze factor in `render()`.

## Cost

- About 30 fps while anything moves (clouds, wind with leaves or a branch),
  60 while dust is drifting. Nothing runs off screen, in a hidden tab, or once a
  viewport light has faded out; with `data-static`, reduced motion, or `clouds`,
  `wind` and `motes` at 0 it draws once and stops.
- DPR capped at 2, and lower for very large hosts (4.6 Mpx a frame at most).
  The shaft map is a quarter resolution; the leaves map is about one texel per
  css px (capped at 3.2 Mpx).
- The multiply layer costs one canvas-to-canvas copy a frame.
- Without WebGL a single 2D canvas (blended hard-light) draws a still, softened
  patch (no shafts, no dust).
  If the GPU drops the context the light goes out and comes back with it.

## Accessibility and reduced motion

- The canvas is `aria-hidden`, has `pointer-events: none`, and never blocks
  input, selection or scrolling. Nothing is focusable.
- `prefers-reduced-motion: reduce`: one still frame, with the leaves frozen
  mid-sway, no dust, no clouds, no scroll drift. A viewport light still gives
  way to the next section, but without a fade.
- Text in the patch keeps its contrast to a degree (ink lifts to a mid grey at
  most); keep `intensity` near 1 for running text.
- Print hides the light.

## Credits

- Hammershøi, *Moonlight, Strandgade 30* and Vermeer, *Young Woman with a
  Water Pitcher*: The Metropolitan Museum of Art, Open Access (CC0). *The Hunt
  of the Unicorn*, tapestry 1: public domain, via Wikimedia Commons. Details in
  `assets/credits.json`.
- Colour temperature after Tanner Helland's blackbody fit. Hankin's method for
  the star pattern after E. H. Hankin (1925) and Craig Kaplan's writing on it.
  No third-party code.
