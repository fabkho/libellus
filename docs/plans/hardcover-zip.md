# Hardcover "everything" zip import (plan only)

Why: Hardcover's export page offers three files: a Hardcover CSV, a Goodreads CSV and a zip with everything
(`manifest.json` → `"format": "hardcover-everything", "version": 1`). The import reads the two CSVs today
(`web/app/data/import/hardcover.ts`, `goodreads.ts`). The zip carries more than either: every read with
its date precision and progress, the exact edition (ISBN, format, pages, language, publisher), lists with their
order, books that are only on lists, and a cover address per book and edition. This plan maps the zip onto the
normalised row model (`rows.ts`), so after the device has read it nothing in the job changes except three
optional fields.

Evidence: one real export (a friend of the owner's: a third person's data, kept outside the repository, never
committed). **Counts only**: no title, name, review, list name, date or id from it is written here, in a test
or in a fixture. Fixtures are synthetic. The export's own `README.md` documents every file and field. That
document is the reference below, not the measured file.

Owner rules this follows: no review step, no source logos, the job does the work, the zip is the recommended
path, progress comes along, Hardcover covers are used. Lists: **option A (owner, decided)**: each list becomes
a Collection with the same name, a ranked list keeps its order, and a book that is only on a list goes onto
Want to read and into its Collection. That is the rule `add_to_collection` already applies to a Book that is
not in the Library.

## What the export holds (measured, counts only)

| | |
| --- | --- |
| Zip | 361 kB, 66 entries, flat (no folder), deflate; 2.07 MB inflated |
| Files the import needs | 11 (below), 1.46 MB of the 2.07 MB; `books.json` is the biggest at ~7 kB a book (cached tags and counts) |
| `user_books` | 26: 14 Read, 5 Currently Reading, 6 Want to Read, 1 DNF; 0 Paused, 0 Ignored |
| `user_book_reads` | 20: 14 finished (precision 1: 14), 5 open under Currently Reading, 1 open under DNF; 6 with `finished_at_precision` null; 0 paused |
| Progress | open reads: 5 of 6 with `progress_pages` > 0 and `progress` (%) between 0 and 100 (they agree to within 2 %), 1 with none; `progress_seconds` is 0, not null, on print reads (the README says null) |
| Ratings | 14, all on Read, half steps; 0 reviews, 0 private notes, 0 owned, 0 starred |
| Editions | 26 of 26 library books have `edition_id`; ISBN-13 on 25 (all checksum-valid), pages on 25, publisher on 24, language on 26 (3 languages); `edition_format` empty or null on 6; reading format "Read" on all 26 |
| Edition title differs from book title | 5 of 26 |
| Lists | 16, all hers; 2 ranked (every entry with a `position`), 1 empty; longest name 26 characters |
| `list_books` | 97 rows, 96 books; 85 books (86 rows) not in the library, 1 of them on 2 lists; 11 library books on lists; every row has an `edition_id`; 82 of the 85 have an ISBN-13 on that edition |
| `reading_journals` | 266, 71 of them `progress_updated`: the history. The current value is on the read |
| Cover addresses | `cached_image` `{id, url, width, height, color, color_name}`, every one on `assets.hardcover.app`: books 109/113, editions 123/127; library 26/26 (3 under 150 px on the short side), list-only 82/85 (11 under 150 px) |

## The files read, and what each maps to

Only these entries are inflated; the other 55 are never decompressed (fflate's `filter`):
`manifest.json`, `user_books.json`, `user_book_reads.json`, `books.json`, `editions.json`, `lists.json`,
`list_books.json`, `book_series.json`, `series.json`, `publishers.json`, `languages.json`. As a fallback, only when
an edition's and its book's `cached_contributors` are both empty: `contributions.json`, `authors.json`. The
statuses (1 Want to Read … 6 Ignored) and reading formats (1 Read, 2 Listened, 3 Both, 4 Ebook) are the
README's fixed ids, constants in the adapter, not read.

New pure module `web/app/data/import/hardcoverZip.ts`: `readHardcoverZip(bytes) → HardcoverExport` (the
JSON files, with limits) and `mapHardcoverExport(exp, today) → ImportFile` (one `ImportBook` per row,
`mapRows`'s dedupe and `otherKeys` reused). Every rule below reuses the CSV adapter's helpers (`importDay`,
`importRating`, `splitRatingReview`, `clipReview`, `isbnPair`, `collectionNames`, `languageCode`,
`hardcoverAuthors` rules), so the two cannot drift.

### A library book (`user_books` → `ImportBook`)

| Row field | From |
| --- | --- |
| `key`, `sourceId` | `importKey('hardcover', book_id, …)`: **the same key as the CSV's `Hardcover Book ID`**, so a zip after a CSV (or the other way round) adds nothing twice |
| edition | `user_books.edition_id` → `editions`; else the latest read's `edition_id`; else `books.default_physical_edition_id`; else none (the book's own `pages`, `release_year`) |
| `title` | the edition's `title`, else `books.title`; `splitSeriesTitle` as the CSV does. To confirm against the CSV (below): 5 of 26 differ |
| `series` | `book_series` with `featured` → `series.name` and `position` → `"Name, #n"` (what `hardcoverSeries` makes of the CSV) |
| `authors` | the edition's `cached_contributors`, else the book's, else `contributions` + `authors`: contribution `Author` or none counts; other roles (Translator, Editor, Narrator, Illustrator…) only when no author is left, the CSV's rule |
| `isbn13`, `isbn10` | the edition's `isbn_13`, `isbn_10` through `isbnPair` (a checksum still decides; `isbn_13_valid` is not trusted alone) |
| `pageCount` | the edition's `pages`, else the book's (`positive`) |
| `year` / `originalYear` | the edition's `release_year` (else the year of `release_date`) / `books.release_year`. The CSV has no original year, so this is a gain |
| `binding` | `edition_format` when set; else from `reading_format_id`: 2 → `Audiobook`, 4 → `Ebook`; else null |
| `language` | `languages.code2` via `languageCode` |
| `publisher` | `publishers.name` |
| `addedOn` | `date_added` (`importDay`) |
| `shelf`, `status`, `session`, `earlierReads`, `extraReads` | the reads, below |
| `shelves` → Collections | her lists holding the book (below), plus `Owned` when `owned` (the CSV's rule) |
| `session.rating` | `rating` (`"4.5"`) → `importRating` → quarters (½ star = 2 quarters); only on a finished read, as today |
| `session.review` | `review_markdown`, else `review_raw`, else `review` (HTML) through `plainText`; then `splitRatingReview` and `clipReview` |
| `coverHint` (new) | the edition's `cached_image`, else the book's: `{url, width, height}`, only on `https://assets.hardcover.app/…` and only with a short side ≥ 150 px (`MIN_COVER_SIDE`) |

Left out, as in the CSV: `private_notes`, `review_has_spoilers`, `recommended_by/for`, `starred`, `owned_copies`,
`position` (Want to Read order), privacy, `asin`. The spoiler flag is a candidate for both adapters later, if
`import_books` takes one; it is not part of this plan.

### Reads (`user_book_reads` → session, earlier reads)

Reads of the entry, ordered by `finished_at ?? started_at` (undated ones first). Days through `importDay`
(no later than today; a finish before its start drops the start, `dateInvalid`).

- **Precision → which day.** `finished_at_precision` 1 or null: the day as given. 2 (month): the 1st of that
  month, the day Hardcover itself writes, so the read counts in the right month and year. 3 (year): 1 January
  of that year, again Hardcover's own day: the right year, and January in the Months chart. BetterReads stores no
  precision, and the CSV export writes the same days, so a zip and a CSV of one account agree. 0 (unknown): a
  finished read **without** a day (`endedOn` null). It still counts as a read, but not in any month.
- **Read (3)** → Finished: the latest finished read is the session (start, finish, rating, review); the finished
  reads before it are `earlierReads` (up to `MAX_EXTRA_READS`); finished reads with no day at all add to
  `extraReads`. The CSV cannot express that last case.
- **Currently Reading (2)** → Reading: the open read (latest without `finished_at`) is the session, from its
  `started_at`, else `date_added`, else today; finished reads before it stay as earlier reads. **Progress** (below).
- **Paused (4)** → Reading, as the CSV (problem `paused`; `paused_at` is not kept: BetterReads has no pause).
- **Did Not Finish (5)** → Finished with the latest read `abandoned`: `endedOn` = `finished_at`, else
  `paused_at`, else null (as a CSV row without Date Finished). The rating is dropped (`abandonedRating`), and the progress is
  kept (the place she stopped; a closed session keeps its last value in BetterReads already).
- **Want to Read (1)** → Want to read, no reads (as the CSV). **Ignored (6)** → skipped (`notShelved`).

### Progress (new, for open and DNF reads)

BetterReads keeps one value on the session: `progress_page` or `progress_percent`, never both
(`20261003122500_reading_progress.sql`). Mapping, first that applies:

1. `progress_pages` > 0 and not past the row's page count → **page**. Past it, or no page count: go to 2.
2. `progress` strictly between 0 and 100 → **percent**, rounded to whole. This is also the audio case:
   `progress_seconds` has no column here, and Hardcover's percent already accounts for the length. Without a percent,
   `progress_seconds / editions.audio_seconds` when both are known.
3. Otherwise no progress (0 and 100 are not progress).

`session.progress: { page } | { percent } | null`. The write sets the session's columns and
`progress_updated_at` (import time) and **writes no `reading_progress_days` row**, so an import never marks
today as a reading day. When the Book the match found has fewer pages than the page, the database's own
`clamp_progress_page` applies, as for a later edition change. In the export: 5 of 6 open reads carry a page.

### Lists → Collections (option A)

- Her own lists only (`lists.user_id` = `manifest.user_id`). Lists she only contributed to belong to someone
  else and are left out. Names through `collectionNames` (≤ 80 characters, one per name in any case); a name
  she already has as a Collection is that Collection (`import_place_in_collections`, unchanged).
- A **library book** on lists gets their names in `shelves`, as the CSV's `Lists` column does today.
- A **list-only book** (85 in the export) becomes its own row: Want to read, `shelf` `Want to Read`, `addedOn`
  = the earliest `list_books.date_added`, the edition from `list_books.edition_id`, else the book's default.
  `shelves` = its lists. Problem code `fromList`, so the acceptance count can tell these rows apart.
  It is written like any Want to read row: the match, the cover stage, then the
  Collection. A book on two lists is one row in two Collections.
- **Ranked lists keep their order.** Collection entries are positioned (`collection_entries.position`) and
  `reorder_collection` exists, but the write phase appends in row order and one row can be on two ranked
  lists. So the file carries `collectionOrder: { name, keys[] }[]` (ranked lists only, by `position`, nulls
  last, then `date_added`). When the job has written every row, it reorders each such Collection once: her
  entries that were in the Collection before keep their places at the front, and this import's entries follow in
  rank order. Unranked lists keep write order.
- **An empty list** (1 in the export) still becomes an empty Collection. The file carries `emptyCollections:
  string[]`; the job creates each one (if missing) when it starts writing.

### Hardcover CSV parity

The zip gives at least every field `hardcover.ts` maps: Title, Series, Author with roles, Status (all six),
ISBN 13/10, Pages, Publish Date year, Publisher, Language Code, Media/Binding, Lists (+ Owned), Date Added, Date
Started/Finished per read, Rating, Review, Hardcover Book ID as the key. It adds: date precision, undated reads,
progress, original year, list-only books, list order, empty lists, covers. A parity test maps one synthetic
account through both a synthetic zip and the CSV the same account would export, and expects equal rows for
every CSV field. The Goodreads CSV from Hardcover stays on the Goodreads adapter. Its keys differ from
`hardcover:` keys, so a member who imports both formats is protected by the title index (#104): no duplicate
Books.

## Picker, detection, errors, limits

- **Picker**: `accept=".csv,.zip,text/csv,application/zip"` in `pages/import.vue`, and the button becomes
  `import.choose` "Choose file". The bytes decide, not the name: `PK\x03\x04` → the zip path, anything else
  → the CSV path as today (`parseExport`).
- **Unzip on the device** with **fflate**: already a dependency (`web/package.json` `^0.8.3`, MIT, used by
  `data/ebooks/epub.ts`), so there is no new package or licence. `hardcoverZip.ts` is loaded with a dynamic
  `import()` only when a zip is picked; PR 1 measures what it adds to that chunk. Uses fflate's async `unzip`
  (off the main thread) with a `filter` that admits only the files above. An entry may sit at the root or one
  folder deep, for a member who re-zipped the folder.
- **Limits** (against zip bombs and memory; the real export is far below every one): file ≤ 50 MB; ≤ 1,000
  entries in the central directory; each admitted entry's declared size ≤ 64 MB and the admitted total ≤ 160 MB
  (checked in `filter`, before inflating); an entry that inflates past its declared size fails (fflate inflates
  into a buffer of the declared size: PR 1 proves it with a lying-header fixture). After parsing, the existing
  upload limits stand (≤ 10,000 rows, 20 kB a row, 5 MB together, `rows_invalid`).
- **Errors** (`import.fileError.<code>`, `importUpload.ts`):
  - a zip with no `manifest.json`, or another `format` → `zipUnknown`;
  - `version` ≠ 1 → `zipVersion` (refuse; the CSV export still works);
  - a needed file missing → `zipMissing` (names the files);
  - over a limit → `zipTooBig`;
  - JSON that does not parse, or a file that is no array → `unreadable`;
  - no books in `user_books` and no list-only book → `empty`;
  - neither zip nor CSV → `notCsv`, with its copy widened.

## What stays out

Journals (`reading_journals`, including the 71 progress updates: BetterReads keeps the latest value and
`reading_progress_days` only for the last weeks; a backfill would invent reading days, so not now), activities,
goals, vibes and vibe signals, tags and taggings, follows, likes, pins, prompts and answers, rankings and tier
lists, groups, posts, settings, profile, images, characters, countries. None of these files is inflated.

## Covers from Hardcover

**Host**: `assets.hardcover.app`, a fixed host behind Cloudflare (`server: cloudflare`, `cf-cache-status:
DYNAMIC`). **Measured** (7 library covers of the export, one residential address, 2026-10-31): JPEG every time,
26–160 kB (median 73 kB), 321–800 px wide (median 371), 0.29–0.78 s whole request (median 0.36 s); no
resizing (`?w=200` returns the same bytes); no CORS header; no referer check. That is one image per address,
like Goodreads.

**Terms**: Hardcover's API docs: "Images on Hardcover are uploaded by users … If you use any images … and
those images are open to the public, make absolutely sure you have a DMCA takedown policy listed on your site."
The export hands the member her own data with these addresses. The images are publishers' covers that members
uploaded, the same position as Goodreads covers. Hardcover's API docs say it makes "no copyright or proprietary
rights over this data". **Owner-accepted risk**, like the Goodreads and *Own covers* rows (private app, a few
friends, one copy per Book a member holds, server side, paced). Covers do become public on reading pages
(`/r/`, gated by `cover_shown` → `cover_allowed`). Hence the first open question.

**Where the cover goes**: the device puts `coverHint` on the row, and the job uses it without a request.

- **Rank**: right after the matched edition's own cover when that edition was found by ISBN (the same
  edition), and before `lent`, Open Library and Goodreads. Hardcover's image is of the edition she has.
- New `cover_source` `hardcover`, decided when the match is saved (as `edition`), so it never waits on the
  Goodreads pace. New counter `import_jobs.cover_hardcover`.
- The row's `cover_url` is the Hardcover address; the stored copy follows from the owned-covers reconcile as for
  any Book.

**Allowlists, one host each** (DNS rebinding is no issue: a fixed, allowlisted public host, as
`i.gr-assets.com`; the v1 exclusion in docs/covers.md is about arbitrary member hosts):

- `private.cover_allowed` (migration) gains `assets\.hardcover\.app`.
- `web/functions/cover.js` `ORIGIN_HOST` gains it (one image, no size variants).
- `cover-store` `plan.ts` gains a host `hardcover` (`assets.hardcover.app/<path>`, the one image, `keyed: false`,
  JPEG, thumbhash from that image). It also goes into `COVER_STORE_HOSTS` and `ALL_HOSTS`, and so into the takedown
  (drop the host and clear `cover_key`).
- CSP `connect-src` (`web/public/_headers`; `img-src` is `https:` already), the service worker's cover rule
  (`nuxt.config.ts`), `coverRank.ts`.

**Docs**:

- docs/THIRD-PARTY.md: a row "Hardcover covers" with the terms above and the takedown steps. The exports row
  becomes "A CSV or the Hardcover zip … parsed in the browser; only the files the import needs are read".
- Privacy notice EN/DE (`web/app/legal/privacy.ts`): "The covers of your books" names Hardcover next to
  Goodreads. The import paragraph says that a zip is opened on the device and only the library, reads,
  editions and lists leave it.
- docs/covers.md, docs/HOSTING.md, docs/parity.md (Import books).

## Hardcover API: recommendation, no

- **The import does not need it.** The zip carries everything the API would add for one member: library,
  reads with precision and progress, the edition with ISBN, lists with order, covers. The API would add a
  token step, which is worse than downloading a file.
- **One owner token for everybody's catalogue lookups and covers: not allowed in spirit, and little gain.**
  Personal access tokens "are not meant to be shared", and the Free plan's intended use is "personal ownership,
  progress sync, personal use" (5,000 requests a day, 60 a minute, burst 10). Queries must run server side, and
  "we may reset tokens without notice while in beta". Serving other members through the owner's token falls
  outside personal use. Per-member access means OAuth. The gain is unmeasured: covers for books that Apple and
  Open Library miss (German gaps, cover-sources.md). The zip's covers already serve imported books.
- **If ever**: per-member OAuth for a "connect Hardcover" sync is a separate proposal. For catalogue covers, first
  run the 60-ISBN test set of cover-sources.md against it, and write to Hardcover (they invite public-good projects).
  Nothing here depends on it.

## UI copy (en / de)

| Key | en | de |
| --- | --- | --- |
| `import.howTo.hardcover` | On hardcover.app: Settings → Export your data → **Everything (zip)** → Generate export. Choose the zip as it is, no need to unzip it: your reads, progress, lists and covers come along. The Hardcover CSV and the Goodreads CSV from Hardcover work too, with less. | Auf hardcover.app: Settings → Export your data → **Everything (zip)** → Generate export. Wähle die Zip-Datei so, wie sie ist, ohne sie zu entpacken: Lesevorgänge, Fortschritt, Listen und Cover kommen mit. Die Hardcover-CSV und die Goodreads-CSV von Hardcover gehen auch, mit weniger. |
| `import.pickText` | Works with exports from Goodreads (CSV) and Hardcover (zip or CSV). Your shelves, dates, ratings and reviews come along. | Funktioniert mit Exporten von Goodreads (CSV) und Hardcover (Zip oder CSV). Deine Regale, Daten, Bewertungen und Rezensionen kommen mit. |
| `import.choose` | Choose file | Datei wählen |
| `import.fileError.notCsv` | That isn't an export file. Goodreads exports a CSV, Hardcover a zip or a CSV. | Das ist keine Exportdatei. Goodreads exportiert eine CSV, Hardcover eine Zip-Datei oder eine CSV. |
| `import.fileError.zipUnknown` | That zip isn't a Hardcover export. Choose the zip from Hardcover's "Everything" export. | Diese Zip-Datei ist kein Hardcover-Export. Wähle die Zip-Datei aus Hardcovers Export „Everything“. |
| `import.fileError.zipVersion` | This Hardcover export is newer than BetterReads can read. Export the Hardcover CSV instead. | Dieser Hardcover-Export ist neuer, als BetterReads lesen kann. Exportiere stattdessen die Hardcover-CSV. |
| `import.fileError.zipMissing` | That Hardcover export is missing {files}. Export it again and choose the zip without changing it. | In diesem Hardcover-Export fehlt {files}. Exportiere ihn erneut und wähle die Zip-Datei unverändert. |
| `import.fileError.zipTooBig` | That zip is too big to read here. Export the Hardcover CSV instead. | Diese Zip-Datei ist zu groß. Exportiere stattdessen die Hardcover-CSV. |

The German goes through the German pass (`docs/i18n/german-pass.md`). `import.howTo.hardcover` keeps one
paragraph; the How-to puts no badge or logo next to it.

## Tests

- **Synthetic fixture generator** `web/tests/fixtures/hardcover-zip/make.ts`: builds a zip in memory (fflate
  `zipSync`) from a small typed account, invented throughout (titles like "Test Book 7", ISBNs with valid checksums
  from an unused range). It generates the variants: every status, each precision, re-reads, undated reads,
  DNF with and without a day, open reads with page / percent / seconds / nothing, a page past the page count,
  half-star ratings, Markdown / raw / HTML-only reviews, a rating-only review, owned, edition fallbacks, empty
  `edition_format`, audio and ebook formats, ranked and unranked lists, an empty list, a contributed list, a
  list-only book on two lists, a cover under 150 px and one on another host. Also folder-nested, no manifest,
  version 2, a missing file, a lying size header, too many entries. Nothing is committed as a binary: the test
  builds what it reads.
- **Vitest per mapping** (`web/tests/import-hardcover-zip.test.ts`): each table row above, one `it` per
  rule; detection and every error code; the limits; zip-vs-CSV parity for the shared fields; same keys as the
  CSV adapter; `importUpload` carries `progress`, `coverHint`, `collectionOrder`, `emptyCollections`.
- **Server** (Deno, `import-job`): `import_books` with progress (open, abandoned, page clamp, no
  `reading_progress_days` row), the `hardcover` cover source and its counter, the rank order, the ranked reorder
  with pre-existing entries, empty Collections; `cover-store` `plan_test.ts` for the new host and its
  takedown switch; `cover.js` allowlist test.
- **E2E** (`web/e2e/import.spec.ts`): pick a generated zip → the job runs against recorded fixtures → the
  Library has the statuses, a reading Book shows its page, a Collection in rank order.
- **Local acceptance on the real export (never in CI, never committed)**: `pnpm tsx
  web/scripts/import-zip-counts.ts <path>` prints **numbers only**: rows (library, list-only, skipped by code),
  by status, sessions / earlier / undated reads, ratings, reviews, progress (page, percent), ISBN-13, Collections
  (ranked, empty), cover hints (kept, under 150 px, other host). Expected from the measurement: 111 rows (26 +
  85), 14 finished + 1 abandoned, 5 reading, 6 + 85 want to read; 14 ratings; progress on 5 rows (4 reading + 1
  DNF); ISBN-13 on 25 + 82; 16 Collections (2 ranked, 1 empty); cover hints on 23 + 71. A run of the job on a
  local Supabase with a dev account then reports editions matched and covers by source.
  When the owner supplies the friend's Hardcover CSV, the same script maps it with `hardcover.ts` and prints
  per-field agreement counts (titles equal, ISBN equal, dates equal…). That settles the edition title question
  above.

## PRs (each shippable switched off or harmless)

1. **Reader and mapping, behind a flag.** `hardcoverZip.ts`, the generator, Vitest, the counts script,
   detection and errors in `importUpload.ts`, the copy keys, the picker's `.zip` behind
   `NUXT_PUBLIC_IMPORT_ZIP` (unset = `.csv` only, today's copy). Uploads library and list-only rows with
   Collections. `progress`, `coverHint`, `collectionOrder` and `emptyCollections` are mapped and tested, but
   stripped before upload. No server change.
2. **Job: progress, ranked order, empty Collections.** Migration: `import_books` takes an optional `progress`
   (on an open or abandoned session, no reading day); the job's end step reorders ranked Collections and its
   first write creates empty ones. `choice.ts` / `importArguments` pass the fields, and `importUpload` stops
   stripping them. A CSV upload never sends them, so it is harmless.
3. **Hardcover covers and switch-on.** `cover_allowed`, `/cover`, `cover-store` host, CSP, service worker,
   `coverRank`, the job's `hardcover` source and counter, THIRD-PARTY, privacy EN/DE, covers.md / HOSTING /
   parity. Then the flag goes on in production with the How-to copy. The cover part alone is harmless (no row
   carries a hint until the flag is on).

## Risks

- **Version 2 of the format**: refused with a way out (the CSV). One field rename in v1 shows up in the
  synthetic tests only if Hardcover documents it. The counts script on a fresh export is the check before
  each release that touches this.
- **The README and the data disagree** (`progress_seconds` 0 instead of null): the mapping never trusts a
  zero, and every numeric field goes through `positive`.
- **Big libraries**: `books.json` grows ~7 kB a book (≈ 14 MB for 2,000 books). Inside the limits, and
  inflated off the main thread; parsing is one `JSON.parse` per file. PR 1 times it on a generated
  5,000-book zip.
- **List-only books swell an import** (85 against 26 here): they are Want to read rows the job matches and covers
  like any other, so a large list can make a long import. Accepted with option A.
- **Hardcover covers on public surfaces** without a takedown line (open question 1). The off switch is one
  migration (`cover_allowed`) and one config line (`COVER_STORE_HOSTS`).
- **Edition titles** in the edition's language differ from the book title (5/26), and the match ranks by title
  after the ISBN. Only the 1 + 3 rows without an ISBN-13 depend on it.

## Owner decisions (31 Oct 2026)

1. **Hardcover covers stay off public surfaces** (option a, not the takedown sentence): `cover_shown` is false for
   the Hardcover host, so `/r/` link previews and any page a signed-out visitor sees never draw one; inside the
   app they show. No DMCA line in the privacy notice.
2. **The friend's Hardcover CSV**: later; the acceptance run uses the zip's own counts.
3. **No Hardcover API.**
4. Lists: option A (as above).
