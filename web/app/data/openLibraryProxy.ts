import { isAbort, type FetchLike } from './fetching'

/**
 * The import's Open Library through the app's own server (issue: identified, paced requests).
 * Open Library allows one request a second of an unidentified client and three of an identified
 * one (`User-Agent: Libellus/1.0 (<contact>)`); a browser cannot set its User-Agent, and the
 * import asks far more than one a second. So the import's Open Library requests are rewritten to
 * the `openlibrary` edge function (supabase/functions/openlibrary: signed-in members only, an
 * allow-list of paths, the identified User-Agent, three requests a second across every instance), and the
 * rest — Apple, and every cover image (`covers.openlibrary.org`, whose `b/id/…` has no limit) —
 * goes out as it always did. The Search screen and the Book page are not the import: they keep
 * talking to Open Library direct.
 *
 * One slow or failed answer is not a broken function. A 504 (`openlibrary_timeout`: Open Library took too
 * long on one request), a 502 (`unreachable`) or a network error is a **failed request**: it is asked again
 * through the function after a short backoff (`RETRY_BACKOFF_MS`, a `Retry-After` it names respected up to
 * `RETRY_AFTER_CAP_MS`), and only `FAILURES_BEFORE_FALLBACK` (3) consecutive failures — any success resets the
 * count — turn the import **direct**. A 401 (a lapsed token) and a 429 that asks for more than a minute (the
 * server address is being blocked) go direct at once, as before; a 503 and a shorter 429 are passed on for the
 * caller's own back-off. Direct is one request a second (the unidentified tier), paced here, and **not forever**:
 * after `FALLBACK_COOLDOWN_MS` (60 s) the next request is tried through the function once (a probe); if it
 * answers the import is back on the function's pace, if it fails the cooldown starts again. A request that
 * ends in direct always gets its answer from there, so a row never waits on a function that is down. The
 * retries fit the caller's 15 s call deadline (`LOOKUP_TIMEOUT_MS`): the function gives up on Open Library
 * after 10 s, and a retry takes about a second. `stats()` counts the function's failures, the retries, the
 * fallbacks and recoveries, and how long the import was direct (`web/scripts/import-quality.ts` prints it).
 * Everything else about the answer is unchanged: the caller parses what it parsed before.
 *
 * Pacing of the routed requests belongs to the `pacedFetch` wrapped around this (its host key is
 * the caller's URL, `openlibrary.org`; the store gives it 340 ms there), so one gap serves both
 * ways; the direct fallback's own 1/s lives here, because only it knows which way a request goes.
 * Framework-free: `fetch`, the clock and the waiting come in from outside.
 */

/** The host whose requests are sent through the own server. Covers (`covers.openlibrary.org`) are not on it. */
export const OPENLIBRARY_HOST = 'openlibrary.org'
/** A direct request waits out the fallback's one-a-second pace (the unidentified tier). */
export const DIRECT_GAP_MS = 1000
/** Consecutive function failures (a timeout, an unreachable Open Library, a network error) before the import goes direct. */
export const FAILURES_BEFORE_FALLBACK = 3
/** How long the import stays direct before the function is tried again. */
export const FALLBACK_COOLDOWN_MS = 60_000
/** The wait before the first and the second retry of a failed request through the function. */
export const RETRY_BACKOFF_MS = [500, 1000]
/** The longest `Retry-After` of a failed answer that is waited out before the retry (a longer one is capped). */
export const RETRY_AFTER_CAP_MS = 5000
/** A refusal that asks for a pause this long means the server address is being blocked: go direct. */
export const REFUSED_FOR_FALLBACK_MS = 60_000

/** The slice of `fetch` the wrapper adds its headers through. */
export type HeaderFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Awaited<ReturnType<FetchLike>>>

export type ViaOwnServer = FetchLike & {
  /** True while the function is given up on and this import talks to Open Library direct. */
  fallbackActive: () => boolean
  /** What the function's failures cost this import so far. */
  stats: () => ViaOwnServerStats
}

export type ViaOwnServerStats = {
  /** Requests through the function that failed (a timeout, a 502 or other 5xx, a network error, a refusal). */
  functionFailures: number
  /** Failed requests asked again through the function. */
  retries: number
  /** Times the import went direct. */
  fallbacks: number
  /** Times the function was tried again after the cooldown and answered. */
  recoveries: number
  /** Requests sent direct to Open Library. */
  directRequests: number
  /** How long the import has been direct, in total (a stretch still running counts up to now). */
  directMs: number
}

/** The current access token of a Supabase client, as `viaOwnServer` wants its `token`. */
export type SessionBearer = { auth: { getSession: () => Promise<{ data: { session: { access_token: string } | null } }> } }

export function accessTokenOf(client: SessionBearer): () => Promise<string | null> {
  return async () => (await client.auth.getSession()).data.session?.access_token ?? null
}

export function viaOwnServer(
  fetch: HeaderFetch,
  options: {
    /** Where the function lives, e.g. `https://<project>.supabase.co/functions/v1/openlibrary`. */
    functionUrl: string
    /** The member's access token, or a getter for one that changes (accessTokenOf). */
    token: string | (() => Promise<string | null>)
    /** The anon key, sent beside the token as `apikey` (what supabase-js sends). */
    apikey?: string
    /** How far apart two direct Open Library requests are kept once fallen back. */
    directGapMs?: number
    /** Consecutive function failures before going direct (default `FAILURES_BEFORE_FALLBACK`). */
    failuresBeforeFallback?: number
    /** How long to stay direct before the function is tried again (default `FALLBACK_COOLDOWN_MS`). */
    cooldownMs?: number
    now?: () => number
    wait?: (ms: number, signal?: AbortSignal) => Promise<void>
  },
): ViaOwnServer {
  const gapMs = options.directGapMs ?? DIRECT_GAP_MS
  const now = options.now ?? Date.now
  const wait =
    options.wait ??
    ((ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        if (ms <= 0) return resolve()
        const timer = setTimeout(resolve, ms)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('The search was replaced by a newer one', 'AbortError'))
        }, { once: true })
      }))
  const failuresBeforeFallback = options.failuresBeforeFallback ?? FAILURES_BEFORE_FALLBACK
  const cooldownMs = options.cooldownMs ?? FALLBACK_COOLDOWN_MS
  /** Since when the import is direct, or null while it is on the function. */
  let directSince: number | null = null
  /** When the function may be tried again. */
  let retryAt = 0
  /** A probe of the function is in flight (the others stay direct meanwhile). */
  let probing = false
  /** Failures through the function since its last answer. */
  let failures = 0
  let directTotalMs = 0
  const counts = { functionFailures: 0, retries: 0, fallbacks: 0, recoveries: 0, directRequests: 0 }
  /** When the next direct request may go out (the fallback's 1/s). */
  let directNextAt = 0

  const target = new URL(options.functionUrl)

  /** The request as the function wants it: `?path=<the Open Library path>&<its query>`, with the caller's token. */
  async function routed(url: string, init?: { signal?: AbortSignal }) {
    const asked = new URL(url)
    const to = new URL(target)
    to.searchParams.set('path', asked.pathname)
    for (const [name, value] of asked.searchParams) to.searchParams.append(name, value)
    const token = typeof options.token === 'function' ? await options.token() : options.token
    return await fetch(to.toString(), {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.apikey ? { apikey: options.apikey } : {}) },
    })
  }

  /** Direct Open Library, one request a second: what an unidentified browser gets, and the import's way out. */
  async function direct(url: string, init?: { signal?: AbortSignal }) {
    counts.directRequests++
    const at = Math.max(now(), directNextAt)
    directNextAt = at + gapMs
    await wait(at - now(), init?.signal)
    return await fetch(url, init)
  }

  /** The seconds a `Retry-After` names, in ms, or 0. */
  function retryAfterMs(answer: Awaited<ReturnType<FetchLike>>): number {
    const seconds = Number(answer.headers?.get('retry-after'))
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0
  }

  /** Whether the server address is not usable for this import at all (not just this request). */
  function refused(answer: Awaited<ReturnType<FetchLike>>): boolean {
    if (answer.status === 401) return true
    return answer.status === 429 && retryAfterMs(answer) > REFUSED_FOR_FALLBACK_MS
  }

  /** Whether the function itself failed this request: a timeout (504), unreachable (502) or another 5xx but Open Library's 503. */
  const failed = (answer: Awaited<ReturnType<FetchLike>>) => answer.status >= 500 && answer.status !== 503

  type Attempt = { answer: Awaited<ReturnType<FetchLike>> } | { hard: boolean; retryAfter: number }

  /** One request through the function. Throws only the caller's own abort. */
  async function attempt(url: string, init?: { signal?: AbortSignal }): Promise<Attempt> {
    let answer: Awaited<ReturnType<FetchLike>>
    try {
      answer = await routed(url, init)
    } catch (error) {
      // A replaced query is the caller's own ending, not the function's failure.
      if (isAbort(error)) throw error
      return { hard: false, retryAfter: 0 }
    }
    if (refused(answer)) return { hard: true, retryAfter: 0 }
    if (failed(answer)) return { hard: false, retryAfter: retryAfterMs(answer) }
    return { answer }
  }

  function goDirect() {
    // A request that was already in flight when another one gave up does not start the cooldown again.
    if (directSince !== null) return
    directSince = now()
    retryAt = directSince + cooldownMs
    counts.fallbacks++
  }

  const wrapped: ViaOwnServer = async (url, init) => {
    if (new URL(url).hostname !== OPENLIBRARY_HOST) return await fetch(url, init)

    if (directSince !== null) {
      if (now() < retryAt || probing) return await direct(url, init)
      // The cooldown is over: one request tries the function again, the others stay direct meanwhile.
      probing = true
      try {
        const tried = await attempt(url, init)
        if ('answer' in tried) {
          directTotalMs += now() - directSince
          directSince = null
          failures = 0
          counts.recoveries++
          return tried.answer
        }
        counts.functionFailures++
        retryAt = now() + cooldownMs
      } finally {
        probing = false
      }
      return await direct(url, init)
    }

    for (let tries = 0; ; tries++) {
      const tried = await attempt(url, init)
      if ('answer' in tried) {
        failures = 0
        return tried.answer
      }
      counts.functionFailures++
      failures++
      if (tried.hard || failures >= failuresBeforeFallback) {
        goDirect()
        return await direct(url, init)
      }
      // One timeout is a failed request, not a broken function: ask again, shortly after (and after the Retry-After).
      counts.retries++
      const backoff = RETRY_BACKOFF_MS[Math.min(tries, RETRY_BACKOFF_MS.length - 1)] ?? 0
      await wait(Math.max(backoff, Math.min(tried.retryAfter, RETRY_AFTER_CAP_MS)), init?.signal)
      // Another request may have given up on the function while this one waited.
      if (directSince !== null) return await direct(url, init)
    }
  }
  wrapped.fallbackActive = () => directSince !== null
  wrapped.stats = () => ({ ...counts, directMs: directTotalMs + (directSince === null ? 0 : now() - directSince) })
  return wrapped
}
