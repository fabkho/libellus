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

V3 is the one to keep in a drawer for the day the card is allowed to stop looking like today's card.

---

## Notes for implementation (not part of the mocks)

- **New key required:** one, and only for V2/V3. Every other string in all three mocks already exists —
  `book.progress.percent`, `book.progress.page`, `book.progress.paceLine`, `book.progress.theEnd`,
  `book.progress.gainPages`, `book.progress.updateShort`, `book.progress.undo`, `book.finish`.
- **The one new key:** dropping `p.` and `of` needs a sibling of `book.progress.page`
  (`p. {page} of {count}` / `S. {page} von {count}`) — a bare `{page} of {count}` / `{page} von {count}` —
  because `book.progress.page` is also shown in the Update sheet and on the Book page, where the `p.`
  earns its keep. `book.progress.pageShort`. V3's `126 / 300` is language-neutral and needs no string at
  all, but it does need the `figurePage` label for assistive tech.
- **A key that could retire:** if V1's deletion ships, `book.progress.paceLine` and `book.progress.endLine`
  are still used by the Book page's chart caption, so keep them; `home.days` on `ReadingCard.vue` is the
  only Home use and goes with the line.
- **V3's icon-only action** needs an accessible name for each of the three: `book.progress.updateShort`
  serves Update, but Finish and Undo need `book.finish` / `book.progress.undo` on a 44 px target.
- **The Library card.** The brief did not ask for it; the owner did, mid-brief: `library/ReadingCard.vue`
  today shows cover, title, author, `Since 3 Nov · day 12` and a quiet Finish — no bar, no numbers, no
  Update. State **L** in each file shows the chosen card standing in there. The swap is clean in V1 and V2
  (the "since" line inherits the pace line's slot, so the component takes one quiet mono line as a prop);
  in V3 it shares the row with the place. V1's state L is the shape to look at if the two cards become one.
- Reuse `docs/prototypes/book-actions/`'s harness: `tokens.css` and `base.css` are copies, `mock.js` is the
  same with the `?w=` line dropped (panels carry `.narrow` themselves), `shoot.cjs` shoots every panel in
  both themes into `docs/images/home-card/`.
