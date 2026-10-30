import { formatOf, type BookFormat } from './books'
import { exportRegalLibrary, type RegalExportEntry } from './export/regal'
import type { KnownReadingStatus, LibraryBook, RegalLibraryFile } from './export/regalLibraryFile'
import type { LibraryEntry } from './library'
import { bookColour } from '../utils/bookColour'
import { coverImage, type CoverHosts } from '../utils/coverRef'

/**
 * A member's own shelf (Your shelf for everyone): her Library as a Regal
 * library document, built on the device from the Library the app already
 * keeps (stores/library.ts and its device copy), never fetched, never
 * published, never sent anywhere. Regal shows it through its `library` prop
 * (an in-memory document, no URL). The owner's published file (`export:regal`,
 * the `regal-export` function) is the same mapping, `exportRegalLibrary`,
 * reused here and not forked; what this adds is the member's:
 *
 * - **Which Books**: the ones read and the ones being read (`read`,
 *   `currently-reading`): a shelf of what she has read, her current Books on
 *   top. Want to read and the reads given up stay off it.
 * - **One colour per Book** (`assets.color`, Regal's flat faces): the cover's
 *   most common colour inside the guard rails (`bookColour`), so the Spine and
 *   the back are drawn in it and only the front is an image.
 * - **The cover** at the size the app stores (`front`) and a small copy for the
 *   top of the pile (`pile.front`, Apple's 240 × 360 box or OpenLibrary's M).
 * - **Binding** from the format she read (hardcover, paperback, ebook,
 *   audiobook: a hardcover stands taller), which the published file leaves out.
 * - **The blurb** from what the device keeps (`descriptionOf`), when it has it.
 *
 * The on-device Library holds each entry's latest read only (`latestSession`):
 * a re-read in progress is on the shelf as being read, without the date and
 * Rating of the read before it; `readCount` is 1 for a finished Book.
 * Pure: the same Library gives the same document (`generatedAt` aside).
 */

/** The Reading statuses a member's shelf shows. */
export const MEMBER_SHELF_STATUSES: readonly KnownReadingStatus[] = ['read', 'currently-reading']

/** `generator` of a member's document: never published, for debugging. */
export const MEMBER_SHELF_GENERATOR = 'libellus-device'

/** Regal's binding words (its `bookDimensions` reads hardcover, paperback; the rest are as tall as a novel). */
const BINDINGS: Record<BookFormat, string> = {
  hardcover: 'Hardcover',
  paperback: 'Paperback',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
}

export type MemberShelfOptions = {
  /** The zone `dateAdded` is a day in: the device's. */
  timeZone: string
  /** `generatedAt`: default now. */
  generatedAt?: string
  /** The blurb the device keeps for a Book, if any (not read reactively: the lists carry none). */
  descriptionOf?: (book: LibraryEntry['book']) => string | null
  /**
   * How the covers are asked for (`coverImage`, utils/coverRef.ts): the hosts the shelf's screens use. Unset: the source's
   * own addresses, as the shelf asked before own covers (only the Library's row and the reel go through `/cover`,
   * docs/plans/owned-covers.md §5).
   */
  covers?: CoverHosts
}

/** One Library entry as the export reads it: its latest read is all the device holds. */
export function memberShelfEntry(entry: LibraryEntry): RegalExportEntry {
  const { book, latestSession } = entry
  return {
    addedAt: entry.addedAt,
    pageCountOverride: entry.pageCountOverride,
    book: {
      id: book.id,
      title: book.title,
      authors: book.authors,
      isbn13: book.isbn13,
      isbn10: book.isbn10,
      pageCount: book.pageCount,
      year: book.year,
      publisher: book.publisher,
      description: book.description,
      coverUrl: book.coverUrl,
      coverColors: book.coverColors,
    },
    sessions: latestSession
      ? [{ startedOn: latestSession.startedOn, endedOn: latestSession.endedOn, outcome: latestSession.outcome, rating: latestSession.rating, review: latestSession.review }]
      : [],
  }
}

/** The member's Library (any of its lists, in any order) as her shelf's library document. */
export function memberShelfDocument(entries: readonly LibraryEntry[], options: MemberShelfOptions): RegalLibraryFile {
  const byBook = new Map(entries.map((entry) => [entry.book.id, entry]))
  const file = exportRegalLibrary(entries.map(memberShelfEntry), {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    generator: MEMBER_SHELF_GENERATOR,
    timeZone: options.timeZone,
    statuses: MEMBER_SHELF_STATUSES,
  })
  file.books = file.books.map((book) => dressed(book, byBook.get(book.id)!, options))
  return file
}

function dressed(book: LibraryBook, entry: LibraryEntry, options: MemberShelfOptions): LibraryBook {
  const hosts = options.covers ?? {}
  // Our stored copy where the Book has one (`coverImage`, utils/coverRef.ts): the shelf's front and the top of its pile are
  // one address each, and with the switch off they are the source's own, as before.
  const front = book.assets?.front ? coverImage(entry.book, 'xl', hosts).src : null
  const pile = front ? coverImage(entry.book, 'md', hosts).src : null
  const format = formatOf(entry.book, entry.formatOverride)
  const description = book.description ?? options.descriptionOf?.(entry.book)?.trim() ?? null
  return {
    ...book,
    ...(format ? { binding: BINDINGS[format] } : {}),
    ...(description ? { description } : {}),
    assets: {
      ...book.assets,
      ...(front ? { front } : {}),
      ...(pile && pile !== front ? { pile: { front: pile } } : {}),
      color: bookColour(entry.book).colour,
    },
  }
}
