import { defineStore } from 'pinia'
import {
  browserEnvironment,
  browserPort,
  disablePush,
  enablePush,
  pushState,
  pushSupport,
  readPushChoice,
  writePushChoice,
  type PushPort,
  type PushState,
  type PushSupport,
} from '~/data/pushSubscription'
import { useLocaleStore } from '~/stores/locale'
import { useSessionStore } from '~/stores/session'

/** What the import page shows of "Notify me when it's done": nothing, the iOS install note, the button, the told state, the blocked note. */
export type PushView = 'hidden' | 'install' | 'ask' | 'on' | 'blocked'

/**
 * "Notify me when it's done" (Web Push for the import job, data/pushSubscription.ts; the server sends it, supabase/functions/import-job/README.md).
 *
 * Offered on the import page while her job is live, and only there: the permission is asked on her tap (`enable`), never on load. What the
 * page shows is where this browser stands: hidden where there is no Web Push or the build has no VAPID key (`NUXT_PUBLIC_VAPID_PUBLIC_KEY`),
 * a note on iPhone/iPad outside the Home Screen app, the button, "we'll notify you", or "blocked in the browser's settings". She is told only
 * if this browser's subscription is hers: the device remembers that she agreed (`libellus.push-notify`, cleared with her sign-out).
 */
export const useImportPushStore = defineStore('importPush', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const language = useLocaleStore()
  const publicKey = String((useRuntimeConfig().public as { vapidPublicKey?: unknown }).vapidPublicKey ?? '').trim()

  const storage = () => (typeof window === 'undefined' ? null : window.localStorage)
  const support = ref<PushSupport>('unsupported')
  const state = ref<PushState>('ask')
  /** The permission question or the subscribing is on its way. */
  const busy = ref(false)
  /** The last tap did not work out: the server or the push service could not be reached. */
  const problem = ref<'failed' | 'offline' | null>(null)
  /** The word for the polite status (assistive tech) after a tap: `on` or `off`. */
  const said = ref<'on' | 'off' | null>(null)
  let port: PushPort | null = null

  const view = computed<PushView>(() => {
    if (!publicKey || support.value === 'unsupported') return 'hidden'
    return support.value === 'install' ? 'install' : state.value
  })

  /** Reads where this browser stands (the page calls it when it shows the offer, and when she comes back to it). Never asks for anything. */
  async function check() {
    if (typeof window === 'undefined' || !publicKey) return
    support.value = pushSupport(browserEnvironment())
    if (support.value !== 'ready') return
    port = browserPort()
    if (!port) {
      support.value = 'unsupported'
      return
    }
    const found = await pushState(port)
    state.value = found === 'on' && !readPushChoice(storage()) ? 'ask' : found
    if (found !== 'on') writePushChoice(storage(), false)
  }

  /** Her tap: the browser asks, this browser subscribes, the server is told. The first thing it does is the permission (the tap is still the gesture). */
  async function enable() {
    if (busy.value || !backend || !port) return
    busy.value = true
    problem.value = null
    try {
      const result = await enablePush(backend, port, { publicKey, locale: language.current })
      if (result === 'on') {
        state.value = 'on'
        said.value = 'on'
        writePushChoice(storage(), true)
      } else if (result === 'blocked') {
        state.value = 'blocked'
      } else if (result === 'failed' || result === 'offline' || result === 'unavailable') {
        problem.value = result === 'offline' ? 'offline' : 'failed'
      }
      // `dismissed`: she closed the question; the button stays.
    } finally {
      busy.value = false
    }
  }

  /** "Turn off": this browser stops being told, and the server forgets it. */
  async function disable() {
    if (busy.value || !backend || !port) return
    busy.value = true
    try {
      await disablePush(backend, port)
      state.value = 'ask'
      said.value = 'off'
      writePushChoice(storage(), false)
    } finally {
      busy.value = false
    }
  }

  // Another member, or nobody: this browser's subscription was not hers.
  watch(
    () => session.member?.id,
    (now, before) => {
      if (now === before) return
      state.value = 'ask'
      said.value = null
      problem.value = null
      void check()
    },
  )

  return { view, busy, problem, said, check, enable, disable }
})
