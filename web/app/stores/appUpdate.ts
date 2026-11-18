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
 * rules). **There is no sheet any more** (the owner, 2026-11-18, docs/proposals/app-update-2026-11-18.md):
 * an update installs itself in the background and the member is told only afterwards, by "What's new", which
 * is about the version actually running. What is left here is what the app knows (`waiting` worker,
 * `outdated` build) and the one place a member can ask on purpose, the Profile's Account row.
 *
 * `waiting` and `outdated` are deliberately different, because only one of them can be acted on with
 * `skipWaiting` off: a `waiting` worker is an update one press will install; an `outdated` build with no
 * worker is an update on its way, which the browser will fetch and the next start will run. The Account row
 * says which.
 */
export const useAppUpdateStore = defineStore('appUpdate', () => {
  /** A new service worker has installed and waits. */
  const waiting = ref(false)
  /** The server deploys another build than this page runs. */
  const outdated = ref(false)
  const checking = ref(false)
  const applying = ref(false)
  const result = ref<UpdateResult>('idle')

  /** Either kind of news: what the Account row reports. Never something that takes the screen. */
  const available = computed(() => waiting.value || outdated.value)
  /** An update one press will install now (`skipWaiting` off: only a waiting worker can be activated). */
  const installable = computed(() => waiting.value)

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

  /**
   * The Account row's one press: install a waiting worker and reload into it. With none waiting it does
   * nothing and says so (`false`) — the build is on its way and the next start runs it; reloading the same
   * shell is the dead end the owner reported (fifty presses).
   */
  async function apply(): Promise<boolean> {
    if (applying.value) return false
    applying.value = true
    try {
      return await applyUpdate({
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
    checking,
    applying,
    result,
    available,
    installable,
    markWaiting,
    check,
    apply,
  }
})
