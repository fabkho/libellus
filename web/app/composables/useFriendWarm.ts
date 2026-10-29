import { bothReadReelDocument, reelItems, BOTH_READ_REEL_LIMIT } from '~/data/bothReadReel'
import { useMemberProfileStore } from '~/stores/memberProfile'
import { createVisibleWarmBudget, friendIdOfHref } from '~/utils/friendWarm'
import { prefetchBothReadReel, saveDataOn } from '~/utils/bothReadReel'
import { onIdle } from '~/utils/idle'
import { preloadReelCovers } from '~/utils/regalReelPreload'
import { prefersReducedMotion } from '#layers/ui/app/utils/motion'

/**
 * Starts what a friend's page will need before it opens: her "You both read" answer (one request in flight per friend,
 * which the page then takes: stores/memberProfile.ts, `prefetchBothRead`), then the first covers of the reel
 * (`preloadReelCovers`) and the reel's chunk. `warmFriend(id)`: a tap on a link to her (plugins/friend-warm.client.ts);
 * `useFriendLinksInView()`: the links to friends on this screen warm a few at most as they come into view, on idle,
 * unless Save-Data is on or the device is offline. Never shows anything: the page shows what it reads once her
 * profile says it is hers to show.
 */
export function useFriendWarm() {
  const members = useMemberProfileStore()
  const nuxtApp = useNuxtApp()
  const built = useAppConfig().regal === true
  const covers = useReelCovers()
  const played = useState<Record<string, true>>('both-read-played', () => ({}))

  async function warmFriend(id: string): Promise<void> {
    if (!import.meta.client) return
    const items = await members.prefetchBothRead(id)
    if (!built || !items?.length || saveDataOn()) return
    prefetchBothReadReel(true)
    const document = bothReadReelDocument(reelItems(items, BOTH_READ_REEL_LIMIT), { outside: nuxtApp.$i18n.t('book.outsideCatalogue'), covers })
    preloadReelCovers(document, { autoplay: !played.value[id], reducedMotion: prefersReducedMotion() })
  }

  return { warmFriend }
}

/** The links to friends on this screen: the first few to come into view are warmed when the browser is idle. */
export function useFriendLinksInView() {
  const { warmFriend } = useFriendWarm()
  const budget = createVisibleWarmBudget(3)
  const seen = new WeakSet<Element>()
  let observer: IntersectionObserver | null = null
  const stops = new Set<() => void>()

  function scan() {
    if (!observer) return
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href^="/friends/"]')) {
      if (seen.has(link) || !friendIdOfHref(link.getAttribute('href'))) continue
      seen.add(link)
      observer.observe(link)
    }
  }

  onMounted(() => {
    if (typeof IntersectionObserver === 'undefined' || saveDataOn()) return
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = entry.isIntersecting ? friendIdOfHref((entry.target as HTMLAnchorElement).getAttribute('href')) : null
        if (!id || !isOnline() || saveDataOn() || !budget.take(id)) continue
        observer?.unobserve(entry.target)
        const stop = onIdle(() => void warmFriend(id), { timeout: 3000, fallback: 800 })
        stops.add(stop)
      }
    })
    scan()
  })
  // Rows come and go as the screen loads and pages: look again after each update.
  onUpdated(scan)
  onBeforeUnmount(() => {
    observer?.disconnect()
    for (const stop of stops) stop()
  })
}
