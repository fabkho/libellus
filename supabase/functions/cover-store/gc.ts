/**
 * One GC run (docs/plans/owned-covers.md, §6): the weekly job (`private.cover_gc_weekly`) marks the objects no Library
 * holds any more and posts `{"action":"gc"}`. For the objects orphaned for 30 days and still unused:
 *
 *   1. `cover_gc_claim(100)` holds them (one statement; it cleared the key of any Book still pointing at one) and answers
 *      each key with the widths the database knows;
 *   2. every width is deleted from R2 (`c/<key>/<w>`). An object with NO widths (a `cover_objects` row left by a failure
 *      between the reservation and the upload's end) is listed under `c/<key>/` and what is there is deleted; an object
 *      that is not there counts as deleted (S3/R2 answer 204);
 *   3. `cover_gc_done(keys)` removes the rows whose widths are all deleted; `cover_gc_failed(keys)` keeps the others, released,
 *      for the next weekly run (a half-deleted object is harmless: no Book points at it, and a store puts every width again).
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
    const widths = object.widths && object.widths.length > 0 ? object.widths : await deps.r2.list(object.key, { signal })
    for (const width of widths) await deps.r2.delete(object.key, width, { signal })
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
      if (deleted.length > 0) await deps.store.done(deleted)
      if (failed.length > 0) await deps.store.failed(failed)
      result.deleted += deleted.length
      result.failed += failed.length
      if (objects.length < batch) break
    }
  } finally {
    clearTimeout(timer)
    result.ms = now() - started
    log(`cover-store gc: ${JSON.stringify({ ...result, errors: Object.fromEntries(kinds) })}`)
  }
  return result
}
