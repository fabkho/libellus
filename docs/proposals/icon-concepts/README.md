# Ten icon concepts (exploration — nothing applied)

A capability test, not a proposal: ten candidate marks for BetterReads, drawn as flat SVG by a
language model in one sitting, to see whether any of them beats the mark the app already has,
**option 6, "Lamp over the page"** ([`design/logo-options/6-lamp-over-page/`](../../../design/logo-options/6-lamp-over-page/)).

Nothing here is used by the app. `web/public/`, `design/icons/`, the manifest, the Android
resources and every other source are untouched; this folder is the whole change.

## What it is judged against

From `docs/DESIGN.md` and the mark's own brief: one strong silhouette, at most three flat colours,
no hairline detail, and it must still be a picture at **16 px** — the home screen, a browser tab, a
notification badge. The room is dusk plum (`#3c3251` → `#211b2e`), the lamp is `accent`
(`#efb768`), the page is `clothInk` (`#f1e3c8`). The house grammar: `<title>` first, flat
`<path>`/`<rect>`/`<circle>`, gradients in `<defs>` only, no filter, no image, no CSS.

## The ten

| # | Concept | In one line | Borrowed from the board |
| --- | --- | --- | --- |
| 01 | [Single-stroke B](01-single-stroke-b/icon.svg) | The letter as three fat strokes, no frame | 2026 — one letterform, the strokes overlapping |
| 02 | [Block B](02-block-b/icon.svg) | The letter cut into flat blocks, a bright colour for the bowls | 2049 — flat blocks, one bright colour per block |
| 03 | [Lit counter](03-lit-counter/icon.svg) | A drawn B with one counter filled with the lamp | 2035 — the mark supplying the colour on its own |
| 04 | [Open book](04-open-book/icon.svg) | The object alone, a valley at the spine, no lamp added | — no trick; the founding object, lamp removed |
| 05 | [Turned corner](05-page-corner/icon.svg) | A page with its top corner folded back, the fold in the lamp | 2110 — colour only in the detail |
| 06 | [Ribbon](06-bookmark-ribbon/icon.svg) | The bookmark alone: solid, swallowtail notch, no page | — no trick; silhouette only |
| 07 | [Book as window](07-book-window/icon.svg) | A cream page cut into a book, lit from behind | 2058 — the object itself set into the form |
| 08 | [Two forms meeting](08-two-meeting/icon.svg) | An abstract page-half and lamp-half, staggered at the seam | 2026 — two strokes meeting, the seam is the idea |
| 09 | [Spine and boards](09-spine-boards/icon.svg) | A book from above: two cream boards, the lit spine between | 2049 — flat blocks that read as one object |
| 10 | [Enclosure](10-enclosure/icon.svg) | The ribbon held in a hairline rounded rect, one face lit | 2110 — the mark inside a rounded-rect enclosure |

Every concept is `icon.svg` (512, full-bleed room) plus `favicon.svg` (32, redrawn for 16–32 px —
not a scaled copy: proportions are changed, not paths). No new accent is proposed; every mark uses
`accent` and `clothInk` on the existing room, so nothing here would need a new token.

## The sheet

[`sheet.html`](sheet.html) is the contact sheet: each mark at 256, 64 and 16 px, the favicon and the icon at 32 px
on a light and a dark page, plus a 16 px legibility strip in both themes. It carries no external
asset — the SVGs are inlined as `<symbol>`s. [`sheet.png`](sheet.png) is a screenshot of it (2960 × 5794, 2×,
Chromium via the repo's Playwright dependency).

## The honest critique

**What is genuinely good.** Three survive the brief on their own terms.

**04 Open book** is the strongest by the stated constraints. It is one silhouette, two colours, no
gradient, no thin line — and it says "reading" without a lamp, a letter or a frame. It is also,
plainly, a *reduction* of the current mark: the same two page shapes, the lamp and the glow taken
away. It survives 16 px because the valley is a wide V of negative space, not a detail.

**06 Ribbon** is the second. A solid plane with one notch is the most robust thing in this folder —
nothing in it can disappear at any size, and its silhouette is unmistakable. Its weakness is
meaning: a bookmark is *marking*, not *reading*, and BetterReads is about progress and notes more
than about place-holding.

**09 Spine and boards** is third, and the smallest surprise: three rectangles got a book from
above, and the lamp reading as the spine is a genuinely better use of the accent than a glow.
It holds at 16 px only because I widened the spine for the favicon.

**What is weak, and why — specifically.** This is the capability data.

- **Crisp typography is the failure mode.** Every letterform here shows it. 01's B was drawn as
  three round-capped arcs, so it has no flat terminals: the bowls end in half-circles that a
  letter would cut off, and I only noticed after rendering that the top bowl reaches 12 units less
  far right than the bottom one — an accident, not a decision. 02's block B escapes that only
  because a rectangle cannot bend, and it pays for it by having a square bowl and a bottom counter
  the same size as the top, which is not what a B is. A model draws a *description* of a letter;
  it does not apply the corrections a type designer makes at every join.
- **Optical spacing is absent.** 02, 09 and 10 all have perimeter gaps that are numerically equal
  and visually unequal. The gap between block and block in 02 reads as the same width as the gap
  to the icon's edge, which is why it looks slightly off and I cannot say exactly where.
- **Subtle curvature goes wrong in the quiet direction.** 05's fold, 07's window and 10's enclosure
  all use arcs and roundings that were easy to write and are hard to control: 05's page corner is
  too small relative to the sheet, 07's cut is too generous and reads as a picture frame with a
  book inside rather than a page that *is* the book, and 10's outline is a hairline that is the
  exact thing the brief forbids — it works at 32 px and greys out at 16.
- **Gradients, on reflection, do not earn their place here.** I used the room's plum gradient on
  all ten because the house style has it, but at 16 px it is invisible, so every mark reduces to
  two flat colours anyway. That is an argument for the favicons being flat (they are) and against
  believing the 512 file's gradient is doing any work.
- **08 is the weakest.** It is an abstraction with no referent: a circle with a stagger could be
  any app. The board's 2026 trick works for an envelope *because the strokes spell M*; here the
  strokes spell nothing, so the restraint reads as emptiness.
- **01 and 03 are the same idea done twice**, and 03's lit counter is the clearest evidence of the
  model's limit: a small circle placed inside a letter is not a counter being lit — the placement
  is approximate, the dot is too round, and at 64 px the letter's right side looks moth-eaten.

**Does anything beat "Lamp over the page"?** No. 04 is a *simpler* version of the same idea, and
simpler is defensible at 16 px — but it also deletes what makes the current mark good: the mark is
a picture of a reading lamp in a dark room, which is the app's founding image, and the sun-like
disk behind the pages gives it a single bright shape that reads instantly. 04 buys silence at the
cost of the one thing nobody else has. 06 is the most robust and the least meaningful; 09 is the
most elegant and the least BetterReads. **None of these is better than the current mark** — and
that is the useful result: the current mark was chosen by a process that could weigh taste, and a
model drawing flat SVG in one pass can match its *restraint* but not its *idea*.
