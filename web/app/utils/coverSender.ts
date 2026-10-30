/**
 * Who may ask a cover Function (`functions/cover.js`, `functions/c/[[path]].js`): a request that names where it comes
 * from (`Origin`, or `Referer` as an `<img>` sends it) must name this app (the host the request was made to: the custom
 * domain, or a Pages preview's own) or an origin listed in `COVER_ALLOWED_ORIGINS` (a comma-separated variable of the
 * Pages project). This stops other sites from embedding our covers, nothing more: a request with neither header (curl)
 * passes it; the real guard against a flood is the Cloudflare rate-limiting rule (docs/HOSTING.md).
 *
 * Framework-free and without imports: both Functions load this file as it is.
 */

/** The origin of a header value (`Origin`, or a `Referer`'s address); null when it is not an address (`null`, junk). */
const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Returns the origin to answer with CORS (the page's, when it named itself by `Origin`), `''` for none needed, or
 * `false` for a request from another site.
 */
export function sender(request: Request, url: URL, env: { COVER_ALLOWED_ORIGINS?: string } | undefined): string | false {
  const allowed = new Set<string | null>([url.origin, ...String(env?.COVER_ALLOWED_ORIGINS ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)])
  const origin = request.headers.get('Origin')
  const referer = request.headers.get('Referer')
  if (origin !== null && !allowed.has(origin)) return false
  if (referer !== null && !allowed.has(originOf(referer))) return false
  return origin ?? ''
}
