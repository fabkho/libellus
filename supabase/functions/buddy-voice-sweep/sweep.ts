/**
 * The sweep of the `buddy-voice` bucket (pure logic: index.ts wires it to the database and the Storage API, sweep_test.ts runs it
 * with fakes). The database says which objects may go (`public.buddy_voice_sweep_batch`: the queued objects of deleted messages and
 * the uploads no message points at after a day); this removes them through the Storage API, because the database may not delete a
 * storage object itself, and reports what went (`public.buddy_voice_sweep_done`).
 */

/** What the sweep needs from the outside. */
export type SweepDeps = {
  /** `buddy_voice_sweep_batch(p_limit)`: the objects to remove now. */
  batch(limit: number): Promise<string[]>
  /** Removes the objects through the Storage API; the names it reports removed. */
  remove(paths: string[]): Promise<string[]>
  /** `buddy_voice_sweep_done(p_paths)`: forgets the removed queued paths. */
  done(paths: string[]): Promise<void>
}

export type SweepResult = { removed: number; rounds: number }

export const BATCH_LIMIT = 100
export const MAX_ROUNDS = 10

/**
 * Takes batches until the database names nothing more, a batch was the last (shorter than the limit) or nothing in it could be
 * removed (so a path the Storage API keeps refusing cannot loop). A run is bounded to MAX_ROUNDS batches; the hourly job picks up
 * the rest.
 */
export async function sweep(deps: SweepDeps, limit = BATCH_LIMIT, maxRounds = MAX_ROUNDS): Promise<SweepResult> {
  let removed = 0
  let rounds = 0
  while (rounds < maxRounds) {
    const paths = await deps.batch(limit)
    if (paths.length === 0) break
    rounds++
    const gone = await deps.remove(paths)
    if (gone.length > 0) await deps.done(gone)
    removed += gone.length
    if (paths.length < limit || gone.length === 0) break
  }
  return { removed, rounds }
}

/** The names in the Storage API's answer to a bulk delete (`[{ name, … }]`). */
export function removedNames(answer: unknown): string[] {
  if (!Array.isArray(answer)) return []
  return answer
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string')
}
