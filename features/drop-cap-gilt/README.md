# drop-cap-gilt

An illuminated-manuscript drop cap for article openings. The first letter of
a paragraph stands about four lines tall in ink-grey serif; when the
paragraph scrolls into view, a gold gradient sweeps across the letter once
and a thin hand-drawn vine draws itself beneath the first line. Colour
earned: the cap starts grey and gilds as the payoff.

Vanilla HTML/CSS/JS. No build step, no framework, no dependencies.
Copy the folder, include the CSS and the module, done.

## Markup

```html
<link rel="stylesheet" href="drop-cap-gilt.css">
<p data-drop-cap>Once upon a time&hellip;</p>
<script type="module" src="drop-cap-gilt.js"></script>
```

The module auto-starts on every `[data-drop-cap]` element. The paragraph
should begin with the letter (an opening quote is allowed and gilds with
it). The vine stretches from just past the cap to the paragraph's right
edge; it is absolutely positioned, so it reserves no space and the animation
causes no layout shift.

For manual control:

```js
import { init } from './drop-cap-gilt.js'; // (also exported as dropCapGilt)
const destroy = init(document.querySelector('p'), { threshold: 0.5 });
// destroy() removes listeners, observers, and everything added to the DOM,
// restoring the paragraph's original text.
```

## Options

| Option | Attribute | Default | Meaning |
|---|---|---|---|
| `threshold` | `data-threshold` | `0.35` | Fraction of the paragraph that must be visible to trigger gilding. Options object wins over the attribute. |

Gilding fires exactly once per element.

## Theming

Custom properties, all with fallbacks (factory tokens `--serif`,
`--ink-2` are honoured when present):

| Property | Default | Meaning |
|---|---|---|
| `--dcg-size` | `5.6em` | Cap font-size (≈4 lines tall at 1.55 body leading) |
| `--dcg-ink` | `--ink-2` / `#4a4744` | Cap colour before gilding |
| `--dcg-gold` | `#b98a1e` | Gilded gold |
| `--dcg-gold-light` | `#f0d489` | Sheen band that sweeps across |
| `--dcg-gold-deep` | `#7c5f14` | Shadow edge of the gold |
| `--dcg-vine` | gold-deep | Vine stroke and leaf colour |
| `--dcg-vine-height` | `14px` | Vine strip height |
| `--dcg-duration` | `1.8s` | Gold sweep time |
| `--dcg-vine-duration` | `1.4s` | Vine draw time |
| `--dcg-vine-delay` | `.45s` | Vine draw delay after the sweep starts |
| `--dcg-ease` | `cubic-bezier(.33, 0, .2, 1)` | Easing for both |

On browsers without `background-clip: text`, the cap cross-fades from grey
to gold instead of sweeping. No convention rules were broken.

## Accessibility

- The paragraph text is never altered: screen readers read the intact
  sentence, and the cap is an ordinary inline span.
- The vine SVG is `aria-hidden="true"` and `focusable="false"`.
- `prefers-reduced-motion: reduce` shows the finished gilded state
  immediately; nothing animates or moves by itself.
- No keyboard interaction (the piece is decorative, not interactive).

## Credits

No images, no third-party code. The vine is an original hand-plotted SVG
path; the serif is the host page's `--serif` (the demo uses Cormorant
Garamond from Google Fonts).
