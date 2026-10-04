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

## What follows

1. Rows ask for the size they show: Apple `120x180bb` for `xs`/`sm` (a search row and the Add sheet
   share one URL), OpenLibrary 'M'.
2. A cover that fails or comes back blank (a tiny image) falls back to the next source for the same
   edition (OpenLibrary by ISBN) before the Placeholder.
3. Merging prefers, among the editions of one book, one whose cover is on Apple's CDN, then any with
   a cover, so a work OpenLibrary has no cover for does not hide a covered edition.
4. The first visible rows load at high priority (and are preloaded with it); the rest load once they
   come within a screen of the list's view, measured by an IntersectionObserver whose root is the
   list itself (its root margin is honoured under the mask), so the fade stays. Change edition's first
   rows the same.
