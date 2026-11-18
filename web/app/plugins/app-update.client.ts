import { useAppUpdateStore } from '~/stores/appUpdate'
import { CHECK_INTERVAL_MS } from '~/utils/appUpdate'

/**
 * Looks for a new release of the installed app (stores/appUpdate.ts; docs/parity.md "App update"). It no
 * longer raises anything: an update installs itself and the member meets it on a later start, through
 * "What's new" (composables/useWhatsNew.ts). The owner's decision, 2026-11-18 — the sheet was a dead end he
 * had to press fifty times (docs/proposals/app-update-2026-11-18.md).
 *
 * - at the start of the app (once it is ready),
 * - whenever it comes back to the foreground (`visibilitychange`, and `pageshow` for a page the browser
 *   kept in its back/forward cache): an installed iPhone app resumes without a navigation, which is the
 *   only moment the browser looks for a new worker by itself,
 * - when the connection comes back, and every 30 minutes while it stays open.
 *
 * A worker that installed and waits (`$pwa.needRefresh`) counts at once. Nothing is offered and nothing is
 * drawn: with `skipWaiting` off the worker waits for the page to be replaced, and that happens on a later
 * start, silently. Looking is all this plugin does.
 */
export default defineNuxtPlugin({
  name: 'libellus:app-update',
  dependsOn: ['vite-pwa:nuxt:client:plugin'],
  setup(nuxtApp) {
    const store = useAppUpdateStore()

    const pwa = nuxtApp.$pwa
    if (pwa) {
      watch(
        () => pwa.needRefresh,
        (needed) => {
          if (needed) store.markWaiting()
        },
        { immediate: true },
      )
    }

    // ------------------------------------------------------------------ when to look
    onNuxtReady(() => void store.check())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void store.check({ foreground: true })
    })
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) void store.check({ foreground: true })
    })
    window.addEventListener('online', () => void store.check({ foreground: true }))
    setInterval(() => {
      if (document.visibilityState === 'visible') void store.check()
    }, CHECK_INTERVAL_MS)
  },
})
