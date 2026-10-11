import type { RouteLocationNormalized } from 'vue-router'
import { prefersReducedMotion } from '~/utils/motion'
import { scaleInsteadOfResize } from '~/utils/viewTransition'
import { tabPlaces } from '~/utils/tabPlaces'

/**
 * (Also the push to a member's page and back, with her avatar flying: see "The avatar" below.)
 *
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
 *
 * The avatar (social v2a): a tap on a link to a member's page (`/friends/<id>`) that holds her avatar
 * (`data-member-avatar`, FriendsAvatar) moves the page the same way and the avatar tapped is one element with
 * the one in her page's hero, which grows from it; Back shrinks the hero's into the avatar the push left from
 * (or the first of hers that is on screen in the page it returns to; none on screen: it fades with the page).
 * The two are named `member-avatar` only while the transition runs (`style.viewTransitionName`, one element in
 * each state). A member's page opened any other way (a link, a redirect, the year page's back) has no avatar to
 * fly and navigates as before. Reduce Motion, no API, a browser-animated Back: none, as above.
 */
type Direction = 'push' | 'back'

const AUTHOR_PAGE = '[data-testid="author"]'
/** The longest the new state may keep the page frozen: a safety net, not a wait. */
const LIMIT_MS = 1000

const isTabPage = (route: RouteLocationNormalized) => route.meta.layout === 'tabs' && !route.meta.pushed
const isAuthorPath = (path: string) => /^\/author\/[^/]+$/.test(path)
const MEMBER_PATH = /^\/friends\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const memberOf = (path: string) => MEMBER_PATH.exec(path)?.[1]?.toLowerCase() ?? null
/** The page of a member, and her hero's avatar in it. */
const MEMBER_PAGE = '[data-testid="member"]'
const HERO_AVATAR = '[data-testid="member.avatar"] [data-member-avatar]'
/** A member's page that has nothing to fly into (nobody there, a load that failed): the page is ready without the avatar. */
const MEMBER_NO_HERO = '[data-testid="member.missing"], [data-testid="member.loadError"]'
/** Her page's skeleton ring, where the avatar lands when the profile is not read yet (the first visit, after `STAND_IN_MS`). */
const STAND_IN = '[data-testid="member"] [data-member-avatar-stand-in]'
/** How long the push waits for her hero before it lands on the skeleton's ring instead. */
const STAND_IN_MS = 300
const NAME = 'member-avatar'
/** How long a tap on her avatar stays the reason of the navigation it starts. */
const TAP_MS = 1500

function directionOf(to: RouteLocationNormalized, from: RouteLocationNormalized, popped: boolean): Direction | null {
  if (to.path === from.path) return null
  if (isAuthorPath(to.path) && !popped) return 'push'
  if (isAuthorPath(from.path) && popped && !isAuthorPath(to.path)) return 'back'
  return null
}

/** Calls `then` once `ready()` holds: now, or as soon as the document changes so that it does. */
function whenReady(ready: () => boolean, then: () => void, lookAgainAt?: number) {
  if (ready()) return then()
  const check = () => {
    if (!ready()) return
    observer.disconnect()
    then()
  }
  const observer = new MutationObserver(check)
  observer.observe(document.body, { childList: true, subtree: true })
  // What waits on the clock (the hero is late, the skeleton stands in) is looked at again then: the document may not change by itself.
  if (lookAgainAt) setTimeout(check, lookAgainAt)
  setTimeout(() => observer.disconnect(), LIMIT_MS)
}

export default defineNuxtPlugin(() => {
  if (typeof document.startViewTransition !== 'function') return
  const router = useRouter()
  const root = document.documentElement

  /** A tap on a link to a member's page that holds her avatar: the reason of the push that follows. */
  let tapped: { id: string; avatar: HTMLElement | null; at: number } | null = null
  /** The avatar a push to a member's page left from (a weak reference: the page it is on may be kept alive and leave), for Back. */
  let origin: { id: string; avatar: WeakRef<HTMLElement> } | null = null
  document.addEventListener(
    'click',
    (event) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      const id = link ? memberOf(new URL(link.href, location.href).pathname) : null
      tapped = id && link ? { id, avatar: avatarOf(link), at: performance.now() } : null
      if (tapped && !tapped.avatar) tapped = null
    },
    { capture: true },
  )
  /** Her avatar for a tap on a link to her page: the one inside it, or in the link to the same page beside it (her name's link, in the row of her avatar's). */
  function avatarOf(link: HTMLAnchorElement): HTMLElement | null {
    const inside = link.querySelector<HTMLElement>('[data-member-avatar]')
    if (inside) return inside
    const href = link.getAttribute('href')
    for (let up = link.parentElement, depth = 0; up && depth < 4; up = up.parentElement, depth++) {
      const found = up.querySelector<HTMLElement>(`a[href="${CSS.escape(href ?? '')}"] [data-member-avatar]`)
      if (found) return found
    }
    return null
  }
  const onScreen = (element: HTMLElement) => {
    const box = element.getBoundingClientRect()
    return element.isConnected && box.width > 0 && box.bottom > 0 && box.top < window.innerHeight
  }
  const nameOf = (element: HTMLElement | null | undefined, name: string) => element?.style.setProperty('view-transition-name', name)

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
  /** The member's page the transition under way carries her avatar to or from, if any. */
  let memberFlight: { id: string; push: boolean } | null = null
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
      const toMember = memberOf(to.path)
      const fromMember = memberOf(from.path)
      const tap = tapped
      tapped = null
      // A member's page with her avatar to fly: pushed by a tap on her avatar's link, or left by Back (not into her year page).
      const flight =
        toMember && !fromHistory && to.path !== from.path && tap?.id === toMember && performance.now() - tap.at < TAP_MS && tap.avatar?.isConnected
          ? ({ id: toMember, push: true } as const)
          : fromMember && fromHistory && origin?.id === fromMember && !to.path.startsWith(from.path)
            ? ({ id: fromMember, push: false } as const)
            : null
      const direction = flight ? (flight.push ? 'push' : 'back') : directionOf(to, from, fromHistory)
      running = direction
      memberFlight = flight
      if (!direction || prefersReducedMotion() || animatedByBrowser) {
        running = null
        memberFlight = null
        return
      }
      finish?.()
      // The old state's avatar, named before it is captured: the tapped one, or the hero's (when it is on screen).
      if (flight?.push && tap?.avatar) {
        origin = { id: flight.id, avatar: new WeakRef(tap.avatar) }
        nameOf(tap.avatar, NAME)
      } else if (flight) {
        const hero = document.querySelector<HTMLElement>(HERO_AVATAR)
        if (hero && onScreen(hero)) nameOf(hero, NAME)
      }
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
        for (const avatar of document.querySelectorAll<HTMLElement>('[data-member-avatar], [data-member-avatar-stand-in]')) {
          if (avatar.style.getPropertyValue('view-transition-name')) avatar.style.removeProperty('view-transition-name')
        }
        const left = origin?.avatar.deref()
        if (left?.style.getPropertyValue('view-transition-name')) left.style.removeProperty('view-transition-name')
        if (flight && !flight.push) origin = null
      }
      // The avatar's group moves and scales by transform alone, like the Profile's ring (utils/viewTransition.ts).
      void transition.ready.then(
        () => {
          for (const animation of root.getAnimations({ subtree: true })) {
            const effect = animation.effect
            if (effect instanceof KeyframeEffect && effect.pseudoElement === `::view-transition-group(${NAME})`) scaleInsteadOfResize(effect)
          }
        },
        () => {},
      )
      void transition.finished.then(done, done)
      return oldCaptured
    }),
  )

  router.afterEach((to, _from, failure) => {
    const direction = running
    const flight = memberFlight
    running = null
    memberFlight = null
    if (!finish || !direction) return
    if (failure) return finish()
    const saved = (window.history.state as { scroll?: { left: number; top: number } | null } | null)?.scroll ?? null
    // Where the router will scroll: the top for a push; Back, the place it saved in the history entry, or the tab's own (utils/tabPlaces.ts).
    const place =
      direction === 'push'
        ? { left: 0, top: 0 }
        : flight && isTabPage(to)
          ? tabPlaces.arrive({ to: to.path, fromShell: true, saved })
          : (saved ?? { left: 0, top: 0 })
    const began = performance.now()
    const waited = () => performance.now() - began > STAND_IN_MS
    const ready = flight
      ? direction === 'push'
        ? () => Boolean(document.querySelector(MEMBER_PAGE)) && (Boolean(document.querySelector(`${HERO_AVATAR}, ${MEMBER_NO_HERO}`)) || (waited() && Boolean(document.querySelector(STAND_IN))))
        : () => !document.querySelector(MEMBER_PAGE)
      : direction === 'push'
        ? () => Boolean(document.querySelector(AUTHOR_PAGE))
        : () => !document.querySelector(AUTHOR_PAGE)
    // The new state is set up in a frame of its own, except a member's: the page is frozen on its old picture while the
    // transition waits for the new state, and a frozen page draws no frames (a callback in one would wait out the limit).
    const inFrame = (run: () => void) => (flight ? run() : requestAnimationFrame(run))
    whenReady(ready, () =>
      inFrame(() => {
        if (router.currentRoute.value.fullPath !== to.fullPath) return finish?.()
        window.scrollTo(place.left, place.top)
        // The new state's avatar, one element with the old: her hero's (push), or the avatar the push left from (Back).
        if (flight?.push) {
          const left = origin?.avatar.deref()
          if (left?.isConnected) nameOf(left, 'none')
          nameOf(document.querySelector<HTMLElement>(HERO_AVATAR) ?? document.querySelector<HTMLElement>(STAND_IN), NAME)
        } else if (flight) {
          const left = origin?.avatar.deref()
          const target =
            left && onScreen(left) ? left : [...document.querySelectorAll<HTMLElement>(`a[href="${CSS.escape(`/friends/${flight.id}`)}"] [data-member-avatar]`)].find(onScreen)
          nameOf(target, NAME)
        }
        finish?.()
      }),
      flight?.push ? STAND_IN_MS + 20 : undefined,
    )
  })
})
