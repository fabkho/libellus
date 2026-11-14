# The Book page's action cluster, four variants

Design exploration for the owner's report (13 Nov 2026): in state D — reading, ebook on the
device — the cluster is five stacked things, four of them buttons, three looking identical
(`Read now`, `Update progress`, `Notes` + `Read together`, the caption). The mocks live in
`docs/prototypes/book-actions/` (one HTML file per variant, all five states A–E each, light and
dark, 390 px and 360 px, EN and DE via the same `?theme=&lang=&w=` switch as `book-notes/`);
screenshots in `docs/images/book-actions/`; the caption question below is a recommendation, not a
decision.

## The four variants

| # | Shape | Fixes | Costs | Breaks |
|---|---|---|---|---|
| V1 | Two-tier hierarchy: one filled primary, the rest demoted to borderless text-with-icon buttons | Cheapest honest fix: one obvious primary, no new chrome, ~102 px in state D; DE-safe (text wraps as links) | Looks quiet — `Notes`/`Read together` may read as footer links, not actions | Nothing structural |
| V2 | One primary + one row of three: `Update progress · Notes · Read together` as equal thirds, icon above label | All three secondary actions keep full labels and 44 px+ targets (~130 px in state D) | Tallest of the compact three; at DE 360 the thirds wrap to two lines (`Fortschritt aktualisieren` / `Gemeinsam lesen` break) and the row grows — honest, but visibly heavier | Nothing structural |
| V3 | Segment / docked bar: primary grows, the rest icon-only with accessible names | Shortest cluster (~58 px in state D) and the clearest single gesture | Icon-only buttons carry meaning in tooltips/`aria-label` alone — worst discoverability for `Update progress` vs `Notes`; the 50 px icons sit inside one 58 px bar, the least forgiving touch geometry of the four | The secondary buttons lose their visible labels (a11y review needed) |
| V4 | Progressive disclosure: `Read now` + `Update progress` stay; `Notes` and `Read together` become section rows under About, next to the content they open | The cluster itself disappears (2 buttons, then content) and each action sits where its content lives | Pushes Notes/buddy reads below the fold for a reader who hasn't scrolled; `Read together` loses its presence in states A–C where it is the only social cue | `NotesBookButton` and `TogetherBookRow` move out of `book.actions` (see test ids) |

State-D `.actions` heights at 390 px EN (measured in WebKit): V1 ~102 px, V2 ~130 px, V3 ~58 px,
V4 ~340 px including the two section rows (the cluster itself is two buttons, ~108 px).

## Recommendation

**Build V1 (two-tier hierarchy).** It fixes the reported problem — one filled primary, the rest
visibly secondary — with the smallest change, no new chrome, no label loss, and it is the only
shape that is DE-proof at 360 px (the long strings wrap as text, nothing clips). Its weakest
state is **D**: three text buttons under the primary is still a row of three small things, and if
the owner finds that too link-like, V2 is the fallback — same structure, real buttons, at the
cost of ~30 px and a heavier DE row. V3's icon-only row is the wrong trade for actions she uses
weekly; V4 is the braver design but hides `Read together` exactly where a non-member needs to
see it.

Touch targets: all four keep the 50 px primary and visible focus. V2 has the most reliable
secondary targets (72 px thirds, icon + label); V1's text buttons meet 44 px via padding;
V3's 50 px icons inside a 58 px bar are the tightest and need a11y sign-off.

## What would change (implementation PR, not this one)

- `web/app/pages/book/[key].vue` — the `book.actions` block: primary + secondary layout.
- `components/together/BookRow.vue` — the pair row becomes the secondary tier (or section rows in V4).
- `components/notes/BookButton.vue` — same, beside it.
- Possibly a new `components/book/ActionRow.vue` if the tier layout is shared.

## Test-id risk

`e2e/bookOpenFlows.ts` asserts `book.add`, `book.start`, `book.updateProgress`, `book.read`;
`a11y.spec.ts` opens the progress sheet via `book.updateProgress` and reads `book.notes.section`.
**V1–V3 keep every one of these ids as they are** (same buttons, new CSS) — no e2e change.
**V4 forces an e2e change**: `book.notes` and `book.together.start` leave `book.actions`, so any
flow scoping to `book.actions` (and the a11y `book.notes.section` expectation of placement) must
be updated in the same PR. `book.read`, `book.updateProgress`, `book.start`, `book.add` survive
in all four.

## Open question for the owner

1. **Which shape do you want — V1, or V2 if V1 feels too quiet?** (V3 and V4 are explored and not recommended.)
2. **Caption lines:** drop both `together.entry.hint` ("Read this book with friends…") and
   `together.entry.adds` ("Starting a buddy read adds this book…") from the Book page? The key
   stays — Home's Together menu still uses `hint`. Recommendation: drop both on the Book page;
   `adds` belongs in the setup sheet, not under the button. Your call.
