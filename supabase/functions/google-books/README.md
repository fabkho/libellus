# google-books

Google Books as the app's **last book source** (issue #305), after the own Catalogue, Apple Books, Open Library and the
German National Library (`dnb-lookup`). It finds German books the others come up short on, and the genres of a Catalogue
Book that has none. The app side is `web/app/data/googleBooks.ts` (the client), `googleBooksRecord.ts` (the volumes read as
editions, shared with this function) and `googleCover.ts`; docs/THIRD-PARTY.md has the terms, docs/OPERATIONS.md the
secret, the quota and the budget. **The browser never talks to Google**: the key lives here.

```
POST /functions/v1/google-books   { "action": "isbn",   "isbn13": "9783499267017" }
POST /functions/v1/google-books   { "action": "search", "query": "der schwarm schätzing", "languages": ["de-DE", "en-US"] }
POST /functions/v1/google-books   { "action": "search", "title": "Der Schwarm", "authors": ["Frank Schätzing"] }
POST /functions/v1/google-books   { "action": "book",   "isbn13": "9783499267017" }
                                  (any of them with "purpose": "import": the import's own member bucket)

200 { "status": "found", "volume": { id, title, authors, isbn13, isbn10, pageCount, year, language, publisher, genres, coverUrl } }
200 { "status": "not_found" }
200 { "status": "ok", "volumes": [ … ] }
200 { "status": "found", "book": <a `books` row> }
200 { "status": "unavailable", "reason": "not_configured" | "budget" | "blocked" | "error" }
400 isbn_invalid · book_unidentified · action_unknown · 401 unauthorized · 413 payload_too_large · 429 rate_limited · 502 google_books_unavailable
```

## It can ship before the key exists

The API key is the function secret **`GOOGLE_BOOKS_API_KEY`**, read from the environment on every request; it is in no file
of the repository, no test, no log and no address (Google gets it in the `x-goog-api-key` header). Until it is set the
function answers `{ "status": "unavailable", "reason": "not_configured" }`, asks Google nothing and counts nothing; the app
reads that as "this source has nothing" (every method of `googleBooks.ts` answers `null` or `[]`, never an error, never
"unsure" to the import), so the other sources carry on and a member sees nothing of it.

```
supabase secrets set GOOGLE_BOOKS_API_KEY=<the key>     # production, once; it takes effect on the next request
supabase secrets unset GOOGLE_BOOKS_API_KEY             # back to "unavailable"
```

Create the key in Google Cloud (a project with the **Books API** enabled; Credentials → API key). Restrict it to the Books
API. It cannot be restricted by referrer (the caller is a server), and the key is only ever sent from this function.

## What it asks

One request per question, never more; the answer says what is asked:

- an ISBN: `q=isbn:<isbn13>`;
- a title and a first author: `q=intitle:"…" inauthor:"…"`; words: the words as they are;
- always `printType=books`, `maxResults=10` and `fields=items(id,volumeInfo(…))` (a partial response: **no description**, no
  preview or sale data). `langRestrict` only when exactly one language is asked for (the API takes one); with several the
  answer is ordered by them instead (`rankedBy`).

The order across the app keeps the quota for what the others cannot answer: Search asks Google only for an ISBN none of them had
or for a query that found fewer than three editions (`GOOGLE_BELOW`, `data/search.ts`); the edition picker once per opening;
the import once per row the ISBN step and the title ladder left without any Book of its work; `enrich` once per Catalogue Book
that has no genre, by its ISBN.

## What it keeps, and for how long

`google_books_cache` (service role only; members cannot read it: a free-words key is what a member typed). Google's terms
allow no permanent copy of what its API returns and no cached copy "longer than permitted by the cache header" (docs/THIRD-PARTY.md),
so **every row expires**:

| Answer | Kept |
| --- | --- |
| found, `Cache-Control: no-store` | not at all |
| found, `max-age=N` (N > 0) | N seconds, at most a day |
| found, no stated lifetime (`private`, `max-age=0`, no header) | `GOOGLE_BOOKS_CACHE_FALLBACK_SECONDS`, default 3600; **0 keeps nothing** |
| not found (a miss) | six hours: it is our own finding, not Google's content |
| a failure, a refusal, "unavailable" | never |

The table refuses a row that would live past a day (`google_books_cache_lifetime`), an expired row is never answered, and the
pg_cron job `purge-google-books` (hourly) deletes what has expired. A row holds the parsed volumes (facts of the edition, the
app's genres mapped from the categories, the address of a cover image): never the description, never the raw categories. Two
questions asked at once share one request.

## The daily budget and the breaker

Google's default quota is about 1,000 requests a day for the whole project (and, keyless, none: every unkeyed request answered
`429 Quota exceeded … Queries per day` when this was written). `google_books_budget_take(900)` counts each request that goes out
against **900 a day** (Google's day: Pacific time, when the quota resets); past it the function answers `unavailable`
(`reason: "budget"`, one log line `google_books_budget_spent` per day and instance) instead of burning what is left. A cached
answer is still given. A refusal from Google (400, 401, 403, 429) opens a breaker for ten minutes (`BREAKER_MS`): no request goes
out, one log line `google_books_blocked {"status":429,…}` (alert on it).

A member may call it 30 times a minute (`edge_rate_hit`, bucket `google-books`), an import 120 (`google-books-import`); the
service role (the import job, `enrich`) is not counted per member.

## `book`

Makes the Catalogue Book (source `import`, found again by its ISBN-13) from what Google says about the ISBN, **never from what
the caller sends**, as `dnb-lookup` does: a member may only add a Catalogue Book. A volume without authors is not made. The
cover is Google's own address, **linked**: it is allowed by `private.cover_allowed` (the database), refused by
`private.cover_storable` (the cover store never copies it) and `private.cover_shown` (not shown outside the app).

## Tests and deploy

```
cd supabase/functions/google-books
deno lint && deno check *.ts && deno task test      # recordings in fixtures/, nothing is fetched, no key is used
supabase functions serve google-books                # or: supabase start (the edge runtime serves it)
```

The fixtures are **hand-built from the documented response shape** (the keyless quota was spent when they were written, so
nothing could be recorded; every title, name and ISBN is invented) plus one real `429` answer. Record real ones once a key
exists: any `GET` of `volumes` with `fields=` as in `googleBooksRecord.ts`, saved under `fixtures/`, scrubbed of nothing but
ids you do not want in a public repository.

Deploy: with the rest (`release.yml` deploys every function under `supabase/functions`, with `verify_jwt = false` from
`supabase/config.toml`); by hand `supabase functions deploy google-books --no-verify-jwt`.
