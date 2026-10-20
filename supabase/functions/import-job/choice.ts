/**
 * What the write phase needs of a row's match, and the row as the app's import hands it to `import_books`.
 *
 * The match saves its choice with the row (`WriteChoice`, `import_job_rows.match_book`): the Book the row is written with
 * (a source's snapshot, or the Catalogue Book / the member's own Manual book as `{ id, … }`), the sibling edition's cover
 * it borrows and whether the cover fill gave a Catalogue Book its cover. The write phase (write.ts) builds the very row the
 * app writes from it (`importRowOf` → `ImportRow`, data/bookImport.ts: `importArguments` makes the `import_books` argument
 * from it, so statuses, dates, ratings, reads and shelves are mapped by the app's one implementation) with the cover the job
 * decided for it (`cover_url`, the cover stage).
 *
 * Pure.
 */
import { type Edition, fileEdition, type ImportRow } from '../../../web/app/data/bookImport.ts'
import type { Book, BookSnapshot, CoverColors } from '../../../web/app/data/books.ts'
import type { WriteRow } from './runner.ts'
import type { UploadedRow } from './work.ts'

/** Another edition's cover a row borrows (the file's own row takes it when its ISBN finds none). */
export type LentCover = { coverUrl: string | null; coverThumbhash: string | null; coverColors: CoverColors | null }

/** What the match chose to write: the Book, the cover it borrows, whether the fill found its cover. */
export type WriteChoice = { book: Book | BookSnapshot; lent: LentCover | null; filled: boolean }

/** A Book with an id is written by its id: only what the cover fill reads of it is kept. */
function slim(book: Book): Book {
  return {
    id: book.id,
    source: book.source,
    isbn13: book.isbn13,
    coverUrl: book.coverUrl,
    coverThumbhash: book.coverThumbhash,
    coverColors: book.coverColors,
  } as unknown as Book
}

/** The choice of a row's match (what is saved with the row). */
export function writeChoice(edition: Edition): WriteChoice {
  const lender = edition.coverFrom
  return {
    book: 'id' in edition.book ? slim(edition.book) : edition.book,
    lent: lender ? { coverUrl: lender.coverUrl, coverThumbhash: lender.coverThumbhash, coverColors: lender.coverColors } : null,
    filled: Boolean(edition.filled),
  }
}

/** The Book with the cover the job decided for the row (its thumbhash and colours when the address is one the Book or the lender knows). */
function covered(book: Book | BookSnapshot, lent: LentCover | null, url: string | null): Book | BookSnapshot {
  if (!url || url === book.coverUrl) return book
  const known = lent && lent.coverUrl === url ? lent : null
  return { ...book, coverUrl: url, coverThumbhash: known?.coverThumbhash ?? null, coverColors: known?.coverColors ?? null }
}

/** The row as the app's import writes it. `choice` is null for a row the match saved nothing for: the file's own Book. */
export function importRowOf(row: WriteRow): ImportRow {
  const file = row.payload as UploadedRow
  const choice = row.match_book as WriteChoice | null
  const book = choice?.book ?? fileEdition(file).book
  const url = row.cover_source && row.cover_source !== 'none' ? row.cover_url : null
  return {
    key: row.key,
    title: file.title,
    authors: file.authors ?? [],
    status: file.status,
    session: file.session ?? null,
    extraReads: file.extraReads ?? 0,
    earlierReads: file.earlierReads ?? [],
    pageCount: file.pageCount ?? null,
    otherKeys: file.otherKeys ?? [],
    addedOn: file.addedOn ?? null,
    // The Collections she kept for the row (the app's `chosenShelves`), as the device uploaded them.
    collections: file.collections ?? [],
    book: covered(book, choice?.lent ?? null, url),
    coverFrom: null,
    // The cover is the job's finding (not the Catalogue Book's own): the lent one, Open Library's, Goodreads'.
    coverFilled: Boolean(choice?.filled) || (row.cover_source !== null && row.cover_source !== 'edition' && row.cover_source !== 'none'),
  }
}
