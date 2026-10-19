/**
 * The function's only way to Open Library: one GET at a time, identified (`User-Agent:
 * Libellus/1.0 (<contact>)`, the contact from the `OPENLIBRARY_CONTACT` secret), at most three
 * requests a second per running instance — the rate Open Library allows an identified client
 * (https://openlibrary.org/developers/api, "Rate Limits": 1/s unidentified, 3/s identified). A
 * refusal with a `Retry-After` holds the queue that long (at most `MAX_RETRY_AFTER_MS`), so one
 * refused request does not turn into a storm. `fetch` and the clock come in from outside, so the
 * tests answer from recordings and never wait for real.
 *
 * The answer is handed back as it came (status, body, `content-type`, `Retry-After`): the caller
 * parses what it parsed before the function was in between.
 */
/**
 * Open Library answers in 0.5–1.3 s (an occasional slow one is transient), so 10 s is a wide margin, and it
 * leaves the import's 15 s call deadline room for one retry through the function (10 s + backoff + ~1 s).
 */
export const REQUEST_TIMEOUT_MS = 10_000
/** At most three requests a second per running instance (the identified tier). */
export const MIN_INTERVAL_MS = 340
export const MAX_RETRY_AFTER_MS = 30_000
/** An answer larger than this is not passed on (Open Library search answers can be large). */
export const MAX_BODY_BYTES = 2 * 1024 * 1024

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }

/** Open Library could not be asked: the caller answers 502 (`unreachable`) or 504 (`timeout`). */
export class OpenLibraryUnavailable extends Error {
  constructor(readonly kind: 'unreachable' | 'timeout' = 'unreachable', message: string = kind) {
    super(message)
  }
}

/** The User-Agent that makes Open Library see an identified client (the contact is a function secret). */
export function userAgent(contact: string): string {
  return `Libellus/1.0 (${contact})`
}

/** What Open Library answered, as it is. */
export type UpstreamAnswer = {
  status: number
  body: string
  contentType: string | null
  /** The upstream `Retry-After` (seconds), when it named one. */
  retryAfter: string | null
}

export type OpenLibrary = {
  /** `GET https://openlibrary.org<path>?<query>`; rejects with `OpenLibraryUnavailable`. */
  ask: (path: string, query: string) => Promise<UpstreamAnswer>
}

export function createOpenLibrary(options: {
  fetch: FetchLike
  clock?: Clock
  userAgent: string
  timeoutMs?: number
  maxBodyBytes?: number
}): OpenLibrary {
  const clock = options.clock ?? realClock
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES
  /** When the next request may go out (the interval, and any `Retry-After` that asked for longer). */
  let nextAt = 0

  return {
    async ask(path, query) {
      // Requests queue behind each other, MIN_INTERVAL_MS apart.
      const at = Math.max(clock.now(), nextAt)
      nextAt = at + MIN_INTERVAL_MS
      if (at > clock.now()) await clock.sleep(at - clock.now())
      let response: Response
      try {
        response = await options.fetch(`https://openlibrary.org${path}${query ? `?${query}` : ''}`, {
          headers: { 'user-agent': options.userAgent, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        throw new OpenLibraryUnavailable(timedOut ? 'timeout' : 'unreachable', error instanceof Error ? error.message : String(error))
      }
      const retryAfter = response.headers.get('retry-after')
      if (retryAfter && [403, 429, 503].includes(response.status)) {
        const seconds = Number(retryAfter)
        // The queue waits out what Open Library asked for (capped), instead of meeting the refusal again.
        if (Number.isFinite(seconds) && seconds > 0) nextAt = Math.max(nextAt, clock.now() + Math.min(seconds * 1000, MAX_RETRY_AFTER_MS))
      }
      let body: string
      try {
        body = await response.text()
      } catch (error) {
        throw new OpenLibraryUnavailable('unreachable', error instanceof Error ? error.message : String(error))
      }
      if (body.length > maxBodyBytes) throw new OpenLibraryUnavailable('unreachable', 'body_too_large')
      return { status: response.status, body, contentType: response.headers.get('content-type'), retryAfter }
    },
  }
}
