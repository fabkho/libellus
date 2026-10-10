import type { GoodreadsRating } from './goodreads'

/**
 * The Book as the client sees it (CONTEXT.md: Book, Catalogue, Cover), and the
 * ISBN rules every source shares. Framework-free: the search and library
 * repositories build on it, and a native port copies it 1:1.
 */

export type BookSource = 'apple' | 'openlibrary' | 'manual' | 'import'

/** What an edition is, as the database names it (`book_format`). */
export type BookFormat = 'hardcover' | 'paperback' | 'ebook' | 'audiobook'
export const BOOK_FORMATS: readonly BookFormat[] = ['hardcover', 'paperback', 'ebook', 'audiobook']

/** A cover's two precomputed colours, `#rrggbb` (components/ui/Cover.vue, Ambient.vue). */
export type CoverColors = { dominant: string; secondary: string }

/**
 * What a source says about one edition. A search result is one of these; when
 * a member adds it, it becomes the Catalogue Book's first (and kept) snapshot.
 */
export type BookSnapshot = {
  title: string
  /** In the order the edition credits them. */
  authors: string[]
  isbn13: string | null
  isbn10: string | null
  pageCount: number | null
  year: number | null
  language: string | null
  publisher: string | null
  /** Plain text, paragraphs separated by blank lines. */
  description: string | null
  coverUrl: string | null
  coverThumbhash: string | null
  coverColors: CoverColors | null
  source: BookSource
  appleId: string | null
  openLibraryEditionKey: string | null
  openLibraryWorkKey: string | null
  /**
   * Hardcover, paperback, ebook or audiobook, as the source said it; null or
   * absent when it did not (OpenLibrary's `physical_format` mostly is empty).
   */
  format?: BookFormat | null
}

/**
 * A Book in the database: the Catalogue, or a member's Manual book. `goodreads`:
 * the cached Goodreads rating of its ISBN, when the row was loaded with it
 * (data/goodreads.ts); absent on a copy from before it existed.
 */
export type Book = BookSnapshot & {
  id: string
  createdAt: string
  goodreads?: GoodreadsRating | null
  /** A Book the server check could not confirm, as another member's record carries it: no title, authors or cover (utils/unverifiedBook.ts). */
  unverified?: true
}

/**
 * The format that counts for a Book: the member's own word on her entry's
 * (`override`) when she gave one, else what the source said; an Apple edition
 * without one is an ebook (Apple sells nothing else). Null when nobody knows.
 */
export function formatOf(book: Pick<BookSnapshot, 'format' | 'source'>, override?: BookFormat | null): BookFormat | null {
  return override ?? book.format ?? (book.source === 'apple' ? 'ebook' : null)
}

/**
 * The address of a Book's page (`/book/<key>`): a Catalogue Book by its id, a
 * search result that is not in the Catalogue (yet) by its source and id.
 */
export function bookKey(book: Pick<Book, 'id'> | BookSnapshot): string {
  if ('id' in book) return book.id
  if (book.appleId) return `apple-${book.appleId}`
  if (book.openLibraryEditionKey) return `ol-${book.openLibraryEditionKey}`
  if (book.isbn13) return `isbn-${book.isbn13}`
  throw new Error('A Book needs an id, a source id or an ISBN to have a page')
}

/**
 * Every page key a Book can be reached under besides its id: by the source ids
 * and the ISBN it carries. An entry added from a search result before the
 * database answered is under one of them; the Catalogue's Book has them all.
 */
export function sourceKeys(book: BookSnapshot): string[] {
  return [
    book.appleId ? `apple-${book.appleId}` : null,
    book.openLibraryEditionKey ? `ol-${book.openLibraryEditionKey}` : null,
    book.isbn13 ? `isbn-${book.isbn13}` : null,
  ].filter((key): key is string => key !== null)
}

export type BookKey =
  | { kind: 'catalogue'; id: string }
  | { kind: 'apple'; appleId: string }
  | { kind: 'openlibrary'; editionKey: string }
  | { kind: 'isbn'; isbn13: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Reads a page address back. Null for anything that is not one. */
export function parseBookKey(key: string): BookKey | null {
  if (UUID.test(key)) return { kind: 'catalogue', id: key.toLowerCase() }
  const apple = /^apple-(\d+)$/.exec(key)
  if (apple) return { kind: 'apple', appleId: apple[1]! }
  const openLibrary = /^ol-(OL\d+M)$/.exec(key)
  if (openLibrary) return { kind: 'openlibrary', editionKey: openLibrary[1]! }
  const isbn = /^isbn-(\d{13})$/.exec(key)
  if (isbn && isValidIsbn13(isbn[1]!)) return { kind: 'isbn', isbn13: isbn[1]! }
  return null
}

// ---------------------------------------------------------------------- ISBN

/** True for 13 digits starting 978/979 whose check digit adds up. */
export function isValidIsbn13(value: string): boolean {
  if (!/^97[89]\d{10}$/.test(value)) return false
  const sum = [...value].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return sum % 10 === 0
}

/** True for 9 digits and a check digit (or X) that adds up. */
export function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false
  const sum = [...value].reduce((total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index), 0)
  return sum % 11 === 0
}

/** ISBN-10 → ISBN-13 (978 prefix, new check digit). */
export function isbn10To13(isbn10: string): string {
  const body = `978${isbn10.slice(0, 9)}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/**
 * What a member typed, read as an ISBN: hyphens and spaces dropped, an ISBN-10
 * converted. Null when it is not a valid ISBN, so the caller searches the text.
 */
export function parseIsbn(input: string): string | null {
  return isbnParts(input)?.isbn13 ?? null
}

/**
 * What a member typed, read as an ISBN, both ways it is stored: the ISBN-13
 * (an ISBN-10 converted) and the ISBN-10 she typed, if she typed one. Null when
 * it is not a valid ISBN (wrong length, a check digit that does not add up).
 */
export function isbnParts(input: string): { isbn13: string; isbn10: string | null } | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase()
  if (isValidIsbn13(compact)) return { isbn13: compact, isbn10: null }
  if (isValidIsbn10(compact)) return { isbn13: isbn10To13(compact), isbn10: compact }
  return null
}
