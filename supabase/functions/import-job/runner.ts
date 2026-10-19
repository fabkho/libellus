/**
 * One chunk of an import job (supabase/migrations/20261102010000_import_jobs.sql): claim the job that holds the import
 * queue's slot (a lease, never two runners on one job), take its pending rows a batch at a time, let `work` look them
 * up and write them (it saves each row as it is done), and stop in time: an edge function lives 150 s and has 2 s of
 * CPU (Supabase Free), so no new batch starts after `budgetMs` of wall clock or `cpuBudgetMs` of CPU, and `work` is
 * told the hard `deadline` its batch has to end by. Then the job is released: done when no row is pending, else the
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
/** No new batch after this much CPU time (the limit is 2 s; a batch's parsing and image decoding is ~0.2–0.4 s). */
export const CHUNK_CPU_BUDGET_MS = 1300
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

export type ChunkResult = { state: 'idle' | ReleaseState; job?: string; saved: number; batches: number; error?: string }

export async function runChunk(options: {
  store: Store
  work: Work
  runner: string
  clock?: Clock
  /** CPU time used so far (ms), where the platform can say; the chunk ends before the limit. */
  cpu?: () => number | null
  budgetMs?: number
  deadlineMs?: number
  cpuBudgetMs?: number
  batchRows?: number
  log?: (message: string) => void
}): Promise<ChunkResult> {
  const { store, work, runner } = options
  const clock = options.clock ?? realClock
  const budgetMs = options.budgetMs ?? CHUNK_BUDGET_MS
  const deadlineMs = options.deadlineMs ?? CHUNK_DEADLINE_MS
  const cpuBudgetMs = options.cpuBudgetMs ?? CHUNK_CPU_BUDGET_MS
  const batchRows = options.batchRows ?? BATCH_ROWS
  const log = options.log ?? ((message: string) => console.log(message))

  const job = await store.claim(runner)
  if (!job) return { state: 'idle', saved: 0, batches: 0 }
  const started = clock.now()
  const cpuAtStart = options.cpu?.() ?? null
  const cpuUsed = () => {
    const now = options.cpu?.() ?? null
    return now === null || cpuAtStart === null ? 0 : now - cpuAtStart
  }
  let saved = 0
  let batches = 0
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
    while (!stop && clock.now() - started < budgetMs && cpuUsed() < cpuBudgetMs) {
      const rows = await store.takeRows(job.id, runner, batchRows)
      if (!rows.length) break
      batches++
      await work(job, rows, context)
    }
  } catch (thrown) {
    error = thrown instanceof Error ? thrown.message : String(thrown)
    log(`import-job: chunk of ${job.id} failed: ${error}`)
  }
  // A refused save: the job was cancelled or another runner has it now; it is not this runner's to release.
  if (stop) return { state: 'gone', job: job.id, saved, batches }
  // A chunk that failed after saving rows goes on at once (a passing hiccup); one that saved nothing pauses the job.
  const state = await store.release(job.id, runner, error && saved === 0 ? error.slice(0, 500) : null)
  log(`import-job: ${job.id} chunk ${state}: ${saved} rows in ${batches} batches, ${clock.now() - started} ms, ${Math.round(cpuUsed())} ms CPU`)
  return { state, job: job.id, saved, batches, ...(error ? { error } : {}) }
}
