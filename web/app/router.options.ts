import type { RouterConfig } from '@nuxt/schema'
import { START_LOCATION } from 'vue-router'
import { useNuxtApp, useRouter } from '#imports'
import { tabPlaces } from '~/utils/tabPlaces'

// Where a page opens (Nuxt's own scroll behaviour, plus the tabs' places):
// back and forward return to where the page was; a tab (Home, Library) opens
// where the member left it, as iOS tabs do (utils/tabPlaces.ts; the tab bar
// writes the place on the way out); any other page opens at the top. Like
// Nuxt's, it waits until the new page has rendered before it scrolls.
export default {
  scrollBehavior(to, from, savedPosition) {
    // Same page (a query or hash change): stay put.
    if (to.path === from.path) return false
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
