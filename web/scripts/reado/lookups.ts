/**
 * The cover and Catalogue-id pass of the Reado import, before it writes: every
 * entry's edition is looked up (scripts/fable/covers.ts, the chain the Fable
 * import uses) a few at a time, and what was found is cached in a JSON file so
 * a rerun asks nobody anything it already knows. The same loop as
 * `import-fable.ts`'s `lookUp`, kept apart so the Fable script stays as it is.
 */
import type { ImportEntry } from '../../app/data/import/fable'
import { lookupEdition, lookupKey, withLookup, type EditionLookup } from '../fable/covers'
import { LookupCache, nodeLookupDeps } from '../fable/node'

export interface LookUpOptions {
  /** Where the lookups are kept between runs. */
  cachePath: string
  /** Ask nobody: only what the cache knows. */
  offline: boolean
  /** Ask again for every entry, ignoring the cache. */
  refresh: boolean
  log: (line: string) => void
}

export async function lookUpEntries(
  entries: ImportEntry[],
  options: LookUpOptions,
): Promise<{ entries: ImportEntry[]; lookups: (EditionLookup | null)[]; failed: string[] }> {
  const { offline, refresh, log } = options
  const cache = new LookupCache(options.cachePath)
  const deps = nodeLookupDeps(log)
  const lookups: (EditionLookup | null)[] = new Array(entries.length).fill(null)
  const failed: string[] = []
  let asked = 0
  // A few at a time; Apple's requests queue behind each other anyway (node.ts).
  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const index = next++
      const entry = entries[index]!
      const key = lookupKey(entry)
      const cached = refresh ? undefined : cache.get(key)
      if (cached || offline) {
        lookups[index] = cached ?? null
        continue
      }
      try {
        const found = await lookupEdition(entry, deps)
        cache.set(key, found)
        lookups[index] = found
        asked++
        log(`  cover ${String(asked).padStart(3)} ${entry.book.title}: ${found.cover?.source ?? 'none'}${found.cover ? ` ${found.cover.width}×${found.cover.height}` : ''}`)
      } catch (error) {
        failed.push(`${entry.book.title}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return { entries: entries.map((entry, index) => withLookup(entry, lookups[index] ?? null)), lookups, failed }
}
