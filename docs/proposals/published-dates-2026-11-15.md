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
- **Translated works: which "first" does he want?** P577 on the work item is
  usually the *original-language* first publication (e.g. 1969 German, not the
  1972 English translation he may own). The work record may carry several
  dates across languages. **Product question — named, not decided.**
