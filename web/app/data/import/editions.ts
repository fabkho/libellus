import type { BookSnapshot } from '../books'
import { normalize, splitSeriesTitle, surname, workTitle } from './readingTracker'
import type { ImportBook } from './rows'

/**
 * Which edition an import row stands for (issue #111), whatever app wrote the
 * file: what a title search asks, whether a result is the row's work, and how
 * well its edition fits what the file says (language, format, pages, year).
 * Only the file's own data and the app's own sources are used: no app's book
 * pages are ever read (#155). Pure; the lookups are data/bookImport.ts.
 */

/**
 * The Book a row stands for when no source knows its edition: an `import`
 * Catalogue Book when it has an ISBN (the Catalogue's key), else the member's
 * own Manual book. Its cover is resolved later, if there is one to find.
 */
export function bookFromRow(book: ImportBook): BookSnapshot {
  const isbn13 = book.isbn13
  return {
    title: book.title,
    authors: book.authors,
    isbn13,
    isbn10: book.isbn10,
    pageCount: book.pageCount,
    year: book.year,
    language: book.language,
    publisher: book.publisher,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: isbn13 ? 'import' : 'manual',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** `en`, `eng`, `English`, `de-DE`, `ger`, `deu` → `en` / `de`: languages as the sources write them, comparable. */
export function languageCode(value: string | null | undefined): string | null {
  const text = (value ?? '').trim().toLowerCase()
  if (!text) return null
  const named: Record<string, string> = {
    english: 'en', eng: 'en', german: 'de', deutsch: 'de', ger: 'de', deu: 'de', french: 'fr', fre: 'fr', fra: 'fr',
    spanish: 'es', spa: 'es', italian: 'it', ita: 'it', dutch: 'nl', dut: 'nl', nld: 'nl', portuguese: 'pt', por: 'pt',
  }
  if (named[text]) return named[text]
  const short = /^([a-z]{2})(?:[-_][a-z]+)?$/.exec(text)
  return short ? short[1]! : null
}

/**
 * The language a title is most likely in, from its little words (`der`, `und`,
 * `the`, `of`) and its letters (`ä`, `ß`): `de`, `en`, or null when it does not
 * say (`Circe`, `Neuromancer`). Only a hint for ranking editions of a work
 * whose row says no language.
 */
export function titleLanguage(title: string): string | null {
  const words = title.toLowerCase().split(/[^\p{L}]+/u)
  const german = /[äöüß]/i.test(title) || words.some((word) => GERMAN_WORDS.has(word))
  const english = words.some((word) => ENGLISH_WORDS.has(word))
  return german === english ? null : german ? 'de' : 'en'
}
const GERMAN_WORDS = new Set(['der', 'die', 'das', 'und', 'von', 'des', 'dem', 'den', 'ein', 'eine', 'einer', 'im', 'mit', 'zum', 'zur', 'auf', 'aus', 'nicht'])
const ENGLISH_WORDS = new Set(['the', 'of', 'and', 'a', 'an', 'to', 'with', 'from', 'for', 'is', 'my'])

/** A Binding or format that is an ebook (`Kindle Edition`, `ebook`, `Nook`): an Apple Books edition is the closest there is. */
export const isEbookBinding = (value: string | null | undefined) => /kindle|e-?book|nook|epub|digital/i.test(value ?? '')

type FitRow = Pick<ImportBook, 'title' | 'pageCount' | 'year' | 'binding'> & { language?: string | null }

/**
 * How well an edition found by title fits the row's: the same language (when
 * both are known: the file's, else told from the titles) counts most, then
 * an ebook for an ebook row, then about the same page count and the same year.
 * Only to rank editions of the same work against each other; ties keep the
 * search's order.
 */
export function editionFit(row: FitRow, found: Pick<BookSnapshot, 'title' | 'language' | 'pageCount' | 'year' | 'source'>): number {
  let fit = 0
  const wanted = languageCode(row.language) ?? titleLanguage(row.title)
  const theirs = languageCode(found.language) ?? titleLanguage(found.title)
  if (wanted && theirs) fit += wanted === theirs ? 4 : -4
  const pages = row.pageCount
  if (pages && found.pageCount) {
    const off = Math.abs(pages - found.pageCount) / pages
    fit += off <= 0.05 ? 2 : off <= 0.15 ? 1 : 0
  }
  // Apple Books sells ebooks: the closest to a Kindle edition there is. Worth
  // more than a print edition's page count, which an ebook never has to match.
  if (isEbookBinding(row.binding) && found.source === 'apple') fit += 3
  const year = row.year
  if (year && found.year === year) fit += 1
  return fit
}

/** Of the search's results, the same work's edition that fits the row best (`editionFit`); null when none is the same work. */
export function pickEdition<T extends { book: Pick<BookSnapshot, 'title' | 'authors' | 'language' | 'pageCount' | 'year' | 'source'> }>(
  row: FitRow & Pick<ImportBook, 'authors'>,
  results: readonly T[],
): T | null {
  let best: T | null = null
  let bestFit = -Infinity
  for (const result of results) {
    if (!isSameWork(row, result.book)) continue
    const fit = editionFit(row, result.book)
    if (fit > bestFit) {
      best = result
      bestFit = fit
    }
  }
  return best
}

/** What a title search asks: the title (no series) and the first author. */
export function titleQuery(book: Pick<ImportBook, 'title' | 'authors'>): string {
  return [book.title, book.authors[0] ?? ''].join(' ').trim()
}

/**
 * Whether a search result is the row's book (another edition is fine): the
 * same title once brackets and subtitles are dropped, and the first author's
 * surname among the result's authors. A title search only takes a result
 * this says yes to. A title in another script whose brackets name the work
 * (`Θνητοί Θεοί (Altered Carbon)`) is a translation, not the same book.
 */
export function isSameWork(row: Pick<ImportBook, 'title' | 'authors'>, found: Pick<BookSnapshot, 'title' | 'authors'>): boolean {
  const ours = workTitle(row.title)
  const bare = splitSeriesTitle(found.title).title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ')
  if (/\p{L}/u.test(bare) && !normalize(bare)) return false
  const theirs = workTitle(splitSeriesTitle(found.title).title)
  if (!ours || ours !== theirs) return false
  const wanted = surname(row.authors[0])
  if (!wanted) return true
  return found.authors.some((name) => surname(name) === wanted)
}
