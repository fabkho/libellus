import type { BookSnapshot } from '../books'
import { isbnLanguage, normalize, splitSeriesTitle, surname, workTitle } from './readingTracker'
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
    polish: 'pl', pol: 'pl', swedish: 'sv', swe: 'sv', danish: 'da', dan: 'da', norwegian: 'no', nor: 'no', finnish: 'fi',
    fin: 'fi', hungarian: 'hu', hun: 'hu', czech: 'cs', cze: 'cs', ces: 'cs', russian: 'ru', rus: 'ru', turkish: 'tr', tur: 'tr',
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
  // An edition that says its language in brackets ("(Svensk utgåva)", "(German Edition)", "(édition française)").
  for (const [, aside] of title.matchAll(/[([]([^()[\]]*)[)\]]/g)) {
    if (!EDITION_WORD.test(aside!)) continue
    const named = aside!.toLowerCase().split(/[^\p{L}]+/u).find((word) => EDITION_LANGUAGES[word])
    if (named) return EDITION_LANGUAGES[named]!
  }
  const words = title.toLowerCase().split(/[^\p{L}]+/u)
  const told = [
    ['de', /[äöüß]/i.test(title) || words.some((word) => GERMAN_WORDS.has(word))],
    ['en', words.some((word) => ENGLISH_WORDS.has(word))],
    // French only to tell a translation apart ("… : Une romance de Noël", "(édition française)"): the app reads German and English.
    ['fr', words.some((word) => FRENCH_WORDS.has(word))],
  ] as const
  const said = told.filter(([, yes]) => yes)
  return said.length === 1 ? said[0]![0] : null
}
const GERMAN_WORDS = new Set(['der', 'die', 'das', 'und', 'von', 'des', 'dem', 'den', 'ein', 'eine', 'einer', 'im', 'mit', 'zum', 'zur', 'auf', 'aus', 'nicht'])
const ENGLISH_WORDS = new Set(['the', 'of', 'and', 'a', 'an', 'to', 'with', 'from', 'for', 'is', 'my'])
const FRENCH_WORDS = new Set(['une', 'les', 'et', 'pour', 'avec', 'dans', 'aux', 'sur', 'française', 'français', 'édition'])

/** "Edition" in the words publishers put in brackets after a title. */
const EDITION_WORD = /edition|édition|utgåva|ausgabe|edición|edizione|wydanie|udgave|utgave|kiadás|uitgave/i
/** The language an edition's bracket names, by its word for it. */
const EDITION_LANGUAGES: Record<string, string> = {
  english: 'en', german: 'de', deutsche: 'de', deutsch: 'de', french: 'fr', française: 'fr', français: 'fr', spanish: 'es',
  española: 'es', español: 'es', italian: 'it', italiana: 'it', polish: 'pl', polskie: 'pl', polska: 'pl', swedish: 'sv',
  svensk: 'sv', danish: 'da', dansk: 'da', norwegian: 'no', norsk: 'no', dutch: 'nl', nederlandse: 'nl', portuguese: 'pt',
  portuguesa: 'pt', hungarian: 'hu', magyar: 'hu',
}

/** The languages the app is in (German, English): a row that says none is most likely in one of them. */
const APP_LANGUAGES: readonly string[] = ['de', 'en']

/** A Binding or format that is an ebook (`Kindle Edition`, `ebook`, `Nook`): an Apple Books edition is the closest there is. */
export const isEbookBinding = (value: string | null | undefined) => /kindle|e-?book|nook|epub|digital/i.test(value ?? '')

type FitRow = Pick<ImportBook, 'title' | 'pageCount' | 'year' | 'binding'> & { language?: string | null; isbn13?: string | null }
type Fitted = Pick<BookSnapshot, 'title' | 'language' | 'pageCount' | 'year' | 'source'> & { coverUrl?: string | null }

/** The language of the row's edition: the file's, else told from its title, else from its ISBN's group (German or English only). */
function rowLanguage(row: Pick<FitRow, 'title' | 'language' | 'isbn13'>): string | null {
  const group = isbnLanguage(row.isbn13)
  return languageCode(row.language) ?? titleLanguage(row.title) ?? (group === 'de' || group === 'en' ? group : null)
}

/**
 * Whether an edition is in another language than the row's, both known (the file's or told from the titles and
 * the ISBN, as `editionFit` ranks them): a translation of her book, the same work but not what she read. The match
 * may still take it when the work has nothing else (a real Book before the file's own row), but the row is then
 * one to look at. Pure.
 */
export function otherLanguage(row: Pick<FitRow, 'title' | 'language' | 'isbn13'>, found: Pick<BookSnapshot, 'title' | 'language'>): boolean {
  const wanted = rowLanguage(row)
  const theirs = languageCode(found.language) ?? titleLanguage(found.title)
  if (!theirs) return false
  // A row that says no language is most likely in one of the app's: a French edition of it is a translation.
  return wanted ? wanted !== theirs : !APP_LANGUAGES.includes(theirs)
}

/**
 * How well an edition found by title fits the row's: the same language (when
 * both are known: the file's, else told from the titles) counts most, then
 * an ebook for an ebook row, then a cover (a row shown without one is a row to
 * look at), then about the same page count and the same year. Only to rank
 * editions of the same work against each other; ties keep the search's order.
 */
export function editionFit(row: FitRow, found: Fitted): number {
  let fit = 0
  const wanted = rowLanguage(row)
  const theirs = languageCode(found.language) ?? titleLanguage(found.title)
  if (wanted && theirs) fit += wanted === theirs ? 4 : -4
  else if (theirs && !APP_LANGUAGES.includes(theirs)) fit -= 4
  const pages = row.pageCount
  if (pages && found.pageCount) {
    const off = Math.abs(pages - found.pageCount) / pages
    fit += off <= 0.05 ? 2 : off <= 0.15 ? 1 : 0
  }
  // Apple Books sells ebooks: the closest to a Kindle edition there is. Worth
  // more than a print edition's page count, which an ebook never has to match.
  if (isEbookBinding(row.binding) && found.source === 'apple') fit += 3
  if (found.coverUrl) fit += 2
  const year = row.year
  if (year && found.year === year) fit += 1
  return fit
}

/**
 * THE ranking of the import (the match and Choose edition use it alike): of
 * what the sources found, the same work's editions (`isSameWork`) best fit
 * first (`editionFit`), ties in the order found. The match takes the first;
 * Choose edition lists them in this order.
 */
export function rankEditions<T extends { book: Pick<BookSnapshot, 'title' | 'authors' | 'language' | 'pageCount' | 'year' | 'source'> & { coverUrl?: string | null } }>(
  row: FitRow & Pick<ImportBook, 'authors'>,
  results: readonly T[],
): T[] {
  return results
    .filter((result) => isSameWork(row, result.book))
    .map((result, order) => ({ result, order, fit: editionFit(row, result.book) }))
    .sort((a, b) => b.fit - a.fit || a.order - b.order)
    .map(({ result }) => result)
}

/**
 * What a source found that is close to the row without being its work for
 * sure (`isNearWork`), best fit first: only for Choose edition, below the
 * row's work, never taken by the match.
 */
export function nearEditions<T extends { book: Pick<BookSnapshot, 'title' | 'authors' | 'language' | 'pageCount' | 'year' | 'source'> & { coverUrl?: string | null } }>(
  row: FitRow & Pick<ImportBook, 'authors'>,
  results: readonly T[],
): T[] {
  return results
    .filter((result) => !isSameWork(row, result.book) && isNearWork(row, result.book))
    .map((result, order) => ({ result, order, fit: editionFit(row, result.book) }))
    .sort((a, b) => b.fit - a.fit || a.order - b.order)
    .map(({ result }) => result)
}

/** Of the search's results, the same work's edition that fits the row best (`editionFit`); null when none is the same work. */
export function pickEdition<T extends { book: Pick<BookSnapshot, 'title' | 'authors' | 'language' | 'pageCount' | 'year' | 'source'> }>(
  row: FitRow & Pick<ImportBook, 'authors'>,
  results: readonly T[],
): T | null {
  return rankEditions(row, results)[0] ?? null
}

/** What a title search asks: the title (no series) and the first author. */
export function titleQuery(book: Pick<ImportBook, 'title' | 'authors'>): string {
  return [book.title, book.authors[0] ?? ''].join(' ').trim()
}

const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eins: '1', zwei: '2', drei: '3', vier: '4', fünf: '5', sechs: '6', sieben: '7', acht: '8', neun: '9', zehn: '10',
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', x: '10',
}

/**
 * The volume a title names ("Heartstopper: Volume Three", "Band 2", "Book II", "Teil 4", "Tome 02"): its
 * number as digits, or null when the title names none. The work title drops what follows a
 * colon, so the volumes of one series share it; this is what tells them apart.
 */
export function volumeOf(title: string): string | null {
  const match = /\b(?:volume|vol|band|bd|teil|book|buch|part|tome)\.?\s*(\d{1,3}|[a-zäöü]+)\b/i.exec(title.replace(/#/g, ' '))
  if (!match) return null
  const word = match[1]!.toLowerCase()
  return /^\d+$/.test(word) ? String(Number(word)) : (NUMBER_WORDS[word] ?? null)
}

/** Two titles that name different volumes are not the same book, whatever else they share. */
export const sameVolume = (a: string, b: string): boolean => {
  const ours = volumeOf(a)
  const theirs = volumeOf(b)
  return !ours || !theirs || ours === theirs
}

/** A volume's mark inside a series title: "T01", "Tome 01", "Band 2", "Book 3", "Vol. 4", "#1". Dropped from a title's forms. */
const VOLUME_MARK = /\bt(?=\d)\d{1,3}\b|\b(?:tome|band|bd|book|buch|teil|vol|volume|part|folge)\.?\s*\d{1,3}\b|#\s*\d{1,3}\b/gi

/**
 * The found title names a volume after the first (outside brackets, where a series' place is only an aside: "Title
 * (Series Book 2)") and the row's names none: the row is the book the series is named after. The other way round is
 * not refused: a source may leave a volume out of its title ("Harbour Lights" for "Harbour Lights: Volume Three").
 */
const laterVolume = (row: string, found: string) => {
  const unbracketed = (title: string) => title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ')
  return volumeOf(unbracketed(row)) === null && Number(volumeOf(unbracketed(found))) > 1
}

/** Whether a title carries a volume's number ("Tome 02", "Buch 3", "#2", "T01"). */
const numbered = (title: string) => volumeOf(title) !== null || new RegExp(VOLUME_MARK.source, 'i').test(title)

/** Where a series prefix ends or a subtitle begins: a dash between spaces, an en or em dash, a bar, or the full stop after a series number ("Harbour 1. Cold Water"). */
const SEPARATOR = /\s+-\s+|\s*[–—|]\s*|(?<=\d)\.\s+/

/**
 * The forms a title is known by, normalised: `full` (brackets, the series a
 * Goodreads title carries and volume marks dropped), `main` (before a colon, as
 * `workTitle`), `head` (before a dash or bar: "Cold Water - Eine Liebe am
 * Meer"; none when the title names a volume: that is the series) and `tail` (after the last one: a series prefix gone,
 * "Harbour Lights - Cold Water", "Nordic Tales 1: …" via the colon too). Pure.
 */
export function titleForms(title: string): { full: string; main: string; head: string | null; tail: string | null } {
  const bare = splitSeriesTitle(title).title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim()
  const form = (text: string | undefined) => normalize((text ?? '').replace(VOLUME_MARK, ' '))
  const parts = bare.split(SEPARATOR).filter((part) => part.trim())
  const colon = bare.split(':')
  const full = form(bare)
  // "Nordic Tales 1: Cold Water": what follows the colon of a numbered series is the book's own title.
  const afterColon = colon.length > 1 && /\d\s*$/.test(colon[0]!) ? form(colon.slice(1).join(':')) : null
  return {
    full,
    main: workTitle(bare),
    // A title that names a volume ("Series - Tome 02 : Title", "Series - Buch 3") has its series before the dash, not
    // its title: "Series" alone is the first volume's title as often as not, never this one's.
    head: parts.length > 1 && !numbered(bare) ? form(parts[0]) || null : null,
    tail: (parts.length > 1 ? form(parts.at(-1)) || null : null) ?? afterColon,
  }
}

/**
 * Whether two titles name one book: the same title as the work title compares
 * it (brackets dropped, before a colon), or the one is the other without its
 * series prefix or its subtitle after a dash ("Harbour Lights - Cold Water"
 * is "Cold Water", "Cold Water - Eine Liebe am Meer" is "Cold
 * Water"). Two volumes of one series ("Harbour Lights – Cold Water",
 * "– Warm Sand") are not: only a form of the one is compared with the whole
 * of the other. Pure.
 */
export function sameTitle(a: string, b: string): boolean {
  const ours = titleForms(a)
  const theirs = titleForms(b)
  if (!ours.full || !theirs.full) return false
  // The same words once the volume is dropped: not when only one names a volume, and a later one ("Harbour Lights" is
  // not "Harbour Lights: Volume Three", nor "Harbour Lights - Buch 3": a series' name is its first book's).
  if ((ours.main && ours.main === theirs.main) || ours.full === theirs.full) return !laterVolume(a, b)
  const wholeOurs = [ours.full, ours.main]
  const wholeTheirs = [theirs.full, theirs.main]
  return (
    [theirs.head, theirs.tail].some((form) => form && wholeOurs.includes(form)) ||
    [ours.head, ours.tail].some((form) => form && wholeTheirs.includes(form))
  )
}

/** "Melville, Herman" → "Herman Melville": a catalogue's surname-first form, read in order. */
const inOrder = (name: string) => (/^[^,]+,\s*[^,]+$/.test(name.trim()) && !/,\s*(?:jr|sr|ii|iii|iv)\.?$/i.test(name) ? name.split(',').reverse().join(' ') : name)

/** The edit distance of two words, a swap of neighbours counting one (Damerau, restricted). */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      rows[i]![j] = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i]![j] = Math.min(rows[i]![j]!, rows[i - 2]![j - 2]! + 1)
    }
  }
  return rows[a.length]![b.length]!
}

/** A name's surname with its umlauts written out ("Müller" → "mueller"), the way an ASCII catalogue spells it. */
const spelledOut = (name: string) => normalize(name.replace(/ä/gi, 'ae').replace(/ö/gi, 'oe').replace(/ü/gi, 'ue')).split(' ').at(-1) ?? ''

/**
 * Whether two author names are one author as the sources write them: the same
 * surname ("H.G. Wells", "H. G. Wells"; "Melville, Herman"), umlauts written out or
 * dropped ("Müller", "Mueller", "Muller"), or a surname one or two letters off
 * ("Austen", "Austin") with the same first initial. Pure.
 */
export function sameAuthor(a: string, b: string): boolean {
  const ours = surname(inOrder(a))
  const theirs = surname(inOrder(b))
  if (!ours || !theirs) return false
  if (ours === theirs || spelledOut(inOrder(a)) === spelledOut(inOrder(b))) return true
  if (spelledOut(inOrder(a)) === theirs || ours === spelledOut(inOrder(b))) return true
  const initial = (name: string) => normalize(inOrder(name))[0] ?? ''
  const shortest = Math.min(ours.length, theirs.length)
  const allowed = shortest >= 5 ? 2 : shortest >= 4 ? 1 : 0
  return allowed > 0 && initial(a) === initial(b) && distance(ours, theirs) <= allowed
}

/**
 * THE rule of the import for "this edition is the row's book" (another edition,
 * any format, is fine), for the match, Choose edition and the cover fill alike:
 * the same title (`sameTitle`: a series prefix, a subtitle after a dash or the
 * Goodreads series aside), not another volume (`sameVolume`), and the first
 * author among the result's authors (`sameAuthor`: spelling, umlauts and a
 * typo aside). A title in another script whose brackets name the work
 * (`Θνητοί Θεοί (Altered Carbon)`) is a translation, not the same book; a summary, study guide or workbook
 * sold under the book's title is not the book.
 */
export function isSameWork(row: Pick<ImportBook, 'title' | 'authors'>, found: Pick<BookSnapshot, 'title' | 'authors'>): boolean {
  // "Title (a Concise and Precise Summary)" is not the book, whatever its title and author say.
  if (COMPANION.test(found.title) && !COMPANION.test(row.title)) return false
  const bare = splitSeriesTitle(found.title).title.replace(/\s*[([][^()[\]]*[)\]]/g, ' ')
  if (/\p{L}/u.test(bare) && !normalize(bare)) return false
  if (!sameTitle(row.title, found.title)) return false
  // "Heartstopper: Volume Three" is not "Heartstopper: Volume Two": the colon drops the volume from the work title.
  if (!sameVolume(row.title, found.title)) return false
  const wanted = row.authors[0]
  if (!wanted || !surname(wanted)) return true
  return found.authors.some((name) => sameAuthor(wanted, name))
}

/** A book about a book, sold under its title: a summary, a study guide, a workbook. */
const COMPANION = /\b(?:summary|summaries|zusammenfassung|study guide|workbook|sparknotes|cliffsnotes|analysis of)\b/i

/** The words of a title that say something (four letters or more). */
const telling = (title: string) => titleForms(title).full.split(' ').filter((word) => word.length >= 4)

/**
 * Close to the row's book without being it for sure: the same author with a
 * title that shares its telling words either way ("Cold Dark Water",
 * "WATER"), or the same title by another author (an author the file spells
 * very differently). Choose edition shows these after the row's work; the
 * match never takes one. Pure.
 */
export function isNearWork(row: Pick<ImportBook, 'title' | 'authors'>, found: Pick<BookSnapshot, 'title' | 'authors'>): boolean {
  if (!sameVolume(row.title, found.title)) return false
  const wanted = row.authors[0]
  const byAuthor = Boolean(wanted) && found.authors.some((name) => sameAuthor(wanted!, name))
  if (!byAuthor) return Boolean(found.authors.length) && sameTitle(row.title, found.title)
  const ours = telling(row.title)
  const theirs = telling(found.title)
  if (!ours.length || !theirs.length) return false
  return ours.every((word) => theirs.includes(word)) || theirs.every((word) => ours.includes(word))
}
