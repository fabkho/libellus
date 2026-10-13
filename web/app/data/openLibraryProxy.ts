import { isAbort, type FetchLike } from './fetching'

/**
 * The import's Open Library through the app's own server (issue: identified, paced requests).
 * Open Library allows one request a second of an unidentified client and three of an identified
 * one (`User-Agent: Libellus/1.0 (<contact>)`); a browser cannot set its User-Agent, and the
 * import asks far more than one a second. So the import's Open Library requests are rewritten to
 * the `openlibrary` edge function (supabase/functions/openlibrary: signed-in members only, an
 * allow-list of paths, the identified User-Agent, three requests a second per instance), and the
 * rest — Apple, and every cover image (`covers.openlibrary.org`, whose `b/id/…` has no limit) —
 * goes out as it always did. The Search screen and the Book page are not the import: they keep
 * talking to Open Library direct.
 *
 * A blocked or failing server address must never stop an import: when the function cannot be
 * reached, turns the caller away (401) or fails (5xx, or a 429 that asks for more than a minute),
 * this import goes **direct** to Open Library for the rest of its run, at one request a second
 * (the unidentified tier), paced here. Everything else about the answer is unchanged: the caller
 * parses what it parsed before.
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
/** A refusal that asks for a pause this long means the server address is being blocked: go direct. */
export const REFUSED_FOR_FALLBACK_MS = 60_000

/** The slice of `fetch` the wrapper adds its headers through. */
export type HeaderFetch = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Awaited<ReturnType<FetchLike>>>

export type ViaOwnServer = FetchLike & {
  /** True once the function failed and this import talks to Open Library direct again. */
  fallbackActive: () => boolean
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
  let fallenBack = false
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
    const at = Math.max(now(), directNextAt)
    directNextAt = at + gapMs
    await wait(at - now(), init?.signal)
    return await fetch(url, init)
  }

  /** Whether this answer says the server address is not usable for this import. */
  function refused(answer: Awaited<ReturnType<FetchLike>>): boolean {
    if (answer.status === 401) return true
    if (answer.status === 429) {
      const seconds = Number(answer.headers?.get('retry-after'))
      return Number.isFinite(seconds) && seconds > 0 && seconds * 1000 > REFUSED_FOR_FALLBACK_MS
    }
    // 503 is Open Library being busy through us (its Retry-After is passed on, the caller backs off);
    // every other 5xx is the function itself failing, which direct does not.
    return answer.status >= 500 && answer.status !== 503
  }

  const wrapped: ViaOwnServer = async (url, init) => {
    if (new URL(url).hostname !== OPENLIBRARY_HOST) return await fetch(url, init)
    if (fallenBack) return await direct(url, init)
    let answer: Awaited<ReturnType<FetchLike>>
    try {
      answer = await routed(url, init)
    } catch (error) {
      // A replaced query is the caller's own ending, not the function's failure.
      if (isAbort(error)) throw error
      fallenBack = true
      return await direct(url, init)
    }
    if (!refused(answer)) return answer
    fallenBack = true
    return await direct(url, init)
  }
  wrapped.fallbackActive = () => fallenBack
  return wrapped
}
