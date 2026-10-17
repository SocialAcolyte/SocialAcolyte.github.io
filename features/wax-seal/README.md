# wax-seal

A confirm button you press and hold to seal. At rest it is a quiet pill with a
small grey seal matrix (an ancient coin or intaglio) at its end. Hold it and the
matrix sinks while warm wax oozes out from under it; hold for the full ~900ms
and the matrix lifts away to leave the emblem embossed in the wax, lit like real
relief, glossy, then cooling from molten to set. Let go early and it springs back.

```html
<link rel="stylesheet" href="wax-seal.css">
<form>
  …
  <button data-wax-seal data-done="Signed">Hold to sign</button>
</form>
<script type="module" src="wax-seal.js"></script>
```

```js
import { waxSeal } from './wax-seal.js';
const destroy = waxSeal(button, { wax: '#23402c', emblem: 'assets/owl.webp' });
button.addEventListener('seal', (e) => { /* e.detail.at, e.detail.form */ });
destroy.reset();      // back to idle (fades the seal off)
destroy.state;        // 'idle' | 'armed' | 'pressing' | …
destroy();            // remove everything, restore the plain button
```

Without JS it is the same pill, a normal button that submits on click.

## The statechart

The behaviour is a plain object (`CHART`, exported) run by a twenty-line
interpreter. Inputs (pointer, touch, keys, focus, the `disabled` attribute,
timers) only ever *send events*; the chart alone decides what an event means
in the current state, and an event a state does not list is ignored. That is
most of the safety: a stray release in idle, a completion after a cancel, a
second press while the matrix is lifting all simply mean nothing. The current
state is mirrored to `data-state` on the button, and the CSS styles from it.

```
                 ENGAGE (hover / focus-visible)
        ┌──────┐ ─────────────▶ ┌───────┐
        │ idle │                │ armed │
        └──────┘ ◀───────────── └───────┘
           │      DISENGAGE         │
     PRESS │                        │ PRESS  (pointer down, Space / Enter down)
           ▼                        ▼
        ┌───────────────────────────────┐  RELEASE (let go early)
        │ pressing   progress 0 → 1     │  CANCEL  (pointer left the button,
        │ over data-duration ms         │ ───────▶   pointercancel, Esc, blur)
        └───────────────────────────────┘          ┌───────────┐
           │  ▲                                     │ recoiling │ spring back
           │  └──────────── PRESS ───────────────── └───────────┘ to 0
           │      (resumes from where the wax is)     │ SETTLED
           │                                          ├─[engaged]──▶ armed
           │ COMPLETE                                 └────────────▶ idle
           ├──[form invalid]──▶ recoiling  (reportValidity shows why)
           ▼
        ┌─────────┐ LIFTED ┌─────────┐ COOLED ┌────────┐ RESET ┌───────────┐ CLEARED
        │ lifting │ ─────▶ │ cooling │ ─────▶ │ sealed │ ────▶ │ resetting │ ──────▶ idle
        └─────────┘        └─────────┘        └────────┘       └───────────┘
         commit:            submit: the        (stays, unless
         'seal' event,      form, if any       data-reset or
         aria-live,         and not            destroy.reset())
         hidden input,      prevented
         vibrate

   idle · armed · pressing · recoiling ──DISABLE──▶ disabled ──ENABLE──▶ idle
```

Details that fall out of it:

- **Pointer leaves while pressing → recoil**, like a native button; coming
  back over it with the same press still down resumes. On touch the browser
  keeps the pointer captured, so the button checks the finger's position by
  hand (14px slop).
- **A scroll that starts on the button scrolls.** `touch-action:
  manipulation` lets the browser pan; it sends `pointercancel` and the seal
  recoils. No long-press menu (`contextmenu` is cancelled, `-webkit-touch-callout:
  none`) and no text selection.
- **Keyboard:** hold Space or Enter. Key repeat is ignored; Esc cancels;
  losing focus cancels. The button's own click never submits (it is
  cancelled); the seal submits with `form.requestSubmit(button)`, so the
  button's `name`/`value` go with it and constraint validation runs.
- **An invalid form never seals:** completion is guarded by
  `form.checkValidity()`; if it fails the browser shows why and the wax
  springs back.
- **`seal` is cancelable:** `preventDefault()` in a listener keeps the form
  from submitting (the seal still shows). A `wax-seal:state` event bubbles on
  every transition out of idle/armed, with `{ from, event }` in `detail`.

## Options

Data attributes, or the options object (which wins).

| Option | Attribute | Default | |
|---|---|---|---|
| `emblem` | `data-emblem` | `assets/carnelian-intaglio.webp` | Seal face image (square, the face filling a circle). A comma-separated list picks one at random per visit. |
| `wax` | `data-wax` | `#8a1c16` | Wax colour (sets `--ws-wax`). Any CSS colour. |
| `duration` | `data-duration` | `900` | Hold time in ms. |
| `done` | `data-done` | `Sealed` | Label once sealed (also the accessible name then). |
| `announce` | `data-announce` | the `done` text | What the live region says on sealing. |
| `hint` | `data-hint` | `Press and hold to confirm.` | Accessible description (visually hidden). |
| `submit` | `data-submit` | `auto` | `auto`: submit the form if this is a submit button and no `input` is set. `true` / `false` to force. |
| `input` | `data-input` | none | Name of a hidden input to create in the form; it is set to the ISO time of sealing (and emptied on reset). |
| `reset` | `data-reset` | `0` | ms after sealing to clear back to idle; 0 keeps the seal. |
| `relief` | `data-relief` | `raised` | `sunk` inverts the emblem's height (an impression from a coin is, strictly, sunk). |
| `layout` | `data-layout` | `pill` | `medallion`: just the seal with its label beneath (envelope flaps, certificates). |
| `haptic` | `data-haptic` | `true` | A 12ms `navigator.vibrate` at the moment it seals. |

## Theming

| Variable | Default | |
|---|---|---|
| `--ws-wax` | `#8a1c16` | Wax colour. Molten is computed from it (a little lighter, glossier). Call `destroy.recolor()` if you change it on a live button. |
| `--ws-m` | `34px` | Medallion (matrix) diameter. The wax spreads to about 1.4× this, past the pill's edge. |
| `--ws-bg` | `var(--paper)` | Pill background. |
| `--ws-line` | `var(--rule)` | Pill border. |
| `--ws-ink` | `var(--ink)` | Label colour. |
| `--ws-done-ink` | `var(--ws-wax)` | Colour of the italic "done" label. |

Also uses `--paper-2`, `--ink-2`, `--ink-3`, `--serif`, `--sans`.

## How the wax is lit

One 200-unit SVG, matrix radius 60. Two layers share one distant light
(azimuth 225°, from the top left):

1. **The blob**: a polar outline with a few low harmonics and three or four
   lobes that ooze out late in the press, all growing with the spread, so the
   edge starts round and ends irregular (new shape each visit). Its alpha is
   blurred into a dome, a little `feTurbulence` grain is added, and that is the
   height for `feDiffuseLighting` and `feSpecularLighting`.
2. **The impression**: a pressed plateau, a ridge of displaced wax at its rim
   (a radial gradient), and the emblem drawn over it. `feColorMatrix` turns its
   luminance into alpha, which is the bump map for the same two lights.

Flat parts of both come out exactly the wax colour (the diffuse result is
scaled by 1/sin(elevation)), so the seam between the layers is just the ridge.
Dark waxes get a little of the light itself added on slopes, and more gloss,
or black-on-black relief would vanish.

## Tuning notes

- `surfaceScale` is set from the rendered size (CSS px per SVG unit), so a
  small seal is not steeper than a big one. Chrome computes the lighting in
  CSS pixels at any DPR (checked: DPR 1 and 3 look the same).
- Emblems: crop tight to the coin's face, grayscale, about 560px square, the
  outside transparent (the medallion is at most ~90 CSS px, so 560 stays sharp
  at DPR 3). Strong, simple relief (a head, an owl) reads best; a
  busy scene turns into texture at small sizes.
- Timing constants at the top of `wax-seal.js`: lift 620ms, cool 1500ms,
  clear 520ms. The recoil is a critically damped spring (no bounce).
- rAF runs only while something moves (a press, recoil, lift, cool, the hover
  lift); at rest there is no loop at all.

## Accessibility and reduced motion

It is a real `<button>`: focusable, labelled by its own text, described by a
hidden "Press and hold to confirm." Space/Enter must be *held*, which screen
reader users can do (VoiceOver: double-tap and hold). Sealing is announced
through a polite live region next to the button; the label becomes the `done`
text and the button gets `aria-disabled="true"`. Decorative SVG is
`aria-hidden`.

Reduced motion: the hold still takes its time (that is the safety, not
decoration) and the wax grows with it, since that is direct feedback. Nothing
moves on its own: release snaps back, the impression appears at once with no
lift or cooling, and there is no hover lift.

## Credits

No libraries. The emblems (a carnelian intaglio, two silver tetradrachms, two gold aurei) are from The Metropolitan Museum of Art's Open Access collection (CC0; Wikimedia was rate-limiting the day this was built), cropped to the coin's face and greyed. See `assets/credits.json` for each object's page and the original image.
