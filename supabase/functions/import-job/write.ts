/**
 * The write phase of an import job (`WriteWork`, runner.ts): its own phase after every row is matched and has its cover
 * decision (supabase/migrations/20261104010000_import_job_write.sql), in chunks, resumable. Owner decision 2026-10-19: no
 * review step, EVERY row is written to the member's Library, exactly as the app's import writes it today:
 *
 *   - the row is the app's `ImportRow` (choice.ts: the match's Book, else the file's own row: an import Book, a Goodreads-only
 *     Book with its Goodreads cover; the cover the job decided), and `importArguments` (web/app/data/bookImport.ts) makes
 *     the `import_books` argument of it: the app's mapping of statuses, dates, ratings, reads and shelves, not a copy;
 *   - one row at a time through `import_job_write` (`import_books` as the member): its outcome (added / imported /
 *     in_library / failed) is recorded on the row with the write, in one transaction, so a row is never written twice: a
 *     second call (a runner that died before saving) answers the recorded outcome and writes nothing;
 *   - then, for the Catalogue Books that got a cover in the job (and a snapshot's cover for the Catalogue Book of the same
 *     ISBN), `fill_book_covers` as the member (`fillCatalogueCovers`, the app's own rule of which): it gives a cover to
 *     a Book she holds that has none, only from an allow-listed address, so another member's cover, her own cover choice
 *     and a cover the Apple upgrade put there are never overwritten (no `replaces`: that is the device's one-time upgrade);
 *     a failure costs nothing, as in the app;
 *   - then each row is saved written (`context.saveWrite`), which counts its outcome (added / kept / failed).
 *
 * A row `import_job_write` refuses (`row_invalid`) is failed with that reason; any other error fails the batch (the
 * runner pauses the job with backoff, the rows stay pending, and a row that kills its runners is given up by the database).
 * Framework-free: the member's calls come in from outside.
 */
import { fillCatalogueCovers, importArguments } from '../../../web/app/data/bookImport.ts'
import type { SupabaseClient } from '@supabase/supabase-js'
import { importRowOf } from './choice.ts'
import type { Job, WorkContext, WriteRow, WriteWork, WrittenOutcome } from './runner.ts'
import type { MemberCalls } from './store.ts'
import { eachLimited, SAVE_RESERVE_MS } from './work.ts'

/** Rows written at once (each is one RPC: the database does the work). */
export const WRITE_CONCURRENCY = 4

export type WriteDeps = {
  /** The member's calls of one chunk (store.ts `memberCalls`), for this job and runner. */
  member: (job: Job, runner: string) => Pick<MemberCalls, 'write' | 'fillCovers'>
  now?: () => number
  log?: (message: string) => void
}

export function createWriteWork(deps: WriteDeps): WriteWork {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((message: string) => console.log(message))

  return async (job: Job, rows: WriteRow[], context: WorkContext) => {
    // Too late for a batch: its rows stay pending for the next chunk.
    if (context.deadline - now() <= SAVE_RESERVE_MS) return
    const calls = deps.member(job, context.runner)
    const began = now()
    const written: { row: WriteRow; prepared: ReturnType<typeof importRowOf>; outcome: WrittenOutcome }[] = []
    const refused: { row: WriteRow; error: string }[] = []
    let crashed: unknown = null

    await eachLimited(rows, WRITE_CONCURRENCY, async (row) => {
      if (crashed || context.stopped() || now() >= context.deadline - SAVE_RESERVE_MS) return
      try {
        const prepared = importRowOf(row)
        // A write recorded before (a runner died before saving the row) stands: nothing is written twice.
        const outcome = row.outcome ?? (await calls.write(row.idx, importArguments(prepared))).outcome
        written.push({ row, prepared, outcome })
      } catch (error) {
        if (error instanceof Error && error.message.includes('row_invalid')) refused.push({ row, error: 'row_invalid' })
        else crashed ??= error
      }
    })

    // The covers found for the Catalogue Books, once the rows are in her Library (a failure costs nothing).
    const covers = written.filter(({ outcome }) => outcome !== 'failed').map(({ prepared }) => prepared)
    await fillCatalogueCovers(
      { rpc: (_name: string, args: { p_covers: Record<string, unknown>[] }) => calls.fillCovers(args.p_covers) } as unknown as SupabaseClient,
      covers.filter((row) => row.book.coverUrl && (!('id' in row.book) || row.coverFilled)).map((row) => row.book),
    )

    let saved = 0
    for (const { row } of [...written].sort((a, b) => a.row.idx - b.row.idx)) {
      if (!(await context.saveWrite(row.idx))) break
      saved++
    }
    for (const { row, error } of refused) {
      if (!(await context.saveWrite(row.idx, { outcome: 'failed', error }))) break
      saved++
    }
    log(`import-job: batch of ${rows.length}: ${saved} written, ${refused.length} refused, ${now() - began} ms`)
    if (crashed) throw crashed
  }
}
