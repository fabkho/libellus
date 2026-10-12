# goodreads-rating

The book page's Goodreads line (issue #69): a Book's Goodreads rating, ratings count, review count
and Goodreads id, by ISBN-13 (by title and first author for a Book without an ISBN), on demand. Server-side only — the browser never talks to Goodreads.
Only the figures and the id are kept, never review texts.

```
POST /functions/v1/goodreads-rating   { "isbn13": "9780061803208", "title": "Small Gods", "authors": ["Terry Pratchett"] }
GET  /functions/v1/goodreads-rating?isbn=9780061803208&title=Small%20Gods&author=Terry%20Pratchett
POST /functions/v1/goodreads-rating   { "title": "Small Gods", "authors": ["Terry Pratchett"] }    # no ISBN

200 { "status": "found", "goodreadsId": "6388978", "rating": 4.32, "ratingsCount": 137875,
      "reviewsCount": 6116, "matchedBy": "isbn", "checkedAt": "…" }
200 { "status": "not_found", "checkedAt": "…" }
200 { "status": "blocked", "retryAfterSeconds": 600 }      # Goodreads is turning us away; see "Blocked"
400 isbn_invalid · 400 book_unidentified (no ISBN, and no title or no author) · 401 unauthorized · 413 payload_too_large (over 16 KB) · 429 rate_limited (a member: 20 calls a minute, a cover ask 40) · 502 goodreads_unavailable · 503 busy
```

### The cover (last resort, flagged)

```
POST /functions/v1/goodreads-rating   { "title": "Small Gods", "authors": ["Terry Pratchett"], "cover": true, "goodreadsBookId": "…" }

200 { "status": "found", "goodreadsId": "…", "coverUrl": "https://i.gr-assets.com/…/6388978.jpg", "rating": …, … }
200 { "status": "not_found", "goodreadsId": null, "coverUrl": null, "checkedAt": "…" }
429 rate_limited (a member: 40 cover calls a minute, a bucket of its own)
```

Goodreads is a last-resort cover source of the import and the manual "find a cover" action
(`docs/covers.md`, *Goodreads, the last resort*; the web app's `GOODREADS_COVERS` flag is its off switch).
`cover: true` makes it a title request (an ISBN, if sent, is ignored): one `auto_complete` search, and
`coverUrl` is the hit's `imageUrl` without its size token (`._SY75_`, a ~332x500 original), only when it is
`https://i.gr-assets.com/…` exactly (`goodreadsCoverUrl` in `goodreads.ts`; a `nophoto` stand-in is `null`).
`goodreadsBookId` (the id of a Goodreads export's row) prefers the hit with exactly that id: it IS that edition,
so no title check; without it, or when Goodreads does not return it, the same-work rule (`matchTitle`) decides.
Only a rule hit is cached (the caller names the title, so an id may not decide what the cache says about it); a
fresh cached row answers with its cover, and a found row that never asked for one is searched once more. The
cover is only linked, never copied; no description, page count or other field of the hit is kept or told.

- Cache: `cover_url` on `goodreads_title_ratings` (and `goodreads_ratings`): null = not asked, `''` = Goodreads has
  none, else the address (migration `20261027020000_goodreads_cover.sql`). A rating request never answers it, and a
  rating refresh leaves the column alone.
- Rate: the bucket `goodreads-cover` (40 a minute, `BUCKETS` in `handler.ts`), apart from `goodreads-rating`'s 20,
  so an import of ~100 rows does not use up the book page's allowance. The 1 request a second and the busy
  refusal of `client.ts` are unchanged.
- The Catalogue's allow-list (`private.cover_allowed`, migration `20261027030000_goodreads_cover_allowed.sql`)
  takes `i.gr-assets.com` so the cover can be written to a Book (`fill_book_covers`, the import).

How it answers (`handler.ts`):

1. A row in `goodreads_ratings` → that row, while a found rating is under 30 days old and a miss under 7.
   It holds only what Goodreads said about the ISBN (`matched_by = 'isbn'`, or a miss). A Book without an
   ISBN, or whose ISBN Goodreads does not know, has its row in `goodreads_title_ratings`, keyed by its
   normalised title and author surnames (`titleKey`, e.g. `something wicked this way comes|bradbury`): the
   question asked, so the same title twice in the Catalogue shares one row. A title comes from the caller,
   so what a title search found is never stored under an ISBN. Only this function (service role) reads or
   writes `goodreads_title_ratings`: its keys hold the titles of private Manual books.
2. Otherwise (with an ISBN) Goodreads' keyless `book/review_counts.json?isbns=<isbn>`: the edition's book id and the
   work's counts over all editions (`average_rating`, `work_ratings_count`,
   `work_text_reviews_count`). 404 is a miss; a stub without ratings counts as one too.
3. On a miss (stored under the ISBN), or straight away without an ISBN, with a title and an author
   (and the title key's own cache, first): `book/auto_complete?format=json&q=<main title> <surname>`,
   the first result whose normalised title (as given, without parentheses, or before a subtitle)
   equals the Book's and whose author's surname is one of the Book's authors' (`goodreads.ts`,
   `matchTitle`). No review count then.
4. The answer is stored under the key it was asked with (`found` or `not_found`, with its time) and returned. A failure (Goodreads
   down, slow, refusing, garbled) is never stored: the next page view tries again.

### Blocked (the breaker)

Goodreads can switch the keyless endpoints off at any time. These count as a **block** (`GoodreadsBlocked`,
`goodreads.ts`), distinct from a miss (404, no match) and from our own `busy`: HTTP 403, 429 or 503; a 202 or an
empty body; a body that is not JSON; JSON that is not the endpoint's shape (no `books`, not a list). A block is
never cached. It opens a **breaker for 10 minutes** (`BREAKER_MS`, the handler's injected `now`, per running
instance): no request goes to Goodreads meanwhile, and a lookup that would need one answers
`200 { "status": "blocked", "retryAfterSeconds": n }` (HTTP 200 so the client reads it; the rating line stays
without a rating, a cover ask gets none). An answer the cache already has is still given. Each opening writes ONE
line to the function log, the one to alert on:

```
goodreads_blocked {"status":403,"kind":"status","at":"2026-10-04T10:00:00.000Z"}     # kind: status | empty | not_json | shape
```

(`status` is what Goodreads answered.) A plain 500 or a timeout is still `502 goodreads_unavailable` and opens nothing.

Rate safety (`client.ts`): identified by `User-Agent: Libellus/1.0 (…)`, at most one Goodreads
request a second per running instance (a soft limit — Supabase may run more than one instance under
load), a request that would queue longer than 4 s is refused with `busy`, 3 s per request, and one
lookup per Book at a time (two pages asking at once share it).

Bounds: a body (or address) over 16 KB is refused (413), an author name is cut to 200 characters, a title
key over 400 is not asked (with an ISBN the title is left out; without one it is no Book), log lines
carry at most 120 characters of a key, and a member is held to 20 calls a minute (the service role is
not): `public.edge_rate_hit` counts them in `edge_rate_limits`, and an unreachable counter is a 503.
The service-role key is compared in constant time (`secret.ts`).

Callers: a signed-in member's access token, or the service-role key (`warm_library.ts`). The anon
key is refused. `verify_jwt` is off in `supabase/config.toml` because the function checks the
caller itself (`index.ts`), which works with either kind of API key.

## Files

- `goodreads.ts` — pure: parsing both endpoints, ISBN, normalising, matching, the cover address. No I/O.
- `client.ts` — the only way to Goodreads: user agent, limit, timeout. `fetch` and clock injected.
- `handler.ts` — the request/response logic, cache and dedupe. Everything injected.
- `index.ts` — the wiring: supabase-js with the service role, `Deno.serve`.
- `fixtures/` — real Goodreads answers, recorded once by `record_fixtures.ts`. Tests replay them.
- `goodreads_test.ts`, `handler_test.ts` — unit tests; never call Goodreads (an unrecorded URL fails).
- `warm_library.ts` — asks the function about every Book in one member's Library and reports coverage.

## Local

```sh
cd supabase/functions/goodreads-rating && deno test --allow-read=.     # unit tests, offline
supabase functions serve goodreads-rating                              # from the repo root, against the local stack
```

`supabase start` serves it too once it is on `main`. Nothing to configure: the runtime provides
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The Playwright flows never reach it (they answer it
in `web/e2e/fixtures.ts`), nor does Vitest (a stand-in `functions.invoke`).

Warm the cache for a member (live calls, one a second; keys from `supabase status`, never a dotenv):

```sh
cd supabase/functions/goodreads-rating
SUPABASE_URL=http://127.0.0.1:55321 SUPABASE_SERVICE_ROLE_KEY=<from supabase status> \
  deno run --allow-net --allow-env warm_library.ts dev@libellus.local
```

Renew the recordings (rarely; six live requests, two seconds apart):

```sh
cd supabase/functions/goodreads-rating && deno run --allow-net --allow-write=fixtures record_fixtures.ts
```

## Deploy (hosted)

1. Migration: `supabase db push` (adds `goodreads_ratings`, `goodreads_rating(books)`,
   `goodreads_title_ratings`, their `cover_url` and Goodreads' image host on the cover allow-list).
2. Function: `supabase functions deploy goodreads-rating` (reads `verify_jwt = false` from
   `config.toml`; or pass `--no-verify-jwt`).
3. Secrets: none needed. The hosted runtime provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   Optional: `supabase secrets set LIBELLUS_SITE_URL=https://books.example.org`, the instance's
   address, which the `User-Agent` then names (`Libellus/1.0 (private book tracker; +<address>)`) so
   Goodreads can see who is asking.
4. Optional: warm the owner's Library with `warm_library.ts` against the hosted URL and its
   service-role key, or let the book pages fill the cache as they are opened.

No cron: ratings are asked for when a book page is opened and refreshed after 30 days (a miss after 7).
