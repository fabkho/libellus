/**
 * The function's only way to Open Library: identified (`User-Agent: Libellus/1.0 (<contact>)`, the
 * contact from the `OPENLIBRARY_CONTACT` secret), at most three requests a second — the rate Open
 * Library allows an identified client (https://openlibrary.org/developers/api, "Rate Limits": 1/s
 * unidentified, 3/s identified). The pace is a `Pace` (../_shared/pace.ts): index.ts gives it the
 * one shared by every instance and member (a turn booked in Postgres), and without one the request
 * keeps this instance's own distance, `MIN_INTERVAL_MS` apart. A request whose turn is too far away
 * rejects with `PaceBusy`. A refusal with a `Retry-After` holds the pace that long (at most
 * `MAX_RETRY_AFTER_MS`), for every instance, so one refused request does not turn into a storm.
 * `fetch` and the clock come in from outside, so the tests answer from recordings and never wait for real.
 *
 * The answer is handed back as it came (status, body, `content-type`, `Retry-After`): the caller
 * parses what it parsed before the function was in between.
 */
import { localPace, type Pace } from '../_shared/pace.ts'

/**
 * Open Library answers in 0.5–1.3 s (an occasional slow one is transient), so 10 s is a wide margin, and it
 * leaves the import's 15 s call deadline room for one retry through the function (10 s + backoff + ~1 s).
 */
export const REQUEST_TIMEOUT_MS = 10_000
/** At most three requests a second (the identified tier); the shared pace and an instance's own queue both use it. */
export const MIN_INTERVAL_MS = 340
/**
 * The longest a request waits for its turn at the shared pace: 4 s + the 10 s Open Library may take stay under the
 * import's 15 s call deadline. A turn further away is answered 503 `busy` with a `Retry-After` (the client waits and asks again).
 */
export const PACE_MAX_WAIT_MS = 4000
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
  /** The turn each request takes before it goes out; this instance's own queue when none is given. */
  pace?: Pace
  timeoutMs?: number
  maxBodyBytes?: number
}): OpenLibrary {
  const clock = options.clock ?? realClock
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES
  const pace = options.pace ?? localPace({ gapMs: MIN_INTERVAL_MS, clock })

  return {
    async ask(path, query) {
      // The turn comes first (it may be a wait, or `PaceBusy`), then the request.
      await pace.take()
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
        // Every instance waits out what Open Library asked for (capped), instead of meeting the refusal again.
        if (Number.isFinite(seconds) && seconds > 0) await pace.hold(Math.min(seconds * 1000, MAX_RETRY_AFTER_MS))
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
