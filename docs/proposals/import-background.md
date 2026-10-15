# Proposal: the import as a background job, with a Web Push when it is done

Status: proposal (owner approved the direction on 12 Oct 2026; not built). Notifications were a v1 non-goal (`SPEC.md`):
this moves one of them into scope. Nothing here changes the preview.

## Why

Today the whole import runs in the browser: the lookup, the cover fill and the write. A page in the background is
suspended by iOS and throttled by Android, so a member has to keep the app open for minutes (about 2 on 80 hard rows, about
10 on 700). Goal: press Import, leave, get a push when it is finished. Progress stays visible as now, but it is read from the
database, not computed on the device.

## Shape

1. **On the device, as now:** pick the file, parse it, look up every row (Catalogue, Open Library, Apple, DNB), show the
   preview, let her fix rows and choose editions. The lookup is interactive (she reviews its result), so it stays here.
   *Option for later:* run the lookup as a job too, with a "review when ready" step; the preview then reads the job's matches.
2. **Import pressed:** one RPC `start_import_job(p_rows jsonb, p_options jsonb)` stores the confirmed rows (the chosen edition,
   the entry fields, the shelves) in `import_jobs` / `import_job_rows` and returns the job id. The screen subscribes to the job
   (Realtime, or a poll every 3 s as fallback) and shows the same progress line and counts.
3. **Worker:** an Edge Function driven by a queue (a `pg_cron` tick, or Supabase Queues) takes a job in chunks of ten rows:
   write them (`import_books`, unchanged: one savepoint per row), then fill covers by the ranking (`data/coverRank.ts`,
   `mergeSources`): Catalogue, Open Library by ISBN and work, Goodreads (rows from a Goodreads file only, flagged), Apple
   as an upgrade lane. The code is the same framework-free modules the client uses (`coverFill`, `mergeBook`), run in Deno.
4. **Done:** the job row goes to `done` (counts: added, already hers, failed, covers found); a Web Push is sent if she
   allowed it; else the banner on next open and, as the last fallback, the existing mail channel.

## Tables (sketch)

- `import_jobs(id, member_id, state: queued|running|done|failed|cancelled, total, written, covers_found, created_at,
  started_at, finished_at, error, notify boolean)`; RLS: a member reads and cancels her own; only definer functions and the
  service role write. One running job per member.
- `import_job_rows(job_id, idx, key, payload jsonb, outcome, error)`; payload is what `import_books` takes today; deleted
  30 days after the job (personal data: a job keeps counts, not rows).
- `push_subscriptions(member_id, endpoint, p256dh, auth, user_agent, created_at)`; the endpoint is private to the member.
- `source_budget(source, window_start, used)` for the global limits below.

## The Apple limit and other shared limits

Apple counts about 20 calls a minute per source address, and an Edge Function's address is shared and not ours to choose, so
parallel jobs share one budget at best and an unpredictable one at worst. The design does not depend on it:

- **One global budget per source** (`source_budget`, a token bucket in the database, taken with a function like
  `edge_rate_hit`): Apple about 20/min, Goodreads about 60/min (1 per second per instance), Open Library by cover id
  unlimited, `api/books` by ISBN batched. Jobs queue for a token, oldest first; a job is never blocked on Apple.
- **Apple is an upgrade lane:** a job finishes with the Catalogue, Open Library and Goodreads. Apple's ebook lookup runs
  after, from the queue, and replaces a lower-ranked cover when it arrives (the rule exists: `mergeCover`, `Edition.coverKind`).
  Capacity is about 1,200 calls an hour for everyone together.
- **Fewer calls:** Catalogue first; Apple only for a row without an edition-exact cover; every answer, hit or miss, cached by
  ISBN or title key; the Catalogue keeps what was found, so no book is asked twice by anyone (`fill_book_covers`). A
  multi-ISBN Apple lookup may cut calls (to be verified, my test was inconclusive).
- **Not a design goal:** spreading calls over addresses to multiply a published limit. Where a member's own device is the
  natural unit (as today), the client may run the Apple upgrade from her address on the next open, as a fallback.
- Block handling: every source has a breaker like Goodreads' (`goodreads_blocked` log line, 10 min, never cached);
  a blocked source is skipped and the cloth stays.

## Web Push

- **Permission:** asked from a tap on "Benachrichtige mich, wenn der Import fertig ist" next to the Import button, never on
  load. Without it the job runs the same; she is told on next open.
- **Platforms:** Android Chrome and desktop: works in the browser. iOS 16.4 or later: only for the app added to the Home
  Screen (a PWA), the permission asked from a tap; plain Safari cannot. The copy says so when the app is not installed.
  The native apps use APNs and FCM with the same `push_subscriptions` idea.
- **Send:** the worker sends the push at `done` and `failed` (VAPID keys as function secrets, payload `{title, body, url}`,
  no personal data beyond the counts); the service worker (`nuxt.config.ts`, Workbox `injectManifest` or a small push
  handler) shows it and opens `/import` on tap. A 404/410 from the push service deletes the subscription.
- **Copy (German first):** while running: "Import läuft. Du kannst die App schließen, wir benachrichtigen dich, wenn er fertig ist."
  Push: "Import fertig: 612 Bücher hinzugefügt, 18 brauchen einen Blick." Failed: "Der Import konnte nicht abgeschlossen werden. Tippe, um
  es erneut zu versuchen." (English in the same keys; wording to match nearby strings before building.)

## Steps (small PRs, each shippable)

1. Wake Lock + a persistent "keep the app open" banner for the current client import (no infra).
2. `import_jobs`, `start_import_job`, the worker for the write only; progress from the job row; same results as today.
3. Move the cover fill into the worker with `source_budget`; Apple as the upgrade lane.
4. `push_subscriptions`, VAPID, service-worker handler, the permission tap, the push at `done`; mail/banner fallback.
5. Optional: the lookup as a job too.

## Risks and open points

- Pushing needs the app installed on iOS; the fallbacks must be good.
- A job writes for a member who is not in the app: it runs as that member through definer functions checked against
  `member_id` (never the service role writing arbitrary rows); the RPC validates the payload as `import_books` does.
- Costs: Edge Function time per job (about 10 s per chunk of ten at today's speed, mostly waiting on sources); decide
  Supabase Queues vs `pg_cron` after a small spike.
- Terms: the Goodreads stage stays flagged (PR #327); a server job makes the one place that calls it easier to switch off.
