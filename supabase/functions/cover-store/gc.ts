/**
 * One GC run (docs/plans/owned-covers.md, §6): the weekly job (`private.cover_gc_weekly`) marks the objects no Library
 * holds any more and posts `{"action":"gc"}`. For the objects orphaned for 30 days and still unused:
 *
 *   1. `cover_gc_claim(100)` holds them (one statement; it cleared the key of any Book still pointing at one) and answers
 *      each key with the widths the database knows;
 *   2. every width is deleted from R2 (`c/<key>/<w>`): the widths the database knows AND whatever a LIST of exactly
 *      `c/<key>/` finds (an object with no widths, a `cover_objects` row left by a failure between the reservation and the
 *      upload's end; or widths of an earlier store that a later one with another width set did not record). Only claimed
 *      keys are listed. An object that is not there counts as deleted (S3/R2 answer 204);
 *   3. `cover_gc_done(keys)` removes the rows whose widths are all deleted; `cover_gc_failed(keys)` keeps the others, released,
 *      for the next weekly run (a half-deleted object is harmless: no Book points at it, and a store puts every width again).
 *      Both are tried three times; if `done` still throws after the deletes, the keys are handed to `failed` instead, so a row
 *      is never left held (a held row refuses every store of its key until the next weekly claim).
 *
 * Batches go on until a claim comes back short or the deadline passes. **Nothing is deleted while the feature is off:** the
 * claim answers nothing then (the database checks `private.cover_store_settings.enabled` itself), so a hand-posted `gc` does
 * nothing either. Logs carry counts and error kinds, never an address. Framework-free: the store and R2 come in.
 */
import { R2Error, type R2 } from './r2.ts'
import type { GcStore } from './store.ts'

export const GC_BATCH = 100
export const GC_CONCURRENCY = 4
/** No batch is started past this and every request is cut at it: the function lives 150 s. */
export const GC_DEADLINE_MS = 120_000
/** A bound on the loop (a database that kept answering rows would otherwise hold the function until the deadline). */
export const GC_MAX_BATCHES = 20
/** `cover_gc_done` and `cover_gc_failed` are tried this many times. */
export const GC_SETTLE_TRIES = 3

export type GcResult = {
  state: 'idle' | 'ran'
  claimed: number
  deleted: number
  failed: number
  ms: number
}

export type GcDeps = {
  store: GcStore
  r2: R2
  batch?: number
  concurrency?: number
  /** Overrides `GC_DEADLINE_MS` (tests). */
  deadlineMs?: number
  now?: () => number
  /** The wait before the nth retry of `cover_gc_done` / `cover_gc_failed` (tests make it 0). */
  retryDelayMs?: number
  log?: (message: string) => void
}

export async function runGc(deps: GcDeps): Promise<GcResult> {
  const now = deps.now ?? (() => Date.now())
  const started = now()
  const log = deps.log ?? ((message: string) => console.error(message))
  const batch = deps.batch ?? GC_BATCH
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), deps.deadlineMs ?? GC_DEADLINE_MS)
  const result: GcResult = { state: 'idle', claimed: 0, deleted: 0, failed: 0, ms: 0 }
  const kinds = new Map<string, number>()
  const signal = abort.signal

  const remove = async (object: { key: string; widths: number[] | null }) => {
    const widths = [...new Set([...(object.widths ?? []), ...(await deps.r2.list(object.key, { signal }))])]
    for (const width of widths) await deps.r2.delete(object.key, width, { signal })
  }

  const settle = async <T>(call: () => Promise<T>): Promise<T> => {
    for (let attempt = 1;; attempt++) {
      try {
        return await call()
      } catch (error) {
        if (attempt >= GC_SETTLE_TRIES) throw error
        await new Promise((resolve) => setTimeout(resolve, (deps.retryDelayMs ?? 250) * attempt))
      }
    }
  }

  try {
    for (let round = 0; round < GC_MAX_BATCHES && !signal.aborted; round++) {
      const objects = await deps.store.claim(batch)
      if (objects.length === 0) break
      result.state = 'ran'
      result.claimed += objects.length

      const deleted: string[] = []
      const failed: string[] = []
      let next = 0
      const lane = async () => {
        while (next < objects.length) {
          const object = objects[next++]!
          try {
            await remove(object)
            deleted.push(object.key)
          } catch (error) {
            failed.push(object.key)
            const kind = error instanceof R2Error ? (error.status === null ? 'r2_unreachable' : `r2_${error.status}`) : 'error'
            kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? GC_CONCURRENCY, objects.length) }, lane))

      // The rows are settled even when the deadline has passed: what was deleted is deleted, and a row left held would
      // keep a store of that key refused until its lease runs out.
      if (deleted.length > 0) {
        try {
          await settle(() => deps.store.done(deleted))
          result.deleted += deleted.length
        } catch {
          // The database would not take the rows: release them instead (a held row refuses every store of its key). The
          // objects are deleted already, so the next weekly run finds nothing to delete and removes the rows.
          await settle(() => deps.store.failed(deleted))
          result.failed += deleted.length
          kinds.set('done_failed', (kinds.get('done_failed') ?? 0) + deleted.length)
        }
      }
      if (failed.length > 0) {
        await settle(() => deps.store.failed(failed))
        result.failed += failed.length
      }
      if (objects.length < batch) break
    }
  } finally {
    clearTimeout(timer)
    result.ms = now() - started
    log(`cover-store gc: ${JSON.stringify({ ...result, errors: Object.fromEntries(kinds) })}`)
  }
  return result
}
