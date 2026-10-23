import type { RouteLocationNormalized } from 'vue-router'
import { easingToken, prefersReducedMotion } from '#layers/ui/app/utils/motion'
import { tabPlaces } from '~/utils/tabPlaces'
import { createBrowserAnimation, groupKeyframes, holdWhileTransitioning, imagesDecoded, scaleInsteadOfResize, visibleRect, type Rect } from '~/utils/viewTransition'

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
 * - The new state waits (briefly) for the photo in the ring to decode, so the ring is not captured as
 *   initials with the photo popping in after. The ring in both places is the same plain round photo, no
 *   padding or shadow around it, so the group scales uniformly, and only one of its two snapshots is shown
 *   (the larger, main.css): no cross-fade of two scaled bitmaps. The ring's group keyframes come from boxes
 *   measured here (`groupKeyframes`), not from the browser's (WebKit's are unreliable), with the browser's as the fallback.
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
 * wait. Past it the transition is skipped and the page just changes (the new state would be the old page).
 */
const LIMIT_MS = 600
/** The longest the new state waits for the avatar's photo to decode, inside `LIMIT_MS`. */
const DECODE_MS = 250

/** What says the new page is in: the Profile's root, or a tab's header. */
const PROFILE_PAGE = '[data-testid="profile"]'
const TAB_HEADER = '[data-testid="shell.header"]'
/** The named ring in each place: the header's avatar, and the Profile's. */
const HEADER_RING = '[data-testid="shell.avatar"] [data-profile-avatar]'
const PROFILE_RING = `${PROFILE_PAGE} [data-profile-avatar]`
/** The ring's group (main.css names it `profile-avatar`). */
const RING_GROUP = '::view-transition-group(profile-avatar)'

const viewport = () => ({ width: window.innerWidth, height: window.innerHeight })

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

  /** The transition waiting for its new state: `release` takes it, `skip` gives it up (the page just changes). */
  type Pending = { to: RouteLocationNormalized; release: () => void; skip: () => void; ring: { old: Rect | null; next: Rect | null } }
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
    // The ring's old box, measured by us (viewport coordinates) before the old state is taken; the new one is
    // measured when the new state is (afterEach below). They make the ring's group's keyframes.
    const ring = { old: visibleRect(document.querySelectorAll(direction === 'push' ? HEADER_RING : PROFILE_RING), viewport()), next: null as Rect | null }
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
    const entry: Pending = { to, release, skip, ring }
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
    // Every promise has a handler: a transition another one took over (Safari rejects with an AbortError), or that
    // was skipped, is not an error here, the page has changed all the same; the names are cleaned in every outcome.
    transition.ready.then(() => {
      const own = groupKeyframes(ring.old, ring.next, easingToken('standard'))
      for (const animation of root.getAnimations({ subtree: true })) {
        const effect = animation.effect
        if (!(effect instanceof KeyframeEffect) || !effect.pseudoElement?.startsWith('::view-transition-group(')) continue
        if (own && effect.pseudoElement === RING_GROUP) effect.setKeyframes(own)
        else scaleInsteadOfResize(effect)
      }
    }, () => {})
    transition.updateCallbackDone.catch(() => {})
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
      const header = document.querySelector<HTMLElement>(HEADER_RING)
      if (header) {
        const box = header.getBoundingClientRect()
        if (box.bottom <= 0 || box.top >= window.innerHeight) header.style.setProperty('view-transition-name', 'none')
      }
      // The ring's photo decoded first: otherwise the new state is the initials and the photo pops in on the landed ring.
      void imagesDecoded(avatars, DECODE_MS).then(() => {
        if (pending !== waiting) return
        // The new box, as the new state will be taken (the page is at its place, the photo decoded).
        waiting.ring.next = visibleRect(document.querySelectorAll(direction === 'push' ? PROFILE_RING : HEADER_RING), viewport())
        waiting.release()
      })
    })
  })
})
