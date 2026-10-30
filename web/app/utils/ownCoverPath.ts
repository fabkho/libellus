/**
 * The address of our own stored copy of a cover: `/c/<key>/<width>` on the app's own origin
 * (`functions/c/[[path]].js`, docs/plans/owned-covers.md §1–2). Framework-free and without imports: the Pages
 * Function loads this very file, so the shape the browser builds addresses by is the one the Function enforces
 * (tests/cover-ref.test.ts, tests/cover-own-function.test.ts).
 *
 * The key is `books.cover_key`: the first 128 bits of an HMAC over the image, hex, 32 characters. The widths are
 * `books.cover_widths`: the real widths of the stored copies, in pixels (Apple's 120, 240, 360, 600; Open Library's two).
 * An object in the bucket is `c/<key>/<width>`; the address is the same with a leading slash.
 */

/** Where the Function answers, on the app's own origin. */
export const OWN_COVER_PATH = '/c'

/** A key: 32 lower-case hex characters. Anything else is not one of ours. */
export const OWN_COVER_KEY = /^[0-9a-f]{32}$/

/** The narrowest and widest copy there can be (the plan: an integer 16–2000). */
export const OWN_COVER_MIN_WIDTH = 16
export const OWN_COVER_MAX_WIDTH = 2000


/**
 * What a copy's answer says of its own keeping: a year, immutable (a key's bytes never change). The Function sends it with
 * every stored copy, and the service worker keeps only an answer that says it (nuxt.config.ts, the `/c/` rule): a
 * deployment without the Function answers `/c/…` with the app shell, HTML and a 200, which must never be kept for a year.
 */
export const OWN_COVER_CACHE_CONTROL = 'public, max-age=31536000, immutable'
export function isOwnCoverKey(value: unknown): value is string {
  return typeof value === 'string' && OWN_COVER_KEY.test(value)
}

export function isOwnCoverWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= OWN_COVER_MIN_WIDTH && value <= OWN_COVER_MAX_WIDTH
}

/**
 * The widths of a stored copy as the database hands them out, made safe to build addresses from: the valid ones,
 * ascending, each once. Empty for anything that is not a list of widths.
 */
export function ownCoverWidths(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(isOwnCoverWidth))].sort((a, b) => a - b)
}

/** The address of the copy of `key` at `width` (`origin`: the page's, for what is loaded from another context, a texture). */
export function ownCoverUrl(key: string, width: number, origin = ''): string {
  return `${origin}${OWN_COVER_PATH}/${key}/${width}`
}

/** The name of that copy in the bucket (the store job writes it: `c/<key>/<width>`). */
export function ownCoverObject(key: string, width: number): string {
  return `c/${key}/${width}`
}

/** `/c/<key>/<width>` and nothing else: the key and a canonical whole width in range (no sign, zeros, exponent, extra segments). */
const PATH = /^\/c\/([0-9a-f]{32})\/([1-9][0-9]{1,3})$/

/** What an address of ours names, or null when it is not exactly one. */
export function parseOwnCoverPath(pathname: string): { key: string; width: number } | null {
  const match = PATH.exec(pathname)
  if (!match) return null
  const width = Number(match[2])
  return isOwnCoverWidth(width) ? { key: match[1]!, width } : null
}

/**
 * A Book's stored copy as a row or an answer carries it (`cover_key`, `cover_widths`), checked: the key and the widths as
 * the Book's fields (`coverKey`, `coverWidths`), or null when there is no usable copy (no key, a key that is not one,
 * no valid width). What reaches a Book is only what an address can be built from.
 */
export function ownCopy(key: unknown, widths: unknown): { coverKey: string; coverWidths: number[] } | null {
  if (!isOwnCoverKey(key)) return null
  const valid = ownCoverWidths(widths)
  return valid.length ? { coverKey: key, coverWidths: valid } : null
}
