import { formatOf, type BookFormat, type Book } from './books'
import { exportRegalLibrary, type RegalExportEntry } from './export/regal'
import type { KnownReadingStatus, LibraryBook, RegalLibraryFile } from './export/regalLibraryFile'
import type { LibraryEntry } from './library'
import type { MemberFinished } from './socialShapes'
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
  /**
   * The page's origin (`window.location.origin`). The document is in memory, so Regal resolves its images against
   * `regal-memory:N`, where only absolute http(s) addresses load: our stored copies (`/c/<key>/<width>`) are made absolute
   * against it. Unset: left as they are (the source's addresses are absolute already).
   */
  origin?: string
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

/**
 * Her finished reads, as her profile carries them (`MemberProfile['finished']`, `data/social.ts`), as her
 * shelf's library document: the same document `memberShelfDocument` builds from a member's own Library,
 * built here from what another member's profile hands out (the friend page, `pages/friends/[member]`).
 *
 * The profile carries one entry per finished Book — her latest finished read of it — and not her
 * Library: no added day, no page count of her own, no format word. What it has, it keeps: the Book (its
 * cover and colours), the day the read ended, her Rating and her review, the review's spoiler flag; and
 * the Rating and the review are there only where her switches let them through (the database sends them
 * null otherwise). The shelf therefore holds exactly what her profile shows.
 *
 * Every step is `memberShelfDocument`'s, reached by handing it these reads as Library entries: the same
 * `memberShelfEntry`, `exportRegalLibrary` and `dressed`, so each Book's Spine is its cover's colour
 * (`bookColour`), and a Book whose cover the profile could not carry takes the cloth colour of its
 * title, as it does on her own shelf. Pure: the same profile gives the same document (`generatedAt` aside).
 */
export function memberShelfFromFinished(finished: readonly MemberFinished[], options: MemberShelfOptions): RegalLibraryFile {
  return memberShelfDocument(
    finished.filter((item) => !item.book.unverified).map(finishedEntry),
    options,
  )
}

/**
 * One finished read as the Library entry it stands for. The day the read ended is the day the Book joined
 * the shelf (`dateAdded`), which is what a shelf of finished reads has: her profile carries no added day.
 * A Book the server could not confirm is left out above: it has no title or cover at all (`shownBook`,
 * utils/unverifiedBook.ts), and Regal needs a title to stand a Book up.
 */
function finishedEntry(item: MemberFinished): LibraryEntry {
  const { book } = item
  const shelfBook: Book = {
    id: book.id,
    createdAt: '',
    title: book.title,
    authors: book.authors,
    isbn13: null,
    isbn10: null,
    // Her own page count is not hers to show here; the edition's is not carried either.
    pageCount: null,
    year: book.year,
    language: null,
    publisher: null,
    description: null,
    coverUrl: book.coverUrl,
    coverThumbhash: book.coverThumbhash,
    coverColors: book.coverColors,
    ...(book.coverKey || book.coverWidths ? { coverKey: book.coverKey ?? null, coverWidths: book.coverWidths ?? null } : {}),
    // The format word is not hers to show: `formatOf` then names no binding (an Apple edition would claim an ebook).
    source: book.manual ? 'manual' : 'import',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
  return {
    id: `member-finished-${book.id}`,
    status: 'finished',
    addedAt: item.endedOn ?? '',
    book: shelfBook,
    pageCountOverride: null,
    latestSession: {
      id: item.sessionId ?? `member-finished-${book.id}`,
      startedOn: null,
      endedOn: item.endedOn,
      outcome: 'finished',
      rating: item.rating,
      review: item.review,
      reviewSpoilers: item.spoilers,
      abandonReason: null,
      progressPage: null,
      progressPercent: null,
      progressUpdatedAt: null,
      createdAt: '',
    },
  }
}

function dressed(book: LibraryBook, entry: LibraryEntry, options: MemberShelfOptions): LibraryBook {
  const hosts = options.covers ?? {}
  // Our stored copy where the Book has one (`coverImage`, utils/coverRef.ts): the shelf's front and the top of its pile are
  // one address each, and with the switch off they are the source's own, as before.
  const absolute = (src: string | null) => (src && options.origin && src.startsWith('/') ? new URL(src, options.origin).href : src)
  const front = book.assets?.front ? absolute(coverImage(entry.book, 'xl', hosts).src) : null
  const pile = front ? absolute(coverImage(entry.book, 'md', hosts).src) : null
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
