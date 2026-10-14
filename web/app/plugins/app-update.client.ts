import { useAppUpdateStore } from '~/stores/appUpdate'
import { CHECK_INTERVAL_MS, canInterrupt, isTyping } from '~/utils/appUpdate'

/**
 * Looks for a new release of the installed app and raises "New version available" when it finds one
 * (stores/appUpdate.ts, components/shell/UpdateSheet.vue; docs/parity.md "App update"):
 *
 * - at the start of the app (once it is ready),
 * - whenever it comes back to the foreground (`visibilitychange`, and `pageshow` for a page the browser
 *   kept in its back/forward cache): an installed iPhone app resumes without a navigation, which is the
 *   only moment the browser looks for a new worker by itself,
 * - when the connection comes back, and every 30 minutes while it stays open.
 *
 * A worker that installed and waits (`$pwa.needRefresh`) counts at once. The sheet never takes the screen
 * from somebody typing (a text field has the cursor) or from another layer — a sheet, a confirm, the
 * search palette, the reader (useModalShown): it waits, and rises when that layer is gone (a moment later,
 * so jumping from one field to the next does not trigger it).
 */
export default defineNuxtPlugin({
  name: 'libellus:app-update',
  dependsOn: ['vite-pwa:nuxt:client:plugin'],
  setup(nuxtApp) {
    const store = useAppUpdateStore()
    const shown = useModalShown()

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

    // ------------------------------------------------------------------ when to ask
    const mayInterrupt = () =>
      canInterrupt({
        typing: isTyping(document.activeElement),
        modalOpen: shown.value,
      })
    function offer() {
      if (store.pending && document.visibilityState === 'visible' && mayInterrupt()) store.open()
    }

    // Something new and unanswered: ask now, or as soon as she stops typing / the other layer is gone.
    let retry: ReturnType<typeof setInterval> | undefined
    watch(
      () => store.pending,
      (pending) => {
        clearInterval(retry)
        if (!pending) return
        offer()
        if (store.pending) retry = setInterval(offer, 1_500)
      },
      { immediate: true },
    )
  },
})
