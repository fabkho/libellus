/**
 * A connection that answers nothing (issue #105). `navigator.onLine` only knows
 * that there is no network at all; a phone on a train Wi-Fi, a captive portal or
 * a tunnel has "a connection" that never replies, and a write sent into it would
 * hang until the browser gives up, then fail as a plain error. Here that case is
 * made explicit, so the app can treat it as offline:
 *
 *   - a write to the database that gets no answer within `WRITE_TIMEOUT_MS` is
 *     cut off (`withWriteTimeout`) and ends as a network failure (status 0);
 *   - a write that ends that way, or any network error, "got no answer"
 *     (`isNoAnswer`): the repositories put it in the outbox instead of showing an
 *     error, and the device counts as offline for writes until it answers again;
 *   - `createProbe` is the cheap question "does anything answer?", asked before
 *     the outbox is flushed and while the device waits to count as online again.
 *
 * Framework-free: the fetch it wraps and the callbacks it reports to are handed in.
 */

/** How long a write may wait for its answer before the device treats the connection as dead. */
export const WRITE_TIMEOUT_MS = 8_000
/** How long the reachability probe waits for an answer. */
export const PROBE_TIMEOUT_MS = 4_000

/**
 * Calls through the REST API that are not short writes: a search is a read sent
 * as a POST and an import is a long batch, so a few seconds of silence is not
 * the end of them.
 */
const UNTIMED_RPC = new Set(['search_books', 'import_books', 'invite_code_status'])

/** True when a database call got no answer at all: the fetch failed or was cut off (supabase-js reports status 0). */
export function isNoAnswer(result: { error: unknown; status?: number }): boolean {
  return Boolean(result.error) && result.status === 0
}

type FetchFn = typeof fetch

export type NetworkWatch = {
  /** A write was answered (by anything, a refusal included): the connection works. */
  onAnswer?: () => void
  /** A write got no answer: it timed out or the network failed. */
  onNoAnswer?: () => void
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  return (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

/** A write to the database: not a GET or HEAD, to the REST API, and not one of the slow or read-only calls. */
export function isTimedWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  const method = methodOf(input, init)
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return false
  const { pathname } = new URL(urlOf(input), 'http://localhost')
  const at = pathname.indexOf('/rest/v1/')
  if (at < 0) return false
  const rpc = pathname.slice(at + '/rest/v1/'.length).match(/^rpc\/([^/]+)/)
  return !(rpc && UNTIMED_RPC.has(rpc[1]!))
}

/**
 * `fetch` that gives a write `ms` to be answered. The call is aborted after that
 * (`AbortError`, which supabase-js reports as status 0), whether or not the server
 * heard it, and `watch` is told how each write ended. Everything else is passed
 * through as it is.
 */
export function withWriteTimeout(base: FetchFn, ms = WRITE_TIMEOUT_MS, watch: NetworkWatch = {}): FetchFn {
  return async (input, init) => {
    if (!isTimedWrite(input, init)) return base(input, init)

    const controller = new AbortController()
    const outer = init?.signal
    const forward = () => controller.abort(outer?.reason)
    if (outer?.aborted) forward()
    else outer?.addEventListener('abort', forward, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, ms)
    try {
      const response = await base(input, { ...init, signal: controller.signal })
      watch.onAnswer?.()
      return response
    } catch (error) {
      // Cut off by the caller (a screen that left, a newer query): says nothing about the connection.
      if (timedOut || !outer?.aborted) watch.onNoAnswer?.()
      throw error
    } finally {
      clearTimeout(timer)
      outer?.removeEventListener('abort', forward)
    }
  }
}

/**
 * The reachability probe: does anything at the backend answer? A GET of the auth
 * service's health check (no query, no row, a few bytes), with a short timeout.
 * Any HTTP answer below 500 counts; a failure, a timeout or a gateway error does not.
 */
export function createProbe(
  url: string,
  anonKey: string,
  base: FetchFn = (input, init) => fetch(input, init),
  ms = PROBE_TIMEOUT_MS,
): () => Promise<boolean> {
  const target = `${url.replace(/\/+$/, '')}/auth/v1/health`
  return async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), ms)
    try {
      const response = await base(target, { headers: { apikey: anonKey }, cache: 'no-store', signal: controller.signal })
      return response.status < 500
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }
}
