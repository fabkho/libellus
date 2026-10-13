# openlibrary

The import's Open Library asks, through our own server (issue #111, owner decision 13 Oct 2026).
Open Library allows **one request a second of an unidentified client and three of an identified
one** — a `User-Agent: AppName (contact email)` (https://openlibrary.org/developers/api, "Rate
Limits"; violations "may result in aggressive rate limiting or blocking"). A browser cannot set
its User-Agent, and the import runs ~1,200–2,000 searches per file unpaced today (measured:
`docs/plans/import-quality.md`), so this function is what identifies us to Open Library and keeps
the distance. **The app side is `web/app/data/openLibraryProxy.ts`** (the import's `fetch`), which
also falls back to direct Open Library when this function fails.

```
GET /functions/v1/openlibrary?path=/search.json&q=title+author&limit=20&fields=…
GET /functions/v1/openlibrary?path=/isbn/9780142437247.json
GET /functions/v1/openlibrary?path=/works/OL102749W/editions.json&limit=50
GET /functions/v1/openlibrary?path=/books/OL3704476M.json
GET /functions/v1/openlibrary?path=/api/books&bibkeys=ISBN:…&jscmd=data&format=json

200/404/…  Open Library's own status and JSON body, as it is (with its `Retry-After` when it names one)
400 path_missing · path_not_allowed · query_too_large (over 2 KB) · 401 unauthorized · 405 method_not_allowed
429 rate_limited (a member: 360 calls a minute) · 502 openlibrary_unavailable · 504 openlibrary_timeout (12 s)
```

- **Who**: a signed-in member's access token or the service-role key (`verify_jwt` is off,
  supabase/config.toml; the function checks the caller itself). A member may ask 360 times a
  minute (`edge_rate_hit`, bucket `openlibrary`), so one member cannot starve the others; the
  service role is not counted (the server-side import, #329).
- **The path** is checked against an allow-list (`ALLOWED_PATHS`, `handler.ts`) — the paths the
  import asks and nothing else: `search.json`, an edition record by ISBN (`/isbn/<isbn>.json`), a
  work's editions, an edition record by key, and `api/books` (the cover fill). The host is ours
  (`https://openlibrary.org<path>`), never the caller's; query parameters pass through, capped
  at 2 KB. **Covers are not proxied**: cover images load from `covers.openlibrary.org` in the
  browser (owner decision; `b/id/…` has no per-address limit, and images are not what eats the
  budget).
- **The User-Agent** is `Libellus/1.0 (<OPENLIBRARY_CONTACT>)`, the contact from the
  `OPENLIBRARY_CONTACT` function secret — **never in the repository**. Without it the function
  refuses to start (an unidentified proxy would quietly keep the import on the 1/s tier, and
  Open Library asks for a way to reach whoever runs the client). Set it on deploy:
  `supabase secrets set OPENLIBRARY_CONTACT=you@example.com`.
- **The pace**: at most three requests a second per running instance (a small in-memory queue,
  `client.ts`; edge instances are separate, accepted at today's scale and documented here). An
  upstream `Retry-After` (403/429/503) holds the queue that long, capped at 30 s. 429 and
  `Retry-After` pass through to the caller unchanged, so the client's `pacedFetch` backs off.
- **A refusal of the server address** (upstream 403 or 429) is one log line in the owner's log —
  `openlibrary_refused {"status":…,"path":"…"}` — like `goodreads_blocked`, so a block is visible.
- **Failures**: Open Library unreachable → 502 `openlibrary_unavailable`; no answer in 12 s (under
  the client's 15 s) → 504 `openlibrary_timeout`; an answer over 2 MB is not passed on (502).
  The client reads all of these as "the function failed" and goes **direct to Open Library at 1
  request a second for the rest of the import** (`viaOwnServer`, web/app/data/openLibraryProxy.ts):
  a blocked server address must never stop an import. The same fallback covers 401 (a lapsed
  token) and a 429 that asks for more than a minute.
- **What does not go through here**: Apple (the import's other source), Search, the Book page's
  Change edition sheet, and every cover image. They talk to their hosts direct, as before.

```
cd supabase/functions/openlibrary
deno lint && deno check *.ts && deno task test      # recorded answers in fixtures/, nothing is fetched
supabase functions serve openlibrary --env-file <file with OPENLIBRARY_CONTACT=…>
```

Deploy: `supabase functions deploy openlibrary --no-verify-jwt` with the rest of the functions,
then `supabase secrets set OPENLIBRARY_CONTACT=…`. Turning the routing off: do not deploy the
function (or unset its secret) — the import then runs direct at 1 request a second, which is what
it can always fall back on — or take `viaOwnServer` back out of `importer()`
(`web/app/stores/import.ts`) and keep `pacedFetch(…, { gapMs: { 'openlibrary.org': 1000 } })`.

No cache table: the plan's optional step 2 (a `private.openlibrary_cache`, 7-day TTL, shared
across members) stayed out. Worth writing to openlibrary@archive.org about the use case (imports
on behalf of members, identified, paced): the owner's call.
