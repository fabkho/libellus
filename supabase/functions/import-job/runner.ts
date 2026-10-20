/**
 * One chunk of an import job (supabase/migrations/20261102010000_import_jobs.sql): claim the job that holds the import
 * queue's slot (a lease, never two runners on one job), take its pending rows a batch at a time, let `work` look them
 * up and write them (it saves each row as it is done), and stop in time: an edge function lives 150 s and has 2 s of
 * CPU (Supabase Free), so no new batch starts after `budgetMs` of wall clock or once `maxRows` rows were taken (the
 * edge runtime has no CPU clock to read: `process.cpuUsage()` answers zeros there, so the CPU is budgeted by rows,
 * measured at ~16 ms of isolate CPU a row), and `work` is told the hard `deadline` its batch has to end by. Then the job is released: done when no row is pending, else the
 * next chunk is kicked at once by the database (pg_net); a chunk that failed as a whole pauses the job.
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
    cover?: 'own' | 'lent' | 'goodreads' | 'none'
  }

export type ReleaseState = 'done' | 'more' | 'paused' | 'gone'

/** The database side (store.ts: the `import_job_*` RPCs). */
export type Store = {
  claim: (runner: string) => Promise<Job | null>
  takeRows: (job: string, runner: string, limit: number) => Promise<JobRow[]>
  /** Answers whether to go on (false: cancelled, or the lease is another runner's). */
  saveRow: (job: string, runner: string, idx: number, result: RowResult) => Promise<boolean>
  release: (job: string, runner: string, error?: string | null) => Promise<ReleaseState>
}

export type WorkContext = {
  runner: string
  /** The batch has to end by then (epoch ms on `clock`). */
  deadline: number
  /** Saves one row; answers whether to go on. */
  save: (idx: number, result: RowResult) => Promise<boolean>
  /** True once a save was refused: start nothing new. */
  stopped: () => boolean
}

/** Looks a batch of rows up and writes them, saving each (or deferring it). Rejects only when the whole batch failed. */
export type Work = (job: Job, rows: JobRow[], context: WorkContext) => Promise<void>

/** What one chunk did: its state, how many rows it saved in how many batches, and its wall clock. */
export type ChunkResult = { state: 'idle' | ReleaseState; job?: string; saved: number; batches: number; ms?: number; error?: string }

export async function runChunk(options: {
  store: Store
  work: Work
  runner: string
  clock?: Clock
  budgetMs?: number
  deadlineMs?: number
  maxRows?: number
  batchRows?: number
  log?: (message: string) => void
}): Promise<ChunkResult> {
  const { store, work, runner } = options
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
    stopped: () => stop,
  }
  try {
    while (!stop && clock.now() - started < budgetMs && taken < maxRows) {
      const rows = await store.takeRows(job.id, runner, Math.min(batchRows, maxRows - taken))
      if (!rows.length) break
      batches++
      taken += rows.length
      await work(job, rows, context)
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
    log(`import-job: chunk of ${job.id} failed: ${error}`)
  }
  // A refused save: the job was cancelled or another runner has it now; it is not this runner's to release.
  const took = () => ({ ms: clock.now() - started })
  if (stop) return { state: 'gone', job: job.id, saved, batches, ...took() }
  // A chunk that failed after saving rows goes on at once (a passing hiccup); one that saved nothing pauses the job.
  const state = await store.release(job.id, runner, error && saved === 0 ? error.slice(0, 500) : null)
  log(`import-job: ${job.id} chunk ${state}: ${saved} rows in ${batches} batches, ${clock.now() - started} ms`)
  return { state, job: job.id, saved, batches, ...took(), ...(error ? { error } : {}) }
}
