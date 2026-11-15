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
