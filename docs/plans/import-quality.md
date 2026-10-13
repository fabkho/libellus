# Import quality: as many rows as possible matched to a real Book

Why: a member re-imported the same Goodreads export (709 rows) after deleting everything and found (1) books not
matched although the sources have them, (2) another edition suggested but not the ebook she read (owner: any format
is fine, an ebook is better than no match), (3) rows under "Probably fine" without a cover, and (4) about 40 rows to
look at, where Choose edition often showed the right edition (the match should have taken it) and for about ten
showed no edition at all. This file is the diagnosis, what changed and the measurement. Counts only: the export
stays outside the repository, and no title, author or ISBN of it is written here.

Owner rules this follows: a real Book (a source's edition) before the file's own row, format-agnostic, the ISBN
first; one field merge (`mergeSources`); a low-resolution cover beats none; the work's ebook cover ranks behind the
exact edition; Goodreads covers are the last resort; Google Books is out; Hardcover needs a token (not asked).

## Causes (measured with the pipeline's own data, on current main)

1. **The "same book" rule was too strict** (`isSameWork`). Source titles carry a series prefix or a dash subtitle
   ("Series - Title", "Series 1: Title", "Title T01", "Series 1. Title"), and author spellings differ ("Müller" /
   "Mueller", a surname two letters off, "Last, First"). The work was found and then rejected: a near-miss probe
   found such candidates for most of the 46 rows whose title search had no candidate at all.
2. **An ISBN no source knows kept the file's own row** even when the title search found the work: 79 of the 125
   unmatched rows of the 200-row problem subset were "work found, not taken".
3. **The match and Choose edition used different pools and rules.** The match took Search's merged list (one
   edition per work: an ebook and its print edition were never both candidates) under the strict rule; the picker
   asked its own unpaced search with a looser rule and its own ranking. Choose edition opened on the 27 rows to look
   at showed no edition at all for 25.
4. **A refusal was read as "nothing found".** `search.failed` was true only when every source failed, an ISBN
   lookup answered null when Apple refused and Open Library had nothing, and an Apple storefront that did not answer
   was invisible. The row was final. Apple's limit (about 20 a minute sustained, a burst of roughly 130 requests at
   4 a second before the first 429 or 403, measured again here) is met in most real imports.
5. **No cover was still "Probably fine"**: `needsLook('matched', …)` was always false.
6. **Apple's budget went on one-ISBN lookups**: 1,204 of 2,318 Apple requests of the full file, two storefronts per
   ISBN. Apple's lookup takes comma-separated ISBNs: 40 in one request gave the same hits as 40 single lookups
   (most results name their ISBN in the artwork's file name; the rest map back by title and author).

Not a cause: the 7-day caches (the device keeps found matches only; the Goodreads function's not-found cache is
bypassed for a book id). Some books are in neither Apple Books nor Open Library (self-published German romance):
only Goodreads knows them.

## What changed

- **The import's Open Library goes through our own server** (later, same fix series; `supabase/functions/openlibrary`,
  `web/app/data/openLibraryProxy.ts`): identified to Open Library (its published limits are 1 request a second
  unidentified, 3 identified), about 3 requests a second, falling back to direct at 1/s when the function fails.
  `web/scripts/import-quality.ts` measures either way (`LIBELLUS_IMPORT_OPENLIBRARY=proxy|direct`); details:
  `supabase/functions/openlibrary/README.md`.
- **One rule for "the same book"** (`data/import/editions.ts`): `titleForms`/`sameTitle` (full title, main title
  before a colon, head and tail around a dash, bar or "N." separator, volume marks dropped; two volumes of one series
  are not the same; a series' later volume is not the book named after the series), `sameAuthor` (surname, "Last,
  First", umlauts written out or dropped, Damerau distance up to 2 for a surname of five letters or more with the same
  initial). `isNearWork` keeps what is close but not sure for Choose edition only, never for the match.
- **The title ladder** (`data/import/queries.ts`, strategy objects): title and author, main title and surname,
  umlauts written out, the title alone, surname first; each question asked once, only until the work turns up with a
  cover. Each question goes to the Catalogue and Open Library first and to Apple only while the row is not settled
  (`settled`: a cover, the row's language, an Apple edition for an ebook row); the spelled-out, title-only and
  surname-first questions never go to Apple.
- **One pool, one ranking**: every edition each source names is a candidate (`SearchOutcome.editions`), ranked by
  `rankEditions` (language, ebook for an ebook row, a cover, pages, year). The match takes the exact edition, else
  the best edition of the work, also for an ISBN no source knows; a cover is lent at match time (`coverLender`,
  `mergeCover`). Choose edition asks the same ladder through the same paced lookups (`choiceCandidates`), and every
  question's full answer is kept for the import (`rememberingAnswers`), so the picker and the second pass never ask
  Apple a question it already answered.
- **Not the book**: a summary, study guide or workbook sold under the book's title is never its work; an edition in
  another language than the row's (or, for a row that says none, in a language other than the app's German and English:
  French is told from its little words) ranks last and, when it is all there is, makes the row one to look at. Open
  Library's search names one edition a work, in the device's language first, so when the work was met only in another
  language its work's editions are asked once (`inRowLanguage`: one request, no per-address limit).
- **A refusal is no miss**: `SearchOutcome.unanswered` (a source that failed or an Apple storefront that did not
  answer), `lookupIsbn(…, { strict })`. A row nothing will do for (nothing found, or a match without a cover or in
  another language) is `unsure`: never remembered, never final, asked again in the second pass once the paced host
  lets us back (`busyFor`), and listed under Needs a look meanwhile. A title match that will do (a cover, the row's
  language, any format) stands and is not listed, but is asked again when it may get better (`retry`: its ISBN was not
  answered, or an ebook row has no Apple edition yet).
- **Apple's ISBNs in batches** (`primeIsbns`): 40 ISBNs a request and storefront, before the rows are looked up.
- **The preview's one rule** (`reviewOf`): no cover shown → Needs a look; nothing identifies the row (no source, no
  ISBN, not even Goodreads) → Needs a look; a source could not be asked → Needs a look; a title match in another
  language than the row's → Needs a look. Goodreads' cover of the file's own book id is the last resort for a row
  nothing found (`goodreadsOnly`).
- **Genre labels, collected, not stored** (owner decision): Apple's genre names and Open Library's subjects travel on
  the snapshots (`genreLabels`; Open Library's `subject` is one more field of the same search, no new request) and are
  merged raw with their sources (`mergeGenreLabels`, `Edition.genres`); no mapping onto the 20-genre list, no write, no
  migration. The Catalogue's own genres and DNB (no keywords in what the app reads) are not asked; Wikidata is the
  enrich function's. The device's match memory does not keep them.
- The device's match memory moved to `libellus.import-matches.v2`: matches kept by the old lookup are asked again.

## Measured (counts only)

`web/scripts/import-quality.ts` runs the import's lookup, the cover fill and Choose edition (opened on every row
that needs a look) against the live sources on a local stack, from one residential address, and prints counts; the
same script runs on a checkout of main ("before") because it detects the code it finds. `LIBELLUS_IMPORT_APPLE_OUTAGE`
plays Apple refusals back on demand (a 20 s window of 429s every 90 s).

Measured 12 and 13 October 2026 on the member's 709-row export (counts only). "Before" is main (1.18.1) on a day Apple
answered every request; the full "after" run met Apple's refusals from its 27th second on (99 requests, after a day of
measuring from the same address), so its counts are the pessimistic case. The outage pair below ran on the same day
under the same conditions and is the fair comparison of what a refusal does.

| Full file, 709 rows | before | after |
|---|---:|---:|
| matched automatically to a real Book | 584 | **658** |
| … by ISBN / by title | 406 / 178 | 406 / 252 |
| unmatched (only the file's own row) | 125 | **51** |
| … of them with an ISBN in the file | 98 | 15 |
| needs a look | 27 | 52 |
| … of them because a source could not be asked | 0 | 51 |
| probably fine, but without a cover | 22 | **0** |
| matched, shown without a cover (all under Needs a look now) | 5 | 12 |
| rows whose title search found no candidate | 46 | 35 |
| Choose edition opened on the rows to look at: no edition | 25 of 27 | 25 of 73 (all 25: Apple refused, the sheet says so) |
| rows carrying at least one raw genre label (Apple / Open Library) | 0 | 534 (254 / 314) |
| lookup | 567 s | 661 s |
| Apple requests (refused) | 2,318 (0) | 1,437 (1,004, from the 27th second) |

The 51 still unmatched: 13 that only Goodreads knows (they get Goodreads' cover of the file's own book id) and 38 that
nothing found while Apple refused (unsure: listed under Needs a look, never kept as a miss; in runs where Apple answered
most of them were Apple-only books it found). Every row under Needs a look is either one a source could not be asked
about or one that shows no cover.

Apple refusing on demand (`LIBELLUS_IMPORT_APPLE_OUTAGE=90:20`, 429 for 20 s every 90 s on top of its own refusals), the
200-row problem subset (all 125 rows that ended unmatched before, 5 title matches without a cover, 50 title matches and
20 ISBN matches as controls), the same day:

| Subset, 200 rows, Apple refusing | before | after |
|---|---:|---:|
| matched automatically | 66 | **169** |
| unmatched | 134 | **31** |
| … unmatched because a refusal was read as "nothing found" | 64 | 0 |
| needs a look | 51 | **7** |
| probably fine, but without a cover | 50 | **0** |
| rows whose title search found no candidate | 82 | 23 |
| Choose edition: no edition | 29 of 51 | 5 of 15 |
| lookup | 789 s | 436 s |

(The outage "after" ran at commit a0453012, before the last change, which only reads an edition's language from its
bracket and from more catalogue codes.) Without injected refusals the subset went from 75 matched / 125 unmatched / 27
to look at (main) to 159 / 41 / 38 (the full run above, Apple refusing from its 27th second).

What the counts say: the rows that were "not found although the book exists" were found (the looser same-book rule, an
unknown ISBN no longer keeping the file's row, one pool with every edition); a refusal no longer ends a row; no row
without a cover is "probably fine". Apple remains the scarce source: its own limit (about 100 to 170 requests at 4 a
second, then refusals for minutes) decides how many rows end unsure, and the free-first ladder, the ISBN batches and the
kept answers are what keep its use down (1,437 requests instead of 2,318).

## For the server-side import (PR #329)

Apple's lookup answers 40 ISBNs a request; one batch per 40 rows and storefront replaces two requests per row. Asking
the free sources first and Apple only for what they leave unsettled is what keeps a whole file under Apple's limit;
a job on a server address meets the same limit, once for every member.
