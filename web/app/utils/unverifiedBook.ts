/**
 * An unverified Book: one the server check could not confirm (check_failed), which the database hands
 * to everyone but the members who have it in their own Library. It carries an id and `unverified: true`
 * and nothing else (no title, authors, cover); the app shows it as one string, "Outside the catalogue",
 * on the Placeholder cover, and does not open it. Framework-free; the string comes from the caller
 * (i18n `book.outsideCatalogue`).
 */

type Maybe = { unverified?: boolean | null } | null | undefined

export function isUnverified(book: Maybe): boolean {
  return Boolean(book?.unverified)
}

type Showable = {
  title: string
  authors: readonly string[]
  coverUrl: string | null
  coverThumbhash: string | null
  coverColors: { dominant: string; secondary: string } | null
  unverified?: boolean
}

/**
 * What to draw of a Book: itself, or, when unverified, the one string as title (so the Placeholder's cloth
 * carries it), no authors and no cover image, thumbhash or colours.
 */
export function shownBook<B extends Showable>(book: B, outside: string): B {
  if (!isUnverified(book)) return book
  return { ...book, title: outside, authors: [], coverUrl: null, coverThumbhash: null, coverColors: null }
}
