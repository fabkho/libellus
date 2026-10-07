import { toValue, watch, type MaybeRefOrGetter } from 'vue'
import { useShelfStore } from '~/stores/shelf'
import { onIdle } from '~/utils/idle'

/** Warm-ups go one after the other, so a screen asking for two rows (the Profile's and a year's) does not draw both at once on a phone. */
let queue: Promise<void> = Promise.resolve()

/**
 * Warms the row a card is about to show (`year`: that year's, else the Profile's newest `SHELF_ROW_LIMIT`).
 * Called on idle by `useShelfPreload`, and by the card itself once it is a screen away (ShelfRowCard).
 */
export function warmShelfRow(year: number | null): void {
  queue = queue.then(async () => {
    try {
      // A dynamic import, so Regal stays out of the entry (regal.config.ts): this is the `regal` chunk, fetched here.
      const { preloadRegal } = await import('#layers/regal/app/utils/preload')
      // What the row will be given, so the warm-up is the row's own (same Books, same Spines); the
      // card's component for the chunk, which brings Regal's fonts with it (shelf/Row.vue).
      await preloadRegal({
        ...(year === null ? { limit: SHELF_ROW_LIMIT } : { year }),
        chunk: () => import('~/components/shelf/Row.vue'),
      })
    } catch {
      // Only a head start: the row loads as it would have.
    }
  })
}

/**
 * Gets the owner's row ready before she opens it (#23, Regal's `preloadRegal`):
 * the library file, Regal's code, three.js and the Spines of the Books the row
 * opens on, so the row shows its Spines on its first frame and goes straight
 * into its intro, with no loading step. Called by the screens from which the
 * row is one tap away: the signed-in shell (the Profile's row, the newest
 * `SHELF_ROW_LIMIT` Books), Home (the year its "Read in" sheet shows) and the
 * Profile (the year in view, or the latest, whose review is one tap away).
 * `year` is that year's row; none, the Profile's.
 *
 * For the owner only (`shelf.isOwner`): for anyone else nothing is imported or
 * fetched. On idle, so it never competes with the screen that is opening, and
 * once per row (Regal shares calls with the same options).
 */
export function useShelfPreload(year: MaybeRefOrGetter<number | null | undefined> = null) {
  const shelf = useShelfStore()
  watch(
    [() => shelf.isOwner, () => toValue(year) ?? null],
    ([owner, rowYear], _before, onCleanup) => {
      if (!owner) return
      onCleanup(onIdle(() => warmShelfRow(rowYear)))
    },
    { immediate: true },
  )
}
