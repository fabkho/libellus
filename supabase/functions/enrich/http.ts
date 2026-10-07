/**
 * The function's only way out to the sources (issues #167, #168): Wikidata,
 * Wikimedia Commons, Wikipedia, Open Library and Apple Books. Polite by
 * construction:
 *
 *   - identified: `User-Agent: Libellus/1.0 (private book tracker; +<site>; <contact>)`,
 *     as the Wikimedia User-Agent policy asks (a way to reach the operator);
 *   - one request at a time per host, at least `interval` apart (Open Library
 *     and the Wikidata Query Service one a second, Apple one every three
 *     seconds, the Wikimedia APIs five a second);
 *   - a timeout per request; a 429 or 5xx (or a network error) is retried
 *     twice with a growing pause, honouring `Retry-After` up to 10 seconds;
 *   - answers kept for ten minutes in memory, so one run that meets the same
 *     author twice asks once (the tables are the long-term cache).
 *
 * `fetch` and the clock come in from outside, so the tests answer from
 * recordings and never wait for real.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> }

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}

/** A source did not answer usefully (down, slow, refusing, garbled). Never stored as a miss. */
export class SourceUnavailable extends Error {
  constructor(readonly url: string, readonly status: number | null, detail?: string) {
    super(`source_unavailable ${status ?? 'network'} ${new URL(url).host}${detail ? `: ${detail}` : ''}`)
  }
}

/** The default contact the User-Agent names: the project, where its operator can be found. */
export const DEFAULT_CONTACT = 'https://github.com/fabkho/libellus'

/**
 * Who is asking. `site` is the instance's address (function secret
 * `LIBELLUS_SITE_URL`), `contact` how to reach its operator (`ENRICH_CONTACT`:
 * an e-mail address or a URL; the project's page by default).
 */
export function userAgent(site?: string | null, contact?: string | null): string {
  const parts = ['private book tracker']
  if (site?.trim()) parts.push(`+${site.trim()}`)
  parts.push(contact?.trim() || DEFAULT_CONTACT)
  return `Libellus/1.0 (${parts.join('; ')}) enrich`
}

/** Minimum pause between two requests to one host, in ms. */
export const HOST_INTERVALS: Record<string, number> = {
  'openlibrary.org': 1000,
  'covers.openlibrary.org': 1000,
  'query.wikidata.org': 1000,
  'itunes.apple.com': 3000,
  'www.wikidata.org': 200,
  'commons.wikimedia.org': 200,
}
const DEFAULT_INTERVAL = 200
export const REQUEST_TIMEOUT_MS = 10_000
export const RETRIES = 2
const MAX_RETRY_AFTER_MS = 10_000
const CACHE_MS = 10 * 60 * 1000
const CACHE_SIZE = 500

export type Http = {
  /**
   * GETs `url` and parses JSON. A 404 answers null; anything else that is not
   * a 2xx with JSON throws SourceUnavailable (after the retries).
   */
  json: <T = unknown>(url: string, options?: { accept?: string }) => Promise<T | null>
}

export function createHttp(options: {
  fetch: FetchLike
  userAgent: string
  clock?: Clock
  timeoutMs?: number
  retries?: number
  intervals?: Record<string, number>
}): Http {
  const clock = options.clock ?? realClock
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const retries = options.retries ?? RETRIES
  const intervals = options.intervals ?? HOST_INTERVALS
  /** When the next request to a host may start. */
  const nextStart = new Map<string, number>()
  const cache = new Map<string, { at: number; value: Promise<unknown> }>()

  function intervalFor(host: string): number {
    if (host in intervals) return intervals[host]!
    if (host.endsWith('.wikipedia.org')) return intervals['www.wikidata.org'] ?? DEFAULT_INTERVAL
    return DEFAULT_INTERVAL
  }

  /** Waits for the host's turn, then reserves the next one. */
  async function turn(host: string) {
    const now = clock.now()
    const start = Math.max(now, nextStart.get(host) ?? 0)
    nextStart.set(host, start + intervalFor(host))
    if (start > now) await clock.sleep(start - now)
  }

  async function once(url: string, accept: string): Promise<{ status: number; body: string; retryAfter: number | null }> {
    const host = new URL(url).host
    await turn(host)
    const response = await options.fetch(url, {
      headers: { 'user-agent': options.userAgent, 'api-user-agent': options.userAgent, accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeout),
    })
    const retryAfterHeader = Number(response.headers.get('retry-after'))
    return {
      status: response.status,
      body: await response.text(),
      retryAfter: Number.isFinite(retryAfterHeader) && retryAfterHeader > 0 ? retryAfterHeader * 1000 : null,
    }
  }

  async function get(url: string, accept: string): Promise<unknown> {
    let lastStatus: number | null = null
    let lastDetail = ''
    for (let attempt = 0; attempt <= retries; attempt++) {
      let answer: Awaited<ReturnType<typeof once>>
      try {
        answer = await once(url, accept)
      } catch (error) {
        lastStatus = null
        lastDetail = error instanceof Error ? error.message : String(error)
        if (attempt < retries) await clock.sleep(1000 * 2 ** attempt)
        continue
      }
      if (answer.status === 404 || answer.status === 410) return null
      if (answer.status >= 200 && answer.status < 300) {
        try {
          return JSON.parse(answer.body)
        } catch {
          throw new SourceUnavailable(url, answer.status, 'not JSON')
        }
      }
      lastStatus = answer.status
      lastDetail = answer.body.slice(0, 120)
      if (answer.status !== 429 && answer.status < 500) break
      if (attempt < retries) await clock.sleep(Math.min(answer.retryAfter ?? 2000 * 2 ** attempt, MAX_RETRY_AFTER_MS))
    }
    throw new SourceUnavailable(url, lastStatus, lastDetail)
  }

  return {
    json<T>(url: string, opts: { accept?: string } = {}): Promise<T | null> {
      const accept = opts.accept ?? 'application/json'
      const key = `${accept} ${url}`
      const hit = cache.get(key)
      if (hit && clock.now() - hit.at < CACHE_MS) return hit.value as Promise<T | null>
      const value = get(url, accept)
      // Failures are not remembered: the next ask tries again.
      value.catch(() => cache.delete(key))
      cache.set(key, { at: clock.now(), value })
      if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
      return value as Promise<T | null>
    },
  }
}
