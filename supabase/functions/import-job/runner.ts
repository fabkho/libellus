/**
 * One chunk of an import job (supabase/migrations/20261102010000_import_jobs.sql): claim the job that holds the import
 * queue's slot (a lease, never two runners on one job), take its pending rows a batch at a time, let `work` look them
 * up and write them (it saves each row as it is done), and stop in time: an edge function lives 150 s and has 2 s of
 * CPU (Supabase Free), so no new batch starts after `budgetMs` of wall clock or once `maxRows` rows were taken (the
 * edge runtime has no CPU clock to read: `process.cpuUsage()` answers zeros there, so the CPU is budgeted by rows,
 * measured at ~16 ms of isolate CPU a row), and `work` is told the hard `deadline` its batch has to end by. Then the job is released: done when no row is pending, else the
 * next chunk is kicked at once by the database (pg_net); a chunk that failed as a whole pauses the job.
 *
 * Three phases, each in chunks: the match (`work`); once no row is left to match the cover stage (`cover`: its own
 * phase, rows taken by `takeCoverRows`, each step saved by `saveCover`); once every row has its cover decision the write
 * (`write`: rows taken by `takeWriteRows`, each written to the member's Library and saved by `saveWrite`). The job is done
 * when every row has its outcome (added / kept / failed). A cover batch may end the chunk waiting (`context.waitUntil`:
 * Goodreads blocked): the job pauses until then, with no fault, and goes on in a later chunk.
 *
 * Idempotent per row: a row is saved once (`import_job_save_row` ignores a second save), its write is recorded with
 * the write (`import_job_write`), and a runner that dies leaves its rows pending: the next claim (after the lease
 * ran out) takes them again. Framework-free: the store, the work and the clock come in from outside.
 */

/** No new batch after this much wall clock: a batch takes ~40 s, the function lives 150 s. */
export const CHUNK_BUDGET_MS = 90_000
/** The hard end a batch is told: what it has not finished by then stays pending for the next chunk. */
export const CHUNK_DEADLINE_MS = 125_000
/**
 * No new batch once this many rows were taken: the CPU limit is 2 s, and a row costs ~16 ms of isolate CPU (measured on
 * the member's file: the lookups' requests and JSON, the ranking, a cover's decode and thumbhash), so 48 rows are
 * ~0.8 s, with room for a slower machine and the function's start.
 */
export const CHUNK_MAX_ROWS = 48
/** Rows taken at once: enough for one Open Library `api/books` call of the cover fill (25). */
export const BATCH_ROWS = 24

export type Clock = { now: () => number }
export const realClock: Clock = { now: () => Date.now() }

/** The job as the claim answers it (the columns the runner reads). */
export type Job = { id: string; member_id: string; source: string; languages: string[]; total: number; done: number }

/** One pending row: the file's row as the device parsed it, and which pass it is in (1: a source failed the first time). */
export type JobRow = { idx: number; key: string; payload: Record<string, unknown>; pass: number; attempts: number }

/** What a row came to, or `defer` for a first-pass row a source could not be asked about (it comes back in the second). */
export type RowResult =
  | { defer: true }
  | {
    verdict: 'matched' | 'fromFile' | 'inLibrary' | 'imported'
    tier: 'quiet' | 'probablyFine' | 'needsLook'
    outcome: 'added' | 'imported' | 'in_library' | 'failed' | null
    entry_id?: string | null
    error?: string | null
    edition?: unknown
    cover?: 'own' | 'lent' | 'hardcover' | 'goodreads' | 'none'
    /** The address of the cover the match shows (`cover` is not `none`), and its size when the address says it. */
    cover_url?: string | null
    cover_size?: CoverSize | null
    /** What the write needs of the match (`WriteChoice`, write.ts): the Book the row is written with. Saved with the row (`match_book`). */
    write?: unknown
  }

export type CoverSize = 'S' | 'M' | 'L'

/** A row for the cover stage: the row, the match's edition, and which step it is in (Open Library, then Goodreads) and how often it was asked. */
export type CoverRow = { idx: number; key: string; payload: Record<string, unknown>; edition: unknown; cover_state: 'pending' | 'goodreads'; cover_tries: number }

/** What a row's cover step came to (`import_job_save_cover`): decided, sent on to Goodreads, or to be asked again after `wait_seconds`. */
export type CoverResult =
  | { source: 'openlibrary' | 'goodreads'; url: string; size?: CoverSize | null }
  | { source: 'none' }
  | { next: 'goodreads' }
  | { retry: true; wait_seconds: number }

/**
 * A row for the write phase: the file's row, what the match chose to write (`match_book`), the cover the job decided for it
 * and the outcome when its write was recorded already (a runner died after writing it).
 */
export type WriteRow = {
  idx: number
  key: string
  payload: Record<string, unknown>
  match_book: unknown
  cover_source: 'edition' | 'lent' | 'hardcover' | 'openlibrary' | 'goodreads' | 'none' | null
  cover_url: string | null
  cover_size: CoverSize | null
  outcome: WrittenOutcome | null
}

export type WrittenOutcome = 'added' | 'imported' | 'in_library' | 'failed'

/** A row `import_books` could not even be asked about: failed, with the reason (`import_job_save_write`). */
export type WriteFailure = { outcome: 'failed'; error: string }

export type ReleaseState = 'done' | 'more' | 'paused' | 'gone'

/** The database side (store.ts: the `import_job_*` RPCs). */
export type Store = {
  claim: (runner: string) => Promise<Job | null>
  takeRows: (job: string, runner: string, limit: number) => Promise<JobRow[]>
  /** Answers whether to go on (false: cancelled, or the lease is another runner's). */
  saveRow: (job: string, runner: string, idx: number, result: RowResult) => Promise<boolean>
  /** `waitUntil` (epoch ms): the chunk ends waiting (Goodreads blocked), the job pauses until then, with no fault. */
  release: (job: string, runner: string, error?: string | null, waitUntil?: number | null) => Promise<ReleaseState>
  /** The next rows to decide a cover for (never before every row is matched; Open Library's step before Goodreads'). */
  takeCoverRows: (job: string, runner: string, limit: number) => Promise<CoverRow[]>
  /** Answers whether to go on, as `saveRow`. */
  saveCover: (job: string, runner: string, idx: number, result: CoverResult) => Promise<boolean>
  /** The next rows to write (never before every row is matched and has its cover decision). */
  takeWriteRows: (job: string, runner: string, limit: number) => Promise<WriteRow[]>
  /** Marks a row written (its outcome was recorded with the write; `failure` records one for a row that could not be written at all). Answers whether to go on. */
  saveWrite: (job: string, runner: string, idx: number, failure?: WriteFailure) => Promise<boolean>
}

export type WorkContext = {
  runner: string
  /** The batch has to end by then (epoch ms on `clock`). */
  deadline: number
  /** Saves one row; answers whether to go on. */
  save: (idx: number, result: RowResult) => Promise<boolean>
  /** True once a save was refused, or the chunk was told to wait: start nothing new. */
  stopped: () => boolean
  /** Saves one row's cover step; answers whether to go on. */
  saveCover: (idx: number, result: CoverResult) => Promise<boolean>
  /** Marks one row written (the write phase); answers whether to go on. */
  saveWrite: (idx: number, failure?: WriteFailure) => Promise<boolean>
  /** Ends the chunk after this batch and pauses the job until `untilMs` (epoch ms on the clock): a source said to wait. */
  waitUntil: (untilMs: number) => void
}

/** Looks a batch of rows up and writes them, saving each (or deferring it). Rejects only when the whole batch failed. */
export type Work = (job: Job, rows: JobRow[], context: WorkContext) => Promise<void>

/** Decides the cover of a batch of matched rows (covers.ts), saving each step (`context.saveCover`). Rejects only when the whole batch failed. */
export type CoverWork = (job: Job, rows: CoverRow[], context: WorkContext) => Promise<void>

/** Writes a batch of rows to the member's Library and the Catalogue Books' covers (write.ts), saving each (`context.saveWrite`). Rejects only when the whole batch failed. */
export type WriteWork = (job: Job, rows: WriteRow[], context: WorkContext) => Promise<void>

/** What one chunk did: its state, how many rows it saved in how many batches, and its wall clock. */
export type ChunkResult = { state: 'idle' | ReleaseState; job?: string; saved: number; batches: number; ms?: number; error?: string }

export async function runChunk(options: {
  store: Store
  work: Work
  /** The cover stage, after every row is matched; without it the stage is not run (the rows keep waiting for it). */
  cover?: CoverWork
  /** The write phase, after every row has its cover decision; without it the phase is not run (the rows keep waiting for it). */
  write?: WriteWork
  runner: string
  clock?: Clock
  budgetMs?: number
  deadlineMs?: number
  maxRows?: number
  batchRows?: number
  log?: (message: string) => void
}): Promise<ChunkResult> {
  const { store, work, runner } = options
  const coverWork = options.cover
  const writeWork = options.write
  const clock = options.clock ?? realClock
  const budgetMs = options.budgetMs ?? CHUNK_BUDGET_MS
  const deadlineMs = options.deadlineMs ?? CHUNK_DEADLINE_MS
  const maxRows = options.maxRows ?? CHUNK_MAX_ROWS
  const batchRows = options.batchRows ?? BATCH_ROWS
  const log = options.log ?? ((message: string) => console.log(message))

  const job = await store.claim(runner)
  if (!job) return { state: 'idle', saved: 0, batches: 0 }
  const started = clock.now()
  let saved = 0
  let batches = 0
  let taken = 0
  let stop = false
  let waitUntil: number | null = null
  let error: string | undefined
  const context: WorkContext = {
    runner,
    deadline: started + deadlineMs,
    async save(idx, result) {
      if (stop) return false
      const go = await store.saveRow(job.id, runner, idx, result)
      if (go) saved++
      else stop = true
      return go
    },
    async saveCover(idx, result) {
      if (stop) return false
      const go = await store.saveCover(job.id, runner, idx, result)
      if (go) saved++
      else stop = true
      return go
    },
    async saveWrite(idx, failure) {
      if (stop) return false
      const go = await store.saveWrite(job.id, runner, idx, failure)
      if (go) saved++
      else stop = true
      return go
    },
    waitUntil(untilMs) {
      waitUntil = Math.max(waitUntil ?? 0, untilMs)
    },
    stopped: () => stop || waitUntil !== null,
  }
  try {
    while (!context.stopped() && clock.now() - started < budgetMs && taken < maxRows) {
      const limit = Math.min(batchRows, maxRows - taken)
      const rows = await store.takeRows(job.id, runner, limit)
      if (rows.length) {
        batches++
        taken += rows.length
        await work(job, rows, context)
        continue
      }
      // Every row is matched (or taken): the cover stage, its own phase, in chunks like the match.
      const covers = coverWork ? await store.takeCoverRows(job.id, runner, limit) : []
      if (covers.length) {
        batches++
        taken += covers.length
        await coverWork!(job, covers, context)
        continue
      }
      // Every row has its cover decision (or is waiting for its retry): the write phase, the third, in chunks like the others.
      if (!coverWork || !writeWork) break
      const writes = await store.takeWriteRows(job.id, runner, limit)
      if (!writes.length) break
      batches++
      taken += writes.length
      await writeWork(job, writes, context)
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
    log(`import-job: chunk of ${job.id} failed: ${error}`)
  }
  // A refused save: the job was cancelled or another runner has it now; it is not this runner's to release.
  const took = () => ({ ms: clock.now() - started })
  if (stop) {
    log(`import-job: ${job.id} chunk gone (lease lost or job cancelled): ${saved} rows in ${batches} batches`)
    return { state: 'gone', job: job.id, saved, batches, ...took() }
  }
  // A chunk that failed after saving rows goes on at once (a passing hiccup); one that saved nothing pauses the job.
  const state = await store.release(job.id, runner, error && saved === 0 ? error.slice(0, 500) : null, waitUntil)
  log(`import-job: ${job.id} chunk ${state}: ${saved} rows in ${batches} batches, ${clock.now() - started} ms`)
  return { state, job: job.id, saved, batches, ...took(), ...(error ? { error } : {}) }
}
