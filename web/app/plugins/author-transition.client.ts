import type { RouteLocationNormalized } from 'vue-router'
import { prefersReducedMotion } from '~/utils/motion'

/**
 * Push to an author's page and back (docs/MOTION.md, Push to an author; issue
 * #167), as the other pushes move the page: the author's page fades in as the
 * page left fades out and rises `md` into place over `standard`; Back plays it
 * the other way over `exit` (on the `standard` curve), the page sinking as it
 * fades. The tab bar stands; the round back button only fades. There is no
 * cover to fly (an author is not a Book), so this is the browser's View
 * Transitions API, like the push to the Profile (plugins/profile-transition):
 * two states and a cross-fade need nothing more.
 *
 * - Push: any navigation to `/author/<key>` that is not a Back or Forward.
 * - Back: a Back (popstate) off an author's page. A tap on a work flies its
 *   cover into the Book's page instead (composables/useBookFlight.ts), and the
 *   Back from that Book flies it home; neither is this.
 * - No transition with Reduce Motion, in a browser without the API, or on a
 *   Back the browser has animated itself (iOS Safari's edge swipe).
 *
 * The old state is captured before the router swaps the page; the new one once
 * the new page is in the document and at the place the router will scroll it
 * to (the top for the author's page, the saved place on Back).
 */
type Direction = 'push' | 'back'

const AUTHOR_PAGE = '[data-testid="author"]'
/** The longest the new state may keep the page frozen: a safety net, not a wait. */
const LIMIT_MS = 1000

const isAuthorPath = (path: string) => /^\/author\/[^/]+$/.test(path)

function directionOf(to: RouteLocationNormalized, from: RouteLocationNormalized, popped: boolean): Direction | null {
  if (to.path === from.path) return null
  if (isAuthorPath(to.path) && !popped) return 'push'
  if (isAuthorPath(from.path) && popped && !isAuthorPath(to.path)) return 'back'
  return null
}

/** Calls `then` once `ready()` holds: now, or as soon as the document changes so that it does. */
function whenReady(ready: () => boolean, then: () => void) {
  if (ready()) return then()
  const observer = new MutationObserver(() => {
    if (!ready()) return
    observer.disconnect()
    then()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), LIMIT_MS)
}

export default defineNuxtPlugin(() => {
  if (typeof document.startViewTransition !== 'function') return
  const router = useRouter()
  const root = document.documentElement

  let popped = false
  let browserAnimated = false
  window.addEventListener(
    'popstate',
    (event) => {
      popped = true
      browserAnimated = Boolean((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition)
    },
    { capture: true },
  )

  let finish: (() => void) | null = null
  let running: Direction | null = null
  /** Whether the navigation under way came from a popstate: read as it starts, so a popstate a sheet took (useBackDismiss) never counts for a later one. */
  let fromHistory = false
  router.beforeEach(() => {
    fromHistory = popped
    popped = false
  })

  onNuxtReady(() =>
    router.beforeResolve((to, from) => {
      const animatedByBrowser = browserAnimated
      browserAnimated = false
      const direction = directionOf(to, from, fromHistory)
      running = direction
      if (!direction || prefersReducedMotion() || animatedByBrowser) {
        running = null
        return
      }
      finish?.()
      root.dataset.pushTransition = direction
      let captured!: () => void
      const oldCaptured = new Promise<void>((resolve) => (captured = resolve))
      const drawn = new Promise<void>((resolve) => {
        const limit = setTimeout(resolve, LIMIT_MS)
        finish = () => {
          clearTimeout(limit)
          finish = null
          resolve()
        }
      })
      const transition = document.startViewTransition(() => {
        captured()
        return drawn
      })
      const done = () => {
        if (root.dataset.pushTransition === direction) delete root.dataset.pushTransition
      }
      transition.ready.catch(() => {})
      void transition.finished.then(done, done)
      return oldCaptured
    }),
  )

  router.afterEach((to, _from, failure) => {
    const direction = running
    running = null
    if (!finish || !direction) return
    if (failure) return finish()
    const saved = (window.history.state as { scroll?: { left: number; top: number } | null } | null)?.scroll ?? null
    const place = direction === 'push' ? { left: 0, top: 0 } : (saved ?? { left: 0, top: 0 })
    const ready = direction === 'push' ? () => Boolean(document.querySelector(AUTHOR_PAGE)) : () => !document.querySelector(AUTHOR_PAGE)
    whenReady(ready, () =>
      requestAnimationFrame(() => {
        if (router.currentRoute.value.fullPath !== to.fullPath) return finish?.()
        window.scrollTo(place.left, place.top)
        finish?.()
      }),
    )
  })
})
