/**
 * The one address Google Books' covers have: `https://books.google.com/books/content?…`, the image Google serves for a
 * volume (the API's `imageLinks.thumbnail`, made https and without the page-curl effect: `coverUrlOf`,
 * data/googleBooksRecord.ts). **Linked, never copied** (Google's terms allow no permanent copy): the address is stored
 * (`books.cover_url`, `private.cover_allowed` knows the host, 20261115010000) and the member's own browser loads the
 * image from Google like any image; the cover store, the `/cover` cache and the service worker never fetch it.
 *
 * Like Hardcover's (data/hardcoverCover.ts) these covers are not shown to visitors or on shared pages: `private.cover_shown`
 * is false for the host, and `isGoogleCover` is the same rule for code that holds an address and draws it for somebody else
 * (the Regal export's public shelf). Framework-free and without imports: the Deno functions load it as well.
 */

/** The host, and the only one. */
export const GOOGLE_COVER_HOST = 'books.google.com'

/** Whether an address is a Google Books cover (https, the host exactly, the `/books/content` image path). */
export function isGoogleCover(input: unknown): boolean {
  if (typeof input !== 'string' || !input || input.length > 600 || /\s/.test(input)) return false
  try {
    const url = new URL(input)
    return url.protocol === 'https:' && url.hostname === GOOGLE_COVER_HOST && !url.port && !url.username && !url.password && url.pathname === '/books/content'
  } catch {
    return false
  }
}
