# First published vs this edition: which date the hero shows

Assessment only. No code, no migration.

Owner's ask: the Book page hero says when the work first appeared; a quieter line
under the description says which edition this is and when *it* was printed.

## 1. What each date means, per source

### `books.published_year` — the edition's year (almost always)

One row of `public.books` is one **edition** (constraint `books_year_plausible`,
`supabase/schema-snapshot/tables/public.books.sql:24,51`). It is written once,
from the first snapshot that created the Catalogue row (`catalogue_book_for`,
`supabase/schema-snapshot/functions/public.catalogue_book_for(jsonb).sql:76-81`;
ISBN match wins over source-id match, an existing row is reused untouched).

What the snapshot carries depends on the source:

- **Open Library search** (`web/app/data/openLibrary.ts:165`):
  `yearOf(edition?.publish_date) ?? doc.first_publish_year`. The edition's
  `publish_date` first — but when the best edition names none, it falls back to
  the **work's** `first_publish_year`. So an OL-sourced Catalogue row sometimes
  already holds the work's year inside `published_year`. `yearOf` takes the first
  4-digit year in the string (`openLibrary.ts:101-106`).
- **Open Library work-edition list** (`openLibrary.ts:231`, issue #41 flow):
  `yearOf(edition.publish_date)` — edition only, no work fallback.
- **Apple** (`web/app/data/apple.ts:117-124`): first 4 digits of
  `item.releaseDate` — the ebook's store release date, i.e. this digital
  edition's date, not the work's.
- **Google Books** (`web/app/data/googleBooksRecord.ts:142`,
  `web/app/data/googleBooks.ts:47`, `supabase/functions/google-books/handler.ts:61`):
  first 4 digits of `volumeInfo.publishedDate` — per Google's docs, the
  **edition's** publication date.
- **DNB** (`supabase/functions/dnb-lookup/handler.ts:36`): carries a
  `published_year` — **unverified** which upstream field fills it (not read).
- **Catalogue check** (verification of an existing row,
  `supabase/functions/catalogue-check/check.ts`): Apple `releaseDate`
  (`check.ts:261`), OL edition `publish_date` (`check.ts:586`), first year found
  by `yearOf` (`check.ts:225`). What `catalogue_check_save` writes back to an
  existing row — **unverified** (save function not read; the `CheckResult`
  comment at `check.ts:236-248` says the row's own value is kept "only if
  plausible", but the SQL was not checked).

Net: `published_year` is the edition's year by construction, except for the OL
search fallback, which quietly substitutes the work's year when the edition
names none. That fallback is itself a source of "wrong year" reports in both
directions.

### `works.first_year` — the work's year (Wikidata preferred)

One row of `public.works` is one **work** (`..._authors_works_series.sql:113`,
plausibility check at `:130`). Written by `private.enrich_work`
(`supabase/schema-snapshot/functions/private.enrich_work(jsonb).sql:43`):
`first_year` is set from the payload's `year` when present, else kept.

The payload's `year` (`supabase/functions/enrich/enrich.ts:361`):

```ts
year: work?.year ?? olWork?.year ?? null,
```

i.e. **Wikidata first, Open Library second**:

- **Wikidata**: `P577` (publication date) of the work item
  (`supabase/functions/enrich/wikidata.ts:291`, `yearOf(time(entity, 'P577'))`).
  When the matched item is an edition/translation rather than the work, enrich
  climbs via `P629` (edition of) to the parent and takes the parent's date
  (`enrich.ts:243-252`). The item must title-match the Book, else it is
  rejected (`enrich.ts:246-251`) — this is the guard the earlier "two different
  works" confusion was about.
- **Open Library**: the work record's `first_publish_date`
  (`supabase/functions/enrich/openlibrary.ts:122-127`), falling back to the
  search doc's `first_publish_year` (`openlibrary.ts:215`).

So `first_year` is the work's first-publication year as Wikidata states it
(P577 on the work item), else as Open Library states it. It is **not** exposed
to any screen: no `first_year`/`firstYear` occurs anywhere under `web/app/data/`
(grep, this assessment). The one read path that already carries it is
`work_card` (`public.work_card(uuid,text,numeric).sql:15`: `'year',
w.first_year`), used by author pages and series lists — which is why those rows
already show the work's year while the Book page hero shows the edition's.

The C3 note on Wikidata preference and same-title different works, cited in the
brief (`docs/plans/book-notes.md`, `pi-orca-setup/docs/`), was **not found**:
`book-notes.md` contains no mention of it and `pi-orca-setup/docs/` does not
exist in this checkout — **unverified, needs locating before it is cited**.

## 2. How often each is wrong or missing (structural only — no production data)

No production query was run. Everything below is what the code implies.

### `published_year` on the way in

- A member adding a Book sends a snapshot; `catalogue_book_for` inserts it as
  the row's `published_year` on first creation. The columns each source fills
  are listed in §1: Apple never sends publisher/language/pages (only the
  release year), OL search sends edition date with work-year fallback, Google
  sends the edition's date.
- Whether anything ever **rewrites** it afterwards is **unverified**:
  `catalogue_check_save` was not read. `catalogue_book_for` itself never
  updates an existing row (insert-or-find). Manual books go through
  `add_manual_book` and imports through `import_book_for` — both **not read**;
  what year those carry is unverified.
- Failure modes this leaves real: (a) the source gave the edition's year and
  the owner compares it against the work's — the reported complaint, working
  as built; (b) the OL fallback case in reverse — a row whose `published_year`
  is secretly the work's year while the edition is decades younger; (c) Apple
  rows where the "year" is a re-release date of an old work as an ebook.

### `first_year` coverage

- A work row exists only where enrich ran and matched. `enrich_save`
  (`supabase/schema-snapshot/functions/public.enrich_save(jsonb).sql:31-46`)
  links `book_works` with `matched_by` openlibrary/isbn/title, and
  `book_work_key`
  (`supabase/schema-snapshot/functions/private.book_work_key(uuid).sql`)
  returns **null for owner books** (Manual books never get a work) and
  `'b:<book>'` for title-only matches (no work row either). So: Manual books
  and unmatched editions have **no** `first_year`, structurally, always.
- Where enrich matched via Wikidata, the year is P577 on the work item —
  reliable subject to Wikidata's own dating (reprints sometimes carry their
  own item; the P629 climb handles the edition-item case, not the
  duplicate-work-item case).
- Where Wikidata has no item or no P577, the year is OL's `first_publish_date`
  — Open Library's earliest-known-edition date, which for obscure works can be
  the earliest *catalogued* edition, not the true first.
- Null handling today: `first_year` is nullable with no default; anything
  reading it must treat absence as normal (Manual books, unmatched editions,
  works with no date in either source).

### Situations this leaves unsolved (even after the fix)

- An edition whose source gave the edition's year: solved by the proposal
  (hero stops using it).
- A work whose `first_year` is null: needs the fallback (§3) or the hero goes
  dateless.

## 3. What it would take to show both

### Read path

The Book page's `Book` comes from PostgREST on `books` (`BOOK_COLUMNS` /
`LIST_BOOK_COLUMNS`, `web/app/data/library.ts:380-393`; mapped at
`bookFromRow`, `library.ts:434-439`: `year: row.published_year`). `first_year`
lives on `works`, reachable only via `book_works`. Three ways to carry it:

1. **PostgREST embed** — add `works:book_works(work:works(first_year))`-style
   columns to `LIST_BOOK_COLUMNS`/`BOOK_COLUMNS`. No migration (client-side
   column list; `tests/library.test.ts` compares the lists against the table —
   that test will need its expectation extended, not weakened). Cheapest, rides
   the existing `repo.book()` call in `stores/book.ts` `resolve`.
2. **`work_card` join** — `work_card` already returns the work's year, but it
   is the author-page/series card shape (`web/app/data/enrich/works.ts`),
   keyed by work, not the page's Book. Wrong tool; do not reuse.
3. **Separate lookup by work** — a second query (`book_work_key` then
   `works.first_year`). Two round trips for what one embed does. Fallback
   option only.

Option 1 is the proposal: extend the column lists, map `firstYear` onto `Book`
/ `BookSnapshot` next to `year`.

`BookSnapshot.year` stays the edition's year; a new optional `firstYear`
carries the work's. Keeping both on the type means every other screen keeps
today's behaviour until it opts in.

### Write path

Nothing to write: `works.first_year` is filled by enrich (`enrich_work`) for
every matched work. Gaps are structural (§2): Manual books and title-only
matches have no work row. Filling those needs an enrich run against a member's
own data — out of scope for display; the UI must handle null (below). No new
Wikidata lookup is proposed: where enrich matched, the year is there; where it
did not, a display-time lookup would be a new pipeline, not a line.

### UI

- **Hero** (`web/app/pages/book/[key].vue:158-172`, `facts` computed): the
  first fact becomes `b.firstYear ?? b.year` — the work's year, falling back
  to the edition's when the work's is unknown (today's behaviour, never a hole
  where today shows a date). Label unchanged (bare year in the dotted row).
- **Edition line**: a new quiet line under the description ("About"):
  "This edition: {publisher}, {year}" — publisher and year both already on
  `Book`. New i18n keys: `book.thisEdition` (EN) / same key DE
  ("Diese Ausgabe: {publisher}, {year}"), with publisher-less and year-less
  variants collapsing to what is known (mirror the facts row's drop-null
  pattern). Component: inline in `[key].vue` under About, not a new
  `book/Facts` component — there is none; the facts row is inline in the page.
- **Null matrix**: `firstYear` set → hero shows it, edition line shows
  edition's year. `firstYear` null, `year` set → hero shows `year` (today),
  edition line shows nothing new (nothing to contrast). Both null → today's
  behaviour (facts row drops the year).

### Other screens showing a Book's year

`b.year` is drawn in: search `ResultRow` (`web/app/components/search/ResultRow.vue:74-76`,
edition's year plus `otherEdition` hint — correct as-is, it identifies the
edition found); author-page `WorkRow` (already the work's year via
`work_card` — correct as-is); Library rows/cards (edition's year of her copy —
arguably correct, it is *her* edition). The owner asked about the Book page;
the fix is one screen (the page) plus the shared `Book` type carrying one new
optional field. Whether Library rows should also show the work's year is a
follow-up, not this change.

## 4. Cost and breakage

- **Migration**: none. Read path is a client column-list extension plus
  `create or replace` on no function at all. `LIST_BOOK_COLUMNS`/`BOOK_COLUMNS`
  live in `web/app/data/library.ts`.
- **One screen**, not every screen (§3, last paragraph).
- **Tests that assert the hero year**: not enumerated — **unverified**. Grep
  for specs covering `[key].vue` facts/`bookFromRow` year mapping before
  implementing; they will need updating for the new `firstYear` field (additive,
  so existing assertions on `year` keep passing; only hero-content assertions
  change).
- **Offline cache**: the device keeps lists apart from descriptions
  (`stores/library.ts`); a new optional column flows through the same rows.
  Old cached rows lack it — the `??` fallback covers that.

## 5. Options and recommendation

**A. Hero shows `firstYear`, edition line below** (what the owner described).
Cost: one optional field on the read path, one fallback expression, one new
line with two i18n keys. The distinction he asked for becomes visible
everywhere the page is seen. When `firstYear` is null the hero silently shows
the edition's year — honest enough, but a purist notes the hero then means two
different things depending on data availability.

**B. Hero keeps `year`, labelled** ("This edition 2023" in the facts row, or a
second date beside it). No plumbing at all — but the hero then carries two
dates in a row designed for one, and the owner's actual complaint (the year he
sees is not the work's) is answered with more text rather than the right
number. Cheap and wrong-shaped.

**C. Hero shows whichever is older.** No new plumbing if both are already
present — but they are not both present on this path, so it needs the same
read-path work as A while silently conflating the two things the owner just
distinguished. A 2023 reprint of a 1956 novel would show 1956 without saying
which date it is; where the OL fallback already stored the work's year in
`published_year`, it adds nothing. **Probably wrong even though cheapest.**

**Recommendation: A.** It is the owner's ask, the plumbing is one optional
column, and the fallback keeps every null case reading well. Pair it with the
edition line always showing the edition's year (not conditional on a mismatch),
so the page never implies a precision it does not have.

### Needs the owner

1. **Translated works**: original-language first vs first-in-his-language (§2).
   Name it on the edition line later ("First published 1969 · German first
   edition" is a different feature); for now the hero shows P577 as stored.
2. **Edition line placement**: under the description (proposed) vs in the
   facts row. Proposed: under About, quiet, with publisher.
3. Whether Library rows should follow (no — one screen now, decide later).

## What I could not verify

- Which upstream field fills DNB's `published_year` (handler not read past the type).
- What `catalogue_check_save` writes back to `published_year` on existing rows.
- What year Manual books (`add_manual_book`) and imports (`import_book_for`) carry.
- The C3 note's location (cited paths do not contain it in this checkout).
- Which specs assert the hero year (grep before implementing).
- Any percentage of anything: no production read was run or attempted.
- **Translated works: which "first" does he want?** P577 on the work item is
  usually the *original-language* first publication (e.g. 1969 German, not the
  1972 English translation he may own). The work record may carry several
  dates across languages. **Product question — named, not decided.**
