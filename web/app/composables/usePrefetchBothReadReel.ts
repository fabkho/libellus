import { prefetchBothReadReel } from '~/utils/bothReadReel'
import { onIdle } from '~/utils/idle'

/**
 * On a screen that leads to a friend's page (the feed, People): once the browser is idle, starts fetching the reel's
 * chunk (`regal-reel`, ~1.2 MB raw, br ~250 KB), so it is in the cache when a friend's page opens and its "You both
 * read" has nothing to wait for (the page itself asks again as it opens, `prefetchBothReadReel`). A build without
 * Regal and Save-Data fetch nothing; the service worker keeps the file (regal.config.ts).
 */
export function usePrefetchBothReadReel(): void {
  const built = useAppConfig().regal === true
  onMounted(() => {
    if (!built) return
    const stop = onIdle(() => prefetchBothReadReel(true), { timeout: 4000, fallback: 2000 })
    onBeforeUnmount(stop)
  })
}
