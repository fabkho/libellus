import { BOOK_FORMATS, isbnParts, type BookFormat, type BookSnapshot } from './books'
import { languageCode } from './editions'

/**
 * "My edition isn't listed" (Change edition): the member's own edition, when
 * no source knows hers. What the form collects and how it becomes the snapshot
 * `use_own_edition` takes (library.ts, `useOwnEdition`). The title and authors
 * are the Book's she is changing (the same book, another edition); the format
 * is the one thing she must say. The database holds the same rules; the checks
 * here only let the form say what is wrong before anything is sent.
 * Framework-free, so a native port copies it 1:1.
 */

/** What the form collects; everything but the format is text as typed. */
export type OwnEditionDraft = {
  format: BookFormat | null
  isbn: string
  year: string
  publisher: string
  pageCount: string
  /** An ISO 639-1 code (`OWN_EDITION_LANGUAGES`), '' for none. */
  language: string
  coverUrl: string
}

/** The fields a form can mark wrong. */
export type OwnEditionField = 'format' | 'isbn' | 'year' | 'publisher' | 'pageCount' | 'coverUrl'

/** The languages the form offers, as ISO 639-1 codes; their names come from the interface's language. */
export const OWN_EDITION_LANGUAGES = [
  'en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'hu', 'ro', 'el', 'tr', 'ru', 'uk',
  'he', 'ar', 'hi', 'ja', 'ko', 'zh', 'la',
] as const

/** A fresh form for a Book: its language (when the form offers it), and the ISBN she looked up, if any. */
export function newOwnEditionDraft(book: Pick<BookSnapshot, 'language'>, isbn = ''): OwnEditionDraft {
  const language = languageCode(book.language)
  return {
    format: null,
    isbn,
    year: '',
    publisher: '',
    pageCount: '',
    language: language && (OWN_EDITION_LANGUAGES as readonly string[]).includes(language) ? language : '',
    coverUrl: '',
  }
}

/** True for an https URL (the only covers her own edition keeps). */
export function isCoverUrl(text: string): boolean {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'https:' && Boolean(url.hostname) && !/\s/.test(text.trim())
  } catch {
    return false
  }
}

/**
 * What is wrong with the form, by field, before anything is sent. Mirrors the
 * database: a format; an ISBN-10 or ISBN-13 whose check digit adds up; a year
 * from 1 to next year; a whole page count from 1 to 99,999; a publisher of at
 * most 500 characters; a cover that is an https URL.
 */
export function validateOwnEdition(draft: OwnEditionDraft, thisYear: number): Partial<Record<OwnEditionField, true>> {
  const wrong: Partial<Record<OwnEditionField, true>> = {}
  if (!draft.format || !BOOK_FORMATS.includes(draft.format)) wrong.format = true
  if (draft.isbn.trim() && !isbnParts(draft.isbn)) wrong.isbn = true
  const year = draft.year.trim()
  if (year && !(/^\d{1,4}$/.test(year) && Number(year) >= 1 && Number(year) <= thisYear + 1)) wrong.year = true
  const pages = draft.pageCount.trim()
  if (pages && !(/^\d{1,5}$/.test(pages) && Number(pages) > 0)) wrong.pageCount = true
  if (draft.publisher.trim().length > 500) wrong.publisher = true
  if (draft.coverUrl.trim() && !isCoverUrl(draft.coverUrl)) wrong.coverUrl = true
  return wrong
}

/**
 * The form as the snapshot of her own edition: a Manual book with the Book's
 * title and authors and what she typed, tidied (an ISBN-10 also as its
 * ISBN-13). Call it once `validateOwnEdition` finds nothing wrong.
 */
export function ownEditionSnapshot(book: Pick<BookSnapshot, 'title' | 'authors'>, draft: OwnEditionDraft): BookSnapshot {
  const isbn = draft.isbn.trim() ? isbnParts(draft.isbn) : null
  const year = draft.year.trim()
  const pages = draft.pageCount.trim()
  return {
    title: book.title,
    authors: [...book.authors],
    isbn13: isbn?.isbn13 ?? null,
    isbn10: isbn?.isbn10 ?? null,
    pageCount: pages ? Number(pages) : null,
    year: year ? Number(year) : null,
    language: draft.language || null,
    publisher: draft.publisher.trim() || null,
    description: null,
    coverUrl: draft.coverUrl.trim() || null,
    coverThumbhash: null,
    coverColors: null,
    source: 'manual',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    format: draft.format,
  }
}
