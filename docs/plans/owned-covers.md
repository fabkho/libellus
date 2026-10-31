# Own covers for catalogue books (plan, not built)

Status: plan, 30 October 2026, revised after an independent review and the owner's decisions of 30 Oct (serving B, Goodreads stored, one release). Nothing here is implemented or
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
2. **The image requests are cheap:** same origin, on the connection the page already has, answered from Cloudflare's
   edge cache in milliseconds; small (WebP at the width shown: an Apple cover at 120 px is ~5 KB, at 600 px ~25 KB,
   measured below).
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

## 1. How the images are served

**Owner decision (30 Oct 2026): option B, a same-origin Pages Function `/c/<key>/<w>`** (`web/functions/c/[[path]].js`,
next to `/cover`) with an **R2 binding** and `caches.default`. The bucket stays **private**: no custom domain, no
public access, no `r2.dev` address.

- The Function accepts exactly `/c/<32 hex>/<width>` (width an integer 16–2000), `GET`/`HEAD` only. The
  `Origin`/`Referer` check is `cover.js`'s `sender` (moved into a small module both import), so other sites cannot embed
  it; CORS only for `COVER_ALLOWED_ORIGINS`, never `*`.
- `caches.default.match(url)`; on a miss `env.COVERS.get('c/<key>/<w>')`: the stored `Content-Type`,
  `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`,
  `Cross-Origin-Resource-Policy: same-site`, put into the cache with `waitUntil`. A missing object is a 404 with
  `no-store` (the app's chain falls back). Streaming a body costs no CPU worth counting against the free 10 ms.
- Same origin, so nothing cross-origin to configure: no CORS for the reel's WebGL textures, no `crossorigin`
  attributes, no CSP or preconnect change, no second origin in the service worker. Relative URLs work on every origin
  that serves the app (`betterreads.de`, `libellus.fabkho.dev`, `libellus-3q1.pages.dev` and its preview subdomains).
- The existing WAF custom rule blocking `/cover` without the app's `Referer` and the rate-limiting rule on `/cover`
  (docs/HOSTING.md) get `/c/` added, in both zones (`fabkho.dev` for `libellus.fabkho.dev`, `betterreads.de`). The
  `/cover` rule in `betterreads.de` is already in place (403 without or with a foreign `Referer`).
- The service worker's navigation fallback never answers `/c/` (images only, `request.destination !== 'document'`).
- **Cost:** one Pages Function invocation per image request the service worker does not answer: a few thousand a day
  for this private app against the free 100,000 a day, shared with `/r`, `/share`, `/cover`. Past the limit Pages
  answers the Function's paths with an error, never a bill, and the chain falls back to `/cover`, then the source.

**The upgrade path (not built): the bucket public on `covers.betterreads.de`.** If daily Function invocations ever
approach ~50,000 (Pages analytics), the same objects can be served from a custom domain in the `betterreads.de` zone
with no code per request. Keys and objects stay the same; the client's base URL changes. It would then need: the custom
domain on the bucket, a Cache Rule (keys have no extension), a Response Header Transform Rule for
`Access-Control-Allow-Origin: *` (the bucket's own CORS policy is not enough because the cache does not key on
`Origin`), a WAF rule against foreign referers (`starts_with`/`wildcard`, never a bare `contains`), the host in CSP
`connect-src` and a preconnect, a service-worker rule for the second origin, and `crossorigin="anonymous"` on own
covers, the reel's preload links and textures, never on fallbacks to hosts without CORS (Goodreads,
`books.fabkho.dev`). None of this is part of the plan's work.

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
`cover_store_token`). The function answers only a bearer equal to `COVER_STORE_TOKEN`. The Pages Function `/c/` reads
through its binding (no key at all).

**Which hosts:** `COVER_STORE_HOSTS` in the function: Apple, Open Library, **Goodreads** (owner decision 30 Oct 2026:
stored like the others, an owner-accepted risk on the same grounds as the cover cache; the CPU cap above applies), and
`books.fabkho.dev`. One line drops a host.

**Covers on other hosts (a member's own edition or a pasted address, which `use_own_edition` accepts as any `https://`
URL): not in v1.** The owner asked for them if it is easy and safe; in my judgement it is neither, here:

- The job runs in Supabase's edge runtime. "No private, loopback or link-local address after DNS" needs the check and
  the connection to use the **same** address. Deno's `fetch` resolves the name itself, so a check with
  `Deno.resolveDns` (if the hosted runtime even allows it) is check-then-use: a name with a zero TTL that answers a
  public address to the check and `169.254.169.254` or `10.x` to the fetch (DNS rebinding) gets through, and so does
  the same trick on any redirect hop. What sits behind such an address is Supabase's network, not ours.
- Pinning the address means opening the connection ourselves (`Deno.connectTls` to the checked IP with the host name for
  the certificate) and speaking HTTP by hand, redirects included, re-checked per hop. That is a small HTTP client to
  write and keep safe, not a guard around `fetch`, and more code than the rest of the fetcher for a handful of Books
  (PR 1 reports how many).
- The other guards (https and port 443 only, no IP literals or `localhost` in the URL, 5 MB cap, image `Content-Type`
  and magic bytes, timeout, 2 such Books a run, the original stored once as its own width from its header) are easy;
  the DNS one is what makes it unsafe.

Those Books keep showing their own address, exactly as today. A safe later path (v2, to be verified first): do the
fetch for unknown hosts in a Cloudflare Worker, whose `fetch` leaves from Cloudflare's edge with no private network
behind it, with the same non-DNS guards; the Worker hands the bytes to the store (or writes them through its own R2
binding). The rest of this plan (reserve, keys, `cover_objects`, GC) needs no change for it.

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
  `cover_store_failed`, `cover_store_kick`, and the GC ones (PR 6).
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
/** own: whether own covers are on (same origin, `/c/…`); origin: the page's, for the absolute addresses Regal takes. */
export type CoverHosts = { own: boolean; proxy: boolean; origin?: string }

/** UiCover's props for a cover at a token size: src, srcset, sizes, fallbacks. */
export function coverImage(ref: CoverRef, size: CoverSize, hosts: CoverHosts): CoverImage
/** One address for a cover drawn at a size no token names (the reel's textures; absolute, as Regal takes images). */
export function coverAt(ref: CoverRef, at: { width?: number; height?: number; dpr?: number }, hosts: CoverHosts): string | null
```

The rule, in order: **our copy** (`/c/<key>/<w>`, the smallest stored width that is at least the size's pixels,
`srcset` of the stored widths up to it) when the Book has a key and own covers are on; else **`/cover`** when the proxy
is on and the source is one it serves; else **the source** (today's `coverSrc`). `fallbacks` after our copy are
today's `coverChain` of the source (the same artwork), so an R2 hiccup is never a missing cover. Everything is same
origin or as today, so no `crossorigin` handling is added. `coverSrc`, `coverSrcset`, `coverChain` and `coverFor`
stay for addresses without a Book (search results, the edition picker).

- **Config:** `runtimeConfig.public.ownCovers` (`NUXT_PUBLIC_OWN_COVERS`: `on`; unset or `off` = off, so `nuxt dev`,
  the e2e build and any deployment without it behave exactly as today) and `useCoverHosts()` next to
  `useCoverProxy()`. Unsetting it in Pages is the client's off switch.
- **Types:** `BookSnapshot` and `SocialBook` gain `coverKey` and `coverWidths`; `socialShapes.ts`, `readingPage.ts`,
  `library.ts` read them. Device copies that whitelist Book fields (`bothReadDevice.ts`, the feed's copy, the Library's
  local data) take the two fields and bump their version.
- **UiCover call sites** (~45 components, ~60 `coverSrc`/`coverFor` calls): `:src="coverSrc(book.coverUrl, 'sm', proxy)"`
  becomes `v-bind="coverImage(book, 'sm', hosts)"`; the base's props win over `app.config.ts`'s `ui.cover.sources`
  (checked against `@fabkho/ui` v0.10.5). `thumbhash` is passed at every site that shows a catalogue Book.
- **The reel** (`data/bothReadReel.ts`, `reelBook`): `coverAt(shown, { height: REEL_BOOK_HEIGHT, dpr }, hosts)`, an
  absolute address on the page's origin as `/cover`'s is today; `useReelCovers` returns the hosts; poster, still,
  preload (`utils/regalReelPreload.ts` → Regal's `preloadReelCovers`) and textures keep naming one address per cover.
  Same origin, so the textures need no CORS.
- **Service worker** (`web/nuxt.config.ts`, `runtimeCaching`): a same-origin rule for `/c/` like `/cover`'s:
  `CacheFirst`, cache `libellus-own-covers`, `cacheableResponse: { statuses: [200] }`, `expiration: { maxEntries: 1500,
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

- **THIRD-PARTY.md** (PR 7): the *Cover cache* row stays for `/cover`; a new **Own covers** row: what is copied (covers
  of Books in a member's Library, at the sizes the hosts render), where (the private R2 bucket `libellus-covers`, WEUR,
  served only through our own `/c/`), how (server side, identified, paced, once per image, never in bulk ahead of a
  member adding the book; Open Library's keyed covers at 0.3 a second), kept until 30 days after no Library holds the
  book, and the **owner-accepted risk** (dated 30 Oct 2026, the same position as the cache: a private app for the owner
  and a few friends, no benefit drawn from the covers). The **Goodreads covers** row changes from "linked, never copied"
  to "stored like the others since <date>, owner-accepted risk; one line to stop (`COVER_STORE_HOSTS`), then clear their
  keys and let GC delete". Apple and Open Library rows: "the image is stored", not only "cached at our edge".
- **Privacy notice** (`web/app/legal/privacy.ts`, EN and DE) and README "Where your data lives": the R2 entry gains the
  covers bucket (book cover images only, private, keys not derived from any member, no member data).
  `docs/legal-checklist.md` gets the bucket.
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
| Pages Function invocations (`/c/`) | a few thousand a day (service-worker misses); `/cover` loses the catalogue covers | — | 100 k a day, shared with `/r`, `/share`, `/cover` |
| pg_cron | the tick each minute (one reconcile query), GC weekly | — | — |

Storage binds first, at roughly 150,000 covers; the Function pool is the one to watch (the upgrade path in §1 at
~50,000 a day). Supabase's 2 s CPU is the technical limit; runs decode at most a tiny probe or two Goodreads images
(§3), measured in PR 2. R2 has **no hard spend cap**: a billing notification is set before the job is turned on.

**Monitoring:** `owner_cover_status()`, run after the backfill and when in doubt; one log line per run (`stored`,
`failed`, `throttled`, `gone`, `ms`); the R2 dashboard (storage, operations); Pages analytics for Function invocations.
`owner_cover_status` warns when stored bytes pass 5 GB or `failed` passes 5 % of catalogue covers.

## 9. Work, in PRs

Each PR is a day or less, with its tests. "Sonnet" means Sonnet 5.5 at `high` (logic, SQL), "DeepSeek" the `normal`
tier (mechanical work).

**One release, at the end (owner decision).** The PRs merge to `main` one by one with the feature off and are not
released one at a time; everything ships together in one later release, then the owner turns it on (production steps).
A release cut meanwhile for other work would carry the merged parts harmlessly: the migrations only add columns,
private tables and a tick that does nothing while `enabled` is false; the `cover-store` function is never called while
it is off; `/c/` answers 404 for keys nobody hands out; and the client shows today's addresses while
`NUXT_PUBLIC_OWN_COVERS` is unset.

| # | PR | depends on | model | tests | owner checks |
| --- | --- | --- | --- | --- | --- |
| 1 | **DB: schema, queue, reconcile**: the migration of §4 (columns, constraints, private tables with the queue's `on delete cascade`, `cover_artwork`, the key-clearing trigger with its `WHEN`, tick/reconcile, claim/reserve/done/failed/kick, `owner_cover_status`, `cover-store-tick` scheduled with the import job's "pg_cron is not here" warning), `enabled = false` | — | Sonnet | `supabase/tests/cover_store_test.sql` (pgTAP): the reconcile finds a Book after each path (add, import write, change edition, own edition, `fill_book_covers`, check) and not one outside every Library or on another host; an identical-value `cover_url` update keeps the key; an Apple size change keeps it; another artwork clears key and queue row; **`cover_store_done`'s write does not fire the trigger**; compare-and-swap; thumbhash only into an empty one; reserve refuses while `deleting_at`; backoff, `throttled`, `gone`; cascade on Book delete; grants | the count of Books on other hosts (local); `enabled` false |
| 2 | **`cover-store` function, run**: `index.ts`, `handler.ts` (token), `plan.ts`, `fetch.ts` (manual redirects, allowlist, `default=false`, paces), `image.ts` (magic bytes, header widths, GIF/tiny), `r2.ts` (aws4fetch, PUT), `key.ts` (HMAC of the largest variant), `runner.ts` (lease, reserve-first, Goodreads cap), thumbhash, `README.md`; a **`cover-store` job in `.github/workflows/ci.yml`** with path filters like `importjob`'s (`supabase/functions/cover-store/**`, `_shared/**`, `web/app/data/**`, `web/app/utils/**`) | 1 | Sonnet | Deno tests with recorded public fixtures and a fake S3: variants and real widths per host (Goodreads included), key from the largest variant only, dedup, reserve refused, CAS miss, a redirect off the allowlist, OL 403 → `throttled`, OL 404/GIF → `gone`, odd Apple URL → `unsupported_url`, the Goodreads cap, the token; a measured CPU line for a run of 8 | the README; the `[functions.cover-store] verify_jwt = false` entry for `supabase/config.toml`, **added by the owner** |
| 3 | **DB: read path**: `reading_page_book_json`, `member_reading_record`, `author_page` cards return `cover_key`, `cover_widths` (gated by `cover_shown`) | 1 | DeepSeek | pgTAP: each RPC hands out the key exactly with the URL; a hidden cover hides its key | — |
| 4 | **Serving and client data**: `web/functions/c/[[path]].js` (`sender` moved into a module shared with `cover.js`), `utils/coverRef.ts`, `useCoverHosts`, the `ownCovers` config, the types, `library.ts` columns, `socialShapes.ts`, `readingPage.ts`, device copies' versions | 3 | Sonnet | `tests/cover-own-function.test.ts` like `cover-function.test.ts` (strict path, 404 `no-store`, headers, cache hit, foreign `Referer` 403, the binding faked); `tests/cover-ref.test.ts` (our copy / `/cover` / source, widths and `srcset`, no key, off, fallbacks are the same artwork); the device-copy tests updated | — |
| 5 | **Client call sites, reel, service worker**: every UiCover of a Book to `coverImage`, the reel to `coverAt`, the `/c/` SW rule, `MEMBER_CACHES` | 4 | DeepSeek, Sonnet review | unit tests touched; `pnpm test:e2e` (own covers off there); a local run with own covers on against a few test objects served by `wrangler pages dev` with a local R2 binding (screenshots of Library, Book page, reel, opened in Orca) | the screenshots; the reel draws |
| 6 | **GC**: `cover_gc_mark/claim/done` (migration), the `gc` action, `cover-store-gc` weekly | 2 | Sonnet | pgTAP for mark, grace, claim in one statement, the reserve race both ways, the entry-against-claim case (key cleared, reconcile re-queues); Deno test for `gc` with the fake S3 (deletes every width, a failure keeps the row) | — |
| 7 | **Docs**: THIRD-PARTY.md (own covers, Goodreads stored), HOSTING.md ("Own covers", next to "The cover cache"), covers.md, OPERATIONS.md (runbook below), SETUP.md secrets and binding table, `privacy.ts` EN/DE, README, legal-checklist | 2, 5 | DeepSeek | `pnpm test` (the legal texts' tests) | the THIRD-PARTY wording of the accepted risk, the privacy text |

Order: 1, then 2 and 3 in parallel (once 1's function signatures are fixed in its PR description), then 4 after 3,
5 after 4, 6 after 2, 7 last. Seven PRs: option B folded the serving Function into PR 4 and removed the cross-origin
work (CORS, CSP, preconnect, `crossorigin`) that a separate host would have needed.

## Runbook notes (OPERATIONS.md, PR 7)

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
- **Stopping one host** (e.g. Goodreads objects): drop it from `COVER_STORE_HOSTS`, clear `cover_key` on its Books
  (`where cover_url like 'https://i.gr-assets.com/%'`), and GC deletes their objects after the grace.

## Production steps (owner approval, in this order)

None of these are done by workers. Secrets are entered by the owner and never pasted into a PR, issue or chat.

1. **Billing notification first:** Cloudflare → Notifications → a usage-based billing alert for R2 (R2 has no hard
   spend cap; the free tier is generous, the alert catches a runaway loop).
2. **R2 token:** R2 → Manage API tokens → Create: Object Read & Write, **only `libellus-covers`**. Set on Supabase:
   `supabase secrets set R2_COVERS_ACCOUNT_ID=… R2_COVERS_ACCESS_KEY_ID=… R2_COVERS_SECRET_ACCESS_KEY=…`.
3. **Key and token:** `supabase secrets set COVER_KEY_SECRET=$(openssl rand -hex 32) COVER_STORE_TOKEN=$(openssl rand -hex 32)`;
   the same token into Vault as `cover_store_token`; `private.cover_store_settings.function_url` set (as for the import
   job). Keep `COVER_KEY_SECRET` in the password manager; **changing it later is the irreversible rotation above**.
4. **Pages binding:** Pages project → Settings → Bindings → R2 bucket: `COVERS` → `libellus-covers` (production; preview
   too if previews should show own covers).
5. **WAF:** add `/c/` to the `/cover` WAF custom rule and to the `/cover` rate-limiting rule in both zones (`fabkho.dev`,
   `betterreads.de`). The `/cover` rule in `betterreads.de` is already in place.
6. **`supabase/config.toml`:** add `[functions.cover-store] verify_jwt = false` before the release.
7. **The release** with all seven PRs (migrations applied, functions deployed, the feature still off everywhere).
8. **Turn storing on (this is the backfill):** `update private.cover_store_settings set enabled = true;` then watch
   `select public.owner_cover_status();` until `queued` is 0 (minutes; Open Library's keyed covers are the slow part).
   Report counts only. Spot-check two stored covers through `/c/…` in a browser.
9. **Turn the client on:** set `NUXT_PUBLIC_OWN_COVERS=on` in the Pages project (production) and rebuild the production
   deployment (retry it; no new release needed). Check the Library, a Book page, a friend's page and the reel on the
   phone; the network panel should show `/c/…` for catalogue covers and `/cover` only for search.
10. **Rollback, any time:** unset `NUXT_PUBLIC_OWN_COVERS` and rebuild (the app is back on `/cover` and the sources);
    `enabled = false` stops storing; **remove the R2 API token** (R2 → Manage API tokens), the Pages binding and the
    Supabase secrets if the feature is dropped; nothing else depends on the copies. Deleting the bucket's objects is
    irreversible.

## Decided and open

Decided by the owner (30 Oct 2026): serving through the same-origin Function (B), the custom domain only as the upgrade
path; Goodreads covers stored too; one release at the end.

Open:

- **Covers on other hosts** stay out of v1 (§3: not safe on the Supabase runtime without pinning DNS); the Worker path
  is the candidate for a v2 if PR 1's count makes it worth it.
- **WebP for Open Library covers** (a `v2` with a wasm encoder) only if their bytes turn out to matter.
