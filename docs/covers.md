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
   OpenLibrary's 1 × 1 GIF.
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
  what the screen can show.

## A cover in view stays (A8)

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
  (`workCoverImages`, `coverFallbacks`); a work she has (her Library entry on the device, and that
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
| Home: Next in your series, Circle feature and friends | eager (`index < 3`, the feature) | **lazy**: the last sections of Home, below the fold; the section's reveal opens when its data is there and the browser starts what is in range |
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
| Sign-in wall (`AuthFrame`, 20 plain `<img>` of 82 px in boxes of the wall's size) | the URL's 600 × 900 (≈ 116 KB each), all eager, low priority: 20 requests, 2,319 KB | `lg` 240 × 360 (37 KB), the first two rows eager, the two rows under the veil lazy: 20 requests on a phone (all within range), **737 KB** (−68 %) |
| Avatar (header, Profile, photo editor), author portrait | plain `<img>`, eager, in a 32–72 px circle, first screen; the portrait is the author page's hero | same: first screen, sized box, initials underneath |
| Photo crop (`profile/Photo.vue`) | an object URL in a box of explicit size | same |
| CSS: thumbhash under a cover (`background-image: url(data:…)`), film grain (inline SVG), Button gradient | no request | same: no `url()` reaches the network anywhere in `app/` |
| Shelf (`ShelfPile`, `ShelfRow`) | colours only; Regal (the private layer: its own textures) is not in this repo and not in the build | same |
| Reader | EPUB images come from the book file (blob URLs, sanitised in `data/reader/markup.ts`): no network | same |

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

So the signed-in screens did not change: they were lazy already, and the audit's job there was to
prove it and to find the few exceptions (above). Home's first screen asks for the 8 covers it shows
and no more; the Library asks for 28 of the 51 images in its DOM, those within 1,250 px.
