import type { RouterConfig } from '@nuxt/schema'
import { createWebHistory, START_LOCATION } from 'vue-router'
import { useNuxtApp, useRouter } from '#imports'
import { bookPageOf } from '~/utils/bookPageKey'
import { isBookPath } from '~/utils/flight'
import { tabPlaces } from '~/utils/tabPlaces'
import { listenForBack } from '~/composables/useBackDismiss'

// Where a page opens (Nuxt's own scroll behaviour, plus the tabs' places):
// back and forward return to where the page was; a tab (Home, Library) opens
// where the member left it, as iOS tabs do (utils/tabPlaces.ts; the tab bar
// writes the place on the way out); any other page opens at the top. Like
// Nuxt's, it waits until the new page has rendered before it scrolls.
export default {
  // Nuxt's own history, with the Back that closes a sheet listening before the
  // router does (composables/useBackDismiss.ts).
  history: (base) => {
    listenForBack()
    return createWebHistory(base)
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
    return new Promise((resolve) => {
      const scroll = () =>
        requestAnimationFrame(() => resolve(router.currentRoute.value.fullPath === to.fullPath ? place() : false))
      nuxtApp.hooks.hookOnce('page:loading:end', () => {
        const transition = (nuxtApp as { '~transitionPromise'?: Promise<void> })['~transitionPromise']
        if (transition) void transition.then(scroll)
        else scroll()
      })
    })
  },
} satisfies RouterConfig
