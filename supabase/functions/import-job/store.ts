/**
 * The job's database side: the `import_job_*` RPCs of supabase/migrations/20261102010000_import_jobs.sql, called with
 * the service role. The runner's part (claim, rows, save, release) is `Store` (runner.ts); the member's part (the
 * Catalogue search, the write and the cover fill, each run as the job's member and only for the runner holding the
 * lease) is `MemberCalls`.
 */
import type { CoverResult, CoverRow, Job, JobRow, ReleaseState, RowResult, Store, WriteRow } from './runner.ts'

/** The slice of the Supabase client this needs (a service-role client). */
export type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>

async function call<T>(rpc: Rpc, name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data as T
}

export function createStore(rpc: Rpc): Store {
  return {
    async claim(runner) {
      const rows = await call<Job[] | null>(rpc, 'import_job_claim', { p_runner: runner })
      return rows?.[0] ?? null
    },
    async takeRows(job, runner, limit) {
      return (await call<JobRow[] | null>(rpc, 'import_job_take_rows', { p_job: job, p_runner: runner, p_limit: limit })) ?? []
    },
    async saveRow(job, runner, idx, result: RowResult) {
      return (await call<boolean>(rpc, 'import_job_save_row', { p_job: job, p_runner: runner, p_idx: idx, p_result: result })) === true
    },
    async release(job, runner, error, waitUntil) {
      return await call<ReleaseState>(rpc, 'import_job_release', {
        p_job: job,
        p_runner: runner,
        p_error: error ?? null,
        p_wait_until: waitUntil ? new Date(waitUntil).toISOString() : null,
      })
    },
    async takeCoverRows(job, runner, limit) {
      return (await call<CoverRow[] | null>(rpc, 'import_job_take_cover_rows', { p_job: job, p_runner: runner, p_limit: limit })) ?? []
    },
    async saveCover(job, runner, idx, result: CoverResult) {
      return (await call<boolean>(rpc, 'import_job_save_cover', { p_job: job, p_runner: runner, p_idx: idx, p_result: result })) === true
    },
    async takeWriteRows(job, runner, limit) {
      return (await call<WriteRow[] | null>(rpc, 'import_job_take_write_rows', { p_job: job, p_runner: runner, p_limit: limit })) ?? []
    },
    async saveWrite(job, runner, idx, failure) {
      return (await call<boolean>(rpc, 'import_job_save_write', { p_job: job, p_runner: runner, p_idx: idx, p_result: failure ?? null })) === true
    },
  }
}

/** What `import_books` answered for one row. */
export type WriteOutcome = { key: string; outcome: 'added' | 'imported' | 'in_library' | 'failed'; entry_id?: string | null; error?: string | null }

export type MemberCalls = {
  /** One row through `import_books`, as the member; the outcome is recorded on the job's row with it. */
  write: (idx: number, row: Record<string, unknown>) => Promise<WriteOutcome>
  /** Covers for Catalogue Books that have none (`fill_book_covers`), as the member. */
  fillCovers: (covers: Record<string, unknown>[]) => Promise<void>
  /**
   * A Supabase-client stand-in for `createCatalogueSearch` (web/app/data/catalogueSearch.ts): its `search_books` call
   * goes to `import_job_search_books` (the same search, as the member). Nothing else is answered.
   */
  catalogueClient: { rpc: (name: string, args: Record<string, unknown>) => unknown }
}

/** `rpcBuilder`: the client's own `rpc`, whose answer can be aborted (`abortSignal`), as the Catalogue search needs. */
export function memberCalls(rpc: Rpc, job: string, runner: string, rpcBuilder: (name: string, args: Record<string, unknown>) => unknown = rpc): MemberCalls {
  return {
    async write(idx, row) {
      return await call<WriteOutcome>(rpc, 'import_job_write', { p_job: job, p_runner: runner, p_idx: idx, p_row: row })
    },
    async fillCovers(covers) {
      for (let from = 0; from < covers.length; from += 200) {
        await call<number>(rpc, 'import_job_fill_covers', { p_job: job, p_runner: runner, p_covers: covers.slice(from, from + 200) })
      }
    },
    catalogueClient: {
      rpc(name, args) {
        if (name !== 'search_books') throw new Error(`not for the job: ${name}`)
        return rpcBuilder('import_job_search_books', { p_job: job, p_runner: runner, ...args })
      },
    },
  }
}
