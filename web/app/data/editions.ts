import type { Book, BookSnapshot } from './books'
import { createApple } from './apple'
import type { CatalogueSearch } from './catalogueSearch'
import { abortError, type FetchLike } from './fetching'
import { editionKeys, normalise } from './merge'
import { createOpenLibrary } from './openLibrary'

/**
 * The editions a Library entry can change to (issue #41): the other editions
 * of its work and what a search for its title and first author finds, in one
 * list. Built from the search repositories (the own Catalogue, Apple Books,
 * OpenLibrary) plus OpenLibrary's list of a work's editions:
 *
 * - **the work's editions**: OpenLibrary's editions of the Book's work, by
 *   its work key, or, for a Book without one (an Apple Book, an imported one),
 *   by the work OpenLibrary files its ISBN under;
 * - **a search** for "<title> <first author>" in every search source, keeping
 *   only what is an edition of the Book (`isEditionOf`: the same title, or the
 *   title within the other's by the same first author), so another book by
 *   the same author, or sharing a word, does not show.
 *
 * One row per edition: answers are merged by ISBN-13 (an ISBN-10 converted)
 * and source ids, a Catalogue Book winning over what a source says about it.
 * Unlike search, editions of the same title are *not* collapsed: they are the
 * point — but ones that look the same on the sheet are one row (the richest),
 * and rows stay where they were first shown while sources answer (new ones
 * are added at the end). Where a candidate came from is never shown. The entry's own Book is
 * the first row, marked current. Framework-free; `fetch` and the Catalogue
 * come in from outside, so the tests answer from recordings.
 */

/** One row of the list. `current`: the edition the entry has now. */
export type EditionCandidate = { book: Book | BookSnapshot; current: boolean }

/**
 * What the lookup found so far. `pending`: some source has not answered yet.
 * `failed`: every source failed, so the list says so instead of "nothing else".
 */
export type EditionsOutcome = { candidates: EditionCandidate[]; pending: boolean; failed: boolean }

/** Where a candidate came from; internal, and the order they rank in when nothing else decides. */
export type EditionSourceName = 'catalogue' | 'work' | 'apple' | 'openlibrary'
export const EDITION_SOURCE_ORDER: readonly EditionSourceName[] = ['catalogue', 'work', 'apple', 'openlibrary']

/** At most this many editions besides the current one. */
export const EDITIONS_LIMIT = 40

// --------------------------------------------------------------- languages

/**
 * OpenLibrary names languages by their MARC (bibliographic) codes, `ger`,
 * `fre`; Apple and the import by ISO 639-1, `de`. The common ones, so both
 * compare and both have a name.
 */
const MARC_TO_ISO: Record<string, string> = {
  ara: 'ar', cat: 'ca', ces: 'cs', chi: 'zh', cze: 'cs', dan: 'da', deu: 'de', dut: 'nl', ell: 'el',
  eng: 'en', fin: 'fi', fra: 'fr', fre: 'fr', ger: 'de', gre: 'el', heb: 'he', hin: 'hi', hun: 'hu',
  ita: 'it', jpn: 'ja', kor: 'ko', lat: 'la', nld: 'nl', nor: 'no', pol: 'pl', por: 'pt', ron: 'ro',
  rum: 'ro', rus: 'ru', spa: 'es', swe: 'sv', tur: 'tr', ukr: 'uk', zho: 'zh',
}

/** A language as one code to compare by: ISO 639-1 where known (`ger` → `de`), else as given, lower case. */
export function languageCode(language: string | null | undefined): string | null {
  const code = language?.trim().toLowerCase()
  if (!code) return null
  const primary = code.split(/[-_]/)[0]!
  return MARC_TO_ISO[primary] ?? primary
}

/** A language's name in the interface's language (`de` → "German"); null when there is none to give. */
export function languageName(language: string | null | undefined, uiLocale = 'en'): string | null {
  const code = languageCode(language)
  if (!code) return null
  try {
    const name = new Intl.DisplayNames([uiLocale], { type: 'language' }).of(code)
    return name && name.toLowerCase() !== code ? name : null
  } catch {
    return null
  }
}

// ----------------------------------------------------------------- matching

/** What the search for a Book's other editions asks: its title and its first author. */
export function editionsQuery(book: Pick<BookSnapshot, 'title' | 'authors'>): string {
  return [book.title, book.authors[0] ?? ''].join(' ').trim()
}

function words(text: string): string[] {
  const normal = normalise(text)
  return normal ? normal.split(' ') : []
}

/** Every word of `a` begins a word of `b`. */
function within(a: readonly string[], b: readonly string[]): boolean {
  return a.length > 0 && a.every((word) => b.some((other) => other.startsWith(word)))
}

/**
 * Whether a search find is an edition of the stored Book. The same title (as
 * matching reads it: accents, case and punctuation aside) always is: a
 * translation's author line often differs ("Todesmarsch" by Richard Bachman,
 * sold as Stephen King's). Otherwise the title must be in the other's —
 * "Im Haus der Feinde" and "Red Rising - Im Haus der Feinde", either way
 * round — *and* the first author must be among its authors, so another book
 * that merely shares a word of the title ("Giovanni-Battista Piranesi") or the
 * author ("Eine Spur von Mord" by Blake Pierce) is left out.
 */
export function isEditionOf(
  stored: Pick<BookSnapshot, 'title' | 'authors'>,
  found: Pick<BookSnapshot, 'title' | 'authors'>,
): boolean {
  const a = words(stored.title)
  const b = words(found.title)
  if (a.length && a.join(' ') === b.join(' ')) return true
  if (!(within(a, b) || within(b, a))) return false
  const first = words(stored.authors[0] ?? '')
  if (!first.length) return false
  return found.authors.some((author) => {
    const other = words(author)
    return within(first, other) || within(other, first)
  })
}

// ------------------------------------------------------------------- merging

/** Fields a source's snapshot may lack and another's of the same edition has. */
const FILLABLE = ['isbn13', 'isbn10', 'pageCount', 'year', 'language', 'publisher', 'description', 'coverUrl', 'openLibraryWorkKey'] as const

/**
 * One edition out of everything said about it. A Catalogue Book is what the
 * entry will point at, so it is shown as it is. Otherwise Apple's snapshot
 * leads (its artwork is the sharpest cover) and the others fill in what it
 * lacks (OpenLibrary knows page counts and languages). Source ids are never
 * mixed: the snapshot keeps its own source's.
 */
function representative(books: readonly (Book | BookSnapshot)[]): Book | BookSnapshot {
  const catalogued = books.find((book) => 'id' in book)
  if (catalogued) return catalogued
  const lead = books.find((book) => book.source === 'apple') ?? books[0]!
  const filled: BookSnapshot = { ...lead }
  for (const other of books) {
    if (other === lead) continue
    for (const field of FILLABLE) if (filled[field] == null && other[field] != null) (filled[field] as unknown) = other[field]
  }
  return filled
}

/**
 * What a row of the Change edition list shows, as one string: title, authors,
 * language, year, pages, publisher, whether it is an ebook (Apple's), and the
 * cover it draws. Two candidates with the same signature look the same on the
 * sheet, so only one of them is worth a row.
 */
export function editionSignature(book: Book | BookSnapshot): string {
  return [
    normalise(book.title),
    book.authors.map(normalise).join('&'),
    languageCode(book.language) ?? '',
    book.year ?? '',
    book.pageCount ?? '',
    normalise(book.publisher ?? ''),
    book.source === 'apple' ? 'ebook' : '',
    // Apple serves one file from several hosts (is1-ssl, is3-ssl, …).
    book.coverUrl?.replace(/^(https:\/\/is)\d(-ssl\.mzstatic\.com)/, '$1$2') ?? (book.coverThumbhash ? `hash:${book.coverThumbhash}` : ''),
  ].join('|')
}

const RICHNESS = ['isbn13', 'isbn10', 'pageCount', 'year', 'language', 'publisher', 'description', 'coverUrl', 'coverThumbhash', 'openLibraryWorkKey'] as const

/** How much a Book knows about its edition: the number of fields that are filled. */
function richness(book: Book | BookSnapshot): number {
  return RICHNESS.filter((field) => book[field] != null).length
}

/**
 * The candidates for an entry's edition change, from each source's answers:
 * the current Book first (marked), then one row per other edition — those
 * with a cover image first (what a member changing edition mostly wants), then
 * those in the current edition's language, then in source order. Candidates
 * that would look the same on the sheet (`editionSignature`) are one row, the
 * richest of them, and one that looks like the current edition is no row at
 * all. Manual books (her own, which Catalogue search finds) are never
 * candidates: an entry can only change to a Catalogue edition. Pure; the tests
 * pin it.
 */
export function mergeEditions(
  current: Book,
  answers: Partial<Record<EditionSourceName, readonly (Book | BookSnapshot)[]>>,
): EditionCandidate[] {
  type Group = { books: (Book | BookSnapshot)[]; keys: Set<string>; rank: number }
  const own: Group = { books: [current], keys: new Set(editionKeys(current)), rank: -1 }
  const groups: Group[] = [own]
  let seen = 0

  for (const name of EDITION_SOURCE_ORDER) {
    for (const book of answers[name] ?? []) {
      const keys = editionKeys(book)
      const group = groups.find((g) => keys.some((key) => g.keys.has(key)))
      if (group) {
        group.books.push(book)
        for (const key of keys) group.keys.add(key)
      } else if (keys.length) {
        groups.push({ books: [book], keys: new Set(keys), rank: seen })
      }
      seen++
    }
  }

  const language = languageCode(current.language)
  // Rows that look the same are one: the one with most to say, the Catalogue's
  // on a tie, at the earliest rank any of them had.
  const ownSignature = editionSignature(current)
  const distinct = new Map<string, { book: Book | BookSnapshot; rank: number }>()
  for (const group of groups) {
    if (group === own) continue
    const book = representative(group.books)
    if (book.source === 'manual') continue
    const signature = editionSignature(book)
    if (signature === ownSignature) continue
    const kept = distinct.get(signature)
    if (!kept) {
      distinct.set(signature, { book, rank: group.rank })
      continue
    }
    const gain = richness(book) - richness(kept.book) || Number('id' in book) - Number('id' in kept.book)
    distinct.set(signature, { book: gain > 0 ? book : kept.book, rank: Math.min(kept.rank, group.rank) })
  }

  const others = [...distinct.values()]
    .sort((a, b) => {
      const cover = Number(Boolean(b.book.coverUrl)) - Number(Boolean(a.book.coverUrl))
      if (cover) return cover
      if (language) {
        const same = (book: BookSnapshot) => Number(languageCode(book.language) === language)
        const byLanguage = same(b.book) - same(a.book)
        if (byLanguage) return byLanguage
      }
      return a.rank - b.rank
    })
    .slice(0, EDITIONS_LIMIT)

  return [{ book: current, current: true }, ...others.map(({ book }) => ({ book, current: false }))]
}

/**
 * The list a member is looking at, updated by a newer merge: every shown row
 * keeps its place (a tap never lands on another edition because a slower
 * source answered; the sheet keys rows by position), a row the merge knows
 * better — a slower source filled in its language or page count — takes the
 * merge's version of the same edition, and what the merge found that is not
 * shown yet is added at the end, in the merge's own order. A find that is the
 * same edition as a shown row (a shared edition key) or looks the same as one
 * is left out. Pure; the first merge (nothing shown) is taken as it is.
 */
export function appendEditions(shown: readonly EditionCandidate[], merged: readonly EditionCandidate[]): EditionCandidate[] {
  if (!shown.length) return [...merged]
  const better = merged.filter(({ current }) => !current)
  const rows = shown.map((row) => {
    if (row.current) return row
    const keys = editionKeys(row.book)
    const update = better.find(({ book }) => editionKeys(book).some((key) => keys.includes(key)))
    return update ? { book: update.book, current: false } : row
  })
  const keys = new Set(rows.flatMap(({ book }) => editionKeys(book)))
  const signatures = new Set(rows.map(({ book }) => editionSignature(book)))
  const added = better.filter(({ book }) => {
    const known = editionKeys(book).some((key) => keys.has(key)) || signatures.has(editionSignature(book))
    if (!known) {
      for (const key of editionKeys(book)) keys.add(key)
      signatures.add(editionSignature(book))
    }
    return !known
  })
  return [...rows, ...added]
}

// -------------------------------------------------------------------- lookup

export type EditionsOptions = {
  signal?: AbortSignal
  /** Called with the merged list each time a source answers (or fails), the last time with `pending: false`. */
  onUpdate?: (outcome: EditionsOutcome) => void
}

export type Editions = {
  /**
   * Every source at once; resolves with the full list once all have answered.
   * Rejects with an AbortError when `signal` aborts; no update is reported after that.
   */
  find: (book: Book, options?: EditionsOptions) => Promise<EditionsOutcome>
}

export function createEditions(options: {
  fetch: FetchLike
  languages: readonly string[]
  /** The own Catalogue; left out where there is no backend. */
  catalogue?: CatalogueSearch
}): Editions {
  const apple = createApple(options)
  const openLibrary = createOpenLibrary(options)

  type Ask = (book: Book, signal?: AbortSignal) => Promise<(Book | BookSnapshot)[]>

  /** The work the Book belongs to on OpenLibrary: its own key, or the one its ISBN is filed under. */
  async function workOf(book: Book, signal?: AbortSignal): Promise<string | null> {
    if (book.openLibraryWorkKey) return book.openLibraryWorkKey
    if (!book.isbn13) return null
    const found = await openLibrary.lookupIsbn(book.isbn13, signal)
    return found.find((hit) => hit.book.openLibraryWorkKey)?.book.openLibraryWorkKey ?? null
  }

  function asks(): Partial<Record<EditionSourceName, Ask>> {
    const catalogue = options.catalogue
    const titled = (book: Book, found: { book: Book | BookSnapshot }[]) =>
      found.map((hit) => hit.book).filter((hit) => isEditionOf(book, hit))
    return {
      ...(catalogue ? { catalogue: async (book: Book, signal?: AbortSignal) => titled(book, await catalogue.search(editionsQuery(book), signal)) } : {}),
      work: async (book, signal) => {
        const key = await workOf(book, signal)
        return key ? openLibrary.workEditions({ key, authors: book.authors }, signal) : []
      },
      apple: async (book, signal) => titled(book, await apple.search(editionsQuery(book), signal)),
      openlibrary: async (book, signal) => titled(book, await openLibrary.search(editionsQuery(book), signal)),
    }
  }

  async function find(book: Book, { signal, onUpdate }: EditionsOptions = {}): Promise<EditionsOutcome> {
    const sources = asks()
    const names = EDITION_SOURCE_ORDER.filter((name) => sources[name])
    const answers: Partial<Record<EditionSourceName, (Book | BookSnapshot)[]>> = {}
    const failures = new Set<EditionSourceName>()

    // The rows already reported keep their places; later answers only add to the end.
    let shown: EditionCandidate[] = []

    function outcome(): EditionsOutcome {
      const answered = Object.keys(answers).length + failures.size
      shown = appendEditions(shown, mergeEditions(book, answers))
      return {
        candidates: shown,
        pending: answered < names.length,
        failed: failures.size === names.length,
      }
    }

    await Promise.all(
      names.map((name) =>
        sources[name]!(book, signal).then(
          (found) => void (answers[name] = found),
          () => void failures.add(name),
        ).then(() => {
          if (!signal?.aborted) onUpdate?.(outcome())
        }),
      ),
    )
    if (signal?.aborted) throw abortError()
    return outcome()
  }

  return { find }
}
