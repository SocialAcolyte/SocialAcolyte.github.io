# ink-pad

A signature field, or a page of margin notes, that writes like a pointed dip
pen on good paper. Downstrokes swell and upstrokes run to a hairline; ink
pools where the nib touches down, lifts slowly or rests, and keeps spreading
while you hold still. Fresh ink is darker, cooler and glossy; each point dries
on its own clock over about two seconds, so a long stroke dries from where it
began toward the pen, and the pools dry last. Clear presses a blotter onto the
page and lifts the ink away. It is a real form control: required, validatable,
resettable, with a typed-name alternative for keyboards.

```html
<link rel="stylesheet" href="ink-pad.css">
<form>
  <div data-ink-pad data-name="signature" data-required>
    <input class="ip-fallback" name="signature" placeholder="Type your full name" required>
  </div>
  <button>Sign</button>
</form>
<script type="module" src="ink-pad.js"></script>
```

Without JS the fallback field is the control, so the form still works. With
JS it becomes the "Type instead" field, and the form gets the drawing as an
SVG string in an input named `data-name`.

Margin notes over a printed page: author the surface yourself and the image
inside it is the paper.

```html
<div data-ink-pad data-variant="margin" data-name="notes" style="--ip-ink:#6b2b1d;--ip-ink-wet:#8e2014">
  <div class="ip-surface"><img src="page.webp" alt=""></div>
</div>
```

Or `import { inkPad } from './ink-pad.js'` and call `inkPad(el, options)`. It
returns `destroy()`, which also carries `.undo()`, `.redo()`, `.clear(instant)`,
`.toSVG()`, `.toPNG()` and `.isEmpty()`.

## Options

| data- attribute   | option     | default                     | |
|-------------------|------------|-----------------------------|---|
| `data-name`       | `name`     | the fallback input's name   | name of the input that receives the SVG |
| `data-png-name`   | `pngName`  | none                        | also write a PNG data URL (transparent, 2x) to a hidden input of this name |
| `data-required`   | `required` | off                         | an empty pad blocks submit, marks the line and takes focus |
| `data-variant`    | `variant`  | `signature`                 | `signature` (baseline and ×) or `margin` (no furniture, finer nib, no typed mode) |
| `data-size`       | `size`     | `4` (margin `2.8`)          | nib size: hairlines are ~0.15x, full downstrokes ~1.2x |
| `data-dry`        | `dry`      | `2000`                      | ms for ink to dry; pools take up to twice as long |
| `data-typed`      | `typed`    | on for signature            | `false` removes the "Type instead" alternative |
| `data-mode`       | `mode`     | `auto`                      | `annotate`: on touch screens a pen switch decides whether a finger writes or scrolls. `auto` does that only when the pad is taller than 55% of the viewport. `draw`: a finger always writes |
| `data-label`      | `label`    | `Signature` / `Margin notes`| accessible name of the pad |
| `data-ink`        | `ink`      | `--ip-ink`                  | dry ink colour |
| `data-wet`        | `wet`      | `--ip-ink-wet`              | wet ink colour |

Events: the value input fires `input` and `change` (both bubble, so a form
listener sees them) after every stroke, undo, redo and clear; typing fires
`input` per letter and `change` when the field commits. Form `reset` clears
the pad.

## Theming

| variable           | default            | |
|--------------------|--------------------|---|
| `--ip-ink`         | `#1a1714`          | dry ink, a warm near-black |
| `--ip-ink-wet`     | derived from ink   | fresh ink; the default is a deeper blue-black, as iron-gall goes on |
| `--ip-sheen`       | `#fffaf0`          | the highlight on wet ink |
| `--ip-paper`       | transparent        | background of the surface (a paper texture works well) |
| `--ip-line-y`      | `70%`              | where the baseline sits |
| `--ip-rule`        | `--ink-3`          | baseline colour |
| `--ip-blotter`     | `#ead8cd`          | blotting-paper colour |
| `--ip-blotter-image` | none             | blotter texture, multiplied over the colour |
| `--ip-script`      | `"Mrs Saint Delafield", cursive` | face for typed signatures (load it yourself) |

Also uses the house `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--accent`,
`--serif`, `--sans`. The signature surface is `aspect-ratio: 2/1` on phones and
`3/1` from 640px; set your own on `.ip-surface`.

## Tuning notes

- Pressure. A pointed nib's weight is about direction: the tines spread only
  when pulled down along the slant (`NIB`, down and a little left), so
  upstrokes and horizontals are hairlines and downstrokes swell. Fingers and
  mice get that from direction, trimmed a little by speed; a real pen's
  pressure is multiplied in. Contrast is `PF.thinning` and the `dirF` /
  `speedF` lines in `extend()`.
- Pools: `DWELL` (150ms within 1.4px before ink pools), the growth constant in
  `growPool()`, and `poolR()` for size.
- The sheen is drawn along the centre line, offset toward the light
  (`LIGHT`, upper left), strongest where the stroke's side faces the light.
- Only wet ink is redrawn each frame; dry strokes are baked once, oldest
  first. The loop stops when everything is dry or the pad is off screen.
- The SVG is the dry ink: one `<path>` per stroke (perfect-freehand's
  outline) plus a `<circle>` per pool, in a group at 0.93 opacity so overlaps
  don't double. A typed signature is a `<text>` in the script face; the font
  is not embedded, so ask for the PNG too if the image must be exact.
- Ink is stored relative to the pad width, so it scales with the pad.

## Touch, keyboard, accessibility

- One finger draws; the page doesn't scroll under it (`touch-action: none`).
  Two fingers scroll the page (a stroke only just begun is cancelled). Once a
  pen has been used, other touches are ignored as palm. Scrolling elsewhere is
  untouched.
- Big surfaces on touch screens (`data-mode="annotate"`, or taller than 55%
  of the viewport) don't trap the page. A nib button (`aria-pressed`) appears
  in the bar. Off: a finger scrolls, and a tap shows "Tap the pen to write"
  and nods the nib. On: one finger writes, the edge of the surface warms, and
  it turns itself off after 8s without a stroke or when scrolled mostly out of
  view. A stylus always writes; a mouse always draws.
- The pad is focusable, labelled and described. Enter or any letter switches
  to typing; Escape in the field goes back to drawing. Ctrl/Cmd+Z undoes and
  Shift+Ctrl/Cmd+Z redoes (when the pad has focus, or was the last thing
  touched). Undo also brings back a clear. Changes are announced politely.
- Validation: the value input is a real, visually hidden `<input>` with
  `required`, so `checkValidity()`, `reportValidity()` and submit all see it.
  When it is invalid the line and × turn accent, a short message appears and
  the pad takes focus.
- Reduced motion: ink lands dry, and Clear is instant. Drawing is unchanged.
- Decoration (line, ×, canvases, blotter) is `aria-hidden`.

## The demo

A letter of commission on laid paper (chain and laid lines are CSS gradients
over a fine paper tooth high-passed from a linen photograph), signed in iron-gall
ink; a valid submit presses a clay seal and locks the pad with `inert`. Below,
a naturalist's plate (one of two, picked per visit) shown in grey until your
first note in red-brown ink, when it blooms into colour (demo CSS on
`.has-ink`). The blotter is a handmade Büttenpapier scan, flattened and
mirrored into a seamless tile.

## Credits

- [perfect-freehand](https://github.com/steveruizok/perfect-freehand) by Steve
  Ruiz, MIT, in `vendor/perfect-freehand/`.
- Mrs Saint Delafield by Alejandro Paul (Sudtipos), SIL Open Font License, via
  Google Fonts (demo only).
- Images from Wikimedia Commons, see `assets/credits.json`.
