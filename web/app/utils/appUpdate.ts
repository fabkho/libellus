// Finding and applying a new release of the installed app (docs/parity.md, "App update"). Plain
// TypeScript with everything it touches handed in, so Vitest runs it in Node with a stand-in service
// worker registration; the store (stores/appUpdate.ts) and the plugin (plugins/app-update.client.ts)
// put the real browser behind it.
//
// Two independent signals say "there is a new version":
//  1. a service worker that has installed and waits (`registration.waiting`) — what actually has the
//     new files, and what "Update now" activates;
//  2. the build id the server deploys now (`/_nuxt/builds/latest.json`) differing from the one this page
//     was built with. A plain `fetch`, so it does not depend on service worker lifecycle events, which an
//     installed iPhone app resumes without (no navigation, no new check). It also tells the page when the
//     browser's own worker check has not run yet; a hit forces `registration.update()` anyway.

/** While the app stays open: how often it looks again. */
export const CHECK_INTERVAL_MS = 30 * 60_000
/** Coming back to the foreground looks again at most this often (a quick app switch is not a visit). */
export const FOREGROUND_GAP_MS = 60_000
/** How long a check waits for a worker that is installing to finish. */
export const INSTALL_WAIT_MS = 15_000
/** `updateServiceWorker(true)` reloads by itself once the worker took over; if that never comes, so do we. */
export const RELOAD_FALLBACK_MS = 4_000

export interface WorkerLike {
  state: string
  addEventListener(type: 'statechange', listener: () => void): void
  removeEventListener(type: 'statechange', listener: () => void): void
}

/** What of a `ServiceWorkerRegistration` the logic needs. */
export interface RegistrationLike {
  update(): Promise<unknown>
  readonly waiting: WorkerLike | null
  readonly installing: WorkerLike | null
}

/** The build id inside `latest.json` (`{ id, timestamp }`), null for anything else. */
export function parseBuildId(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const id = (json as { id?: unknown }).id
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

/**
 * The deployed build is not the one running. Build ids are random (no order), so any difference counts;
 * an unreadable answer (offline, no file: null) never does, and neither does a page that does not know
 * its own id.
 */
export function isOutdated(running: string, deployed: string | null): boolean {
  return Boolean(running) && deployed !== null && deployed !== running
}

/** Where the build id is served: `<buildAssetsDir>builds/latest.json` (`/_nuxt/builds/latest.json`). */
export function latestBuildUrl(baseURL: string, buildAssetsDir: string): string {
  const join = (a: string, b: string) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`
  return join(join(baseURL || '/', buildAssetsDir || '/_nuxt/'), 'builds/latest.json')
}

/** A look because the app came back to the foreground: not if one was made a moment ago. */
export function dueForForegroundCheck(now: number, lastCheckAt: number | null, gapMs = FOREGROUND_GAP_MS): boolean {
  return lastCheckAt === null || now - lastCheckAt >= gapMs
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'image', 'reset', 'submit'])

/** A text field has the cursor (the keyboard is, or is about to be, up): nothing may take the screen then. */
export function isTyping(active: Element | null): boolean {
  if (!active) return false
  const tag = active.tagName?.toLowerCase()
  if (tag === 'textarea') return true
  if (tag === 'input') return !NON_TEXT_INPUTS.has((active as HTMLInputElement).type?.toLowerCase() ?? 'text')
  return (active as HTMLElement).isContentEditable === true
}

/**
 * The sheet may rise: nobody is typing and no layer of the app is on screen. `modalOpen` is
 * `useModalShown()` (composables/useModalLayer.ts): a sheet, a confirm, the search palette or the reader —
 * the reader is a modal layer too (components/reader/Reader.vue), so a new version never interrupts a book.
 */
export function canInterrupt(now: { typing: boolean; modalOpen: boolean }): boolean {
  return !now.typing && !now.modalOpen
}

export interface UpdateCheck {
  /** A new worker has installed and waits for her go. */
  waiting: boolean
  /** The server deploys another build than the one running. */
  outdated: boolean
  /** Nothing could be learned (offline, no worker and no `latest.json`). */
  failed: boolean
}

export interface CheckDeps {
  /** The page's registration; none in dev, in a browser without service workers, or before it registered. */
  registration: RegistrationLike | null | undefined
  /** The build id the server deploys now; null when it cannot be read. */
  fetchDeployedBuildId: () => Promise<string | null>
  /** The id this page was built with. */
  runningBuildId: string
  installWaitMs?: number
}

/** Resolves when `worker` has finished installing (or failed, or the wait is over). */
export function whenInstalled(worker: WorkerLike | null, waitMs = INSTALL_WAIT_MS): Promise<void> {
  if (!worker || worker.state !== 'installing') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      worker.removeEventListener('statechange', onChange)
      resolve()
    }
    const onChange = () => {
      if (worker.state !== 'installing') done()
    }
    const timer = setTimeout(done, waitMs)
    worker.addEventListener('statechange', onChange)
  })
}

/**
 * Looks now: asks the browser for a newer worker (`registration.update()`, which fetches `sw.js` past
 * every cache), reads the deployed build id, and reports what it found. A worker that installs during the
 * wait is counted, so the caller can answer "you have the latest version" with confidence.
 */
export async function checkForUpdate(deps: CheckDeps): Promise<UpdateCheck> {
  const { registration } = deps
  const swLook = (async () => {
    if (!registration) return false
    try {
      await registration.update()
      await whenInstalled(registration.installing, deps.installWaitMs)
      return true
    } catch {
      return false
    }
  })()
  const deployed = await deps.fetchDeployedBuildId().catch(() => null)
  const swAnswered = await swLook
  const outdated = isOutdated(deps.runningBuildId, deployed)
  // A deployed build the page does not run, with no worker installed for it yet: ask again, it is
  // probably on its way (the file and `latest.json` change together, but the browser may have checked
  // `sw.js` a moment before the deploy finished).
  if (outdated && registration && !registration.waiting && !registration.installing) {
    try {
      await registration.update()
      await whenInstalled(registration.installing, deps.installWaitMs)
    } catch {
      // the id alone already says it
    }
  }
  return {
    waiting: Boolean(registration?.waiting),
    outdated,
    failed: deployed === null && !swAnswered,
  }
}

export interface ApplyDeps {
  registration: RegistrationLike | null | undefined
  /** vite-pwa's `updateServiceWorker(true)`: posts SKIP_WAITING and reloads once the worker is in control. */
  activateWaiting: () => Promise<void> | void
  reload: () => void
  check: () => Promise<UpdateCheck>
  reloadFallbackMs?: number
}

/**
 * "Update now": make sure the newest worker waits (look once more if none does), let it take over and
 * reload. Nothing is unregistered or cleared, so her session stays and the registration keeps the caches
 * it owns. Without a worker to activate (dev; a deploy the browser has not picked up) it still reloads:
 * the next start then fetches the shell afresh.
 */
export async function applyUpdate(deps: ApplyDeps): Promise<void> {
  if (!deps.registration?.waiting) await deps.check()
  if (deps.registration?.waiting) {
    await deps.activateWaiting()
    await new Promise((resolve) => setTimeout(resolve, deps.reloadFallbackMs ?? RELOAD_FALLBACK_MS))
  }
  deps.reload()
}
