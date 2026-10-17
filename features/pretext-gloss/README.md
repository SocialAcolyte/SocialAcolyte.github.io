# pretext-gloss

The glossed page: a medieval glossed Bible, a Talmud folio or a Renaissance
commentary page, laid out live. The main text sits in the middle in larger
type, under a painted initial. Two commentaries wrap round it: the inner one
on the left and the outer one on the right, each taking half the page above
and below the main text and a narrow column beside it. The block's width and
position are solved with pretext so that both commentaries end on the same
line at the foot of the page, and the page solves itself again every time
its width changes. Hover a gloss or a lemma, or tap it: the rest of the page
fades, the pair stays dark, and a red hairline is drawn from one red key
letter to the other.

```html
<link rel="stylesheet" href="pretext-gloss.css">
<article class="pg" data-pretext-gloss data-initial="assets/initial-t.webp">
  <header class="pg-head">
    <span class="pg-head-l">Cap. I.</span><span class="pg-head-c">Ecclesiastes</span><span class="pg-head-r">117</span>
  </header>
  <div class="pg-main">
    <p><span data-lemma="preacher">The words of the Preacher</span>, the son of David …</p>
    <p>…</p>
  </div>
  <aside class="pg-gloss" aria-label="Glossa">            <!-- inner commentary -->
    <p data-gloss="preacher"><b>The words of the Preacher.</b> The Hebrew name is Qoheleth …</p>
  </aside>
  <aside class="pg-gloss" aria-label="Postilla">          <!-- outer commentary -->
    <p data-gloss="new" data-hand><b>No new thing under the sun.</b> …</p>
  </aside>
  <footer class="pg-foot"><span class="pg-catch">I the</span></footer>
</article>
<script type="module" src="pretext-gloss.js"></script>
```

Or `import { pretextGloss } from './pretext-gloss.js'` and call
`pretextGloss(article, options)`, which returns `destroy()`. `CHART` (the
statechart) is exported too.

- `data-lemma="name"` marks a phrase in the main text; the `<p data-gloss="name">`
  with the same name, in either aside, is its gloss. Keys are given in the
  order the lemmas appear, in the Latin alphabet (a b c … i k l m …, no j or u).
- Paragraphs of the main text run on, divided by red pilcrows.
- The `<b>` at the start of a gloss is its lemma (underlined in red on the page).
- The aside's `aria-label` (or `data-label`) is printed in red small capitals
  at the head of its commentary.
- `data-hand` on a gloss puts a pointing hand in the margin beside its first line.
- The header and footer are yours: running head, folio number, catchword.
- Soft hyphens (`&shy;`) in long words are honoured, and the line shows a hyphen.

## Options

| attribute | option | default | what it does |
|---|---|---|---|
| `data-initial` | `initial` | none | Image for the drop initial: it stands in for the first letter of the main text, and the rest of the first word is set in small capitals. Without one, the letter is drawn large in red. `none` keeps the first letter in the text. |
| `data-initial-lines` | `initialLines` | `4` | How many main-text lines the initial spans (it drops to 3 on a narrow measure). |
| `data-lead` | `lead` | `3` | Commentary lines above the main text. |
| `data-tail` | `tail` | `7` | Commentary lines wanted below the main text. The block's width is solved for this: the narrowest block that leaves at least this many lines under it. |
| `data-size` | `size` | auto | Commentary font size in px. Auto is the text width / 74, kept between 11 and 14. |
| `data-scale` | `scale` | `1.6` | Main text size as a multiple of the commentary size. Each main line is exactly two commentary lines tall, whatever this is. |
| `data-stack-below` | `stackBelow` | `640` | Below this text width (px), the folio becomes a single column with the glosses folded under each paragraph. |
| `data-hang` | `hang` | `true` | Hanging punctuation: full stops, commas, hyphens and closing quotes sit out past the right edge (semicolons, colons and question marks halfway). |

Events: `root.dataset.pgState` mirrors the chart's state (`idle`, `previewing`,
`pinned`, `peeking`, `focused`). `root.dataset.pgSolve` reports the last solve
(time, whether it came out flush, rows, block width, splits).

## How it is solved

pretext (Cheng Lou) measures the three texts once at 100px. After that a
line is arithmetic over cached widths (`layoutNextLineRange`), linear in the
font size, so a whole page can be poured hundreds of times in a few
milliseconds. The page is a grid of commentary rows; a main-text line is two
rows, and its baseline sits on the second row's baseline, so both sizes
share one grid.

1. **The split.** For a block of width *m*, moving the block right widens
   the inner column beside it and narrows the outer, so the inner
   commentary gets shorter and the outer longer. A binary search finds the
   position where both end on the same row.
2. **The tail.** If no position ties exactly (rows are whole numbers), the
   split of the band under the block is nudged on its own until they do.
3. **The measure.** A wider block is shorter, and the columns beside it are
   narrower, so more commentary is left over below it. An outer binary search
   finds the narrowest block that leaves `data-tail` rows beneath.
4. **The finish.** Among nearby positions that still tie, the one whose two
   last lines are fullest wins, so both columns end on a nearly full line.

The demo page solves in 4 to 15ms; the grip on the page's right edge
(desktop) resizes it live. Lines are absolutely placed `<div>`s holding
exactly pretext's text, justified by the browser with
`text-align-last: justify` (so it is exact even where a superscript is
narrower than pretext measured it); a line ending in punctuation is made
wider by that mark's width, so the mark hangs.

## Theming

| variable | default | |
|---|---|---|
| `--pg-sheet` | `#f7f2e5` | The vellum. |
| `--pg-ink` | `var(--ink)` | Text. |
| `--pg-rubric` | `#a3361f` | Keys, pilcrows, labels, lemma underlines, the hairline. |
| `--pg-dim` | `#b9b1a3` | Text colour of everything else while a gloss is lit. |
| `--pg-wash` | `rgba(196,72,38,.16)` | The band drawn under a lit lemma. |
| `--pg-main-font`, `--pg-main-weight` | Cormorant Garamond, 600 | Main text. |
| `--pg-gloss-font`, `--pg-gloss-weight` | EB Garamond, 400 | Commentaries. |
| `--pg-vellum`, `--pg-vellum-strength` | `assets/vellum.webp`, `.75` | The texture, multiplied over the sheet at two scales so the tile never shows. |
| `--pg-stack-size` | `21px` | Main text size in the stacked (phone) layout. |

The page margins are the `.pg` padding (a recto: inner 6.5%, outer 8.5%,
foot 8.5%). Also uses `--ink-2`, `--ink-3`.

## Tuning notes

- **Proportions of text.** The commentaries should hold about four to five
  times the words of the main text (here 270 against about 1,350). With too
  little commentary the block cannot get narrow enough and the tail is short;
  with too much the block sits at its narrowest (17em) and the tail grows.
  Both still end flush.
- **Gaps.** Justified narrow columns need words of ordinary length. If a
  column shows rivers, add soft hyphens to the long words, raise
  `data-stack-below`, or lower `data-scale`.
- **Fonts.** pretext reads the computed font of `.pg-main` and the first
  `.pg-gloss`; use named web fonts (not `system-ui`) and the layout waits for
  them to load.
- **The initial.** Crop to the painted letter with the vellum outside made
  transparent; it is drawn with `multiply`, starts grey and comes into colour
  once the page has inked in.

## Accessibility and reduced motion

- The source markup stays in the DOM, visually hidden, as the text screen
  readers read, find-in-page searches and print uses. The drawn folio is
  `aria-hidden`. Without JS (or if pretext fails to load) the source is the
  page: main text, then the two commentaries in columns.
- Keyboard: each lemma in the source gets a small link to its gloss
  (`gloss a`, `gloss b` …). Tabbing to one lights the pair on the page, with
  a focus ring round the key; following it moves to the gloss. Esc lets go.
- Pointer: hover previews, click pins (click again or anywhere else to let
  go); hovering another gloss while one is pinned peeks at it and returns.
  Touch: tap pins and taps toggle; nothing captures a drag, so the page
  always scrolls.
- Phones: the stacked layout uses real `<details>`; tapping a lemma or its
  key opens its fold, lights the gloss and scrolls it into view if needed.
- Reduced motion: the page appears inked at once, the initial is already in
  colour, the hairline appears without drawing, folds open without sliding.
- No animation loop at all: motion is CSS transitions on state changes, and
  the solve runs only when the width changes.

## Credits

- [pretext](https://github.com/chenglou/pretext) by Cheng Lou, MIT
  (`vendor/pretext`, unmodified, with its `LICENSE` and `VERSION`).
- Main text: Ecclesiastes 1:1-11, King James Version (public domain).
- The two commentaries were written for this component.
- The initial T (South German missal leaf, ca. 1390) and the vellum (the
  blank margin of an Italian antiphonary leaf, 15th century) are from The
  Metropolitan Museum of Art's Open Access collection, CC0. See
  `assets/credits.json`.
