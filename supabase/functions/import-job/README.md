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

Supabase Free gives an edge function 150 s of wall clock and 2 s of CPU; a 709-row import is ~10 minutes of lookups
(Open Library's 3 requests a second are the bottleneck). So one invocation is one chunk (`runner.ts`):

1. `import_job_claim(runner)`: the job holding the import queue's slot, leased to this invocation for 170 s (longer
   than it can live, so a dead runner's lease always runs out). While any lease holds: nothing (never two runners on
   one job). **The runner id must be unique per invocation** (`crypto.randomUUID()`): a lease holds against the same id
   too, so a reused id would only make a second invocation wait.
2. Batches of `BATCH_ROWS` (24) pending rows (`import_job_take_rows`): first pass in file order, then the second pass
   (rows a source could not be asked about the first time). Each row is saved as it is done (`import_job_save_row`).
   No new batch after `CHUNK_BUDGET_MS` (90 s) of wall clock or `CHUNK_CPU_BUDGET_MS` (1.3 s) of CPU; the batch is
   told the hard end (`CHUNK_DEADLINE_MS`, 125 s).
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
(`import_too_soon`), and while her device import still holds a place in the queue (`device_import_running`: the app
leaves the place with `import_slot_leave` first). Cancelling deletes the job's rows. Member-triggered kicks (start,
cancel) are debounced like the tick's. The holder `job:<id>` is reserved: `import_slot_take/beat/leave` refuse it.

## As the member

The job writes for a member who is not in the app, through the very functions the app calls (`search_books`,
`import_books`, `fill_book_covers`): `import_job_search_books`, `import_job_write`, `import_job_fill_covers` set her
claims for their own call only, and only for the runner holding the job's lease (the member comes from the job row,
never from the caller).

## Tests

```
deno lint && deno check *.ts && deno task test
```

On an in-memory store and an injected clock; the database side is pgTAP (`supabase/tests/import_jobs_test.sql`).
