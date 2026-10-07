/**
 * Structural sharing for the Library's lists: a refresh mostly brings back
 * what is already shown. Keeping the objects already held where nothing
 * changed lets a screen tell "the same" by identity, so a refresh that changed
 * nothing re-renders nothing, and one that changed a Book re-renders that row.
 * Framework-free; the lists hold plain JSON-shaped data (what PostgREST and
 * the device's copy give).
 */

/** Whether two JSON-shaped values are equal, field by field (`undefined` fields count as absent). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    return a.length === other.length && a.every((value, i) => sameData(value, other[i]))
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  if (keys.length !== Object.keys(right).filter((key) => right[key] !== undefined).length) return false
  return keys.every((key) => sameData(left[key], right[key]))
}

/**
 * `next`, with every entry equal to the one `held` under its id replaced by
 * the held object; `held` itself when the two hold the same entries in the
 * same order.
 */
export function reuseEntries<T extends { id: string }>(held: readonly T[], next: readonly T[]): T[] {
  const byId = new Map(held.map((entry) => [entry.id, entry]))
  let same = held.length === next.length
  const reused = next.map((entry, i) => {
    const before = byId.get(entry.id)
    const kept = before && sameData(before, entry) ? before : entry
    if (kept !== held[i]) same = false
    return kept
  })
  return same ? (held as T[]) : reused
}
