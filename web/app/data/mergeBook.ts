import type { BookFormat, BookSnapshot, CoverColors } from './books'
import { isValidIsbn10, isValidIsbn13, isbn10To13 } from './books'
import { type CoverKind, COVER_HEIGHT, kindRank } from './coverRank'
import { languageCode, titleLanguage } from './import/editions'

/**
 * One place that decides which source's value a Book field gets: ask several
 * sources about the same book (cheap first, stop early), then merge FIELD BY
 * FIELD into the best Book, with provenance. Pure: no I/O, no Vue; the
 * sources' answers come in as `Candidate`s, so a test (or a native port) feeds
 * it recordings.
 *
 * Two kinds of field, because a work and an edition are not the same thing
 * (format-agnostic matching: match the WORK first, then take data from the
 * best edition):
 *
 * - **work fields** (title, authors, language, description, cover) may come
 *   from any candidate the caller has checked is the same work: the ebook at
 *   Apple, another print edition at Open Library. The best wins by its rank.
 * - **edition fields** (ISBN-13/-10, pages, year, publisher, format, the
 *   source ids) are the edition's own: only a candidate marked `exact` (the
 *   edition that was asked for) may give them, so an ebook's page count never
 *   lands on the paperback. The entry's own facts (`page_count_override`, the
 *   format she says) are hers and stay outside this module.
 *
 * Rules (each one tested, `tests/merge-book.test.ts`):
 *
 * - A value that is not plausible (0 pages, a year of 1066 or 3000, an
 *   ISBN whose check digit is wrong, a description of three words, a cover
 *   that is not https) is no value: it never replaces a good one, and when it
 *   is all there is the field stays null.
 * - Ties keep the order the candidates came in (put the Book's own record
 *   first and what it has stays unless something is strictly better).
 * - Where several plausible values exist, the one the most candidates agree
 *   on wins, then the better-ranked source (`SOURCE_RANK`), then the earlier.
 * - A cover: kind first (`data/coverRank.ts`: the edition itself, the work's
 *   ebook, another edition, Goodreads), then pixel height (Apple 900,
 *   Open Library `-L` 500, Goodreads 500, Google 128, or the probed height),
 *   then the earlier. Its thumbhash and colours travel with it.
 * - A description only from a source whose terms let it be stored
 *   (`STORABLE_DESCRIPTION`: not Google, not Goodreads); the language the book
 *   is in wins over a longer one in another language. The others are listed
 *   as withheld in the provenance.
 *
 * How the app adopts it: the import's match (`data/bookImport.ts`, `mergeAlternatives`)
 * and the cover fill take it now; Search and the barcode scan keep their chain
 * (`data/merge.ts`) and would call `mergeSources` with their per-source answers
 * for the same ISBN instead of `fillIn`'s first-wins (docs/covers.md).
 */

export type MergeSource = 'catalogue' | 'apple' | 'openlibrary' | 'dnb' | 'import' | 'manual' | 'goodreads' | 'google'

/** What one source said about the book. Absent, null and empty mean "nothing". */
export type Candidate = {
  source: MergeSource
  book: Partial<Pick<BookSnapshot, 'title' | 'authors' | 'isbn13' | 'isbn10' | 'pageCount' | 'year' | 'language' | 'publisher' | 'description' | 'coverUrl' | 'coverThumbhash' | 'coverColors' | 'format' | 'appleId' | 'openLibraryEditionKey' | 'openLibraryWorkKey'>>
  /** The edition that was asked for (same ISBN-13, or the one the caller picked as the Book): the only one that gives edition fields. */
  exact: boolean
  /** The cover's pixel height when it was read; else the source's usual (`COVER_HEIGHT`). */
  coverHeight?: number
}

export type MergeField =
  | 'title'
  | 'authors'
  | 'isbn13'
  | 'isbn10'
  | 'pageCount'
  | 'year'
  | 'language'
  | 'publisher'
  | 'description'
  | 'cover'
  | 'format'
  | 'appleId'
  | 'openLibraryEditionKey'
  | 'openLibraryWorkKey'

export type FieldProvenance = { source: MergeSource; /** Which candidate (its place in the list given) the value is from. */ from: number; /** The edition itself gave it (else the work's). */ exact: boolean; /** Covers: how good (data/coverRank.ts). */ kind?: CoverKind }

export type Provenance = Partial<Record<MergeField, FieldProvenance>> & {
  /** Sources that had a description we may not store. */
  withheld?: MergeSource[]
}

export type Merged = {
  book: Pick<BookSnapshot, 'title' | 'authors' | 'isbn13' | 'isbn10' | 'pageCount' | 'year' | 'language' | 'publisher' | 'description' | 'coverUrl' | 'coverThumbhash' | 'coverColors' | 'format' | 'appleId' | 'openLibraryEditionKey' | 'openLibraryWorkKey'>
  provenance: Provenance
}

export type MergeContext = {
  /** The language the book is in (ISO 639-1/-2 or a name), when known: ranks descriptions. Else the merged `language`. */
  language?: string | null
  /** The newest year a book may have been published in. Default 2100: only nonsense is dropped. */
  maxYear?: number
}

// ------------------------------------------------------------------ the tables

/**
 * Which source is believed first for a field, best first (a source not listed
 * is last). Table-driven: change a rank here, nowhere else. The DNB knows
 * German editions exactly (title, authors, pages, publisher, year, language);
 * Apple's artwork and descriptions are the best written; Open Library is the
 * widest; the file's own record (`import`) is believed least for what a
 * source can say, most for nothing.
 */
export const SOURCE_RANK: Record<MergeField, readonly MergeSource[]> = {
  title: ['catalogue', 'dnb', 'apple', 'openlibrary', 'goodreads', 'import', 'google', 'manual'],
  authors: ['catalogue', 'dnb', 'apple', 'openlibrary', 'goodreads', 'import', 'google', 'manual'],
  isbn13: ['catalogue', 'dnb', 'openlibrary', 'apple', 'import', 'manual'],
  isbn10: ['catalogue', 'dnb', 'openlibrary', 'apple', 'import', 'manual'],
  pageCount: ['catalogue', 'dnb', 'openlibrary', 'apple', 'import', 'manual'],
  year: ['catalogue', 'dnb', 'openlibrary', 'apple', 'import', 'manual'],
  language: ['catalogue', 'dnb', 'openlibrary', 'apple', 'import', 'manual'],
  publisher: ['catalogue', 'dnb', 'openlibrary', 'apple', 'import', 'manual'],
  description: ['catalogue', 'apple', 'openlibrary', 'dnb'],
  cover: ['catalogue', 'apple', 'openlibrary', 'goodreads', 'google'],
  format: ['catalogue', 'apple', 'dnb', 'openlibrary', 'import', 'manual'],
  appleId: ['apple', 'catalogue'],
  openLibraryEditionKey: ['openlibrary', 'catalogue'],
  openLibraryWorkKey: ['openlibrary', 'catalogue'],
}

/** The fields that belong to one edition: only an `exact` candidate gives them. */
export const EDITION_FIELDS: readonly MergeField[] = ['isbn13', 'isbn10', 'pageCount', 'year', 'publisher', 'format', 'appleId', 'openLibraryEditionKey']

/** Sources whose terms let a description be stored (docs/THIRD-PARTY.md): Google and Goodreads do not. */
export const STORABLE_DESCRIPTION: readonly MergeSource[] = ['catalogue', 'apple', 'openlibrary', 'dnb']

const DESCRIPTION_MIN = 40
const DESCRIPTION_MAX = 20_000

// ------------------------------------------------------------------ plausibility

const clean = (value: string | null | undefined): string | null => {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  return text ? text : null
}

function plausiblePages(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : null
}

function plausibleYear(value: number | null | undefined, maxYear: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1400 && value <= maxYear ? value : null
}

const plausibleIsbn13 = (value: string | null | undefined): string | null => {
  const text = (value ?? '').replace(/[\s-]/g, '')
  return isValidIsbn13(text) ? text : null
}

/** The book's ISBN-10, or the one an ISBN-13 stands for is not derived here: it is only kept when valid. */
const plausibleIsbn10 = (value: string | null | undefined): string | null => {
  const text = (value ?? '').replace(/[\s-]/g, '').toUpperCase()
  return isValidIsbn10(text) ? text : null
}

const plausibleCoverUrl = (value: string | null | undefined): string | null => (value && /^https:\/\/[^\s]+$/.test(value) ? value : null)

function plausibleDescription(value: string | null | undefined, title: string | null): string | null {
  const text = (value ?? '').replace(/\r\n?/g, '\n').trim()
  if (text.length < DESCRIPTION_MIN || text.length > DESCRIPTION_MAX) return null
  if (title && text.toLowerCase() === title.toLowerCase()) return null
  return text
}

const normalised = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// ------------------------------------------------------------------ choosing

type Pick<T> = { value: T; candidate: Candidate; index: number }

const rankIn = (field: MergeField, source: MergeSource): number => {
  const at = SOURCE_RANK[field].indexOf(source)
  return at < 0 ? SOURCE_RANK[field].length : at
}

/** The value most plausible candidates agree on; ties go to the better-ranked source, then the earlier. */
function choose<T>(field: MergeField, picks: Pick<T>[], same: (a: T, b: T) => boolean = (a, b) => a === b): Pick<T> | null {
  let best: { pick: Pick<T>; agree: number } | null = null
  for (const pick of picks) {
    const agree = picks.filter((other) => same(other.value, pick.value)).length
    if (
      !best ||
      agree > best.agree ||
      (agree === best.agree &&
        (rankIn(field, pick.candidate.source) < rankIn(field, best.pick.candidate.source) ||
          (rankIn(field, pick.candidate.source) === rankIn(field, best.pick.candidate.source) && pick.index < best.pick.index)))
    ) {
      best = { pick, agree }
    }
  }
  return best?.pick ?? null
}

const provenanceOf = (pick: Pick<unknown>, kind?: CoverKind): FieldProvenance => ({
  source: pick.candidate.source,
  from: pick.index,
  exact: pick.candidate.exact,
  ...(kind ? { kind } : {}),
})

/** What kind of cover a candidate's is (data/coverRank.ts), for the ranking. */
export function coverKindOfCandidate(candidate: Candidate): CoverKind {
  if (candidate.source === 'goodreads') return 'goodreads'
  if (candidate.exact) return 'exact'
  const ebook = candidate.book.format === 'ebook' || candidate.source === 'apple' || /mzstatic\.com\//.test(candidate.book.coverUrl ?? '')
  return ebook ? 'ebook' : 'sameWork'
}

/** The pixel height a candidate's cover is known or taken to have. */
export function coverHeightOf(candidate: Candidate): number {
  if (candidate.coverHeight && candidate.coverHeight > 0) return candidate.coverHeight
  const url = candidate.book.coverUrl ?? ''
  if (/mzstatic\.com\//.test(url)) return COVER_HEIGHT.apple
  if (/covers\.openlibrary\.org\//.test(url)) return COVER_HEIGHT.openlibrary
  if (/gr-assets\.com\//.test(url)) return COVER_HEIGHT.goodreads
  if (/books\.google\.|googleusercontent\.com\//.test(url)) return COVER_HEIGHT.google
  return 0
}

// ------------------------------------------------------------------ the merge

/**
 * Merges what several sources said about the same book into the best Book,
 * field by field, and says where each field came from. The caller decides who
 * is the same work (`isSameWork`) and which candidate is the edition itself
 * (`exact`): this decides what to believe.
 */
export function mergeSources(candidates: readonly Candidate[], context: MergeContext = {}): Merged {
  const maxYear = context.maxYear ?? 2100
  const provenance: Provenance = {}
  const indexed = candidates.map((candidate, index) => ({ candidate, index }))
  const ofField = <T>(field: MergeField, read: (candidate: Candidate) => T | null): Pick<T>[] =>
    indexed
      .filter(({ candidate }) => !EDITION_FIELDS.includes(field) || candidate.exact)
      .flatMap(({ candidate, index }) => {
        const value = read(candidate)
        return value === null || value === undefined ? [] : [{ value, candidate, index }]
      })

  const set = <T>(field: MergeField, picks: Pick<T>[], same?: (a: T, b: T) => boolean): T | null => {
    const won = choose(field, picks, same)
    if (!won) return null
    provenance[field] = provenanceOf(won)
    return won.value
  }

  // ---- title: the most complete form of the title the sources agree on
  const titles = ofField('title', (candidate) => clean(candidate.book.title))
  const titleWon = choose('title', titles, (a, b) => normalised(a) === normalised(b))
  let title = titleWon?.value ?? null
  if (titleWon) {
    provenance.title = provenanceOf(titleWon)
    // The caller has checked the candidates are one work, so "Der Name der Rose: Roman" is the fuller form of "Der Name der Rose".
    const fuller = titles
      .filter((other) => normalised(other.value).startsWith(`${normalised(titleWon.value)} `) && /[:–—-]/.test(other.value.slice(titleWon.value.length, titleWon.value.length + 2)))
      .sort((a, b) => rankIn('title', a.candidate.source) - rankIn('title', b.candidate.source) || a.index - b.index)[0]
    if (fuller && titleWon.candidate.source !== 'catalogue') {
      title = fuller.value
      provenance.title = provenanceOf(fuller)
    }
  }

  // ---- authors: the most complete list (a list that contains the others' names), else the best source's
  const authorLists = ofField('authors', (candidate) => {
    const names = (candidate.book.authors ?? []).map((name) => clean(name)).filter((name): name is string => Boolean(name))
    return names.length ? names : null
  })
  let authors: string[] = []
  const authorsWon = choose('authors', authorLists, (a, b) => a.map(normalised).join('|') === b.map(normalised).join('|'))
  if (authorsWon) {
    authors = authorsWon.value
    provenance.authors = provenanceOf(authorsWon)
    const fuller = authorLists
      .filter((other) => other.value.length > authors.length && authors.every((name) => other.value.some((theirs) => normalised(theirs) === normalised(name))))
      .sort((a, b) => b.value.length - a.value.length || rankIn('authors', a.candidate.source) - rankIn('authors', b.candidate.source) || a.index - b.index)[0]
    if (fuller) {
      authors = fuller.value
      provenance.authors = provenanceOf(fuller)
    }
  }

  // ---- identifiers
  const isbn13 = set('isbn13', ofField('isbn13', (candidate) => plausibleIsbn13(candidate.book.isbn13) ?? plausibleIsbn13(candidate.book.isbn10 && isValidIsbn10(candidate.book.isbn10) ? isbn10To13(candidate.book.isbn10) : null)))
  const isbn10 = set('isbn10', ofField('isbn10', (candidate) => plausibleIsbn10(candidate.book.isbn10)))

  // ---- the edition's facts
  const pageCount = set('pageCount', ofField('pageCount', (candidate) => plausiblePages(candidate.book.pageCount)))
  const year = set('year', ofField('year', (candidate) => plausibleYear(candidate.book.year, maxYear)))
  const publisher = set('publisher', ofField('publisher', (candidate) => clean(candidate.book.publisher)?.slice(0, 200) ?? null), (a, b) => normalised(a) === normalised(b))
  const format = set<BookFormat>('format', ofField('format', (candidate) => candidate.book.format ?? null))
  const appleId = set('appleId', ofField('appleId', (candidate) => clean(candidate.book.appleId)))
  const openLibraryEditionKey = set('openLibraryEditionKey', ofField('openLibraryEditionKey', (candidate) => clean(candidate.book.openLibraryEditionKey)))
  const openLibraryWorkKey = set('openLibraryWorkKey', ofField('openLibraryWorkKey', (candidate) => clean(candidate.book.openLibraryWorkKey)))

  // ---- the work's language
  const language = set('language', ofField('language', (candidate) => languageCode(candidate.book.language)))

  // ---- description: storable sources only, the book's language first, then the longest plausible
  const wanted = languageCode(context.language) ?? language ?? titleLanguage(title ?? '')
  const withheld = indexed.filter(({ candidate }) => clean(candidate.book.description) && !STORABLE_DESCRIPTION.includes(candidate.source)).map(({ candidate }) => candidate.source)
  if (withheld.length) provenance.withheld = [...new Set(withheld)]
  const descriptions = ofField('description', (candidate) =>
    STORABLE_DESCRIPTION.includes(candidate.source) ? plausibleDescription(candidate.book.description, title) : null,
  )
  const inLanguage = (pick: Pick<string>) => {
    const theirs = languageCode(pick.candidate.book.language) ?? titleLanguage(pick.candidate.book.title ?? '')
    return !wanted || !theirs || theirs === wanted
  }
  const pool = descriptions.some(inLanguage) ? descriptions.filter(inLanguage) : descriptions
  const descriptionWon = [...pool].sort(
    (a, b) => b.value.length - a.value.length || rankIn('description', a.candidate.source) - rankIn('description', b.candidate.source) || a.index - b.index,
  )[0]
  if (descriptionWon) provenance.description = provenanceOf(descriptionWon)

  // ---- cover: kind, then height, then the earlier; its thumbhash and colours travel with it
  const covers = indexed.flatMap(({ candidate, index }) => {
    const url = plausibleCoverUrl(candidate.book.coverUrl)
    return url ? [{ value: url, candidate, index, kind: coverKindOfCandidate(candidate), height: coverHeightOf(candidate) }] : []
  })
  const coverWon = [...covers].sort(
    (a, b) =>
      kindRank(a.kind) - kindRank(b.kind) ||
      b.height - a.height ||
      rankIn('cover', a.candidate.source) - rankIn('cover', b.candidate.source) ||
      a.index - b.index,
  )[0]
  if (coverWon) provenance.cover = provenanceOf(coverWon, coverWon.kind)

  const colors: CoverColors | null = coverWon?.candidate.book.coverColors ?? null

  return {
    book: {
      title: title ?? '',
      authors,
      isbn13,
      isbn10,
      pageCount,
      year,
      language,
      publisher,
      description: descriptionWon?.value ?? null,
      coverUrl: coverWon?.value ?? null,
      coverThumbhash: coverWon?.candidate.book.coverThumbhash ?? null,
      coverColors: colors,
      format,
      appleId,
      openLibraryEditionKey,
      openLibraryWorkKey,
    },
    provenance,
  }
}

// ------------------------------------------------------------------ ISBN first

/**
 * The ISBN-13 to ask every other source with: the file's own when it has a
 * valid one, else the first valid ISBN of any candidate (an exact one first,
 * then the better-ranked source). Null when nobody has one: the work is then
 * asked for by title and author only. Pure; the pipeline around it is
 * "ISBN known: ask all sources by ISBN; none: find the work by title and
 * author, collect an ISBN from any hit, then ask by ISBN".
 */
export function collectIsbn(candidates: readonly Candidate[]): string | null {
  const found = candidates
    .map((candidate, index) => ({
      candidate,
      index,
      isbn: plausibleIsbn13(candidate.book.isbn13) ?? (candidate.book.isbn10 && isValidIsbn10(candidate.book.isbn10) ? isbn10To13(candidate.book.isbn10) : null),
    }))
    .filter((hit): hit is typeof hit & { isbn: string } => Boolean(hit.isbn))
    .sort(
      (a, b) =>
        Number(b.candidate.exact) - Number(a.candidate.exact) ||
        rankIn('isbn13', a.candidate.source) - rankIn('isbn13', b.candidate.source) ||
        a.index - b.index,
    )
  return found[0]?.isbn ?? null
}

/**
 * Whether the merge is already as good as it gets for what the import needs, so
 * the next (dearer) source need not be asked: the edition's own cover (Apple 900 px,
 * Open Library 500 px: the best a source gives), a plausible page count and a language.
 */
export function isComplete(merged: Merged): boolean {
  const { book, provenance } = merged
  return Boolean(
    book.coverUrl && provenance.cover?.kind === 'exact' && book.pageCount && book.language,
  )
}
