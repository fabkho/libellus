/**
 * The one address Hardcover's covers have (docs/plans/hardcover-zip.md, "Covers from Hardcover"): a fixed, allowlisted
 * public host, like `i.gr-assets.com`, never a member's. A Hardcover "everything" zip names a cover per book and edition
 * (`cached_image.url`); the device keeps it as the row's `coverHint`, and every later gate asks this module whether the
 * address is the host's own: the import job (a row's payload is the member's to write, so it is checked again there), the
 * `/cover` cache (`utils/coverSize.ts`), the cover-store function (its own copy of the rule, `plan.ts`, kept in step by a
 * test) and the database (`private.cover_allowed`, 20261112010000).
 *
 * Owner decision (31 Oct 2026): these covers are not shown to visitors or on shared or public pages, and show inside the app. `private.cover_shown` is false for the
 * host, so the Book JSON of a reading page, `/r/`, the feed and a profile carries no address and no key; `isHardcoverCover`
 * is the same rule for the code that holds an address and draws it for a visitor (the `/r/` function's preview image).
 *
 * Framework-free and without imports: the Pages Functions and the Deno functions load it as well.
 */

/** The host, and the only one. */
export const HARDCOVER_COVER_HOST = 'assets.hardcover.app'

/** What follows the host: a path of the characters its images use (a percent-escape among them: a real export has one), never a query or a fragment. */
const PATH = /^\/(?:[\w./~+-]|%[0-9A-Fa-f]{2})+$/

/** The longest address kept (the export's are ~80 characters). */
const MAX_LENGTH = 500

/**
 * The address of a Hardcover cover, as the database stores it, or null: https, the host exactly (no port, no credentials,
 * no other Hardcover host), a path, no query, no fragment, no whitespace.
 */
export function hardcoverCoverAddress(input: unknown): string | null {
  if (typeof input !== 'string' || !input || input.length > MAX_LENGTH || /\s/.test(input)) return null
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== HARDCOVER_COVER_HOST || url.port || url.username || url.password || url.search || url.hash) return null
  return PATH.test(url.pathname) ? url.href : null
}

/** Whether `url` is on Hardcover's cover host (the host alone, not the shape): the gate for a surface a visitor sees. */
export function isHardcoverCover(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return new URL(url).hostname === HARDCOVER_COVER_HOST
  } catch {
    return false
  }
}
