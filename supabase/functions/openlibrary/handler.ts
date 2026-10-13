/**
 * The `openlibrary` edge function's request handling: who may call (a signed-in member or the
 * service role), which Open Library paths may be asked (an allow-list; the host is ours to pick,
 * never the caller's), and the answer passed back as Open Library gave it. The upstream itself is
 * `client.ts` (identified, at most three requests a second per running instance); README.md says
 * how to run and deploy it.
 */
import { type OpenLibrary, OpenLibraryUnavailable } from './client.ts'

/** The member (or the service role, `member: null`) a request comes from. */
export type Caller = { member: string | null }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, OPTIONS',
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private', ...headers },
  })
}

/** The whole query string (the path and the params passed on) may not be longer than this. */
export const MAX_QUERY_BYTES = 2048
/** What a member may ask in a minute (the function's own upstream budget is three requests a second). */
export const MEMBER_LIMIT = 360
export const MEMBER_WINDOW_SECONDS = 60

/**
 * The paths the import asks Open Library for (data/openLibrary.ts, data/coverFill.ts):
 * `search.json`, an edition record by ISBN, a work's editions, an edition record by key and the
 * `api/books` cover lookup. Anything else (authors, subjects, covers, `search/inside`) is not the
 * import's to ask through here. Covers are not proxied at all: cover images load from
 * `covers.openlibrary.org` in the browser (owner decision; `b/id/…` has no limit).
 */
export const ALLOWED_PATHS: readonly RegExp[] = [
  /^\/search\.json$/,
  /^\/isbn\/\d{10}(\d{3})?\.json$/,
  /^\/works\/OL\d+W\/editions\.json$/,
  /^\/books\/OL\d+[MW]\.json$/,
  /^\/api\/books$/,
]

export function createHandler(deps: {
  openlibrary: OpenLibrary
  authorize: (request: Request) => Promise<Caller | null>
  /** Counts one call of a member; false when she is over her limit. Not asked for the service role. */
  throttle?: (member: string) => Promise<boolean>
  log?: (message: string) => void
}): (request: Request) => Promise<Response> {
  const log = deps.log ?? ((message) => console.error(message))

  return async function handler(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' })
    const caller = await deps.authorize(request)
    if (!caller) return json(401, { error: 'unauthorized' })
    if (caller.member && deps.throttle) {
      let allowed: boolean
      try {
        allowed = await deps.throttle(caller.member)
      } catch (error) {
        log(`openlibrary: throttle failed: ${error}`)
        return json(502, { error: 'openlibrary_unavailable' })
      }
      if (!allowed) return json(429, { error: 'rate_limited' }, { 'retry-after': String(MEMBER_WINDOW_SECONDS) })
    }

    const asked = new URL(request.url)
    const path = asked.searchParams.get('path') ?? ''
    const query = new URLSearchParams(asked.searchParams)
    query.delete('path')
    const passedOn = query.toString()
    if (!path) return json(400, { error: 'path_missing' })
    if (new TextEncoder().encode(asked.search).length > MAX_QUERY_BYTES) return json(400, { error: 'query_too_large' })
    // The host is ours (`https://openlibrary.org${path}`): a path that is not one of the import's never goes out.
    if (!ALLOWED_PATHS.some((allowed) => allowed.test(path))) return json(400, { error: 'path_not_allowed' })

    let answer
    try {
      answer = await deps.openlibrary.ask(path, passedOn)
    } catch (error) {
      if (error instanceof OpenLibraryUnavailable) {
        return error.kind === 'timeout'
          ? json(504, { error: 'openlibrary_timeout' })
          : json(502, { error: 'openlibrary_unavailable' })
      }
      log(`openlibrary: ${path} failed: ${error}`)
      return json(502, { error: 'openlibrary_unavailable' })
    }
    // A refusal of the server address is one log line in the owner's log, so a block is visible.
    if ([403, 429].includes(answer.status)) log(`openlibrary_refused ${JSON.stringify({ status: answer.status, path })}`)
    return new Response(answer.body, {
      status: answer.status,
      headers: {
        ...CORS,
        'content-type': answer.contentType ?? 'application/json; charset=utf-8',
        'cache-control': 'private',
        ...(answer.retryAfter ? { 'retry-after': answer.retryAfter } : {}),
      },
    })
  }
}
