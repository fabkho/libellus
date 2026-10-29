// Cloudflare Pages Function (docs/HOSTING.md, "The cover cache"): our own cache in front of the two cover
// hosts. `/cover?u=<a cover URL>&w=<width>` answers the cover at that width, the way `app/utils/coverSize.ts`
// says Apple's and Open Library's sizes are asked for, from Cloudflare's Cache API (`caches.default`, free,
// per data centre) after the first request. Why: Open Library's covers take ~0.6–1.8 s (a redirect to archive.org,
// then a storage host of its own); a cover at an address never changes, so one slow fetch is all a cover needs;
// and a texture (the reel's WebGL cards) needs CORS, which this always sends.
//
// An allowlist, not a proxy: `parseCoverRequest` accepts only `https://<n>.mzstatic.com/image/thumb/…/<w>x<h>bb.jpg`
// and `https://covers.openlibrary.org/b/<id|isbn|olid|oclc|lccn>/<key>-<S|M|L>.jpg`, and only the widths in
// `COVER_WIDTHS` (each width is a cache entry). The sized address is computed here from `u` and `w`, so the
// browser cannot ask for a size nobody listed. Nothing is stored beyond Cloudflare's cache (no bucket, no
// database), and nothing here is a paid feature: no Cloudflare Images, no Image Resizing, no KV or R2.
//
// What it does when the host fails: a cover already in the cache is served as it is (a hit is never
// checked against the host), and one older than REFRESH_AFTER is served and fetched again behind the
// answer (stale-while-revalidate), the old copy kept when that fails. A cover not in the cache and not
// fetchable is a 502 with `no-store`, which the app (and the service worker) never keep: the app's chain
// then tries the host's own address (utils/cover.ts, `coverChain`).
//
// Not cached here: anything that is not an image or is over MAX_BYTES (a cover is 10–150 KB).
import { parseCoverRequest } from '../app/utils/coverSize.ts'

/** A year, the age the answer is cacheable for: a cover at an address does not change. */
const MAX_AGE = 31536000
/** After this a cached cover is served, and fetched again behind the answer. */
const REFRESH_AFTER = 30 * 24 * 60 * 60 * 1000
/** More than any cover (Apple's 600 × 900 is ~140 KB): what is not one is not cached. */
const MAX_BYTES = 2 * 1024 * 1024
/** Time the host has to answer before the cover counts as unavailable (Open Library's slowest is ~2 s). */
const ORIGIN_TIMEOUT = 8000
/** Where the cover came from, as the final address of a (redirected) fetch: its host's own, or Open Library's archive. */
const ORIGIN_HOST = /^(?:[a-z0-9-]+\.mzstatic\.com|covers\.openlibrary\.org|(?:[a-z0-9-]+\.)*archive\.org)$/
/** The header that remembers when a cover was fetched (the stored copy's, never sent on). */
const STORED_AT = 'x-cover-stored-at'

/** The headers every answer carries: readable from any page (a texture needs CORS), never sniffed. */
const BASE = { 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin', 'X-Content-Type-Options': 'nosniff' }

const failure = (status, message) =>
  new Response(message, { status, headers: { ...BASE, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

/** The cover from the host, as bytes and a type; null when it is not a usable image. */
async function fromHost(source) {
  let response
  try {
    response = await fetch(source, {
      headers: { Accept: 'image/jpeg,image/png,image/webp,image/*;q=0.8', 'User-Agent': 'Libellus/1.0 (cover cache)' },
      redirect: 'follow',
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT),
    })
  } catch {
    return { status: 502 }
  }
  if (response.status === 404 || response.status === 410) return { status: 404 }
  if (!response.ok) return { status: 502 }
  // A redirect that ended somewhere else is not the cover of the host that was asked.
  if (response.url && !ORIGIN_HOST.test(new URL(response.url).hostname)) return { status: 502 }
  const type = (response.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (!/^image\/(?:jpeg|png|webp|gif)$/.test(type)) return { status: 502 }
  const bytes = await response.arrayBuffer().catch(() => null)
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_BYTES) return { status: 502 }
  return { status: 200, bytes, type }
}

/** What goes into the cache, and goes out: the bytes with the headers of a cover that never changes. */
const answer = (bytes, type, extra = {}) =>
  new Response(bytes, { status: 200, headers: { ...BASE, 'Content-Type': type, 'Cache-Control': `public, max-age=${MAX_AGE}, immutable`, ...extra } })

/** The cached copy as it goes out: without the book-keeping header, with the answer's source named (for measuring, DevTools). */
function sent(stored, how) {
  const headers = new Headers(stored.headers)
  headers.delete(STORED_AT)
  headers.set('X-Cover-Cache', how)
  return new Response(stored.body, { status: 200, headers })
}

/** How long a copy the host would not renew is left alone before it is tried again. */
const RETRY_AFTER = 60 * 60 * 1000

/**
 * Fetch again and replace the cached copy. A failure keeps the old one, marked as fetched so that it is tried
 * again in an hour, not by every request meanwhile.
 */
async function refresh(cache, key, source, old) {
  const fresh = await fromHost(source)
  if (fresh.status === 200) return cache.put(key, answer(fresh.bytes, fresh.type, { [STORED_AT]: String(Date.now()) }))
  const type = old.headers.get('Content-Type') ?? 'image/jpeg'
  return cache.put(key, answer(await old.arrayBuffer(), type, { [STORED_AT]: String(Date.now() - REFRESH_AFTER + RETRY_AFTER) }))
}

export async function onRequest({ request, waitUntil }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'Method not allowed')
  const url = new URL(request.url)
  const wanted = parseCoverRequest(url.searchParams)
  if (!wanted) return failure(400, 'Not a cover we serve')

  // The key is the sized address, not the query: two spellings of one cover (a stored `-L` and a `-M`, a 600x900
  // and a 120x180 `u`) at one width are one entry.
  const cache = typeof caches === 'undefined' ? null : caches.default
  const key = new Request(`${url.origin}${url.pathname}?v=${encodeURIComponent(wanted.source)}`)
  const stored = await cache?.match(key).catch(() => null)
  if (stored) {
    const age = Date.now() - Number(stored.headers.get(STORED_AT) ?? 0)
    if (age > REFRESH_AFTER) {
      waitUntil(refresh(cache, key, wanted.source, stored.clone()).catch(() => {}))
      return sent(stored, 'stale')
    }
    return sent(stored, 'hit')
  }

  const fresh = await fromHost(wanted.source)
  if (fresh.status !== 200) return failure(fresh.status, fresh.status === 404 ? 'No such cover' : 'The cover host did not answer')
  if (cache) waitUntil(cache.put(key, answer(fresh.bytes, fresh.type, { [STORED_AT]: String(Date.now()) })).catch(() => {}))
  return answer(fresh.bytes, fresh.type, { 'X-Cover-Cache': 'miss' })
}
