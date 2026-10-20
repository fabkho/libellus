# import-job

The import as a server job (proposal #329; owner decision 2026-10-19: the member can close the app, the UI shows the
job's progress). The device reads the file as before and uploads its parsed rows (`start_import_job`); this function
looks them up and writes them, in chunks, while nobody waits.

```
POST /functions/v1/import-job   { "action": "run" }       one chunk of the job that holds the import queue's slot

200 { "state": "idle" | "done" | "more" | "paused" | "gone", "job"?, "saved", "batches" }
401 unauthorized · 405 method_not_allowed · 400 action_invalid · 500 failed
```

Callers: the database (pg_net, `private.import_job_kick`) with the Vault secret `import_job_token`, or the owner with
the service-role key. Members never call it.

## Why chunks, and how they chain

Supabase Free gives an edge function 150 s of wall clock and 2 s of CPU; a 709-row import is ~10–20 minutes of
lookups (Open Library's search answers in ~2.4 s and its pace is 3 requests a second for everybody). So one invocation
is one chunk (`runner.ts`):

1. `import_job_claim(runner)`: the job holding the import queue's slot, leased to this invocation for 170 s (longer
   than it can live, so a dead runner's lease always runs out). While any lease holds: nothing (never two runners on
   one job). **The runner id must be unique per invocation** (`crypto.randomUUID()`): a lease holds against the same id
   too, so a reused id would only make a second invocation wait.
2. Batches of `BATCH_ROWS` (24) pending rows (`import_job_take_rows`): first pass in file order, then the second pass
   (rows a source could not be asked about the first time). Each row is saved as it is done (`import_job_save_row`).
   No new batch after `CHUNK_BUDGET_MS` (90 s) of wall clock or `CHUNK_MAX_ROWS` (48) rows: the edge runtime has no
   CPU clock to read (`process.cpuUsage()` answers zeros), so the CPU is budgeted by rows, measured at ~16 ms of
   isolate CPU a row (~0.8 s a chunk). The batch is told the hard end (`CHUNK_DEADLINE_MS`, 125 s).
3. `import_job_release`: `done` when no row is pending (the job leaves the queue); else `more`, and the database
   kicks the next chunk at once through pg_net (**self-chaining**). A chunk that failed before saving anything pauses
   the job (1, 2, 4 … at most 15 minutes, the slot goes to the next import meanwhile).

pg_cron's `import-job-tick` (every minute) is the **safety net**: it kicks a chunk that is due but was not kicked (a
runner killed by the CPU limit, a lost request: its lease ran out), queues paused jobs again, fails a job without
progress for 30 minutes and deletes rows of jobs that ended 30 days ago.

**Idempotent per row.** A saved row is never saved twice; its write (`import_job_write`, the app's own `import_books`
run as the member) is recorded on the row in the same transaction, so a row written by a runner that died before
saving is not written again; a row handed out three times without being saved (it kills its runner) is given up (failed,
unless its write was recorded: that outcome stands). After a crash the suspects (rows handed out twice already) come one
at a time, so the row that kills its runner is found alone.

## Before part 2 deploys

The chain and its safety net live in the database, so these must exist on the project first (the migration only warns
when they are missing: `pg_cron is not here` / `import-job-tick could not be scheduled`):

- **pg_cron** enabled, with `import-job-tick` scheduled (the migration does it; check `select * from cron.job`). Without
  it nothing re-kicks a dead runner or queues a paused job again.
- **pg_net** enabled (the kick is `net.http_post`).
- The **Vault secret** `import_job_token` (= the function's `IMPORT_JOB_TOKEN`) and `private.import_job_settings.function_url`
  set (see the migration's header). Without them `private.import_job_kick` answers `off` / `unavailable` and nothing runs.

## Limits

`start_import_job` refuses: more than 5 MB of rows (`rows_invalid`), a second start within 2 minutes
(`import_too_soon`: it fires within 2 minutes after ANY previous job, finished or cancelled too, so part 3's UI must show it), and while her device import still holds a place in the queue (`device_import_running`: the app
leaves the place with `import_slot_leave` first). Cancelling deletes the job's rows. Member-triggered kicks (start,
cancel) are debounced like the tick's. The holder `job:<id>` is reserved: `import_slot_take/beat/leave` refuse it.

## What a batch does (`work.ts`)

The app's own import code (web/app/data, one implementation: those modules import each other with explicit `.ts`
extensions so Deno can load them, the edge runtime has no "sloppy imports"), wired as the app wires it (`sources.ts`):

**Match**, 8 rows at once (`matchRow` → `findEdition`): the Catalogue first (as the member: `import_job_search_books`),
the ISBN, the title ladder over Open Library (direct, identified with `OPENLIBRARY_CONTACT`, on the `edge_pace` bucket
`openlibrary` shared with the `openlibrary` function) and the National Library (`dnb-lookup`, service role).
**Apple is never asked** (owner decision 2026-10-19): every Apple address gets Apple's own empty answer, so no row is
"unsure" because of it. A first-pass row a source could not be asked about (`unsure`) is deferred to the second pass.
A row's result (`matchResult`) is its verdict (`matched` / `fromFile`), the preview's review tier (`reviewOf`), the
edition summary and the cover it shows (`own` / `lent` / `none`); `outcome` is null.

The match writes nothing (`outcome` is null): it saves what it chose to write with the row (`match_book`, `choice.ts`) and
the write phase (below) writes every row.

## The cover stage (`covers.ts`)

Its own phase, after every row is matched, chunked and resumable like the match: `import_job_take_cover_rows` hands out
rows (nothing before the last row is matched), the runner's `cover` work decides them, `import_job_save_cover` saves
each step. The job is **done when every row has its cover decision** (`import_job_rows.cover_state = 'done'`). Rows
without a cover decision are the only ones the stage ever sees; a row's `cover_source` says by whom it was decided:

| source | how |
| --- | --- |
| `edition` | the matched edition's own cover (decided when the match is saved) |
| `lent` | a cover another edition of its work lends (`coverLender` / `mergeCover`, the app's rules, applied by the match) |
| `openlibrary` | step 1 of the stage: `api/books` by the row's ISBNs (24 rows in one call), else a title + author search for another edition of the work (the cover fill's own request addresses and answer readers, `web/app/data/coverFill.ts`), on the shared Open Library pace |
| `goodreads` | step 2, only once step 1 is through for EVERY row: every row still without a cover that has a title and an author, ISBN first, then the full title, then the short title (`goodreads-rating`'s cover route, `createGoodreadsCover`); one ask every 1.6 s on the shared pace (`edge_pace` bucket `goodreads-cover`) |
| `none` | nothing found, or given up |

**Apple is never asked** here (its one-time upgrade runs on the device, #374).

Goodreads has **no time budget and no "three failures and stop"**: an `unsure` answer (every search came back empty:
unknown, or throttled softly) or a failed ask is retried later in the job, up to 3 tries at least 30 s apart (a later chunk;
the third gives `none`); `found` with no cover or `not_found` is final; `blocked` **pauses the job** for 10 minutes
(`context.waitUntil` → `import_job_release(…, p_wait_until)`: it gives the slot up, the tick queues it again, no fault, no
stall) and goes on in a later chunk, the row not charged; a batch in which nothing at all was answered fails as a whole
(the runner's pause with backoff). Rows waiting for their retry with nothing else due pause the job the same way (no
hot loop of empty chunks). An Open Library call that fails asks the row once more in the next chunk, then goes on to Goodreads.

Stored per row: `cover_url` (the address, never the image), `cover_source`, `cover_size` (`S`/`M`/`L`, only when the
address says it: Open Library's `-L.jpg`, Goodreads' `…l/`). **No image probe**: decoding an image and its thumbhash cost
CPU the Free plan's 2 s does not have (the old WIP's probe was removed for that), so the stage reads no image; the thumbhash
and colours come later with the Library's cover. The job's counters, `import_jobs.cover_edition / cover_lent /
cover_openlibrary / cover_goodreads / cover_none` (their sum is the rows decided), say how many rows have a cover by source
and how many have none. A row handed out three times without being saved is given up (`none`).

## The write phase (`write.ts`, `choice.ts`)

Its own phase, after every row is matched and has its cover decision, chunked and resumable like the others
(`import_job_take_write_rows` hands rows out, never before the cover stage is through; `import_job_save_write` marks one
written). Owner decision 2026-10-19: **no review step, every row is written** to the member's Library, exactly as the app's
import writes it:

- the row is the app's `ImportRow` (`choice.ts` `importRowOf`): the match's Book (a Catalogue Book / her Manual book by id, or
  a source's snapshot), else the file's own row (an `import` Book, a Goodreads-only Book with its Goodreads cover), with the
  cover the job decided (`cover_url`); `importArguments` (`web/app/data/bookImport.ts`) makes the `import_books` argument of
  it, so statuses, dates, ratings, reads and shelves (the Collections she kept, uploaded with the row) are the app's one
  mapping, not a copy;
- one row at a time through `import_job_write` (`import_books` as the member): the outcome (`added` / `imported` /
  `in_library` / `failed` + reason) is recorded on the row **in the same transaction** as the write;
- then the covers: Catalogue Books that got a cover in the job (Open Library's, Goodreads', a sibling edition's lent one;
  a snapshot's cover for the Catalogue Book of its ISBN) go to `fill_book_covers` as the member
  (`fillCatalogueCovers`, the app's own rule of which). It gives a cover to a Book she holds **that has none**, from an
  allow-listed address, only: a cover another member's upgrade put there, another edition's cover and her own cover choice
  (another Book / entry) are never overwritten. The job never sends `replaces` (the #374 compare-and-swap is for Apple's
  artwork, and the device's one-time upgrade does that later); a failure costs nothing, as in the app;
- then `import_job_save_write` marks the row written and counts its outcome.

**Counters** (`import_jobs.added / kept / failed`): rows by outcome, each counted once, by whoever sets the row's
`write_state` to `done` (`kept` = imported + in_library: already in her Library). `added + kept + failed` is the rows
written; `done` is still the rows matched. **The job is `done` when every row has its outcome** (`import_job_release`).

**Idempotent per row**: a row already written answers its recorded outcome (a second `import_job_write` writes nothing, a
second save counts nothing); a row handed out three times without being saved is given up (failed `gave_up`, unless its
write was recorded: that outcome stands), the suspects after a crash come one at a time. A row `import_job_write` refuses
(`row_invalid`) is failed with that reason; any other error fails the batch (the chunk pauses with backoff). A job that is
done, failed (stalled) or cancelled gives its place in the queue up (`import_job_dequeue`).

## As the member

The job writes for a member who is not in the app, through the very functions the app calls (`search_books`,
`import_books`, `fill_book_covers`): `import_job_search_books`, `import_job_write`, `import_job_fill_covers` set her
claims for their own call only, and only for the runner holding the job's lease (the member comes from the job row,
never from the caller).

## Deploy

```
supabase secrets set IMPORT_JOB_TOKEN=<a long random secret>        # OPENLIBRARY_CONTACT is set already (openlibrary)
supabase functions deploy import-job
```

then, once, in the SQL editor:

```sql
update private.import_job_settings set function_url = 'https://<ref>.supabase.co/functions/v1/import-job';
select vault.create_secret('<the same IMPORT_JOB_TOKEN>', 'import_job_token');
```

Without them nothing is kicked (the local stack, CI): jobs wait in line.

## Tests

```
deno lint && deno check *.ts && deno task test
```

The runner on an in-memory store and an injected clock; the batch (`work_test.ts`), the cover stage (`covers_test.ts`) and the write phase (`write_test.ts`: stubbed member calls) on
Open Library's recorded answers (`fixtures/openlibrary.json`, `record_fixtures.ts`) and the `goodreads-rating` function's
recorded answers (found / unsure / blocked / none / not answering). The database side is pgTAP
(`supabase/tests/import_jobs_test.sql`, `import_job_covers_test.sql`, `import_job_write_test.sql`: it includes a second run of the same file writing nothing).
