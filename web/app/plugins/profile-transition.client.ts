import type { RouteLocationNormalized, RouterScrollBehavior } from 'vue-router'
import { prefersReducedMotion } from '~/utils/motion'
import { tabPlaces } from '~/utils/tabPlaces'

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
 */
type Direction = 'push' | 'back'

const PROFILE = '/profile'
/** The longest the new state may keep the page frozen (a slow first load of the Profile's code). */
const LIMIT_MS = 1000

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

  router.beforeResolve((to, from) => {
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
    // Skipped (another took over) is not an error here: the page has changed all the same.
    transition.ready.catch(() => {})
    void transition.finished.then(done, done)
    // The page swaps only once the old state is on its picture.
    return oldCaptured
  })

  // The new state waits for the page drawn and at its place (the router scrolls there right after, a no-op).
  const original = router.options.scrollBehavior
  const scrollBehavior: RouterScrollBehavior = (to, from, saved) => {
    const result = original ? original(to, from, saved) : false
    if (finish && directionOf(to, from)) {
      // Where the router is about to scroll (app/router.options.ts): the Profile's top, or the tab's place.
      const place = to.path === PROFILE ? { left: 0, top: 0 } : tabPlaces.arrive({ to: to.path, fromShell: true, saved: saved ?? null })
      nuxtApp.hooks.hookOnce('page:loading:end', () => {
        window.scrollTo(place.left, place.top)
        const avatar = document.querySelector<HTMLElement>('[data-testid="shell.avatar"] [data-profile-avatar]')
        if (avatar) {
          const box = avatar.getBoundingClientRect()
          if (box.bottom <= 0 || box.top >= window.innerHeight) avatar.style.setProperty('view-transition-name', 'none')
        }
        finish?.()
      })
    }
    return result
  }
  router.options.scrollBehavior = scrollBehavior
})
