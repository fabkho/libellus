# Final security round, October 2026

A last security review and smoke test of everything that shipped after the social v1 security round (S1,
`docs/proposals/social-v1-contract.md`, "Security round S1"), on `origin/main` = **v1.9.1**. An assessment:
**no app code, migration or configuration was changed**; every fix below is a proposal with an owner model.
The repository is public as of 2026-10-10 and goes private again shortly before the public launch. Anything
found here has to be read as "already visible to anyone who cloned it".

Social V2a is gated by the social worker in its own session and is **out of scope**. Where a V1/V1.1 finding is
something V2a also touches, the finding says so (and section 8 lists them).

## 1. Summary

| Severity | Count | Findings |
|---|---|---|
| critical | 0 | |
| high | 0 | |
| medium | 8 | F1 to F8 |
| low | 16 | F9 to F24 |
| info | 9 | I1 to I9 |

Database: 54 pgTAP files, **1,954 assertions, all pass** (`supabase test db` on a fresh local stack at v1.9.1).
Edge functions: 5 functions, **107 Deno tests, all pass** (enrich 23, goodreads-rating 28, reading-page-og 15,
regal-export 23, waitlist-invite 18). No row-level-security bypass, no cross-member read, no write to
another member's data and no SSRF to a host of the attacker's choosing was found. What did turn up: three
integrity/privacy gaps in the Catalogue and Goodreads caches (F1 to F3), one cross-site write into a member's
device library (F4), and a repository that is public with no protection on `main`, no pinned actions and no
secret or dependency monitoring (F5 to F8).

### Fix before the public launch

| # | Finding | Sev | Effort | Model |
|---|---|---|---|---|
| F1 | A Catalogue Book's `cover_url` is unchecked outside social: a member can plant a tracking pixel every member's search results and Library load | medium | M | Sonnet |
| F2 | `goodreads-rating` lets one member write a wrong rating into the shared ISBN cache for 30 days | medium | S | Sonnet |
| F3 | Private Manual-book titles end up in `goodreads_title_ratings`, which every member can read | medium | S | Sonnet |
| F4 | A cross-site `POST /share` imports an attacker's EPUB into a signed-in member's device library | medium | M | Sonnet |
| F5 | `main` has no branch protection or ruleset | medium | M | Sonnet |
| F6 | Third-party actions are pinned by tag, not by SHA (25 `uses:`, 10 actions) | medium | S | DeepSeek |
| F7 | Dependabot alerts and updates, secret scanning, push protection and code scanning are all off | medium | S | DeepSeek (+ owner click-path) |
| F8 | Account-wide secrets are repo-level (readable by any workflow on any branch); `GIGET_AUTH` is in every PR job's env | medium | M | Sonnet |
| F9 | CSP is report-only and has no report endpoint: start collecting now, enforce after the soak | low | S to M | Sonnet |
| F12 | No `security.txt` / `robots.txt`; `/.well-known/*` falls back to the HTML shell | low | S | DeepSeek |
| F14 to F16 | Edge/RPC input bounds: unbounded `search_books` query, `goodreads-rating` body/log amplification, no per-member rate limit | low | S + S + M | DeepSeek, DeepSeek, Sonnet |
| F20 | Actions are allowed to approve pull requests | low | S | DeepSeek |
| F22 to F24 | Docs for a public repo: third-party data terms, "the repository is private" statements, a personal remark in `SPEC.md` | low | S | DeepSeek / Sonnet |

F8 only becomes exploitable with a second writer, but the fix is cheap before the next collaborator joins.

### Fix later

F10, F11 (what survives sign-out and a dead session), F13 (20 Apple covers on the sign-in page), F17 (unconstrained
Open Library keys, batch it with F1's migration), F18 (defence in depth in `reading-page-og`), F19 (dev-only
`pnpm audit` advisories), F21 (write-enabled deploy key). Info items I1 to I9 when the file is next touched.

### Accepted

| What | Why |
|---|---|
| The first member to add a Catalogue Book decides its **title, authors and description** for everyone (spoofing) | The Catalogue's trust model (S1 accepted it). Re-verified here: all of it renders as text, hostile `<img onerror>` / `<script>` titles did not run (area 3, row 3.16). The **cover** is not accepted: see F1 |
| Session in `localStorage` (supabase-js) | A script-injection would expose the refresh token; mitigated by no `v-html`, DOMPurify in the reader, and (once enforced) the CSP |
| `script-src 'unsafe-inline'` in the CSP | Inline theme-boot, import map and runtime config. Removing it needs a post-build hash step (F9 step 3, L) |
| `access-control-allow-origin: *` on the static site and on the edge functions | No cookies anywhere; every function authenticates with a bearer token or a shared secret, or answers public data |
| `/f/<token>` in the URL path (Cloudflare logs, link previews) | Accepted in S1 |
| A blocked account can tell "blocked" from "private" (S1) | Unchanged. Re-tested: the **blocked** side cannot tell a blocker from a non-existent member (area 1, row 1.19) |
| HSTS without `preload` | Owner's choice; `includeSubDomains` and one year are set |
| Goodreads' redirect following in `goodreads-rating` | The origin is fixed in code; only Goodreads' own redirects are followed |

## 2. Method and limits

- **Database (area 1)**: a throwaway local stack (copy of `supabase/` in `/tmp`, ports 55760 to 55769, own project
  id; stopped at the end; no other stack touched). Three real members created through the Auth admin API and
  signed in with a password grant; every attack is a direct PostgREST / RPC / Storage / functions call with the
  member's own access token (`docs/security/data/attack-scripts/`, output in `data/attack-transcripts.txt`).
  The grant inventory of all 179 functions in `public` and `private` is in `data/db-function-grants.txt`;
  the pgTAP run in `data/pgtap-run.txt`.
- **Edge functions (area 2)**: code read in full for auth, outbound URLs, logging and secrets; the local runtime
  (`supabase functions serve`) for the black-box checks; `deno task test` per function; one demonstration with the
  real handler and a stubbed Goodreads (`goodreads_isbn_poison_demo.ts`).
- **Web app (area 3)**: production, logged out, GET/HEAD only (about 14 requests); a local production build
  (`pnpm generate`, served on port 3101 with `web/e2e/serve.mjs`, which applies `_headers` like Pages) driven by
  Playwright with a throwaway account. Chromium only.
- **Supply chain (area 4)**: `pnpm audit`, `gh api` GET calls (names of secrets only, never values), full-history
  gitleaks on a mirror clone (the worktree's gitfile makes gitleaks scan nothing; checked with a canary).
- **Smoke test (area 5)**: production, logged out, Playwright Chromium (Pixel 7) and WebKit (iPhone 14), fewer than
  30 curl requests and about 5 page loads per browser. Screenshots: `/tmp/security-final/` and `.shots/` in the
  worktree (git-ignored; the key ones were opened with `orca file open`).

**What I could not test**, honestly: the hosted Supabase project (its Auth settings, rate limits, request-size
limits and function secrets: only the repository's `config.toml` and the local stack are checked); real iOS Safari
and Android Chrome (emulation only, so the `Sec-Fetch-Site` behaviour of an OS share intent in F4 is
unverified); a real `/f/<token>` and `/r/<token>` on production; the production service worker in a browser
with a signed-in member; hostile EPUBs beyond a code review; Cloudflare's own settings (WAF, rate limiting, TLS);
GitHub secret scopes and fork-PR behaviour (no second account); the hosted edge functions' behaviour for an 8 MB body.
No load or fuzzing was run anywhere. The earlier smoke test in the repository (`d034df14`) is a logged-in Android
emulator script, so there was no earlier logged-out production smoke to repeat; the route list from
`web/app/pages` was used instead.

Severity scale: **critical** (data of other members readable or writable, account takeover), **high**
(exploitable by any member with real impact), **medium** (exploitable, limited impact or needs a precondition
that will exist at launch), **low** (hardening, latent, or cost-only), **info**.

## 3. Area 1: database, attacked as signed-in members

Accounts: Ida, Max, Cleo (three members), plus anon. "No issue" means the attack was made and did not work.

| # | Item | How tested | Result | Sev |
|---|---|---|---|---|
| 1.1 | `search_books` (SECURITY DEFINER over `private.book_search`, #249): read another member's Manual book by word, prefix, ISBN-13 with hyphens, author | Max adds a Manual book (`add_manual_book`); Ida, Cleo, anon search by title word, a prefix, the ISBN, the author. Also direct `GET /books`, `GET /books?owner_id=eq.<max>` | Ida and Cleo: `[]` every time; anon: 401 `permission denied for function`; Max finds his own. REST `books` shows only own rows | no issue |
| 1.2 | `search_books` crafted tsquery input | 38 inputs: `'`, `"`, `a:*`, `*:*`, `!a`, `a & b \| !c`, `a <-> b`, `a <1> b`, `(a`, `a)`, `\`, `()`, `:*:*`, unicode (`ß`, `İ`, `日本`), `'; drop table books;--`, `null`, numbers, arrays | All 200 `[]` / own rows, no error leak. `book_search_query` builds the query with `quote_literal(word) \|\| ':*'` and `to_tsquery`, so operators are data. Only `\u0000` gives a 400 (`22P05`, harmless) | no issue |
| 1.3 | `search_books` with huge input | 1k, 5k, 20k, 100k distinct words; 500k repeated words | 13 ms, 13 ms, 124 ms, **2.9 s** (`max_stack_depth` 54001), **8.0 s** (`statement timeout`) | low (F14) |
| 1.4 | `search_books` limit and type handling | `p_limit` null, -5, 0, 1, 50, 51, 1e6, 2^31-1, `'abc'`; query as number / array / missing | Clamped to 1..50; wrong types are 400 `22P02` / 404 `PGRST202` | no issue |
| 1.5 | `search_books` search-path hijack | `has_schema_privilege` of `anon`/`authenticated` on `public`/`extensions` for CREATE (both false). As `authenticated` in psql: created temp tables `books` and `book_search` and a `pg_temp.ts_rank`, then called `search_books` | Still sees the real rows (names are schema-qualified; `pg_catalog` first). `create function public.evil()` -> `permission denied for schema public`. Only `pg_temp` is missing at the end of the path | no issue (I2) |
| 1.6 | EXECUTE grants and the `private` schema | Inventory of all 179 functions: `has_function_privilege` for `anon` and `authenticated`; REST with `Accept-Profile: private` / `cron`; `rpc/purge_cron_log`, `rpc/book_search_sync` | 115 SECURITY DEFINER functions in `public`/`private`, **all with a pinned `search_path`** (71 of them executable by `authenticated`, by design: they check `auth.uid()` inside); `anon` can run exactly 7 functions (`book_search_query`, `book_search_text`, `invite_code_status`, `join_waitlist`, `log_client_error`, `public_book_card`, `public_reading_page`: the intended public ones); no function in `private` is executable by either role; `private`/`cron` answer 406 `Invalid schema` (not exposed); `private.book_search` has RLS on, no policy, no grant | no issue |
| 1.7 | `books` is not writable by members | Ida `INSERT books` (owner null, owner = Max, owner = Ida), `PATCH` Max's / her own / a Catalogue Book, `DELETE` | All 403 `permission denied` (writes only through the RPCs). Manual books can't be turned into Catalogue Books, and the `owner_id is null or owner_id = uid` predicate in `search_books` matches `books_readable` | no issue |
| 1.8 | Trigger `private.book_search_sync` on huge titles | `add_manual_book` and `add_to_library` with titles of 10 KB, 200 KB, 2 MB, 5 MB, 60,000 words | All refused (`book_invalid` or check `books_title_present`, 500 characters), so no oversize tsvector reaches the trigger | no issue |
| 1.9 | `started_and_muted_series`, `muted_series_list` (#238, #255) | Ida finishes book 1 of "Alpha" and "Gamma" and mutes Gamma. Max and anon call `started_and_muted_series`, `muted_series_list`, `started_series_core`, `started_series_items` | Max `{"open":[],"muted":[]}`, `[]`; anon 401 for all four. Ida sees her two lists. All four are `SECURITY INVOKER` (they use `auth.uid()`) | no issue |
| 1.10 | Mutes can't be written or read across members | Max `GET /muted_series`, `INSERT` as Ida (real series id and nil uuid), `DELETE` Ida's row | `[]`, 403, 403. Only `mute_series` / `unmute_series` write | no issue |
| 1.11 | Parameters of the series functions | `p_limit` null, -1, 0, 1, 200, 201, 2^31-1; `p_language` null, `''`, `de'; drop table works;--`, 10,000 characters, `zz` | All 200, same 550-byte answer (limit clamped to 1..200; the language is only a lookup key) | no issue |
| 1.12 | `goodreads_title_ratings` (#240): write access | Ida `INSERT`, upsert (`merge-duplicates`), `PATCH`, `DELETE`; anon `GET` | 403 / 401 on all. Grants: `authenticated` SELECT only, `service_role` all | no issue |
| 1.13 | `goodreads_title_ratings`: constraints | Service-role inserts with a key without `\|`, a key over 1,000 characters, rating 6, `goodreads_id` `<img src=x>` | All `23514` check violations | no issue |
| 1.14 | `goodreads_title_ratings`: what members can see | Insert the row a Manual title produces (`zorbulax geheim tagebuch\|zorbulax`, `not_found`); Max reads the table and filters `ilike.zorb*` | Every signed-in member reads every key. The web app asks for Manual books too (`data/goodreads.ts`: no `source` test), so a **private Manual book's title and surname land in a table every member can read** | **medium (F3)** |
| 1.15 | Cache poisoning by ISBN (function + table) | Real `createHandler` with a stubbed Goodreads that does not know an ISBN but knows "Dune" (`goodreads_isbn_poison_demo.ts`): ask `isbn13=9780306406157, title=Dune, authors=[Frank Herbert]`, then ask the same ISBN as another member | The Dune rating is stored under the ISBN with `matched_by = 'title'`; the second asker gets it. Any member can pin any rating onto any ISBN for 30 days (7 for a miss) | **medium (F2)** |
| 1.16 | Catalogue content from members: `cover_url`, text | `add_to_library` (and `import_books` with `source: import`) with `cover_url` `javascript:alert(1)` and `https://evil.example/pixel.gif`, description `<img src=x onerror=...>`; then Max runs `search_books` | Stored as sent (`books.cover_url` has no check); Max's search returns `cover_url: https://evil.example/pixel.gif`. The web app puts it in `<img src>` unchanged (`coverSrc` -> `openLibraryCoverAt` passes other hosts through). The S1 host gate (`private.cover_shown`) only covers feed, profile, record and public pages: the public reading page returned `cover_url: null` for these Books (verified). Text renders as text (area 3, row 3.16) | **medium (F1)** |
| 1.17 | `import_books` with the new title index (no change of matching) | Cleo imports with Max's Manual book id (`book_id`), with `source: import` and the ISBN of Max's Manual book, and a `manual` row with the same title | `book_invalid`; a *Catalogue* Book is created from her own snapshot (by design, `source: import` keyed by ISBN); her own Manual copy. Max's Library unchanged. The index (`books_work_title_key` on `work_title_key(title)`) is a plain btree; the full `import_books` pgTAP files pass | no issue |
| 1.18 | `import_books` bounds | 101 rows; 2 MB review | `too_many_rows`; `review_too_long` | no issue |
| 1.19 | HTTP-code refusals (#247): no leak between "not found" and "not allowed" | Cleo is blocked by Max (after a request). Cleo calls `follow`, `member_profile`, `member_want`, `member_reading_record`, `withdraw_request`, `answer_request`, `remove_follower`, `unfollow` for a non-existent member, for the blocker and for a live stranger; also `follow_target` with the blocker's token and with garbage; Max `follow`s the blocked Cleo | **Byte-identical** status and body (`PT404 not_found` or `null`/204) for all three; response headers equal; median latency 1 ms for each (60 samples). `follow` PT429 limits come after the reachability check | no issue |
| 1.20 | Other refusals | `set_entry_hidden` (social) vs `start_reading`, `remove_from_library`, `update_progress`, `finish_reading`, `save_reader_place` on Ida's entry vs a non-existent entry, called by Max | Same body for foreign and non-existent (`entry_not_found`), so no leak. The non-social ones still answer **HTTP 500** (`P0002`), which #247 left out on purpose | info (I3) |
| 1.21 | Direct reads of `blocks` / `follows` | Cleo, Max, Ida `GET /blocks`, `/follows` | 403 on all (RPC only) | no issue |
| 1.22 | 1,000-row paging reads (#260): ordering can't leak rows; all-or-nothing | Ida has 1,108 entries, Max 1. `GET library_entries` without range (1,000 cap), `Range: 0-999`, `1000-1999`, `5000-5999`, `limit=100000`, `order=...;drop`, `order=books(owner_id)`, Max with `Range: 0-999`, anon | Pages 1,000 + 108, 1,108 unique ids, `416 PGRST103 "only 1108 rows"` (own count only), `limit` capped at 1,000; Max sees his 1; anon 401; bad `order` is ignored or 400. `allPages` returns `error` and **no rows** on the first failed page, stops on a short page and the order ends with the unique `id` (read in `data/paging.ts`; unit tests exist). RLS filters before ordering and paging, so order and offset cannot reach another member's rows | no issue |
| 1.23 | `purge-cron-log` job and cron privileges | `cron.job` rows; `private.purge_cron_log` grants; `pg_proc` flags | 8 jobs, all run as `postgres`, commands are plain `select` calls with no embedded secret. `purge_cron_log` is `SECURITY INVOKER`, `search_path = pg_catalog`, revoked from `public`/`anon`/`authenticated`, scheduled 03:15 UTC. `cron.job` and `cron.job_run_details` are granted to `PUBLIC` (pg_cron's default) but `anon`/`authenticated` have no `USAGE` on schema `cron`, and it is not an exposed schema | no issue |
| 1.24 | The new indexes (no effect on RLS) | Read the migrations: `books_work_title_key` (btree on an immutable function), `book_search_words` (GIN, in `private`), the foreign-key indexes of `20261018020000`, the follower keyset index | Indexes do not change what a policy returns. `books_search` (the old expression index) was dropped; the `lints_test` and `unindexed_foreign_keys_test` pgTAP files pass | no issue |
| 1.25 | Direct table surface | `rowsecurity` for all 34 tables in `public`; Storage `bucket` / `object/list/avatars` as Ida; GraphQL | 34 of 34 have RLS enabled; storage lists return `[]`; pg_graphql is not enabled. The local PostgREST root returns the OpenAPI document to anon, **production returns 401** (area 5, row 5.14) | no issue (I7) |
| 1.26 | Catalogue keys flowing into server requests | Constraints on `books`, `works`, `series`, `authors` | `apple_id`, `isbn13/10` and all Wikidata / Open Library ids of works, series and authors are format-checked; **`books.openlibrary_edition_key`, `books.openlibrary_work_key` and `books.cover_url` are not**. A member stored `../../search.json?q=libellus&limit=1#` as an edition key through `add_to_library`; the `enrich` function puts it into `https://openlibrary.org/books/${key}.json` | low (F17) |
| 1.27 | Invite codes | Read `create_invite_code`, `invite_code_status` | Generated codes are 8 characters of a 32-letter alphabet (40 bits) from `gen_random_bytes`; `invite_code_status` is an anon oracle (valid / expired / exhausted / invalid) but guessing is not feasible at that entropy. Owner-chosen codes (`LIBELLUS-DEV` style) are weak by construction | no issue (I8) |
| 1.28 | pgTAP, full suite | `supabase test db` on the fresh stack | `Files=54, Tests=1954, Result: PASS` | no issue |

### F1. A Catalogue Book's cover is a tracking pixel for every member, outside the social surfaces (medium)

`catalogue_book_for` (behind `add_to_library`) and `import_books` with `source: import`
store the `cover_url` the first member sent; every member who later searches the Catalogue (`search_books`), adds the
Book or has it in her Library gets that row. S1 added the host list (`private.cover_shown`: `covers.openlibrary.org`,
`books.fabkho.dev`, `*.mzstatic.com`) to the places that hand a Book to *someone else's followers and visitors* only.
The in-app reads (`library_entries` -> `books(*)`, `search_books`, Home, the book page) still hand over any URL, and
`web/app/utils/cover.ts` passes any host through to `<img src>`. Result: a member who creates a Book (with an unused
Apple id or ISBN) with `cover_url = https://attacker/pixel.gif?...` sees the IP address, user agent and time of every
member who later looks at that Book, and can swap it for any image of her choice (spoofed covers). The CSP
(`img-src ... https:`) would not stop it. A `javascript:` URL was stored too (inert in `<img src>`).
**Fix**, one migration with pgTAP, in the order of the code paths: (1) a function `private.cover_allowed(text)` with the
`cover_shown` regex and a `CHECK (cover_url is null or private.cover_allowed(cover_url))` on `books` added `NOT VALID`
(the immutable function is allowed in a check), then `UPDATE books SET cover_url = null, cover_thumbhash = null,
cover_dominant = null, cover_secondary = null WHERE NOT allowed`, then `VALIDATE CONSTRAINT`; (2) `catalogue_book_for` and
`import_books` drop a disallowed `cover_url` (and its thumbhash and colours, which go together) instead of failing the add; (3) the
client's `coverSrc` returns null for a host off the list (belt and braces, and it protects against rows written
before the migration). The own-edition and Manual cover paths keep working: a Manual Book's cover is private to its
owner and is excluded by the `source = 'manual'` branch, as `cover_shown` already does. Effort M, model Sonnet.
V2a: every V2a function that returns a Book to someone else must keep calling `private.cover_shown`.

### F2. The ISBN cache can be poisoned by any member (medium)

`goodreads-rating` looks a Book up by its ISBN first and falls back to the title search when Goodreads does not know the
ISBN, then stores the answer under the **ISBN** (`goodreads_ratings`, `matched_by = 'title'`). The title and authors
come from the caller, so a member can name any ISBN together with the title and author of a different, well-rated book
and every member's Book with that ISBN shows that rating, count and Goodreads link for 30 days (a miss: 7). It is a display
cache with no member data, but it is a shared integrity bug and it reaches the `goodreads_rating(books)` relation the
Library reads. **Fix**: in `handler.ts` store a title-fallback answer **only under the title key**, never under the ISBN
(`lookUp` returns `matchedBy`; `put` for the ISBN key only when `matchedBy === 'isbn'` or the answer is a miss for the
ISBN lookup itself), and add a handler test for the case above; optionally purge `goodreads_ratings` rows with
`matched_by = 'title'`. Effort S, model Sonnet.

### F3. Private Manual titles reach a table every member can read (medium)

`data/goodreads.ts` asks for any Book "with an ISBN or a title and an author", the Manual book included, and the
function caches a miss or a hit under `title_key = <normalised title>|<surnames>` in `goodreads_title_ratings`, which
has `select using (true)` for `authenticated`. Any signed-in member can `GET /rest/v1/goodreads_title_ratings` and read
the title and author surnames of every Manual book any member has opened (no member id, but the text is the secret:
"a Manual book is private to its owner"). The title and surname also go to Goodreads as the search query, which is
by design. **Fix**: (1) migration: `revoke select on public.goodreads_title_ratings from authenticated` and drop the
policy (the only reader is the function, which uses the service role; check `goodreads_rating(books)` only reads the
ISBN table), and purge the rows of Manual titles that are already there (`delete ... where title_key in (select ...)`
cannot be exact, so truncate the table, it refills on demand); (2) client: don't ask for `source === 'manual'` Books
by title (an ISBN of a Manual book is public catalogue data and may still be asked). Effort S, model Sonnet. Do the
same review for any V2a "what my friends read" surface that could expose a Manual title.

## 4. Area 2: edge functions

Every function in `supabase/functions/*`, with what it authenticates, fetches, logs and reads from the environment.

| Function | `verify_jwt` | Authentication in the function | Fetches (outbound) | Logs | Secrets / env it reads |
|---|---|---|---|---|---|
| `goodreads-rating` | **false** | Bearer: the service-role key (string `===`) or a signed-in member's token (`auth.getUser`); anon key and garbage get 401 | `www.goodreads.com` only: `book/review_counts.json?isbns=<isbn13>` and `book/auto_complete?format=json&q=<title surname>`, both `encodeURIComponent`, `redirect: follow`, 3 s timeout, 1 request/s per instance with a queue that answers `busy` (503) when the wait would exceed 4 s | `goodreads-rating: <cache key> failed: <error>` (the cache key contains the **member-supplied** title and surnames) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LIBELLUS_SITE_URL` (User-Agent) |
| `enrich` | **false** | Bearer: service key or `ENRICH_TOKEN` (`===`, pg_cron's call) = `service`; a signed-in member's token = `member` (only actions `book` and `author`; `drain`, `backfill`, `remap`, `status` answer 403 for members) | Apple iTunes lookup, Open Library (`/isbn`, `/books/<key>`, `/works`, `/authors`, `/series`, search, covers), Wikidata API and SPARQL (ids are format-checked in the DB), Wikimedia; `redirect: follow`, per-request timeout, retries on 429/5xx | `enrich: <book id> failed: <error>`, `enrich: author <id> failed` | `SUPABASE_URL`, service key, `ENRICH_TOKEN`, `ENRICH_LANGUAGES`, `LIBELLUS_SITE_URL`, `ENRICH_CONTACT` |
| `regal-export` | **false** | Bearer: `REGAL_EXPORT_TOKEN`, **constant-time** (SHA-256 of both sides, `crypto.subtle`); GET/HEAD only | The configured "published file" URL (`REGAL_CARRY_ART_URL`, an env value, never request input), 15 s timeout | Counts, validation errors, `owner_not_found` (no titles, no addresses) | service key, `REGAL_EXPORT_TOKEN`, `REGAL_OWNER_EMAIL`, `REGAL_OWNER_NAME`, statuses, time zone, carry-art URL |
| `reading-page-og` | **false** | None: public by design, a 22-character token (and optional Book id) in the query decides; an invalid token or Book id answers 404 like an unknown one. It calls the two anon RPCs (`public_reading_page`, `public_book_card`) with the **anon** key | The `cover_url` of the Books those RPCs return (https only, `redirect: follow`, 2.5 s, 5 MB cap). The RPCs return `null` for any host off the `cover_shown` list (verified: a page with an `evil.example` cover returned `cover_url: null`) | `reading-page-og: card <book id> failed: <error>` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`; fonts from disk |
| `waitlist-invite` | **true** | Gateway JWT, then the function forwards the caller's own `Authorization` to the database, which decides whether she is the owner (`owner_waitlist_prepare_invite`); no service-role key in the function | SMTP server (`SMTP_*`) | Failure *kind* only, never the address or the code | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SMTP_*`, `LIBELLUS_SITE_URL` |

CORS: `goodreads-rating`, `enrich`, `reading-page-og`, `waitlist-invite` answer `access-control-allow-origin: *` with the
usual headers; `regal-export` has no CORS (server-to-server). All authentication is by header, no cookie, so the wildcard
gives no extra reach. Locally Kong answers `OPTIONS`; on production the five preflights were seen from outside (area 5, row 5.15).

| # | Item | How tested | Result | Sev |
|---|---|---|---|---|
| 2.1 | Authentication of `goodreads-rating` | No header, anon key as bearer, garbage bearer, tampered member token, `PUT`, service key | 401 `unauthorized` for the first four, 405 `method_not_allowed`, service key accepted (by design); error bodies are `{"error": "<code>"}` only, no stack or upstream text | no issue |
| 2.2 | SSRF through title / ISBN into the upstream URL | Read `goodreads.ts` (`GOODREADS_ORIGIN` + `encodeURIComponent`); ISBN must pass `isValidIsbn13` (13 digits, check digit); sent `isbn13` = `9780306406157&isbns=1#`, an object, a title with `http://169.254.169.254/...` | The host and path are fixed in code; `&`, `#`, `/`, `@` in a title or ISBN are percent-encoded or refused (400 `isbn_invalid`). No attacker-chosen host or path | no issue |
| 2.3 | Rate limit, queue, `busy` | Code review of `client.ts` (`MIN_INTERVAL_MS` 1000, `MAX_WAIT_MS` 4000) | The limit is **per instance, not per member**: one member can fill the 4 s queue so everyone else's book page sees 503 `busy`, and can fill the cache with junk at up to one row per second per instance (no purge exists for the Goodreads tables) | low (F16) |
| 2.4 | Input size | POST with an 8 MB `authors[0]` | `authors` is cut to 10 entries and the title to 500 characters, but **each author is unbounded**: 7.3 s, 502, and the 8 MB cache key was written to the function log **twice** (16 MB log). A key over 1,000 characters also fails the DB check, so the write fails on every repeat and every repeat goes upstream. Hosted request-body limits not testable | low (F15) |
| 2.5 | Error bodies | All error paths of the five handlers | Fixed codes only (`unauthorized`, `busy`, `goodreads_unavailable`, `enrich_failed`, `export_invalid` with validation messages, `render_failed`); no stack to the client | no issue |
| 2.6 | Token comparison | Code review | `regal-export` compares in constant time; `goodreads-rating` and `enrich` use `===` on the service key and `ENRICH_TOKEN` | info (I1) |
| 2.7 | `enrich` member actions | Code review | `book` (UUID-checked, queued by a DB function) and `author` (key) are open to any member with no rate limit and a shared upstream User-Agent: a member loop can burn the Apple/Wikidata/Open Library budget | low (F16) |
| 2.8 | `enrich` upstream URL parts | Code review + 1.26 | Open Library path pieces come from `books.openlibrary_edition_key` (unchecked, F17); SPARQL ids are `Q\d+` (checked). The host never changes | low (F17) |
| 2.9 | `reading-page-og` SSRF | Code review + live check of the RPC | Reachable URL space is the `cover_shown` allow-list, enforced in the database. The function itself trusts that and follows redirects | low (F18) |
| 2.10 | `regal-export` | Code review, 23 tests | Constant-time secret, GET/HEAD only, `statuses` allow-listed, no member input reaches a URL | no issue |
| 2.11 | `waitlist-invite` | Code review, 18 tests | JWT at the gateway, owner check in the database under the caller's own session, mail failure never logs the address or the code | no issue |
| 2.12 | Deno tests | `deno task test` in each of the five functions | 107 passed, 0 failed | no issue |

### F14. `search_books` has no bound on the query length (low)
Any member can send a 0.5 MB query: 8 s of CPU until the `authenticated` statement timeout, every call (1.3). It
predates #249 (the old body behaved the same). **Fix**: in `search_books` start with `p_query := left(p_query, 200)` (the app
never sends more), keep the ISBN check on the shortened value, add a pgTAP line. Effort S, model DeepSeek.

### F15. `goodreads-rating`: unbounded author strings and log amplification (low)
**Fix**: reject a body over 16 KB (`Content-Length` and a bounded read); cut each author to 200 characters and the title
key to 400 before the lookup; log `keyId` truncated to 120 characters; answer a key that fails the DB check without
asking upstream. Effort S, model DeepSeek (with F2's test).

### F16. No per-member limit on `goodreads-rating` and `enrich` (low)
**Fix**: a small per-member counter (a `private` table, or the in-memory map per instance keyed by user id): 20 lookups a
minute per member for `goodreads-rating`, 10 `book`/`author` calls a minute for `enrich`; answer 429. Optionally refuse cache
writes for a miss when the member's own Library has no Book with that ISBN. Effort M, model Sonnet.

### F17. Open Library keys on `books` are unconstrained (low)
**Fix**: `CHECK (openlibrary_edition_key ~ '^OL[1-9][0-9]{0,11}M$')`, the same with `W` for `openlibrary_work_key`, both
`NOT VALID` then validated after nulling the odd rows; and `editionKey()` / `workKey()` (already in `openlibrary.ts`)
applied to the key before the URL is built in `enrich`. Batch with F1's migration. Effort S, model DeepSeek.

### F18. `reading-page-og` follows redirects and has no host list of its own (low)
**Fix**: in `loadCover` check the host against the same allow-list as `cover_shown` and use `redirect: 'manual'` (an
allow-listed host that redirects is treated as "no cover"). Effort S, model DeepSeek.

## 5. Area 3: the web app as shipped

Production headers are the same on every response (`curl -I` of `/`, a JS asset, `/sw.js`, the manifest, `/f/x`, `/r/x`).

| # | Item | How tested | Result | Sev |
|---|---|---|---|---|
| 3.1 | HSTS | `curl -I` | `max-age=31536000; includeSubDomains`, no `preload` | no issue (accepted) |
| 3.2 | `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` | `curl -I`, `web/public/_headers` | `nosniff`, `strict-origin-when-cross-origin`, `DENY` (+ `frame-ancestors 'none'`), `camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()` | no issue |
| 3.3 | COOP / COEP | Reviewed | Not set, not needed (no cross-origin isolation use; `window.open` uses `noopener,noreferrer`) | no issue |
| 3.4 | Cookies | Response headers, `document.cookie` signed in and out, Playwright cookie jar | No `Set-Cookie` anywhere; the session is in `localStorage` | no issue |
| 3.5 | CSP: enforce now? | Header comparison (`_headers`, `functions/r/[[path]].js`, production); 0 violations across a local signed-in run (sign-in, follow link, Library, book, add ebook, open the reader, profile, sign-out) and 0 in Chromium logged out; WebKit prints "report-only ... no `report-to`" on every page | Report-only, no endpoint, so nobody collects violations. **Worth enforcing**, after the soak of issue #142. What it blocks once enforced: third-party scripts, styles, frames and objects, `<base>` injection, off-site form posts, framing, and `connect-src` exfiltration to hosts off the short list. What it does **not** block: inline-script injection (`script-src 'unsafe-inline'`: theme boot, import map, runtime config) and image beacons (`img-src https:`). What could break and was **not** driven: the barcode scanner (WASM, `'wasm-unsafe-eval'` present), the Regal shelf, reader Translate/Define (hosts are listed), avatar preview, the Cloudflare Web Analytics beacon (prod only, hosts listed), WebKit's handling of `blob:` frames | low (F9) |
| 3.6 | Service worker scope and cache contents | `nuxt.config.ts` `pwa.workbox`, cache listing after a signed-in session | Scope `/`; caches: `workbox-precache-v2` (static assets and shells), `libellus-covers` (cover image URLs), `libellus-portraits`, `libellus-reader`. **No Supabase, auth, Storage or avatar response is cached** (no runtime route for them); `/r/*` is excluded from the navigation fallback | no issue |
| 3.7 | `libellus-reader` CacheFirst rule (#266) | Read the rule (`/\/_nuxt\/ebook-reader[^/]*\.(js\|css)$/`, 6 entries) and the cache after opening the reader | Only `ebook-reader.<hash>.js/.css` and `ebook-reader-entry.<hash>.js`, same-origin static chunks. The pattern matches by path only (no origin test) and a foreign script is blocked by `script-src 'self'` once the CSP is enforced | info (hardening in F9) |
| 3.8 | Sign-out clears device data | Code (`stores/session.ts`, `data/localData.ts`) and a Playwright run: before, `libellus.{genres,collections,enrich,library,descriptions,feed,linkTemplates,stats,ebooks}`, IndexedDB `libellus@3`, OPFS `ebooks`; after sign-out | After: `libellus:whatsNew` only, database deleted, OPFS empty, `/sign-in` shown, Back stays on `/sign-in` | no issue |
| 3.9 | What survives sign-out | Same run | `libellus-covers` and `libellus-portraits` caches (cover URLs the member browsed, including search results) and the `workbox-expiration` IndexedDB (URL + timestamp); by code, the keys `libellus-import-hint` and `libellus-library-view` (keyed by member id, outside the `libellus.` prefix) | low (F10) |
| 3.10 | Expired or revoked session | Revoked server-side (`logout?scope=global`) and aged `expires_at`, reload `/library`, also offline | Redirected to `/sign-in`, no data shown. But `libellus.library` (with the member's e-mail), genres, descriptions, ebook metadata, the outbox and the OPFS files stay on the device: `forgetDevice` runs only on an explicit sign-out or account deletion | low (F11) |
| 3.11 | Sign-in guard (F1, #262): auth bypass by route, deep link, redirect | Logged out, `goto` of `/library`, `/profile`, `/book/abc`, `/friends/<uuid>`, `/share?url=javascript:...`, `//evil.com`, `/\evil.com`, `/%2F%2Fevil.com`, `/https://evil.com`, `/verify?...`; code read of `middleware/auth.global.ts` and `utils/signedOutRoute.ts` | All ended on `/sign-in`, no page data fetched. Only `/sign-in`, `/sign-up`, `/verify` and `/r/*` are public. The `knownSignedOut` shortcut only reads markers and grants nothing (data is behind RLS) | no issue |
| 3.12 | Open redirect | 13 probes with `redirect`, `returnTo`, `next`, `//evil.com`, `https://evil.com`, `javascript:`, `/\evil.com`, `%2F%2F`, `%5C` on `/sign-in` and `/verify`; grep for any redirect parameter | No redirect parameter is read anywhere; `navigateTo` only gets constants or `/f/<22-char token>` | no issue |
| 3.13 | `/f/<token>` logged out, sign-in, back | Token kept in `libellus.pendingFollow` (1 h TTL, validated `^[A-Za-z0-9_-]{22}$`), signed in through the UI | Landed on `/f/<token>`; a well-formed unknown token resolves to "missing". Referer carries only the origin. A real token was not tested | no issue (partial) |
| 3.14 | XSS: `v-html`, `innerHTML`, `srcdoc`, `eval` | grep over `web/app` and `web/functions` | **0 `v-html`**. Only vendored foliate-js templates (behind the sanitiser) and one static probe `srcdoc` | no issue |
| 3.15 | Reader sanitiser | `data/reader/markup.ts`; Moby Dick fixture rendered | DOMPurify with `FORBID_TAGS` (script, iframe, object, embed, base, form, foreignObject), `ALLOWED_URI_REGEXP` (http(s), mailto, tel, blob), `<meta http-equiv>` stripped, CSS `url()`/`@import` rewritten, then a per-page CSP meta (`connect-src 'none'`, `img-src blob: data:`). External links only http/https with `noopener,noreferrer`. Hostile EPUB corpus **not** run | no issue (code review) |
| 3.16 | Titles, authors, descriptions from Apple, Open Library, members, other members' Catalogue text | A Manual book titled `<img src=x onerror="window.__xss=1"><svg onload=...>`, author `"><script>window.__xss=3</script>`, viewed on `/library`, the book page, `/`, `/profile` | Rendered as text, `window.__xss` stayed undefined. The Catalogue-text trust risk is **spoofing, not XSS** (accepted, see section 1) | no issue |
| 3.17 | `href` / `src` from data | grep; `data/linkTemplates.ts`; DB checks | `cover_url` only goes to `<img src>` (F1 covers the tracking aspect); link templates are validated `https?://` on both sides; credits come from the enrich function (not traced server-side); `Goodreads.vue` encodes the id | no issue |
| 3.18 | `target="_blank"` and `window.open` | grep of all three template sites and the reader | All carry `noopener` / `noreferrer` | no issue |
| 3.19 | `postMessage` | grep | No window `postMessage`; the service worker -> client message (`stores/sync.ts`) and worker channels are same-origin | no issue |
| 3.20 | `localStorage` contents | Inventory after sign-in | The Supabase session (tokens and user object with e-mail), `libellus.*` caches (member id, e-mail in `libellus.library`, Library/stats/feed). No third-party token, no password | no issue |
| 3.21 | Manifest, TWA, `assetlinks.json` | Production manifest and `curl` of `/.well-known/assetlinks.json` | `scope /`, `id /`, `start_url /`, no `related_applications`, no TWA shipped; `assetlinks.json` returns the HTML shell (nothing to check). `share_target` is a `POST /share` multipart (see F4) | no issue |
| 3.22 | Source maps and secrets in the bundle | Greps over `.output/public` for JWTs, `sb_publishable_`, `sb_secret_`, `service_role`, `sk-`, `AKIA`, `ghp_`, private keys | No `*.map`, no `sourceMappingURL`, only the publishable key I supplied; **no secret or service-role key** | no issue |
| 3.23 | Link-preview function `/r/*` | Code (`functions/r/[[path]].js`) and production | `escapeHtml` for `& < > " '`, validated token and Book id, 404 with `no-store` and `x-robots-tag: noindex` for others | no issue |
| 3.24 | `POST /share` (share target) | Playwright: a page on another origin submitted a multipart form with `planted.epub` to `/share` while signed in | The service worker (`sw-share.js`) answers **any** same-origin-URL POST, stores the file in Cache Storage and 303s to `/share?ebooks=<id>`; `pages/share.vue` then imported it **without a prompt** (a library record `PLANTED BY ATTACKER`; `.shots/app-planted-share.png`). Signed out, the file waits and is imported at the next sign-in | **medium (F4)** |

### F4. Cross-site `POST /share` plants an EPUB on a signed-in member's device (medium)

Impact: an attacker-controlled EPUB (title, cover, text, outbound links) appears in the member's device library, and
there is no size or count cap, so storage can be filled. No data is read, sent or overwritten; the reader sanitises the
content. It needs the member to be signed in (or sign in later) and to visit any attacker page (a form that posts to
`https://libellus.fabkho.dev/share`). **Fix**: (1) in `sw-share.js` and `functions/share.js` refuse a POST whose
`Sec-Fetch-Site` is `cross-site` or `same-site` (an OS share intent arrives as `none`; **must be verified on a real
Android Chrome/Edge install, which I could not do**); (2) independent of that, make the take-in explicit:
`share.vue` lists the file names and sizes and asks "Add N ebook(s) shared to Libellus?", with a cap (20 files, 100 MB
each). Effort M, model Sonnet (the header check alone is DeepSeek, S).

### F9. CSP: collect, then enforce (low)
Steps: (1) ship the `/csp-report` endpoint and `Reporting-Endpoints` of issue #142 and put the CSP string in **one**
constant used by `_headers` and `functions/r/[[path]].js` (it is duplicated today); (2) after one or two quiet weeks
rename the header to `Content-Security-Policy`; (3) later, hash the inline scripts in a post-build step and drop
`'unsafe-inline'` from `script-src` (L, Opus). Also add `url.origin === self.location.origin &&` to the `urlPattern` of the
`libellus-reader` and `libellus-barcode-decoder` rules. Effort S to M for 1 and 2, model Sonnet.

### F10, F11. Device data after sign-out and after a dead session (low)
F10: in `data/localData.ts` `clearLocalFiles` also `caches.delete('libellus-covers')` and `'libellus-portraits'`, drop the
`workbox-expiration` database, and move the two non-prefixed member-keyed keys under `libellus.` (or add them to the clear
list). Effort S, DeepSeek. F11: when GoTrue reports a **definitive** failure (`refresh_token_not_found`, `invalid_grant`,
a `SIGNED_OUT` the member did not cause) call `forgetDevice()`; not on transient or offline errors, and warn first when the
outbox still holds writes (the offline-first tension that explains today's behaviour). Effort M, model Sonnet.

## 6. Area 4: supply chain and repository hygiene

| # | Item | How tested | Result | Sev |
|---|---|---|---|---|
| 4.1 | `pnpm audit --prod` and `pnpm audit` in `web/` | pnpm 12.6.0; both runs print the same 6 advisories (`nuxt` is a dependency, so its toolchain counts as prod) | **2 critical, 4 high**, 0 moderate/low: `simple-git` (3 advisories) and `@simple-git/argv-parser` (via `@nuxt/devtools`, fix in 4.0.1 / 2.0.1), `node-forge` (via `listhen`, no patch) and `braces` (build-time globbing, no patch). **None is in the shipped app** (`ssr: false`, static output; DevTools only in `nuxt dev`); exposure is developer machines and CI | low (F19) |
| 4.2 | Other package manifests | `git ls-files` for `package.json` and lockfiles; `pnpm audit` in `design/` | Only `web/` and `design/` have a manifest; `design/`: no known vulnerabilities. No git or tarball dependencies in the lockfile; only lifecycle hook `postinstall: nuxt prepare`; `allowBuilds` only `esbuild` | no issue |
| 4.3 | Renovate / Dependabot | `.github` listing, `gh api` vulnerability-alerts, automated-security-fixes | No `dependabot.yml`, no `renovate.json`; alerts and security updates are **disabled** | medium (F7) |
| 4.4 | Security settings | `gh api repos/fabkho/libellus` (`security_and_analysis`), code scanning, private vulnerability reporting | Secret scanning, push protection, non-provider patterns, validity checks, Dependabot security updates: all **disabled**; no code scanning; private vulnerability reporting **enabled** (so `SECURITY.md` works); forking allowed | medium (F7) |
| 4.5 | Pinned actions | `grep uses:` over `.github/` | 25 `uses:` of 10 actions, **all by mutable tag, none by SHA**; `sha_pinning_required` is false. Highest risk: `googleapis/release-please-action@v5` (job with `contents`, `pull-requests`, `issues: write`) and `supabase/setup-cli@v3` (runs beside the Supabase token in the release job). The full list with today's SHAs is in F6 | medium (F6) |
| 4.6 | Workflow permissions | Read all 4 workflows and the composite action | Default token `read`; `ci.yml` per-job `contents: read`; `e2e.yml` top-level `contents: read`; `release.yml` top-level `{}` and per job (release-please write, deploy `contents: read`); `backup.yml` `contents: read`. Least privilege holds | no issue |
| 4.7 | `pull_request_target`, `workflow_run`, `issue_comment`, script injection | Read the triggers and every `${{ }}` in a `run:` | None of the three triggers. The only `${{ }}` in scripts are `steps.browsers.outputs.cache-hit` and `matrix.shard`/`job-total`; other values go through `env:`. `inputs.tag` is regex-checked (`^v\d+\.\d+\.\d+$`) before use | no issue |
| 4.8 | Secrets to fork PRs | Triggers, `fork-pr-contributor-approval` | `pull_request` only (no secrets for forks); `all_external_contributors` need approval; CI builds "without Regal" for forks | no issue |
| 4.9 | Secrets scope | `gh api actions/secrets` (names), environments | Repo-level: `SUPABASE_ACCESS_TOKEN` (account-wide), `SUPABASE_DB_URL`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `GIGET_AUTH`. In the `production` environment: `PRODUCTION_DEPLOY_KEY`, variable `SUPABASE_PROJECT_REF`. `GIGET_AUTH` (reads the private `fabkho/regal`) is a workflow-level `env:` in `ci.yml` and `e2e.yml`, so `pnpm install` and tests of **any same-repo PR** see it | medium (F8) |
| 4.10 | Release job, deploy key, environment | `gh api environments`, deploy keys, `release.yml` | One `production` environment: branch policy `main` only, **no required reviewers**, admins can bypass; deploy checks that the tag is an ancestor of `origin/main` and only moves forward. The repo deploy key is ed25519 and **write-enabled for the whole repo** | low (F21) |
| 4.11 | Branch protection on `main` | `gh api .../branches/main/protection` and `.../rulesets` | `404 Branch not protected`, rulesets `[]`. A collaborator with write access could push to `main`, force-push, delete branches, edit workflows, and (since the `production` environment trusts `main`) reach the environment secrets; "merging the release PR deploys" is only a convention. Today the only collaborator is the owner | medium (F5) |
| 4.12 | Actions may approve PRs | `gh api actions/permissions/workflow` | `can_approve_pull_request_reviews: true` (no workflow uses it) | low (F20) |
| 4.13 | Self-hosted runners, webhooks | `gh api actions/runners`, `hooks` | None, none | no issue |
| 4.14 | CODEOWNERS, SECURITY.md | Files and `ISSUE_TEMPLATE/config.yml` | No CODEOWNERS (not needed with one maintainer; useful once a ruleset exists). `SECURITY.md` points at private vulnerability reporting, which is enabled; no fallback e-mail or response time | no issue (I9) |
| 4.15 | Licence | `LICENSE`, `web/package.json`, `design/package.json`, `foliate-js` notes | **MIT**, (c) 2026 Fabian Kirchhoff, detected by GitHub. With MIT anyone may copy, sell and fork the code, and MIT grants no trademark right to the name "Libellus". Without a licence the repo would be all rights reserved (viewable and forkable on GitHub only). Fonts are OFL (texts shipped), foliate-js MIT and zip.js BSD-3 are recorded. The Regal shelf is a separate private layer | no issue |
| 4.16 | Data terms of third parties | README, `goodreads-rating/README.md`, fixtures | Nothing states the terms of Apple / Open Library / Wikidata data or that the Apple and Open Library fixtures are test-only recordings; `goodreads-rating` reads Goodreads' public endpoints server-side (no API; their terms forbid automated access) | low (F22) |
| 4.17 | Stale statements | grep | "the repository is private" in `CONTRIBUTING.md:3`, `README.md:104,137`, `backup.yml:9`, `ci.yml:15`, `docs/TESTING.md:480` | low (F23) |
| 4.18 | gitleaks on the full history | `gitleaks git` on a mirror clone (all refs, 1,345 commits) and `--no-git` on the working tree; validated against a canary repo (2 findings reported) | **0 findings** in both. No `.env`, keystore, `.pem`, `google-services.json` or service-account file was ever added (only `.env.example`) | no issue |
| 4.19 | Docs that should not be public | grep of `docs/`, `scripts/`, README, `supabase/` and `git log -S` for project ref, account ids, e-mail, IPs, SMTP, backup paths | No secret and no real member data anywhere. Identifiers only: the public host `libellus.fabkho.dev`, the Pages host, `books.fabkho.dev`, the R2 buckets `libellus-backups` and `portfolio-books`, the private repo name `fabkho/regal`, Resend as the SMTP processor, `eu-central-1`, and **the production Supabase project ref** (`docs/OPERATIONS.md:75,440`, `scripts/restore-backup.sh:32`; in 3 commits of the history, so it stays visible to every clone anyway). The ref is not a secret: it is the subdomain of the project URL that the shipped site's runtime config hands to every visitor. **I would not move any of these**: the restore script *needs* the ref as the guard that refuses to restore into production, and the bucket names are useless without the R2 keys and the age private key. Security rests on RLS and the keys, not on the ref being unknown; but it does mean the project's other public surfaces (`db.<ref>.supabase.co`, Auth, Storage) are findable: check in the dashboard that direct database connections require SSL and a strong password, and that network restrictions are used if available (hosted settings, not testable). `scripts/perf/screens.mjs` holds the Supabase CLI's public demo key. Scrub `SPEC.md:4` (F24) | low (F24) |
| 4.20 | Tracked agent config | `git ls-files .pi` | `.pi/mcp.json` (no credential) enables the Cloudflare and Supabase MCP servers for anyone's agent who opens the repo | low (F24) |

### F5. Protect `main` (medium)
Ruleset on `main`: require a pull request (0 approvals while solo, 1 once a second maintainer exists, with "require review
from code owners"), require the three checks (`what changed`, `database rules`, `tokens, web build and edge functions`;
`ci.yml` documents that a skipped job counts as a pass), block force-push and deletion, **no bypass for admins**, and add a
`CODEOWNERS` for `.github/**`, `supabase/migrations/**` and `scripts/**`. A second ruleset on `production`: only the deploy key
may update it (the rollback path uses `--force-with-lease` with that key, so it is a bypass actor there and **not** on `main`).
release-please's PR is opened with `GITHUB_TOKEN` and so runs no CI: leave the checks non-required for `release-please--*`
or give it a PAT/App, to settle when enabling. Effort M, model Sonnet.

### F6. Pin the actions (medium)
Pin every `uses:` to the 40-character commit and keep the tag as a comment, let Dependabot's `github-actions` ecosystem
bump them, then switch on "Require actions to be pinned to a full-length commit SHA" (`sha_pinning_required`). SHAs resolved
on 2026-10-10 (check again before pinning):

| Action | Tag | SHA | Used |
|---|---|---|---|
| `googleapis/release-please-action` | v5 | `45996ed1f6d02564a971a2fa1b5860e934307cf7` | release.yml (write token) |
| `supabase/setup-cli` | v3 | `45a513f8c64c0bc8e0e3dfe572b5c95be85f6359` | ci, e2e, release (3) |
| `pnpm/action-setup` | v6 | `0977fd99725f1db4007ccb2928dbb4e90d06cc86` | ci, e2e (4) |
| `dorny/paths-filter` | v4 | `ceb8a2b8f2d89434be7ff52d3de7ec3738c5cc9d` | ci |
| `denoland/setup-deno` | v2 | `22d081ff2d3a40755e97629de92e3bcbfa7cf2ed` | ci |
| `actions/checkout` | v7 | `3d3c42e5aac5ba805825da76410c181273ba90b1` | all (7) |
| `actions/setup-node` | v7 | `949feb2413d6458794dcd2491c4babbbce0c15c1` | ci, e2e (4) |
| `actions/cache` | v6 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` | e2e |
| `actions/upload-artifact` | v7 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` | e2e (2) |
| `actions/download-artifact` | v8 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` | e2e |

Effort S, model DeepSeek. The two to do first: `release-please-action` and `supabase/setup-cli` (they run beside write and
secret scope).

### F7. Turn on the free monitoring of a public repository (medium)
Owner click-path (Settings -> Code security): Dependabot alerts, Dependabot security updates, secret scanning, push
protection (with non-provider patterns and validity checks), CodeQL default setup (JavaScript/TypeScript and Actions). Add
`.github/dependabot.yml` with `npm` for `/web` and `/design` (weekly, grouped) and `github-actions` for `/`. Dependabot PRs
get no secrets, which is what `ci.yml` already tolerates. Effort S, model DeepSeek (file) + owner (settings).

### F8. Scope the secrets (medium, latent until a second writer exists)
(a) Move `SUPABASE_ACCESS_TOKEN` into the `production` environment (the deploy job already runs there); (b) create a
`backup` environment limited to `main`, move `SUPABASE_DB_URL` and `R2_BACKUP_*` into it and set `environment: backup` in
`backup.yml`; delete the repo-level copies and rotate; (c) use the least-scoped Supabase token available; (d) pass
`GIGET_AUTH` only to the build step that needs `LIBELLUS_REGAL=1`, never to `pnpm install`, and make it a fine-grained
read-only token on `fabkho/regal`. Effort M, model Sonnet.

### F12 to F13, F19 to F24 (low)
- **F12** no `robots.txt`, `security.txt`, real `assetlinks.json` (each answers 200 with the 3,862-byte HTML shell): add
  `web/public/robots.txt`, `web/public/.well-known/security.txt` (Contact, Expires, Preferred-Languages) and put
  `/.well-known/` in `navigateFallbackDenylist` (`nuxt.config.ts:320`). Serve `assetlinks.json` only if a TWA ships. S, DeepSeek.
- **F13** the sign-in page loads 20 cover images from `is1-ssl.mzstatic.com` before any login (Apple sees IP and user
  agent; only the origin is sent as Referer): self-host the decorative covers or add `referrerpolicy="no-referrer"` and
  `loading="lazy"`; update the logged-out host list in `docs/HOSTING.md`. S to M, Sonnet.
- **F19** the six dev-only advisories: `pnpm.overrides` for `simple-git >=4.0.1` and `@simple-git/argv-parser >=2.0.1`,
  re-lock, and a non-blocking scheduled `pnpm audit --audit-level=high`; accept and document `node-forge` and `braces` (no
  patch). S, DeepSeek.
- **F20** `gh api -X PUT repos/fabkho/libellus/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false`. S, DeepSeek.
- **F21** make the deploy key the only actor for `production` and not a bypass on `main` (with F5), or replace it with a
  fine-grained token limited to that ref; document in `docs/OPERATIONS.md` that the environment has no reviewers on purpose. S, Sonnet.
- **F22** add `docs/THIRD-PARTY.md` (Apple lookup terms and attribution, Open Library, Wikidata and Commons licences,
  Goodreads (no API; owner-accepted risk or remove), OFL fonts, foliate-js, zip.js) and mark the Apple and Open Library fixtures as test-only. S, Sonnet.
- **F23** rewrite the "private repository" statements listed in 4.17: the repository is public, fork PRs need approval, CI for
  forks runs without secrets and without Regal. S, DeepSeek.
- **F24** scrub `SPEC.md:4` (a personal remark about the owner's relationship), consider `git rm --cached .pi/mcp.json` and ignoring it. No history rewrite is needed: nothing secret is in history. S, DeepSeek.

## 7. Area 5: smoke test of production, logged out

Chromium with the Pixel 7 descriptor and WebKit with iPhone 14, `https://libellus.fabkho.dev`.

| # | Item | How tested | Result | Sev |
|---|---|---|---|---|
| 5.1 | `/` and `/sign-in` | curl, Playwright | `/` 200 shell then a client redirect to `/sign-in`; `/sign-in` 308 to `/sign-in/`, 200, the "Send code" form; TTFB 0.07 to 0.13 s | no issue |
| 5.2 | `/f/<fake-token>` | curl, Playwright | 200 shell, redirected to `/sign-in`, no error, no data | no issue |
| 5.3 | `/r/<fake-token>` | curl, Playwright | Real **404**, `cache-control: no-store`, `x-robots-tag: noindex, nofollow`, friendly "This page isn't here" page | no issue |
| 5.4 | Unknown path (`/nope-404`, `/privacy`) | curl, Playwright | 200 shell, redirect to `/sign-in` (soft 404); there are no privacy or legal pages | info (I5) |
| 5.5 | `robots.txt`, `security.txt`, `assetlinks.json` | curl | None exist: HTML shell with 200 | low (F12) |
| 5.6 | Headers | `curl -I` on `/`, `/f/x`, `/r/x`, `/sw.js`, the manifest | Identical on every response (section 5, 3.1 and 3.2); HTML `max-age=0, must-revalidate`; `sw.js` and the manifest `no-cache` | no issue |
| 5.7 | CSP effect | Playwright console | No violations in Chromium; WebKit logs the "report-only, no `report-to`" error on every page | low (F9) |
| 5.8 | Console errors, failed requests, mixed content | Playwright request log | None in Chromium except the intended `/r/` 404; no 4xx/5xx on the app, the manifest or the icons; all requests https | no issue |
| 5.9 | Third-party hosts contacted logged out | Request log | `libellus.fabkho.dev` (about 36), `static.cloudflareinsights.com` (1), `cloudflareinsights.com` (3 to 7 beacons), **`is1-ssl.mzstatic.com` (20 cover images on the sign-in page)**. No Supabase, Open Library or Wiktionary call | low (F13) |
| 5.10 | Service worker | `getRegistrations`, Cache Storage | Both browsers: scope `/`, active, script `/sw.js`, no waiting worker; precache `workbox-precache-v2` with 96 to 206 entries (counted while still filling) | no issue |
| 5.11 | Manifest and icons | Request context | Manifest 200 `application/manifest+json`; 4 icons and 3 shortcut icons 200 `image/png`; `share_target` POST `/share` | no issue |
| 5.12 | Storage after load | `localStorage`, `sessionStorage`, IndexedDB, cookies | All empty in both browsers, no cookies | no issue |
| 5.13 | Offline reload | `setOffline`, reload, `goto /library` | Chromium: the shell and the sign-in page load once the service worker controls the page (`smoke-chromium-offline.png`; the first attempts failed before it had claimed the page, a test artefact). **WebKit: inconclusive** (the page text was readable but the navigation reported an internal error) | not testable (WebKit) |
| 5.14 | REST root with the shipped publishable key | One `GET` of the project's `/rest/v1/` | `401 {"message":"Secret API key required"}`: the OpenAPI document is not exposed to anon (unlike the local stack). No table was queried | no issue |
| 5.15 | Edge function preflight | `OPTIONS` with `Origin: https://evil.example` | `goodreads-rating`, `enrich`, `reading-page-og`, `waitlist-invite`: 200 with `access-control-allow-origin: *` and the usual headers; `regal-export`: 405 with no CORS headers (correct). The POSTs were not exercised on production | no issue |
| 5.16 | First-load weight | Navigation timing | About 60 requests and 1.6 MB decoded (0.9 MB shell, 0.65 MB the 20 Apple covers), DOMContentLoaded about 250 ms, load about 310 ms on a fast link, HTML 1.9 KB. Sanity only | info |

Screenshots in `/tmp/security-final/` and `.shots/`: `smoke-{chromium,webkit}-{landing,signin,fshare,notfound,offline,rtoken}.png`,
`app-*.png` (local build: sign-in, library, book, profile, planted share, sign-out). The full-page shots of the logged-out states look
alike on purpose (every one lands on the sign-in page).

## 8. Where V2a is touched by a V1/V1.1 finding (for the social worker)

- **F1**: any V2a function or screen that hands a Book to another member must go through `private.cover_shown`
  (and, after F1, the new check on `books.cover_url` makes it true by construction). The in-app Catalogue reads
  are not gated today.
- **F3**: if V2a shows what friends read, Manual books must stay out of it and out of any lookup that writes to a shared cache.
- **#247 pattern**: V2a refusals should use `PT404` / `PT429` like the social functions; the blocker and non-existent cases
  are byte-identical today (row 1.19) and a new function must keep that.
- `search_books` is `SECURITY DEFINER` and applies `books_readable` by hand: if V2a widens what a member may read in
  `books` (for example friends' Manual books), `search_books` does not follow automatically; change both together.
- F4 (`/share`) and F10/F11 (device data) are not social, but V2a stores a feed copy on the device
  (`libellus.feed`): it is covered by the existing sign-out clear; F11 would clear it on a dead session too.

## 9. Info items

- **I1** `goodreads-rating` and `enrich` compare the service key and `ENRICH_TOKEN` with `===`; reuse `regal-export`'s constant-time `sameSecret`. S, DeepSeek.
- **I2** `private.book_search_sync` and `search_books` set `search_path = pg_catalog, public`; add `pg_temp` as the last entry the next time they are touched. Tested: temp-table and temp-function shadows have no effect (1.5).
- **I3** The non-social refusals (`entry_not_found` and friends, errcode `P0002`) still answer HTTP 500 to a monitor; bodies are identical for foreign and non-existent, so there is no leak. Move them to `PT404` when next touched.
- **I4** A 100,000-distinct-word `search_books` query shows `max_stack_depth` in the error; fixed by F14.
- **I5** Soft 404s on unknown paths (200 then client redirect); a real 404 for non-app paths would show dead links.
- **I6** `authenticated` keeps PostgreSQL's default TEMP privilege; unused by the API surface.
- **I7** Local stack's PostgREST serves the OpenAPI document to anon; production does not. Nothing to do.
- **I8** Owner-chosen invite codes have whatever entropy the owner gives them; generated codes have 40 bits.
- **I9** `SECURITY.md` has no fallback contact or response time; fine for a one-person project with private reporting enabled.

## 10. Proposed work packages (for the coordinator)

| Package | Contents | Model |
|---|---|---|
| A. Catalogue input | F1 + F17 (one migration, pgTAP, client `coverSrc`) | Sonnet |
| B. Goodreads hardening | F2, F3, F15, F16, I1 (handler tests, migration revoking the table read, client skips Manual titles) | Sonnet |
| C. Device data | F4, F10, F11 (share target, sign-out and dead-session clears) | Sonnet |
| D. Repository | F5, F6, F7, F8, F20, F21 (ruleset, SHA pins, Dependabot, secret scoping; owner click-paths listed) | Sonnet for F5/F8, DeepSeek for the rest |
| E. Public-repo docs | F22, F23, F24, F12, SECURITY.md follow-up | DeepSeek |
| F. Headers | F9, F13 (report endpoint, one CSP constant, then enforce) | Sonnet |
| G. Small edge/RPC bounds | F14, F18, I2 | DeepSeek |

## 11. Reproducing

`docs/security/data/attack-scripts/README.md`. The scripts need a local stack and `LIBELLUS_*` environment variables; they
create their own throwaway members and never touch production. `data/attack-transcripts.txt` is the output of one full run
(local accounts and ids only).
