# cover-store

Stores the covers of Books that are in a member's Library in Cloudflare R2 (the private bucket `libellus-covers`), at
the sizes the app shows (docs/plans/owned-covers.md; owner decision of 30 Oct 2026). **The database decides, this
function stores**: the reconcile (`private.cover_store_tick`, supabase/migrations/20261108010000_cover_store.sql) queues
every Book in a Library whose `cover_key` is null; this function leases a few, fetches the images from their host,
puts them into R2 and writes `books.cover_key` / `cover_widths` (and a missing thumbhash). Nothing calls it while
`private.cover_store_settings.enabled` is false. The serving side (`/c/<key>/<w>`, a Pages Function) is a later PR.

```
POST /functions/v1/cover-store   { "action": "run" }      one run (Authorization: Bearer <COVER_STORE_TOKEN>)

200 { state: 'idle' | 'ran', claimed, stored, failed, throttled, deferred, gone, unsupported, stale, ms, kick? }
401 unauthorized · 405 method_not_allowed · 400 action_invalid · 503 not_configured (names of what is not set) · 500 failed
```

Callers: the database (pg_net, `private.cover_store_kick`) with the Vault secret `cover_store_token`, or the owner by hand
with the same token. **Only a bearer equal to `COVER_STORE_TOKEN` is let in** (not the service-role key). A `gc` action
comes with the GC PR.

## One run (`runner.ts`)

`cover_store_claim(runner, 8)` leases up to 8 due Books for 170 s; they are worked 4 at a time. For each Book:

1. **Plan** (`plan.ts`) the variant addresses from `books.cover_url`; a host not in `COVER_STORE_HOSTS` or an address of
   an unknown shape is `unsupported_url` (terminal until the cover changes).
2. **Fetch the largest variant** (`fetch.ts`), compute the key (`key.ts`).
3. **Reserve the key** (`cover_store_reserve`). Refused while GC is deleting it: booked again as `deleting` (10 minutes).
   Nothing is uploaded before the reservation, and there is no `HEAD`: a PUT of the same bytes is one harmless Class A operation.
4. **Fetch the other variants and PUT every distinct real width** (`r2.ts`, `aws4fetch`, SigV4). Widths come from the image
   headers (`image.ts`: JPEG SOF, WebP VP8/VP8L/VP8X, PNG IHDR), never from the size asked: Apple's `bb` box keeps a
   cover's proportions (a 600 × 900 box is 568 × 900 for a 0.63 cover). Equal widths are stored once. Two Books with the
   same key in one run share one upload.
5. **Thumbhash and colours, only when the Book has none** (below).
6. **`cover_store_done`**, a compare-and-swap on the Book's artwork. A miss (cover changed, or GC took the key) books the row
   again as `deleting`; if the cover changed the trigger already deleted the row and the next reconcile finds the Book.

A run that claimed rows calls `cover_store_kick(true)` at the end: the next run starts at once while rows are due.

| host (`COVER_STORE_HOSTS`) | variants stored | thumbhash from |
| --- | --- | --- |
| `apple` (`*.mzstatic.com`, `…/<w>x<h>bb.<ext>`) | `600x900bb.webp` (key), `360x540`, `240x360`, `120x180` (Apple renders WebP itself: we never resize) | `66x100bb.jpg` |
| `openlibrary` (`covers.openlibrary.org/b/<kind>/<key>-<S\|M\|L>.jpg`) | `-L` (key), `-M`, always with `?default=false` | the `-M` bytes (one request less than a `-S`) |
| `goodreads` (`i.gr-assets.com`) | the one image the address names | that image |
| `regal` (`books.fabkho.dev`) | the one image | that image |

Other hosts are not stored in v1 (DNS pinning is not possible on this runtime; plan §3). Apple addresses that are not of
the `…/<w>x<h>bb.<ext>` shape (the app's `APPLE_PATH`, checked against it in `plan_test.ts`) are `unsupported_url`.

## Fetching rules (`fetch.ts`)

Identified (`User-Agent: Libellus/1.0 (<OPENLIBRARY_CONTACT>)`), 8 s timeout, at most 2 MB (the timeout starts when the request goes out, after its pace turn), format by magic bytes (the
`Content-Type` is not believed), 4 concurrent at most. **Redirects by hand**, at most 3 hops, each `Location` https, no
port or credentials, on the allowlist (`*.mzstatic.com`, `covers.openlibrary.org`, `archive.org`, `*.archive.org`,
`i.gr-assets.com`, `books.fabkho.dev`): anything else is `host_error`.

- **Open Library**: covers by `isbn`, `oclc`, `lccn` are limited (100 per address per 5 minutes) and are paced on the
  `edge_pace` bucket `openlibrary-covers-keyed` at **0.3 requests a second**; `id`/`olid` covers on `openlibrary-covers`
  at 2 a second. **403 (or 429) is retry-later**: `throttled`, no attempt counted, never `gone`; after a keyed 403 the
  keyed pace is held 5 minutes and no keyed cover is asked until then (a hold with an end, kept by the warm isolate). When the first redirect of a keyed address names
  the cover id (`…/0009363399-L.jpg` at archive.org) the second size is asked by id, so the Book costs one keyed request;
  an address that answers the image directly (a cached one) costs two.
- **Missing covers**: 404/410, a GIF (Open Library's 1 × 1 placeholder) or an image under 16 px on a side is `gone`.
- Wider than 2000 px (the column's limit) is `too_large`.

Failures are booked by reason (`cover_store_failed`): `timeout`, `host_error`, `not_image`, `too_large`, `r2_error` retry
after 1 min, 10 min, 1 h, 6 h, 24 h, then `failed` (weekly); `throttled`, `deleting` after 10 minutes; `gone` and
`unsupported_url` are terminal. Logs carry Book ids (UUIDs), error kinds and host names, never titles, ISBNs or cover
addresses; one line per run: `stored`, `failed`, `throttled`, `deferred`, `gone`, `unsupported`, `stale`, `ms`, `decode_ms`.

## Thumbhash and the CPU (`thumb.ts`)

A Book without `cover_thumbhash` gets one from a JPEG decoded with `jpeg-js`, shrunk to ≤ 100 px, and described by the
app's own `describeCover` (`web/app/data/covers.ts`). Decoding is the only real CPU cost of a run. The edge runtime has no
CPU clock, so it is budgeted by wall clock around each decode and by count: **at most 2 Goodreads Books a run** (their
image is the whole cover) and **no decode starts once a run's decodes took 500 ms**. A Book the budget refuses is left for
the next run (`cover_store_release`: due at once, no attempt counted) and the run's kick chains it. A probe that failed
now is retried with the Book; one that is not there, or not a JPEG, is stored without a thumbhash.

**Measured** (30 Oct 2026, `supabase functions serve` on the local stack, a run of 8 public covers: 3 Apple, 3 Open Library
(two by id, one by ISBN), 2 Goodreads at 600 px, no thumbhash or colours yet, a stand-in for R2; the CPU is the edge-runtime
container's cgroup `usage_usec` before and after the request, so it includes the runtime, TLS and the isolate's start):
**325–616 ms for the whole run** (four runs: 616, 574, 445, 325 ms; the first was a cold isolate), of which the decodes are
145–201 ms; a run of Books that already have a thumbhash costs ~100 ms. Supabase's limit is 2 s. Wall clock 3.7–9 s.

The worst case for the pace is a run of 8 **Open Library ISBN-keyed** covers (every request waits for its 0.3 a second turn,
the timeout starts only after the turn): 8 of 8 stored, wall clock 33.6–36.7 s, **201–462 ms of CPU** (three runs: 462 cold,
219, 201), decodes 48–115 ms. A run of 8 Books each needing two keyed requests is ~53 s of turns, inside the 125 s deadline.

## Secrets (`supabase secrets set`, never in the repo; entered by the owner)

| name | |
| --- | --- |
| `COVER_STORE_TOKEN` | the bearer the kick carries (its Vault twin: `cover_store_token`) |
| `COVER_KEY_SECRET` | HMAC key of the object keys, **at least 32 characters** (`openssl rand -hex 32`; a shorter one answers 503 `not_configured`). **Changing it later is the irreversible rotation** (plan, runbook) |
| `R2_COVERS_ACCOUNT_ID`, `R2_COVERS_ACCESS_KEY_ID`, `R2_COVERS_SECRET_ACCESS_KEY` | an R2 API token with **Object Read & Write on `libellus-covers` only** |
| `OPENLIBRARY_CONTACT` | the contact address in the User-Agent (the `openlibrary` function's secret: secrets are the project's) |
| `COVER_STORE_HOSTS` | optional: `apple,openlibrary,goodreads,regal` (default all). One line drops a host. A list with no known name (a typo) is warned about and means all |
| `R2_COVERS_ENDPOINT` | optional, **local runs only**: a stand-in for `https://<account>.r2.cloudflarestorage.com` |

A secret that is not set does not stop the function from starting: an authorized run answers 503 `not_configured` with the
names. `index.ts` checks nothing at boot except `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.

## Keys (`key.ts`)

`c/<key>/<width>`, `<key>` = first 128 bits, hex, of `HMAC-SHA256(COVER_KEY_SECRET, "v1:" + bytes of the largest
variant)`: content-addressed (Books that share artwork share one image), keyed (nobody can hash a public cover and ask
whether a member holds it), versioned (`v1:`), **only the largest variant enters it**. Checked against `openssl` in `key_test.ts`.

## Deploy

`supabase/config.toml` needs `[functions.cover-store] verify_jwt = false` before the release (the function checks its
caller itself): **added by the owner**, not by this PR. Then the production steps of the plan (billing alert, R2 token,
secrets, Vault token, `private.cover_store_settings.function_url`) and `enabled = true`.

## Tests (`deno task test`, CI job `cover-store`)

Recorded public covers (`fixtures/`, `record_fixtures.ts`: one Apple book at its four widths, an Open Library cover at
S/M/L, a Goodreads image; never a member's), a stand-in for the hosts' web, for R2 (an S3 that checks the SigV4
header and keeps what is PUT) and for the database's RPCs. Nothing is fetched live. They cover the variants and real
widths per host, the key from the largest only, dedup, reserve refused, compare-and-swap miss, every failure kind, a
redirect off the allowlist, Open Library's 403 / 404 / GIF, odd Apple addresses, the Goodreads cap, the decode budget
and the token.

To run it against the local stack: `supabase functions serve --no-verify-jwt --env-file <env>` with the secrets above
(`R2_COVERS_ENDPOINT` pointing at any server that answers 200 to a signed PUT), put some Books in a Library, turn
`enabled` on, `select private.cover_store_reconcile()`, then `POST {"action":"run"}` with the token.
