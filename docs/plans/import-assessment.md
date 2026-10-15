# Import assessment: a real 709-row Goodreads export, local run against production, and what to improve

**Draft, not for merging.** Counts only: no title, author, ISBN or row of the file is in this document or in the
repository. Measured on 12 October 2026 on a throwaway local stack, with current `main` plus the code of PR #315
(the background cover fill, branch `feat/import-cover-backfill`; `web/scripts/import-assessment.ts` needs it), against
the live Apple Books, Open Library, DNB and Catalogue paths, from one residential address. The production figures come
from read-only counts on the same member's real account (given by the coordinator), whose import ran on an older
mixed version.

The run is `web/scripts/import-assessment.ts` (copy of `import-covers.ts` with more counters): the file through the
same repository the import screen uses (`createBookImport`, `createSearch`, `pacedFetch`), the cover fill as the store
runs it, a wait for the fill's whole 10-minute budget, `Import` written with `write(…, { refresh })`, then SQL over her
Library and a sample of 90 stored cover URLs fetched for their real pixel size.

## 1. Production against the local run, side by side

| Metric | Production (her account, older import) | Local run 1 (fresh Catalogue, #315) | Local run 2 (second member, Catalogue kept) |
|---|---:|---:|---:|
| Entries | 707 | 709 | 708 |
| Books **without a cover** | **156** (22 %) | **111** (16 %) | 106 (15 %) |
| cover: Open Library | 330 (all `-L`) | 270 | 268 |
| cover: Apple (600 × 900) | 221 | 328 | 334 |
| cover: other host | – | 0 | 0 |
| Books without ISBN | 65 | 57 | 57 |
| Books without a page count | 566 | 579 | 583 |
| – of them her *entry* has no page count either | – | **5** (the file has pages for 704 of 709 rows: `page_count_override`) | 5 |
| Books without a language | 410 | 451 | 452 |
| Books without a description | 705 | 709 | 708 |
| Books without an Open Library work key | 335 | 391 | 392 |
| Books without a publication year | 3 | 3 | 3 |
| Book sources (Apple / Open Library / `import` / manual) | – | 261 / 316 / 100 / 32 | 267 / 314 / 100 / 27 |
| **"Needs a look"**, old rule (any row only the file knew, any match without a cover) | – | 174: 132 no match, 42 no cover (+168 "probably fine") | 161: 128 + 33 (+170) |
| "Needs a look", rule of #315, before the fill | – | **32** no match, 0 no cover (+310 probably fine) | 27 (+304) |
| "Needs a look", rule of #315, after the fill | – | **32**, 0 (+280 probably fine) | 27 (+304) |
| Wall time | "26 min" (coordinator) | **21.4 min** = lookup 9.7 + the fill's whole budget 10.2 (it overlaps the preview in the app) + write 1.5 | **2.5 min** |
| Requests: Apple (lookup + search) / Open Library search | – | 2,024 / 1,180 | 586 / 291 |
| Refused (403/429) · server errors · failed | – | Apple 48 (2.4 %) · 0 · 7 (Open Library search, no answer) | 4 · 0 · 0 |

How far the two columns compare, honestly:

- **Not the same code.** Production ran an older mixed version: Apple's flat 60-second block instead of `Retry-After`,
  no cover fill, the old review rule. The local run is #315. So "no cover 156 → 111" and "Apple 221 → 328" mix three
  things I cannot separate: the fill (32 covers found, all by Apple), fewer Apple refusals in the lookup (48 refused of
  2,024 now; earlier runs of this file with the #315 code refused 21 to 130 of 1,377 to 1,888), and the day's luck.
  Lookups differ by tens of covers from run to run (no cover after the write in six runs of this file: 168 without the
  fill, then 188, 155, 117 with successive versions of it, 111 and 106 now): **treat ±30 as noise**.
- **The local stack does no server work.** `catalogue-check` (descriptions, language, pages, publisher, format, cover from
  the source) and `enrich` (work keys, genres, authors) are edge functions that the local stack does not run, so
  local *description*, *language*, *work key* are what the **import** wrote, production's are what the import wrote plus
  what the server added (662 of her 707 Books have a `book_enrichment` row, which is why production has 335 and not 391
  Books without a work key). Production's 705 missing descriptions are not an import result at all, see finding 1.
- **Run 2 is not a repeat.** It is what a second member importing the same file costs once the first member's Books are in
  the Catalogue (finding 3). Its 106 cover-less Books are the first member's: a Catalogue Book's cover is never improved
  afterwards (finding 6).
- The sampled cover sizes are 90 random covers per run (49 + 41, 59 + 31), pooled below.

### Cover pixel sizes (stored URL, fetched; height in px)

| | n | < 400 | 400–499 | 500–699 | ≥ 700 | median / min / max |
|---|---:|---:|---:|---:|---:|---|
| Open Library as stored (`-L`), two runs pooled | 108 | 6 (6 %) | 23 (21 %) | 79 (73 %) | **0** | 500 / **293** / 500 |
| Apple (600 × 900) | 72 | 0 | 0 | 0 | 72 (100 %) | 900 |
| Open Library **unsuffixed original**, same covers | 107 | 6 | 23 | 45 | **33 (31 %)** | 500 / – / **2,700 px, 6.3 MB** |

Production's sample (62 Open Library: median 500, smallest 400; 28 Apple, all sharp) agrees: the `-L` size is capped
at 500 px, 27 % of the stored Open Library covers are under 500 px, and the originals of 31 % are 700 px or taller (13
of 107 over 1,600 px). None of my 107 originals was absurd (taller than 4,000 px or an odd shape), but one weighed 6.3 MB.
Of the originals 27 % (29 of 107) are no bigger than `-L` (the upload itself is small): no size choice helps those.

## 2. What the run shows

**Where the time goes (run 1, 21.4 minutes).** The lookup is 583 s (first pass 450 s, the second pass over the rows nothing
was found for another 134 s), the fill 609 s (its budget; in the app the member reads the preview meanwhile, so it
only blocks if she presses Import at once, and then for 3 s), the write 90 s.

**The lookup is Apple's pacing.** 1,949 Apple requests in the lookup at one request per 250 ms is 487 s of pacing:
**84 % of the lookup's 583 s**. Open Library's 1,180 searches (592 ms each, four rows at a time, no refusals) fit
inside that time. The requests, by what they asked:

| request | n | hits | what it is for |
|---|---:|---:|---|
| Apple `lookup?isbn` (`de` storefront) | 524 | 107 (20 %) | every row with an ISBN, in parallel with Open Library |
| Apple `lookup?isbn` (`us` storefront) | 524 | 97 (19 %) | same, second storefront |
| Apple `search` title, `de` / `us` | 521 / 455 | 434 / 354 | rows the ISBN lookup did not find (≈ 490 searches × 2 storefronts) |
| Open Library `search.json` | 1,180 | 636 | ISBN and title |
| Open Library `api/books` (fill, 25 ISBNs per call) | 64 | 64 | cover ids: found nothing the lookup had not |
| write: Apple artwork / Open Library cover by id / by ISBN | 296 / 291 / 141 | all / all / **19** | the thumbhash of every cover |

**How the 709 rows were resolved** (run 1): 126 by ISBN at Apple, 278 by ISBN at Open Library, 135 by title at Apple, 38
by title at Open Library, **100 only the file knows (an ISBN, no source knows it: Books of source `import`)**, 32 nobody
knows (no ISBN either; Manual books). The file has no ISBN for 205 rows (29 %), 153 of them Kindle or ebook editions.

**An Apple ISBN lookup only finds ebooks.** On a random 60 of her rows with an ISBN: 45 of 60 ebook-binding rows
(75 %) are found at Apple's `de` storefront; **3 of 60 print-binding rows (5 %)**. The file says the binding
(`Binding`): 132 ISBN rows are ebooks, **372 are print or audio**.

## 3. Findings

1. **`catalogue-check` is switched off in production.** Read-only counts (coordinator): `function_url` is null, the
   cron job runs and succeeds every minute, `catalogue_check_kick()` returns `off`, nothing was checked since 11 October
   13:27 UTC. 664 of 854 Catalogue Books are unchecked, **705 of her 707** (2 checked). Only this function writes a
   description (`books_no_client_description` empties any a client sends), so "no description 705/707" is *this*, not
   an import fault. One line fixes it (set `private.catalogue_check_settings.function_url`, README of the function), then
   eight Books a minute: her 705 take about 90 minutes. The owner decides; nothing was changed. The same function also
   writes language, pages, publisher, format and the source's cover (see 6).
2. **The lookup spends Apple's limit on requests that cannot succeed**: 1,048 ISBN lookups (524 × 2 storefronts) for 20 %
   hits, and of the print rows 95 % miss. That is 740 of 1,949 Apple requests.
3. **The Catalogue already is the cross-member cache, and it works**: a second member importing the same file found
   664 of 708 rows in the Catalogue, took **2.5 min instead of 21.4** (the lookup 148 s instead of 583), **877 lookup requests instead of 3,268** (586 Apple,
   291 Open Library; run 1: 2,024 Apple, 1,244 Open Library), refusals 4. Production's Catalogue has only 854 Books (her 662 non-own-edition Books among them), so today almost nothing
   overlaps; it pays off with members. But the remaining 877 requests are still too many: a **title search asks Apple
   and Open Library even when the Catalogue answered** with the same work (`search` asks all three sources at once).
4. **A Catalogue Book that lands without a cover never gets one**: `import_book_for` returns the existing row, the fill
   cannot write a cover to a row with an id, and a second member's lookup finds the same cover-less Book in the
   Catalogue (run 2: 106 without a cover, the first member's). Fixing covers in the preview helps the member who ran
   it and no one after her.
5. **Open Library's stored `-L` covers are soft** (sizes above): 27 % are under 500 px, none reaches 700 px; the
   originals of 31 % do.
6. **The server side rewrites what the import stored**: `catalogue_check_save` sets `cover_url` to the source's (it keeps
   the thumbhash only when the URL is the same) and `language`, `format`, `page_count` to the source's value, null
   included. When it runs, whatever the import derived (a language from the ISBN, a cover from the fill) is replaced by
   what Apple or Open Library says, or by nothing. Any improvement that stores a field at import has to say what the
   check does with it.
7. **100 rows have an ISBN that Apple and Open Library do not know, and the DNB knows 55 of them.** The `dnb-lookup`
   function exists (#307, CC0, 30 calls a minute per member) but the import's search is built without it (`createSearch`
   in `stores/import.ts` has no `dnb`). I asked the DNB's SRU for all 100 (counts): **55 have a record: 54 with a page
   count, 55 with the language (all German), the year, 54 with the publisher**. Those 100 rows are 100 Books of
   source `import`: no language, no publisher, 98 with pages from the file, 54 with a cover borrowed from another edition (the DNB has none).

### Missing fields: what could fill them

On a random 60 of her Books that have an ISBN and no Book-level page count:

| source | record for the ISBN | pages | language | description | terms |
|---|---:|---:|---:|---:|---|
| Open Library edition record (`isbn/{isbn}.json`) + work | 39 (65 %) | 19 (32 %) | 28 (47 %) | 23 (38 %, via the work) | open data; low volume API |
| DNB SRU | 18 (30 %) | 7 (12 %) | 18 | – | CC0 |
| any of the two, pages | – | **23 (38 %)** | – | – | |
| Apple ebook record | – | never (its results carry no page count, 268 of 268 Apple Books here have none) | never | yes (it is the description `catalogue-check` takes) | search API terms: the cover address kept, not copied |

- **Pages**: 566 Books without a page count are a Book-level gap only: **her own entries have a page count for 704 of
  709 rows** (the file's, kept as `page_count_override`; 579 entries carry one, 5 have none anywhere). It matters for
  the Catalogue's other members and for the edition facts, not for her statistics. Apple's ebooks never have pages.
- **Language** (451 missing): Apple gives none and Open Library 47 %. The **ISBN's registration group** says it for free
  (`isbnLanguage` exists in `data/import/readingTracker.ts`: `978-3` German, `978-0`/`-1` English …): 504 of the 709
  rows have an ISBN; the file has no language column.
- **Description**: only `catalogue-check` (Apple, Open Library). Google's is out (its terms forbid storing it).
- **Work key** (391/335): `enrich`, already running in production (662 of her Books enriched).

## 4. Options, measured

| # | Option | Gain (numbers above) | Effort | Risk and terms |
|---|---|---|---|---|
| A | **Switch `catalogue-check` on** in production (set the function URL as its README says) | 705 descriptions and, as it works through, language/pages/publisher/format for all 664 unchecked Books; ~90 min for her 705 | one SQL line by the owner | it calls Apple and Open Library from Supabase's address, not hers; check first what it does with a Book whose source has no cover or no language (finding 6) |
| B | **Gate the Apple ISBN lookup on the file's binding**: ask only for ebook, Kindle, audiobook or unknown bindings; print rows go to Open Library (and DNB) | −740 of 1,949 Apple requests (**−38 %**, ≈ −185 s of the 583 s lookup, from the pacing floor); loses ~5 % of 372 print rows ≈ 18 Apple hits, which Open Library or the title search mostly give back | small: `findEdition`/`lookupIsbn` take a hint (the row's `binding`); a unit test | none (our own requests); Apple's cover is sharper (900 px) than Open Library's (500), so the 18 rows may get a softer cover |
| C | **One storefront per search**, the second only when the first finds nothing: title search asks `de` first (86 % hit) | −~390 of the lookup's 901 title-search requests (≈ −100 s; the `de` storefront answers 86 % of them) | small (`createApple`: `searchFirst` exists since #315) | a German reader's English-only editions: those that miss at `de` are asked at `us` |
| D | **Skip Apple and Open Library when the Catalogue has the work** (title search too) | run 2: ~877 requests → ~100; **2.5 min → ~20 s** for the second and every later member | small-medium (`findEdition`: a Catalogue hit that `isSameWork` and carries a cover ends the row) | a Catalogue Book with a poor cover is kept (finding 4: fix with H) |
| E | **Wire the DNB into the import** for rows only the file knows (100 of 709): language, pages, publisher, year for 55 of them | 55 fewer "from the file" Books, German language/pages/year/publisher, CC0; 30 calls/min/member: 100 rows ≈ 3.5 min in the background, after the lookup | medium: `createSearch({ dnb })` exists; a background pass in the store like the cover fill; make the Book from `dnb-lookup`'s `book` action (it makes the Catalogue Book server-side, never from client data) | none (CC0); the function's own rate limit; the Book becomes source `import` as today |
| F | **Language from the ISBN group when null** | up to 504 rows' language at no request; 451 missing now | small | the group is the publishing area, not always the language (an English book published in Germany is 978-3): derive only 978-3/-0/-1/-2 … for rows whose title language agrees, say so in the docs; `catalogue-check` may overwrite with null (finding 6) |
| G | **Open Library original for the hero** (the book page), `-L` in lists: read `covers.openlibrary.org/b/id/{id}.json` (it answers `width`, `height`) at fill/probe time, use the unsuffixed original only when 700 ≤ height ≤ 2,000 | 31 % of Open Library covers (≈ 84 of her 270) go from ≤ 500 to ≥ 700 px; 13 of 107 originals are over 1,600 px and one weighed 6.3 MB, hence the bound | medium: the stored URL is `-L`; the hero chooses the original by a rule on a stored height, so a column (`cover_height`) + migration + the cover pipeline; thumbhash unchanged | terms: still *linking* (no copy, no cache of ours); no resize proxy (a proxy that stores or transforms is a copy: the project's rule, `docs/THIRD-PARTY.md`). Soft covers of the 27 % whose original is small stay soft |
| H | **Let a found cover reach the Catalogue Book**: a `security definer` RPC `catalogue_cover_fill(book_id, url, thumbhash, colours)` for a Book without a cover, `private.cover_allowed` checked, the cover never replaced once there | the fill's 32 finds persist for everyone; run 2's 106 cover-less Books stop being permanent | medium: migration + pgTAP; the store calls it for Catalogue Books (`'id' in book`), which the fill skips today | the existing allow-list is the guard (F1); a member can only fill an empty cover; `catalogue-check` may then replace it (finding 6) |
| I | **A backfill of existing covers**: a server-side job that walks Books with an Open Library `-L` cover and a larger original (cover metadata), and Books without a cover, through Apple/OL | production: 330 OL covers (≈ 100 soft) and 156 without | medium-large: an edge function like `catalogue-check` (its queue, its rate limit) | same terms as G/H; run after A and H |
| J | **Write phase**: skip the by-ISBN probe of covers the fill already answered, probe more rows at once (10 → 30) | 141 requests (19 hits) saved; 90 s → ~40 s (estimate) | small | the by-ISBN address is the one with the per-address limit (100 per 5 min) |
| K | **Rows nothing knows** (32 Manual books, no ISBN, mostly Kindle-only or self-published): DNB `editions` by title for the German ones; otherwise stay | at most a handful; they stay under "needs a look" by design | small once E is in | – |

### Time (5): what dominates and a realistic target

Run 1's lookup (583 s) is Apple's pacing floor (487 s) plus the second pass. B and C remove ~1,130 of 1,949 Apple
requests: the floor falls to ~200 s, then Open Library's 1,180 searches (592 ms, 4 rows at a time ≈ 175 s) become the
limit, so **a first pass of about 250 s (4 min) instead of 450 s, the lookup 5 min instead of 9.7**, and the write 45 s
with J: **≈ 6 minutes blocked instead of 11**, and a second member (D) ~20 s. More rows at once (`IMPORT_CONCURRENCY`
4) helps only after B and C: Apple is the shared host. The fill's 10 minutes do not block anyone. (All times here are arithmetic on the measured pacing and request counts, not re-measured runs.)

## 5. Recommended order (impact against effort), one PR each

1. **A: set the `catalogue-check` URL (no code).** Largest visible effect (descriptions for all, then language and pages),
   zero risk of its own. Check finding 6 first.
2. **B + C together, one PR "fix(import): spare Apple": binding gate and one storefront at a time.** Biggest measured
   gain per line: −38 % and then −20 % of Apple requests, the lookup from 9.7 to ~5 min, fewer refusals, so the cover fill
   (which shares Apple's budget) finds more than 16–32 of 90.
3. **D: Catalogue ends the row** ("perf(import): a Book the Catalogue has costs no request"). Free for every later
   member (2.5 min → ~20 s), small change; it makes finding 4 matter more, so
4. **H: a found cover reaches the Catalogue Book** (migration + pgTAP + store). Makes the fill's work permanent and
   shared.
5. **E: the DNB for the 100 rows only the file knows** (55 with language, pages, publisher, year). Real data, CC0, the
   edge function exists.
6. **F: language from the ISBN group.** Tiny, after A so the interplay with the check is known.
7. **G: Open Library originals for the hero** (needs `cover_height`; terms-clean as long as it stays a link) then
   **I, the backfill**, once G and H exist; **J** any time as a small tidy.

PR 2, 3, 4, 5, 6, 7 are independent of each other apart from 3 → 4 (a Catalogue that ends rows should be able to
improve its covers) and 7 → I.
