import { defineStore } from 'pinia'
import {
  applyUpdate,
  checkForUpdate,
  dueForForegroundCheck,
  latestBuildUrl,
  parseBuildId,
  type CheckDeps,
  type RegistrationLike,
  type UpdateCheck,
} from '~/utils/appUpdate'

/** What the last look found; `idle` before any. */
export type UpdateResult = 'idle' | 'checking' | 'current' | 'available' | 'failed'

/**
 * A new release of the installed app (utils/appUpdate.ts has the logic, docs/parity.md "App update" the
 * rules): what the app knows (`waiting` worker, `outdated` build), when it asks (`pending`: there is
 * something she has not answered, so the plugin raises the sheet as soon as no field has the cursor and no
 * other layer is on screen, plugins/app-update.client.ts), and what the Profile's Account rows show.
 *
 * "Later" (`dismiss`) is for this visit only: a later start of the app asks again, because the waiting
 * worker is still there and the build id still differs.
 */
export const useAppUpdateStore = defineStore('appUpdate', () => {
  /** A new service worker has installed and waits. */
  const waiting = ref(false)
  /** The server deploys another build than this page runs. */
  const outdated = ref(false)
  /** "Later": quiet until the app starts again. */
  const dismissed = ref(false)
  /** The sheet "New version available". */
  const sheetOpen = ref(false)
  const checking = ref(false)
  const applying = ref(false)
  const result = ref<UpdateResult>('idle')

  const available = computed(() => waiting.value || outdated.value)
  /** Something to offer that she has not answered and that is not on screen: the plugin opens the sheet when it may. */
  const pending = computed(() => available.value && !dismissed.value && !sheetOpen.value && !applying.value)

  let lastCheckAt: number | null = null
  let inflight: Promise<UpdateCheck> | null = null

  function registration(): RegistrationLike | undefined {
    if (!import.meta.client) return undefined
    return useNuxtApp().$pwa?.getSWRegistration?.() as RegistrationLike | undefined
  }

  /** The build id the server deploys now: a plain request past every cache, so no worker event is needed. */
  async function fetchDeployedBuildId(): Promise<string | null> {
    const { baseURL, buildAssetsDir } = useRuntimeConfig().app
    try {
      const response = await fetch(`${latestBuildUrl(baseURL, buildAssetsDir)}?t=${Date.now()}`, { cache: 'no-store' })
      return response.ok ? parseBuildId(await response.json()) : null
    } catch {
      return null
    }
  }

  function deps(): CheckDeps {
    return {
      registration: registration(),
      fetchDeployedBuildId,
      runningBuildId: String(useRuntimeConfig().app.buildId ?? ''),
    }
  }

  function run(): Promise<UpdateCheck> {
    inflight ??= checkForUpdate(deps()).finally(() => {
      inflight = null
    })
    return inflight
  }

  /** The browser told us a worker is waiting (`$pwa.needRefresh`). */
  function markWaiting() {
    waiting.value = true
    if (result.value !== 'checking') result.value = 'available'
  }

  /**
   * Looks now. `manual` (the Account row) always looks and shows the answer; `foreground` (the app came
   * back) skips a look made a moment ago. Never throws: a look that learns nothing is `failed`.
   */
  async function check({ manual = false, foreground = false } = {}): Promise<UpdateResult> {
    if (!import.meta.client) return result.value
    if (foreground && !dueForForegroundCheck(Date.now(), lastCheckAt)) return result.value
    lastCheckAt = Date.now()
    checking.value = true
    if (manual) result.value = 'checking'
    try {
      const found = await run()
      waiting.value = found.waiting || waiting.value
      outdated.value = found.outdated
      if (available.value) result.value = 'available'
      else if (!found.failed) result.value = 'current'
      else if (manual) result.value = 'failed'
      else if (result.value === 'checking') result.value = 'idle'
      return result.value
    } finally {
      checking.value = false
    }
  }

  /** Raises the sheet (the plugin calls it when nobody is typing and nothing else is on screen). */
  function open() {
    if (available.value) sheetOpen.value = true
  }

  /** "Later", or any other way out of the sheet: quiet until the app starts again. */
  function dismiss() {
    dismissed.value = true
    sheetOpen.value = false
  }

  /** The Account row: she asked, so the sheet comes at once, whatever she dismissed before. */
  function reopen() {
    dismissed.value = false
    open()
  }

  /** "Update now": the new worker takes over and the page reloads (or, with none, it reloads anyway). */
  async function apply() {
    if (applying.value) return
    applying.value = true
    try {
      await applyUpdate({
        registration: registration(),
        activateWaiting: () => useNuxtApp().$pwa?.updateServiceWorker(true),
        reload: () => window.location.reload(),
        check: run,
      })
    } finally {
      // The reload normally ends this page first; if it did not, she can try again.
      applying.value = false
    }
  }

  return {
    waiting,
    outdated,
    dismissed,
    sheetOpen,
    checking,
    applying,
    result,
    available,
    pending,
    markWaiting,
    check,
    open,
    dismiss,
    reopen,
    apply,
  }
})
