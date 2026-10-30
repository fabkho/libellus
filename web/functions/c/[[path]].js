// Our own stored copies of covers, served from the app's own origin: GET /c/<key>/<width>
// (docs/plans/owned-covers.md §1, owner decision of 30 Oct 2026: option B, a same-origin Pages Function).
//
// The images are in a private R2 bucket (`libellus-covers`, no public access, no custom domain), bound to this Pages
// project as `COVERS` (Settings → Bindings → R2 bucket; an owner step of the release, docs/HOSTING.md, "Own covers").
// The cover-store job (supabase/functions/cover-store) writes the objects `c/<key>/<width>`; the app builds the address
// from a Book's `cover_key` and `cover_widths` (utils/coverRef.ts). A key is content-addressed (an HMAC of the image), so
// an address never changes its bytes: the answer is cacheable for good, and the service worker keeps it cache-first.
//
// Exactly `/c/<32 hex>/<width, a whole number from 16 to 2000>` is served (utils/ownCoverPath.ts); GET and HEAD only.
// Anything else, a missing object, and an unbound bucket (the binding is not set up yet) are a 404 with `no-store`:
// the app's chain then falls back to `/cover` and the source, and nothing keeps the failure.
//
// A hit is answered from Cloudflare's Cache API (`caches.default`); a miss reads the object from the bucket (the stored
// `Content-Type`; streaming a body costs no CPU worth counting against the free 10 ms) and puts it into the cache behind
// the answer. The cache key is the path alone, so a query string never makes a second entry.
//
// Same origin, so nothing cross-origin to configure for the app's own pages. Who may ask is the same rule as `/cover`
// (utils/coverSender.ts): a request that names where it comes from must name this app or an origin in
// `COVER_ALLOWED_ORIGINS`; CORS is sent for that origin alone, never `*`. THE REAL GUARD against burning the Pages Functions
// pool (100k requests a day, shared with /cover, /r and /share) is the Cloudflare rate-limiting rule (docs/HOSTING.md).
import { sender } from '../../app/utils/coverSender.ts'
import { ownCoverObject, parseOwnCoverPath } from '../../app/utils/ownCoverPath.ts'

/** A year, the age the answer is cacheable for: a key's bytes never change. */
const MAX_AGE = 31536000
/** What the store job writes (`image.ts`: JPEG, WebP, PNG, GIF by their magic bytes); nothing else is served as an image. */
const IMAGE_TYPE = /^image\/(?:jpeg|png|webp|gif)$/

/** The headers every answer carries: never sniffed, and not for another site's page to embed. */
const BASE = { 'Cross-Origin-Resource-Policy': 'same-site', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' }

const failure = (status, message) =>
  new Response(message, { status, headers: { ...BASE, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })

/** The answer for this sender: CORS for the page that named itself (its own origin, never `*`). */
function forSender(response, origin) {
  if (origin) response.headers.set('Access-Control-Allow-Origin', origin)
  return response
}

/** The cached copy as it goes out: without another page's CORS header, with where it came from named (DevTools, measuring). */
function sent(stored, how, origin) {
  const headers = new Headers(stored.headers)
  headers.delete('Access-Control-Allow-Origin')
  headers.set('X-Cover-Cache', how)
  return forSender(new Response(stored.body, { status: 200, headers }), origin)
}

export async function onRequest({ request, waitUntil, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'Method not allowed')
  const url = new URL(request.url)
  const origin = sender(request, url, env)
  if (origin === false) return failure(403, 'Not for this site')
  const wanted = parseOwnCoverPath(url.pathname)
  if (!wanted) return failure(404, 'No such cover')

  // The key is the path alone: a query string is no other copy.
  const cache = typeof caches === 'undefined' ? null : caches.default
  const key = new Request(`${url.origin}${url.pathname}`)
  const stored = await cache?.match(key).catch(() => null)
  if (stored) return sent(stored, 'hit', origin)

  if (!env?.COVERS || typeof env.COVERS.get !== 'function') return failure(404, 'No such cover')
  let object
  try {
    object = await env.COVERS.get(ownCoverObject(wanted.key, wanted.width))
  } catch {
    return failure(502, 'The cover store did not answer')
  }
  if (!object) return failure(404, 'No such cover')
  const type = String(object.httpMetadata?.contentType ?? '').split(';')[0].trim().toLowerCase()
  if (!IMAGE_TYPE.test(type)) return failure(404, 'No such cover')

  const headers = { ...BASE, 'Content-Type': type, 'Cache-Control': `public, max-age=${MAX_AGE}, immutable` }
  if (typeof object.size === 'number') headers['Content-Length'] = String(object.size)
  const response = new Response(object.body, { status: 200, headers })
  if (cache) waitUntil(cache.put(key, response.clone()).catch(() => {}))
  response.headers.set('X-Cover-Cache', 'miss')
  return forSender(response, origin)
}
