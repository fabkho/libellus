# Own covers for catalogue books (plan, not built)

Status: plan, 30 October 2026, revised after an independent review ("go with changes"). Nothing here is implemented or
deployed; the bucket `libellus-covers` exists (account `56a9487b…`, location hint WEUR, empty, no public access).
Counts only, no titles, ISBNs or member data, here and in every PR and report this plan produces.

## The decision and what it changes

**Owner decision (30 Oct 2026):** every cover of a Book that is in any member's Library (a `library_entries` row points
at it) is stored by us, in Cloudflare R2, at the sizes the app shows. Covers of our catalogues are then fast and never
depend on Apple or Open Library being up. The edge cache at `/cover` (`web/functions/cover.js`, #417) stays, but only
for what is not in anyone's Library: search results, the edition picker, a work's card on an author page, a Book whose
copy is not stored yet or failed.

This reverses a documented rule. `docs/plans/cover-sources.md` and `docs/plans/covers-consistency.md` say a cover is
"linked, never copied into our storage", and THIRD-PARTY.md says Goodreads covers are "linked, never copied". The owner
accepts the risk on the same grounds as the cover cache (a private app for him and a few friends, no benefit drawn from
the covers, copies made only of books members hold, paced and identified); the documents change with the work (PR 8).
"One Book, one cover" (covers-consistency.md) is kept: the stored copies are the Book's one artwork at several widths,
and when a copy fails the app falls back to the same artwork at the source, never another picture.

### "One request loads everything": what is honest

An image cannot ride inside the JSON of the Library without making that JSON large and uncacheable (186 covers at
even 6 KB each would be over a megabyte of base64 on every Library load, and it would change whenever any Book does).
So images stay separate requests. What we can make true:

1. **The data request carries everything needed to draw the cover at once:** the thumbhash (`books.cover_thumbhash`,
   ~30 bytes) for an instant blurred cover, the two colours, and the stored copy's key and widths. No lookup, no
   redirect, no second round trip to learn an address: the app builds the final image URL from the Book row alone.
2. **The image requests are cheap:** answered from Cloudflare's edge cache in milliseconds, on a connection the page
   already has (option B below) or one preconnected host (option A); small (WebP at the width shown: an Apple cover at
   120 px is ~5 KB, at 600 px ~25 KB, measured below).
3. **A reopened Library needs no network for covers:** the service worker keeps our copies cache-first, and the URLs
   never change (content-addressed), so a cached copy is never stale.
4. **Every catalogue Book gets a thumbhash:** the store job fills a missing one (today the import's covers arrive
   without, `supabase/functions/import-job/covers.ts`), so no stored cover ever shows the flat fill first.

What it is not: the covers of a screen are still N image requests the first time, and a Book added a minute ago shows
the source (or `/cover`) until its copy is stored (about a minute) and the Library is read again.

## Measured (30 Oct 2026, one address, one sample each, public cover URLs from the test fixtures)

| what | bytes | time |
| --- | ---: | ---: |
| Apple `120x180bb.webp` / `.jpg` | 5,276 / 7,218 | — |
| Apple `240x360bb.webp` / `.jpg` | 8,618 / 21,642 | — |
| Apple `360x540bb.webp` | 12,624 | — |
| Apple `600x900bb.webp` / `.jpg` (the size `books.cover_url` stores) | 25,312 / 119,560 | — |
| Open Library by cover id, `-M` (180 × 254) | 16,679 | 2.2 s, 2 redirects |
| Open Library by cover id, `-L` (353 × 500) | 49,382 | 2.1 s, 2 redirects |

Two findings decide the design. **Apple's image server renders WebP itself** (`…/<w>x<h>bb.webp` answers `image/webp`,
`Access-Control-Allow-Origin: *`), ~4.7× smaller than the JPEG at 600 px, so the majority of our covers need no
resizing or encoding by us at all. **Open Library is the slow one** (seconds, through archive.org), which is exactly
what storing removes.

## 1. How the images are served: two options, the owner decides

Both keep the bucket as the one store and the same keys (§2); they differ only in the door the browser uses.

**A. The bucket public on a custom domain, `covers.betterreads.de`.** Cloudflare serves the objects from its edge cache;
no code runs per request.

**B. A Pages Function with an R2 binding, same origin: `/c/<key>/<w>`** (`web/functions/c/[[path]].js`, next to
`/cover`). It reads the object through the binding, keeps it in `caches.default` (as `cover.js` does), and the bucket
stays private: no custom domain, no public access at all.

| | A: custom domain | B: Pages Function, same origin |
| --- | --- | --- |
| Per-request cost | none (edge cache; R2 read on a miss) | one Pages Function invocation per image request the service worker does not answer; a few thousand a day for this private app against the free 100,000 a day, shared with `/r`, `/share`, `/cover` |
| What it needs set up | custom domain, Cache Rule (keys have no extension), Response Header Transform Rule for CORS, a WAF referer rule, CSP `connect-src` and preconnect, a second origin in the service worker, `crossorigin` on every own-cover `<img>`, preload link and texture | an R2 binding on the Pages project; the existing `/cover` WAF and rate-limiting rules extended to `/c/` |
| CORS for the reel's WebGL textures | needed (cross-origin), via the Transform Rule; `crossorigin` must not leak to fallbacks on hosts without CORS | not needed (same origin) |
| Both app domains and previews | one host serves all origins; the WAF rule lists them | works on every origin (`betterreads.de`, `libellus.fabkho.dev`, `*.libellus-3q1.pages.dev`) with no configuration, relative URLs |
| Bucket exposure | public by key | private; the Function is the only door and checks `Origin`/`Referer` like `/cover` |
| When it fails | edge or R2 down: the chain falls back to `/cover`, then the source | over the daily Function limit or R2 down: same fallback (Pages answers the Function's paths with an error, never a bill) |
| Speed | an edge-cache hit, no code | an edge-cache hit through a Function (single-digit ms more); misses read R2 through the binding |

**Recommendation: B.** For an app used by its owner and a few friends, the invocations are a small fraction of the free
pool (a reopened Library is answered by the service worker and costs nothing), and B removes four dashboard rules, a
second origin, all CORS handling and the public bucket. It is the `/cover` pattern the code already has, so the client
change is smaller and works on both domains and on previews unchanged. A is the upgrade path if the Function pool ever
gets tight (the owner's Pages analytics show daily invocations; move at ~50,000 a day): keys and objects stay the same,
only the base URL in the client changes.

### B in detail (recommended)

- `web/functions/c/[[path]].js` accepts exactly `/c/<32 hex>/<width>` (width an integer 16–2000), `GET`/`HEAD` only.
  The `Origin`/`Referer` check is `cover.js`'s `sender` (moved into a small module both import), so other sites cannot
  embed it; CORS only for `COVER_ALLOWED_ORIGINS`, never `*`.
- `caches.default.match(url)`; on a miss `env.COVERS.get('c/<key>/<w>')`: the stored `Content-Type`,
  `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-site`, put into the cache with `waitUntil`. A missing object is a 404 with
  `no-store` (the app's chain falls back). Streaming a body costs no CPU worth counting against the free 10 ms.
- The existing WAF custom rule blocking `/cover` without the app's `Referer` and the rate-limiting rule on `/cover`
  (docs/HOSTING.md) get `/c/` added, in both zones (`fabkho.dev` for `libellus.fabkho.dev`, `betterreads.de`).
- The service worker's navigation fallback never answers `/c/` (images only, `request.destination !== 'document'`).

### A in detail (if the owner prefers it)

Why `covers.betterreads.de`: the app is being renamed to BetterReads and already serves at `betterreads.de` (zone
`betterreads.de`, free plan, same Cloudflare account); `libellus.fabkho.dev` is the older domain. Cover URLs are
immutable and end up in every device's service-worker cache, so they go on the domain that stays. Everything below
lives in the `betterreads.de` zone.

- **Custom domain** `covers.betterreads.de` on the bucket (R2 → bucket → Settings → Custom Domains). `r2.dev` stays off
  (rate-limited, not for production).
- **Cache Rule** for `http.host eq "covers.betterreads.de"`: eligible for cache, edge TTL "use origin's Cache-Control"
  (our keys have no file extension, and Cloudflare caches only known extensions by default).
- **Object headers** set at upload: `Content-Type` and `Cache-Control: public, max-age=31536000, immutable`.
- **CORS** via a **Response Header Transform Rule** on the host: `Access-Control-Allow-Origin: *`,
  `X-Content-Type-Options: nosniff`. Not the bucket's CORS policy: R2 adds the header only to a request carrying
  `Origin`, and the cache does not key on `Origin`, so a copy cached from a plain `<img>` would reach a later CORS
  request without it. A transform rule runs on cache hits too. `*` is safe: the images are not secret, no credentials.
- **Hotlinking:** a WAF custom rule blocks a request to the host whose `Referer` is present and is not one of the app's
  origins: `https://betterreads.de`, `https://libellus.fabkho.dev` while both serve the app, and previews on
  `libellus-3q1.pages.dev` itself and `*.libellus-3q1.pages.dev`. For example:
  `http.host eq "covers.betterreads.de" and http.referer ne "" and not (starts_with(http.referer, "https://betterreads.de/")
  or starts_with(http.referer, "https://libellus.fabkho.dev/") or starts_with(http.referer, "https://libellus-3q1.pages.dev/")
  or http.referer wildcard "https://*.libellus-3q1.pages.dev/*")`. **Test the expression when creating the rule**: if
  the free plan's editor refuses `starts_with`, use `wildcard` for each origin (`"https://betterreads.de/*"`); never a
  bare `contains`, which `https://evil.example/?https://betterreads.de/` would pass. A request without `Referer`
  passes; what stops guessing is the HMAC key. Drop `libellus.fabkho.dev` once it no longer serves the app.
- **Client extras:** `<link rel="preconnect" href="https://covers.betterreads.de" crossorigin>`, the host in the CSP's
  `connect-src` (`web/public/_headers`, `web/e2e/serve.mjs`), `crossorigin="anonymous"` on every own-cover image, on
  the reel's preload links (`utils/regalReelPreload.ts` and Regal's `preloadReelCovers`, which must set `crossorigin`
  for this host or the preloaded copy is not the one the texture uses) and on textures. The attribute must not stay
  on an `<img>` whose chain falls back to a host without CORS headers (Goodreads' `i.gr-assets.com`,
  `books.fabkho.dev`): the helper drops `crossorigin` for those fallbacks (or PR 6 verifies they send
  `Access-Control-Allow-Origin` and records it).

**`/cover` on `betterreads.de` (done).** The `/cover` WAF rule lived only in the `fabkho.dev` zone; the same rule in the
`betterreads.de` zone is in place (a request to `betterreads.de/cover` without the app's `Referer`, or with a foreign
one, answers 403). Either option extends it to `/c/` (B) or adds the host rule above (A).

## 2. Object keys, sizes and formats

**Keys are content-addressed:** `c/<key>/<width>`, where `<key>` is the first 128 bits, hex (32 characters), of
`HMAC-SHA256(COVER_KEY_SECRET, "v1:" + bytes of the largest variant)`. **Only the largest variant enters the key**: it
is fetched first, the smaller ones are fetched after the key is known and never change it. Why each part:

- **Content, not Book:** Books share artwork (a lent cover, `isLent` in `data/coverRank.ts`; editions with one Apple
  artwork), so one image is stored once and every Book with it points at the same key. A URL never changes its bytes,
  so `immutable` is true.
- **An HMAC, not a plain hash:** with a plain SHA-256 anyone could fetch an Apple cover, hash it and ask our address
  whether some member holds that book. With a secret, a key cannot be derived from the image; keys are only found in
  members' payloads. Rotating the secret is a runbook step (below).
- **`v1:` in the input:** a later change of what is stored (another format, other widths) is a `v2` with new keys, so
  a cached `v1` URL never gets other bytes.
- **No file extension:** the `Content-Type` stored with the object says the format.

**Widths: 120, 240, 360, 600 device pixels** (a subset of `COVER_WIDTHS` in `utils/coverSize.ts`). Against the token
widths (`COVER_WIDTH`: 30, 40, 72, 82, 140 CSS px) and the reel (`REEL_BOOK_HEIGHT`, 200 px wide cards): 120 covers
`xs`/`sm` up to 3×; 240 covers `md`/`lg` up to ~3× and `xl` at 1.7×; 360 covers `xl` at 2.5× and the reel at 1.8×;
600 covers `xl` and the reel at 3×. 960 is not offered: no source we store has more than 600 px of a cover worth
showing, and no screen draws a cover wider than 200 CSS px. Nothing is upscaled.

**Where the sizes come from: the source's own renderer, so we never resize.** Cloudflare Images is paid past its free
quota; Workers on the free plan have 10 ms of CPU (no codec fits); a Supabase edge function has 2 s of CPU per
invocation, which the import job already avoids spending on decoding (`import-job/covers.ts`); resizing in the browser
cannot cover the server import, cannot encode WebP on Safari, and would have to be trusted. So the store job asks each
host for the sizes it offers and copies the bytes:

| source (by `books.cover_url`) | variants fetched and stored | format |
| --- | --- | --- |
| Apple (`*.mzstatic.com`, `…/<w>x<h>bb.<ext>`) | `600x900bb.webp` (the key), then `360x540bb.webp`, `240x360bb.webp`, `120x180bb.webp` | WebP (Apple's) |
| Open Library (`covers.openlibrary.org/b/<kind>/<key>-*.jpg?default=false`) | `-L` (the key), then `-M` | JPEG |
| Goodreads (`i.gr-assets.com`) | the one image the address names | as served (JPEG) |
| Regal's library (`books.fabkho.dev`) | the one image | as served |

An Apple URL that is not of the `…/<w>x<h>bb.<ext>` shape (`APPLE_PATH` in `utils/coverSize.ts`) is
`unsupported_url`, terminal: we do not guess how to size it, and the Book keeps its source address.

The widths stored are **the real ones**, read from each image's header (JPEG SOF, WebP VP8/VP8L/VP8X, PNG IHDR: a few
bytes, no decoding), because Apple's `bb` box keeps a cover's proportions and Open Library's sizes are not fixed. Equal
widths are stored once. They go to `books.cover_widths`, so the client's `srcset` is exact.

Open Library and Goodreads stay JPEG in v1; a WebP re-encode (wasm `@jsquash/webp`, measured against the 2 s CPU limit
first) is a possible `v2`, not part of this plan.

## 3. When covers are stored, and who writes to R2

**The database decides, one edge function stores** (`supabase/functions/cover-store`). No client path changes for
storing: every way a Book reaches a Library or changes its cover ends in the database.

**A reconcile instead of enqueue triggers.** Add, scan, manual add, both imports, Change edition, own edition, the
manual cover pick, the Apple upgrade (`fill_book_covers`), the Goodreads last-resort cover, the catalogue check and
enrich all end with a Book in a Library whose `cover_key` is null (new, or cleared because its picture changed). So one
statement finds them all, and no path can be forgotten:

```sql
insert into private.cover_store_queue (book_id, source_url)
select b.id, b.cover_url
  from public.books b
 where b.cover_key is null
   and b.cover_url is not null
   and private.cover_allowed(b.cover_url)
   and exists (select 1 from public.library_entries e where e.book_id = b.id)
on conflict (book_id) do nothing;
```

It runs from the minute tick (`private.cover_store_tick()`, only while `enabled`), backed by a partial index
`books (id) where cover_key is null and cover_url is not null`. Latency is about a minute, the same as the kick's. The
first run after the owner turns the job on **is the backfill** (~186 Books today); no separate backfill migration.
Enqueue triggers on `library_entries` and `books` were considered and dropped: they would duplicate this statement on
the hottest write paths (an import inserts hundreds of entries in one statement) for a minute of latency.

**One trigger stays: the key follows the picture.**

```sql
create trigger books_cover_key_follows_cover
before update of cover_url on public.books
for each row
when (private.cover_artwork(old.cover_url) is distinct from private.cover_artwork(new.cover_url))
execute function private.books_clear_cover_key();   -- cover_key, cover_widths := null; delete the queue row
```

The `WHEN` matters: `catalogue_check_keeps` and `fill_book_covers` write `cover_url` with the same value on every check,
and a plain `UPDATE OF cover_url` trigger would clear every key and re-queue every Book each time. `private.cover_artwork`
(immutable SQL, the database twin of `artworkOf` in `utils/cover.ts`) strips what is only a size: Apple's
`/<w>x<h>bb.<ext>` segment, Open Library's `-S/-M/-L` and `?default=false`. So `…/600x900bb.jpg` → `…/600x900bb.webp`
keeps the key (same artwork), another artwork clears it. Deleting the queue row lets a `gone`/`failed` Book try again
with its new cover on the next reconcile. pgTAP: an identical-value update keeps the key; an Apple size change keeps
it; another artwork clears it and the queue row; `cover_store_done`'s own write (`cover_key`, `cover_widths`, an empty
thumbhash filled) does not fire it.

**Queue:** `private.cover_store_queue (book_id uuid primary key references public.books on delete cascade, source_url,
state queued|leased|failed|gone|unsupported, attempts, due_at, leased_by, leased_until, last_error, enqueued_at)`.
A leased row whose Book is no longer in any Library is dropped at claim time.

**Run:** the tick (pg_cron, every minute) reconciles, then calls `private.cover_store_kick()`, which does nothing (no
HTTP) when no row is due, else posts `{ "action": "run" }` to the function through pg_net with the Vault secret
`cover_store_token` (the import job's pattern, `private.import_job_kick`). A run that leaves rows due kicks the next
one at once.

**One run** (`runner.ts`): `cover_store_claim(runner, 8)` leases up to 8 due rows for 170 s (`for update skip locked`),
4 at a time. For each:

1. **Plan** the variant URLs (`plan.ts`); a URL off `COVER_STORE_HOSTS` or of an unknown shape is `unsupported_url`.
2. **Fetch the largest variant**, compute the key.
3. **Reserve the key:** `cover_store_reserve(key)` inserts the `private.cover_objects` row (or clears its
   `orphaned_at`), and **refuses while `deleting_at` is set** (GC is deleting that image; the row is booked again in
   10 minutes). Nothing is uploaded before the reservation.
4. **Fetch the other variants, `PUT` every one** (no `HEAD` first: a `PUT` of the same bytes is one Class A operation and
   harmless; the `HEAD` saved nothing and added a request).
5. `cover_store_done(book, source_url, key, widths, thumbhash?, colours?, bytes)`: a compare-and-swap, written only if
   the Book's `cover_artwork(cover_url)` is still that of `source_url` (a cover changed meanwhile has had its row
   deleted by the trigger and is found again by the next reconcile); a row done twice changes nothing.

**Fetching rules** (`fetch.ts`, identified `User-Agent` with the contact address, 8 s timeout, at most 2 MB, magic
bytes checked):

- **Redirects by hand:** `redirect: 'manual'`, at most 3 hops, each `Location` must be `https:` and on the allowlist
  (`*.mzstatic.com`, `covers.openlibrary.org`, `archive.org` and `*.archive.org`, `i.gr-assets.com`,
  `books.fabkho.dev`). A redirect anywhere else is `host_error` (no SSRF through a redirect).
- **Open Library's limits:** covers by `isbn`, `oclc` or `lccn` are limited to 100 requests per IP per 5 minutes and
  answer 403 past it (its docs ask not to crawl them); covers by `id`/`olid` are not. ISBN/OCLC/LCCN-keyed URLs go
  through an `edge_pace` bucket `openlibrary-covers-keyed` at **0.3 requests a second** at most; id URLs through
  `openlibrary-covers` at 2 a second. **A 403 is retry-later** (`throttled`: booked again after 10 minutes, not counted
  as an attempt), never `gone`. PR 2 checks whether the first redirect of a keyed URL names the cover id; if it does,
  the second size is fetched by id, so a keyed Book costs one keyed request, not two.
- **Missing covers:** every Open Library URL is asked with `?default=false` (a missing cover is a 404, not a 200 with a
  1 × 1 GIF). A 404/410, or any answer that is a GIF or under 16 px on a side, is **`gone`**, terminal, never retried
  (until the cover changes).
- **Apple:** only the `…/<w>x<h>bb.<ext>` shape (above); anything else `unsupported_url`, terminal.

**Thumbhash:** when the Book has none, the run computes it with the app's own `describeCover` (`web/app/data/covers.ts`,
imported as the import job imports `web/app/data`) from a small image decoded with `jpeg-js` (pure JS): Apple
`66x100bb.jpg` (~3 KB), Open Library `-S`, the Goodreads image itself. Written in the same compare-and-swap, only into
an empty `cover_thumbhash` (with the colours when those are empty too). **CPU guard:** decoding a whole Goodreads image
(~300 × 475) is the one real CPU cost, so a run takes **at most 2 Goodreads Books**, and stops starting decodes once the
run's measured decode time (`performance.now()` around each decode; the edge runtime has no CPU clock, the import job's
README) passes 500 ms; the rest stay queued for the next run. PR 2 measures a run against `supabase functions serve` and
pins the numbers.

**Retries:** `timeout`, `host_error`, `not_image`, `too_large`, `r2_error` book the row again after 1 min, 10 min, 1 h,
6 h, 24 h, then `failed`; `failed` rows are tried again weekly. `throttled` waits 10 minutes without an attempt counted.
`gone` and `unsupported` are terminal until the cover changes.

**Failures fall back:** a Book without `cover_key` is shown exactly as today (`/cover`, then the source), so a failed
store is never a missing cover.

**Credentials:** only the function writes to R2, through the S3 API (`aws4fetch`, signed `PUT`/`DELETE` to
`https://<account>.r2.cloudflarestorage.com/libellus-covers/…`). Its secrets (`supabase secrets set`, never in the
repo, the client or Pages): `R2_COVERS_ACCOUNT_ID`, `R2_COVERS_ACCESS_KEY_ID`, `R2_COVERS_SECRET_ACCESS_KEY` (an R2 API
token with **Object Read & Write on `libellus-covers` only**), `COVER_KEY_SECRET`, `COVER_STORE_TOKEN` (its Vault twin
`cover_store_token`). The function answers only a bearer equal to `COVER_STORE_TOKEN`. Option B's Pages Function reads
through a binding (no key at all).

**Which hosts:** `COVER_STORE_HOSTS` in the function (Apple, Open Library, Goodreads, `books.fabkho.dev`), one line to
drop a host. Manual Books whose cover is on any other host (`use_own_edition` accepts any `https://` address) are **not**
stored in v1 (fetching member-typed addresses from our server is an SSRF surface, and those images are hers); PR 1
reports the count; the owner decides later.

**Off switch:** `private.cover_store_settings.enabled` (false until the owner turns it on); tick and kick do nothing
while it is off.

## 4. Database

Migration `supabase/migrations/2026110x010000_cover_store.sql` (PR 1):

```sql
alter table public.books
  add column cover_key    text,       -- our stored copy of cover_url: c/<cover_key>/<w>
  add column cover_widths smallint[], -- the real widths stored, ascending
  add constraint books_cover_key_format check (cover_key ~ '^[0-9a-f]{32}$'),
  add constraint books_cover_widths_sane check (
    cover_widths is null or (cardinality(cover_widths) between 1 and 6
      and 16 <= all (cover_widths) and 2000 >= all (cover_widths))),
  add constraint books_cover_key_has_widths check ((cover_key is null) = (cover_widths is null));
```

`cover_url` stays the source of truth; `cover_key` says "and we have it". Bookkeeping lives in `private`:

- `private.cover_store_queue` (§3).
- `private.cover_objects (key pk, widths, content_type, bytes, stored_at, orphaned_at, deleting_at)`: one row per
  stored image, created by `cover_store_reserve` before any upload. GC works from it (no bucket listing).
- `private.cover_store_settings (enabled, function_url)`, one row.
- `private.cover_artwork(text)`, `private.books_clear_cover_key()` and the trigger (§3).
- Functions (`security definer`, `revoke all … from public, anon, authenticated`, execute for `service_role` only):
  `cover_store_tick` (reconcile + kick), `cover_store_claim`, `cover_store_reserve`, `cover_store_done`,
  `cover_store_failed`, `cover_store_kick`, and the GC ones (PR 7).
- `public.owner_cover_status()` for the owner only (`not_owner` for anyone else, as `owner_client_errors`): counts of
  catalogue Books with a cover, stored, queued, throttled, failed by reason, gone, unsupported, not storable (other
  hosts), objects, bytes, orphaned, deleting. Counts only.

**RLS is unchanged.** Members read `books` as before (two more columns) and never write it directly; the new tables are
in `private`. The nightly backup already includes `private`.

**The read path** (PR 3) returns `cover_key` and `cover_widths` next to `cover_url` and `cover_thumbhash`, in the same
payload, behind the same gate (`private.cover_shown`) where there is one:

- The Library and every own-data screen: the PostgREST column list `BOOK` in `web/app/data/library.ts` (and its
  `bookFromRow` / `rowFromBook`); the own year pages and Profile read from it.
- `private.reading_page_book_json` (latest in `20261025020000_catalogue_check.sql`), which `private.social_book_json`
  wraps: the feed, `member_profile`, `member_want`, `both_read` (the reel), `public_reading_page`, `public_book_card`.
- `member_reading_record`, which builds its Book by name (a friend's record and year pages).
- `author_page` / the work cards (`20261029010000_work_card_opens_cover.sql`): the key of the Book the card opens when
  it is a catalogue Book (`mine`, `catalogued`); a work's own enrich cover stays a source URL.
- `search_books` returns `books` rows and gets the columns by itself.

A pgTAP test asserts that each hands out `cover_key` exactly when it hands out `cover_url`. PR 3 starts with a grep of
`'cover_url'` and `b.cover_url` in the latest definition of every function, so the list is checked, not trusted.

## 5. Client

**One helper decides the address,** `web/app/utils/coverRef.ts` (framework-free):

```ts
export type CoverRef = { coverUrl: string | null; coverKey?: string | null; coverWidths?: readonly number[] | null }
/** own: '' for option B (same origin, relative `/c/…`), 'https://covers.betterreads.de' for A, null when off. */
export type CoverHosts = { own: string | null; proxy: boolean; origin?: string }

/** UiCover's props for a cover at a token size: src, srcset, sizes, fallbacks, crossorigin (A only). */
export function coverImage(ref: CoverRef, size: CoverSize, hosts: CoverHosts): CoverImage
/** One address for a cover drawn at a size no token names (the reel's textures; absolute, as Regal takes images). */
export function coverAt(ref: CoverRef, at: { width?: number; height?: number; dpr?: number }, hosts: CoverHosts): string | null
```

The rule, in order: **our copy** (`<own>/c/<key>/<w>`, the smallest stored width that is at least the size's pixels,
`srcset` of the stored widths up to it) when the Book has a key and own covers are on; else **`/cover`** when the proxy
is on and the source is one it serves; else **the source** (today's `coverSrc`). `fallbacks` after our copy are
today's `coverChain` of the source (the same artwork), so an R2 hiccup is never a missing cover. Under A the helper sets
`crossorigin="anonymous"` only when every address in the chain sends CORS (our host, `/cover`, Apple, Open Library),
never for a chain ending at `i.gr-assets.com` or `books.fabkho.dev`. `coverSrc`, `coverSrcset`, `coverChain` and
`coverFor` stay for addresses without a Book (search results, the edition picker).

- **Config:** `runtimeConfig.public.ownCovers` (`NUXT_PUBLIC_OWN_COVERS`: unset or `off` = off, so `nuxt dev`, the e2e
  build and any deployment without it behave exactly as today; `same-origin` = B; an `https://` origin = A) and
  `useCoverHosts()` next to `useCoverProxy()`. Unsetting it in Pages is the client's off switch.
- **Types:** `BookSnapshot` and `SocialBook` gain `coverKey` and `coverWidths`; `socialShapes.ts`, `readingPage.ts`,
  `library.ts` read them. Device copies that whitelist Book fields (`bothReadDevice.ts`, the feed's copy, the Library's
  local data) take the two fields and bump their version.
- **UiCover call sites** (~45 components, ~60 `coverSrc`/`coverFor` calls): `:src="coverSrc(book.coverUrl, 'sm', proxy)"`
  becomes `v-bind="coverImage(book, 'sm', hosts)"`; the base's props win over `app.config.ts`'s `ui.cover.sources`
  (checked against `@fabkho/ui` v0.10.5; a `crossorigin` pass-through is added to the base if A is chosen and it lacks
  one). `thumbhash` is passed at every site that shows a catalogue Book.
- **The reel** (`data/bothReadReel.ts`, `reelBook`): `coverAt(shown, { height: REEL_BOOK_HEIGHT, dpr }, hosts)`;
  `useReelCovers` returns the hosts; poster, still, preload (`utils/regalReelPreload.ts` → Regal's
  `preloadReelCovers`) and textures keep naming one address per cover. Under A the preload links carry
  `crossorigin="anonymous"` for our host (else the texture's CORS request misses the preloaded copy).
- **Service worker** (`web/nuxt.config.ts`, `runtimeCaching`): B: a same-origin rule for `/c/` like `/cover`'s; A: a
  rule for the cover host. Both `CacheFirst`, cache `libellus-own-covers`, `cacheableResponse: { statuses: [200] }`
  (never opaque answers, which count megabytes against the quota in Chrome), `expiration: { maxEntries: 1500,
  maxAgeSeconds: one year, purgeOnQuotaError: true }` (~20 MB at most), in `MEMBER_CACHES` so sign-out empties it.
- **Offline:** a cover seen once is there offline; one never seen shows its thumbhash (or the cloth), as today.
- A Book whose key arrives later switches to our copy on the next Library read; no realtime is added for it.

## 6. Deletion (GC)

A stored image is kept while **any** Book that a `library_entries` row points at has its key (a lent cover is shared by
several Books). Removing a Book from a Library deletes nothing at once.

- **Weekly** (pg_cron `cover-store-gc`, Sunday night): `cover_gc_mark()` sets `orphaned_at = now()` on objects no
  catalogued Book uses and clears it on objects used again.
- **Grace: 30 days.** A Book removed and added back within a month finds its copy (its `cover_key` stays meanwhile).
- **Claim** (`{ "action": "gc" }`): `cover_gc_claim(100)` is **one statement** that, for objects whose `orphaned_at` is
  older than 30 days *as read in that statement* and still unused, sets `deleting_at` (locking the rows) and clears
  `cover_key`/`cover_widths` on any Book still pointing at them. The function deletes `c/<key>/<w>` for each width,
  then `cover_gc_done(keys)` removes the rows. A failed delete keeps the row and is tried next week.
- **Store against delete, reserve-first:** a store reserves the key (`cover_store_reserve`) before uploading. The
  reservation and the claim lock the same `cover_objects` row, so one waits for the other: a reservation that comes
  first clears `orphaned_at` and the claim no longer qualifies; one that comes after sees `deleting_at` and refuses
  (the row retries in 10 minutes, after `cover_gc_done`, and then uploads afresh). No upload can land on a key that is
  being deleted.
- **Library entry against claim:** an entry added in a transaction the claim cannot see yet may point at a Book whose
  key the claim then clears. Nothing is lost: the Book now has `cover_key` null, so the next reconcile queues it, the
  store computes the same key, waits out `deleting_at`, and uploads again. A device that read the key in between falls
  back to `/cover` or the source for that cover until then.
- R2 lifecycle rules cannot do this (they expire by age, not by reference); none is set on the bucket.

## 7. Privacy and terms

- **THIRD-PARTY.md** (PR 8): the *Cover cache* row stays for `/cover`; a new **Own covers** row: what is copied (covers
  of Books in a member's Library, at the sizes the hosts render), where (R2 `libellus-covers`, WEUR; served by `/c/` or
  `covers.betterreads.de`), how (server side, identified, paced, once per image, never in bulk ahead of a member adding
  the book; Open Library's keyed covers at 0.3 a second), kept until 30 days after no Library holds the book, and the
  **owner-accepted risk** (dated, same position as the cache). The Goodreads covers row changes from "linked, never
  copied" to "copied like the others, one line to stop (`COVER_STORE_HOSTS`)".
- **Privacy notice** (`web/app/legal/privacy.ts`, EN and DE) and README "Where your data lives": the R2 entry gains the
  covers bucket (book cover images only, keys not derived from any member, no member data). `docs/legal-checklist.md`
  gets the bucket.
- **The privacy rule for the work:** reports, PRs, commits, logs and backfill output are counts only. The function logs
  Book ids (UUIDs) and error kinds, never titles, ISBNs or cover URLs of members' books. Test fixtures use the existing
  recorded public covers, never a member's.

## 8. Cost, limits and monitoring

| | today (~186 catalogue covers) | at 10,000 catalogue covers | free limit |
| --- | ---: | ---: | ---: |
| objects (Apple 4 widths, Open Library 2, others 1; ~3.5 average) | ~650 | ~35,000 | — |
| storage (Apple ~52 KB a cover, Open Library ~65 KB, Goodreads ~40 KB) | ~11 MB | ~0.6 GB | 10 GB R2 |
| Class A (PUT, DELETE) for the backfill / a month of adds | ~650 / a few hundred | — | 1 M a month |
| Class B (reads on an edge-cache miss) | thousands a month | tens of thousands | 10 M a month |
| egress | free | free | R2 egress is free |
| edge function invocations (8 covers a run) | ~24 for the backfill, ~1 per add burst | — | 500 k a month (Supabase Free) |
| Pages Function invocations | B: a few thousand a day (SW misses), `/cover` falls for catalogue covers; A: fewer than today | — | 100 k a day, shared |
| pg_cron | the tick each minute (one reconcile query), GC weekly | — | — |

Storage binds first, at roughly 150,000 covers. Supabase's 2 s CPU is the technical limit; runs decode at most a tiny
probe or two Goodreads images (§3), measured in PR 2. R2 has **no hard spend cap**: a billing notification is set
before the job is turned on (production steps).

**Monitoring:** `owner_cover_status()`, run after the backfill and when in doubt; one log line per run (`stored`,
`failed`, `throttled`, `gone`, `ms`); the R2 dashboard (storage, operations); Pages analytics for Function invocations
(B) or the zone's analytics for the cover host (A). `owner_cover_status` warns when stored bytes pass 5 GB or `failed`
passes 5 % of catalogue covers.

## 9. Work, in PRs

Each PR is a day or less, with its tests. "Sonnet" means Sonnet 5.5 at `high`, "DeepSeek" the `normal` tier. The release
workflow applies migrations and deploys every function on a release; nothing runs in production before the owner turns
it on.

| # | PR | depends on | model | tests | owner checks |
| --- | --- | --- | --- | --- | --- |
| 1 | **Schema, queue, reconcile**: the migration of §4 (columns, constraints, private tables with the queue's `on delete cascade`, `cover_artwork`, the key-clearing trigger with its `WHEN`, tick/reconcile, claim/reserve/done/failed/kick, `owner_cover_status`, `cover-store-tick` scheduled with the import job's "pg_cron is not here" warning), `enabled = false` | — | Sonnet | `supabase/tests/cover_store_test.sql` (pgTAP): the reconcile finds a Book after each path (add, import write, change edition, own edition, `fill_book_covers`, check) and not one outside every Library or on another host; an identical-value `cover_url` update keeps the key; an Apple size change keeps it; another artwork clears key and queue row; **`cover_store_done`'s write does not fire the trigger**; compare-and-swap; thumbhash only into an empty one; reserve refuses while `deleting_at`; backoff, `throttled`, `gone`; cascade on Book delete; grants | the count of manual Books on other hosts (local); `enabled` false |
| 2 | **`cover-store` function, run**: `index.ts`, `handler.ts` (token), `plan.ts`, `fetch.ts` (manual redirects, allowlist, `default=false`, paces), `image.ts` (magic bytes, header widths, GIF/tiny), `r2.ts` (aws4fetch, PUT), `key.ts` (HMAC of the largest variant), `runner.ts` (lease, reserve-first, Goodreads cap), thumbhash, `README.md`; **a `cover-store` job in `.github/workflows/ci.yml`** with path filters like `importjob`'s (`supabase/functions/cover-store/**`, `_shared/**`, `web/app/data/**`, `web/app/utils/**`) | 1 | Sonnet | Deno tests with recorded public fixtures and a fake S3: variants and real widths per host, key from the largest variant only, dedup, reserve refused, CAS miss, a redirect off the allowlist, OL 403 → `throttled`, OL 404/GIF → `gone`, odd Apple URL → `unsupported_url`, the Goodreads cap, the token; a measured CPU line for a run of 8 | the README; the `[functions.cover-store] verify_jwt = false` entry for `supabase/config.toml`, **added by the owner** |
| 3 | **Read path**: `reading_page_book_json`, `member_reading_record`, `author_page` cards return `cover_key`, `cover_widths` (gated by `cover_shown`) | 1 | DeepSeek | pgTAP: each RPC hands out the key exactly with the URL; a hidden cover hides its key | — |
| 4 | **Serving** (B): `web/functions/c/[[path]].js`, `sender` shared with `cover.js`; (A): nothing in code | — | DeepSeek | `tests/cover-own-function.test.ts` like `cover-function.test.ts`: strict path, 404 `no-store`, headers, cache hit, foreign `Referer` 403 | — |
| 5 | **Client helper and data**: `utils/coverRef.ts`, `useCoverHosts`, `ownCovers` config, the types, `library.ts` columns, `socialShapes.ts`, `readingPage.ts`, device copies' versions | 3 | Sonnet | `tests/cover-ref.test.ts` (our copy / `/cover` / source, widths and `srcset`, no key, off, fallbacks are the same artwork, `crossorigin` only on all-CORS chains) | — |
| 6 | **Client call sites, reel, SW**: every UiCover of a Book to `coverImage`, the reel to `coverAt`, the SW rule, `MEMBER_CACHES`; under A also preconnect, CSP, preload `crossorigin` | 4, 5 | DeepSeek, Sonnet review | unit tests touched; `pnpm test:e2e` (own covers off there); a local run with own covers on against a few test objects (screenshots of Library, Book page, reel, opened in Orca) | the screenshots; the reel draws |
| 7 | **GC**: `cover_gc_mark/claim/done`, the `gc` action, `cover-store-gc` weekly | 2 | Sonnet | pgTAP for mark, grace, claim in one statement, the reserve race both ways, the entry-against-claim case (key cleared, reconcile re-queues), `cover_store_done` not firing the trigger; Deno test for `gc` with the fake S3 | — |
| 8 | **Docs**: THIRD-PARTY.md, HOSTING.md ("Own covers"), covers.md, OPERATIONS.md (runbook below), SETUP.md secrets table, `privacy.ts` EN/DE, README, legal-checklist | 2, 6 | DeepSeek | `pnpm test` (the legal texts' tests) | the THIRD-PARTY wording, the privacy text |

1 and 2 can be built in parallel once 1's function signatures are fixed in its PR description; 3 and 4 alongside 2.
**PRs 4, 5 and 6 are safe to merge and release with own covers unset:** the helper falls back to today's addresses,
and `/c/` answers 404 for keys nobody hands out.

## Runbook notes (OPERATIONS.md, PR 8)

- **Backups:** the nightly backup includes `private` (queue, objects), but **the bucket is not backed up**. After a
  database restore, objects stored after the backup's time are not in `cover_objects` and GC never sees them (a leak,
  not a fault; at ~50 KB a cover, small). If the bucket is lost: `update public.books set cover_key = null,
  cover_widths = null` and empty `cover_objects`; the reconcile stores everything again.
- **Rotating `COVER_KEY_SECRET` (irreversible):** set the new secret, run `private.cover_store_rekey()` (clears every
  `cover_key`/`cover_widths`, as above, but leaves `cover_objects` so the old objects become orphans); the reconcile
  re-queues every Book and stores it under new keys; GC deletes the old keys after the 30-day grace. Storage doubles
  for that month; devices download each cover once more. Old keys cannot be recovered once GC ran.
- **GC deletion is irreversible**: a deleted object comes back only by storing the cover again from its source.
- **Status:** `select public.owner_cover_status();`. Re-run failed: `update private.cover_store_queue set state =
  'queued', due_at = now() where state = 'failed';`.

## Production steps (owner approval, in this order)

None of these are done by workers. Secrets are entered by the owner and never pasted into a PR, issue or chat.

1. **Billing notification first:** Cloudflare → Notifications → a usage-based billing alert for R2 (R2 has no hard
   spend cap; the free tier is generous, the alert catches a runaway loop).
2. **R2 token:** R2 → Manage API tokens → Create: Object Read & Write, **only `libellus-covers`**. Set on Supabase:
   `supabase secrets set R2_COVERS_ACCOUNT_ID=… R2_COVERS_ACCESS_KEY_ID=… R2_COVERS_SECRET_ACCESS_KEY=…`.
3. **Key and token:** `supabase secrets set COVER_KEY_SECRET=$(openssl rand -hex 32) COVER_STORE_TOKEN=$(openssl rand -hex 32)`;
   the same token into Vault as `cover_store_token`; `private.cover_store_settings.function_url` set (as for the import
   job). Keep `COVER_KEY_SECRET` in the password manager; **changing it later is the irreversible rotation above**.
4. **Serving:**
   - **B:** Pages project → Settings → Bindings: R2 bucket `COVERS` → `libellus-covers` (production, and preview if
     wanted); extend the `/cover` WAF rule and the `/cover` rate-limiting rule to `/c/` in both zones (`fabkho.dev`,
     `betterreads.de`). The `/cover` rule in `betterreads.de` is **already done** (403 without or with a foreign
     `Referer`).
   - **A:** in zone `betterreads.de`: custom domain `covers.betterreads.de` on the bucket, the Cache Rule, the Transform
     Rule, the WAF referer rule (test `starts_with` in the editor, §1). Check with one test object uploaded by hand:
     `curl -sI https://covers.betterreads.de/c/<test>/120` twice (second `cf-cache-status: HIT`), once with
     `-H 'Origin: https://betterreads.de'` after a plain request (the header must be there on the HIT), once with a
     foreign `Referer` (403). Delete the test object.
5. **Release** with PRs 1–4 and 7 (migrations applied, functions deployed, `enabled` still false). Add
   `[functions.cover-store] verify_jwt = false` to `supabase/config.toml` before this release.
6. **Turn on (this is the backfill):** `update private.cover_store_settings set enabled = true;` then watch
   `select public.owner_cover_status();` until `queued` is 0 (minutes; Open Library's keyed covers are the slow part).
   Report counts only. Spot-check two stored covers in a browser.
7. **Client:** set `NUXT_PUBLIC_OWN_COVERS` (`same-origin` for B, `https://covers.betterreads.de` for A) in the Pages
   project (production) and release with PRs 5–6 (and 8). Check the Library, a Book page, a friend's page and the reel
   on the phone; the network panel should show `/c/…` (or the cover host) for catalogue covers and `/cover` only for
   search.
8. **Rollback, any time:** unset `NUXT_PUBLIC_OWN_COVERS` and redeploy (the app is back on `/cover` and the sources);
   `enabled = false` stops storing; **remove the R2 API token** (R2 → Manage API tokens) and the Supabase secrets if
   the feature is dropped; nothing else depends on the copies. Deleting the bucket's objects is irreversible.

## Open points for the owner

- **Serving: A or B** (§1). Recommendation: B, with A as the upgrade path.
- **Goodreads covers** are copied too under this plan (the decision says "every cover"); confirm, or drop the host from
  `COVER_STORE_HOSTS` and they stay linked.
- **Manual Books on other hosts** are not stored in v1 (SSRF, and the images are the member's); PR 1 gives the count.
- **WebP for Open Library covers** (a `v2` with a wasm encoder) only if their bytes turn out to matter.
