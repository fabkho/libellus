# The 96 unmatched imports: can Google Books or DNB give them a work?

Feasibility note, 2026-11-15. Investigation only: no code, no migration, no production writes.
This answers the coordinator's brief: whether the two sources the app already runs
(`google-books`, `dnb-lookup`) can give the 96 unmatched `import` Books a `book_works` row —
i.e. a work, i.e. a first-published year.

## 0. The breakdown (production numbers, taken as given)

Of the owner's 848 Books, 128 have no `book_works` row and therefore no `first_year`:

| Source | Books | Verdict |
|---|---|---|
| `import` | 96, all ISBN-13 | **Investigated below — the fixable gap.** |
| `manual` | 28, no ISBN | Structurally unfixable (see §0.1). |
| `apple` | 2, no ISBN | Out of scope of this brief. |
| `openlibrary` | 2, no ISBN | Out of scope of this brief. |

### 0.1 The 28 `manual` Books are structurally unfixable

`private.book_work_key` returns null for owner Books by design: an owner Book
(`books.owner_id is not null`) gets the key `'b:' || book_id` — its own page, never a
work — and `enrich_save` refuses member Books outright
(`20261116010000_book_notes.sql:322-332`; `20261011012000_enrichment_queue.sql:562-566`,
`owner_id is null` guard). So a manual Book never even enters the enrich path, and no
source could change that without redesigning what a manual Book *is*. Say so and move on:
**no proposal for the 28; they show the edition year, as today, by construction.**

### First ten of the 96 (from the brief)

```
9783734726989  24 Days till Home: Ein Adventskalender-Roman   (BoD, 2023)
9783736319844  A curse unbroken: Roman                        (LYX, 2023)
9783736320888  A fall to forgive: Roman                       (LYX, 2023)
9783426528631  A place to belong: Roman                       (Knaur, 2023)
9783426528624  A place to grow: Roman                         (Knaur, 2022)
9783426528617  A place to love: Roman                         (Knaur, 2022)
9783426528648  A place to shine: Roman                        (Knaur, 2023)
9783736321342  A spring to hope: Roman                        (LYX, 2024)
9783736321359  A summer to remember                            (LYX, 2025)
9783736321335  A winter to resist: Roman                       (LYX, 2024)
```

All German-language editions of indie/self-published romance and contemporary fiction
(LYX, Knaur, BoD) — exactly the segment where Open Library is thinnest.

## 1. What each source can return

### 1.1 Google Books: an edition, with identifiers — but no work id

`POST /functions/v1/google-books  { "action": "isbn", "isbn13": "…" }` returns
`{ status: 'found', volume }`, a `GoogleVolume` (`google-books/handler.ts:1-65` header;
type in `web/app/data/googleBooksRecord.ts:29-41`):

- `id` — **Google's volume id: "only ever used to tell two volumes apart"**
  (`googleBooksRecord.ts:31-32`). It is an edition key, not a work key: nothing in the
  codebase treats it as a Wikidata Q-id or an Open Library key, and Google defines no
  work-level entity at all.
- `industryIdentifiers` → parsed into `isbn13` / `isbn10` (`googleBooksRecord.ts:83-100`).
  Kept, and genuine edition identifiers.
- `title`, `authors`, `publishedDate` → `year`, `pageCount`, `language`, `publisher`,
  plus `genres` (the app's own ids mapped from Google's `categories`) and `coverUrl`.
  Everything about the *edition* — year is the edition's print year, not the work's.

What is asked for (`GOOGLE_FIELDS`, `googleBooksRecord.ts:22-23`):
`id, volumeInfo(title, authors, publisher, publishedDate, industryIdentifiers, pageCount,
categories, language, imageLinks/thumbnail)` — no description (terms forbid storing it),
no series, no edition count, no work link. **Conclusion for Google: the record resolves
the edition (title + authors + ISBNs), but carries nothing that identifies the work.
The only onward path is ISBN → Wikidata (P212/P957, §2.2), never volume id → anything.**

### 1.2 DNB: an edition, with a record id — but no work id

`POST /functions/v1/dnb-lookup  { "action": "isbn", "isbn13": "…" }` returns
`{ status: 'found', edition }`, a `DnbEdition` (`dnb-lookup/handler.ts:1-50` header;
type in `web/app/data/dnbRecord.ts:23-37`):

- `idn` — the DNB record number (`dnbRecord.ts:94,102`). It identifies the
  *bibliographic record* (one per edition manifestation), and the parsed `DnbRecord`
  (`dnbRecord.ts:17-32`) carries exactly: `idn`, `rawTitle`, `creators`, `publisher`,
  `year`, `language` (MARC `ger`/`eng`), `pages`, `isbn13s`, `subjects`.
- `editionFromRecord` (`dnbRecord.ts:153-166`) turns it into title / authors / isbn13 /
  publisher / year / language / pages. **No GND identifier, no work cluster, no link
  field of any kind is parsed or kept** — grep for `gnd` across `supabase/functions`
  and `web/app/data` finds only an Open Library author's `remote_ids` fixture
  (`enrich/fixtures/pratchett-small-gods.json:26`: `"gnd":"119252880"` sits on the
  *author* record, i.e. the person, and arrives via Open Library, not the DNB).
- The DNB is the authority for these ISBNs (legal deposit covers BoD/LYX/Knaur), so
  `not_found` is unlikely — but a "found" is still only edition facts.

**Conclusion for DNB: same shape as Google — resolves the edition (and for German
indie titles, more reliably than Open Library), but carries nothing a work can be
matched from. Its value in a chain is a second, authoritative title+authors spelling
for the Wikidata title search (§2.2), not a work id.**

### 1.3 Why the match fails today: enrich never asks either of them

The match path (`supabase/functions/enrich/enrich.ts:187-202`) is, in full:

1. Edition: `sources.olEdition(book.openlibrary_edition_key)` → else
   `sources.olEditionByIsbn(book.isbn13)` (`openlibrary.ts:36`, `/isbn/<isbn>.json`) →
   else by `isbn10`. With a title-mismatch guard (Dune Messiah's ebook filed under
   Dune, `enrich.ts:193-195`).
2. Work: `book.openlibrary_work_key ?? edition?.workKey` → `sources.olWork` →
   `matchedBy = 'openlibrary'` or `'isbn'` (`enrich.ts:198-201`).
3. Fallback: title + first-author search against Open Library (`enrich.ts:202-211`,
   `olTitleSearch`, `titleSearchUrl` at `openlibrary.ts:45`) → `matchedBy = 'title'`.

Then Wikidata (§2.2) — and only at step 4b, *after the work question is settled*,
`googleGenres(isbn13)` (`enrich.ts:336-348`): one call to the `google-books`
function that returns **only the app's genre ids** (`index.ts:43-56`:
`answer.volume.genres.filter(isGenreId)` — title, authors, year are thrown away).
The DNB function is never called from enrich at all (no `dnb` import anywhere under
`supabase/functions/enrich/`).

So the crux, confirmed: **for the 96, step 1 finds no Open Library edition (no
`/isbn/…​.json` for these ISBNs, or a title mismatch), step 3's German title + author
query finds nothing in a thin Open Library, and Google/DNB — which both index these
ISBNs — are never consulted for matching.** The fix is "ask them", not "find a new
source". The full volume/edition they return is available for free at match time;
today only genres are taken, and only as a last resort.

## 2. Does a resolved edition lead to a work?

Three candidate bridges, in cheapest-first order.

### 2.1 Google volume id / DNB idn → work: no

Neither identifier appears in any matching code, and neither authority defines a
work-level entity the other sources recognise. Dead end for both; do not build on ids.

### 2.2 ISBN → Wikidata direct (P212/P957), then P629/P577: the chain

Wikidata items carry ISBNs: **P212 (ISBN-13)** and **P957 (ISBN-10)** are standard
statements on edition items, and enrich already follows the other half of that path —
an item that `isEdition` (has P629 `editionOf`, or an edition type) is replaced by its
parent work, whose P577 (`yearOf(time(entity,'P577'))`) becomes the work's year
(`enrich.ts:241-245`; `wikidata.ts:346-348`, `parseWork` at `wikidata.ts:266-300`).
What is missing is only the *entry*: today Wikidata is entered via
`haswbstatement:P648=<OL work key>` (`enrich.ts:225`) or `title + P50=authorQid`
(`enrich.ts:227-232`, 5 candidates). **Nobody ever searches
`haswbstatement:P212=<isbn13>` / `P957=<isbn10>`** — grep for `P212|P957` across
`supabase/functions` and `web/app/data` returns zero hits.

So the chain exists and is short:

```
ISBN-13 → haswbstatement:P212 search → edition item → P629 → work item → P577 (year)
```

Two HTTP calls worst case (one CirrusSearch, one `wbgetentities` batched up to 50 ids
— `sources.ts:34-43`, `wdEntities` chunks of 50), both to hosts enrich already
queries politely (`enrich/http.ts:8-14`, one request at a time per host). No new
source, no new secret, no new budget: Wikidata has no key and no quota in this codebase.
The title check that guards the existing paths (`enrich.ts:246-253`, the item's title
must match the Book's or OL work's) applies unchanged — an ISBN hit on the wrong item
is discarded the same way.

Caveat (honest, no live data): whether the *edition items* for German indie romance
exist on Wikidata with P212 set is unverified — that is exactly prepared call #3 in
§6. Wikidata's coverage of 2022-2025 self-published German romance is plausibly
thinner than Google's or DNB's. The chain is real; its hit rate is not.

### 2.3 DNB → GND → Wikidata: no usable path in this codebase

The DNB record as parsed carries no GND identifier (§1.2: no `gnd` parsed from the
SRU XML, and the `oai_dc` schema asked for — `dnbRecord.ts:158-162`,
`recordSchema: 'oai_dc'` — does not expose authority links the way MARCXML would).
Even if it did, nothing maps GND work ids → Wikidata in the codebase, and Wikidata's
GND property (P227) is about *persons/corporate bodies*, not works. Dead end; do not
pursue without re-scoping to MARCXML parsing plus a new mapping — far more work than
the P212 chain for a strictly worse bridge.

### Verdict: (b), with a fallback to (a)

- **Primary: (b) — Wikidata is reachable by ISBN directly, without Google/DNB.**
  `haswbstatement:P212=<isbn13>` enters the existing edition→work→P577 path that
  `enrich.ts:241-245` already implements. Cheapest possible fix: ~2 Wikidata requests
  per book, no new budget, no new function.
- **Fallback/enrichment: (a) — Google/DNB resolve the edition**, giving a verified
  title+authors spelling (DNB especially, as the authority for these ISBNs) that feeds
  the existing *title + P50=authorQid* search (`enrich.ts:227-232`) when the P212
  direct hit misses. Costs one `google-books` `action:isbn` call (enrich slice) or one
  DNB SRU call per book — worth it only for the P212-misses, not upfront for all 96.
- Not (c): the sources do carry what a work can be matched from — the ISBN itself, on
  Wikidata. The 96 are not condemned to edition-year forever; but the hit rate needs
  the live calls in §6 before anyone promises a number.

## 3. What the chain would cost

Per book, primary chain (b) — all Wikidata, no key, no quota:

| # | Call | Cost |
|---|---|---|
| 1 | `wdSearch('haswbstatement:P212=<isbn13>')` (CirrusSearch) | 1 Wikidata HTTP request |
| 2 | `wdEntities(candidate ids, ['labels','claims'])` | 1 request per 50 ids (`sources.ts:34-43` chunks of 50) — 1 for our candidates |
| 3 | If the item `isEdition`, `wdEntities([editionOf[0]])` for the parent | 1 more request worst case (`enrich.ts:241-245`) |

**Worst case ~3 Wikidata requests per book, zero budget.** Wikidata has no key and no
counter anywhere in this codebase; the only throttle is politeness —
`enrich/http.ts` issues one request at a time per host, spaced apart
(`http.ts:8-14`, intervals at `http.ts:51-59`, default 200). For 96 books that is
~200–300 requests, i.e. minutes of wall clock inside a backfill, no quota touched.

Fallback (a), only for the P212-misses, per book:

- **Google:** one `google-books` `action:isbn` with `purpose:'enrich'`. Cache first:
  `google_books_cache` (`20261115010000_google_books.sql:5-13`, table at `:30-44`)
  serves a found answer up to 24 h (`MAX_FOUND_TTL_SECONDS`, `handler.ts:117`) and a
  miss for 6 h (`MISS_TTL_SECONDS`, `handler.ts:119`). A live call counts against
  `DAILY_BUDGET = 900` **and** the enrich slice `ENRICH_DAILY_BUDGET = 300`
  (`handler.ts:102,108,221,323`). 96 uncached ISBNs = 96/300 — **a third of a day's
  enrich slice, fitting in one day but sharing it** with the existing step-4b genre
  calls (`enrich.ts:336-348`), which fire for every genre-less book after a big import.
- **DNB:** one SRU call per ISBN. No response cache is wired in the dnb-lookup
  handler/client (no cache table referenced there, unlike google-books); every call
  goes out behind the shared pace of 5 requests/second across instances
  (`dnb-lookup/client.ts:3`, `index.ts:36-37`) — 96 books ≈ 20 s minimum spacing.
  Member throttles (30/min, import 120/min, `handler.ts:59-73`) do not apply to the
  service role.

**One run of 96 fits comfortably inside existing budgets** — worst case a third of
one day's enrich slice plus a few hundred free Wikidata calls. No new quota, secret,
table, or function is needed for the probe or the backfill. Schedule it off the genre
backfill's peak, or split across two days, and it disturbs nothing.

## 4. The proposal

**A permanent enrich path (small), plus a one-off re-enqueue of the 96 through
existing machinery. No migration. No new script.**

### 4.1 The path: one clause in `enrich.ts` step 2

In `supabase/functions/enrich/enrich.ts`, where Wikidata candidates are gathered
(`enrich.ts:224-233`): after the `P648` candidates fail and alongside the title
search, add — only when the Book has an ISBN and still has no candidates:

```ts
if (!candidates.length && book.isbn13)
  candidates.push(...(await sources.wdSearch(`haswbstatement:P212=${book.isbn13}`, 5)))
if (!candidates.length && book.isbn10)
  candidates.push(...(await sources.wdSearch(`haswbstatement:P957=${book.isbn10}`, 5)))
```

Everything downstream already exists: the edition→parent walk (`enrich.ts:241-245`),
the title guard that discards wrong-item hits (`enrich.ts:246-253`), the
`matchedBy = 'title'` fallback, and `parseWork`/`isEdition` in `wikidata.ts`
(`wikidata.ts:266-300,346-348`). No change to `wikidata.ts`, `sources.ts`, or any
function contract — `searchUrl`/`wdSearch` are fully generic.

- **Files:** `supabase/functions/enrich/enrich.ts` (~10 lines),
  `supabase/functions/enrich/enrich_test.ts` + one fixture (follow the
  `record_fixtures.ts` / `fixtures/` pattern) for: P212 hit → edition → parent work
  with P577; P212 miss → existing behaviour unchanged.
- **Size:** a clause plus tests. Half a day including review.
- **No migration:** write `matched_by = 'isbn'`. The CHECK constraint already allows
  it (`20261011011000_authors_works_series.sql:209`:
  `matched_by in ('openlibrary', 'isbn', 'title')`), the payload type already allows
  it (`enrich.ts:87`), and — decisively — `private.book_work_key` maps `'isbn'` (and
  `'openlibrary'`) to a `'w:'` work key while `'title'` falls through to `'b:'`
  (`20261116010000_book_notes.sql:322-332`). Do **not** add a new provenance value:
  `'isbn'` is accurate (the work was found by its ISBN) and keeps the work key working.
  A new value would need a migration for zero information gain.

### 4.2 The backfill: existing machinery, not a new script

No new script is needed. `public.enrich_backfill(p_limit)` queues Catalogue Books
never enriched and `public.enrich_request(uuid)` queues one Book
(`20261011012000_enrichment_queue.sql:265,636`), drained by `enrich_claim` in the
function or locally via `supabase/functions/enrich/backfill.ts` (resumable, polite,
report-first — that file's header documents the recipe). Queue the 96 by id,
drain, read the coverage report.

- Correction to the brief: the named precedent `web/scripts/backfill-page-counts.ts`
  **does not exist in this checkout** (`ls web/scripts` shows `cover-*`,
  `export-regal`, `import-*`, `reado`, no `backfill-*`; repo-wide grep for the name
  finds nothing). `enrich/backfill.ts` is the actual precedent — resumable,
  `--report`-first, same-shape guarantees the brief asked for. Do not recreate the
  missing file; use the enrich one.
- Google/DNB edition spelling as a permanent path: **not recommended now.** Keep the
  fallback manual — for the P212-misses only, resolve the edition via DNB (authoritative
  for these ISBNs) and retry the existing title+P50 search with its spelling. If the
  P212 yield disappoints, that is the follow-up; do not pay its complexity upfront.

### 4.3 What the page shows if a book stays unmatched

Today's behaviour, unchanged: no `book_works` row → no `first_year` → the Book page
shows the edition's year. The 28 manual Books stay there by construction (§0.1); any
of the 96 the chain misses joins them with no regression and no special-casing.

## 5. Is it worth it? (estimate — no production data behind it)

Explicitly a judgement, not a measurement:

| Source | Expected recall on these 96 | Basis (guess) |
|---|---|---|
| Google Books edition resolve | ~9/10 | In-print German trade ISBNs are Google's bread and butter |
| DNB edition resolve | ~all 96 | Legal deposit covers BoD/LYX/Knaur; SRU `num=` is exact-match |
| Wikidata P212 → edition item → P629 work with P577 | **~1/3 to ~1/2** | The weak link: 2022–2025 German indie romance is thinly modelled on Wikidata |

Expected work links: **roughly 30–60 of the 96**, with the rest staying edition-year.
Even the low end is worth it: the one-off cost is a third of one day's enrich slice
(or split across days for free), the permanent fix is ~10 lines plus tests, and it
keeps paying — every future German import stops leaking through the same hole.
There is no cheaper way to buy work links: the alternative (a German-market source
with work-level ids) does not exist in this stack, and building one dwarfs the prize.

## 6. Prepared live calls (for the coordinator — nothing run)

Ten ISBNs: `9783734726989 9783736319844 9783736320888 9783426528631 9783426528624
9783426528617 9783426528648 9783736321342 9783736321359 9783736321335`.

**A. Google Books** (counts the enrich slice; `$SERVICE_KEY` filled by the runner,
never printed — ten calls ≈ 3% of the slice):

```sh
curl -s -X POST "$SUPABASE_URL/functions/v1/google-books" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'content-type: application/json' \
  -d '{"action":"isbn","isbn13":"9783734726989","purpose":"enrich"}'
```

`found` → edition resolvable (title/authors spelling usable for the title fallback);
`not_found` → Google lacks it, try DNB; `unavailable` → note `reason`
(`not_configured`/`budget`/`blocked`/`error`) and stop — a `budget` answer poisons
the whole probe.

**B. DNB** (same shape, paced 5/s, no cache — space the ten ~1 s apart):

```sh
curl -s -X POST "$SUPABASE_URL/functions/v1/dnb-lookup" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H 'content-type: application/json' \
  -d '{"action":"isbn","isbn13":"9783734726989"}'
```

`found` → authoritative title/authors/year for the ISBN; `not_found` here would be
surprising (legal deposit) and worth reporting verbatim.

**C. Wikidata P212** (no auth, browser-ready — the chain's actual entry):

```text
https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P212%3D9783734726989&srlimit=5&format=json
```

Any hit → fetch its claims and follow P629, checking P577:

```text
https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q…&props=claims%7Clabels&languages=en%7Cde&format=json
```

Hit with P629 whose parent has P577 → the chain yields a year for that ISBN.
Hit with no P629 → dead edition item (report it; the title fallback is the only
route). No hits → P212 misses for that ISBN; count them — that count *is* the
coverage estimate §5 guessed at.

## 7. What could not be verified

- **Live hit rates everywhere.** No API was called from here; §5 is a marked estimate.
  The ten calls above turn it into a number in minutes.
- **Which of the 96 lack an Open Library `/isbn/…​.json` vs fail the title guard.**
  Both look identical from production reads (no `book_works` row); only the function
  logs distinguish them. Irrelevant to the fix — the P212 path covers both.
- **CirrusSearch `haswbstatement:P212` recall.** The operator is documented Wikidata
  search syntax and the codebase already relies on `haswbstatement:P648/P50`
  (`enrich.ts:225,232`); P212 indexing completeness for edition items is assumed, not
  shown.
- **Whether step-4b genre calls already cached these ISBNs** in `google_books_cache`
  (a hit would make the Google leg of the probe free). Readable from the table, not
  read here.
- **The brief's `web/scripts/backfill-page-counts.ts` precedent is absent** (§4.2) —
  either renamed or never landed. `enrich/backfill.ts` covers the same shape.
