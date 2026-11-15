# The 96 unmatched imports: can Google Books or DNB give them a work?

Feasibility note, 2026-11-15. Investigation only: no code, no migration, no production writes.
**Revised after measurement: the ISBN→Wikidata route this note originally proposed does not work
(§2.2, §4.1). The verdict is §2.5: accept the gap.**
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
The only onward path is ISBN → Wikidata (P212/P957) — which §2.2 shows does not resolve;
never volume id → anything.**

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

Then — only at step 4b, *after* the work question is settled — `googleGenres(isbn13)`
(`enrich.ts:336-347`): one call to the `google-books`
function that returns **only the app's genre ids** (`index.ts:43-56`:
`answer.volume.genres.filter(isGenreId)` — title, authors, year are thrown away).
The DNB function is never called from enrich at all (no `dnb` import anywhere under
`supabase/functions/enrich/`).

So the crux, confirmed and still standing: **for the 96, step 1 finds no Open Library edition
(no `/isbn/…​.json` for these ISBNs, or a title mismatch), step 3's German title + author query
finds nothing in a thin Open Library, and Google/DNB — which both index these ISBNs — are never
consulted for matching.** That gap is real and this note keeps it.

**But "ask them" is not a fix, which is what the first revision concluded too fast.** Consulting
them resolves the *edition* — a title, some authors, a print year, all of which the Book already
has — and the next section shows the edition still leads nowhere (§2.2–2.5). The missing thing is a
work, and no source here names one. §4 says what changes if that ever becomes untrue.

## 2. Does a resolved edition lead to a work?

Three candidate bridges, in cheapest-first order.

### 2.1 Google volume id / DNB idn → work: no

Neither identifier appears in any matching code, and neither authority defines a
work-level entity the other sources recognise. Dead end for both; do not build on ids.

### 2.2 RETRACTED — ISBN → Wikidata (P212/P957) does not fire

> **Do not implement the clause below; it does not fire.** It is quoted here only so the record
> shows what was proposed and why it failed. The API call works, the syntax is the documented
> one, and it still returns nothing — because Wikidata does not hold these ISBNs (measurement
> below). Copying it into `enrich.ts` would add a request per Book and a dead branch.

```ts
// PROPOSED IN THE FIRST REVISION OF THIS NOTE. DOES NOT WORK. DO NOT IMPLEMENT.
if (!candidates.length && book.isbn13)
  candidates.push(...(await sources.wdSearch(`haswbstatement:P212=${book.isbn13}`, 5)))
if (!candidates.length && book.isbn10)
  candidates.push(...(await sources.wdSearch(`haswbstatement:P957=${book.isbn10}`, 5)))
```

What the first revision assumed: that Wikidata items carry ISBNs (P212 ISBN-13, P957 ISBN-10) on
edition items, so `haswbstatement:P212=<isbn13>` would enter the existing edition→work→P577 walk
(`enrich.ts:241-245`) with no new source. The reasoning was sound about the *mechanism* — see the
`P648` control — and wrong about the *data*.

**The measurement (the owner's, 15 Nov 2026).** The same search operator that the code already
relies on (`enrich.ts:225`, `:232`, `:481` — all `P648`/`P31`) works on a work:

```
haswbstatement:P648=OL52114W        → 1 hit       ✅  (a work by its OL key, as wikidata.ts:9 documents)
```

The proposed property returns nothing, **for every ISBN, including famous controls**:

```
haswbstatement:P212=9783426528624  → 0 hits    (one of the owner's own books)
haswbstatement:P212=9783426528617  → 0 hits
haswbstatement:P212=9783736319844  → 0 hits
haswbstatement:P212=9783734726989  → 0 hits
haswbstatement:P212=9780743273565  → 0 hits    (Fahrenheit 451 — control)
haswbstatement:P212=9780593135204  → 0 hits    (Project Hail Mary — control)
```

Ruled out by the same measurement, so none of it needs re-testing: `list=search` works at all
(`Harry Potter` → 2607 hits); the API is reachable (`wbgetentities&ids=Q42` → HTTP 200); the quoted
value form `haswbstatement:P212="…"` also returns 0; SPARQL `?item wdt:P212 "9780593135204"` returns
0 bindings; `wbsearchentities&search=<isbn>` answers `success: 1` with no results. So it is neither
a syntax slip nor an outage: **ISBN→Wikidata by statement does not resolve from here.**

### 2.3 Which cause — and the real one, from the code and one further probe

The brief offered three candidates. The code and the measurement together rule out two of them and
confirm a fourth, sharper one.

**`wikidata.ts` never searches ISBNs, and says so.** Its header comment (`wikidata.ts:1-13`) is the
complete list of what the module asks Wikidata, and it contains no ISBN property:
`wbgetentities` for a work or an author; `search` for `haswbstatement:P648=OL…W` and
`<title> haswbstatement:P50=Q…` (`:9-10`); SPARQL for an author's or a series' works (`:11-12`).
There is no `P212`, no `P957`, anywhere in `supabase/functions` — so nothing in the app has ever
read an ISBN off Wikidata, and the proposed clause would have been the first. That is why
`enrich.ts:224-233` has no ISBN entry point: the module's design assumes a work is reached by its
Open Library key, by title+author, or by SPARQL — never by its ISBN.

- **Not "the index does not cover ISBN-valued statements".** The first revision guessed this. It is
  wrong, and a second probe shows it: Wikidata holds **376,164** `wdt:P212` statements
  (`SELECT (COUNT(*) AS ?c) WHERE { ?item wdt:P212 ?isbn }`, 15 Nov, SPARQL). The property is
  populated at scale and indexed.
- **The values are hyphenated, which explains the 0 for a bare ISBN — but is not the whole story.**
  Sampled `wdt:P212` values are `"978-85-94066-06-0"`, `"978-84-949170-9-7"`, `"978-1-7373725-0-9"`:
  Wikidata stores ISBN-13 with hyphens, and `haswbstatement:P212=978…` (15 digits, as the clause
  passes it) is not an equal value. Confirmed directly: a hyphenated ISBN taken from the sample
  returns **1 hit** (`haswbstatement:P212=978-85-94066-06-0` → `Q127693809`) where the bare digits
  returned 0. So the clause as written was doubly wrong, and hyphenating it would still not help.
- **The actual cause: these editions are not on Wikidata at all.** With the hyphens stripped in the
  query (`FILTER(CONTAINS(STR(?v), "<isbn>"))`, hyphen-agnostic), **all ten of the brief's ISBNs
  return 0 items** — and so do both controls. Fahrenheit 451 is instructive: Wikidata has six items
  labelled "Fahrenheit 451" in English (Q202009, Q261546, Q423421, Q1392326, Q2139590, Q39069893)
  and **not one carries a `P212`**. This is a work-level encyclopaedia: works get items and
  `P577`, print editions mostly do not, and `P212` lives on the minority of editions that do.

So: **Editions of German indie romance — the 96 — are not modelled on Wikidata.** Not "thinly": the
ten measured, and both famous controls, are absent. This is the "the data, not the index" answer,
and it is the strongest version of it.

### 2.4 DNB → GND → Wikidata: still no usable path in this codebase

Unchanged from the first revision, and it survives the retraction: the DNB record as parsed
carries no GND identifier (§1.2 — no `gnd` parsed from the SRU XML, and the `oai_dc` schema
asked for, `dnbRecord.ts:158-162` `recordSchema: 'oai_dc'`, does not expose authority links the
way MARCXML would). Even if it did, nothing maps GND work ids → Wikidata here, and Wikidata's
GND property (P227) is about *persons and corporate bodies*, not works. Pursuing it means
MARCXML parsing plus a new mapping for a strictly worse bridge than one that already fails.

### 2.5 Is any route to a work left? Weighed honestly — no.

Cheapest first. All three die.

**(a) Google/DNB resolve the edition → search Wikidata by title + author.** This is what
`enrich.ts:227-233` already does — `searchTitle(book.title) haswbstatement:P50=<authorQid>`,
five candidates, guarded by the title check at `enrich.ts:246-253`. It fails today for these
books. Would a DNB-authoritative German spelling of title and authors behave differently?
**Probably not.** Three reasons, in order of weight:

- `searchTitle` (`match.ts:37-39`) strips only parentheses and everything after `:`/`;`/` - `.
  It does not fold case, diacritics, or German orthography; the search is therefore already
  close to DNB's spelling for titles like *A place to grow: Roman* → `A place to grow`. A better
  spelling has little left to fix.
- The failures are not spelling failures. Probed directly (15 Nov): `A curse unbroken` → **0
  hits**, `24 Days till Home` → **0 hits** on Wikidata search, while `A place to grow` → 122 hits
  and `A summer to remember` → 24 hits that are **a 1995 film, a song, a 1985 film, a 2018 TV
  film, a 1960 film** — everything except a book by that title. The items do not exist or are
  drowned; a different spelling of the same absent title changes nothing.
- The author leg is the weaker half: `findPersonQid` (`enrich.ts:403-412`) needs a Wikidata
  human (P31=Q5) whose label matches the author's name, so a German indie romance author with
  no item drops the whole query regardless of how well the title is spelled.

So (a) is not dead in principle — it is dead **for these books**, and DNB's better spelling does
not revive it. Do not build it.

**(b) SPARQL by ISBN against edition items, then P629 to the parent.** This is where the
measurement is decisive, and it kills the route. The owner measured `wdt:P212` returning nothing
for a known ISBN; the follow-up probe here shows why that is fatal rather than a query slip:
with hyphens stripped, **all ten ISBNs return 0 items, and so do Fahrenheit 451 and Project Hail
Mary**. There is no edition item to climb `P629` from. The `P629` walk in the code
(`enrich.ts:241-245`, `isEdition` at `wikidata.ts:346-348`) is correct and would work — it has
nothing to walk. **Route (b) is dead, not "unverified".**

**(c) Accept the gap.** With (a) and (b) gone, this is the recommendation. See §4 and §5.

What is *not* claimed: that no route exists anywhere. A future German-market source with
work-level ids would change this, and nothing here rules it out. It rules out the two routes the
app's own sources can reach today.

## 3. What the retracted chain would have cost (kept for the record)

The chain is dead (§2.2), so nobody implements it. Its cost is recorded only because the two budget
facts below are reusable for any *future* attempt, and because "it was cheap" was part of why the
first revision recommended it — that reasoning should be visible and corrected.

Per book, the retracted P212 chain — all Wikidata, no key, no quota:

| # | Call | Cost |
|---|---|---|
| 1 | `wdSearch('haswbstatement:P212=<isbn13>')` (CirrusSearch) | 1 Wikidata HTTP request |
| 2 | `wdEntities(candidate ids, ['labels','claims'])` | 1 request per 50 ids (`sources.ts:34-43`) |
| 3 | If the item `isEdition`, `wdEntities([editionOf[0]])` for the parent | 1 more worst case (`enrich.ts:241-245`) |

~3 Wikidata requests per book, zero budget, ~200–300 requests for 96 books. **Cheap was never the
problem; empty was.** A cheap dead branch is worse than no branch: it spends a request per Book
forever and never adds a work.

The edition-resolve legs, which a future attempt would still pay:

- **Google:** one `google-books` `action:isbn` with `purpose:'enrich'`. Cache first:
  `google_books_cache` (`20261115010000_google_books.sql:5-13`, table at `:30-44`) serves a found
  answer up to 24 h (`MAX_FOUND_TTL_SECONDS`, `handler.ts:117`) and a miss for 6 h
  (`MISS_TTL_SECONDS`, `handler.ts:119`). A live call counts against `DAILY_BUDGET = 900` **and**
  the enrich slice `ENRICH_DAILY_BUDGET = 300` (`handler.ts:102,108,221,323`). 96 uncached ISBNs =
  96/300 — a third of a day's enrich slice, **sharing it** with the step-4b genre calls
  (`enrich.ts:339-347`), which fire for every genre-less Book after a big import.
- **DNB:** one SRU call per ISBN. No response cache is wired in the dnb-lookup handler/client;
  every call goes out behind the shared pace of 5 requests/second across instances
  (`dnb-lookup/client.ts:3`, `index.ts:36-37`) — 96 books ≈ 20 s minimum spacing. Member throttles
  (30/min, import 120/min, `handler.ts:59-73`) do not apply to the service role.

So a future edition-resolving attempt is affordable — a third of one day's enrich slice plus free
Wikidata calls, no new quota, secret, table or function. Affordability is not the blocker. The
absence of a work to link to is.

## 4. The proposal

**Recommendation, revised: accept the gap. Implement nothing.** There is no work to link these 96
Books to through any source the app already runs (§2.5). The section below records the retraction,
then the two findings that survive it and would carry any future attempt.

### 4.1 The proposed path, retracted

The first revision put a clause in `enrich.ts` step 2 (`enrich.ts:224-233`), where Wikidata
candidates are gathered. **It does not fire — do not implement it.** It is preserved as a quotation
in §2.2 and nowhere else; there is no code block here to copy.

Why it failed is §2.3: not the syntax, not the index, but the data. Wikidata carries 376,164
`P212` statements and none of the ten measured ISBNs (or either famous control) among them.

The one thing the first revision got right about the mechanism, worth keeping: *if* a route to a
work is ever found, `enrich.ts:224-233` is exactly where it plugs in, and nothing downstream would
need touching — the edition→parent walk (`enrich.ts:241-245`), the title guard that discards
wrong-item hits (`enrich.ts:246-253`), `parseWork`/`isEdition` (`wikidata.ts:266-300,346-348`), and
the generic `searchUrl` (`wikidata.ts:26-39`) and the `wdSearch` built on it (`sources.ts:50-52`, no
ISBN knowledge, so a work finding would plug in without touching either). That is the shape of a
future fix, not a fix.

### 4.2 What must be recorded *if* a work is ever found

These two findings survive the retraction. They are not about P212, and they are what any future
attempt has to obey.

**No migration is needed, and the provenance value is constrained.** A work match must be recorded
as `matched_by = 'isbn'` (or `'openlibrary'`) and **never `'title'`**:

- The CHECK constraint already allows it — `20261011011000_authors_works_series.sql:206-209`:
  `constraint book_works_matched_by check (matched_by in ('openlibrary', 'isbn', 'title'))` — and
  the payload type already allows it (`enrich.ts:87`:
  `matchedBy: 'openlibrary' | 'isbn' | 'title' | null`).
- Decisively, `private.book_work_key` (`20261116010000_book_notes.sql:322-334`, verified in the
  function body, `:330`) maps only two values to a work key:

  ```sql
  when b.owner_id is not null then null
  when bw.matched_by in ('openlibrary', 'isbn') then 'w:' || bw.work_id::text
  else 'b:' || b.id::text
  ```

  So `'title'` falls through to `'b:'`, i.e. the Book's own page rather than the Work's — notes and
  sections would not be shared with the Work's other editions. Any future match must write `'isbn'`
  or `'openlibrary'` for its key to work.
- **No new provenance value.** `'isbn'` is accurate and keeps the work key working; a new value
  would need a migration for zero information gain. So: **no migration.**

**`enrich` never asks Google Books or DNB at match time.** This is why the 96 exist, and it is
unchanged by the retraction. `enrich.ts:186-220` tries OL edition → OL ISBN → OL work → OL
title+author, and nothing else. `google-books` is called only at `enrich.ts:336-347`, **after** the
work question is settled, and `index.ts:40-55` keeps only `volume.genres` — title, authors and year
are discarded (`answer.volume.genres.filter(isGenreId)`). `dnb-lookup` is never imported anywhere
under `supabase/functions/enrich/`.

### 4.3 The backfill: existing machinery, not a new script

Recorded for a future attempt — there is nothing to backfill now, because there is no fix to run.
No new script is needed either way: `public.enrich_backfill(p_limit)` queues Catalogue Books never
enriched and `public.enrich_request(uuid)` queues one Book
(`20261011012000_enrichment_queue.sql:265,636`), drained by `enrich_claim` in the function or locally
via `supabase/functions/enrich/backfill.ts` (resumable, polite, report-first — that file's header
documents the recipe).

- Correction to the brief, still standing: the named precedent
  `web/scripts/backfill-page-counts.ts` **does not exist in this checkout** (`ls web/scripts` shows
  `cover-*`, `export-regal`, `import-*`, `reado`, no `backfill-*`; repo-wide grep for the name finds
  nothing). `enrich/backfill.ts` is the actual precedent.

### 4.4 What the page shows for the 96 if the gap is accepted

This is today's behaviour, unchanged and unpatched: no `book_works` row → no `first_year` → **the
Book page shows the edition's year.** For the ten sampled above that is 2022–2025 — the year that
edition was printed, not the year the work was first published.

Concretely, for the German romances in §0: *A place to grow* shows **2022**, *A place to love*
**2022**, *A place to shine* **2023**, *24 Days till Home* **2023**, *A summer to remember* **2025**.
Where a work has only ever had one edition, that is also the work's year and nobody notices. Where
a work was reissued, the page shows the reissue's year — a plausible-looking wrong answer, not an
error, and no worse than today.

The 28 `manual` Books already sit here by construction (§0.1). Accepting the gap means the 96 join
them: **128 of 848 Books show an edition year and no work link, and that is the end state.** No
regression, no special-casing, no partial fix left half-applied.

## 5. Coverage estimate: withdrawn

**The 30–60 of 96 estimate is retracted, and not replaced with a smaller number.** It rested
entirely on the P212 chain's hit rate, which was marked unverified then and is now measured at
**zero**: all ten sampled ISBNs return no Wikidata item at all (§2.3). A smaller estimate would be
a guess dressed as a result; the honest value for the chain is **0 of 96**, and for any route in
this stack it is **0 of 96**.

What the first revision got right, and what survives, is the edition-resolve column — both sources
do resolve these editions, and that part was never in doubt:

| Source | Edition resolve | Status |
|---|---|---|
| Google Books `action:isbn` | ~9/10 | plausible, untested — and **useless here**, it yields edition facts |
| DNB SRU `action:isbn` | ~all 96 | plausible, untested — and **useless here**, same reason |
| Wikidata P212 → edition → P629 work with P577 | **0/96 measured** | the route is dead (§2.2–2.3) |

Edition facts are what the Book already has. The missing thing was never the edition; it was the
**work**, and no source in this stack names one for these Books.

**So: is it worth it? No — there is no longer an "it".** The permanent fix that was "~10 lines plus
tests" would add a request per Book and find nothing. The recommendation flips from *fix it* to
**accept the 96**: they keep their edition's year (§4.4), exactly as today, and the proposal becomes
a record of a closed question rather than a plan.

The one condition that would reopen it: a source that identifies the **work** for German-language
trade and self-published editions. Neither Google Books nor DNB nor Wikidata does today, and
building one is out of proportion to the prize. If such a source appears, §4.2 is the contract it
must satisfy — `matched_by = 'isbn'` or `'openlibrary'`, no migration, and it plugs in at
`enrich.ts:224-233`.

## 6. The prepared calls: what they returned

Prepared in the first revision for the coordinator to run. **They were run on 15 Nov, and the
result is the retraction (§2.2).** Recorded here so the measurement is reproducible and nobody
re-prepares the same probe.

Ten ISBNs: `9783734726989 9783736319844 9783736320888 9783426528631 9783426528624
9783426528617 9783426528648 9783736321342 9783736321359 9783736321335`.

**A. Wikidata search by P212 — 0 hits for every ISBN, both controls included.** This is the one
that decided the question, and it needs no auth:

```text
https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P212%3D9783734726989&srlimit=5&format=json
```

Two corrections found while running it, both already folded into §2.3:

- **The stored values are hyphenated.** `haswbstatement:P212=978…` (bare digits, as this note
  originally prepared it and as the retracted clause passed it) can never match. The hyphenated form
  of a real value does match — `haswbstatement:P212=978-85-94066-06-0` → 1 hit, `Q127693809`.
- **Hyphenating does not rescue these ISBNs.** A hyphen-agnostic SPARQL probe
  (`?item wdt:P212 ?v . FILTER(CONTAINS(STR(?v), "<isbn>"))`) returns **0 items for all ten**, and
  for Fahrenheit 451 and Project Hail Mary too. There is no edition item to climb `P629` from.

**B. SPARQL, the shape a fix would use** — returns nothing, for the same reason:

```text
https://query.wikidata.org/sparql?query=SELECT ?item ?v WHERE { ?item wdt:P212 ?v . FILTER(CONTAINS(STR(?v), "9783734726989")) }&format=json
```

The population check that rules out "the index is the problem": `SELECT (COUNT(*) AS ?c) WHERE
{ ?item wdt:P212 ?isbn }` → **376,164**.

**C. Google Books and DNB — not run, and no longer worth running.** They would resolve the edition
(a `found` with title/authors/year), which was never the missing piece: edition facts are what the
96 Books already have. Their only value was supplying a better spelling for the title+author search,
and §2.5(a) shows that search fails on absent items, not on spelling. Running them costs enrich budget
(`DAILY_BUDGET = 900`, `ENRICH_DAILY_BUDGET = 300`, `handler.ts:102,108,221,323`) to confirm
something that cannot change the verdict. **Leave them unrun.**

## 7. What could not be verified

- **Why the 96 lack a work in production terms** — which of them lack an Open Library
  `/isbn/…​.json` versus fail the title guard. Both look identical from production reads (no
  `book_works` row); only the function logs distinguish them. Now moot: no route replaces either.
- **Whether some of the 96 do sit on Wikidata under a differently-formatted or mistyped ISBN**
  (a transposed digit, an ISBN-10 form). The hyphen-agnostic probe covered all ten against the
  exact digits; it did not fuzzy-match. A handful might hide there, but a route that finds a Book
  only when its ISBN is mistyped is not a fix, and nothing in the code could rely on it.
- **Whether step-4b genre calls already cached these ISBNs** in `google_books_cache`. Readable from
  the table, not read here. Irrelevant now.
- **Whether Wikidata's coverage of German indie romance improves.** It may; the measurement is a
  point in time (15 Nov 2026), and §5 names the condition that reopens the question.

Deliberately *not* listed as unverified any more: the P212 chain's hit rate (measured, zero), the
`haswbstatement` operator (works, on `P648`), and the edition-resolve rates (plausible, untested,
and irrelevant to the verdict).
- **The brief's `web/scripts/backfill-page-counts.ts` precedent is absent** (§4.3) —
  either renamed or never landed. `enrich/backfill.ts` covers the same shape.
