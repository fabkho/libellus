# Three neater shapes for the Home reading card

Mocks only: `docs/prototypes/home-card/` (open `v1-lean.html`, `v2-hierarchy.html`, `v3-restructured.html`)
and `docs/images/home-card/`. Baseline is today's card after #561 — cover with its glow, serif title,
author (+ ebook mark), the pace line (`home.days`), the bar, the caption `42 % · p. 126 of 300`, and the
one action (Update / Undo / Finish).

All three keep the card a member recognises: the cover, the serif title, the author, the bar, the one
action. Each file carries every state — **A** page-based, **B** percent only, **C** 0 %, **D** last page,
**E** the +24 gain, **F** German at 360 px — plus **L**, the same card on the Library's reading tab, in both
themes.

Two complaints drive this set: the pace line is "pretty useless here", and the caption has no hierarchy —
two equal readouts glued by a dot, in the sentence-abbreviation `p. 126 of 300`.

---

## V1 — lean: the pace line gone (`v1-lean.html`)

**Idea.** Delete `18 a day · 22 days` outright and change nothing else. The owner's own suggestion, taken
literally, so the rest can be judged on its own.

**Cuts / adds.** Cuts one line and its 14 px + 8 px margin. Adds nothing.

**What the freed space does: it goes above the bar, not into a shorter card.** The cover is 82 px wide and
~123 px tall and sets the card's height, so the title + author + one more line fit without growing it —
removing a line cannot shorten the card, only leave a hole. `margin-top: auto` on the bar keeps the bar,
caption and action as one bottom cluster at a fixed distance from the edge, and the air lands where a card
wants it: between the title block and the numbers.

**What it costs.** Nothing visually — the card is 3 px shorter (154 → 151 px), the difference being bar
spacing rather than the line, and state B gets *better* (a lone `45 %` with air). State F is the loss:
without a fix the German caption still wraps at 360 px exactly as it does today (`S. 126 von 300` breaks
after `126`, two line boxes) — V1 is honest about being a subtraction, not a repair. State E still runs
three figures on one line (`50 % · p. 150 of 300 · +24`).

**Answers:** complaint 1 (the pace line), fully. Complaint 2: not at all.

---

## V2 — hierarchy: the percent is the fact, the place is the detail (`v2-hierarchy.html`)

*As first delivered. The file has since been revised in place — see "The owner's choice, and the revision
that shipped" below, which supersedes the pace-line and placement notes in this section.*

**Idea.** Keep the pace line. The percent becomes a 20 px ink headline; the place becomes a 10.5 px faint
line under it, and the `p.` and the `·` are gone — the number and its total carry the meaning without a
sentence abbreviation.

**Cuts / adds.** Cuts the dot and the `p.`. Adds one step of type and one step of ink. Nothing new to say.

**What it buys.** Exactly the hierarchy the owner asked for: one loud fact, one quiet detail. It also
*fixes* the German 360 px bug for free — `126 von 300` on its own line at 10.5 px mono sits beside
`Aktualisieren` without wrapping, where today's single line breaks after `126`.

**What it costs.** The caption block is 40 px tall instead of 14, so the card is 8 px taller than today
(154 → 162 px). State C is the weak one: `0 %` over `0 of 300` says zero twice, where one line said it once.
State D loses its hierarchy — `The end.` has to drop back to body size in the headline slot.

**Answers:** complaint 2, fully, and complaint 1 not at all.

**One variant worth noting:** the same file's state L shows the component carrying either the pace line or
the Library's `Since 3 Nov · day 12` in the same slot.

---

## The owner's choice, and the revision that shipped (15 Nov)

**He chose V2, with one objection.** Quoted in full, because every decision below follows from it:

> "Yes, I like V2. The only thing I don't like about it is that now the page count is beneath the
> percentage, and this causes the whole card to grow, and the whole card is now larger than the cover of
> the book, and therefore we have more space under the cover than above it. We have to prevent this. Maybe
> we can move the page count to the right of the percentage to get this in harmony again."

He asked for the pace line gone in the same conversation — *"in at least one mock, I want to completely
remove the line under the author where we currently see 43 pages a day and one day to go. I think this
line is pretty useless here."* — so the revision does both: V2's typography, V1's deletion, rebuilt rather
than bolted together.

**The mechanism he saw.** The card grew because the first V2 stacked two lines where the old caption had
one: 154 → 162 px. The cover is `align-self: flex-start` with a fixed `--size-cover-lg` width and its own
aspect ratio (`card.css:35`), so it holds its 123 px height while the text column grows past it — the cover
then no longer spans the card, and the extra 8 px shows up entirely below it (25 px under, 14 px above).

**Measured heights, before and after.** State A, 390 px, WebKit, both languages, at 2x:

| Card | Height | Cover above / below | Notes |
| --- | --- | --- | --- |
| Today (before #569) | 154 px | 14 / 17 | the baseline the owner compares against |
| V2 as delivered (#569) | 162 px | 14 / **25** | the stack; this is the objection |
| **V2 revised (shipped)** | **151 px** | **14 / 14** | pace line gone, the bar carries its own numbers |

### Where the inverse goes: what was tried, and what won

The owner revised the brief after seeing the first revision: the count should not share a line with anything
at all. Six placements were built and measured, each in states A, E and F, in both languages. The decisive
state is **F, German at 360 px**, where the text column is **202 px** and `Aktualisieren` alone takes **104
px** of it — so *any* count sharing the button's row has at most 98 px to live in.

| Placement | A | E | F (German 360) | Verdict |
| --- | --- | --- | --- | --- |
| Count beside the percent, action on that row (`v2-options/row-a-one-line.html`) | 151 px | 151 px | 151 px | **rejected**: the count collides with the button in every German state |
| Count beside the percent, the row allowed to wrap (`v2-options/row-b-wraps.html`) | 151 px | 151 px | **164 px** | **rejected**: never collides, but German pays two lines on every card and the cover stops spanning |
| The action reduced to an icon so one row fits (`v2-options/row-c-icon.html`) | 151 px | 151 px | 151 px | **rejected by the owner**: an unlabelled control is a recognition cost he will not pay |
| Count in a fixed column above the bar, percent below (`v2-options/row-d-count-above.html`) | 153 px | 153 px | 153 px | **rejected**: 2 px over the line, and the label sits in a column rather than on the bar |
| Earlier revision: numbers on their own line, action on the bar's row | 151 px | 151 px | 151 px | **superseded**: he did not want the count beside the percent at all |
| **The bar carries its own numbers** (`v2-hierarchy.html`) | **151 px** | **151 px** | **151 px** | **shipped** |

**What shipped, and why.** The current page is pinned over the **tip of the fill** — it moves with the
progress instead of sitting in a fixed column — and the book's total is flush with the bar's **right end**.
A 0.5 px hairline tick joins the label to the tip, so the number reads as *a point on the bar* rather than a
label that happens to float above it. Below the bar, `42 %` stands alone at 20 px ink with the one action at
the right edge.

This is the only placement that satisfies all three constraints at once: it removes the count from the
button's row (so German cannot collide), it keeps a labelled action, and it holds 151 px. It is also the only
one that makes the numbers *mean* something positional — `126` sits where 126 of 300 is, which no phrasing on
a flat line could do.

**The two ends.** At `0 %` there is no tip to hang a label from, so the count aligns to the bar's left end
instead of overflowing the card; at `100 %` the bar is full and the numbers are dropped entirely, because
"The end." already says it. Both cases are in states C and D.

**Height is the acceptance criterion, not a nicety.** Every placement above reports its A and E; the two
that fail do so on height (164 px, 153 px) or on the owner's judgement (the icon action).

**The cover balances again.** At 151 px the `lg` cover (123 px) spans the card exactly: 14 px above it,
14 px below — the card's own `p-inset`. `align-self: flex-start` stays as it is, and the cover's size is
untouched: it is a design constant across the app and did not need to move once the card stopped growing.

**The Library's reading tab carries this exact card.** Not a cousin: the same bar, the same pinned numbers,
the same percent, the same Update. Its `since` line takes the pace line's old slot above the bar. The old
Library card had no bar and no numbers at all, and a Finish where this has Update — one component, two
screens.

**State L's cover is the one thing that differs, and it is the cover's rule, not this card's.** The Library's
cover is `md` (108 px) against a 171 px card, so 49 px sits below it. That dead space exists on the Library
card today, with no bar at all, and fixing it means rescaling a design constant — out of scope for a card
revision, recorded here instead.

### i18n

**No new key is needed for the shipped card — the change of placement retired the one that was.** The bar's
two marks are **bare numerals** (`126` and `300`), identical in every language, because a number pinned to a
bar needs no "of" or "von" to say what it measures: the position does that. So `book.progress.pageShort`,
which the previous revision had introduced for `126 of 300`, is **not required**. Recorded because it was
asked for explicitly, and because the earlier proposal promised it.

`book.progress.page` (`p. {page} of {count}` / `S. {page} von {count}`) stays for the places where the number
does stand alone in a sentence — the Update sheet, the Book page. That key was never in question.

**The words the screen reader needs are unchanged:** the bar's accessible label keeps the full
`126 of 300` / `126 von 300` from `book.progress.page`, exactly as today, so nothing regresses for assistive
tech while the visual shrinks to numerals. If the team would rather the *visible* marks also carry units, the
key to add is `book.progress.pageShort` — but the mock's argument is that they should not.

**Retired on Home, kept in the bundle:** `home.days` goes with the pace line on `ReadingCard.vue`;
`book.progress.paceLine` and `book.progress.endLine` stay, because the Book page's chart caption still
uses them.

**The percent stays a real percent.** State B shows `45 %` and never `45`: the card's existing rule (a page
is never shown as a percent) is unchanged by this revision.

**The numbers are the book's, not the session's.** The mark over the tip is the page reached, and the mark at
the right end is the count the bar is measuring against — the member's own total when she set one (#60), else
the edition's. That is `pageCountOf()`, the same value `progressFraction()` already uses, so the bar and its
labels cannot disagree.

---
---

## V3 — restructured: the bar carries the percent (`v3-restructured.html`)

**Idea.** The bold one. Cover steps from `lg` to `md`, the title to callout, and the thin 2 px bar becomes a
22 px meter with the percent **inside** its right end. The place is a compact right-aligned `126 / 300`
under the bar; the pace shrinks to a glyph and one number; the action becomes an icon-only control in the
corner the card already reserves for its "more" menu.

**Cuts / adds.** Cuts the caption line entirely and the button's label. Adds two icons (pace, action).
Uses no new words in any language.

**What it buys.** The card is 18 px shorter than today (154 → 136 px) and stops repeating itself: how far is *shown* by
the meter and *read* inside it, once. It is also the only variant where the German state cannot wrap at
all, because the widest word on the card (the button label) is gone.

**What it costs.** The most: an unlabelled icon action is a recognition risk (a pencil for Update, a check
for Finish, an arrow for Undo in the same corner), and the pace number without its unit (`18`) needs a
tooltip or a screen-reader name to mean anything. State C is its best state (an empty track with a faint
`0 %`), state E its most crowded (the gain rides inside the meter). It also moves furthest from "a card a
member recognises at a glance".

**Answers:** both complaints at once — the pace line is reduced to a glyph, and the caption disappears into
the bar.

---

## Recommendation

**Ship V2, and take V1's deletion of the pace line with it.**

V2 is the only variant that answers the harder of the two complaints without spending anything the member
knows: same card, same bar, same action, one readout that finally has a size. It also happens to be the
cheapest fix for the German wrap, which V1 leaves in place and V3 fixes by deleting the button's words.
Pairing it with V1's `margin-top: auto` bottom cluster gives the card back the air the removed pace line
frees — V1 and V2 compose cleanly, since V1 is a subtraction and V2 is a typographic change to what
remains.

**Superseded by the owner's choice: V2 was picked, and revised as described above.** The pairing proposed
here (V2's hierarchy plus V1's deletion) is what shipped, with the numbers beside each other rather than
stacked and the action on the bar's row — 151 px, cover balanced. The three original files stay as the
record of the choice; `v2-hierarchy.html` is now the revised card, and `v2-options/` holds the two
placements that were measured and turned down.

V3 is the one to keep in a drawer for the day the card is allowed to stop looking like today's card.

---

## Notes for implementation (not part of the mocks)

- **New keys: none for the shipped V2.** Every string it shows already exists — `book.progress.percent`,
  `book.progress.page` (also the bar's accessible label), `book.progress.theEnd`, `book.progress.gainPages`,
  `book.progress.updateShort`, `book.progress.undo`, `book.finish`. The bar's two marks are bare numerals and
  need no template at all. `book.progress.pageShort`, promised by the previous revision for `126 of 300`, is
  **no longer required** — see the i18n section above.
- **A key that could retire:** if V1's deletion ships, `book.progress.paceLine` and `book.progress.endLine`
  are still used by the Book page's chart caption, so keep them; `home.days` on `ReadingCard.vue` is the
  only Home use and goes with the line. The shipped V2 takes the deletion, so this applies.
- **V3's icon-only action** needs an accessible name for each of the three: `book.progress.updateShort`
  serves Update, but Finish and Undo need `book.finish` / `book.progress.undo` on a 44 px target.
- **The Library card becomes the same card — the owner asked for it twice, and the shipped V2 does it.**
  `library/ReadingCard.vue` today shows cover, title, author, `Since 3 Nov · day 12` and a quiet Finish: no
  bar, no numbers, no Update. State **L** shows it carrying *this exact card* instead — same bar, same pinned
  numbers, same percent, same Update.
  - The two screens differ in exactly one input: a `since` line, which takes the slot the pace line occupied
    on Home. So the component takes that line as a prop (a slot, or a `null` default), and nothing else
    branches on which screen it is on.
  - **The action differs, and that is a decision, not an accident.** The Library card finishes a read from its
    card today; the shared card's one action is Update (Finish only at the last page). Shipping one component
    means the Library loses its direct Finish: finishing then goes through the card's action or the book page.
    If the owner wants to keep a Finish on the Library, the card needs a second control, which is a design
    question this revision deliberately does not answer by guessing.
  - **The `md` cover is the Library's constant**, so that card ends 49 px below the cover (171 px card, 108 px
    cover). The dead space exists there today with no bar at all; scaling the cover to close it is out of
    scope, as noted above.
  - **`progressFraction()` and `pageCountOf()` are already shared logic**, so the bar, the mark over its tip
    and the mark at its end cannot disagree with each other on either screen.
- Reuse `docs/prototypes/book-actions/`'s harness: `tokens.css` and `base.css` are copies, `mock.js` is the
  same with the `?w=` line dropped (panels carry `.narrow` themselves), `shoot.cjs` shoots every panel in
  both themes into `docs/images/home-card/`.
- **The shipped V2's structure**, for whoever builds it. The card is, top to bottom: cover · title ·
  author · the bar's block · the foot row.
  - The bar's block is `.barwrap { margin-top: auto; padding-top: var(--spacing-md) }` so all the slack sits
    above the bar, then a `.barmarks` strip of fixed height (`--num-line`, 13 px) holding two absolutely
    positioned `.mark` spans, then the 2 px bar itself with `margin-top: var(--spacing-xs)`.
  - `.mark.cur` is `left: {percent}%` with `transform: translateX(-50%)` — centred on the fill's tip. Two
    escape hatches: `.mark.cur.left` (`transform: none`, used at 0 %, where the tip *is* the bar's left edge)
    and `.mark.cur.right` (`left: auto; right: 0`). `.mark.total` is `right: 0`, flush with the bar's end.
  - The tick is `.mark.cur::after`: a 0.5 px `--color-hairline-strong` line, 4 px tall, sitting at
    `bottom: -4px` so it lands exactly on the bar's top edge. Nothing else is added.
  - Both marks are **bare numerals** in mono tabular figures at 10 px `--color-ink-faint`; the percent below is
    20 px `--color-ink`; the foot is `padding-top: var(--spacing-xs)`, `justify-content: space-between`, with
    the action in the bottom-right corner it has today.
  - Measured in the mock: Δ 0 px between the tip and the label's centre, and Δ 0 px between the total's right
    edge and the bar's. If a build changes the mono font or the mark size, re-measure those two deltas — the
    centring is fragile to a different advance width only in that the *target* moves, not the offset.
  - `align-self: flex-start` on the cover and `--size-cover-lg` are both unchanged: with the card at 151 px
    the 123 px cover spans it again.
- **Two states drop the numbers on purpose.** At `100 %` (state D) the bar is full and "The end." says it, so
  there is no mark to point at; at no page count (state B) the bar carries nothing and the percent stands
  alone. Neither is an oversight, and both are asserted in the mock.
- **`v2-options/`** holds the placements that were measured and turned down, for the record:
  `row-a-one-line.html` (the count collides with the button in every German state), `row-b-wraps.html`
  (German grows to 164 px and the cover stops spanning), `row-d-count-above.html` (a fixed column above the
  bar, 153 px — over the line) plus the two from the first revision, `a-place-beside-the-action.html` and
  `b-place-stacked-under.html`. `index.html` frames them. `shoot.cjs` does not shoot them.
