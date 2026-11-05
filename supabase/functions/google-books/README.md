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
                                  (the service role may add "purpose": "enrich": enrich's own slice of the day; a member's "purpose" is ignored)

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
or for a query of at least four characters that found fewer than three editions (`GOOGLE_BELOW`, `GOOGLE_MIN_QUERY`, `data/search.ts`); the edition picker once per opening;
the import once per row the ISBN step and the title ladder left without any Book of its work; `enrich` once per Catalogue Book
that has no genre, by its ISBN.

## What it keeps, and for how long

`google_books_cache` (service role only; members cannot read it: a free-words key is what a member typed). Google's terms
allow no permanent copy of what its API returns and no cached copy "longer than permitted by the cache header" (docs/THIRD-PARTY.md),
so **every row expires**:

| Answer | Kept |
| --- | --- |
| found, `no-store`, `no-cache` or `private` | not at all |
| found, `max-age=0` or `s-maxage=0` | not at all |
| found, `s-maxage=N` (else `max-age=N`), N > 0, none of the above | N seconds, at most a day |
| found, a header that states no lifetime (`public` alone) | not at all: it allows no copy |
| found, **no `Cache-Control` header at all** | `GOOGLE_BOOKS_CACHE_FALLBACK_SECONDS`, default 3600, at most a day; **0 keeps nothing**: the only case it applies to |
| not found (a miss) | six hours: it is our own finding, not Google's content |
| a failure, a refusal, "unavailable" | never |

The table refuses a row that would live past a day (`google_books_cache_lifetime`), an expired row is never answered, and the
pg_cron job `purge-google-books` (hourly) deletes what has expired. A row holds the parsed volumes (facts of the edition, the
app's genres mapped from the categories, the address of a cover image): never the description, never the raw categories. Two
questions asked at once share one request.

## The daily budget and the breaker

Google's default quota is about 1,000 requests a day for the whole project (and, keyless, none: every unkeyed request answered
`429 Quota exceeded … Queries per day` when this was written). `google_books_budget_take(900, scope, scope_limit)` counts each request
that goes out against **900 a day** (Google's day: Pacific time, when the quota resets); past it the function answers `unavailable`
(`reason: "budget"`, one log line `google_books_budget_spent` per day, instance and scope, with the Pacific day) instead of burning what is
left. A cached answer is still given. **`enrich` has a slice of its own: 300 of the 900** (`ENRICH_DAILY_BUDGET`, counted as scope `enrich` and
in the day: both or neither): after a big import it would otherwise ask for the genres of every new Book and leave members nothing. When its
slice is gone enrich's asks answer `unavailable` and stop quietly (a Book simply keeps no Google genre until its next refresh); the other 600 stay
for members and the import job. Only the service role can say `purpose: "enrich"`.

A refusal of the key or the quota (401, 403, 429, or a 400 that says the key is invalid: `keyInvalid`) opens a breaker for ten minutes
(`BREAKER_MS`): no request goes out, one log line `google_books_blocked {"status":429,…}` (alert on it). **Any other 400 is the request's
own error** (it can come from a member's body) and opens nothing; a 5xx opens nothing either. `languages` is filtered against a short list of
two-letter codes (`ALLOWED_LANGUAGES`) before anything reaches Google, and the request is never followed through a redirect (`redirect: 'error'`),
so the key header cannot be forwarded. A question of nothing but punctuation is not sent at all.

**Limits per caller.** A member: 30 calls a minute (`edge_rate_hit`, bucket `google-books`) **and 60 requests a day that really go out to
Google** (`MEMBER_DAILY_LIMIT`, bucket `google-books-day`, 24 hours; a cached answer costs her nothing): interactive search, the picker and adding a
Book need a handful, so one member can never spend the day's 900. A `purpose` in a member's body is ignored: the import job and `enrich` are the
service role (not counted per member), and only the service role's `purpose: "enrich"` gets the slice.

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
