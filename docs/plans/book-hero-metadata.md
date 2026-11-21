# The Book page's hero: pills, Goodreads — and the metadata block under About

Status: **mock settled, implementation not started.** The owner picked `docs/prototypes/book-detail/m5.html`
(called v4-a through the four rounds) out of eleven mocks; this plan is what a fresh worker implements.

Mock: `docs/prototypes/book-detail/m5.html`, shots in `docs/images/book-metadata/m5-*.jpg` (dark 390 EN, dark
360 DE, and the panels A/B/F/C: long About expanded, long About clamped with its **More**, a Book outside the
Library, and a Book with no description). `README.md` beside the mock has the reasoning for the three rejected
variants and for what was taken out of the header.

## What changes, in one sentence

The hero keeps the genre pills and the Goodreads row and **nothing else**; the year, the format, the page count
and the Book's links move under About, below the description, in the no-box two-column grid of m5.

## The hero

**Leave:** cover, title, author line, series line, status line, progress block, the one action.
**Keep:** `BookGenres` and `BookGoodreads`, in that order, directly under the series line.
**Delete:** the whole facts row — `<p v-if="facts.length" … data-testid="book.facts">` and its loading
placeholder `book.factsLoading` (`web/app/pages/book/[key].vue`, ~line 344 and ~352). The `facts` computed
(~line 160) has no other reader: `published`, `pageCount` and `format` all move into the block below.
**Delete:** `BookLinks` from the hero (~line 359) — it is the block's last row now.

Nothing else in the hero moves, and the hero must not grow when a Book has no genres and no Goodreads rating:
the pills row and the Goodreads row keep their reserved heights as they do today.

## The block under About

One grid, no box, no fill, no hairline: two columns, name over value, `ELSEWHERE`-less — m5's shape exactly.

| cell | label | value |
|---|---|---|
| 1 | `book.firstPublished` (**new key**) | the work's first-published year (`firstPublishedYear(book)`) |
| 2 | `book.thisEditionLabel` (**new key**) | the edition's publisher and/or year, `editionLine`'s parts, without the `This edition:` prefix |
| 3 | `book.formatLabel` (**new key**) | `formatOf(book, entry.formatOverride)` through `book.formatFact.*` |
| 4 | `book.pagesLabel` (**new key**) | `book.pages`, the count only |
| wide (5) | **no label** — the owner asked for it dropped | `BookLinks`' links, dots between them |

Rules that matter:

- **The block appears when it has anything to say**, not only when there is a description. Today `printedAs`
  is a `<p>` outside the About section precisely because a Book without a description still has an edition to
  name; the block replaces that `<p>` and inherits its `data-testid="book.thisEdition"` (see e2e below).
- With a description: the block goes after the About paragraph (and its **More** button), still inside
  `<section data-testid="book.about">`.
- Without one: the block stands alone where `printedAs` stands today, with no About heading. m5's panel C.
- **`editionLine`'s suppression rule stays.** It returns null when the hero and the copy agree on the year, and
  that behaviour is pinned by `web/tests/publishedYear.test.ts` and two e2e specs. With the year out of the
  hero, that rule now means "don't repeat the number in cell 1 and cell 2" — keep the function as it is and
  let cell 2 fall back to the publisher alone (`thisEditionPublisherOnly`'s parts) rather than change it.

## Spacing (m5's numbers, in tokens)

| gap | from | to |
|---|---|---|
| one action → About section | `--spacing-xl` (32) | `--spacing-xxl` (48) |
| About text (or its **More**) → the grid | `--spacing-sm` (8) | `--spacing-md` (16) |
| grid → the Notes / Read together pair | `--spacing-ml` (20) | `--spacing-xl` (32) |

The **More** button already reserves 44 px (`--size-touch`) and that height does the gap, so no extra margin:
with the button and without it, About → grid is 16 px in both cases (measured in the mock, EN 390 and DE 360).

## Copy

Five new keys in `web/i18n/locales/en.json` and `de.json`, under `book`, matching the app's tone (no capitals in
the values, the mock's micro-caps are CSS):

| key | en | de |
|---|---|---|
| `firstPublished` | `First published` | `Erstmals erschienen` |
| `thisEditionLabel` | `This edition` | `Diese Ausgabe` |
| `formatLabel` | `Format` | `Format` |
| `pagesLabel` | `Pages` | `Seiten` |
| `language` | `Language` | `Sprache` |

`book.links.label` exists and stays the `<nav>`'s accessible name; the visible label is gone. No key is deleted.

## The one thing the mock shows that this plan leaves out

The mock puts **language** in its edition row. It is on every `Book` (`language: string | null`) and no screen
shows it, so the worker does **not** add it in this PR — the owner was told and has not asked for it. If he asks,
it is cell 3's sibling and `Intl.DisplayNames` already renders names in `components/reader/TranslateSheet.vue`
(`languageName`), which should be lifted out rather than copied.

## e2e and test ids: the honest cost

`book.genres`, `book.genre`, `book.goodreads*`, `book.about`, `book.description`, `book.more`, `book.state`,
`book.since`, `book.add|start|read|readAgain|updateProgress`, `book.notInLibrary` all stay where they are.

**`book.facts` and `book.factsLoading` disappear, and eight assertions across five specs read them.** This is
the part of the plan that is easy to get wrong, so it is spelled out:

| file | lines | what it asserts today | what it must assert |
|---|---|---|---|
| `web/e2e/first-published.spec.ts` | 48–49 | `book.facts` contains the work's year, not the edition's | cell 1 contains `FIRST_YEAR`; cell 2 does **not** contain `FIRST_YEAR` |
| `web/e2e/first-published.spec.ts` | 51–52 | `book.thisEdition` has the `This edition: Penguin, <year>` sentence | now the block's label-plus-value; the `{publisher}, {year}` halves are still both asserted |
| `web/e2e/first-published.spec.ts` | 59–60, 74 | the G1 fallback and the no-work case: `book.thisEdition` absent | unchanged semantics, new id if the id moves |
| `web/e2e/first-published-shots.spec.ts` | 50–51 | `book.facts` holds the year, `book.thisEdition` is visible | both on the block |
| `web/e2e/google-books.spec.ts` | 97 | `book.facts` contains `2019` | the block's first cell |
| `web/e2e/search-and-add.spec.ts` | 57 | `book.facts` contains `2020` | the block's first cell |
| `web/e2e/bookOpenFlows.ts` | 151, 164, 182 | the facts skeleton is visible, then lands in the same box (`facts.top` within 1 px) | the block's skeleton (`book.thisEditionLoading`?) and the block, same rule |

The box-stability test in `bookOpenFlows.ts` is the one that is a real design constraint rather than a rename:
the hero must not move when the Book's answer arrives. The facts row was the line that landed in the same box;
the block under About is **below** everything the test measures, so its placeholder (if any) must not change the
hero's height. Today the About section keeps its skeleton (`book.aboutLoading`) and no facts placeholder exists
in the hero, so the cleanest reading is: drop the facts placeholder entirely, and let the test compare the hero's
three boxes it still has.

Suite files to run from `web/`: `pnpm test:unit`, `pnpm test:components`, `pnpm exec playwright test
e2e/first-published.spec.ts e2e/bookOpenFlows.ts` (needs the stack, `docs/TESTING.md`).

## Where the code goes

- `web/app/pages/book/[key].vue` — the two deletions in the hero; the block as its own component.
- `web/app/components/book/Meta.vue` (**new**) — props `{ book, entry }`, derives its own rows, owns
  `data-testid="book.thisEdition"`; `BookLinks` inside it as the last row, unchanged.
- `web/app/components/book/Links.vue` — gains nothing structural: it loses its centring (the block is
  left-aligned in a grid) and its label stays the nav's accessible name. Its `More` / `Less` folding is
  **removed** in favour of wrapping dots, which is what the mock shows: five links wrap to rows, no button.
  Its `book.linksMore` id and the flow that uses it go with it (check `web/e2e` for it before deleting).
- `docs/parity.md` — the Book page's layout section gains the block in one sentence.

## Not in this PR

- **Language** in the block (see above).
- Any change to `editionLine`/`firstPublishedYear` or their tests.
- The status line's stars. The mock leaves them where they are; the README's last section says why it is a
  separate decision.
- Light-theme shots of the mock. Dark only, the owner's call.
