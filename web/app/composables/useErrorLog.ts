import {
  createErrorLog,
  createErrorSender,
  keyValueErrorStorage,
  shortUserAgent,
  type ErrorKind,
  type ErrorLog,
  type ReportExtra,
} from '~/data/errorLog'

/** Where the line of reports waits on the device (under `libellus.`: signing out clears it with the rest). */
export const ERROR_LOG_KEY = 'libellus.errorLog'
/**
 * Development only: `localStorage['libellus-dev:error-log'] = 'send'` makes this
 * dev server send its reports to the stack, like a production build (a flow
 * once set it; tests/error-log.test.ts holds the rules). Never cleared by signing out, never read in a build
 * other than the Playwright flows' (`__LIBELLUS_E2E__`), which behaves as the dev server.
 */
export const ERROR_LOG_DEV_KEY = 'libellus-dev:error-log'

let log: ErrorLog | null = null

/** Whether reports go to the database: a build unless NUXT_PUBLIC_ERROR_LOG=off; development (and the flows' build) only when asked. */
function sends(setting: string): boolean {
  if (!import.meta.dev && !__LIBELLUS_E2E__) return setting !== 'off'
  if (setting === 'send') return true
  try {
    return localStorage.getItem(ERROR_LOG_DEV_KEY) === 'send'
  } catch {
    return false
  }
}

function standalone(): boolean | null {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  } catch {
    return null
  }
}

/**
 * The app's one error log (data/errorLog.ts): made on first use, inside the
 * app (plugins/error-log.client.ts makes it as the app starts). In development
 * every report is printed and, unless asked (above), nothing is sent.
 */
export function useErrorLog(): ErrorLog {
  if (log) return log
  const config = useRuntimeConfig()
  const client = sends(String(config.public.errorLog ?? '')) ? useBackend() : null
  const appVersion = String(config.app.buildId ?? '') || null
  const userAgent = shortUserAgent(navigator.userAgent)
  log = createErrorLog({
    send: client ? createErrorSender(client) : null,
    storage: keyValueErrorStorage(localStorage, ERROR_LOG_KEY),
    online: isOnline,
    route: () => window.location.pathname,
    context: () => ({ appVersion, userAgent, standalone: standalone() }),
    onReport: import.meta.dev || __LIBELLUS_E2E__ ? (report) => console.warn(`[error log] ${client ? 'sending' : 'not sent'}:`, report) : undefined,
  })
  return log
}

/**
 * Reports an error from anywhere in the app (a store, a component). Never throws:
 * an error log that fails must not break what called it.
 */
export function reportError(kind: ErrorKind, error: unknown, extra?: ReportExtra): void {
  try {
    useErrorLog().report(kind, error, extra)
  } catch {
    // No log (outside the app, no window): nothing to do.
  }
}
