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

## The DNB in the match (13 Oct 2026)

Owner decision: the German National Library (DNB) joins the import's matching — the earlier "only for the barcode
scan and the Book page picker" rule is lifted (docs/parity.md, *Import books: the DNB step*). Counts only, the same
200-row subset, the same script and the same local stack; her file stays local. The DNB answers the ISBN fallback
and asks its one question per row (early for a probably German row, last for any other), on its own budget
(`purpose: 'import'`, 120 calls a minute) and pace (500 ms between calls).

**The DNB's effect, Apple answering everything** (13 Oct; "after" is the DNB before the twin-cover fix below):

| Subset, 200 rows | before (#348) | after (with the DNB) |
|---|---:|---:|
| matched automatically to a real Book | 169 | **176** |
| … of them matched via the DNB | 0 | **59** |
| … by ISBN / by title | 20 / 149 | **74** / 102 |
| unmatched (only the file's own row) | 31 | **24** |
| … of them with an ISBN in the file | 6 | 4 |
| needs a look | 1 | 12 |
| rows whose title search found no candidate | 23 | 16 |
| Choose edition: no edition | 0 of 8 | 0 of 37 |
| DNB calls (answered / refused) | — | 227 / 0 |
| lookup | 151 s | 189 s |

**What the measurement found and this branch fixes:** the coverless DNB record entered the one candidate pool first
and its covered twin at Apple (the very ISBN) was dropped as the same edition, so a row matched to the right German
edition showed no cover at all. The pool's representative of an edition now takes the cover either record has
(`keep`, data/bookImport.ts; the test `the same edition named twice keeps its cover`). Nothing is invented: the
twin's own cover.

**The final code, 14 Oct** (Apple refused from its ~285th request on in both runs — a day of measuring from the
address; the before run the same morning answered every request, 416, and repeated its 13 Oct counts to the row):

| Subset, 200 rows | before (#348) | after, fill 120 s | after, fill 600 s (the store's) |
|---|---:|---:|---:|
| matched automatically to a real Book | 169 | **176** | **176** |
| … of them matched via the DNB | 0 | **59** | **59** |
| … by ISBN / by title | 20 / 149 | 74 / 102 | 74 / 102 |
| unmatched (only the file's own row) | 31 | **24** | **24** |
| … of them with an ISBN in the file | 6 | 4 | 4 |
| needs a look | 1 | 31 | **0** |
| matched, shown without a cover | 0 | 31 | **0** |
| rows whose title search found no candidate | 23 | 16 | 16 |
| Choose edition opened: no edition | 0 of 8 | 0 of 36 | 0 of 42 |
| DNB calls (answered / refused) | — | 237 / 0 | 253 / 0 |
| Apple requests (refused) | 416 (0) | 551 (269) | 670 (378) |
| lookup | 151 s | 228 s | 239 s |

The needs-a-look column is the cover fill's, not the match's: a DNB edition has no cover of its own, so a row it
matched waits for the work's cover (its covered twin, a sibling edition, Open Library by ISBN, the Goodreads stage).
At the store's real budget — 10 minutes, the 600 s column here — every row of the subset ends with a cover and
nothing to look at; a 120 s fill leaves the rows the refusals had already slowed down. The extra Apple requests are
the price of the rows the picker opens (36–42 against 8) and of a ladder that keeps looking for a cover for a DNB
match.

**The full 709-row file, final code, fill 600 s** (13–14 Oct; the Mac slept through the night, so its lookup time
is nothing to measure):

| Full file, 709 rows | after (this PR) |
|---|---:|
| matched automatically to a real Book | **685** |
| … by ISBN / by title | 460 / 225 |
| … of them matched via the DNB | **59** |
| unmatched (only the file's own row) | **24**, all of them a book only Goodreads knows (4 with an ISBN in the file) |
| needs a look | **0** |
| matched, shown without a cover | 0 |
| rows whose title search found no candidate | 16 |
| Choose edition opened: no edition | 0 of 28 |
| DNB calls (answered / refused) | 323 / 46 (the refusals came while the machine was asleep) |

Against the fix's own full run (#348: 658 matched, 51 unmatched — 13 of them Goodreads-only and 38 unsure from
Apple's refusals, 52 to look at): the DNB matched 27 of those 51 (the German ISBNs and the German-only titles
Apple and Open Library do not know), and the twin-cover fix with the fill's real budget took the rest of the rows
to a cover and a "Probably fine".
