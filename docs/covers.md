# Covers in lists: what is slow, what shows the Placeholder (issue #63)

The owner's report: covers load slowly while scrolling search results, and many rows in search and
in Change edition show only the Placeholder. This file holds the measurements behind the fixes and
how to repeat them. Both tools ask the live APIs, so they are scripts, not tests.

- `web/scripts/cover-diagnosis.ts` runs 20 real queries (five English classics, five German titles,
  five recent books, five titles from the local Library) through the app's own repositories
  (`data/search.ts`, with the Catalogue read from the local stack), plus Change edition for five
  Library books (`data/editions.ts`), and fetches every cover a row would show at the size the row
  asks for (`coverSrc(url, 'sm')`), six at a time with a mobile Chrome user agent. Per image it
  records the source, the cover host, HTTP status, redirects, bytes, latency, the image's size,
  whether it is blank (OpenLibrary's 1 × 1 GIF, one flat colour) and whether it carries CORS. It also
  compares the sizes each CDN offers and asks the German National Library (DNB) for German ISBNs.
  `cd web && pnpm tsx scripts/cover-diagnosis.ts --out /tmp/libellus-63/before`
- `web/scripts/cover-timing.ts` measures time-to-cover in the app: Playwright Chromium at 393 × 852
  (DPR 2.625), DevTools' Fast 4G (165 ms latency, 9 Mbps down), browser cache off, a throwaway
  member signed in (removed at the end). It types a query, lets every source answer, then scrolls the
  list to its far end, 240 px every 300 ms, and notes per row when it came into the list's view and
  when its cover had loaded. Needs the app on :3066 against the local stack
  (`NUXT_PUBLIC_SUPABASE_URL`/`_ANON_KEY` from `supabase status`).
  `cd web && pnpm tsx scripts/cover-timing.ts --runs 2 --out /tmp/libellus-63/before/timing.json`

## Diagnosis (4 Oct 2026, device languages `de, en`)

576 search rows, 172 Change edition rows.

### Search rows by result source

| source | rows | no cover URL | cover shows | 404 | blank | not an image | median ms | p90 ms | median KB | CORS |
|---|---|---|---|---|---|---|---|---|---|---|
| Apple | 357 | 0% | 100% | 0 | 0 | 0 | 36 | 136 | 23 | 100% |
| OpenLibrary | 214 | **30%** | 70% | 0 | 0 | 0 | **575** | **1103** | 13 | 100% |
| Catalogue | 5 | 0% | 80% | 1 (test fixture) | 0 | 0 | 35 | 1094 | 24 | 100% |

By query group, the share of rows without any cover URL: English 3%, German **21%**, recent 11%,
Library titles 6%. All of them are OpenLibrary works whose edition *and* work have no `cover_i`;
22 of them sit in the first ten rows of a list.

### Change edition rows

| source | rows | no cover URL | cover shows | median ms | p90 ms |
|---|---|---|---|---|---|
| OpenLibrary (work editions and search) | 137 | **15%** | 85% | **733** | 1156 |
| Apple | 26 | 0% | 100% | 442 | 571 |
| Catalogue | 9 | 0% | 100% | 36 | 266 |

### Catalogue Books (stored covers)

Real Apple artwork: 142, all load (median 21 ms, warm on Apple's CDN). OpenLibrary: 36, all load
(median 459 ms, p90 1333 ms). 93 Books have no cover. 210 further rows are test fixtures left in the
dev Catalogue by the suites (`…/1.jpg/600x900bb.jpg`, `…/Purple/v4/a/b/c/…`, `…/android-smoke/…`):
made-up URLs that 404 and show the Placeholder — they exist only in a dev database.

### The CDNs

| provider | size | image | median KB | median ms (first ask) | redirects |
|---|---|---|---|---|---|
| OpenLibrary | S | 38 × 58 | 2 | 920 | 2 |
| OpenLibrary | M | 180 × 275 | 17 | 1051 | 2 |
| OpenLibrary | L | 326 × 500 | 50 | 1212 | 2 |
| OpenLibrary by ISBN | M | 180 × 272 | 20 | 734 (8 of 15: 404) | 0 |
| Apple | 120x180bb | 115 × 180 | 11 | 405 cold / 16 warm | 0 |
| Apple | 200x300bb | 192 × 300 | 25 | 439 cold / 18 warm | 0 |
| Apple | 600x900bb | 577 × 900 | 137 | 532 cold / 30 warm | 0 |

- **OpenLibrary is slow because of its redirects, not its bytes.** An older cover id goes
  `covers.openlibrary.org` → `archive.org/download/…zip/…` → `ia80xxxx.us.archive.org/view_archive.php`
  (a different storage host per image, so a new connection each time): 0.9–1.8 s even for the 2 KB
  'S'. Newer ids are served directly (~0.7 s). 40 at once: all 200, median 1.8 s — no rate limit by id.
- **OpenLibrary 'S' is too small for a list row** (38 px wide for a 40 px cover at DPR 2.6–3); 'M' it is.
- **Apple renders a size on its first request** (~400 ms for any size not yet at the edge, the API's own
  `100x100bb` included), then serves it from cache in 15–30 ms. Size only changes the bytes:
  `120x180bb` is 11 KB against 25 KB for `200x300bb`, enough for 40 px at DPR 3.
- **No blank images and no CORS failures** turned up for cover ids: OpenLibrary's 1 × 1 GIF only comes
  by ISBN without `default=false`, which the app always sends. Both CDNs send
  `Access-Control-Allow-Origin: *`.
- **OpenLibrary by ISBN is not a rescue** for a row without a cover: of 50 such ISBNs, OpenLibrary
  had a cover for 1 and Apple an edition for 4.
- **The DNB answers every browser request with an HTML bot page** (20 of 20 German ISBNs, status 200,
  `text/html`, no CORS): it can never be an `<img>` source. Only a server that downloads and rehosts
  the image could use it (follow-up to #17).
- Search APIs: Apple median 29 ms (p90 476), OpenLibrary 583 ms (p90 1128).

### Time-to-cover in the app, before (Chromium, Fast 4G, 2 runs × 4 queries)

| scope | rows seen | with an image | Placeholder | cover before row seen | median wait ms | p90 wait ms | > 1 s | max CLS |
|---|---|---|---|---|---|---|---|---|
| der zauberberg | 58 | 48 | 10 | 0 | 344 | 548 | 4 | 0 |
| fourth wing | 94 | 74 | 20 | 0 | 283 | 693 | 4 | 0 |
| pride and prejudice | 66 | 64 | 2 | 0 | 445 | 1949 | 14 | 0 |
| im westen nichts neues | 80 | 58 | 22 | 0 | 233 | 381 | 3 | 0 |
| Apple covers | 176 | 176 | 0 | 0 | 282 | 546 | 6 | 0 |
| OpenLibrary covers | 68 | 68 | 0 | 0 | 688 | 1882 | 19 | 0 |
| all | 298 | 244 | **54 (18%)** | **0** | **315** | **1016** | **25** | 0 |

Not one cover had loaded before its row scrolled into view. The cause is the list's fade: Chromium
starts a `loading="lazy"` image a few thousand pixels before it scrolls in, also inside a scroll
container — but not when the container or an ancestor has a `mask-image`, and the search list fades
its far end out with one. Then an image starts only once it is inside the list (checked in
isolation: 60 lazy rows in a 500 px scroller, 44 requested without the mask, 6 with it, also with the
mask on a wrapper). So every row waits a full round trip after it appears, and an OpenLibrary row
three of them. Change edition has no mask: its rows lazy-load ahead as they should, and only
OpenLibrary's latency is left there.

## What changed, and after

1. Rows ask for the size they show (`APPLE_BOX`, `OPENLIBRARY_SIZE` in `utils/cover.ts`): Apple
   `120x180bb` for `xs`/`sm` (a search row and the Add sheet share one URL), `240x360bb` for
   `md`/`lg`, the stored `600x900bb` for the book page; OpenLibrary 'M' up to `md`, 'L' above.
   Median bytes of a search row's Apple cover: 23 KB → 11 KB; of a Change edition row: 27 KB → 10 KB.
2. A cover whose image fails or loads smaller than 16 px on a side (`isBlankCover`) falls back to
   OpenLibrary's cover of the same ISBN (`coverFallbacks`, `default=false`), then the Placeholder.
   None of the sampled images needed it; it is there for the 404s of withdrawn artwork and
   OpenLibrary's 1 × 1 GIF. **Since replaced** ([plans/covers-consistency.md](plans/covers-consistency.md),
   one Book, one cover): a failed size falls back to the same artwork at its other sizes
   (`coverChain`), never to another picture; `coverFallbacks` is gone.
3. Merging picks, among the editions of one book, the first with a cover on Apple's CDN, then the
   first with any cover; among equally good matches a book with a cover ranks above one without.
   In the sample only 1 of 82 coverless picks had a covered sibling, so the share of rows without any
   cover stays 11% (65 of 576): those are OpenLibrary works with no image anywhere, mostly
   self-published student papers on a classic (GRIN, 978-3-640/656/668…). Coverless rows among the
   first ten of a list: 22 → 19.
4. The first six covers (the rows above the keyboard) are preloaded and asked for at
   `fetchpriority="high"`; every other row's cover turns eager once it comes within a list height of
   the view (`useNearView`, an IntersectionObserver rooted at the list, whose margin holds under the
   mask). Change edition's first six rows load at once and first.

Time-to-cover, after (same harness, same queries, same 298 rows seen):

| scope | rows seen | with an image | Placeholder | cover before row seen | median wait ms | p90 wait ms | > 1 s | max CLS |
|---|---|---|---|---|---|---|---|---|
| der zauberberg | 58 | 48 | 10 | 22 | 273 | 441 | 0 | 0 |
| fourth wing | 94 | 74 | 20 | 46 | 0 | 542 | 0 | 0 |
| pride and prejudice | 66 | 64 | 2 | 29 | 249 | 829 | 6 | 0 |
| im westen nichts neues | 80 | 58 | 22 | 37 | 0 | 431 | 3 | 0 |
| Apple covers | 176 | 176 | 0 | 92 | 0 | 447 | 0 | 0 |
| OpenLibrary covers | 68 | 68 | 0 | 42 | 0 | 1676 | 9 | 0 |
| all | 298 | 244 | 54 (18%) | **134 (55%)** | **0** | **526** | **9** | 0 |

Before → after: covers already there when their row scrolls in 0 → 134 of 244; median wait
315 → 0 ms; p90 1016 → 526 ms; rows waiting over a second 25 → 9 (Apple 6 → 0). What is left over
a second is OpenLibrary's redirect chain on a cold cache; only rehosting covers (follow-up to #17)
would take it away. No layout shift before or after: the cover box is sized before its image.
The Apple CDN had the old `200x300bb` sizes warm from the diagnosis and the new `120x180bb` ones
cold, so the after numbers are, if anything, pessimistic.

Not done here: the Android emulator run the issue mentions (the brief asked for Chromium with
throttling instead); a cover for the rows that have none anywhere (DNB rehosting, or an owner call on
ranking coverless results lower than equally good matches by more than a tie-break).

## The import's covers meanwhile (cover fill)

An import row a source identified (or whose ISBN the file names) but whose edition has no cover is queued for
one while the lookup goes on (`data/coverFill.ts`). The ranking decides the order (below): Open Library by ISBN in
batches (by cover id, which has no per-address limit) is the edition itself; a sibling edition from the title
search and Open Library's search by title and author (the work's other editions) are reported at once, as
another edition's cover; then a paced Apple Books search (one request every 3 s, the row's storefront first and
the other once the first has been through every row; Apple's limit is ~20 a minute, measured) looks for the
work's **ebook**, which replaces the other edition's cover when it is found. All under a circuit breaker and a
10-minute budget; the preview and the write never wait for it, and a row that finds nothing stays under "Needs a
look" (a row shown without a cover is never "probably fine": owner rule, since the import-quality fix), drawn with
the cloth. Covers are only linked, from the hosts the Catalogue allows. Sources, terms, hit rates and the
measurement on a real export: [plans/cover-sources.md](plans/cover-sources.md); the behaviour: `docs/parity.md`,
Import books, *Covers meanwhile*. The fill's `api/books` and title searches ride the import's fetch through the
`openlibrary` function (identified, about 3 requests a second; [supabase/functions/openlibrary/README.md](../supabase/functions/openlibrary/README.md));
cover images stay direct.

### The ranking: one rule (`data/coverRank.ts`)

Owner decision: the work's ebook is a first-class route, not a last resort (the APIs know ebooks best; a publisher's
ebook usually wears the print cover). Best first:

1. **exact**: the very edition: its Apple artwork, Open Library's cover for its ISBN.
2. **ebook**: the same work's ebook at Apple Books (`isSameWork`, the language rule), the row's storefront first.
3. **sameWork**: another edition of the same work (a sibling edition, an Open Library work's cover).
4. **goodreads**: Goodreads' cover for the row's title: a last resort, only for a Goodreads file's rows and a manual
   "Find a cover" action ([below](#goodreads-the-last-resort)).
5. **placeholder**: no image: `cover_url` stays null and `UiCover` draws the cloth (by title), so a real cover found
   later replaces it with no flag. Pixel height inside a kind: Apple 900, Open Library `-L` 500, Goodreads 500, Google 128.

Anything but `exact` is *lent*: the Book and the entry keep their own edition facts (ISBN, pages, binding), the
cover is only borrowed, and a better kind found later replaces it (`mergeCover`; a cover the member chose herself
is never replaced). A print and an ebook cover can differ (tie-in, anniversary editions, re-releases), which is why
the ebook is taken only when the edition's own cover is missing, and why the edition picker still offers the other
editions' covers. Apple covers stay linked, never copied. The Catalogue keeps the first snapshot of a Book, so a
Book that landed without a cover gets the one the fill found when a member who holds it imports it
(`fill_book_covers`: only a Book the member holds, only an allow-listed host, never replaces).

A cover found by the lookup is read where it is kept: an Open Library cover is probed at `-L`, not at its 180 px
`-M`. A narrow book's `-M` was under the old 150 px floor, and 19 of 708 books of one real import
lost a cover the lookup had found at the write for that reason.

**A low-resolution cover is better than none** (owner rule). The only floor is a sanity one: under 40 px on the short side
(`MIN_COVER_SIDE`) or one flat colour is no cover. From 40 to 149 px (`PREFERRED_COVER_SIDE`) a cover is accepted when nothing
better exists: the chain keeps it as the fallback while it looks on, and the fill reports it like any other. Resolution is
only a tie-breaker between real covers (`COVER_HEIGHT`, higher wins inside one kind of the ranking), never a reason to
reject the only one. A better kind found later (the fill, a later import) replaces a cover the fill gave before it is
written; once a Book has a cover the server keeps it (`fill_book_covers` and the check fill a missing one only:
[plans/covers-consistency.md](plans/covers-consistency.md)). The UI shows covers scaled by CSS with the thumbhash behind them, so a
small one is soft but not broken. Measurements count a cover of any size as found and report those under 300 px high
separately.

#### Goodreads, the last resort

What: for a Goodreads export's rows that nothing else found a cover for (about half of the cover-less rows of a real
export are Manual books, no ISBN, so no other source can know them) and for the import preview's manual **Find a cover**,
the cover Goodreads shows for the book. The `goodreads-rating` function (`supabase/functions/goodreads-rating`) asks the
keyless `book/auto_complete` search it already uses for the community rating, with `cover: true`, **in this order, the first
accepted hit ending it**: the row's ISBN-13 (the client sends it; the result by one of the book's authors is taken whatever its
title, the ISBN names the edition); the whole title with the first author's name (`Blood & Roses - Buch 2 Callie Hart`); the main
title with the surname (before a subtitle or series dash). The hit with the file's own Goodreads book id is taken as it is
in whichever result set it appears (it is that very edition); otherwise the same-work rule decides: the title's forms, or the
fuzzy title rule (`web/app/data/titleMatch.ts`) with the author's surname. The answer is the
`imageUrl` without its size token (`._SY75_` off: the ~332x500 original) at `i.gr-assets.com`, which allows CORS, so the
browser reads the pixels for the thumbhash like for any cover. Measured on 78 cover-less rows of a real export: 75 got a
same-work cover from it, and the file's book id was among the results for 63. The ISBN-first order and the fuzzy rule exist
because the main-title search alone cut a series' volume down to the series' name ("Blood & Roses - Buch 1" asked as
"Blood & Roses Hart" meets only the English series) and ranked other books for a title Goodreads words differently
("A Fall to Forgive" is "A Fall to Forgive You", "A Jingle Bell Mingle" is "… by Julie Murphy and Sierra Simone").

**The fuzzy title rule** (`web/app/data/titleMatch.ts`, pure, tested in `web/tests/title-match.test.ts`; one rule for every
title-based search): `&`/and, accents, punctuation, a series aside, a volume mark, a credit after the title and a trailing "A Novel"
are normalised away; two titles are one when they are equal, or one is the other plus one word after it ("A Fall to Forgive
You") or a little word before it ("The Lantern in the Quiet Sea"), or they have the same telling words but one. Always together
with the author (the caller says whether the surname matched). Never another volume (two named volumes must be equal; an unnamed
side only stands for the first: "Blood & Roses - Buch 1" is not "Buch 3", nor "Buch 3" the series' bare name), never a summary,
study guide or companion (nor `Coloring Book`, `Journal`, `Boxed Set`, nor "World of …" / "The Art of …" before the title), never a
book that only begins like it (the shorter title needs three words; "Dune" is not "Dune Messiah"; a number or roman numeral added is
a volume), never a translation in another script. It is used by Goodreads' `matchTitle` and, as a second chance after `sameTitle`, by the
import's `isSameWork` (`web/app/data/import/editions.ts`, the flag `LOOSE_TITLES`; measured below).

**An empty list is not a miss.** `auto_complete` answers `[]` (200) for a book it does not know **and** when it throttles softly
(29 of 34 asks in a row on a real export, which a first version counted and cached as 7-day misses). The function therefore
never reads a lone `[]` as "none": a query that answered a list proves Goodreads is answering, so no accepted hit after that is a
miss (cached 7 days); when EVERY query answered `[]` the first is asked again after 1.5 s and 3 s, and if it is still `[]` the
answer is `{ status: 'unsure' }`, stored nowhere. The client reads it as `'later'` (`data/goodreadsCover.ts`): no cover now, no
failure toward the lane's three, and the fill's Goodreads lane asks the row once more after the others (no sooner than 10 s); three
`later` in a row hold the whole lane for 15 s (a throttle, not three unknown books). A genuinely unknown book therefore answers
`unsure` twice and then shows no cover, at the price of up to 10 requests; nothing wrong is ever cached.

**Measured** (19 Oct 2026; one real 709-row Goodreads export, Apple off as for a server job, local stack, counts only;
`web/scripts/import-quality.ts` with `LIBELLUS_IMPORT_APPLE=off` runs the app's own Goodreads client against the local function):

| Apple off | before | after |
|---|---:|---:|
| matched to a real Book | 667 | 671 |
| unmatched (only the file's row; every one has a Goodreads cover) | 42 | 38 |
| matched rows without a cover (= rows without any cover) | 131 | 126 |
| covers of 300 px or more (all rows / matched rows) | 463 / 424 | 469 / 434 |
| covers by source (Open Library incl. DNB-matched / Goodreads) | 506 / 72 | 512 / 71 |
| Goodreads asks (first pass + fill lane) / hits / none / `later` | n/a | 72 (38 + 34) / 71 / 1 / 0 |
| lookups that saw an empty list / retried / unsure | n/a | 6 / 0 / 0 (no throttle that day; the rule is tested on recordings) |
| run time (lookup + 600 s fill) | 1,255 s | 1,245 s |

The client lane barely moves the numbers because **its limits cap it, not Goodreads**: every row first passes the Apple search lane
twice (two storefronts, one search per 3 s, also with Apple off) and only then reaches Goodreads, all under the shared 600 s budget, so the
lane asked **34 of the 160 eligible rows (21%)**. The same 126 rows that stayed without a cover, asked one at a time with no budget and no
failure cap (what a server job does; 1.6 s apart, `unsure` retried up to 3 times) **all 126 got a Goodreads cover, in 229 s, each by its ISBN in
one request** (0 `unsure`, 0 retries). Goodreads' covers measured 63 of 71 at 300 px or more in the run, so about 110 of those 126 would also clear
the 300 px bar. Of the 96 rows Apple's covers saved at that bar (PR #359), 4 are now covered by the capped lane and, by the same count, about 90
by an uncapped one. `isSameWork` with the fuzzy rule (`LOOSE_TITLES`) against without it, same day, lookup only: 667 → 671 matched, 9 rows changed their
edition, and all 9 are the same work by a manual check (a missing leading article, a credit after the title, a "Special Edition", a volume
mark spelled another way); the first version of the rule took one companion book
("World of …" for the book it is about) and was tightened (see above), so wrong matches stay at 0.

Why last: the ranking above. The stage runs after the Apple lane and only for a row with no cover and no fallback, one
ask every 1.6 s (the function's own limit, 40 a minute in a bucket of its own; a lookup is one call of the bucket however many
searches it makes), under the fill's budget, given up after 3
failures in a row. Only linked: the address is the whole of what is stored (`books.cover_url`, and `cover_url` next to the
rating in the function's answer cache); no description, page count or rating of the hit is kept or told on this path.

Flag: `GOODREADS_COVERS` in `web/app/data/coverRank.ts`, one line. `false` removes the stage and the button; no call is made.

Terms risk: Goodreads retired its API in 2020 and its terms forbid automated access. The endpoint is unofficial, and the
community rating already uses it server side (`docs/THIRD-PARTY.md`); using the cover is also a hotlink to its image CDN.
Owner-accepted risk, decided before merge (the PR says so). If Goodreads objects: set the flag to `false`, drop
`i.gr-assets.com` from `private.cover_allowed` (a migration; `cover_shown` then hides the address on the social surfaces
too), and those Books show the cloth cover (UiCover draws it for a cover that does not load), a better source filling in
later by itself. Nothing was copied, so there is nothing to delete.

Blocked: Goodreads can switch the keyless endpoints off or start refusing us, and we must see it and carry on. The function
(`goodreads-rating`) calls it a block, not a miss and not its own `busy`, when `auto_complete` or `review_counts` answers HTTP
403, 429 or 503, a 202 or an empty body, a body that is not JSON, or JSON of another shape. A block is never cached. It opens a
function-level breaker for 10 minutes: no request goes to Goodreads meanwhile, and a lookup that needs one answers
`{ status: 'blocked', retryAfterSeconds }` (HTTP 200, so the client reads it; the book page's rating line then simply stays without
a rating). Each opening writes exactly one line to the function log, **the one to alert on**:
`goodreads_blocked {"status":403,"kind":"status","at":"…"}` (Supabase dashboard, Edge Functions, `goodreads-rating`, Logs; `kind` is
`status`, `empty`, `not_json` or `shape`). In the app the client reads `'blocked'` (`data/goodreadsCover.ts`); the fill's Goodreads
stage gives its lane up at once, not after three failures, and calls `onBlocked` once, which the import store turns into ONE
`errorLog` entry, `goodreads cover source blocked` (kind `error`, the owner's error list; repeats fold into a count). No toast, no
copy: the rows go on without a Goodreads cover and show the cloth, and the manual **Find a cover** answers the same quiet "No cover
found." a miss does. Nothing is lost: a Book whose cover came earlier keeps it (`fill_book_covers`), and the function's own answer
cache (`cover_url`) still serves what it already knows while the breaker is open. When the breaker closes, the next ask tries again.
To switch route for good: set `GOODREADS_COVERS` to `false` (stage and button gone, no call), and, if the address host must go too, drop
`i.gr-assets.com` from `private.cover_allowed` in a migration (as under *Terms risk*).

### One merge for the facts: `mergeSources` (`data/mergeBook.ts`)

The cover ranking above is one field of a general rule: ask several sources about the same book (cheap first, stop when
`isComplete`), then merge **field by field** into the best Book, with provenance. Pure and table-driven
(`SOURCE_RANK` per field), Vitest `tests/merge-book.test.ts`.

- **Work fields** (title, authors, language, description, cover) may come from any candidate the caller checked is the same
  work (`isSameWork`): the work's ebook at Apple, another print edition at Open Library. **Edition fields** (ISBN, pages, year,
  publisher, format, source ids) only from the candidate that *is* the edition: an ebook's page count never lands on the
  paperback. How "her row says paperback, the matched Book is the ebook" works: the Book may be the ebook edition (its
  cover, language, description); the entry keeps her own edition facts, which already exist: `page_count_override` (the
  file's pages), `format_override` / `read_as` (the format she says), the file's ISBN as an `import` Book. Nothing new.
- A value that is not plausible (0 pages, a year of 1066, a wrong check digit, a cover over http, a three-word description)
  is no value and never replaces a good one; where several plausible values exist the one most sources agree on wins, then
  the better-ranked source, then the earlier (stable ties; put the Book's own record first and what it has stays).
- Cover: kind (`coverRank.ts`), then pixel height (Apple 900, Open Library `-L` 500, Goodreads 500, Google 128, or the probed
  height), then the earlier; its thumbhash and colours travel with it. Resolution only ranks real covers, it never rejects one.
- Genre labels (`mergeGenreLabels`, `Merged.genres`): a work field, raw: the union of what every candidate's source calls
  the book's genres (Apple's genre names, "Books" dropped; Open Library's subjects; at most 20 per answer), one per
  normalised spelling, each with the sources and candidates that named it, the most agreed first, at most 30. Not mapped
  onto the app's genre list and not stored yet (the enrich function maps and stores genres server side): the import's match
  carries them (`Edition.genres`) so storing them is one change later.
- Description: only from sources whose terms let it be stored (Apple, Open Library, DNB, the Catalogue: not Google, not
  Goodreads, listed as `withheld`), the book's language before a longer one in another.
- ISBN first: `collectIsbn` gives the ISBN to ask every other source with (the file's, else any source's: an exact one first,
  an ISBN-10 converted), so the pipeline is: ISBN known, ask all sources by ISBN; none, find the work by title and author,
  collect an ISBN from any hit, then ask by ISBN.

Wired now: the import's match borrows a cover by this ranking (`coverLender` in `data/bookImport.ts`: the work's ebook before
another print edition, in the row's language; before, `alternatives[0]` was taken even without a cover). Since the
import-quality fix ([plans/import-quality.md](plans/import-quality.md)) the cover is lent **at match time**, as the cover fill
would give it (`withLentCover` = `mergeCover`, kind `sibling`): the match's pool holds every edition each source named (the
work's ebook and its print edition both, not one per book as Search lists them), so an exact edition without a cover, or a
title match without one, wears the work's best cover before the preview shows it, and the cover fill only looks for what is
still missing. Choose edition shares that pool and ranking (`choiceCandidates`), so the covers it offers are the ones the
match chose from. A row shown without any cover is "Needs a look" (owner rule), never "Probably fine". **Follow-up,
not done:** Search and the barcode scan keep their chain (`data/merge.ts`, first source wins, `fillIn`); they would hand
their per-source answers for one ISBN to `mergeSources` instead; the cover fill would build its `CoverFound` from
`coverKindOfCandidate`; the server job for the import runs the same module.

## Sizes the browser can choose (`srcset`, A7)

`UiCover` gives an Apple cover a `srcset` of the same artwork at the neighbouring boxes
(`coverSrcset` in `utils/cover.ts`): `120x180bb` (120w), `240x360bb` (240w), `600x900bb` (600w), the
ones up to the box its size asks for (`APPLE_BOX`), and `sizes` is the size's token width
(`coverSizes`: 30, 40, 72, 82, 140 px; a cover's width is its size's token alone, no call site
overrides it, so `sizes` is true everywhere). `src` stays the one `coverSrc` URL (old browsers, and
what the fallbacks and the book flight key on; the flight reads `currentSrc`). The halo and the
backing of a fitted image carry the same `srcset`/`sizes`, so all three are one download. Loading
(`lazy`/`eager`, `fetchpriority`) is unchanged.

- `xs`/`sm` (30, 40 px) have one candidate (120w), so no `srcset`: the single URL stays.
- `md`/`lg` offer 120w and 240w: a 72 px cover on a 1× screen takes 120w, no longer 240w.
- `xl` (the book page hero) offers 120w, 240w and 600w: 140 px at 1× takes 240w, at 2× and 3× 600w.
- OpenLibrary has **no** `srcset`: 'M' and 'L' are maxima ("up to 180 px"), not fixed widths, so a
  width descriptor would be a guess, and every extra OpenLibrary request is a ~575 ms round trip.
  It keeps one URL per size (`OPENLIBRARY_SIZE`).
- Not done on purpose (owner decision): always the largest image downscaled locally, `@nuxt/image`.
  So a list row and the book page still ask for different boxes; the browser's choice only follows
  what the screen can show. They are the same picture (measured: 185 of 185 stored covers), and a box
  that fails falls back to the others of the same artwork (`coverChain`,
  [plans/covers-consistency.md](plans/covers-consistency.md)).

## A cover in view stays (A8)

**Replaced** by *one Book, one cover* ([plans/covers-consistency.md](plans/covers-consistency.md)): holding
on to the first artwork is what let a row kept alive (Home, the Library) show the device's old cover while
the Book's page showed the new one. A mounted cover now follows its Book; another size of the artwork in
view still takes over only once it has loaded. What follows is the history.

Owner report: a cover sometimes becomes a different image. Found in the code (`UiCover` before the
guard), in the order they can happen:

1. **Real, the main one.** A mounted `UiCover` whose `src` changes: its `watch` on `props.src`
   reset `attempt` and `loaded` and showed the new URL. Rows stay mounted (keyed by entry or
   Book) while a re-sync or a change of edition hands them another `coverUrl`, so the shown
   cover was replaced by another artwork.
2. **Real, rarer.** An `error` or blank `load` on an image already shown moved on to
   `coverFallbacks` (OpenLibrary's cover by ISBN): another artwork. `fallbacks` was not part of the
   watch, so a stale attempt index also survived a changed list. With `srcset` (A7) a size of the
   same artwork can fail too, which would have been this path.
3. **Not a cause of a swap.** `withCover` (`stores/library.ts`) runs only when a Book is added,
   before the Book has a cover: nothing mounted shows the old one. An add under a mounted cover of
   the same edition arrives as path 1.

End-state rule, in `utils/cover.ts` (`CoverShowing`; `tests/cover-showing.test.ts` pins each path,
including the old behaviour as `before`): **once an image of a cover has loaded and is not blank, a
later `src`, or a fallback, never replaces it with another artwork unless the one in view fails to
load or comes back blank.**

- Another size of the same artwork (`artworkOf`: Apple's box, OpenLibrary's S/M/L ignored) is not
  another image: it takes over, the image in view stays until it has loaded. If that size fails,
  the cover goes back to the size that loaded (no `srcset` again) rather than to a fallback.
- A newer `src` of another artwork is held (`held`). If the image in view fails, the fallbacks of
  the old chain are tried first, then the held one, then the Placeholder.
- The deliberate change is signalled by `identity` (a `UiCover` prop): what the cover is of. Another
  `identity` starts the cover afresh. Default: title and authors (a different Book at the same
  mounted `UiCover`). Where a mounted cover changes edition under the same title it is given
  the edition's ISBN: the book page (`pages/book/[key].vue`, which stays mounted through Change
  edition), the edition picker's rows (keyed by index), Own edition's found step, and its cover
  preview (the link itself).
- Before any image has loaded nothing is held: a new `src` shows as before.

## Covers in "More from the author" (A9)

Owner: one author's row loaded whole, another's showed two covers about a second late. Cause: the
work cards from `author_page` (`work_card`) carry a cover URL and the edition's ISBN, **no
thumbhash or colours**, and `AuthorWorkRow` passed neither them nor fallbacks; its rows were lazy
images in a section that opens with a reveal, so a cover was asked for only when its row was in
view, and an OpenLibrary one answers in ~575 ms (p90 1.1 s) on top of the author page's own round trip.

- The rows get what the data has: OpenLibrary's cover of the edition by ISBN as a fallback
  (`workCoverImages`, `coverFallbacks`; both gone since one Book, one cover: a row's cover is the one of
  the edition it opens, and its page shows that cover, [plans/covers-consistency.md](plans/covers-consistency.md)); a work she has (her Library entry on the device, and that
  Book's cover is the very image the card names) sits on her Book's thumbhash and colours, any other
  on the quiet fill every cover without them has. Adding thumbhash/colours to `work_card` would
  only cover works she owns, which the device already knows, so no migration.
- The section asks for its covers as soon as her page arrives (`coversToPrefetch` →
  `new Image()`, at most `MORE_FROM_AUTHOR` = 3, each once, at the row's size), and its rows are
  `eager`.
- The source ranking is unchanged: the card's cover is what the page chose (hers, else in her
  language). There is no data here that Apple has covers for the same works; looking each one up by
  ISBN on Apple (36 ms against OpenLibrary's 575 ms) would be a follow-up, measured first.

## Lazy images, audited (L1)

Owner: nothing off-screen should be rendered or requested until it is near the viewport. Every
`<img>` the app can render was read and, for the screens the harness reaches, counted
(`cd web && pnpm perf:images`: per screen the `<img>` in the DOM, lazy/eager, `decoding`, on screen,
loaded, cover requests and bytes, the eager ones that load off screen; Chromium, Slow 4G network,
412 × 915 at 2.625×, seeded Library of 150 entries; the covers answered by `perf/serve.mjs`).

**The browser's distance.** `loading="lazy"` starts an image when it comes within a distance of the
viewport that Chromium sets by connection type: 1,250 px on 4G or faster, 2,500 px on 3G or slower.
Measured here (Library, Slow 4G profile, viewport 915 px): the last row requested starts at
2,161 px from the top of the page, the first one held back at 2,238 px: 915 + 1,250. That is
17 rows beyond the screen (77 px each) loaded on Library mount, 28 covers (299 KB) in all: 8 eager
(the rows above the fold), 3 lazy on screen, 17 lazy ahead. Horizontal rows (Home's Up next) work the
same way on the x axis. Safari and Firefox choose their own distances (not measured: WebKit has no
throttling in the harness); the app sets none. The two places where a mask or a clipped box defeat
the browser's look-ahead have their own rule (search results: `useNearView`, above; sections that
open with a reveal: eager, A9).

Rules the audit settled on: a cover is `eager` only where it is the first screen (Home's reading
cards and Up next, the Library's first rows, the first of a list inside a sheet that has just
opened), where it is the page's LCP (the Book page's hero: `eager`, `priority`), where a clipped box
would keep a lazy image from starting (More from the author's three rows, prefetched in A9), or
where the cover flight needs the image there (below). Everything else is lazy. Every `UiCover` image
is `decoding="async"`, in a 2:3 box of a token width (`aspect-2/3`), so no image shifts the layout;
the plain `<img>`s below are all in boxes of their own size.

**The cover flight** (docs/MOTION.md, `useBookFlight.ts`) needs two things, and lazy loading touches
neither: the tapped cover is on screen, so its image has started (within the browser's distance by
construction; before it has loaded the flight shows its thumbhash, as before), and the hero's
image is `eager` and asked for with `preloadImage` (`fetchpriority="high"`) when the finger goes
down. The flight's own copies (`snapshot.ts`, `useEditionChange.ts`, `readerFlight.ts`) are made
`eager`/`sync` by their code. `identity` and the More from the author prefetch are unchanged.

| Image site | Before | After |
| --- | --- | --- |
| `UiCover`: the sheet image | lazy / eager by prop, `decoding=async`, `fetchpriority=high` with `priority` | same |
| `UiCover`: the halo (`glow`) | same URL as the sheet, `decoding` default (sync) | `decoding=async`: its decode no longer blocks a frame |
| `UiCover`: the backing of a `whole` cover | no `loading`, no `decoding` (eager) | follows `eager`, `decoding=async` |
| Home: reading cards (`index < 3`) | eager (the LCP is the first one) | same |
| Home: Up next (`index < 5`) | eager | same: on screen on a phone (8 cold-start covers, 296 KB, all visible) |
| Home: Next in your series, the Friends feature and rows | eager (`index < 3`, the feature) | **lazy**: the last sections of Home, below the fold; the section's reveal opens when its data is there and the browser starts what is in range |
| Library: segment rows (`index < 8`), reading cards (`< 4`) | eager; the rest lazy | same (11 rows on a phone: 8 eager, 3 lazy on screen, 17 lazy ahead) |
| Library: "Collections" link covers (xs) | lazy | same |
| Profile: favourite, year cards, authors' books (3 each), month books, read rows, public pages | lazy | same (none on the first screen) |
| Profile year page (`/profile/:year`): month books | lazy | same: 47 `<img>`, 28 on screen, 39 requests |
| Collections list (mosaics, `index < 4`) and a collection (`index < 10`) | eager | same: on screen (16 and 10) |
| Search results (the sources' rows) | eager first six (+ `priority`) and rows within a list height (`useNearView`, a mask defeats lazy) | same |
| Search results: her own Books ("In your Library") | **every row eager**, however many match (an author with 40 Books: 40 requests) | first six, then the rows within a list height, like the others |
| Edition picker (Book page), Own edition, Edition choice (ebooks), import's done screen | eager / first six, in sheets that mount on open or at the top of a page | same |
| Author page: works (`index < 4`) | eager in **every** group (a series below the fold asked for 4 covers at once) | eager in the first group only |
| Book page hero | eager, no priority | eager, `fetchpriority=high` (the page's LCP; the flight preloads it the same way) |
| More from the author | eager, prefetched (A9) | same |
| Friends: feed rows (`dayIndex === 0 && index < 4`), member pages, sheets | eager first four of the first day, else lazy | same |
| Ebooks: waiting rows, candidate sheet, contents sheet, end of book | lazy | same (blob or file covers: no network) |
| Sign-in wall (`AuthFrame`, 20 plain `<img>` of 82 px in boxes of the wall's size) | the URL's 600 × 900 (≈ 116 KB each), all eager, low priority: 20 requests, 2,319 KB; then (#263) `lg` 240 × 360, the first two rows eager: 20 requests, 737 KB, **before the form was painted**: a cover was the page's LCP (5.6 s in production, 2.2 s without them) | `lg` 240 × 360 (37 KB) on **fifteen** covers (the fourth row lies under a veil that is opaque from 48 % down: 0–2 % of a cover on a phone, ≤ 6 % on a 1080p desktop; its boards stay), asked for after the form is painted and the browser idle (`afterPaint`), low priority, drawn on `<canvas>`es (`WallCover.vue`: a canvas is not an LCP candidate, an `<img>` of 82 px is bigger than the wordmark), faded in over their board; 0 cover requests before the form, 15 / 564 KB after (see Sign-in wall, below) |
| Avatar (header, Profile, photo editor), author portrait | plain `<img>`, eager, in a 32–72 px circle, first screen; the portrait is the author page's hero | same: first screen, sized box, initials underneath |
| Photo crop (`profile/Photo.vue`) | an object URL in a box of explicit size | same |
| CSS: thumbhash under a cover (`background-image: url(data:…)`), film grain (inline SVG), Button gradient | no request | same: no `url()` reaches the network anywhere in `app/` |
| Shelf (`ShelfRow`, `ShelfStage`) | colours only; Regal (the private layer: its own textures) is not in this repo and not in the build | same |
| Reader | EPUB images come from the book file (blob URLs, sanitised in `data/reader/markup.ts`): no network | same |

**Sign-in wall, after the form** (`pnpm perf:wall`, `perf/wall.ts`: first launch of `/sign-in`, Pixel 7 profile, `slow4g-4x`, 7 runs per series, two series per build in turn, load 1.4–1.8; medians (min–max); the cover host is the harness's stand-in, so Apple's real latency is not in it):

| | before (v1.9.2) | after |
| --- | ---: | ---: |
| LCP | 6,200 ms (`img.cover`) | **2,092 ms** (the wordmark) |
| Form shown | 2,105 ms | 2,105 ms |
| Requests / KB asked for by the form's first paint | 48 / 1,025 | 28 / 284 |
| Cover requests before the form is painted | 20 | **0** |
| Requests / KB after 8 s | 53 / 1,034 | 48 / 848 (15 covers) |

An `<img>` was tried first (mounted after the form, lazy, low priority, fading in): the form was no longer behind the covers, but each cover (82 px, 100 × 134 with the tilt: 13,462 px²) is a larger LCP candidate than the wordmark (10,168 px²), so LCP moved to the moment the first cover arrived (5.6 s). Hence the canvases. `e2e/sign-in-wall.spec.ts` pins: no cover request starts before the first frame with the form in it, the `lg` size, the wall `aria-hidden` with nothing focusable, the member's focus kept, the fade (and none with Reduce Motion).

Measured with the harness (`slow4g-4x`, 5 runs, medians, load average 3.6–4.0; cover requests and
bytes from the network log; the first column is the build before this change, the second after):

| | before | after |
| --- | ---: | ---: |
| Cold start (Home shown): cover requests / KB | 8 / 296 | 8 / 296 |
| Warm start | 8 / 296 | 8 / 296 |
| Library mount (Home → Library, `b1`) | 28 / 301 | 28 / 299 |
| Library scrolled to the bottom (`b2`) | 26 / 595 | 26 / 590 |
| Profile open (`b3`) | 13 / 191 | 13 / 191 |
| Sign-in, signed out (`perf:images`, unthrottled) | 20 / 2,319 | 20 / 737 |
| Search "the" on a Library of 150 (`perf:list`, her own Books match widely) | 157 / — | 28 / — |

So the signed-in screens did not change: they were lazy already, and the audit's job there was to
prove it and to find the few exceptions (above). Home's first screen asks for the 8 covers it shows
and no more; the Library asks for 28 of the 51 images in its DOM, those within 1,250 px.
