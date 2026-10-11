/**
 * The order a screen holds its Collections in while she looks at it. The list in the store is always
 * sorted by last edited (`sortByEdited`, data/collections.ts), and an edit (even one made on this very
 * screen) moves a Collection to the top of it at once. A screen that is being looked at must not
 * reshuffle under her, so it keeps the order it took on entering (`held`, ids) and only lets Collections
 * that came or went change it: one that is gone drops out, one that is new goes where `arrival` says
 * (the top of the Collections page, which is where its edit puts it; the end of the picker, so the rows
 * do not shift under her finger). The next time the screen is entered it takes the order again.
 */
export function heldOrder<T extends { id: string }>(held: readonly string[], sorted: readonly T[], arrival: 'first' | 'last'): T[] {
  const byId = new Map(sorted.map((item) => [item.id, item]))
  const kept = held.flatMap((id) => {
    const item = byId.get(id)
    return item ? [item] : []
  })
  const known = new Set(held)
  const arrived = sorted.filter((item) => !known.has(item.id))
  return arrival === 'first' ? [...arrived, ...kept] : [...kept, ...arrived]
}
