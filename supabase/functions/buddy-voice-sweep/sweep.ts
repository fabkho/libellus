/**
 * The sweep of the voice buckets, `buddy-voice` (a buddy read's voice messages) and `note-voice` (the private voice notes of Notes)
 * (pure logic: index.ts wires it to the database and the Storage API, sweep_test.ts runs it with fakes). The database says which objects
 * may go (`public.voice_sweep_batch`: the queued objects of deleted messages and notes, and the uploads nothing points at after the
 * grace), each with its bucket; this removes them through the Storage API, because the database may not delete a storage object itself,
 * and reports what went (`public.voice_sweep_done`).
 */

/** An object to remove: the bucket it is in and its name there (the same name can mean nothing in the other bucket). */
export type SweepItem = { bucket: string; path: string }

/** What the sweep needs from the outside. */
export type SweepDeps = {
  /** `voice_sweep_batch(p_limit)`: the objects to remove now. */
  batch(limit: number): Promise<SweepItem[]>
  /** Removes the objects through the Storage API, bucket by bucket; the ones it reports removed. */
  remove(items: SweepItem[]): Promise<SweepItem[]>
  /** `voice_sweep_done(p_items)`: forgets the removed queued objects. */
  done(items: SweepItem[]): Promise<void>
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
    const items = await deps.batch(limit)
    if (items.length === 0) break
    rounds++
    const gone = await deps.remove(items)
    if (gone.length > 0) await deps.done(gone)
    removed += gone.length
    if (items.length < limit || gone.length === 0) break
  }
  return { removed, rounds }
}

/** The buckets the function may remove from: what the database names is never taken on trust for a bucket outside this list. */
export const BUCKETS: readonly string[] = ['buddy-voice', 'note-voice']

/** What the Storage API answers to a bulk delete of one bucket (`remove(paths)`): the removed objects (`data`) or the refusal (`error`). */
export type StorageRemove = (bucket: string, paths: string[]) => Promise<{ data: unknown; error: { message: string } | null }>

/**
 * Removes the items through the Storage API, bucket by bucket; the ones it reports removed. A bucket the Storage API refuses does not cost the other its
 * removals: what went is reported, the rest is named again by the next run (its tries are counted); only a run in which nothing could be removed fails.
 */
export async function removeFromBuckets(items: SweepItem[], removeFrom: StorageRemove): Promise<SweepItem[]> {
  const gone: SweepItem[] = []
  let failure: Error | null = null
  for (const bucket of BUCKETS) {
    const paths = items.filter((item) => item.bucket === bucket).map((item) => item.path)
    if (paths.length === 0) continue
    const { data, error } = await removeFrom(bucket, paths)
    if (error) {
      failure ??= new Error(`storage (${bucket}): ${error.message}`)
      continue
    }
    gone.push(...removedNames(data).map((path) => ({ bucket, path })))
  }
  if (failure && gone.length === 0) throw failure
  return gone
}

/** The items of a batch, from the database's answer (`[{ bucket, path }]`); an entry that is not shaped like one is dropped, never guessed at. */
export function itemsOf(answer: unknown): SweepItem[] {
  if (!Array.isArray(answer)) return []
  return answer
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { bucket?: unknown; path?: unknown }) : null))
    .filter((e): e is SweepItem => !!e && typeof e.bucket === 'string' && typeof e.path === 'string')
    .map((e) => ({ bucket: e.bucket, path: e.path }))
}

/** The names in the Storage API's answer to a bulk delete (`[{ name, … }]`). */
export function removedNames(answer: unknown): string[] {
  if (!Array.isArray(answer)) return []
  return answer
    .map((entry) => (entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string')
}
