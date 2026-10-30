/**
 * The function's only way to the cover hosts. Identified (`User-Agent: Libellus/1.0 (<contact>)`), one request at a time
 * per call, 8 s timeout, at most 2 MB, the format checked by magic bytes (image.ts), and:
 *
 *  - **Redirects by hand** (`redirect: 'manual'`, at most 3 hops): every `Location` must be `https:`, with no port and no
 *    credentials, on the allowlist (`*.mzstatic.com`, `covers.openlibrary.org`, `archive.org` and `*.archive.org`,
 *    `i.gr-assets.com`, `books.fabkho.dev`). A redirect anywhere else is `host_error`: no SSRF through a redirect. (Covers
 *    on other hosts are not stored in v1: docs/plans/owned-covers.md, §3: DNS pinning is not possible on this runtime.)
 *  - **Open Library's limits**: covers by ISBN, OCLC or LCCN are 100 requests per address per 5 minutes and answer 403
 *    past it; their requests wait for a turn on the `openlibrary-covers-keyed` pace (0.3 a second), the others on
 *    `openlibrary-covers` (2 a second). **A 403 is retry-later** (`throttled`), never `gone`; the keyed pace is held for
 *    5 minutes and the rest of the run asks no keyed cover.
 *  - **Missing covers**: a 404 or 410, a GIF, or an image under 16 px on a side is `gone` (terminal, until the cover changes).
 *
 * Every failure is one `FailKind`; the runner books the Book accordingly (`cover_store_failed`).
 */
import type { Pace } from '../_shared/pace.ts'
import { PaceBusy } from '../_shared/pace.ts'
import { MIN_SIDE, sniffImage, type ImageInfo } from './image.ts'

export type FailKind = 'timeout' | 'host_error' | 'not_image' | 'too_large' | 'throttled' | 'gone'

export const REQUEST_TIMEOUT_MS = 8_000
export const MAX_BYTES = 2 * 1024 * 1024
export const MAX_HOPS = 3
/** Open Library's keyed limit is per 5 minutes: after a 403 no keyed request is made for that long. */
export const KEYED_HOLD_MS = 5 * 60_000

/** The hosts a request or a redirect may go to. */
export function allowedHost(host: string): boolean {
  const name = host.toLowerCase()
  return name === 'covers.openlibrary.org' || name === 'archive.org' || name === 'i.gr-assets.com' || name === 'books.fabkho.dev' ||
    name.endsWith('.archive.org') || name.endsWith('.mzstatic.com')
}

export type Fetched =
  | { ok: true; bytes: Uint8Array; info: ImageInfo; /** Every `Location` followed, in order. */ redirects: string[] }
  | { ok: false; kind: FailKind }

export type CoverFetcher = {
  /** One image: the bytes, what they are (magic bytes) and the redirects it took. Never throws. */
  get: (url: string, options?: { signal?: AbortSignal }) => Promise<Fetched>
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type FetcherOptions = {
  fetch: FetchLike
  userAgent: string
  /** Open Library's keyed covers (isbn, oclc, lccn) and the others (id, olid). */
  paces: { keyed: Pace; id: Pace }
  timeoutMs?: number
  maxBytes?: number
  log?: (message: string) => void
  /** The clock for the keyed hold (tests move it). */
  now?: () => number
}

const OPEN_LIBRARY = 'covers.openlibrary.org'
const KEYED_PATH = /^\/b\/(isbn|oclc|lccn)\//

async function readBody(response: Response, maxBytes: number): Promise<Uint8Array | 'too_large'> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    return 'too_large'
  }
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return 'too_large'
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.length
  }
  return bytes
}

export function createFetcher(options: FetcherOptions): CoverFetcher {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? MAX_BYTES
  const log = options.log ?? ((message: string) => console.error(message))
  const now = options.now ?? (() => Date.now())
  // Open Library's keyed limit answered 403: no keyed request until then (the fetcher lives as long as a warm isolate).
  let keyedBlockedUntil = 0

  /**
   * One request. The turn at the pace comes FIRST (a keyed Open Library request may wait 7-10 s for it), and only then
   * does the request's own timeout start: the wait must not use up the time the request has.
   */
  async function request(url: URL, outer: AbortSignal | undefined): Promise<{ response: Response; signal: AbortSignal } | FailKind> {
    const keyed = url.hostname === OPEN_LIBRARY && KEYED_PATH.test(url.pathname)
    if (url.hostname === OPEN_LIBRARY) {
      if (keyed && now() < keyedBlockedUntil) return 'throttled'
      try {
        await (keyed ? options.paces.keyed : options.paces.id).take()
      } catch (error) {
        // Its turn is further away than a run waits (PaceBusy), or the pace could not be asked: later.
        if (error instanceof PaceBusy) return 'throttled'
        log(`cover-store: pace failed: ${error instanceof Error ? error.message : error}`)
        return 'throttled'
      }
    }
    if (outer?.aborted) return 'timeout'
    const signal = outer ? AbortSignal.any([AbortSignal.timeout(timeoutMs), outer]) : AbortSignal.timeout(timeoutMs)
    try {
      return { response: await options.fetch(url.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'user-agent': options.userAgent, accept: 'image/webp,image/jpeg,image/png,image/*;q=0.8' },
      }), signal }
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError'))) return 'timeout'
      // The host and the kind of error, never the address (it can name a member's book).
      log(`cover-store: ${url.hostname} unreachable (${error instanceof Error ? error.name : 'error'})`)
      return 'host_error'
    }
  }

  return {
    async get(start, { signal: outer } = {}) {
      const redirects: string[] = []
      let url: URL
      try {
        url = new URL(start)
      } catch {
        return { ok: false, kind: 'host_error' }
      }
      for (let hop = 0; ; hop++) {
        if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowedHost(url.hostname)) {
          return { ok: false, kind: 'host_error' }
        }
        const keyed = url.hostname === OPEN_LIBRARY && KEYED_PATH.test(url.pathname)
        const sent = await request(url, outer)
        if (typeof sent === 'string') return { ok: false, kind: sent }
        const { response, signal } = sent

        const status = response.status
        if (status >= 300 && status < 400) {
          await response.body?.cancel().catch(() => {})
          const location = response.headers.get('location')
          if (!location || hop >= MAX_HOPS) return { ok: false, kind: 'host_error' }
          try {
            url = new URL(location, url)
          } catch {
            return { ok: false, kind: 'host_error' }
          }
          redirects.push(url.href)
          continue
        }
        if (status === 404 || status === 410) {
          await response.body?.cancel().catch(() => {})
          return { ok: false, kind: 'gone' }
        }
        if (url.hostname === OPEN_LIBRARY && (status === 403 || status === 429)) {
          await response.body?.cancel().catch(() => {})
          if (keyed) {
            keyedBlockedUntil = now() + KEYED_HOLD_MS
            await options.paces.keyed.hold(KEYED_HOLD_MS).catch(() => {})
          }
          return { ok: false, kind: 'throttled' }
        }
        if (status !== 200) {
          await response.body?.cancel().catch(() => {})
          log(`cover-store: ${url.hostname} answered ${status}`)
          return { ok: false, kind: 'host_error' }
        }

        let body: Uint8Array | 'too_large'
        try {
          body = await readBody(response, maxBytes)
        } catch {
          return { ok: false, kind: signal.aborted ? 'timeout' : 'host_error' }
        }
        if (body === 'too_large') return { ok: false, kind: 'too_large' }
        const info = sniffImage(body)
        if (!info) return { ok: false, kind: 'not_image' }
        // Open Library's "no cover" placeholder (a 1 x 1 GIF) and anything too small to be a cover: there is none.
        if (info.kind === 'gif' || info.width < MIN_SIDE || info.height < MIN_SIDE) return { ok: false, kind: 'gone' }
        return { ok: true, bytes: body, info, redirects }
      }
    },
  }
}
