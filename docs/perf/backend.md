# Backend performance assessment

Read-only assessment of the Libellus backend (Postgres 17 + PostgREST + Auth + Storage + edge
functions + Cloudflare Pages) for the step from one member to a few hundred. Nothing in the app, no
migration and no production access was changed or used: the numbers come from the read-only
production extracts the coordinator pulled on 2026-10-09 (`/tmp/perf-backend/`) and from a
throwaway local stack with synthetic data; a follow-up round (R1-R6, run read-only against production
by the coordinator, section "Production readings") replaced my first guess of "production = local x5" by
measured factors. Client waterfalls and bundle weight belong to the
client assessment (perf-client-1); this file lists only what the server side could batch.

Everything the numbers need is reproducible from `scripts/perf/` (see "Reproducing" at the end).

## Summary

The database is idle today: the 40 heaviest statements add up to 124 s over about 4.5 days, and 56 %
of that is the app. Nothing is slow for one member. What this assessment found is **what stops
scaling**, ranked by impact x effort **after the production readings**. Evidence class: **P** = measured
in production (statement statistics, EXPLAIN as the member, headers, settings), **L** = measured on the
local stack, **C** = read from code/docs. Local figures carry the production factor of "Production
readings": x2.5 best case, x4-9 typical mean, x15-30 for the occasional slow run.

| # | Finding (was) | Evidence | Numbers | Effort | Tier |
| --- | --- | --- | --- | --- | --- |
| 1 | **F2** `import_books` is O(n^2): the title match computes `work_title_key(b.title)` for every Book she has, for every file row (**was 2, up**) | **L** + P factor | 600 books 1.4-2.8 s locally, worst 100-row call 0.5-0.7 s; **x9 = 4.4-6.1 s of the 8 s `authenticated` timeout, x15+ times out**; 2,000 books 12.6-21.9 s, times out from the ~840th entry at x9; one index: 0.25 s / 0.73 s, worst call 40 ms | S | DeepSeek |
| 2 | **F1** `search_books` cannot use its GIN index under RLS: a sequential scan that recomputes `unaccent` + `to_tsvector` for every book (same) | **L**, P at 185 books | production **69 ms** for `'the'` at 185 books (EXPLAIN), mean 21.6 / sd 48 / max 576 ms over 181 calls; local 1.2-3 ms; linear in Books: 4 -> 15 -> **52-114 ms at 15k locally, ~0.4-0.8 s typical on this instance**; fix 7-67x | M | Opus (RLS) |
| 3 | **F4** Home refetches the whole Library per activation with full `books.*`; 1,000-row cap; 4th full copy on Search (**was 4, up**) | **P** (R3, R1) + L | avg description **1,226 chars = ~65 % of a Book's JSON** (my seed had 740): ~300 KB per Home at 130 books (my figure 241 KB), 151 unfiltered full-Library fetches in 4.5 days (mean 27 ms, max 613); 1.95 MB (141 KB gzip) for 1,000 entries locally | M | Sonnet |
| 4 | **F5** `started_series` and (unshipped) `muted_series_list` compute the same CTE twice per Home (**same; the production figure was misattributed, see below**) | **P** + L | `started_series` (21 calls) mean **55 ms**, sd 48, max 177, 2,368 buffers per call (same plan work as local, 6 ms); the 54 ms / max 1.5 s I quoted belongs to `next_in_series`, Home's older query | S | Sonnet |
| 5 | **F3** `reading_sessions` / `reading_progress_days` policy forces whole-table scans (**was 3, down**) | **L**; plan shape confirmed in P | production `readInYear` is 0.38 ms and 10 buffers at 80 rows (533 calls, mean 1.5 ms): invisible today; locally 0.09 -> 0.63 -> **6.0 ms / 30,548 buffers** at 36k sessions, 0.57 ms when driven from her entries | M | Sonnet |
| 6 | **F6** `cron.job_run_details` never purged (same) | **P** | log is 344 kB after 6 days (~456 rows/day); `shelf-publish` 1,223 runs avg 8.6 ms, max 159 | S | DeepSeek |
| 7 | **F7** CORS preflight (**was 7, answered and down**) | **P** + C | `access-control-max-age: 3600`: fine for Chrome (cap 2 h); WebKit caps it at 10 min, so one preflight per distinct URL per 10 min on iPhone; no action | - | - |

Social v1 (PR #235) is fine to ship from a performance standpoint, with a few things worth doing
first or right after (section "Social v1 before it ships"): `feed()` costs followees x their
retained activity, not the page size (18 ms p50 at 200 follows, linear); `my_people()` is 38 ms at
200/200 and is also what Home calls to count follows; two foreign keys without index; the Home
refetch pattern gets two more requests.

Headroom (sections "Throughput" and "Production readings"): on this Mac, with the database limited to
2 CPUs, 10 connections serve ~500 list requests/s and ~30 searches/s at 15k books; 20 members opening
Home in the same instant (120 requests) finish in 0.77 s p50 / 1.0 s p95. The production instance
is a Micro-class compute (224 MB shared buffers, 60 connections): at x2.5 that is 1.9 s / 2.5 s, at x9
about 7 s / 9 s for an instant burst of 20, which no realistic peak reaches (5-10 at once is). Home needs ~25 ms of
local database time (60-225 ms there). Three hundred members are no problem *if* search, the import and
the sessions queries stop being linear in the catalogue, in her Library and in the sessions table.

## Method

- **Throwaway stack** `libellus-perf`, ports 55660-55669 (`supabase start -x studio,mailpit,logflare,vector,imgproxy,edge-runtime,postgres-meta,storage-api,realtime`); the shared stack on 553xx and the social worker's on 556[2x] were not touched. `supabase/config.toml` was edited locally for the ports and **not committed**.
- **Data** (`scripts/perf/seed.sql`, deterministic, triggers off while loading):

  | Scenario | Members | Entries | Sessions | Catalogue Books | Works | work_series | Shape |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | S0 "today" | 1 | 118 | 95 | 400 | 5,054 | 1,444 | production has 130 entries, 185 Books, 2,332 works |
  | S1 "10x" | 30 | 4,307 | 3,537 | 2,500 | 31,654 | 9,044 | ~13x Books, 30x members |
  | S2 "100x" | 300 | 45,496 | 36,685 | 15,000 | 190,000 | 54,285 | ~80x Books, 300x members; member 1 is a Goodreads import with 1,000 entries ("heavy") |

  62 % finished, 5 % reading, 28 % want to read, 5 % abandoned; a third of the closed reads carry a
  review; descriptions are ~740 characters; authors have 38 works each (as enrichment fetches them);
  28 % of the works are in a series of five.
- **As a member**: `EXPLAIN (ANALYZE, BUFFERS)` with `set local role authenticated` and
  `request.jwt.claims` set the way pgTAP does (`scripts/perf/explain.mjs`), best of 5 warm runs;
  the same under `service_role` (BYPASSRLS, the filter on `member_id` added by hand) to price RLS.
  The SQL of each hot path is in `scripts/perf/queries.sql`; the library lists and the Profile queries
  are the SQL PostgREST builds (captured from `pg_stat_statements` on the stack).
- **End to end**: `scripts/perf/screens.mjs` replays the requests of each screen through Kong and
  PostgREST with a minted HS256 JWT (no GoTrue needed), alone or as N members at once; `oha` for
  sustained throughput. (pgbench/k6 are not installed; Node's `fetch` and `oha` do the same job.)
- **Calibration.** First assumed "production = local x5" from two statements; the production readings
  (section below) give measured factors per statement: **x2.5 best case** (production minimum vs local
  warm), **x4-9 typical** (production mean vs local warm), **x15-30** for single slow runs. Read every
  local figure with those three multipliers; the 2-CPU runs add contention but not slower cores.

## What production says (the extracts of 2026-10-09)

### pg_stat_statements, top 40 by total time (124 s in all)

| Class | Total | Calls | Share | Verdict |
| --- | --- | --- | --- | --- |
| The app (PostgREST statements for lists, RPCs, writes) | 69.1 s | 5,329 | 56 % | all fine in absolute terms; see below |
| Studio / client introspection (`pg_timezone_names`, type catalogue) | 19.1 s | 63 | 15 % | dashboard noise: `pg_timezone_names` is 44 calls x 418 ms (Studio's timezone picker). Ignore. |
| Cron job bodies (`shelf_publish_dispatch`, `enrich_kick`, `purge_abandoned_signups`) | 18.6 s | 1,704 | 15 % | see "The cron jobs" |
| pg_cron bookkeeping (`insert`/`update cron.job_run_details`) | 9.8 s | 3,426 | 8 % | F6 |
| PostgREST schema cache reloads (the `base_types` CTE) | 5.1 s | 90 | 4 % | 45 reloads (each ~55 ms, twice): every migration/DDL deploy. Normal. |
| PostgREST request preamble (`set_config(...)`) | 2.4 s | 10,323 | 2 % | = **10,323 API requests in ~4.5 days** for one member (~2,300/day), 0.24 ms each |

By total time the app's top statements are the Library lists (`library_entries` + embeds: 8.3 s, 6.7 s,
5.3 s, 4.1 s ... across 433 and 287 calls: the same three lists in two deploys of the client, each
Home activation = 3 statements), `next_in_series` (133 calls, 7.2 s: Home's older series query; the first
version called it `started_series`), `enrich_save` (the
`p_payload` RPC: 191 calls, 26 ms mean, 5.0 s, the enrichment writer), `search_books`
(181 calls, 21.6 ms mean, max 576 ms), `started_series` (21 calls, 55 ms), `library_genres`
(156 calls, 10.4 ms), `reading_sessions` queries (191 + 132 calls, 11-13 ms).
**By mean** (ignoring Studio): `next_in_series` 54 ms (max 1,528), `started_series` 55 ms (21 calls, max 177),
`enrich_save` 26 ms, the token RPCs (`public_reading_page`/`public_book_card`, matched by their
argument names) 27-58 ms (20-23 calls, max 255-294 ms: cold), `search_books` 21.6-29 ms, Library lists 12-28 ms, `log_client_error` 33 ms.
The means are dominated by cold caches (max values 10-50x the mean) on a small shared-CPU
instance, which is why the local figures are multiplied by 5-9 above. The statement texts are now
known (R1, "Production readings"): the three `library_entries` groups are finished / want to read /
reading by their `ORDER BY`.

### Advisors

Performance advisors (11 lints, all INFO):

| Lint | Object | Matters at 150 rows? | Matters at 300 members x 150? | Action |
| --- | --- | --- | --- | --- |
| 0001 unindexed FK | `private.instance_owner.owner_id`, `private.shelf_publish.owner_id` | no (one row each) | no (one row each) | ignore |
| 0005 unused index | `books_search` | **it is unusable, not unused** | **yes: F1** | fix the query, do not drop |
| 0005 unused index | `reader_places_member`, `waitlist_source_member_id`, `waitlist_invite_code_id`, `accounts_invite_code_id`, `client_errors_user_id`, `series_created_by` | no | no: these are the indexes behind `ON DELETE CASCADE`/`SET NULL` foreign keys; dropping one turns `delete from auth.users` (account deletion, the purge cron) into a scan of that table | **keep all** |
| 0005 unused index | `enrich_queue_due` | no (queue is empty) | no | keep; it serves `not_before <= now()` once the queue has rows |
| 0005 unused index | `goodreads_ratings_goodreads_id` | no | no (used by `shareResolve.ts` lookups by Goodreads id) | keep |

There is **no** `auth_rls_initplan` (0003) and no `multiple_permissive_policies` lint, and reading
every policy in `supabase/migrations/` confirms it: each one is `(select auth.uid())`-wrapped, one
permissive policy per table and command, and every column a policy filters on is indexed
(`library_entries.member_id` via `library_entries_import_key_once`/`_by_status`/`_once_per_book`,
`entry_series.member_id`, `entry_genres.member_id`, `collections`, `reading_pages` ...). The two
policy shapes that *do* cost something are not lints: the `EXISTS (select 1 from library_entries ...)`
chain on `reading_sessions` -> `reading_progress_days` (F3) and RLS-in-RLS on `book_authors`,
`book_works`, `book_genres`, `book_enrichment` (`exists (select 1 from books b where b.id = ...)`,
which evaluates `books_readable` again; it costs about 2x on `library_genres`, 1,198 -> 2,237 buffers,
nothing visible in ms).

Security advisors (63) are out of scope for performance, with two notes. The 45 + 5 "security definer
function executable" lints are the design (every write is an RPC, each checks `auth.uid()`); the
five anon-executable ones (`invite_code_status`, `join_waitlist`, `log_client_error`,
`public_reading_page`, `public_book_card`) are the only unauthenticated database entry points and
therefore the ones to keep cheap: `public_reading_page` costs 4.2 ms for a 150-entry member and
12.5 ms for a 1,000-entry one (22k buffers), 0.03 ms for an unknown token. The seven
"RLS enabled, no policy" tables are intentional (definer-only access).

### Sequential scans on tables that will grow (`tables.json`)

| Table | rows | seq / idx scans | Read |
| --- | --- | --- | --- |
| `library_entries` | 130 | 6,151 / 137,975 (130 rows read per seq scan) | All 130 rows are one member's, so a scan *is* the cheapest plan. With more members the planner switches by itself (S1/S2 plans use the `member_id` index: `Bitmap Index Scan on library_entries_import_key_once`). Not a problem. |
| `goodreads_ratings` | 126 | 5,545 / 123,080 | Same: the `isbn13` primary key is used from S1 on. |
| `reading_sessions` | 80 | 504 / 171,661 | Fine; the whole-table scans of F3 show up as *index* scans of `reading_sessions_entry` with a filter (30k buffers at S2). |
| `books` | 185 | 365 / 235,311 | **`search_books`** (F1): 365 seq scans of ~160 rows; the 181 + 40 searches are most of them. |
| `work_series` | 645 | 167 / 5,634 (636 rows per scan) | `started_series` / `next_in_series`; at 54k rows the plans stay indexed (8 ms). |
| `series`, `book_genres`, `book_authors`, `book_works` | <=700 | tens to hundreds | tiny tables, planner preference. |
| `client_errors`, `waitlist_joins`, `enrich_queue`, `shelf_publish` | <20 | 199, 5, 485, 969 seq | `shelf_publish` and `enrich_queue` are one-row/empty tables read by cron; client_errors is read by the owner's error screen and purged daily. Only `client_errors` grows with members (kept 30 days, `purge_client_errors` at 03:45; anon callers are rate-limited per hour in `log_client_error`): an index on `created_at` is worth adding when it passes ~100k rows, not before. |

Nothing here needs an index today; the one plan that is wrong at scale is F1.

### The cron jobs (`private.shelf_publish_dispatch()`: 1,217 calls, 9.0 s)

`supabase/migrations/20261005114229_shelf_publish_dispatch.sql` schedules
`cron.schedule('shelf-publish', '*/5 * * * *', 'select private.shelf_publish_dispatch()')`: 288 calls a
day, so 1,217 calls is 4.2 days since 2026-10-05 (the nested calls from the library triggers are not
counted: `pg_stat_statements.track = top`). Each run is a primary-key read of the one-row
`private.shelf_publish` and, only when the owner changed something and 10 minutes passed, a Vault
secret decrypt and a `net.http_post` (that branch is the 154 ms maximum). The 7.4 ms mean (R6a: p50 7.2 ms, max 159) is mostly
what a fresh background worker costs on this instance, not the function: measured locally, the
`up_to_date` path is 0.03-0.09 ms warm and 0.56 ms as the first call of a fresh session, x13 to 7.2 ms. In all, the three recurring jobs + their bookkeeping are 28.4 s in ~4.5
days, 0.007 % of one core. **Not a problem.** The only real consequence: `cron.job_run_details` gets
~456 rows a day that nothing deletes (F6). `enrich-drain` every 10 minutes (335 calls, 9.5 ms) returns
`idle` without a network call when the queue is empty; `purge_abandoned_signups` hourly (152 calls,
42 ms mean) deletes from `auth.users` by an unindexed predicate, harmless below tens of thousands
of users.

## Production readings

The coordinator ran requests R1-R6 of the first version of this report read-only against production on
2026-10-09 (`/tmp/perf-backend/r/`). R7 (the Early Hints toggle) could not be read and stays an open
question for the owner. What the files say, and what it changes.

### The instance (R2)

| Setting | Value | Reading |
| --- | --- | --- |
| Postgres | 17.11, aarch64 | |
| `shared_buffers` / `effective_cache_size` / `work_mem` | 224 MB / 384 MB / 2,184 kB | a Micro-class compute (1 GB RAM); the whole dataset fits, every plan below shows `read=0` |
| `max_connections` | 60 | see "Connection ceiling" |
| `jit`, `max_parallel_workers_per_gather`, `random_page_cost` | off, 1, 1.1 | jit off is right for small statements |
| `statement_timeout` | default 120 s; **`authenticated` 8 s**, `anon` 3 s, `authenticator` 8 s (+ `lock_timeout` 8 s), `service_role` none | the limit that binds every RPC a member calls |
| Realtime publication (R6c) | empty | Realtime is unused, as the code said |
| Cron (R6a) | `shelf-publish` */5: 1,223 runs, avg 8.6 ms, p50 7.2, max 159; `enrich-drain` */10: 338 runs, avg 11.0, max 88; `purge-abandoned-signups` hourly: 152 runs, avg 45, max 96; `enrich-refresh`, `purge-client-errors`, `purge-synced-writes` daily: 15-36 ms | all trivial; `cron.job_run_details` is **344 kB** after 6 days (F6 is housekeeping, not a problem) |
| Least-used indexes (R6d) | the unused ones are the FK-support and tiny-table indexes the advisors already listed, plus `books_search` (idx_scan 0: F1) | no new index to drop; `client_errors_created_at` exists (3 scans) |

### The statements that matter (R1, with standard deviations)

The text identifies each statement (the first version inferred some). `buf` = shared buffers hit per
call in production; "local" = the same work on my stack at a matching size (139 entries, 185 Books,
2,318 works, 663 `work_series` rows: the production shape), warm, best of 5. **Production's plans
touch the same number of buffers as mine** (`started_series`: 3,909 in production, 3,891 locally;
`search_books`: 1,080 vs 1,034), so the difference below is speed and noise, not a different plan.

| Statement (calls) | min | mean | sd | max | buf | local | x min | x mean | x max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Library list, finished (`order by latest.ended_on`) (433 + 287) | 11.1 / 11.8 | 19.3 / 23.3 | 18 / 19 | 328 / 220 | 635 / 672 | 4.5 | 2.5 | 4.3-5.2 | 49-73 |
| Library list, want to read (`order by added_at`) (433 + 287) | 5.6 / 5.7 | 12.4 / 14.2 | 13 / 13 | 167 / 115 | 348 | 1.4 | 4.0 | 8.8-10 | 80-120 |
| Library list, reading (`order by latest.started_on`) (433 + 286) | 0.7 / 0.9 | 3.6 / 4.6 | 12 / 16 | 226 / 265 | 80 | ~1 | ~1 | 3.6-4.6 | 230 |
| Library, no filter (`libraryEntries()`: Search opens, import) (100 + 51) | 17.0 / 17.7 | 27.7 / 25.7 | 60 / 21 | 613 / 115 | 973 | ~9 (the three lists) | 1.9 | 2.9-3.1 | 68 |
| `started_series` (21) | 16.3 | **55.1** | 48 | 177 | 2,368 | 6.1 | 2.7 | 9.0 | ~20-71 (measured today at 139 entries: mean 55) |
| `next_in_series` (133; Home's older series query) | 8.6 | **54.0** | **143** | **1,528** | 2,055 | 3.6 | 2.4 | 15 | ~22-77 (heavy ~35-126) |
| `search_books` (181 + 40) | **2.7** / 3.6 | 21.6 / 29.0 | **48 / 39** | 576 / 194 | 356 | 1.2-3.4 | ~1 | 7-18 | 190 |
| `enrich_save` (191; the edge function's writer) | 1.5 | 26.4 | 34 | 187 | 1,710 | not measured | | | |
| `reading_sessions` with embedded Book (Profile) (191 + 132) | 6.6 / 7.6 | 11.3 / 13.4 | 7 / 8 | 75 / 68 | 469-517 | 1.9 | 3.5 | 5.9-7.0 | 36-39 |
| `readInYear` count (533) | 0.02 | 1.49 | 4.0 | 63 | 32 | 0.09 | | 17 | |

The 433/287 pairs are the same statement in two client deploys. Every row says the same thing: **the minimum is about 2.5x the warm local time, the mean 4-9x, the
maximum 50-400x**, with a standard deviation as large as the mean: production is fast most of the time
and has frequent slow runs, as a shared-CPU burstable instance does. (R1 shows `shared_blks_read = 0`
except for 3, 16 and 2 reads in three rows, so the slow runs are not disk.) I/O is not the cause;
CPU credits or noisy neighbours are the likely ones, which only the dashboard's CPU graph can confirm
(R9).

Corrections to the first version. **`started_series` has 21 calls, not 133**: the 133-call, 54 ms,
max-1.5 s statement is `next_in_series`, the query Home used before 20261014; `started_series` is its
replacement and was deployed late (21 calls). Both cost about 55 ms per call on this instance for the
same plan work that costs 4-6 ms locally. `muted_series_list` is not in the extract, as expected.

### EXPLAIN as the real member (R4)

| Call | Production | Local at the same size | Reading |
| --- | --- | --- | --- |
| `started_series(50, 'en')` | **174 ms**, 3,909 buffers, planning 0.02 ms | 4-6 ms, 3,891 buffers | same plan, 29-43x slower: the maximum of the statement's own distribution (max 176.6 ms over 21 calls), a slow run, not the typical one (mean 55 ms) |
| `search_books('the', 20)` | **69 ms**, 1,080 buffers, a `Function Scan` | 1.2-3.4 ms (`'the'` here: 90 of 185 titles start with "The") | x20-57 for one run; the same statement's production minimum is 2.7 ms and its mean 21.6 ms with sd 48. The 69 ms is again the slow tail. I could not reproduce a cold-backend cost of that size locally (first call in a fresh session: 3.3 ms against 1.2-1.3 warm) |
| `readInYear` count | 0.38 ms, 10 buffers; **still a `Seq Scan on reading_sessions` with the hashed sub-plan** (80 rows) | 0.09 ms, 6 buffers | the F3 plan shape is the one in production; it costs nothing at 80 rows |

A repeat-run EXPLAIN in one session would separate "slow tail" from "slow instance": R9 below.

### The Library payload (R3)

130 Books, average `description` **1,226 characters** (p95 2,271), average row 1,242 bytes
(`pg_column_size`, i.e. the stored, possibly compressed row; the JSON PostgREST sends is larger). My seed had 740
characters: the production list is **~1.65x my payload per entry**. With ~650 bytes of other columns the
description is **~65 %** of a Book's JSON. That agrees with the coordinator's "~300 KB for 130 books"
(my 118-entry local Home was 241 KB): 130 x (1.9 KB Book + ~0.4 KB entry/session/rating) = ~300 KB, and a
1,000-entry member is ~2.3 MB raw. F4's first fix (leave `description` out of the lists) removes
two thirds of the bytes of every Home activation, more than the half I estimated.

### CORS preflight (R5)

The hosted API answers `OPTIONS` with `access-control-max-age: 3600` (the local Kong sends none), headers
`apikey,authorization,content-type,x-client-info`. Chrome honours it up to 2 h, Firefox up to 24 h,
**WebKit caps it at 10 minutes** (MDN, `Access-Control-Max-Age`): on the primary target (iPhone) each
distinct URL pays one preflight per 10 minutes of use, and the three Library lists, the year count
and the RPCs are eight distinct URLs. A cost of one extra round trip per URL per 10 minutes, in parallel
with the others: not worth a proxy. F7 is closed; batching (F4.4) would remove it as a side effect.

### Recalibration

Where I have both numbers, the factor between this Mac (18 cores, warm) and this instance is:

| Case | Factor | Used for |
| --- | --- | --- |
| production **minimum** vs local warm | **x2.4-2.7** (list finished 2.5, `started_series` 2.7, `next_in_series` 2.4) | best case, an idle instance |
| production **mean** vs local warm | **x4-9** (lists 4.3-9, `started_series` 9, `search_books` 7, Profile 6), x15 for `next_in_series` (sd 143) | typical latency |
| a single slow run (max, or the EXPLAINs of R4) | **x17-57** (`search_books` EXPLAIN x20-57, `started_series` x29) | tail |
| a fresh background worker (cron statements, first call in a new backend) | **x13** (`shelf_publish_dispatch` p50 7.2 ms in production, 0.56 ms for its first call in a fresh local session; the warm call is 0.03-0.09 ms) | why every cron statement costs 7-45 ms |

The first version said "x5": right for the mean of the lists, **too low for `started_series` and the
tails, and too high for the best case**. The hot-path table below now shows two columns, x2.5 and
x9. The coordinator's "x17" for `search_books` compares one slow production run with a warm local
one; production's own distribution for the same statement is 2.7 / 21.6 / 576 ms (min / mean / max).

### What gets more or less urgent

| Finding | Before | After | Why |
| --- | --- | --- | --- |
| F2 `import_books` | 2 | **1** | the 8 s timeout is within the typical factor (next section); S effort, no risk, so it goes first |
| F1 `search_books` | 1 | 2 | slightly more urgent in absolute terms (production 21.6 ms mean on 185 Books, 69 ms tail: ~0.4-0.8 s typical at 15k Books), but cheap now; the fix is M, RLS-sensitive, and the index is not needed below ~2k Books |
| F4 payload / refetch | 4 | **3** | descriptions are 65 % of the JSON and 1.65x my seed; production already makes 151 unfiltered full-Library fetches in 4.5 days (Search opens, import); 433 + 287 Home activations in the same time |
| F5 series | 5 | 4 | `started_series` really costs 55 ms mean there on every Home (sd 48), and the muted variant doubles it |
| F3 sessions policy | 3 | 5 | production `readInYear` is 0.38 ms at 80 rows, 1.5 ms mean; the cost is real only as the table grows (30 k buffers at 36 k sessions locally). Fix when the first 20 members join, or alongside F4 |
| F7 CORS | 7 | closed | max-age 3600 |
| F6 cron | 6 | 6 | log is 344 kB |

### Does a 600-book Goodreads import fit the 8 s `authenticated` timeout?

The timeout applies to each API call, and the app sends 100 rows per `import_books` call
(`bookImport.ts: writeRows`), so a 600-book import is six calls and the last is the slowest.
Local, on the production-sized start (139 entries, 185 Books): two runs of 600 books took 2.3 s and 2.8 s;
the worst call (the sixth) took **0.49 and 0.68 s**. A 2,000-book run: 21.9 s, calls growing from 0.26 s to
**1.94 s**; the fit over all 20 calls is `call ms = 133 + 0.9 x entries in her Library at that moment`.

| Factor | Worst call of a 600-book import (0.49-0.68 s) | Verdict | Entries in her Library at which one call reaches 8 s |
| --- | --- | --- | --- |
| x2.5 (best case) | 1.2-1.7 s | fits | ~3,400 |
| x4.3 (mean of the lists) | 2.1-2.9 s | fits | ~1,900 |
| x9 (typical mean) | **4.4-6.1 s** | **fits with 1.3-1.8x to spare** | ~840 |
| x15-17 (slow run) | 7.4-11.6 s | **times out** | ~450 |

So **on this instance a 600-book import fits the 8 s timeout at best-case and typical speed, with a
margin of only 1.3-1.8x at the typical mean, and fails in a slow run** (production's maxima are 50-400x its
means, so a slow minute is not exotic); a second import for a member who already has ~840+ books times out
at the typical mean, and a 2,000-book import fails from about its 8th call on. Each call is its own
transaction, so a failed call leaves the earlier ones imported and the client sees a partial import.
With the F2 index the same worst call is ~40 ms locally (x29 = 1.2 s): the timeout stops being a
question. This moves F2 to the top.

### Search growth on this instance (F1)

Local cost is linear in the Catalogue: ~3.4 us per Book for a selective query, ~5.3 us for a common prefix
(52 / 79 ms at 15,000 Books, 114 ms for `'bo'`), plus ~0.6 ms. Production: mean 21.6 ms at 185 Books
(= x7 on ~3 ms), so:

| Catalogue | local | x2.5 (best) | x7 (measured mean) | x20 (a slow run, e.g. the 69 ms EXPLAIN) |
| --- | --- | --- | --- | --- |
| 185 Books (today) | 1.2-3 ms | 3-8 ms | **~21 ms (measured)** | 69 ms (measured) |
| 2,000 | 7-11 ms | 18-27 ms | 50-75 ms | 150-220 ms |
| 5,000 | 17-27 ms | 45-65 ms | 120-190 ms | 350-540 ms |
| 15,000 | 52-114 ms | 130-285 ms | 360-800 ms | 1.0-2.3 s |

A typed query runs after a 220 ms pause from 2 characters, so at ~5k Books (a few dozen members with
overlapping taste) every search is a visible 120-190 ms typical wait and CPU-bound: with 2 shared
vCPUs about 4-12 searches/s at 15k Books (local 2-CPU run: 31/s, divided by the factor), i.e. 3-5 members
typing at once saturate the instance. The 8 s timeout is not the limit for search (it would take ~100k Books).

### Connection ceiling (60) and the PostgREST pool

REST traffic does not open connections per request: PostgREST holds a fixed pool (not a `pg_settings` value,
so R2 cannot show it) and queues requests past it, as my local runs show (pool of 10: 30 connections make
p50 x6). 20 members opening Home at once (120 requests) therefore queue, they do not exhaust 60
connections; the time is the pool x the statement times above (at x9, Home is 60-225 ms of database time:
20 at once clear in ~2 s at the best case and ~7 s at the typical mean, p95 higher; the same burst of 5
takes ~0.6 s typical). What the 60 does not allow is slack for direct connections: GoTrue, Storage, the
cron workers (three jobs, a connection each for milliseconds), `pg_net`, Realtime (its publication is
empty but it may still hold a few), PostgREST's pool and the dashboard share them. Nothing in the app
opens a direct Postgres connection (the edge functions use supabase-js over REST), so the ceiling is not
the constraint to design around; R8 shows the actual mix. PostgREST also gives up waiting for a free pool
connection after its acquisition timeout (10 s by default): that, not Postgres, is the failure that a
too-large burst at x9 would show first.

## Hot paths

What each screen asks (from `web/app/data/*.ts` and the stores), with the cost I measured. "ms" are
local, authenticated, warm; buffers in parentheses for the ones where the plan shape matters.
**Inv/Def** = security invoker/definer; **Vol** = stable/volatile. All reads are stable invoker unless
said. 10x = S1, 100x = S2; "heavy" = the 1,000-entry member at S2. The last column is the S2 figure at x2.5 (best case) to x9 (typical mean), see "Production readings"; single slow runs go to x20-30.

| Screen / call | Inv/Def, Vol | Touches | Today (S0) | 10x (S1) | 100x (S2) | Heavy | 100x on this instance (x2.5 - x9) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Home**, whole screen (6 parallel requests), p50 / p95 | | | 7.2 / 8.2 | 7.0 / 8.6 | 7.9 / 9.9 | 30 / 36 | ~20-70 / ~25-90 |
| `library_entries` want_to_read, SQL only | table, RLS | her entries + `books.*` + `goodreads_rating()` + `latest_session()` per row | 1.5 | 1.3 | 1.9 | 7.2 | ~5-17 (heavy ~18-65) |
| `library_entries` finished, ordered by `latest(ended_on)` | table, RLS | same | 4.4 | 3.4 | 3.6 | 19.9 (8,024 buffers) | ~9-32 (heavy ~50-180) |
| `reading_sessions` count (`readInYear`, HEAD) | table, RLS (hashed sub-plan) | **all** sessions of the table | 0.09 | 0.63 (2,869) | **6.0 (30,548)** | 6.9 | ~15-54; linear: ~50 ms locally at 300k sessions, 0.12-0.45 s there |
| `started_series` | invoker, stable | her entries, sessions, `work_series` | 6.2 | 6.6 | 7.9 | 24.6 | ~20-71 (measured today at 139 entries: mean 55) |
| `muted_series_list` (20261016, not in prod) | invoker, stable | the same CTE again | 4.8 | 5.6 | 5.7 | 20.5 | ~14-51 |
| **Library** (3 lists + `library_genres`), p50 / p95 | | + her entries again | 6.5 / 7.3 | 6.0 / 7.8 | 6.2 / 7.7 | 29 / 31 | ~16-56 / ~19-69 |
| `library_genres` | invoker, stable | her entries x `book_genres` | 1.3 | 1.5 | 1.9 | 4.8 | ~5-17 |
| **Book page**, 6 requests, p50 / p95 | | by id / `entry_id` | 3.2 / 3.9 | 2.8 / 3.4 | 3.1 / 3.8 | | ~8-28, flat |
| `book_series_info` / `book_authors_of` / `book_genres` | invoker, stable | by book, indexed | 3.3 / 0.8 / 1.0 | 3.3 / 0.8 / 1.0 | 3.3 / 0.8 / 1.0 | same | flat |
| **Profile**, 5 requests, p50 / p95 | | | 5.1 / 6.3 | 5.5 / 6.4 | 13.3 / 16.3 | 33 / 35 | ~33-120 / ~41-147 (heavy ~80-300) |
| closed sessions with embedded Book, paged by 1,000 | table, RLS | **all her sessions** + entry + Book | 2.3 | 1.8 | 2.1 | 10.2 (1.3 MB raw) | ~5-19 (heavy ~26-92) |
| `reading_progress_days`, 83 days, embeds session | table, RLS (3 levels) | the whole table | 0.2 | 0.5 (1,966) | 2.4 (3,520) | 3.1 | ~6-22; linear in the table |
| first progress day ("since": `order by day limit 1`) | table, RLS | seq scan of the whole table | 0.14 | 0.40 (821) | 1.9 (940) | 2.9 | ~5-17; linear |
| **Search**: `search_books('book title 1')` / `('author 7 lastname')` / `('bo')` | invoker, stable, plpgsql | **every Book** (seq scan, F1) | 4.0 / 3.2 / 4.9 | 14.8 / 10.9 / 21.0 | **79 / 52 / 114** | same | **~200-710 / ~130-470 / ~285-1,030**; linear in the catalogue |
| `author_page` | invoker, stable | the author's works x her entries | 5.4 | 5.8 | 5.7 | 5.6 | ~14-51 |
| `series_works` | invoker, stable | one series | 2.6 | 2.7 | 2.9 | 2.9 | ~7-26 |
| `next_in_series` / `my_works` | invoker, stable | her entries x works | 3.6 / 1.5 | 4.7 / 1.8 | 8.6 / 2.4 | 14.0 / 5.8 (196 KB raw) | ~22-77 (heavy ~35-126) |
| `sync_write`: `update_progress` / `add_to_library` (new Book) / start + finish | definer, volatile | one row + `synced_writes` | 0.17 / 0.22 / 0.31 per call | | | | negligible |
| `import_books`, 600 rows as 6 calls | definer, volatile | her whole Library per file row (F2) | 1.4 s | | 2,000 rows: **12.6 s** | | worst call 0.5-0.7 s locally = 4.4-6.1 s at x9 of the 8 s timeout; see "Production readings" |
| `public_reading_page` (crawler, `/r/<token>`, `og.png` check) | definer, stable, anon | her finished / reading | 4.2 (150 entries) | | | 12.5 (22k buffers) | ~10-38 (heavy ~31-113) |
| `enrich` edge function: a first view of an unknown author | edge function -> `enrich_save` | Wikidata / Open Library | network-bound; `enrich_save` 26 ms mean in prod | | | | |

What RLS costs (authenticated vs the same query as `service_role` with the member filter added by
hand, S2, member 2): Library lists +0.3-0.7 ms, `started_series` 7.9 vs 5.7 ms, `library_genres`
1.9 vs 1.2 ms, `search_books` 79 vs 38 ms (F1), `readInYear` **6.0 vs 0.3 ms**, progress days 2.4 vs
0.5 ms, everything else within 0.1 ms. So RLS is cheap where it is `member_id = (select auth.uid())`
on an indexed column and expensive exactly where a policy is an `EXISTS` through another table.

### Payloads (the Library request)

Raw / gzip (the hosted gateway compresses; local Kong does not, see "API and hosting"):

| Request | S0 (118 entries) | S2 member 2 (150) | Heavy (1,000) |
| --- | --- | --- | --- |
| `library_entries` want / reading / finished | 50 / 25 / 166 KB | 84 / 19 / 202 KB | 457 / 102 / 1,395 KB |
| gzip of those three | 3.9 / 2.6 / 13.1 KB | 6.3 / 2.1 / 15.9 KB | 30.5 / 8.1 / 102.8 KB |
| Home total | 241 KB / 19.6 KB | 304 KB / 24.3 KB | **1.95 MB / 141 KB** |
| `library_genres` | 18 / 5.8 KB | 23 / 7.3 KB | 147 / 45 KB |
| Profile sessions (embedded Books again) | 146 / 11.6 KB | 186 / 14.8 KB | 1,307 / 101 KB |
| `author_page` / `series_works` / `book_series_info` | 12 / 1.5 / 2.2 KB | 10 / 1.5 / 1.6 KB | same |
| social `feed` (30 rows) / `my_people` (200+200) | | 18.7 / 34.3 KB | |

Per entry the list sends ~1.4-2.2 KB; in my seed `description` is **53 % of the Book JSON**
(111 of 209 KB for 150 entries), plus `cover_thumbhash` and colours (3 %). Real Apple blurbs are
longer than my 740 characters: R3 measured the real average, **1,226 characters (p95 2,271)**, i.e. ~65 % of the JSON and ~1.65x my payload per entry (see "Production readings").

## Throughput and concurrency (S2)

`oha`, JWT of member 2, Library finished list with all embeds, `started_series`, `search_books`:

| | Unconstrained (18 cores) | DB + PostgREST limited to 2 CPUs (`docker update --cpus=2`) |
| --- | --- | --- |
| finished list, 1 connection | 246 req/s (p50 3.9 ms) | 231 req/s (4.2 ms) |
| finished list, 10 connections | **1,848 req/s** (p50 5.2, p95 7.4 ms) | **504 req/s** (p50 6.0, p95 79 ms) |
| finished list, 30 connections | 765 req/s (p50 34, p95 83 ms) | 203 req/s (p50 109, p95 306 ms) |
| `started_series`, 10 connections | 1,437 req/s | 340 req/s |
| `search_books('author 7 lastname')`, 10 connections | 153 req/s (p50 65 ms) | **31 req/s (p50 308 ms)** |

PostgREST's pool is 10 connections here; past it requests queue (30 connections: p50 x6). The
hosted pool is not a `pg_settings` value; see "Connection ceiling" in "Production readings".

**20 members opening Home at once** (20 x 6 = 120 requests in the same instant, 10 rounds, the
screen finishes when the slowest request does):

| Scenario | Screen p50 / p95 |
| --- | --- |
| S1, unconstrained | 170 / 206 ms |
| S2, unconstrained | 188 / 216 ms |
| S2, 2 CPUs | **771 / 998 ms** (individual requests 300-600 ms p50) |
| S2 with Social v1's `feed` + `my_people` added to Home (upper bound), unconstrained | 360 / 423 ms |

A single Home is ~25 ms of database time; it is the 6-8 requests x pool of 10 that queues, not any
one statement. At 300 members, 20 simultaneous Home opens is far beyond a realistic peak (a
retreat community opens the app together after a session, maybe 5-10 at once), so Home has
headroom today. **Search does not**: 10 members typing at once saturate 2 vCPUs.

## Findings

Each: evidence, fix, effort S/M/L, risk, who implements, what to measure again. **RLS must never
loosen: every policy or definer change below keeps the visibility rule word for word and needs a
pgTAP test for "member A cannot see member B's row".**

### F1. `search_books` never uses its GIN index (impact high, effort M)

**Evidence class: L** (plans, scaling, fix) **+ P** (production: 69 ms EXPLAIN, mean 21.6 / sd 48 / max 576 ms at 185 Books, `books_search` idx_scan 0). Rank 2 (production projection: "Search growth on this instance").

Evidence. `books_search` is a GIN index on `to_tsvector('simple', book_search_text(title, authors))`.
Under RLS the planner cannot use it: `books_readable` is a security-barrier qual and `ts_match_vq`
(`@@`) is **not leakproof** (`pg_proc.proleakproof = f`), so it may only be evaluated after the policy
qual, as a filter, never as an index condition. Even with `enable_seqscan = off` the authenticated
plan stays a seq scan; as `postgres` (BYPASSRLS) the same statement is a `Bitmap Index Scan on
books_search` in 0.64 ms. Production shows it: `books_search` is in the "unused index" advisor and
`books` has 365 seq scans.

```
-- authenticated, S2 (15,000 Books), search_books('author 7 lastname'), the inner statement
Sort Key: ((btrim(book_search_text(b.title, '{}')) = ...)) DESC, (ts_rank(to_tsvector('simple', book_search_text(b.title, b.authors)), '...:*'::tsquery)) DESC, ...
  ->  Seq Scan on books b  (actual time=0.057..50.776 rows=1333 loops=1)
        Filter: (((owner_id IS NULL) OR (owner_id = (InitPlan 1).col1)) AND (to_tsvector('simple'::regconfig, book_search_text(title, authors)) @@ ...))
        Rows Removed by Filter: 13667        Buffers: shared hit=2084      -- Execution Time: 51.270 ms
```

Every search therefore recomputes `unaccent` + `to_tsvector` for every Book (3.3 us each), and a
second time for `ts_rank` for every match. Cost is linear in the catalogue: 4 ms at 400 Books, 15 ms
at 2.5k, 52-114 ms at 15k; with the 2-CPU limit 31 searches/s. The client searches from 2
characters after a 220 ms pause (`MIN_QUERY_LENGTH = 2`, `SEARCH_DEBOUNCE_MS = 220`), so "bo" costs
the worst case (a common prefix such as "bo" matches thousands of Books, all of them ranked; "book title 1" alone matches 7,223 of the 15,000).

Fix (sketch in `scripts/perf/proposals.sql`, measured inside a rolled-back transaction):

```sql
-- 1. the visibility rule moves into the function (SECURITY DEFINER reads books without RLS, so the
--    index is usable); the predicate is books_readable's, word for word
create or replace function public.search_books(p_query text, p_limit integer default 20)
returns setof public.books language plpgsql stable security definer
set search_path = pg_catalog, public as $$
  ... where b.search_tsv @@ v_words and (b.owner_id is null or b.owner_id = (select auth.uid())) ...
-- 2. a stored tsvector, so ranking a thousand matches does not re-run unaccent
alter table public.books add column search_tsv tsvector
  generated always as (to_tsvector('simple'::regconfig, public.book_search_text(title, authors))) stored;
create index books_search_tsv on public.books using gin (search_tsv);  -- then drop books_search
```

Measured at S2, authenticated, `Execution Time`:

| Query | Today | definer (1) | + stored tsvector (1 + 2) |
| --- | --- | --- | --- |
| `author 7 lastname` (1,333 matches) | 54.8 ms | 7.9 ms | 4.2 ms |
| `book title 12345` (1 match) | 47.3 ms | **0.70 ms** | 0.72 ms |
| `bo` (all prefixes, thousands of matches) | 118.7 ms | 74.4 ms | 30.9 ms |

The last row is ranking-bound; to flatten it as well, rank only the newest N matches or ask for 3
characters (a product call, listed for the client assessment).

Risk. **RLS-sensitive**: a definer function reads `books` past RLS, so the only thing keeping a
member out of another member's Manual book is the predicate in the function; copy it, keep
`revoke ... from public, anon` and `grant execute ... to authenticated`, and extend
`supabase/tests/catalogue_search_test.sql` with "A's Manual book is not found by B". Table rewrite for
the generated column: 15k rows, instant. Implementer: Opus (RLS design) or Sonnet with an Opus
review of the predicate. Measure again: `search.*` in `scripts/perf/explain.mjs`; production
`search_books` mean/max; `books_search_tsv` in `pg_stat_user_indexes.idx_scan` (> 0).

**Fixed** in PR #249 (migration 20261020020000): `search_books` is security definer with the `books_readable` predicate word for word in both branches, over `private.book_search` (the same words, stored, GIN index `book_search_words`, kept by a trigger on `books`) instead of a column on `books`, so the JSON of `setof books` / `books(*)` is unchanged; `books_search` dropped. S2 as the member: `author 7 lastname` 58 -> 4.7 ms, `book title 12345` 53 -> 3.3 ms, `bo` 129 -> 21 ms (warm: 66 -> 2.1, 59 -> 0.6, 147 -> 23 ms); 2-CPU throughput 31 -> 554 searches/s. Write cost +~25 us per new Book (600-book import unchanged, 2,000 books ~+8 %). Measure again: `book_search_words` in `pg_stat_user_indexes.idx_scan` (> 0).

### F2. `import_books` is quadratic (impact high for onboarding, effort S)

**Evidence class: L** (the quadratic, the fix) **+ P** (the 8 s `authenticated` timeout and the x2.5-x9 factors). Rank 1: a 600-book import fits the timeout only with 1.3-1.8x to spare at the typical factor ("Does a 600-book Goodreads import fit...").

Evidence. `import_books` (20261009100000) first looks for "hers under another edition":
`select e.id from library_entries e join books b on b.id = e.book_id where e.member_id = v_member and
public.work_title_key(b.title) = v_title ...` for every file row. `work_title_key` is two
`regexp_replace`s, a `split_part` and `match_text`; it is evaluated for **every Book she has**, so
row *k* of a file costs O(k).

```
import of 600 books (6 calls of 100): 1,341 ms   batches: 80, 130, 189, 255, 300, 383 ms
import of 2000 books (20 calls)      : 12,609 ms  batches: 80 ... 580 (10th) ... 1,175 ms (20th)
```

~0.6-0.9 ms per Book already in her Library per 100 rows (fit on a production-sized start: `call ms =
133 + 0.9 x entries`). A 100-row call passes the `authenticated` role's 8 s statement timeout (R2b) at ~3,400
entries at x2.5, ~840 at the typical x9 and ~450 in a slow run (x15-17), so a long Goodreads export fails
partway; a 600-book import fits with 1.3-1.8x to spare at x9 (section "Production readings").
The social triggers do not change this (600 books: 1,399 ms with them, 1,341 ms without; `activity`
rows written: 0, the import is quiet).

Fix, one index (`work_title_key` is `immutable`, so it can be indexed):

```sql
create index books_work_title_key on public.books (public.work_title_key(title));
```

Measured: 600 books 1,341 -> **247 ms**; 2,000 books 12,609 -> **728 ms**, flat at ~35 ms per call.
Cost: a small index on the Catalogue (15k rows) and one more index to maintain on `books`
inserts (enrichment, imports). Risk: none for RLS (no policy touched); the function is definer and
the query plan only changes. Implementer: DeepSeek (mechanical), plus the existing
`import_books_*_test.sql`. Measure again: `scripts/perf/import.sql` with 2,000 books.

**Fixed** in PR #238 (`books_work_title_key`, migration 20261018010000): 600 books 1,280-1,292 -> 225-232 ms, 2,000 books 12.4-12.7 s -> 738-754 ms, locally.

### F3. Whole-table scans through the `reading_sessions` policy (impact low now, high later; effort M)

**Evidence class: L**; production confirms the plan shape (seq scan + hashed sub-plan, 0.38 ms at 80 rows). Rank 5.

Evidence. The policy is `exists (select 1 from library_entries e where e.id = entry_id and e.member_id
= (select auth.uid()))`. For a query that does not filter on `entry_id` the planner builds a hashed
sub-plan of *her* entry ids and applies it as a filter to a scan of the **whole table**:

```
-- S1, Home's readInYear (outcome = finished, ended_on in the year), authenticated
Index Scan using reading_sessions_entry on reading_sessions  (actual rows=34 loops=1)   -- Buffers: shared hit=2869
  Filter: ((ANY (entry_id = (hashed SubPlan 6).col1)) AND (outcome = 'finished') AND (ended_on >= ...))
  Rows Removed by Filter: 3274
-- S2: 30,548 buffers, 6.0 ms (service role, same filter by hand: 406 buffers, 0.30 ms)
```

The same shape on `reading_progress_days` (`exists` through `reading_sessions` through `library_entries`:
three levels): the Profile's 83-day query 0.2 -> 2.4 ms, and "since" (`select day ... order by day
limit 1`, a seq scan of the table) 0.14 -> 1.9 ms. All three are O(total rows of everybody), not of
hers, and the first runs on **every Home activation**. Today's production tables are tiny, so the
cost is invisible; at 300k sessions `readInYear` alone would be ~50 ms locally, 0.12-0.45 s on this instance (x2.5-x9).

Fix without touching RLS: SECURITY INVOKER functions that start from her entries, so the planner
drives a nested loop on `reading_sessions_import_key_once` / `reading_sessions_entry`:

```sql
create function public.read_in_year(p_year int) returns bigint language sql stable
set search_path = pg_catalog, public as $$
  select count(*) from library_entries e join reading_sessions s on s.entry_id = e.id
   where e.member_id = (select auth.uid()) and s.outcome = 'finished'
     and s.ended_on between make_date(p_year,1,1) and make_date(p_year,12,31) $$;
```

Measured at S2: `readInYear` 6.7 ms / 30,581 buffers -> **0.57 ms / 585**; "since" 1.6 -> 0.87 ms. The same
treatment suits the Profile's sessions and days (one `profile_record(p_today)` RPC would also let
the client stop paging 1,000 rows with a full Book embedded each: 1.3 MB raw for the heavy member).
The alternative, a denormalised `member_id` on `reading_sessions`/`reading_progress_days` with a
`(member_id, ended_on)` index and a one-column policy, is the textbook fix and makes all of it
cheap, but it is a schema change with a trigger to keep it equal to the entry's member: more risk,
L effort. Risk of the function route: none to RLS (invoker, the policies still apply underneath).
Implementer: Sonnet + pgTAP "member A's count excludes B's reads". Measure again: `home.readInYear`,
`profile.*` at S2; production `reading_sessions` statements.

### F4. The Library request: size, refetch, the 1,000-row cap (impact medium-high, effort M)

**Evidence class: P** (R3: description 1,226 chars average; R1: 151 unfiltered full-Library fetches, 10,323 requests in 4.5 days) **+ L** (payload sizes) **+ C** (the 1,000-row cap, `onActivated` refetch). Rank 3.

Evidence (payload table above): every Home activation (`onActivated(load)`, `pages/index.vue`) asks
for the three lists again, each embedding `books.*`; 304 KB raw (24 KB gzip) at 150 entries, 1.95 MB
(141 KB) for a 1,000-entry member; opening Search runs a fourth full copy
(`catalogue.libraryEntries()`, `stores/search.ts:220`: `library_entries.select(ENTRY_COLUMNS)` with no
filter, no limit). Production: 10,323 requests in ~4.5 days for one member.
PostgREST answers at most `max_rows` = 1,000 rows per request and says nothing (`Content-Range:
0-999/*`): `entries(status)` and `libraryEntries()` do not page (`stats.ts` does, `allPages`), so a
Library with more than 1,000 entries in one status, or 1,000 in total for the search copy, is
silently cut. Not reproduced here (my heavy member has 620 finished); it is PostgREST's documented
behaviour and `supabase/config.toml` says `max_rows = 1000`.
PostgREST sends no `ETag`/`Last-Modified` for these reads, so nothing can be revalidated: the
refetch is always the whole body.

Fixes, in order of value for effort:
1. Do not select `description` in the list (it is read on the Book page; `BOOK_COLUMNS` is used by
   the list and the page alike): ~50 % of the bytes, S, Sonnet. Needs the Book page to read it
   (`books` by id is one request it already makes) - a client/offline-copy decision, flagged for
   the client assessment.
2. `.range()` paging in `entries()` and `libraryEntries()` (correctness at >1,000; S-M, Sonnet).
3. A cheap server stamp so Home can skip the lists when nothing changed: `library_stamp()` returning
   `(count(*), max(greatest(added_at, edition_changed_at, progress_updated_at, ...)))` or a
   per-member counter bumped by the existing write RPCs (`sync_write` and friends run as definer
   already). Home asks for the stamp (0.1 ms), fetches only when it differs from the device's copy.
   M, Sonnet; an `updated_at`-style design question, so Opus should sign off the stamp's definition.
4. One `home()` RPC returning the lists + started series + year count in one response (1 round
   trip instead of 6-8; helps the CORS-preflight problem in F7 too). L, deferred until 1-3 are in.

Measure again: `screens.mjs --screen home` payload columns; production request count per day.

**Fixed** (1 and the refetch half of 3; PR #255): `LIST_BOOK_COLUMNS` leaves `description` (and `owner_id`) out of the three lists, the Library read for search, a Collection's entries and the Profile's reads; the device keeps the descriptions of the Books she has apart and fills them idle (one request per 40 Books, once per Book), so an owned Book still reads in full offline; Home and Library do not ask for the lists, the year count or the series again within 60 s of the last answer (`load({ ifStale })`; back online, the outbox, imports and Retry ask at once). Measured with the client harness (`pnpm perf`, slow4g-4x, 5 runs, load average 5-6, a 150-entry member): per tab switch the three list requests (92.4 KB brotli, 369 KB decoded) are 0; API requests per Home activation 7 -> 2 (95 -> 0.2 KB), per Library activation 5 -> 2 (108 -> 15.6 KB); a visit after the window reads the lists in 32.8 KB brotli (191 KB decoded, -65 %); the Profile's `reading_sessions` 58.2 -> 16.0 KB (293 -> 136 KB decoded); warm start 95 -> 36 KB of API. Long frames at a tab switch were none before and after (the first Library mount's 121-133 ms LoAF is the page mounting, unchanged); Home shown 413 -> 424 ms warm, inside the noise (390-443 ms). The price: a first start on a device now also reads the descriptions once, 67 KB brotli in 4 requests after Home is shown (cold start API 96 -> 103 KB). Not done: `.range()` paging past 1,000 rows (2), a server stamp (3), the `home()` RPC (4); the Profile still reads its sessions on every open; the Library tab still asks for collections, genres and authors (15.6 KB); Search's Library copy (`libraryEntries`) is still the full list, now without descriptions.

### F5. `started_series` + `muted_series_list` do the same work twice (impact medium, effort S)

**Evidence class: P** (statement statistics, EXPLAIN as the member) **+ L** (the duplicate work, the fix). Rank 4.

`stores/series.ts:loadStarted` calls both RPCs in parallel; both run `started_series_items` (a CTE
chain over her entries, sessions and `work_series` with a lateral `NOT EXISTS` per candidate series)
and differ only in the final `muted` filter. Measured: 7.9 + 5.7 ms at 150 entries, 24.6 + 20.5 ms
at 1,000 (4,143-23,346 buffers each). In production `started_series` (21 calls) has a mean of 55 ms (sd 48, max 177, 2,368 buffers per call)
on every Home, and a single EXPLAIN as the member took 174 ms for 3,909 buffers (the same work takes 4-6 ms
here); the muted variant (migration 20261016) is not deployed yet. Fix: one function returning `{ open: [...], muted: [...] }`
from a single evaluation (compute `specific` once, split on `exists (muted_series)`), keep the old two
as wrappers for compatibility. ~45 % off Home's series cost. Risk none (invoker). Sonnet.
`next_in_series` (133 calls in production, mean 54 ms, sd 143, **max 1,528 ms**) is Home's *older* series
query, replaced by `started_series`; the app no longer calls it, so it can be dropped in a later migration
once nothing else does (check the Next sheet first).

**Partly fixed** in PR #238 (20261018040000): the two lists are two requests over one helper, so one evaluation cannot be shared in SQL. `muted_series_list` now answers `[]` after one probe when nothing is muted (2.64 -> 0.02 ms, Home's series cost -39 % for a member without mutes). A member with mutes still runs the chain twice; that needs one client call.

### F6. pg_cron housekeeping (impact low, effort S)

**Evidence class: P** (R6: log 344 kB, job times). Rank 6.

`cron.job_run_details` is written twice per run (3,426 statements, 9.8 s, more than the jobs) and
never trimmed: ~456 rows/day, ~170k a year. Add `cron.schedule('purge-cron-log', '15 3 * * *', $$
delete from cron.job_run_details where end_time < now() - interval '7 days' $$)`. Optionally move
`shelf-publish` to `*/10` (its own `min_interval` is 10 minutes, so the other five runs an hour are
`debounced` no-ops). DeepSeek. Nothing else in the cron set is worth touching.

**Fixed** in PR #238 (20261018030000): `purge-cron-log`, daily 03:15 UTC, `private.purge_cron_log()` deletes rows older than 7 days. `shelf-publish` stays at `*/5`.

### F7. CORS preflight and round trips (closed)

**Evidence class: P** (R5) **+ C** (browser caps). The first version could not tell whether the hosted API
sends `Access-Control-Max-Age`. It does: **3600**, with `apikey,authorization,content-type,x-client-info`
allowed. Chrome honours it (cap 2 h); WebKit caps it at 10 minutes, so an iPhone pays one extra round trip
per distinct URL per 10 minutes, in parallel with the other requests. No proxy and no change needed; the
batching of F4.4 would remove it as a side effect.

### F8. Smaller things

- `latest_session(library_entries)` and `goodreads_rating(books)` are SQL functions with `set
  search_path`, which stops the planner from inlining them: one function call per entry. Without the
  `set` the library list is 20 -> 12.8 ms at 1,000 entries (measured, rolled back). The linter
  (0011 `function_search_path_mutable`) would warn; both bodies already schema-qualify everything.
  Low priority, S, Sonnet, no RLS effect (invoker).
- `sync_write` deletes `synced_writes` older than 60 days on every call and a nightly cron does the
  same (`purge-synced-writes`): the inline delete is redundant (index-backed, ~0.02 ms). Leave.
- `book_authors_readable`, `book_works_readable`, `book_genres_readable`, `book_enrichment_readable`
  evaluate `books_readable` again through `exists (select 1 from books ...)`: 2x buffers on
  `library_genres`, invisible in ms. A `using (true)` on rows keyed by a Catalogue Book would leak
  Manual books' links, so leave the policies as they are.
- `enrich_save` (191 calls, 26 ms mean, the biggest write) looks authors up with `lower(name) =
  lower(...)` and a predicate that does not prove the partial index `authors_name_only`; at 5k
  authors it is still instant. Re-check when `authors` passes 50k.
- `purge_abandoned_signups` deletes from `auth.users` by `email_confirmed_at is null and created_at <
  ...` (seq scan; 42 ms mean in production is cold-cache, not data). Fine until `auth.users` is large.

## API and hosting

- **Compression.** Local PostgREST/Kong send uncompressed JSON (no `Content-Encoding`); the
  gzip column above is what a gzip-capable gateway sends. The hosted Supabase API is behind
  Cloudflare and compresses JSON; I did not probe it (instruction), the first real check is DevTools
  on the Library request. Lists compress ~13x (66 KB -> 5 KB per 100 entries), so the wire cost is
  KB, not MB, and the parse/memory cost on the phone is the bigger part: client assessment.
- **Validators.** PostgREST sends no ETag on table/RPC reads (checked locally: `Content-Range`,
  `Vary: Accept, Prefer, Range`, no `ETag`), so there is no conditional GET; revalidation needs a
  stamp (F4.3).
- **Round trips per screen the server could batch**: Home 6 (3 lists + count + 2 series; +1 `feed`
  with Social), Library 4, Book page 6, Profile 5 (+paging), Search 1-3 per pause + the full-library
  copy when it opens. `library_genres`, `book_series_info`, `book_authors_of`, `book_genres` are
  one-per-book calls that could ride on one `book_page(p_book)` RPC (4 requests -> 1, 8 ms total).
- **Pages Functions** (`web/functions/r/[[path]].js`, `share.js`). `_routes.json` is generated from the
  `functions/` folder, so only `/share` and `/r/*` invoke a Function (the app's own assets and
  pages are static and free); HOSTING.md says so. Per `/r/<token>` request the Function does one
  `fetch` to `rest/v1/rpc/public_reading_page` (4-12 ms at the database, network wait is not CPU), a
  `JSON.stringify` + `crypto.subtle.digest` of the answer, string injection into the 7 KB shell:
  well under the free plan's ~10 ms CPU. `…/og.png` asks the database **first even on a cache hit**
  (so a renewed link stops serving at once): one RPC per image request, 4-12 ms; fine. The one
  thing to remember is the 100,000 requests/day free-plan limit on Function invocations: a pasted
  link that a chat app unfurls by many crawlers costs a few invocations per paste, nowhere near it.
- **Edge functions.** `reading-page-og` (satori + resvg-wasm, four TTF fonts of 138 KB in total, wasm
  initialised once per isolate; ~100 ms CPU warm per README, the platform allows 2 s) is called once
  per link version because the Pages Function caches the PNG under a hashed address
  (`caches.default`, `immutable`, a day); the cold start adds the wasm init and the font reads
  (not measured; the README quotes 100 ms warm). `enrich` is drained by cron every 10 minutes through
  `pg_net` with a 120 s timeout and answers `idle` without a call when the queue is empty; the
  upstreams (Wikidata, Open Library) are the limit, not CPU. `goodreads-rating` allows one upstream
  request a second **per instance** and refuses (`busy`) past a 4 s queue: a 600-book import by one
  member that opens every book page would take ten minutes of single-file lookups; with 300 members
  the answer is cached for 30 days in `goodreads_ratings`, so this only slows *first* views of books
  nobody has opened. `verify_jwt = false` on three functions is deliberate (token or key checked in
  code).
- **Realtime.** Not used: no `.channel()`/`.subscribe()` on the database in `web/app` (the
  `subscribe` hits are the outbox and auth listeners), nor in the social branch. supabase-js opens a
  Realtime socket only on first channel use, so no connections are held. Nothing to tune; nothing
  to pay for. (Social v1 also polls nothing: it refreshes on `onActivated`; the reader polls
  highlights every 60 s while a book is open, one small indexed select.)
- **Storage (avatars).** Private bucket; the owner's own files are downloaded with her session and
  kept on the device (IndexedDB), written with `cacheControl: '31536000'` under content-hashed
  names, so a browser may cache them for a year. Not CDN-cacheable (authenticated requests). With
  Social v1 other members' photos are read through `avatars_select_connected` ->
  `can_see_member_file` -> `can_see_member_folder`: measured **0.09 ms per object**, so the policy is
  not the cost; the cost is one Storage API request per person (200 follows = 200 requests the first
  time on a device). See Social.
- **Cloudflare, from the public site (a plain GET of `https://libellus.fabkho.dev/`).** HTML:
  `cache-control: public, max-age=0, must-revalidate`, weak `ETag`, `content-encoding: br`, 7.0 KB
  decoded (2.1 KB on the wire), 106 ms to the first full response from here; `/_nuxt/*.js`:
  `public, max-age=31536000, immutable` with `cf-cache-status: HIT`, brotli (52 KB for the entry
  chunk); `/sw.js`: `no-cache` + ETag. The shell already carries ~25 `<link rel="modulepreload">`
  tags. All as `web/public/_headers` and HOSTING.md say. Two things the server side cannot tell
  from outside: **Early Hints** (the shell has no `Link` header; Cloudflare derives 103s from the HTML
  preloads when the zone's Speed -> Optimization -> Early Hints is on: check the toggle, the
  modulepreloads are exactly what it wants) and **Speed Brain** (it prefetches the next *document*
  on navigation hints; the app is one document with client-side routing, so there is nothing to
  prefetch: leave it). Web Analytics is on and costs one beacon request per page load.

## Social v1 before it ships

Read from `git show origin/feat/social-v1:supabase/migrations/20261017*` (six files, 2,459 lines),
applied by hand to the throwaway stack on top of S2, seeded with `scripts/perf/seed-social.sql`
(300 members, 30 % private, each follows the next 20 / 50 / 200, 60k follows, 24k activity rows,
~80 per member over a year). Timings: server time of the function, 20 different members, 100 runs
each, warm, authenticated.

| Function | 20 follows | 50 follows | 200 follows | Notes |
| --- | --- | --- | --- | --- |
| `feed(null, null, 30)` p50 / p95 | 5.9 / 6.4 ms | 8.1 / 9.2 ms | **18.0 / 19.5 ms** | keyset page 2: the same (17.8 / 19.2) |
| `my_people()` p50 / p95 | 3.9 / 4.2 | 9.3 / 10.0 | **37.5 / 38.6** | 200 following + 200 followers; 35 KB |
| `member_profile` (followed / stranger) | 2.1 / 2.0 | 2.1 / 2.0 | 2.1 / 2.0 | flat; a 150-entry target |
| `member_reading_record`, `member_want` | 2.2, 1.7 | | | flat |
| `can_see_member_file` (the avatar policy) | 0.09 ms per object | | | |

End to end with PostgREST: `friends` screen (`feed` + `my_people`) 38 / 45 ms p50/p95 at 200 follows;
Home with `feed` and `my_people` added (an upper bound: `my_people` runs on Home only when the feed is empty or
full): 8 requests, 40 / 47 ms p50/p95 for one member, 360 / 423 ms with 20 members at once. On this instance (x2.5-x9) `feed` at 200 follows is ~45-160 ms.

**N1. `feed()` cost is followees x their retained activity, not the page size** (effort M, Opus). The plan:

```
Nested Loop  (actual rows=6000)                                             Buffers: shared hit=69,387   -- 22 ms
  -> Merge Left Join (follows x social_settings)  rows=200
  -> Limit -> Sort (top-N heapsort)  loops=200                              -- one sort per followee
       -> Bitmap Heap Scan on activity a  (rows=82 loops=200)  Filter: CASE kind ...
       -> Index Scan using library_entries_pkey on library_entries e_1  (rows=1 loops=16,393)   -- "not e.hidden"
```

The `limit` sits above the join to `library_entries` (`not e.hidden`) and above a `CASE` filter, so
PostgreSQL cannot stop each followee's `activity_feed` scan after 30 rows: it reads all of the
followee's rows (82 here), joins each to its entry, sorts, keeps 30. Cost grows with follows x
retained activity (13 months): 200 follows x 300 retained rows would be ~3x what I measured.
Not a blocker (19 ms p95 at 200 follows is a good number), but the shape should be fixed while the
feature is new: carry `hidden` (and the kind switch) into the index scan so the inner `limit`
works: either a `hidden boolean` on `activity` kept in step by `set_entry_hidden` (the one writer)
plus a partial index `(member_id, visible_at desc, id desc) where not hidden`, or bound the scan
with `a.visible_at > now() - interval '90 days'` (a feed horizon; the product decides). The
feed's reading of other members' rows is RLS-free definer code; whichever variant, `hidden` and
the blocked/private checks must stay evaluated on the same rows. Opus, because it is feed design
and a visibility rule. Measure again with `scripts/perf/social-bench.sql`.

**N2. `my_people()` is O(people) with several lookups each and runs for a count** (effort S-M, Sonnet).
0.19 ms per person (card = `member_name` from `auth.users` twice + `can_see_photo` -> `reachable` ->
`blocked_either`, `social_of`, two `follows` probes): 38 ms at 200/200. `stores/feed.ts:askFollowing`
calls the whole function just to count `following` whenever the feed is empty (that is, *on every Home
activation of a member who follows people nobody has written about*, and for a new member right after
sign-up). Give the client a count (`following` in a tiny `my_people_counts()`, or a field the feed
returns) and keep `my_people()` for the Friends screen; paginate it beyond ~100 people.

**N3. Triggers on the write path are cheap and quiet where they should be.** A 600-book import with the
social migrations: 1,399 ms against 1,341 ms without (+4 %), 0 activity rows (the call-stack check
`activity_quiet()` works). Single writes through `sync_write`: `add_to_library` 0.22 -> 0.29 ms,
a start + finish pair 0.31 -> 0.50 ms. Both new triggers wrap their bodies in `begin ... exception`,
which is a sub-transaction per row: an import batch of 100 rows now opens ~300 instead of ~100
(`import_books` itself already has an exception block per row), past the 64 per transaction after
which other sessions' snapshots must consult `pg_subtrans` for the second the import runs. Not
worth changing for imports of this size; worth knowing if imports ever run concurrently in
numbers.

**N4. Two foreign keys without an index** (S, DeepSeek): `blocks.blocked_id` and
`follow_link_views.member_id` (advisor 0001 will list them). They matter for
`delete_my_account` (`on delete cascade` scans the table once per child) and for nothing else; add
`create index on public.blocks (blocked_id)` and `... follow_link_views (member_id)`. Everything else
is covered: `follows` by its primary key and `follows_followee`, `activity` by `activity_feed`,
`activity_entry`, `activity_once`, `private.follow_calls` by `(member_id, at)`.

**Fixed** in PR #238 (20261018020000): both indexes added. The private one-row tables (`instance_owner`, `shelf_publish`) stay unindexed on purpose.

**N5. `purge_activity()`** deletes `where created_at < now() - interval '13 months'` with no index on
`created_at`: a sequential scan once a night, ~5 ms at 24k rows, ~50 ms at 300k. Fine; add the index
only if `activity` passes ~1M rows.

**N6. Avatars of the people she follows.** One Storage request per person, authenticated, not
cacheable by the CDN; the policy itself is 0.09 ms. On the Friends screen render only the visible
rows (or the 128 px twin lazily), rely on the hashed immutable names and the year-long
`cacheControl` so the browser HTTP cache serves repeats. A public-by-hash bucket would be CDN-cached
but changes the privacy model written in 20261009120000 ("nobody else has a reason to read it"):
an Opus/owner decision, listed, not recommended by default.

**N7. Home gets heavier.** `Circle.vue` refreshes the feed on mount and on every `onActivated`; Home
becomes 7-8 requests and +6-18 ms database time (+20-40 ms at 20 concurrent members, above). With
F4.3/F4.4 in place the feed can ride the same stamp.

Things I checked and found fine: the only new policy on a public table is `social_settings_select_own`
(`(select auth.uid())`-wrapped, indexed by the primary key); `follows`, `blocks`, `activity`,
`follow_link_views` and `private.*` are RLS-on with no policy and no grant, and every read is a
definer function that starts from `auth.uid()`, the new
`library_entries.hidden` is a constant default (a metadata-only `ALTER` on PG 17), the feed's join
order uses `activity_feed` as intended (`Bitmap Index Scan on activity_feed`, rows=82 per
followee), `blocked_either` is two primary-key probes, `follow()`'s hourly limit reads
`follow_calls (member_id, at)`, `activity_quiet()` checks the cheap conditions before
`GET DIAGNOSTICS pg_context`, and `member_profile`/`member_reading_record`/`member_want` are flat
at ~2 ms. The six new RLS-no-policy tables will show up as INFO lints like the existing ones.

## Requests for the coordinator

R1-R6 are answered (section "Production readings"). Open, all read-only:

**R7 - Early Hints (owner).** Dashboard -> `fabkho.dev` zone -> Speed -> Optimization -> Early Hints: on or
off? A `curl` cannot show 103 responses reliably, so this one needs the owner. Still open.

**R8 - the connection mix** (is 60 a constraint, and what holds the connections):

```sql
select usename, application_name, state, count(*) as n
  from pg_stat_activity where datname = current_database() group by 1, 2, 3 order by n desc;
select name, setting from pg_settings
 where name in ('superuser_reserved_connections', 'reserved_connections', 'cron.max_running_jobs');
```

**R9 - slow tail or slow instance** (the 69 ms `search_books` and the 174 ms `started_series` EXPLAINs against
production minimums of 2.7 ms and 16 ms). One transaction, same member as R4, five runs of each; send every
`Execution Time`:

```sql
begin;
select set_config('request.jwt.claims', json_build_object(
  'sub', (select member_id from public.library_entries group by 1 order by count(*) desc limit 1),
  'role', 'authenticated')::text, true);
set local role authenticated;
explain (analyze, buffers) select * from public.search_books('the', 20);
explain (analyze, buffers) select * from public.search_books('the', 20);
explain (analyze, buffers) select * from public.search_books('the', 20);
explain (analyze, buffers) select * from public.search_books('the', 20);
explain (analyze, buffers) select * from public.search_books('the', 20);
explain (analyze, buffers) select public.started_series(50, 'en');
explain (analyze, buffers) select public.started_series(50, 'en');
explain (analyze, buffers) select public.started_series(50, 'en');
rollback;
```

and, from the dashboard (not SQL), the CPU utilisation graph of the last 5 days: sustained use near the
burst baseline would explain the tail (and would make every factor above worse).

## Reproducing

All of it against a **throwaway** stack only (the seed truncates the Catalogue and every Library and
refuses to run without `-v confirm=throwaway`). Pick ports outside 553xx and 556[2x]:
`project_id = "libellus-perf"` and ports 55660-55669 in a local, uncommitted edit of
`supabase/config.toml`, `supabase start -x studio,mailpit,logflare,vector,imgproxy,edge-runtime,postgres-meta,storage-api,realtime`.

```sh
scripts/perf/measure.sh s2 --members 300 --entries 150 --pool 15000 --heavy-entries 1000
#  seed, EXPLAIN with and without RLS, every screen alone, 20 members at once -> /tmp/perf-results/s2-*.txt
node scripts/perf/screens.mjs --screen home --members 20 --base 2 --rounds 10      # N members at once
node scripts/perf/explain.mjs --member 2 --role authenticated --plans /tmp/plans   # plans as text
docker exec -i supabase_db_libellus-perf psql -U postgres -v member=301 -v books=2000 < scripts/perf/import.sql
docker exec -i supabase_db_libellus-perf psql -U postgres -v member=2 -v n=100 < scripts/perf/writes.sql
docker exec -i supabase_db_libellus-perf psql -U postgres -v member=2 < scripts/perf/proposals.sql   # the fixes, rolled back
# Social v1: apply `git show origin/feat/social-v1:supabase/migrations/20261017*` with psql, then
docker exec -i supabase_db_libellus-perf psql -U postgres -v confirm=throwaway -v follows=200 < scripts/perf/seed-social.sql
docker exec -i supabase_db_libellus-perf psql -U postgres -v runs=100 < scripts/perf/social-bench.sql
docker update --cpus=2 supabase_db_libellus-perf supabase_rest_libellus-perf        # a Micro-like database
```

| File | What |
| --- | --- |
| `scripts/perf/seed.sql`, `seed.sh` | the S0/S1/S2 data (`--members --entries --pool --heavy-entries`) |
| `scripts/perf/queries.sql`, `explain.mjs` | the hot queries as SQL; EXPLAIN as a member, with/without RLS |
| `scripts/perf/screens.mjs`, `jwt.mjs` | per-screen request replay, N members at once, payload sizes; minted JWTs |
| `scripts/perf/import.sql`, `writes.sql` | 600/2,000-book import, `sync_write` per-call cost |
| `scripts/perf/seed-social.sql`, `social-bench.sql` | Social v1 data (follows, activity) and p50/p95 of its readers |
| `scripts/perf/proposals.sql` | the fixes of F1-F3 as runnable, rolled-back sketches |
| `scripts/perf/measure.sh` | one scenario start to finish |

Caveats. Local timings are warm-cache, on an ARM Mac with 18 cores; the production factors (x2.5 best,
x4-9 typical, x15-30 slow runs) come from comparing production's statement statistics and EXPLAINs with
matched local runs; the scatter is as large as the mean. The S2 catalogue (15k Books, 190k works) is
what 300 members with ~150 entries each and some overlap would hold; a community that reads
the same few hundred books would have a smaller Catalogue and a cheaper search. Production's
`pg_stat_statements` window is ~4.5 days of one member. No Storage, Auth or edge-function call was
measured (the stack ran without `storage-api`, `edge-runtime`, `realtime`); their figures above come
from the code and the READMEs, marked as such.
