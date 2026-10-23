import type { RouteLocationNormalized } from 'vue-router'
import { prefersReducedMotion } from '#layers/ui/app/utils/motion'
import { tabPlaces } from '~/utils/tabPlaces'
import { onIdle } from '~/utils/idle'
import { createBrowserAnimation, holdWhileTransitioning, imagesDecoded, scaleInsteadOfResize } from '~/utils/viewTransition'

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
 * - The Profile's code is fetched ahead, on idle and again at the first touch of the avatar, so the page
 *   is not frozen waiting for it; the new state waits (briefly) for the photo in the ring to decode, so the
 *   ring is not captured as initials with the photo popping in after (and the ring in both places is the
 *   same plain round photo, no padding or shadow around it, so the group scales uniformly).
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
/**
 * The longest the new state may keep the page frozen (a slow first load of the Profile's code): a safety net, not a
 * wait. Past it the transition is skipped and the page just changes. The Profile's code is fetched ahead
 * (below), so the new page is normally in within a frame or two.
 */
const LIMIT_MS = 600
/** The longest the new state waits for the avatar's photo to decode, inside `LIMIT_MS`. */
const DECODE_MS = 250

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

export default defineNuxtPlugin(() => {
  if (typeof document.startViewTransition !== 'function') return
  const router = useRouter()
  const root = document.documentElement

  const browserAnimation = createBrowserAnimation()
  window.addEventListener(
    'popstate',
    (event) => browserAnimation.noted(Boolean((event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition)),
    { capture: true },
  )

  // The Profile's code ahead of the tap: on idle once the app is up, and at the first touch of the
  // avatar (the tap that follows has the rest of the press to finish it).
  const preload = () => void preloadRouteComponents(PROFILE).catch(() => {})
  onNuxtReady(() => {
    onIdle(preload, { timeout: 4000, fallback: 2000 })
    document.addEventListener('pointerdown', (event) => {
      if (event.target instanceof Element && event.target.closest('[data-testid="shell.avatar"]')) preload()
    }, { capture: true, passive: true })
  })

  /** The transition waiting for its new state: `release` takes it, `skip` gives it up (the page just changes). */
  type Pending = { to: RouteLocationNormalized; release: () => void; skip: () => void }
  let pending: Pending | null = null
  /** The transition whose names are on the page (a later one takes over from a skipped one). */
  let current: object | null = null

  const clearNames = () => {
    for (const el of document.querySelectorAll<HTMLElement>('[data-profile-avatar]')) el.style.removeProperty('view-transition-name')
  }

  // After Nuxt's own `beforeResolve` that lets the browser paint the tap first
  // (navigation-repaint, registered when the app is ready): a transition pauses
  // painting until its new state is in, so started earlier, that guard would
  // wait out its 100 ms fallback on every tap.
  onNuxtReady(() => router.beforeResolve((to, from) => {
    const animatedByBrowser = browserAnimation.take()
    const direction = directionOf(to, from)
    if (!direction || prefersReducedMotion() || animatedByBrowser) return
    // One at a time: the one still waiting lets its page go, and is skipped by the one starting.
    pending?.release()
    clearNames()
    const me = {}
    current = me
    root.dataset.profileTransition = direction
    let captured!: () => void
    const oldCaptured = new Promise<void>((resolve) => (captured = resolve))
    let transition: ViewTransition | undefined
    let release!: () => void
    const drawn = new Promise<void>((resolve) => {
      const limit = setTimeout(() => skip(), LIMIT_MS)
      release = () => {
        clearTimeout(limit)
        if (pending === entry) pending = null
        resolve()
      }
    })
    const skip = () => {
      transition?.skipTransition()
      release()
    }
    const entry: Pending = { to, release, skip }
    pending = entry
    transition = document.startViewTransition(() => {
      captured()
      return drawn
    })
    const done = () => {
      // Skipped by a later one: its names are on the page now, and it cleans them.
      if (current !== me) return
      current = null
      delete root.dataset.profileTransition
      clearNames()
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
    const waiting = pending
    if (!waiting) return
    const direction = directionOf(to, from)
    // The navigation the transition waits for did not happen (its own failure; another one came out instead).
    if (failure) return waiting.to === to ? waiting.skip() : undefined
    if (!direction) return waiting.skip()
    // Where the router will scroll (app/router.options.ts): the Profile's top, or the tab's place
    // (Back: the place the router saved in the history entry, `state.scroll`).
    const saved = (window.history.state as { scroll?: { left: number; top: number } | null } | null)?.scroll ?? null
    const place = direction === 'push' ? { left: 0, top: 0 } : tabPlaces.arrive({ to: to.path, fromShell: true, saved })
    whenIn(direction === 'push' ? PROFILE_PAGE : TAB_HEADER, () => {
      // A later transition took over while the page was coming: its own state is not this one's to take.
      if (pending !== waiting) return
      window.scrollTo(place.left, place.top)
      const avatars = document.querySelectorAll<HTMLElement>('[data-profile-avatar]')
      const header = document.querySelector<HTMLElement>('[data-testid="shell.avatar"] [data-profile-avatar]')
      if (header) {
        const box = header.getBoundingClientRect()
        if (box.bottom <= 0 || box.top >= window.innerHeight) header.style.setProperty('view-transition-name', 'none')
      }
      // The ring's photo decoded first: otherwise the new state is the initials and the photo pops in on the landed ring.
      void imagesDecoded(avatars, DECODE_MS).then(() => {
        if (pending === waiting) waiting.release()
      })
    })
  })
})
