import type { RouterConfig } from '@nuxt/schema'
import { createWebHistory, START_LOCATION, type RouteLocationNormalized } from 'vue-router'
import { useNuxtApp, useRouter } from '#imports'
import { bookPageOf } from '~/utils/bookPageKey'
import { isBookPath } from '~/utils/flight'
import { tabPlaces, untilReachable, type PageWatch, type ScrollPlace } from '~/utils/tabPlaces'
import { keepsForeignLayers, listenForBack } from '~/composables/useBackDismiss'
import { knownSignedOut, signedOutDestination } from '~/utils/signedOutRoute'

// Where a page opens (Nuxt's own scroll behaviour, plus the tabs' places):
// back and forward return to where the page was; a tab (Home, Library) opens
// where the member left it, as iOS tabs do (utils/tabPlaces.ts; the tab bar
// writes the place on the way out); any other page opens at the top. Like
// Nuxt's, it waits until the new page has rendered before it scrolls, and then
// until the page is tall enough for the place (`untilReachable`): on a slow
// device the content may still be coming in, and a place scrolled to too early
// lands at the top.
//
// From the navigation until the page is at its place, the document carries
// `data-moving`, like a sheet still rising (UiSheet): the page is about to
// move, so whatever needs it where it will stay (the Playwright flows reading
// a scroll position, e2e/support.ts `untilStill`) waits for it.

/** The document, as `untilReachable` watches it. */
const documentWatch: PageWatch = {
  maxTop: () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  onResize(changed) {
    const observer = new ResizeObserver(() => changed())
    observer.observe(document.body)
    return () => observer.disconnect()
  },
  onMember(took) {
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
    for (const event of events) window.addEventListener(event, took, { capture: true, passive: true })
    return () => {
      for (const event of events) window.removeEventListener(event, took, { capture: true })
    }
  },
}

/** The navigation whose scroll is on its way; a newer one cancels it. */
let landing: { cancel(): void } | null = null

export default {
  // A visitor the device knows to be signed out is sent to the sign-in screen by the router's first
  // navigation, before the page behind her address is fetched. Nuxt registers the auth middleware
  // (`router.beforeEach`) only after `router.isReady()`, and the first navigation, started by
  // `app.use(router)`, loads the matched page's chunk (Home's, for `/`) before that: ~20 KB of Home
  // nobody signed out ever sees (docs/perf/bundle.md, F1). `beforeEnter` runs before a route's
  // components are loaded. Only the first navigation, and only when `knownSignedOut` (no stored session,
  // no offline Library, no code in the air): any other start goes through the middleware as before, and
  // Nuxt's own replace to the address she opened (at `app:created`) still runs the middleware once.
  routes: (routes) => {
    const early = (to: RouteLocationNormalized, from: RouteLocationNormalized) => {
      if (from !== START_LOCATION || typeof window === 'undefined') return
      let storage: Storage
      try {
        storage = window.localStorage
      } catch {
        return
      }
      if (!knownSignedOut(storage)) return
      return signedOutDestination(to, { pending: false, storage })
    }
    return routes.map((route) => ({ ...route, beforeEnter: [early, ...(route.beforeEnter ? [route.beforeEnter].flat() : [])] }))
  },
  // Nuxt's own history, with the Back that closes a sheet listening before the
  // router does (composables/useBackDismiss.ts), and that lets a Back off another
  // layer's entry (Regal's row, a Book broken out) pass the router by.
  history: (base) => {
    listenForBack()
    return keepsForeignLayers(createWebHistory(base))
  },
  scrollBehavior(to, from, savedPosition) {
    // Same page (a query or hash change): stay put.
    if (to.path === from.path) return false
    // The same book page, following its entry to another edition (utils/bookPageKey.ts): stays put too.
    if (isBookPath(to.path) && isBookPath(from.path) && bookPageOf(String(to.params.key)) === bookPageOf(String(from.params.key)))
      return false
    const place = () =>
      tabPlaces.arrive({ to: to.path, fromShell: from.meta.layout === 'tabs', saved: savedPosition ?? null })
    if (from === START_LOCATION) return place()

    const nuxtApp = useNuxtApp()
    const router = useRouter()
    const current = () => router.currentRoute.value.fullPath === to.fullPath
    landing?.cancel()
    return new Promise<ScrollPlace | false>((resolve) => {
      let stopWaiting = () => {}
      const self = {
        cancel() {
          stopWaiting()
          land(false)
        },
      }
      // Cleared before the router scrolls, in the same task: nothing can look in between.
      function land(position: ScrollPlace | false) {
        if (landing === self) {
          landing = null
          document.documentElement.removeAttribute('data-moving')
        }
        resolve(position)
      }
      landing = self
      document.documentElement.setAttribute('data-moving', '')

      const scroll = () =>
        requestAnimationFrame(async () => {
          if (landing !== self || !current()) return land(false)
          const position = place()
          const wait = untilReachable(position, documentWatch)
          stopWaiting = wait.cancel
          const reach = await wait.reached
          // The member scrolled herself meanwhile, or another page took over: no jump.
          land(reach === 'reachable' || reach === 'patience' ? (current() ? position : false) : false)
        })
      nuxtApp.hooks.hookOnce('page:loading:end', () => {
        const transition = (nuxtApp as { '~transitionPromise'?: Promise<void> })['~transitionPromise']
        if (transition) void transition.then(scroll)
        else scroll()
      })
    })
  },
} satisfies RouterConfig
