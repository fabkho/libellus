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
400 isbn_invalid · 400 book_unidentified (no ISBN, and no title or no author) · 401 unauthorized · 502 goodreads_unavailable · 503 busy
```

How it answers (`handler.ts`):

1. A row in `goodreads_ratings` → that row, while a found rating is under 30 days old and a miss under 7.
   A Book without an ISBN has its row in `goodreads_title_ratings`, keyed by its normalised title and
   author surnames (`titleKey`, e.g. `something wicked this way comes|bradbury`): the question asked,
   so the same title twice in the Catalogue shares one row.
2. Otherwise (with an ISBN) Goodreads' keyless `book/review_counts.json?isbns=<isbn>`: the edition's book id and the
   work's counts over all editions (`average_rating`, `work_ratings_count`,
   `work_text_reviews_count`). 404 is a miss; a stub without ratings counts as one too.
3. On a miss, or straight away without an ISBN, with a title and an author: `book/auto_complete?format=json&q=<main title> <surname>`,
   the first result whose normalised title (as given, without parentheses, or before a subtitle)
   equals the Book's and whose author's surname is one of the Book's authors' (`goodreads.ts`,
   `matchTitle`). No review count then.
4. The answer is stored (`found` or `not_found`, with its time) and returned. A failure (Goodreads
   down, slow, refusing, garbled) is never stored: the next page view tries again.

Rate safety (`client.ts`): identified by `User-Agent: Libellus/1.0 (…)`, at most one Goodreads
request a second per running instance (a soft limit — Supabase may run more than one instance under
load), a request that would queue longer than 4 s is refused with `busy`, 3 s per request, and one
lookup per ISBN at a time (two pages asking at once share it).

Callers: a signed-in member's access token, or the service-role key (`warm_library.ts`). The anon
key is refused. `verify_jwt` is off in `supabase/config.toml` because the function checks the
caller itself (`index.ts`), which works with either kind of API key.

## Files

- `goodreads.ts` — pure: parsing both endpoints, ISBN, normalising, matching. No I/O.
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

1. Migration: `supabase db push` (adds `goodreads_ratings`, `goodreads_rating(books)` and
   `goodreads_title_ratings`; nothing else changes).
2. Function: `supabase functions deploy goodreads-rating` (reads `verify_jwt = false` from
   `config.toml`; or pass `--no-verify-jwt`).
3. Secrets: none needed. The hosted runtime provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   Optional: `supabase secrets set LIBELLUS_SITE_URL=https://books.example.org`, the instance's
   address, which the `User-Agent` then names (`Libellus/1.0 (private book tracker; +<address>)`) so
   Goodreads can see who is asking.
4. Optional: warm the owner's Library with `warm_library.ts` against the hosted URL and its
   service-role key, or let the book pages fill the cache as they are opened.

No cron: ratings are asked for when a book page is opened and refreshed after 30 days (a miss after 7).
