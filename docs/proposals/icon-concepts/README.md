# BetterReads — ten icon concepts (exploration, do not merge)

A capability test: how good is a language model at designing an app icon? Ten candidate marks in
`docs/proposals/icon-concepts/`, each `icon.svg` (512 viewBox, full-bleed room) plus a simplified
`favicon.svg` (32 viewBox) proving the 16 px read. Open `sheet.html` for the contact sheet
(all ten at 256, 64 and 16 px on light and dark, plus a 16 px legibility row); `sheet.png` is its
screenshot. **Nothing here is applied.** `web/public/`, `design/icons/`, the manifest and all app
code are untouched.

## The ten ideas, one line each

| # | Concept | Board trick borrowed |
| --- | --- | --- |
| 01 | Stack of three — three flat book-blocks, the middle one the lamp | 2049: one bright block per form, no gradients on the mark |
| 02 | Lamp dot — one amber disc setting over a page-line, nothing else | 2026: a single shape, no frame |
| 03 | Double B — the BB of "BetterReads" as an eight-bar grid, middle bar lit | 2026 + 2049: overlapping gradient strokes, flat blocks |
| 04 | Open doors — two pages parting with a blade of lamp-light between | 2035: the colour only in the detail |
| 05 | Progress ring — three-quarters read, the lamp colour drawing the arc | none (pure app idea: her progress) |
| 06 | Bookmark slash — one ribbon, full bleed, swallowtail cut | none (the single-object test) |
| 07 | Spine on — the chosen book glowing between dim neighbours | none (shelf logic) |
| 08 | Night window — a lit pane, books on the sill as silhouettes | 2035: the pictorial mark; the inverse of the current lamp-over-page |
| 09 | Initial lamp — a block B whose lower bowl *is* the lamp | 2058: the letter replaced by the object |
| 10 | Hairline ring — rounded enclosure, hairline outline, one amber bar of two | 2110: enclosure + colour only in the detail |

## Palette

Only the app's own colours: room `#3c3251` → `#211b2e`, lamp `#efb768`, page `#f1e3c8`.
One extra stop, `#f5c67e`, appears as a gradient endpoint on 03 and 05 where a flat lamp bar
banded against the page; it is mixed at draw time, not a token proposal. No new accent proposed.

## Rendering

`sheet.png` was produced with headless Firefox (`--screenshot`), not the repo's Playwright setup
— no Chromium is installed in this worktree and the brief forbids new dependencies. `sheet.html`
is self-contained (only sibling SVGs) and is the source of truth.

## Honest critique

**The one I would defend is 02, Lamp dot** — and only as a 16 px survivor, not as a winner. It is
the single concept that obeys the brief's hardest constraint: one silhouette, two flat colours, no
detail to lose. At 16 px it is still a lamp over a line. Everything else degrades: 05's ring gap
closes, 10's hairline dies (its favicon is really a different mark — two dots), 07's dim boards
sink into the room until only a floating amber bar is left, and 03's eight-bar grid turns to mush.

**The weak half is 03, 09 and 10, and they fail in the way language-model SVG always fails.**
Crisp letterforms need optical spacing and consistent counters; 03's bars never quite align into a
B — at 256 px you see a grid that *suggests* a letter, and suggestion is not typography. 09 has
the same disease worse: the counter is a plum rectangle punched with no overshoot, no rhythm, and
the amber bowl hangs off the stem like an afterthought. 10 fails at curvature: the "rounded"
enclosure is a `rx` rect whose corners have no relationship to the bars inside, so the whole thing
reads as a settings toggle, not a mark. The structural pattern across all ten: anything drawn with
`<rect>`, `<circle>` and straight `<polygon>` edges holds up; the moment a concept needs subtle
curvature (a page curl, a bowl, a spine radius) the model reaches for a geometric primitive and the
result looks assembled, not drawn. Optical sizing is the other gap — every favicon here is just the
icon with fatter numbers, not a redraw with rebalanced weight; a human would redraw 04's light-blade
and 08's silhouettes from scratch at 32 px instead of scaling them.

**None of these beats "Lamp over the page."** The current mark is a small scene with depth — lamp,
glow, pages — that still resolves to two shapes at 16 px, and it carries the app's founding image
(a reading lamp in a dark room) where none of these carry anything. 02 comes closest to its
restraint but says less; 08 is its photographic negative and proves the inversion adds nothing;
the letterforms (03, 09) trade the app's warmth for a techiness the brand does not want. Verdict:
keep the lamp.
