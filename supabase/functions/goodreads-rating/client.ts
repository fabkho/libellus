/**
 * The function's only way to Goodreads: politely identified, at most one
 * request a second, each given three seconds (issue #69). `fetch` and the
 * clock come in from outside, so the tests answer from recordings and never
 * wait for real.
 *
 * The limit is per running instance of the function (Supabase may run more
 * than one under load): a soft limit. Requests queue behind each other; one
 * that would have to wait longer than `maxWaitMs` is refused at once
 * (`GoodreadsBusy`) instead of piling up, and the page simply shows no line.
 */
import {
  autoCompleteUrl,
  type AutoCompleteBook,
  type GoodreadsAnswer,
  parseAutoComplete,
  parseReviewCounts,
  reviewCountsUrl,
} from './goodreads.ts'

/** Who is asking: the app, by name, with where it lives. */
export const USER_AGENT = 'Libellus/1.0 (private book tracker; +https://libellus.fabkho.dev)'
export const MIN_INTERVAL_MS = 1000
export const REQUEST_TIMEOUT_MS = 3000
export const MAX_WAIT_MS = 4000

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** Too many requests queued already: try again later. Never stored. */
export class GoodreadsBusy extends Error {
  constructor() {
    super('goodreads_busy')
  }
}

export type Goodreads = {
  reviewCounts: (isbn13: string) => Promise<GoodreadsAnswer>
  autoComplete: (query: string) => Promise<AutoCompleteBook[]>
}

export function createGoodreads(options: {
  fetch: FetchLike
  clock?: Clock
  minIntervalMs?: number
  timeoutMs?: number
  maxWaitMs?: number
}): Goodreads {
  const clock = options.clock ?? realClock
  const minInterval = options.minIntervalMs ?? MIN_INTERVAL_MS
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const maxWait = options.maxWaitMs ?? MAX_WAIT_MS
  /** When the next request may start. */
  let nextStart = 0

  async function get(url: string): Promise<{ status: number; body: string }> {
    const now = clock.now()
    const start = Math.max(now, nextStart)
    if (start - now > maxWait) throw new GoodreadsBusy()
    nextStart = start + minInterval
    if (start > now) await clock.sleep(start - now)
    const response = await options.fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    })
    return { status: response.status, body: await response.text() }
  }

  return {
    async reviewCounts(isbn13) {
      const { status, body } = await get(reviewCountsUrl(isbn13))
      return parseReviewCounts(isbn13, status, body)
    },
    async autoComplete(query) {
      const { status, body } = await get(autoCompleteUrl(query))
      return parseAutoComplete(status, body)
    },
  }
}
