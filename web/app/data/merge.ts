import { isbn10To13, isValidIsbn10, type Book, type BookSnapshot } from './books'
import type { LibraryEntry } from './library'

/**
 * One list out of three sources (issue #1, Search): the own Catalogue, Apple
 * Books and OpenLibrary each answer a query; this merges their answers,
 * removes duplicates, ranks what is left and tells the member which Books she
 * already has. Pure and framework-free: the search tests pin it, and a native
 * port copies it line for line. The member never sees which source a result
 * came from; `source` stays internal.
 */

export type SourceName = 'catalogue' | 'apple' | 'openlibrary'

/** The order sources rank in when nothing else decides: the Catalogue first. */
export const SOURCE_ORDER: readonly SourceName[] = ['catalogue', 'apple', 'openlibrary']

/** One Book one source found. `popularity`: whatever count of readers or ratings the source has (0 if none). */
export type Found = { book: BookSnapshot | Book; source: SourceName; popularity: number }

/** One row of the merged list. */
export type SearchResult = {
  book: BookSnapshot | Book
  /** The member's entry for this very Book (its ISBN, source id or Catalogue id), if she has it. */
  entry: LibraryEntry | null
  /** She has another edition: the same title and first author, but not this Book. */
  otherEdition: boolean
}

// ---------------------------------------------------------------- normalising

const LETTERS: Record<string, string> = { ß: 'ss', ø: 'o', æ: 'ae', œ: 'oe', ł: 'l', đ: 'd', þ: 'th', ı: 'i' }

/**
 * Text as matching compares it: accents stripped, lower case, `&` as "and",
 * every run of punctuation and space one space. "Klára & the Sun!" → "klara and the sun".
 */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßøæœłđþı]/g, (letter) => LETTERS[letter] ?? letter)
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The ISBN-13 an edition is known by: its own, or its ISBN-10 converted. */
export function isbn13Of(book: Pick<BookSnapshot, 'isbn13' | 'isbn10'>): string | null {
  if (book.isbn13) return book.isbn13
  return book.isbn10 && isValidIsbn10(book.isbn10) ? isbn10To13(book.isbn10) : null
}

/** What makes two results the same edition: a Catalogue id, the ISBN-13, a source id. */
export function editionKeys(book: BookSnapshot | Book): string[] {
  const isbn = isbn13Of(book)
  return [
    'id' in book ? `id:${book.id}` : null,
    isbn ? `isbn:${isbn}` : null,
    book.appleId ? `apple:${book.appleId}` : null,
    book.openLibraryEditionKey ? `ol:${book.openLibraryEditionKey}` : null,
  ].filter((key): key is string => key !== null)
}

/** What makes two editions the same book: normalised title and first author. */
export function workKey(book: Pick<BookSnapshot, 'title' | 'authors'>): string {
  return `${normalise(book.title)}|${normalise(book.authors[0] ?? '')}`
}

// -------------------------------------------------------------------- ranking

/**
 * How well a Book matches the query, from 0 to 100. The title counts most:
 * the title itself beats the title without its subtitle, which beats a title
 * beginning with the query, which beats the query's words somewhere in the
 * title. The author counts too, the first author more than the others, and a
 * query of title and author words ("piranesi clarke") as much as nearly the
 * title itself. A Book that only shares some of the words comes last.
 */
export const MATCH = {
  title: 100,
  mainTitle: 92,
  titleAndAuthor: 88,
  author: 85,
  titleStart: 80,
  titleWordStart: 75,
  firstAuthorWords: 70,
  titleWords: 65,
  titleAndAuthorWords: 55,
  otherAuthorWords: 45,
  someWords: 40,
} as const

/** Every query word begins one of `words` ("pira" begins "piranesi"). */
function allBegin(query: readonly string[], words: readonly string[]): boolean {
  return query.every((q) => words.some((word) => word.startsWith(q)))
}

function words(text: string): string[] {
  return text ? text.split(' ') : []
}

/** The title before its subtitle: "Piranesi: Drawings" → "Piranesi". */
function mainTitle(title: string): string {
  return title.split(/\s*[:(\[]|\s+[-–—]\s+|\.\s/)[0] ?? title
}

export function matchQuality(query: string, book: Pick<BookSnapshot, 'title' | 'authors'>): number {
  const q = normalise(query)
  if (!q) return 0
  const qWords = words(q)
  const title = normalise(book.title)
  const main = normalise(mainTitle(book.title))
  const titleWords = words(title)
  const mainWords = words(main)
  const authors = book.authors.map(normalise)
  const firstAuthor = words(authors[0] ?? '')
  const otherAuthors = authors.slice(1).flatMap(words)

  if (title === q) return MATCH.title
  if (main === q) return MATCH.mainTitle
  // Title and author words together: every title word typed, the rest the author's.
  if (
    mainWords.length > 0 &&
    mainWords.every((word) => qWords.includes(word)) &&
    qWords.some((word) => !mainWords.includes(word)) &&
    allBegin(
      qWords.filter((word) => !mainWords.includes(word)),
      firstAuthor,
    )
  ) {
    return MATCH.titleAndAuthor
  }
  if (authors[0] === q) return MATCH.author
  if (title.startsWith(`${q} `)) return MATCH.titleStart
  if (title.startsWith(q)) return MATCH.titleWordStart
  if (allBegin(qWords, firstAuthor)) return MATCH.firstAuthorWords
  if (allBegin(qWords, titleWords)) return MATCH.titleWords
  if (allBegin(qWords, otherAuthors)) return MATCH.otherAuthorWords
  if (allBegin(qWords, [...titleWords, ...firstAuthor, ...otherAuthors])) return MATCH.titleAndAuthorWords
  const everything = [...titleWords, ...firstAuthor, ...otherAuthors]
  const share = qWords.filter((word) => everything.some((w) => w.startsWith(word))).length / qWords.length
  return Math.round(MATCH.someWords * share)
}

/**
 * What the member's own books and the exact matches get on top of how well
 * they match (issue #47, item 16). A Book in her Library, or another edition
 * of one, whose title and authors hold every word of the query ranks above any
 * other book, even one that carries the exact title: "dispossessed" finds hers
 * first. A query naming title and author ("dispossessed le guin") that a book
 * answers exactly comes next, above an exact title alone. Summaries and study
 * guides sink below the real matches unless the member has the book or asked
 * for one. Added to the match quality.
 */
export const RANK = {
  library: 50,
  titleAndAuthor: 15,
  summary: -60,
} as const

const SUMMARY = /\b(?:summary|summaries|study guide|cliffs ?notes|spark ?notes|book review|key takeaways|chapter by chapter)\b/

/** Whether a title is a summary or study guide of another book, as matching reads it. */
export function isSummary(title: string): boolean {
  return SUMMARY.test(normalise(title))
}

/** The score results are ranked by: the match quality, lifted for her own books and exact matches, lowered for summaries. */
export function rankScore(query: string, book: Pick<BookSnapshot, 'title' | 'authors'>, quality: number, owned: boolean): number {
  let score = quality
  if (owned && quality >= MATCH.titleAndAuthorWords) score += RANK.library
  if (quality === MATCH.titleAndAuthor) score += RANK.titleAndAuthor
  if (!owned && isSummary(book.title) && !SUMMARY.test(normalise(query))) score += RANK.summary
  return score
}

// --------------------------------------------------------------------- merging

type Candidate = {
  book: BookSnapshot | Book
  source: SourceName
  popularity: number
  /** Position in the answers, sources in SOURCE_ORDER: the earlier, the more the source trusted it. */
  order: number
  keys: Set<string>
}

/** Fills what one source left out with what another said about the same edition. A Catalogue Book stays as stored. */
function fillIn(target: Candidate, other: BookSnapshot | Book) {
  if ('id' in target.book) return
  const book = { ...target.book }
  for (const field of Object.keys(book) as (keyof BookSnapshot)[]) {
    if (book[field] === null && other[field] !== null && field !== 'coverThumbhash' && field !== 'coverColors') {
      ;(book as Record<string, unknown>)[field] = other[field]
    }
  }
  if (!book.isbn13) book.isbn13 = isbn13Of(book)
  target.book = book
}

function entryFor(book: BookSnapshot | Book, library: readonly LibraryEntry[]): LibraryEntry | null {
  const keys = new Set(editionKeys(book))
  return library.find((entry) => editionKeys(entry.book).some((key) => keys.has(key))) ?? null
}

/** How good a cover URL is for a list row: 2 on Apple's CDN (fast), 1 anywhere else, 0 for none. */
export function coverRank(url: string | null | undefined): number {
  if (!url) return 0
  return /mzstatic\.com\//.test(url) ? 2 : 1
}

/**
 * The merged list for a query, best match first.
 *
 * 1. Catalogue hits first, then Apple, then OpenLibrary, each in its own order.
 * 2. The same edition (Catalogue id, ISBN-13 with ISBN-10s converted, or source
 *    id) is kept once; the first keeps its place, the later fills its gaps.
 * 3. The same book (normalised title and first author) is kept once too: the
 *    edition the member has, else the Catalogue's, else the first one found
 *    with a cover on Apple's CDN, else the first with any cover, else the first
 *    one found (the device language's storefront answers first). A cover
 *    counts because a row without one is a Placeholder, and Apple's because
 *    its CDN answers in one round trip where OpenLibrary's takes up to three
 *    (docs/covers.md). Another edition is one ISBN search away.
 * 4. Ranked by how well the query matches (matchQuality), lifted for the
 *    member's own books and for exact matches and lowered for summaries and
 *    study guides (rankScore), then Catalogue first, then popularity, then the
 *    order the sources gave.
 * 5. Each result knows the member's entry for it, or that she has another edition.
 */
export function mergeResults(
  query: string,
  answers: Partial<Record<SourceName, readonly Found[]>>,
  library: readonly LibraryEntry[] = [],
): SearchResult[] {
  // 1–2: one candidate per edition.
  const editions: Candidate[] = []
  const byKey = new Map<string, Candidate>()
  let order = 0
  for (const source of SOURCE_ORDER) {
    for (const found of answers[source] ?? []) {
      const keys = editionKeys(found.book)
      const same = keys.map((key) => byKey.get(key)).find(Boolean)
      if (same) {
        fillIn(same, found.book)
        same.popularity = Math.max(same.popularity, found.popularity)
        for (const key of keys) {
          same.keys.add(key)
          byKey.set(key, same)
        }
        continue
      }
      const candidate: Candidate = { ...found, order: order++, keys: new Set(keys) }
      if (candidate.source !== 'catalogue' && !candidate.book.isbn13) {
        candidate.book = { ...candidate.book, isbn13: isbn13Of(candidate.book) }
      }
      for (const key of keys) byKey.set(key, candidate)
      editions.push(candidate)
    }
  }

  // 3: one group per book, in the order its first edition came.
  const groups = new Map<string, Candidate[]>()
  for (const candidate of editions) {
    const key = workKey(candidate.book)
    const group = groups.get(key)
    if (group) group.push(candidate)
    else groups.set(key, [candidate])
  }

  const owned = new Set(library.map((entry) => workKey(entry.book)))

  // 4: ranked.
  const ranked = [...groups.entries()].map(([work, group]) => {
    const pick =
      group.find((candidate) => entryFor(candidate.book, library)) ??
      group.find((candidate) => candidate.source === 'catalogue') ??
      group.find((candidate) => coverRank(candidate.book.coverUrl) === 2) ??
      group.find((candidate) => coverRank(candidate.book.coverUrl) === 1) ??
      group[0]!
    const quality = Math.max(...group.map((candidate) => matchQuality(query, candidate.book)))
    return {
      work,
      pick,
      score: rankScore(query, pick.book, quality, owned.has(work)),
      catalogue: group.some((candidate) => candidate.source === 'catalogue'),
      popularity: Math.max(...group.map((candidate) => candidate.popularity)),
      order: group[0]!.order,
    }
  })
  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.catalogue) - Number(a.catalogue) ||
      b.popularity - a.popularity ||
      a.order - b.order,
  )

  // 5: what the member has.
  return ranked.map(({ work, pick }) => {
    const entry = entryFor(pick.book, library)
    return { book: pick.book, entry, otherEdition: !entry && owned.has(work) }
  })
}
