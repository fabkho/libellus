# Own covers for catalogue books (plan, not built)

Status: plan, 30 October 2026. Nothing here is implemented or deployed; the bucket `libellus-covers` exists (account
`56a9487b…`, location hint WEUR, empty, no public access). Counts only, no titles, ISBNs or member data, here and in
every PR and report this plan produces.

## The decision and what it changes

**Owner decision (30 Oct 2026):** every cover of a Book that is in any member's Library (a `library_entries` row points
at it) is stored by us, in Cloudflare R2, at the sizes the app shows. Covers of our catalogues are then fast and never
depend on Apple or Open Library being up. The edge cache at `/cover` (`web/functions/cover.js`, #417) stays, but only
for what is not in anyone's Library: search results, the edition picker, a work's card on an author page, a Book whose
copy is not stored yet or failed.

This reverses a documented rule. `docs/plans/cover-sources.md` and `docs/plans/covers-consistency.md` say a cover is
"linked, never copied into our storage", and THIRD-PARTY.md says Goodreads covers are "linked, never copied". The owner
accepts the risk on the same grounds as the cover cache (a private app for him and a few friends, no benefit drawn from
the covers, copies made only of books members hold, paced and identified); the documents change with the work (PR 7).
"One Book, one cover" (covers-consistency.md) is kept: the stored copies are the Book's one artwork at several widths,
and when a copy fails the app falls back to the same artwork at the source, never another picture.

### "One request loads everything": what is honest

An image cannot ride inside the JSON of the Library without making that JSON large and uncacheable (186 covers at
even 6 KB each would be over a megabyte of base64 on every Library load, and it would change whenever any Book does).
So images stay separate requests. What we can make true:

1. **The data request carries everything needed to draw the cover at once:** the thumbhash (`books.cover_thumbhash`,
   ~30 bytes) for an instant blurred cover, the two colours, and the stored copy's key and widths. No lookup, no
   redirect, no second round trip to learn an address: the app builds the final image URL from the Book row alone.
2. **The image requests are the cheapest possible:** one host (`covers.betterreads.de`), preconnected, HTTP/2 or 3, so all
   covers of a screen share one connection; answered from Cloudflare's edge cache in tens of milliseconds; small
   (WebP at the width shown: an Apple cover at 120 px is ~5 KB, at 600 px ~25 KB, measured below).
3. **A reopened Library needs no network for covers:** the service worker keeps our copies cache-first, and the URLs
   never change (content-addressed), so a cached copy is never stale.
4. **Every catalogue Book gets a thumbhash:** the store job fills a missing one (today the import's covers arrive
   without, `supabase/functions/import-job/covers.ts`), so no stored cover ever shows the flat fill first.

What it is not: the covers of a screen are still N image requests the first time, and a Book added a minute ago shows
the source (or `/cover`) until its copy is stored and the Library is read again.

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

## 1. How the images are served

**Chosen: the R2 bucket public on a custom domain, `covers.betterreads.de`.** Cloudflare serves it from its edge cache;
no Worker, no Pages Function, no `/cover` invocation is involved, so it costs nothing against the Pages Functions' 100k
requests a day (shared with `/r` and `/share`), and R2 is only read on a cache miss (Class B reads, 10 M a month free;
egress free).

Rejected: **a Pages Function with an R2 binding** (e.g. `/c/<key>`). It would spend one Function invocation per image
request that is not already in the browser, which is exactly the pool `/cover` and `/r` share, and add a cold start to
every miss. Its one advantage (code decides who may read) is covered by the WAF rule below. **The `r2.dev` address**
is rate-limited and not for production; it stays off.

**Why `covers.betterreads.de`:** the app is being renamed to BetterReads and already serves at `betterreads.de` (zone
`betterreads.de`, free plan, same Cloudflare account); `libellus.fabkho.dev` is the older domain. Cover URLs are
immutable and end up in every device's service-worker cache, so they go on the domain that stays, not one that will be
retired. The custom domain, the Cache Rule, the Transform Rule and the WAF rule below all live in the `betterreads.de`
zone.

Settings (all owner steps, see *Production steps*):

- **Custom domain** `covers.betterreads.de` on the bucket (R2 → bucket → Settings → Custom Domains; zone `betterreads.de`).
- **Cache Rule** for `http.host eq "covers.betterreads.de"`: eligible for cache, edge TTL "use origin's Cache-Control".
  Needed because our object keys have no file extension (below) and Cloudflare caches only known extensions by default.
- **Object headers** set at upload: `Content-Type` (`image/webp` or `image/jpeg`) and
  `Cache-Control: public, max-age=31536000, immutable`. The key is content-addressed, so a URL's bytes never change.
- **CORS for WebGL** (the reel draws covers as textures, and the service worker should hold readable, not opaque,
  answers): a **Response Header Transform Rule** on the host sets `Access-Control-Allow-Origin: *` and
  `X-Content-Type-Options: nosniff` on every answer. Not the bucket's own CORS policy: R2 adds the CORS header only to
  a request that carries `Origin`, and Cloudflare's cache does not key on `Origin`, so a copy cached from a plain
  `<img>` request would be served without the header to a later CORS request and the texture would fail. A transform
  rule runs on cache hits too. `*` is safe here: the images are not secret and no credentials are involved
  (`crossorigin="anonymous"`).
- **Hotlinking:** a WAF custom rule in the `betterreads.de` zone blocks a request to the host whose `Referer` is present
  and is not one of the app's origins: `https://betterreads.de` and `https://libellus.fabkho.dev` while both serve the
  app, and, if previews need our copies, `*.libellus-3q1.pages.dev`. For example (free-plan operators only):
  `http.host eq "covers.betterreads.de" and http.referer ne "" and not (starts_with(http.referer, "https://betterreads.de/")
  or starts_with(http.referer, "https://libellus.fabkho.dev/") or http.referer contains ".libellus-3q1.pages.dev/")`.
  Drop the `libellus.fabkho.dev` part once that domain no longer serves the app.
  A request without `Referer` passes (the reading-page OG renderer and curl send none); what stops guessing is the key
  itself (an HMAC, below). Free plan: 5 custom rules per zone.
- **`/cover` on `betterreads.de` is not protected yet.** The existing WAF rule that blocks `/cover` without the app's
  `Referer` lives in the `fabkho.dev` zone and so only covers `libellus.fabkho.dev/cover`. The same rule is needed in
  the `betterreads.de` zone for `betterreads.de/cover`, allowing the same origins (owner production step 3; it is
  needed whatever this plan does, since `/cover` stays for search results).
- The app adds `<link rel="preconnect" href="https://covers.betterreads.de" crossorigin>` and the host to the CSP's
  `connect-src` (report-only today; `img-src` already allows `https:`), in `web/public/_headers` and `web/e2e/serve.mjs`.

## 2. Object keys, sizes and formats

**Keys are content-addressed:** `c/<key>/<width>`, where `<key>` is the first 128 bits, hex (32 characters), of
`HMAC-SHA256(COVER_KEY_SECRET, "v1:" + bytes of the largest variant)`. Why each part:

- **Content, not Book:** Books share artwork (a lent cover, `isLent` in `data/coverRank.ts`; editions with one Apple
  artwork), so one image is stored once and every Book with it points at the same key. A URL never changes its bytes,
  so `immutable` is true.
- **An HMAC, not a plain hash:** with a plain SHA-256 anyone could fetch an Apple cover, hash it and ask our host
  whether some member holds that book. With a secret, a key cannot be derived from the image; keys are only found in
  members' payloads.
- **`v1:` in the input:** a later change of what is stored (another format, other widths) is a `v2` with new keys, so
  a cached `v1` URL never gets other bytes.
- **No file extension:** the `Content-Type` stored with the object says the format, and one key can hold WebP for one
  cover and JPEG for another without the client knowing which.

**Widths: 120, 240, 360, 600 device pixels** (a subset of `COVER_WIDTHS` in `utils/coverSize.ts`, so the steps match
what the app and `/cover` already ask). Against the token widths (`COVER_WIDTH`: 30, 40, 72, 82, 140 CSS px) and the
reel (`REEL_BOOK_HEIGHT`, 200 px wide cards): 120 covers `xs`/`sm` up to 3×; 240 covers `md`/`lg` up to ~3× and `xl`
at 1.7×; 360 covers `xl` at 2.5× and the reel at 1.8×; 600 covers `xl` and the reel at 3×. 960 is not offered: no
source we store has more than 600 px of a cover worth showing (`books.cover_url` is Apple's 600 × 900 at most), and no
screen draws a cover wider than 200 CSS px. Nothing is ever upscaled: a source narrower than a width gives the
widths below it and its own width as the top.

**Where the sizes come from: the source's own renderer, so we never resize.** Cloudflare Images is paid past its free
quota and ties serving to a monthly count; Workers on the free plan have 10 ms of CPU (no image codec fits); a
Supabase edge function has 2 s of CPU per invocation, which the import job already avoids spending on image decoding
(`import-job/covers.ts`: "Reading the image … costs CPU the Free plan's 2 s does not have"); resizing in the browser at
add time cannot cover the server import, cannot encode WebP on Safari, and would have to be trusted. So the store job
asks each host for the sizes it already offers and copies the bytes as they come:

| source (by `books.cover_url`) | variants fetched and stored | format |
| --- | --- | --- |
| Apple (`*.mzstatic.com`, `…/<w>x<h>bb.jpg`) | `120x180bb.webp`, `240x360bb.webp`, `360x540bb.webp`, `600x900bb.webp` | WebP (Apple's) |
| Open Library (`covers.openlibrary.org/b/<kind>/<key>-*.jpg`) | `-M` (≤ 180 wide) and `-L` (~330–360 wide) | JPEG |
| Goodreads (`i.gr-assets.com`) | the one image the address names | as served (JPEG) |
| Regal's library (`books.fabkho.dev`) | the one image | as served |

The widths stored are **the real ones**, read from each image's header (JPEG SOF, WebP VP8/VP8L/VP8X, PNG IHDR: a few
bytes, no decoding), because Apple's `bb` box keeps a cover's proportions (a narrow cover in a 600 × 900 box comes back
narrower) and Open Library's sizes are not fixed. They go to `books.cover_widths`, so the client's `srcset` is exact.

Open Library and Goodreads stay JPEG in v1. Re-encoding them to WebP would save ~30–40 % of their bytes on a download
the service worker then keeps for good; it would need a codec (wasm `@jsquash/webp` in the edge function, measured
against the 2 s CPU limit first) and is a possible `v2`, not part of this plan.

## 3. When covers are stored, and who writes to R2

**One place decides, the database; one worker stores, a new Supabase edge function `cover-store`.** No client path
changes for storing: every way a Book reaches a Library or changes its cover already ends in the database, so triggers
there catch all of them.

| path | what happens in the database | caught by |
| --- | --- | --- |
| search add, scan, manual add with a cover (`add_to_library`, `add_manual_book`) | a `library_entries` row is inserted | entries trigger |
| server import (`import_job_write` → `import_books`) and the device import | entries inserted, many in one statement | entries trigger |
| Change edition, own edition (`change_edition`, `use_own_edition`) | the entry's `book_id` changes | entries trigger |
| manual cover pick, Apple upgrade (`fill_book_covers`), Goodreads last-resort cover, catalogue check, enrich | `books.cover_url` changes | books trigger |

- **Enqueue** (migration, PR 1): `AFTER INSERT OR UPDATE OF book_id ON library_entries` and
  `AFTER UPDATE OF cover_url ON books` (only when an entry points at the Book) insert the Book into
  `private.cover_store_queue` (`on conflict do nothing`), when its `cover_url` passes `private.cover_allowed` and its
  stored copy is missing or of another source. A `BEFORE UPDATE OF cover_url ON books` trigger clears `cover_key` and
  `cover_widths` whenever `cover_url` changes, so a Book never points at a copy of a picture it no longer has.
- **Run:** pg_cron `cover-store-tick` every minute calls `private.cover_store_kick()`, which does nothing (no HTTP) when
  no row is due, and otherwise posts `{ "action": "run" }` to the function through pg_net with the Vault secret
  `cover_store_token`, the import job's pattern (`private.import_job_kick`, `20261102010000_import_jobs.sql`). A run that
  leaves rows due asks for the next one at once (self-chaining). A Book added now has its copy within about a minute.
- **One run** (`supabase/functions/cover-store/runner.ts`): `cover_store_claim(runner, 8)` leases up to 8 due rows for
  170 s (`for update skip locked`); 4 at a time, for each: build the variant URLs (`plan.ts`), fetch them (identified
  `User-Agent`, 8 s timeout, at most 2 MB, an image type checked by its magic bytes, at least 16 px, Open Library's
  covers host on an `edge_pace` bucket of its own at 2 requests a second), compute the key, `HEAD` each object and `PUT`
  the missing ones, then `cover_store_done(book, source_url, key, widths, thumbhash?, colours?, bytes)`.
- **Idempotent:** content keys make a second upload of the same image harmless (and the `HEAD` skips it); `done` is a
  compare-and-swap: it writes only if the Book's `cover_url` is still `source_url` (a cover changed meanwhile is queued
  again by its own trigger); a row done twice changes nothing.
- **Thumbhash:** when the Book has none, the run computes it with the app's own `describeCover`
  (`web/app/data/covers.ts`, imported as the import job imports `web/app/data`) from a tiny probe decoded with
  `jpeg-js` (pure JS): Apple `66x100bb.jpg` (~3 KB), Open Library `-S`, the Goodreads image itself. Written in the same
  compare-and-swap, only into an empty `cover_thumbhash` (with the two colours when those are empty too).
- **Retries:** a failure (`timeout`, `host_error`, `not_image`, `too_large`, `r2_error`) books the row again after 1 min,
  10 min, 1 h, 6 h, 24 h, then marks it `failed`; a 404/410 from the host marks it `gone` at once. `failed` rows are tried
  again once a week; both end when the cover changes. The batch of 8 per run is the CPU budget (no image is decoded
  except the tiny probe); PR 2 measures a run's CPU and sets it.
- **Failures fall back:** a Book without `cover_key` is shown exactly as today (`/cover`, then the source), so a failed
  store is never a missing cover.
- **Credentials:** only the function writes to R2, through the S3 API (`aws4fetch`, signed `PUT`/`HEAD`/`DELETE` to
  `https://<account>.r2.cloudflarestorage.com/libellus-covers/…`). Its secrets (`supabase secrets set`, never in the
  repo, the client or Pages): `R2_COVERS_ACCOUNT_ID`, `R2_COVERS_ACCESS_KEY_ID`, `R2_COVERS_SECRET_ACCESS_KEY` (an R2 API
  token with **Object Read & Write on `libellus-covers` only**), `COVER_KEY_SECRET`, `COVER_STORE_TOKEN` (its Vault twin
  `cover_store_token`). The function answers only a bearer equal to `COVER_STORE_TOKEN`; members never call it.
- **Which hosts:** `COVER_STORE_HOSTS` in the function (Apple, Open Library, Goodreads, `books.fabkho.dev`), one line to
  drop a host (e.g. Goodreads if it objects). Manual Books whose cover is on any other host (`use_own_edition` accepts any
  `https://` address) are **not** stored in v1: fetching member-typed addresses from our server is an SSRF surface, and
  those images are hers, not a catalogue's. PR 1 reports how many such Books exist (a count); the owner decides later.
- **Off switch:** `private.cover_store_settings.enabled` (false until the owner turns it on); the kick does nothing
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

`cover_url` stays the source of truth: the Book's cover is still that address; `cover_key` says "and we have it".
The bookkeeping lives in private tables, not on `books`:

- `private.cover_store_queue (book_id pk, source_url, state queued|leased|failed|gone, attempts, due_at, leased_by,
  leased_until, last_error, enqueued_at)`.
- `private.cover_objects (key pk, widths, content_type, bytes, stored_at, orphaned_at, deleting_at)`: one row per
  stored image, written by `cover_store_done` before it touches the Book. GC works from it (no bucket listing).
- `private.cover_store_settings (enabled, function_url)`, one row.
- Functions (`security definer`, `revoke all … from public, anon, authenticated`, execute for `service_role` only):
  `cover_store_claim`, `cover_store_done`, `cover_store_failed`, `cover_store_kick`, and the GC ones (PR 6).
- `public.owner_cover_status()` for the owner only (`not_owner` for anyone else, as `owner_client_errors`): counts of
  catalogue Books with a cover, stored, queued, failed by reason, gone, not storable (other hosts), objects, bytes,
  orphaned. Counts only.

**RLS is unchanged.** Members read `books` as before (two more columns, harmless) and never write it directly; the
new tables are in `private`.

**Backfill** (PR 6, its own migration so it ships after the function): enqueue every Book that a `library_entries` row
points at, whose `cover_url` passes `cover_allowed` and whose `cover_key` is null (~186 today). It runs only once the
owner turns `enabled` on; at 8 a run that is ~24 runs, a few minutes, Open Library's pace the slowest part.

**The read path** (PR 3) returns `cover_key` and `cover_widths` next to `cover_url` and `cover_thumbhash`, in the same
payload, behind the same gate (`private.cover_shown`) where there is one:

- The Library and every own-data screen: the PostgREST column list `BOOK` in `web/app/data/library.ts` (and its
  `bookFromRow` / `rowFromBook`); the own year pages and Profile read from it.
- `private.reading_page_book_json` (latest in `20261025020000_catalogue_check.sql`), which `private.social_book_json`
  wraps: the feed, `member_profile`, `member_want`, `both_read` ("You both read", the reel), `public_reading_page`,
  `public_book_card`.
- `member_reading_record`, which builds its Book by name (a friend's record and year pages).
- `author_page` / the work cards (`20261029010000_work_card_opens_cover.sql`): the key of the Book the card opens when
  it is a catalogue Book (`mine`, `catalogued`); a work's own enrich cover stays a source URL.
- `search_books` returns `books` rows and gets the columns by itself.

A pgTAP test asserts that each of these hands out `cover_key` exactly when it hands out `cover_url`, so a later RPC
cannot forget it silently. PR 3 starts with a grep of `'cover_url'` and `b.cover_url` in the latest definition of every
function, so the list above is checked, not trusted.

## 5. Client

**One helper decides the address,** `web/app/utils/coverRef.ts` (framework-free, imports nothing from Vue):

```ts
export type CoverRef = { coverUrl: string | null; coverKey?: string | null; coverWidths?: readonly number[] | null }
export type CoverHosts = { own: string | null; proxy: boolean; origin?: string }

/** UiCover's props for a cover at a token size: src, srcset, sizes, fallbacks, crossorigin. */
export function coverImage(ref: CoverRef, size: CoverSize, hosts: CoverHosts): CoverImage
/** One address for a cover drawn at a size no token names (the reel's textures). */
export function coverAt(ref: CoverRef, at: { width?: number; height?: number; dpr?: number }, hosts: CoverHosts): string | null
```

The rule, in order: **our copy** (`<own>/c/<key>/<w>`, the smallest stored width that is at least the size's pixels,
`srcset` of the stored widths up to it, `crossorigin="anonymous"`) when the Book has a key and the build knows the
host; else **`/cover`** when the proxy is on and the source is one it serves; else **the source** (today's
`coverSrc`). `fallbacks` after our copy are today's `coverChain` of the source (the same artwork), so an R2 hiccup is
never a missing cover. `coverSrc`, `coverSrcset`, `coverChain` and `coverFor` stay for addresses without a Book (search
results, the edition picker), unchanged.

- **Config:** `runtimeConfig.public.coverHost` (`NUXT_PUBLIC_COVER_HOST`, e.g. `https://covers.betterreads.de`; unset:
  off, so `nuxt dev`, the e2e build and previews without it behave exactly as today) and `useCoverHosts()` next to
  `useCoverProxy()`. Unsetting it in Pages is the client's off switch.
- **Types:** `BookSnapshot` and `SocialBook` gain `coverKey` and `coverWidths`; `socialShapes.ts`, `readingPage.ts`,
  `library.ts` read them. Device copies that whitelist Book fields (`bothReadDevice.ts`, the feed's copy, the Library's
  local data) take the two fields and bump their version, so an old copy reads as none rather than without keys.
- **UiCover call sites** (~45 components, ~60 `coverSrc`/`coverFor` calls): `:src="coverSrc(book.coverUrl, 'sm', proxy)"`
  becomes `v-bind="coverImage(book, 'sm', hosts)"`; the base's props win over `app.config.ts`'s `ui.cover.sources`
  (the PR checks this against `@fabkho/ui` v0.10.5 and adds a `crossorigin` pass-through to the base if it lacks one).
  `thumbhash` is already passed at most sites; the PR makes it every site that shows a catalogue Book.
- **The reel** (`data/bothReadReel.ts`, `reelBook`): `coverFor(shown.coverUrl, { height: REEL_BOOK_HEIGHT, …covers })`
  becomes `coverAt(shown, { height: REEL_BOOK_HEIGHT, dpr }, hosts)`; `useReelCovers` returns the hosts; the poster,
  still, preload (`utils/regalReelPreload.ts`) and textures keep naming one address per cover. The CORS header makes
  the WebGL textures load from our host as they load from `/cover` now.
- **Service worker** (`web/nuxt.config.ts`, `runtimeCaching`): a rule for `url.origin === <cover host>`, `CacheFirst`,
  cache `libellus-own-covers`, `cacheableResponse: { statuses: [200] }` (CORS answers, never opaque ones: an opaque
  answer counts megabytes against the origin's quota in Chrome), `expiration: { maxEntries: 1500, maxAgeSeconds: one
  year, purgeOnQuotaError: true }` (~1500 × ~15 KB ≈ 20 MB at most). Added to `MEMBER_CACHES` (`data/localData.ts`) so
  sign-out empties it. Requests with `crossorigin` and without would be two cache entries; the helper always sets it.
- **Offline:** a cover seen once is there offline; one never seen shows its thumbhash (or the cloth), as today.
- A Book whose key arrives later (stored after the Library was read) switches to our copy on the next Library read;
  no realtime is added for it.

## 6. Deletion (GC)

A stored image is kept while **any** Book that a `library_entries` row points at has its key (a lent cover is shared
by several Books). Removing a Book from a Library deletes nothing at once.

- **Weekly** (pg_cron `cover-store-gc`, Sunday night): `cover_gc_mark()` sets `orphaned_at = now()` on objects no
  catalogued Book uses and clears it on objects used again.
- **Grace: 30 days.** A Book removed and added back within a month finds its copy still there (its `cover_key` stays
  set meanwhile).
- **Delete** (`{ "action": "gc" }`, same function): `cover_gc_claim(100)` takes objects orphaned for 30 days, checks
  again that nothing uses them (in the same statement), sets `deleting_at`, and clears `cover_key`/`cover_widths` on any
  Book still pointing at them (none of them in a Library). The function deletes `c/<key>/<w>` for each width, then
  `cover_gc_done(keys)` removes the rows. A failed delete keeps the row (`deleting_at` set) and is tried next week.
- **Race:** a store that computes a key which is being deleted does not write it (`cover_store_done` sees
  `deleting_at`) and books itself again in 10 minutes, after the delete has finished; it then uploads afresh.
- R2 lifecycle rules cannot do this (they expire by age, not by reference); none is set on the bucket.

## 7. Privacy and terms

- **THIRD-PARTY.md** (PR 7): the *Cover cache* row stays for `/cover`; a new **Own covers** row: what is copied (covers
  of Books in a member's Library, at the sizes the hosts render), where (R2 `libellus-covers`, WEUR, public by key on
  `covers.betterreads.de`), how (server side, identified, paced, once per image, never in bulk ahead of a member adding the
  book), kept until 30 days after no Library holds the book, and the **owner-accepted risk** (dated, the same position
  as the cache: a private app for the owner and a few friends, no benefit drawn). The Goodreads covers row changes from
  "linked, never copied" to "copied like the others, one line to stop (`COVER_STORE_HOSTS`)". Apple and Open Library
  rows: "the image is stored", not "cached at our edge". Taken down: drop the host from `COVER_STORE_HOSTS`, clear its
  keys, let GC delete.
- **Privacy notice** (`web/app/legal/privacy.ts`, EN and DE) and README "Where your data lives": the R2 entry gains the
  covers bucket. It holds book cover images only, under keys that are not derived from any member, and no member data;
  which covers exist does say, to someone holding a key, that some member holds that book, hence the HMAC keys and no
  listing. `docs/legal-checklist.md` gets the bucket.
- **The privacy rule for the work:** reports, PRs, commits, logs and the backfill output are counts only. The function
  logs Book ids (UUIDs) and error kinds, never titles, ISBNs or URLs of members' books. Test fixtures use the existing
  recorded public covers, never a member's.

## 8. Cost, limits and monitoring

| | today (~186 catalogue covers) | at 10,000 catalogue covers | free limit |
| --- | ---: | ---: | ---: |
| objects (Apple 4 widths, Open Library 2, others 1; ~3.5 average) | ~650 | ~35,000 | — |
| storage (Apple ~52 KB a cover, Open Library ~65 KB, Goodreads ~40 KB) | ~11 MB | ~0.6 GB | 10 GB R2 |
| Class A (PUT, DELETE) for the backfill / a month of adds | ~650 / a few hundred | — | 1 M a month |
| Class B (GET on a cache miss, HEAD before PUT) | thousands a month | tens of thousands | 10 M a month |
| egress | free | free | R2 egress is free |
| edge function invocations (8 covers a run) | ~24 for the backfill, ~1 per add burst | — | 500 k a month (Supabase Free) |
| Pages Function invocations | **fewer** (catalogue covers leave `/cover`) | — | 100 k a day |
| pg_cron | 1 job a minute (SQL only when idle), 1 a week | — | — |

The limit that would bind first is storage, at roughly 150,000 covers. Supabase's 2 s CPU per invocation is the
technical one; with no decoding (copying bytes, one HMAC, one tiny probe) a run of 8 should use well under a second,
which PR 2 measures and PR 2's tests pin as a batch size.

**Monitoring:** `owner_cover_status()` (counts above), run after the backfill and when in doubt; the function logs one
line per run (`stored`, `failed`, `gone`, `ms`); the R2 dashboard (storage, operations) and the zone's analytics for
`covers.betterreads.de` (cache hit ratio, 4xx). A warning in `owner_cover_status` when stored bytes pass 5 GB (half the
free tier) or `failed` passes 5 % of catalogue covers.

## 9. Work, in PRs

Each PR is a day or less, with its tests; owner checks are what the owner looks at before merging. Models: "Sonnet"
means Sonnet 5.5 at `high`, "DeepSeek" the `normal` tier. The release workflow applies migrations and deploys every
function on a release, so nothing below runs in production before the owner turns it on (*Production steps*).

| # | PR | depends on | model | tests | owner checks |
| --- | --- | --- | --- | --- | --- |
| 1 | **Schema and queue**: the migration of §4 (columns, constraints, the three private tables, triggers, claim/done/failed/kick, `owner_cover_status`, `cover-store-tick` scheduled with the import job's "pg_cron is not here" warning), `enabled = false` | — | Sonnet | `supabase/tests/cover_store_test.sql` (pgTAP): each path of the table in §3 enqueues (add, import write, change edition, `fill_book_covers`, check), a Book outside every Library does not, a non-allowed host does not, `cover_url` change clears the key, `done` compare-and-swap, thumbhash only into an empty one, backoff and `gone`, grants (members cannot call any) | the count of manual Books on other hosts it prints (local); that `enabled` is false |
| 2 | **`cover-store` function, run**: `index.ts`, `handler.ts` (token), `plan.ts` (variants per host), `image.ts` (magic bytes, header widths), `r2.ts` (aws4fetch, HEAD/PUT), `key.ts` (HMAC), `runner.ts` (lease, 4 at a time, pace), thumbhash via `describeCover` + `jpeg-js`, `README.md` | 1 | Sonnet | Deno tests with the recorded fixtures (`record_fixtures.ts`, public covers only) and a fake S3: variants and widths per host, a narrow Apple cover's real width, dedup (two Books, one key, one upload), CAS miss, every failure kind, the token; a measured CPU line for a run of 8 against `supabase functions serve` | the README; the `[functions.cover-store] verify_jwt = false` entry for `supabase/config.toml`, **added by the owner** (workers never commit that file) |
| 3 | **Read path**: `reading_page_book_json`, `member_reading_record`, `author_page` cards return `cover_key`, `cover_widths` (gated by `cover_shown`) | 1 | DeepSeek | pgTAP: each RPC hands out the key exactly with the URL; a hidden cover hides its key too | — |
| 4 | **Client helper and data**: `utils/coverRef.ts`, `useCoverHosts`, `coverHost` runtime config, the types, `library.ts` columns, `socialShapes.ts`, `readingPage.ts`, device copies' versions | 3 | Sonnet | `tests/cover-ref.test.ts` (our copy / `/cover` / source, widths and `srcset`, no key, host unset, fallbacks are the same artwork), the device-copy tests updated | — |
| 5 | **Client call sites, reel, SW**: every UiCover of a Book to `coverImage`, the reel to `coverAt`, preconnect, CSP `connect-src`, the SW rule, `MEMBER_CACHES` | 4 | DeepSeek, Sonnet review | unit tests touched; `pnpm test:e2e` as today (host unset there: nothing changes); a local run with `NUXT_PUBLIC_COVER_HOST` pointing at a local static server holding a few test objects (screenshots of Library, Book page, reel, opened in Orca) | the screenshots; the reel draws |
| 6 | **Backfill and GC**: the backfill migration (enqueue), `cover_gc_mark/claim/done`, the `gc` action, `cover-store-gc` weekly | 2 | Sonnet | pgTAP for mark/grace/claim/race; Deno test for `gc` with the fake S3 (deletes every width, a failure keeps the row) | — |
| 7 | **Docs**: THIRD-PARTY.md, HOSTING.md ("Own covers", next to "The cover cache"), covers.md, OPERATIONS.md (runbook: status, off switches, rotate the R2 token, re-run failed), SETUP.md secrets table, `privacy.ts` EN/DE, README, legal-checklist | 2, 5 | DeepSeek | `pnpm test` (the legal texts' tests) | the THIRD-PARTY wording of the accepted risk, the privacy text |

1 and 2 can be built in parallel once 1's SQL interface (function signatures) is fixed in its PR description; 3 can go
alongside 2. A PR that changes a migration's behaviour updates its pgTAP test in the same PR.

## Production steps (owner approval, in this order)

None of these are done by workers. Secrets are entered by the owner and never pasted into a PR, issue or chat.

1. **R2 token:** R2 → Manage API tokens → Create: Object Read & Write, **only `libellus-covers`**. Set on Supabase:
   `supabase secrets set R2_COVERS_ACCOUNT_ID=… R2_COVERS_ACCESS_KEY_ID=… R2_COVERS_SECRET_ACCESS_KEY=…`.
2. **Keys and token:** `supabase secrets set COVER_KEY_SECRET=$(openssl rand -hex 32) COVER_STORE_TOKEN=$(openssl rand -hex 32)`;
   the same token into Vault as `cover_store_token`; `private.cover_store_settings.function_url` set (as for the
   import job). Keep `COVER_KEY_SECRET` in the password manager: losing it only means new keys for new covers, but
   changing it duplicates every image.
3. **Domain and rules** (Cloudflare dashboard, zone `betterreads.de`): custom domain `covers.betterreads.de` on the
   bucket, `r2.dev` stays disabled; the Cache Rule; the Transform Rule (`Access-Control-Allow-Origin: *`,
   `X-Content-Type-Options: nosniff`); the WAF rule for foreign referers (allowed: `https://betterreads.de`,
   `https://libellus.fabkho.dev`, previews on `*.libellus-3q1.pages.dev` if needed). In the same zone, **the `/cover`
   rule** that `fabkho.dev` already has for `libellus.fabkho.dev`: block `/cover` on `betterreads.de` without the app's
   `Referer` (independent of this plan; it can be done now). Check with one test object uploaded by hand:
   `curl -sI https://covers.betterreads.de/c/<test>/120` twice (second `cf-cache-status: HIT`), once with
   `-H 'Origin: https://betterreads.de'` after a plain request (the header must be there on the HIT), once with a
   foreign `Referer` (403); and `curl -sI 'https://betterreads.de/cover?u=…&w=120' -H 'Referer: https://example.com/'`
   (403). Delete the test object.
4. **Release** with PRs 1–3 and 6 (migrations applied, function deployed, `enabled` still false). Add
   `[functions.cover-store] verify_jwt = false` to `supabase/config.toml` before this release.
5. **Turn on and backfill:** `update private.cover_store_settings set enabled = true;` then watch
   `select public.owner_cover_status();` until `queued` is 0 (minutes). Report counts only. Spot-check two stored covers
   in a browser.
6. **Client:** set `NUXT_PUBLIC_COVER_HOST=https://covers.betterreads.de` in the Pages project (production) and release
   with PRs 4–5 (and 7). Check the Library, a Book page, a friend's page and the reel on the phone; the network panel
   should show `covers.betterreads.de` for catalogue covers and `/cover` only for search.
7. **Rollback, any time:** unset `NUXT_PUBLIC_COVER_HOST` and redeploy (the app is back on `/cover` and the sources);
   `enabled = false` stops storing; nothing else depends on the copies.

## Open points for the owner

- **Goodreads covers** are copied too under this plan (the decision says "every cover"); confirm, or drop the host
  from `COVER_STORE_HOSTS` and they stay linked.
- **Manual Books on other hosts** are not stored in v1 (SSRF, and the images are the member's); PR 1 gives the count.
- **WebP for Open Library covers** (a `v2` with a wasm encoder) only if their bytes turn out to matter.
