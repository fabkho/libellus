import type { RouteLocationNormalized } from 'vue-router'
import { prefersReducedMotion } from '~/utils/motion'
import { tabPlaces } from '~/utils/tabPlaces'
import { holdWhileTransitioning, scaleInsteadOfResize } from '~/utils/viewTransition'

/**
 * Push to the Profile and back (docs/MOTION.md, Push to the Profile; issue
 * #78): the avatar in a tab's header grows into the Profile's ring while the
 * page cross-fades, and Back shrinks the ring into the avatar again. The book
 * covers fly with a FLIP of their own (composables/useBookFlight.ts) because a
 * flight there must turn around mid-air and survive slow pages; one ring
 * between two fixed places is what the View Transitions API does by itself,
 * so this hands it the two states and names the ring in both
 * (`data-profile-avatar` → `view-transition-name: profile-avatar` in main.css,
 * only while a transition runs).
 *
 * - Only between a tab page (the header with the avatar) and the Profile,
 *   either way. Everything else navigates as before.
 * - The old state is captured before the router swaps the page
 *   (`beforeResolve` waits for it). The new state is captured once the new page is
 *   drawn and at the place the router will scroll it to: the top for the
 *   Profile, the saved place for a tab. The page is put there first, so the
 *   ring lands where the avatar will be.
 * - Back into a tab whose avatar is scrolled out of view: the ring fades out
 *   with the Profile instead of flying off the screen.
 * - No transition with Reduce Motion, in a browser without the API (it just
 *   navigates), or on a Back the browser has animated itself (iOS Safari's edge
 *   swipe: `hasUAVisualTransition`).
 * - Light on a phone's main thread: once it starts, the groups move and scale by
 *   `transform` alone (the browser's own keyframes resize them, layout on every
 *   frame; `scaleInsteadOfResize`), and while it runs, the stores hold answers
 *   that come in until it has landed (`afterTransition`, utils/viewTransition.ts),
 *   so the page under it is not set up again mid-flight.
 */
type Direction = 'push' | 'back'

const PROFILE = '/profile'
/** The longest the new state may keep the page frozen (a slow first load of the Profile's code): a safety net, not a wait. */
const LIMIT_MS = 1000

/** What says the new page is in: the Profile's root, or a tab's header. */
const PROFILE_PAGE = '[data-testid="profile"]'
const TAB_HEADER = '[data-testid="shell.header"]'

/** Calls `then` once `selector` is in the document: now, or as soon as it is added. */
function whenIn(selector: string, then: () => void) {
  if (document.querySelector(selector)) return then()
  const observer = new MutationObserver(() => {
    if (!document.querySelector(selector)) return
    observer.disconnect()
    then()
  })
  observer.observe(document.body, { childList: true, subtree: true })
  setTimeout(() => observer.disconnect(), LIMIT_MS)
}

const isTabPage = (route: RouteLocationNormalized) => route.meta.layout === 'tabs' && !route.meta.pushed

function directionOf(to: RouteLocationNormalized, from: RouteLocationNormalized): Direction | null {
  if (to.path === PROFILE && isTabPage(from)) return 'push'
  if (from.path === PROFILE && isTabPage(to)) return 'back'
  return null
}

export default defineNuxtPlugin((nuxtApp) => {
  if (typeof document.startViewTransition !== 'function') return
  const router = useRouter()
  const root = document.documentElement

  let browserAnimated = false
  window.addEventListener(
    'popstate',
    (event) => (browserAnimated = Boolean((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition)),
    { capture: true },
  )

  /** Lets the running transition capture its new state (null: none waits). */
  let finish: (() => void) | null = null

  // After Nuxt's own `beforeResolve` that lets the browser paint the tap first
  // (navigation-repaint, registered when the app is ready): a transition pauses
  // painting until its new state is in, so started earlier, that guard would
  // wait out its 100 ms fallback on every tap.
  onNuxtReady(() => router.beforeResolve((to, from) => {
    const animatedByBrowser = browserAnimated
    browserAnimated = false
    const direction = directionOf(to, from)
    if (!direction || prefersReducedMotion() || animatedByBrowser) return
    finish?.()
    root.dataset.profileTransition = direction
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
      if (root.dataset.profileTransition === direction) delete root.dataset.profileTransition
      for (const el of document.querySelectorAll<HTMLElement>('[data-profile-avatar]')) el.style.removeProperty('view-transition-name')
    }
    holdWhileTransitioning(transition.finished)
    // Skipped (another took over) is not an error here: the page has changed all the same.
    transition.ready.then(() => {
      for (const animation of root.getAnimations({ subtree: true })) {
        const effect = animation.effect
        if (effect instanceof KeyframeEffect && effect.pseudoElement?.startsWith('::view-transition-group(')) scaleInsteadOfResize(effect)
      }
    }, () => {})
    void transition.finished.then(done, done)
    // The page swaps only once the old state is on its picture.
    return oldCaptured
  }))

  // The new state is taken as soon as the new page is in the document, put at
  // the place the router is about to scroll it to (it scrolls there itself
  // afterwards, a no-op). Watched for directly from the navigation's end: the
  // router's own scroll and Nuxt's page hooks come later, and the page stays
  // frozen until this is done.
  router.afterEach((to, from, failure) => {
    const direction = directionOf(to, from)
    if (!finish || !direction) return
    if (failure) return finish()
    // Where the router will scroll (app/router.options.ts): the Profile's top, or the tab's place
    // (Back: the place the router saved in the history entry, `state.scroll`).
    const saved = (window.history.state as { scroll?: { left: number; top: number } | null } | null)?.scroll ?? null
    const place = direction === 'push' ? { left: 0, top: 0 } : tabPlaces.arrive({ to: to.path, fromShell: true, saved })
    whenIn(direction === 'push' ? PROFILE_PAGE : TAB_HEADER, () => {
      window.scrollTo(place.left, place.top)
      const avatar = document.querySelector<HTMLElement>('[data-testid="shell.avatar"] [data-profile-avatar]')
      if (avatar) {
        const box = avatar.getBoundingClientRect()
        if (box.bottom <= 0 || box.top >= window.innerHeight) avatar.style.setProperty('view-transition-name', 'none')
      }
      finish?.()
    })
  })
})
