/**
 * The function's only way to the German National Library (DNB): its SRU interface, asked politely
 * (identified, at most five requests a second per running instance, four seconds each) behind a
 * circuit breaker: its converter fails now and then with a diagnostic and HTTP 200, which a status
 * check does not see, so three failed answers in a row rest the source for a minute. `fetch` and
 * the clock come in from outside, so the tests answer from recordings and never wait for real.
 */
import {
  DNB_LIMIT,
  type DnbRecord,
  DnbError,
  isbnQuery,
  parseDnb,
  sruUrl,
  titleQuery,
} from '../../../web/app/data/dnbRecord.ts'

export const REQUEST_TIMEOUT_MS = 4000
export const MIN_INTERVAL_MS = 200
export const FAILURES_BEFORE_REST = 3
export const REST_MS = 60_000

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }

/** The source is resting after repeated failures, or is not answering: nothing is stored about it. */
export class DnbUnavailable extends Error {
  constructor(message = 'dnb_unavailable') {
    super(message)
  }
}

export function userAgent(siteUrl?: string | null): string {
  const site = siteUrl?.trim()
  return `Libellus/1.0 (private book tracker${site ? `; +${site}` : ''})`
}

export type Dnb = {
  /** The records with this ISBN-13. */
  byIsbn: (isbn13: string) => Promise<DnbRecord[]>
  /** The books of a title and the first author's surname. */
  byTitle: (title: string, author: string) => Promise<DnbRecord[]>
}

export function createDnb(options: { fetch: FetchLike; clock?: Clock; userAgent?: string; timeoutMs?: number }): Dnb {
  const clock = options.clock ?? realClock
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  let nextAt = 0
  let failures = 0
  let restUntil = 0

  async function ask(query: string, limit: number): Promise<DnbRecord[]> {
    if (restUntil > clock.now()) throw new DnbUnavailable('resting')
    // Requests queue behind each other, MIN_INTERVAL_MS apart.
    const at = Math.max(clock.now(), nextAt)
    nextAt = at + MIN_INTERVAL_MS
    if (at > clock.now()) await clock.sleep(at - clock.now())
    try {
      const response = await options.fetch(sruUrl(query, limit), {
        headers: { 'user-agent': options.userAgent ?? userAgent(), accept: 'text/xml' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new DnbError(`services.dnb.de answered ${response.status}`)
      const records = parseDnb(await response.text())
      failures = 0
      return records
    } catch (error) {
      if (++failures >= FAILURES_BEFORE_REST) {
        restUntil = clock.now() + REST_MS
        failures = 0
      }
      throw new DnbUnavailable(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    byIsbn: (isbn13) => ask(isbnQuery(isbn13), 5),
    async byTitle(title, author) {
      const query = titleQuery(title, author)
      return query ? await ask(query, DNB_LIMIT) : []
    },
  }
}
