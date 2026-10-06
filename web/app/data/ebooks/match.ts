import type { Book } from '../books'
import type { LibraryEntry } from '../library'
import { isbn13Of, normalise } from '../merge'
import type { EpubMetadata } from './epub'

/**
 * Which Book in the member's Library an ebook file is (issue #131). In order:
 *
 * 1. **ISBN**: an ISBN the file carries is the ISBN of a Library entry's Book
 *    (its ISBN-13, or its ISBN-10 converted). One entry → linked.
 * 2. **Title and first author**: the titles are the same as matching reads them
 *    (accents, case and punctuation aside), whole or without their subtitles
 *    ("Moby Dick; Or, The Whale" is "Moby-Dick"), and the Book's first author is
 *    one of the file's (the same surname, or every word of one name in the
 *    other: "Lev Tolstoy" and "Leo Tolstoy", "J. R. R. Tolkien" and "Tolkien").
 *    One entry → linked.
 * 3. **Ambiguous**: more than one entry fits, or a title fits without the
 *    author → the member picks from those entries (a sheet with their covers).
 * 4. **None** → the file waits in *Unlinked ebooks*.
 *
 * Framework-free and pure: Vitest drives it with plain entries.
 */

export type EbookMatch =
  | { kind: 'linked'; entry: LibraryEntry; by: 'isbn' | 'title' }
  | { kind: 'ambiguous'; candidates: LibraryEntry[] }
  | { kind: 'none' }

type Named = Pick<EpubMetadata, 'title' | 'authors'>

function words(text: string): string[] {
  const normal = normalise(text)
  return normal ? normal.split(' ') : []
}

/** The title before its subtitle: "Moby Dick; Or, The Whale" → "Moby Dick", "Piranesi: A Novel" → "Piranesi". */
export function mainTitle(title: string): string {
  // Not at ". ": a title may begin with one ("Dr. Jekyll and Mr. Hyde", "Dr. No").
  return title.split(/\s*[:;(\[]|\s+[-–—]\s+|,\s+or\b/i)[0] ?? title
}

/** The same title as matching reads it: whole, or one's main title the other's (main) title. */
export function sameTitle(a: string, b: string): boolean {
  const fullA = normalise(a)
  const fullB = normalise(b)
  if (!fullA || !fullB) return false
  if (fullA === fullB) return true
  const mainA = normalise(mainTitle(a))
  const mainB = normalise(mainTitle(b))
  return Boolean(mainA && mainB) && (mainA === mainB || mainA === fullB || fullA === mainB)
}

/** Every word of `a` begins a word of `b`. */
function within(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.every((word) => b.some((other) => other.startsWith(word)))
}

/** One person, as far as names on a cover and in a file go. */
export function sameAuthor(a: string, b: string): boolean {
  const x = words(a)
  const y = words(b)
  if (!x.length || !y.length) return false
  if (x.at(-1) === y.at(-1) && x.at(-1)!.length > 1) return true
  return within(x, y) || within(y, x)
}

/** Whether the file names the Book's first author among its own. */
export function authorFits(file: Named, book: Pick<Book, 'authors'>): boolean {
  const first = book.authors[0]
  return Boolean(first) && file.authors.some((author) => sameAuthor(author, first!))
}

/** The ISBNs a Book is known by (its ISBN-13, its ISBN-10 as ISBN-13). */
export function isbnsOfBook(book: Pick<Book, 'isbn13' | 'isbn10'>): string[] {
  const own = isbn13Of(book)
  return own ? [own] : []
}

export function matchEbook(file: Pick<EpubMetadata, 'title' | 'authors' | 'isbns'>, entries: readonly LibraryEntry[]): EbookMatch {
  if (file.isbns.length) {
    const byIsbn = entries.filter((entry) => isbnsOfBook(entry.book).some((isbn) => file.isbns.includes(isbn)))
    if (byIsbn.length === 1) return { kind: 'linked', entry: byIsbn[0]!, by: 'isbn' }
    if (byIsbn.length > 1) return { kind: 'ambiguous', candidates: byIsbn }
  }
  if (!file.title) return { kind: 'none' }
  const titled = entries.filter((entry) => sameTitle(file.title!, entry.book.title))
  const both = titled.filter((entry) => authorFits(file, entry.book))
  if (both.length === 1) return { kind: 'linked', entry: both[0]!, by: 'title' }
  if (both.length > 1) return { kind: 'ambiguous', candidates: both }
  if (titled.length) return { kind: 'ambiguous', candidates: titled }
  return { kind: 'none' }
}

/**
 * Whether a file picked for a Book (Add ebook) is clearly another book: none
 * of its ISBNs is the Book's and its title is not the Book's (whole or without
 * subtitles). A file with neither an ISBN nor a title is given the benefit of
 * the doubt; one whose title differs is asked about, translations included
 * (the member links it anyway with one tap).
 */
export function clearlyAnotherBook(file: Pick<EpubMetadata, 'title' | 'authors' | 'isbns'>, book: Pick<Book, 'title' | 'authors' | 'isbn13' | 'isbn10'>): boolean {
  const own = isbnsOfBook(book)
  if (file.isbns.some((isbn) => own.includes(isbn))) return false
  if (file.title && sameTitle(file.title, book.title)) return false
  if (file.isbns.length && own.length) return true
  return Boolean(file.title)
}

/** What search is asked for when the member looks for the file's Book: its title and first author. */
export function findQuery(file: Pick<EpubMetadata, 'title' | 'authors'>, name: string): string {
  const title = file.title ? mainTitle(file.title) : name.replace(/\.epub$/i, '').replace(/[_-]+/g, ' ')
  return [title, file.authors[0] ?? ''].join(' ').trim()
}
