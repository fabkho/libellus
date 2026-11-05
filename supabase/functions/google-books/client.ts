/**
 * The real Google Books API for the `google-books` function: `GET /books/v1/volumes`, one question per request, the
 * key in the `x-goog-api-key` header (never in the address: an address ends up in logs and error messages),
 * four seconds each. It never talks to Google without a key (`not_configured`: the function says "unavailable" and
 * the app's other sources carry on), and says why it could not answer (`GoogleUnavailable.kind`) so the handler can
 * open its breaker for a refusal and keep out of the quota. Pure over an injected `fetch`, so the tests answer from
 * recordings and no test reaches Google.
 */
import { type GoogleVolume, parseVolumes, volumesUrl } from '../../../web/app/data/googleBooksRecord.ts'

export type FetchLike = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>

/** How long one request may take. */
export const REQUEST_TIMEOUT_MS = 4000

/**
 * Why Google could not answer:
 *  - `not_configured`: no API key is set (the function degrades, nothing is asked);
 *  - `blocked`: a refusal (400 bad key, 401, 403, 429 quota): it opens the breaker, and the quota is not asked again for a while;
 *  - `error`: a 5xx, a timeout or an answer that is not JSON: not stored, and the next call tries again.
 */
export class GoogleUnavailable extends Error {
  constructor(readonly kind: 'not_configured' | 'blocked' | 'error', readonly status: number | null = null) {
    super(`google books unavailable: ${kind}${status ? ` (${status})` : ''}`)
  }
}

/** What one request brought: the volumes and the answer's own `Cache-Control` (what may be kept, and for how long). */
export type Upstream = { volumes: GoogleVolume[]; cacheControl: string | null }

export type GoogleBooksClient = {
  /** One `q` question, narrowed to one language when `language` is given. Rejects with `GoogleUnavailable`. */
  ask: (q: string, language?: string | null) => Promise<Upstream>
}

export function createGoogleBooksClient(deps: { fetch: FetchLike; apiKey: () => string | undefined }): GoogleBooksClient {
  return {
    async ask(q, language = null) {
      const key = deps.apiKey()?.trim()
      if (!key) throw new GoogleUnavailable('not_configured')
      let response: Response
      try {
        response = await deps.fetch(volumesUrl(q, language), { headers: { 'x-goog-api-key': key, accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
      } catch {
        throw new GoogleUnavailable('error')
      }
      if ([400, 401, 403, 429].includes(response.status)) {
        await response.body?.cancel().catch(() => {})
        throw new GoogleUnavailable('blocked', response.status)
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        throw new GoogleUnavailable('error', response.status)
      }
      let body: unknown
      try {
        body = await response.json()
      } catch {
        throw new GoogleUnavailable('error', response.status)
      }
      if (!body || typeof body !== 'object') throw new GoogleUnavailable('error', response.status)
      return { volumes: parseVolumes(body), cacheControl: response.headers.get('cache-control') }
    },
  }
}
