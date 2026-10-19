import type { SupabaseClient } from '@supabase/supabase-js'
import { parseIsbn, type Book, type BookSnapshot } from './books'
import type { CatalogueSearch } from './catalogueSearch'
import type { Dnb } from './dnb'
import { resolveBookCover, type ProbeImage, type ResolvedCover } from './covers'
import { coverKindOf, type CoverKind } from './coverRank'
import { languageFits, mergeCover } from './coverFill'
import { type Candidate, type GenreLabel, type MergeSource, mergeGenreLabels, mergeSources } from './mergeBook'
import { abortError, type FetchLike } from './fetching'
import { SUPPORTED_SOURCES } from './import/detect'
import { editionSignature } from './editions'
import { bookFromRow, editionFit, isEbookBinding, isSameWork, nearEditions, otherLanguage, probablyGerman, rankEditions, sameVolume } from './import/editions'
import { dnbQuestion, FREE_SOURCES, questionsFor } from './import/queries'
import type { ImportBook, ImportProblem } from './import/rows'
import { surname, workTitle } from './import/readingTracker'
import { bookToRow, mapLibraryError, type LibraryEntry, type LibraryErrorCode, type Result, type WriteOptions } from './library'
import { editionKeys, normalise, type Found, type SourceName } from './merge'
import type { Search, SearchOutcome } from './search'

/**
 * Importing an export in the app (issues #40, #111), after the file is read
 * and its app detected (data/import/detect.ts → the normalised rows of
 * data/import/rows.ts): finding each book's edition the way search does, and
 * writing the rows. Nothing here knows which app wrote the file.
 *
 * Finding an edition, per row (the import-quality fix: as many rows as can be
 * matched to a real Book, any format, an ebook as good as print; one pool of
 * candidates and one ranking for the match and Choose edition). The Catalogue
 * (a Book some member imported or added before) is the FIRST source, for an ISBN
 * and for a title alike: a row it answers sure (`catalogueFirst`) costs no
 * Apple, Open Library or National Library call.
 *   1. by its ISBN: the Catalogue (a Book some member added before), then
 *      Apple Books (asked for the whole file's ISBNs in a few batch requests
 *      first, `primeIsbns`), then OpenLibrary, then the National
 *      Library (data/dnb.ts: a German edition only it knows). An exact edition with its own
 *      cover is the match, nothing more is asked;
 *   2. the work by its title: first the Catalogue alone (`catalogueFirst`: the
 *      ladder's first two questions); the work with a cover, in the row's
 *      language and a fitting edition (`settled`) ends the row there. Else
 *      `titleCandidates`: a ladder of questions
 *      (data/import/queries.ts: title and author, then without subtitle or
 *      series prefix, umlauts written out, the title alone, the name turned)
 *      until one finds the row's work (`isSameWork`) with a cover; the
 *      National Library's one question is asked early for a row that is
 *      probably German, last for any other. Every
 *      edition each source names is a candidate (not one per book, as search
 *      shows them), ranked by `rankEditions` (language, format, cover, pages,
 *      year; all from the file itself, no app's book pages, #155);
 *   3. the match: the exact edition, else the best same-work edition (`via:
 *      'title'`, even when the file has an ISBN no source knows: a real Book
 *      before the file's own row; her pages and format stay on her entry). An
 *      edition without a cover borrows the best one of its work (`coverLender`:
 *      the work's ebook before another print edition), as the cover fill would;
 *   4. nothing: the file's own fields, an `import` Book keyed by its ISBN or a
 *      Manual book of the member's (`bookFromRow`), with Goodreads' cover of
 *      the file's own book id as the last resort (`lookups.goodreads`).
 * A source that did not answer (a refusal, an error, no answer in time) is not
 * "nothing found": the row is `unsure` and asked again at the end (once the
 * paced host lets us back, `busyFor`); an unsure row is never remembered as a
 * miss. Rows are looked up a few at a time (`concurrency`), each source call
 * with a deadline, so a slow network slows the import down instead of
 * stopping it.
 *
 * Writing: the Cover of each Book that is new to the Catalogue is resolved
 * first (as on add, data/covers.ts), then a few rows go to `import_books` per
 * call (the rules are the database's: supabase/migrations/*_import_books.sql).
 * Each row's key (`goodreads:<Book Id>`, `hardcover:<Book ID>`) is stored on
 * its entry and reads, so the same file twice adds nothing.
 *
 * Framework-free: the Supabase client, the search repositories and the image
 * probe come in from outside.
 */

/** Rows looked up at once. */
export const IMPORT_CONCURRENCY = 4

/** Rows written per call. */
export const IMPORT_CHUNK = 10

/**
 * How long the second pass over the rows nothing was found for may run: a slow
 * network or a source that refuses everything must not hold the preview back
 * for an hour. What it has not reached keeps its first answer.
 */
export const SECOND_PASS_BUDGET_MS = 240_000

/** How long one source call may take before the row moves on without it. */
export const LOOKUP_TIMEOUT_MS = 15_000

/** The edition a row was matched to. */
export type Edition = {
  /** A Book with an id (the Catalogue, or her own Manual book), a source's snapshot, or the file's own (`via: null`). */
  book: Book | BookSnapshot
  /** How it was found: by the row's ISBN, by title and author, or not at all. */
  via: 'isbn' | 'title' | null
  /** Some lookup could not be asked (no answer in time, or every source failed): a better edition may exist. */
  unsure: boolean
  /**
   * A source did not answer while the row was matched to an edition that will do (a cover, the row's language, any
   * format): it is asked again in the second pass for a better one (its ebook, its very edition), but the match
   * stands and is no row to look at (owner rule: any format, a real Book before none).
   */
  retry?: boolean
  /** Another edition of the same work, whose cover the file's own Book takes when its ISBN finds none. */
  coverFrom?: Book | BookSnapshot | null
  /** The cover fill found its cover (data/coverFill.ts): for a Catalogue Book it is handed to `fill_book_covers` once written. */
  filled?: boolean
  /** Which kind of cover the fill gave it (data/coverRank.ts): a better kind found later replaces it. */
  coverKind?: CoverKind
  /**
   * The other editions of the row's work its title search found, best fit
   * first (`rankEditions`, the order the match was picked in): what the preview
   * offers when the member chooses another edition herself, and where a cover
   * is borrowed from; at most `ALTERNATIVES_KEPT`.
   */
  alternatives?: (Book | BookSnapshot)[]
  /** What the sources found close to the row without being its work for sure (`nearEditions`): Choose edition lists them last. */
  near?: (Book | BookSnapshot)[]
  /** The Catalogue alone settled the row: no other source was asked about it (`catalogueFirst`, or its ISBN found there with a cover). */
  catalogueOnly?: boolean
  /** Only Goodreads knew the book (the file's own book id): its cover, and nothing else, came from there. */
  goodreadsOnly?: boolean
  /**
   * The raw genre labels the sources gave the edition and its work's other editions (`mergeGenreLabels`, with their
   * sources): collected for the Book, not stored yet and not mapped onto the app's genre list.
   */
  genres?: GenreLabel[]
}

/** The edition with the genre labels of its Book and its work's other editions merged on it (`Edition.genres`). Pure. */
export function withGenres(edition: Edition): Edition {
  // The alternatives hold the edition itself when it was found by title: each Book once.
  const books = [...new Set([edition.book, ...(edition.alternatives ?? [])])]
  const genres = mergeGenreLabels(books.map((book) => ({ source: book.source as MergeSource, book, exact: book === edition.book })))
  return genres.length ? { ...edition, genres } : edition
}

/**
 * The edition of the same work whose cover `base` borrows when its own has none:
 * the merge's pick (data/mergeBook.ts, the one cover ranking: the work's ebook
 * before another print edition), in the row's language. Null when `base` has a
 * cover or no alternative has one. Pure.
 */
export function coverLender(
  row: Pick<ImportBook, 'title' | 'language'>,
  base: Book | BookSnapshot,
  alternatives: readonly (Book | BookSnapshot)[],
): Book | BookSnapshot | null {
  if (base.coverUrl) return null
  const usable = alternatives.filter((book) => book.coverUrl && languageFits(row, book))
  if (!usable.length) return null
  const candidate = (book: Book | BookSnapshot, exact: boolean): Candidate => ({ source: book.source, book, exact })
  const { provenance } = mergeSources([candidate(base, true), ...usable.map((book) => candidate(book, false))])
  const at = provenance.cover?.from
  return at ? (usable[at - 1] ?? null) : null
}

/**
 * An edition with the cover of `lender` lent to it, as the cover fill gives one
 * (`mergeCover`: on a found edition's Book, as `coverFrom` of the file's own
 * row), of the kind the ranking calls it (the work's ebook, another edition).
 * The edition itself when there is nothing to lend. Pure.
 */
export function withLentCover(edition: Edition, lender: Book | BookSnapshot | null): Edition {
  if (!lender?.coverUrl) return edition
  const lent = mergeCover(edition, {
    coverUrl: lender.coverUrl,
    coverThumbhash: lender.coverThumbhash,
    coverColors: lender.coverColors,
    kind: coverKindOf('sibling', lender.coverUrl),
  })
  return lent ?? edition
}

/** Alternatives kept per row (a file can be thousands of rows). */
export const ALTERNATIVES_KEPT = 20

/** Near finds kept per row, for Choose edition. */
export const NEAR_KEPT = 10

/** What the last-resort Goodreads stage is asked with: a Goodreads file's row and its book id. */
export type GoodreadsQuery = { title: string; authors: string[]; goodreadsBookId: string | null }

export type Lookups = {
  catalogue: Pick<CatalogueSearch, 'search'>
  search: Pick<Search, 'lookupIsbn' | 'search'> & Partial<Pick<Search, 'primeIsbns' | 'workEditions'>>
  /**
   * The German National Library (data/dnb.ts), the import's one question per row (data/import/queries.ts
   * `dnbQuestion`): early for a row that is probably German, last for any other row nothing else found.
   */
  dnb?: Pick<Dnb, 'editions'>
  /**
   * Goodreads' cover of a Goodreads file's row nothing else found a cover for (flagged: data/coverRank.ts,
   * `GOODREADS_COVERS`), already checked to be an image: the cover, null for none, 'blocked' when Goodreads turns us away.
   */
  goodreads?: (query: GoodreadsQuery, signal?: AbortSignal) => Promise<ResolvedCover | null | 'blocked'>
  /** How long a paced source asks to be left alone now (ms): the second pass waits it out before asking again. */
  busyFor?: () => number
  timeoutMs?: number
}

/** Runs `task` with a signal that aborts after `ms` or with `outer`. */
async function withDeadline<T>(ms: number, outer: AbortSignal | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timer = setTimeout(abort, ms)
  outer?.addEventListener('abort', abort)
  try {
    return await task(controller.signal)
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', abort)
  }
}

/** One source call of a row's lookup: its answer, or null when it gave none in time (and the lookup is then unsure). */
type Ask = <T>(task: (signal: AbortSignal) => Promise<T>) => Promise<T | null>

function asker(lookups: Lookups, signal: AbortSignal | undefined, onMiss: () => void): Ask {
  const timeout = lookups.timeoutMs ?? LOOKUP_TIMEOUT_MS
  return async (task) => {
    try {
      return await withDeadline(timeout, signal, task)
    } catch {
      if (signal?.aborted) throw abortError()
      onMiss()
      return null
    }
  }
}

/**
 * An edition of the row's work nothing a source could add would beat: its own cover, the row's language, and for an
 * ebook row an Apple Books edition (the closest to a Kindle edition there is). A National Library edition never
 * settles a row: its cover is not its own (the function's Open Library cover by ISBN, or one lent to it), so a
 * source may still have the edition's own. Pure.
 */
export function settled(row: Pick<ImportBook, 'title' | 'language' | 'isbn13' | 'binding'>, book: Book | BookSnapshot): boolean {
  return Boolean(book.coverUrl) && book.source !== 'dnb' && !otherLanguage(row, book) && (!isEbookBinding(row.binding) || book.source === 'apple')
}

/** What the title ladder found for a row: its work's editions best first, what is close to it, and whether a source could not be asked. */
export type TitleCandidates = { same: (Book | BookSnapshot)[]; near: (Book | BookSnapshot)[]; incomplete: boolean }

/**
 * The row's work by its title, the ONE candidate pool of the match and Choose
 * edition: the questions of data/import/queries.ts in order, each to the
 * sources it names (the free ones first, Apple only while they leave the row
 * unsettled: `settled`), every edition they name kept once, until the row's work
 * (`isSameWork`) turns up with a cover (`all`: every question, for Choose
 * edition). The National Library is asked its one question EARLY for a row that
 * is probably German and LAST for any other row the ladder found no covered
 * edition for. A source that does not answer makes the result `incomplete`,
 * never empty for sure.
 */
export async function titleCandidates(row: ImportBook, lookups: Lookups, signal?: AbortSignal, { all = false }: { all?: boolean } = {}): Promise<TitleCandidates> {
  let incomplete = false
  const ask = asker(lookups, signal, () => (incomplete = true))
  const pool: { book: Book | BookSnapshot }[] = []
  const seen = new Map<string, { book: Book | BookSnapshot }>()
  const held = new Set<Book | BookSnapshot>()
  let same: (Book | BookSnapshot)[] = []
  const keep = (found: readonly (Book | BookSnapshot)[]) => {
    for (const book of found) {
      if (held.has(book)) continue
      // One candidate per edition (its ISBN or a source id); one without any is itself. The same edition
      // named twice (the National Library's record and Apple's of one ISBN) keeps the cover either has: a
      // DNB edition has none of its own, its covered twin is the same edition, not a second candidate.
      const keys = editionKeys(book)
      const known = keys.map((key) => seen.get(key)).find((entry): entry is { book: Book | BookSnapshot } => entry !== undefined)
      if (known) {
        if (!known.book.coverUrl && book.coverUrl) known.book = { ...known.book, coverUrl: book.coverUrl, coverThumbhash: book.coverThumbhash, coverColors: book.coverColors }
        continue
      }
      const entry = { book }
      for (const key of keys) seen.set(key, entry)
      held.add(book)
      pool.push(entry)
    }
    same = rankEditions(row, pool).map(({ book }) => book)
  }
  const put = (outcome: SearchOutcome | null) => {
    if (!outcome) return
    if (outcome.failed || outcome.unanswered?.length) incomplete = true
    keep(outcome.editions ?? outcome.results.map((result) => result.book))
  }
  const asking = (query: string, sources: readonly SourceName[]) => ask((s) => lookups.search.search(query, { signal: s, sources }))
  // The National Library's one question (data/import/queries.ts `dnbQuestion`): early for a row that is
  // probably German (its editions come with the free sources, before Apple is asked anything), last for
  // any other row the ladder found no covered edition of its work for. Its refusal is "not asked"
  // (`incomplete`), never "nothing found"; its editions join the one pool, with no cover of their own.
  const aboutDnb = dnbQuestion(row)
  let askedDnb = false
  const askDnb = async () => {
    if (askedDnb || !aboutDnb || !lookups.dnb) return
    askedDnb = true
    const found = await ask((s) => lookups.dnb!.editions({ title: aboutDnb.title, authors: [...aboutDnb.authors] }, { signal: s }))
    if (found) keep(found)
    else incomplete = true
  }
  const german = probablyGerman(row)
  if (german) await askDnb()
  for (const question of questionsFor(row)) {
    if (question.sources) {
      put(await asking(question.query, question.sources))
    } else {
      // The free sources first; Apple (its per-address limit is the import's scarcest thing) only when they leave
      // something to find: the work with a cover, in the row's language, and an ebook row's Apple ebook.
      put(await asking(question.query, FREE_SOURCES))
      if (all || !same.some((book) => settled(row, book))) put(await asking(question.query, ['apple']))
    }
    if (!all && same.some((book) => book.coverUrl)) break
  }
  if (!german && (all || !same.some((book) => book.coverUrl))) await askDnb()
  return { same, near: nearEditions(row, pool).map(({ book }) => book), incomplete }
}

/** How many of the title ladder's first questions the Catalogue is asked before any other source (`catalogueFirst`). */
export const CATALOGUE_QUESTIONS = 2

/** What the Catalogue alone knows of a row's work: its Books, and the one that settles the row (or null). */
export type CatalogueFirst = { books: (Book | BookSnapshot)[]; same: (Book | BookSnapshot)[]; near: (Book | BookSnapshot)[]; sure: Book | BookSnapshot | null }

/**
 * The Catalogue is the import's first source (owner decision 2026-10-19): a Book any member imported or added
 * before never costs an Apple, Open Library or National Library call. The ladder's first questions
 * (`CATALOGUE_QUESTIONS`: title and author, then the main title and surname) are asked of the Catalogue alone;
 * the work's best fit (`rankEditions`, the one ranking) settles the row when it is `settled`: its own cover, the row's
 * language, an ebook row's Apple edition, never a National Library record, never a member's Manual book (hers
 * alone). Anything less (no cover, another language, nothing) does not settle it: the row goes on to the full
 * ladder exactly as before, whose first question asks the Catalogue again with the other sources (so its Books
 * join the pool there; one more call to our own database, nothing external). The Catalogue not answering is no
 * "unsure": the ladder asks it again. Rejects only when `signal` aborts.
 */
export async function catalogueFirst(row: ImportBook, lookups: Lookups, signal?: AbortSignal): Promise<CatalogueFirst> {
  const ask = asker(lookups, signal, () => {})
  const books: (Book | BookSnapshot)[] = []
  const answer = (sure: Book | BookSnapshot | null): CatalogueFirst => {
    const pool = books.map((book) => ({ book }))
    return { books, same: rankEditions(row, pool).map(({ book }) => book), near: nearEditions(row, pool).map(({ book }) => book), sure }
  }
  for (const { query } of questionsFor(row).slice(0, CATALOGUE_QUESTIONS)) {
    const found = await ask((s) => lookups.catalogue.search(query, s))
    for (const { book } of found ?? []) {
      // One Book once, the same Book named by both questions.
      if (books.some((held) => ('id' in held && 'id' in book ? held.id === book.id : held === book))) continue
      books.push(book)
    }
    // Her Manual books are hers alone: they join the pool, they never settle a row.
    const best = rankEditions(row, books.filter((book) => book.source !== 'manual').map((book) => ({ book })))[0]?.book
    if (best && settled(row, best)) return answer(best)
  }
  return answer(null)
}

/**
 * When the work was found only in another language than the row's (Open Library's search names one edition a work,
 * in the device's language first, so an English row may meet only its German translation), the Open Library work's
 * editions are asked once (one request, no per-address limit) and ranked in: the row's own language may be there.
 */
async function inRowLanguage(row: ImportBook, found: TitleCandidates, lookups: Lookups, ask: Ask): Promise<TitleCandidates> {
  const best = found.same[0]
  const work = found.same.find((book) => book.openLibraryWorkKey)?.openLibraryWorkKey
  if (!best || !otherLanguage(row, best) || !work || !lookups.search.workEditions) return found
  const editions = await ask((s) => lookups.search.workEditions!({ key: work, authors: row.authors }, { signal: s }))
  if (!editions?.length) return found
  const seen = new Set(found.same.flatMap((book) => editionKeys(book)))
  const more = editions.filter((book) => !editionKeys(book).some((key) => seen.has(key)))
  return { ...found, same: rankEditions(row, [...found.same, ...more].map((book) => ({ book }))).map(({ book }) => book) }
}

/** Finds the edition of one row (see the steps above), with its work's raw genre labels. Rejects only when `signal` aborts. */
export async function findEdition(row: ImportBook, lookups: Lookups, signal?: AbortSignal): Promise<Edition> {
  return withGenres(await editionOf(row, lookups, signal))
}

async function editionOf(row: ImportBook, lookups: Lookups, signal?: AbortSignal): Promise<Edition> {
  let unsure = false
  /** A source other than the Catalogue was asked for this row. */
  let external = false
  const ask = asker(lookups, signal, () => (unsure = true))

  async function byIsbn(isbn: string): Promise<Book | BookSnapshot | null> {
    const stored = await ask((s) => lookups.catalogue.search(isbn, s))
    const known = stored?.find((found) => found.book.isbn13 === isbn)
    if (known) return known.book
    external = true
    // Strict: Apple refusing while Open Library has nothing is no "not found".
    return ask((s) => lookups.search.lookupIsbn(isbn, { signal: s, strict: true }))
  }

  const exact = row.isbn13 ? await byIsbn(row.isbn13) : null
  // The very edition, with its own cover: nothing more to ask.
  if (exact?.coverUrl) return { book: exact, via: 'isbn', unsure: false, ...(!external ? { catalogueOnly: true } : {}) }
  // An ISBN lookup that could not be told is asked again at the end; the work found meanwhile stands.
  const pending = unsure

  // The Catalogue first, by title: its own edition of the row's work, with a cover and in her language, settles the
  // row with nothing else asked: not the other sources' ladder, and not the work's other editions (Choose edition asks
  // for those itself, when it is opened: `choiceCandidates`). For an ISBN the Catalogue holds without a cover, the
  // Catalogue's covered edition of the work is what lends it.
  const catalogued = await catalogueFirst(row, lookups, signal)
  if (catalogued.sure) {
    const alternatives = catalogued.same.slice(0, ALTERNATIVES_KEPT)
    const near = catalogued.near.slice(0, NEAR_KEPT)
    if (exact) {
      return withLentCover({ book: exact, via: 'isbn', unsure: false, alternatives, near, ...(!external ? { catalogueOnly: true } : {}) }, coverLender(row, exact, alternatives))
    }
    const matched: Edition = { book: catalogued.sure, via: 'title', unsure: false, alternatives, near, ...(!external ? { catalogueOnly: true } : {}) }
    return pending ? { ...matched, retry: true } : matched
  }

  const titled = await titleCandidates(row, lookups, signal)
  // The work's other editions are a nicety: one that does not come in time makes the row no less sure.
  const found = await inRowLanguage(row, titled, lookups, asker(lookups, signal, () => {}))
  const alternatives = found.same.slice(0, ALTERNATIVES_KEPT)
  const near = found.near.slice(0, NEAR_KEPT)
  if (exact) {
    // The very edition, without a cover of its own: the work's best one is lent (its ebook first). Its edition is
    // sure; a cover still missing is the cover fill's to find (data/coverFill.ts), the row a look meanwhile.
    return withLentCover({ book: exact, via: 'isbn', unsure: false, alternatives, near }, coverLender(row, exact, alternatives))
  }
  const best = found.same[0]
  if (best) {
    // A real Book of the work, any format, before the file's own row (also for an ISBN no source knows). Found while
    // a source did not answer, it stands only when nothing better can come: its own cover, the row's language, and
    // for an ebook row an Apple Books edition (Apple refusing is how a Kindle row ended on a print edition).
    // Found while a source did not answer: it stands when it will do (a cover shown, the row's language: any format is
    // fine), and is asked again for better (the exact edition, the ebook); without that, the row is unsure.
    const waiting = pending || found.incomplete
    const matched = withLentCover({ book: best, via: 'title', unsure: false, alternatives, near }, coverLender(row, best, alternatives))
    const willDo = Boolean((matched.coverFrom ?? matched.book).coverUrl) && !otherLanguage(row, best)
    if (!waiting) return matched
    if (!willDo) return { ...matched, unsure: true }
    return pending || !settled(row, best) ? { ...matched, retry: true } : matched
  }
  const edition: Edition = { book: bookFromRow(row), via: null, unsure: pending || found.incomplete, alternatives, near }
  if (edition.unsure || !lookups.goodreads || row.source !== 'goodreads') return edition
  // The last resort: Goodreads' cover of the file's own book (its id, else its title and author).
  const answer = await ask((s) => lookups.goodreads!({ title: row.title, authors: row.authors, goodreadsBookId: row.sourceId }, s))
  if (!answer || answer === 'blocked') return edition
  const covered = mergeCover(edition, { ...answer, kind: 'goodreads' })
  return covered ? { ...covered, goodreadsOnly: true } : edition
}

/**
 * The row as the file has it, no source's edition (the choice "Keep as in the
 * file"): the `import` Book of its ISBN or the member's own Manual book, an
 * ISBN no source knows keeping the best edition's cover, as the match does.
 */
export function fileEdition(row: ImportBook, alternatives: readonly (Book | BookSnapshot)[] = []): Edition {
  const own = bookFromRow(row)
  return { book: own, via: null, unsure: false, ...(own.isbn13 ? { coverFrom: coverLender(row, own, alternatives) ?? alternatives[0] ?? null } : {}), alternatives: [...alternatives] }
}

/**
 * Whether a row of the preview is one to look at for sure ("Needs a look"):
 *  - nothing identifies it: no source knows its edition and the file has no
 *    ISBN for it (unless Goodreads knows the file's own book id: `goodreadsOnly`);
 *  - a source could not be asked (`unsure`): a better edition may exist;
 *  - it shows no cover (owner rule: a row without a cover is never "probably
 *    fine"): neither its own nor one the cover ranking lent it from its work
 *    (`coverFrom`, `shown`). The cover fill (data/coverFill.ts) goes on looking
 *    in the background, and a row it finds one for moves out of the list;
 *  - it is not looked up yet.
 * Everything else (found by its ISBN or by its title, an ISBN the file names
 * with a cover) is at most a note ("Probably fine"). Pure.
 */
export function needsLook(
  verdict: 'imported' | 'inLibrary' | 'matched' | 'fromFile' | null,
  shown: Pick<BookSnapshot, 'coverUrl'> | null,
  row: { isbn13?: string | null; unsure?: boolean; goodreadsOnly?: boolean } = {},
): boolean {
  if (row.unsure) return true
  if (verdict === 'fromFile' && !row.isbn13 && !row.goodreadsOnly) return true
  return !shown?.coverUrl
}

/** What the preview says about a row: from the file's own data (`ImportProblem`) or from its match. Copy: `import.note.<code>`. */
export type ReviewNote =
  | ImportProblem
  | { code: 'chosen' }
  | { code: 'chosenInLibrary' }
  | { code: 'fromFile' }
  | { code: 'fromFileIsbn' }
  | { code: 'unsure' }
  | { code: 'unsureFound' }
  | { code: 'noCover' }
  | { code: 'byTitle'; year: number | null; language: string | null }

/** Where a row of the preview goes: not listed (`quiet`), "Probably fine" (a note to read) or "Needs a look". */
export type ReviewTier = 'quiet' | 'probablyFine' | 'needsLook'

export type RowReview = {
  tier: ReviewTier
  /** The edition whose cover the row shows: the one it will be added as, or the one it borrows its cover from. */
  shown: Book | BookSnapshot | null
  /** Her edition is hers to choose (Choose edition): matched by title, without a cover, or only from the file. */
  choose: boolean
  notes: ReviewNote[]
}

/**
 * THE rule of the preview for one row the lookup answered, for the screen and
 * the measurement alike (`matched`: a source's edition; else the file's own
 * row): its notes, the cover it shows, whether Choose edition is offered, and
 * its tier (`needsLook`). Pure.
 */
export function reviewOf(book: Pick<ImportBook, 'title' | 'isbn13' | 'language' | 'problems'>, edition: Edition, matched: boolean): RowReview {
  const verdict = matched ? 'matched' : 'fromFile'
  const notes: ReviewNote[] = []
  if (!matched) notes.push(edition.unsure ? { code: 'unsure' } : edition.book.isbn13 ? { code: 'fromFileIsbn' } : { code: 'fromFile' })
  // Found by title: another edition of the work, which she may want to change after.
  if (matched && edition.via === 'title') notes.push({ code: 'byTitle', year: edition.book.year, language: edition.book.language })
  // Found, while a source could not be asked about its ISBN: asked again, a better edition may come.
  if (matched && edition.unsure) notes.push({ code: 'unsureFound' })
  const shown = edition.coverFrom ?? edition.book
  if (matched && !shown.coverUrl) notes.push({ code: 'noCover' })
  notes.push(...book.problems)
  // Found by title in another language than hers (a translation): the work's own edition may be missing, so she looks.
  const translated = matched && edition.via === 'title' && otherLanguage(book, edition.book)
  const look = translated || needsLook(verdict, shown, { isbn13: edition.book.isbn13 ?? book.isbn13, unsure: edition.unsure, goodreadsOnly: edition.goodreadsOnly })
  const choose = !matched || edition.via === 'title' || !shown.coverUrl
  return { tier: look ? 'needsLook' : notes.length ? 'probablyFine' : 'quiet', shown, choose, notes }
}

/** One row of the choice sheet: the edition, whether the preview has it now, and whether it is the file's own. */
export type EditionChoice = { book: Book | BookSnapshot; current: boolean; file?: boolean }

/**
 * What a member can choose between for a row at first (before the edition
 * search adds its finds): the edition the preview has now (marked), the row as
 * the file has it, then the editions of its work the match found, best fit
 * first (`rankEditions`), then what was close to it (`near`). One row per
 * look: an edition shown already, or one that looks like one, is left out.
 * The file's own row wears the cover of the edition it borrows (`coverFrom`),
 * so it shows what she gets. Pure.
 */
export function editionChoices(row: ImportBook, edition: Edition): EditionChoice[] {
  const alternatives = edition.alternatives ?? []
  const inFile = fileEdition(row, alternatives)
  const lent = (book: Book | BookSnapshot, from: Book | BookSnapshot | null | undefined): Book | BookSnapshot =>
    from && !book.coverUrl ? { ...book, coverUrl: from.coverUrl, coverThumbhash: from.coverThumbhash, coverColors: from.coverColors } : book
  const asFile = edition.via === null
  const choices: EditionChoice[] = asFile
    ? [{ book: lent(edition.book, edition.coverFrom), current: true, file: true }]
    : [{ book: edition.book, current: true }, { book: lent(inFile.book, inFile.coverFrom), current: false, file: true }]
  const keys = new Set(choices.flatMap(({ book }) => editionKeys(book)))
  const looks = new Set(choices.map(({ book }) => editionSignature(book)))
  for (const book of [...alternatives, ...(edition.near ?? [])]) {
    const found = editionKeys(book)
    if (found.some((key) => keys.has(key)) || looks.has(editionSignature(book))) continue
    for (const key of found) keys.add(key)
    looks.add(editionSignature(book))
    choices.push({ book, current: false })
  }
  return choices
}

/** Runs `task` over `items`, at most `limit` at once, in order of the items. */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let next = 0
  async function worker() {
    while (next < items.length) {
      if (signal?.aborted) throw abortError()
      const index = next++
      await task(items[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

/** A paced `fetch`: also says how long a host stays refused (0 when it is not). */
export type PacedFetch = FetchLike & { blockedFor: (host: string) => number }

/**
 * A `fetch` that keeps its distance from hosts that count requests: at least
 * `gapMs` between two requests to one host, and a request the host refused
 * for being too many (403, 429, 503) tried twice more, after `retryMs` and
 * twice that (a `Retry-After` of up to `retryAfterMaxMs` seconds the host names
 * is waited instead, when it asks for more); a host that still refuses is left
 * alone (its requests answer 429 at once) for `cooldownMs`, or, when it named a
 * time, for three times that (at least 15 s), then asked once, and again with
 * the retries when it answers. Apple's
 * Search API allows only a few requests a minute per address before it starts
 * refusing (measured: 429 with `Retry-After: 5…11` after 36 s at 4 requests a
 * second, after 107 s at 40 a minute, none at 20 a minute, usable again within
 * 10 s); a whole Library looked up at once would otherwise lose Apple
 * halfway through.
 */
export function pacedFetch(
  fetch: FetchLike,
  {
    gapMs,
    retryMs = 2000,
    cooldownMs = 60_000,
    retryAfterMaxMs = 30_000,
    now = Date.now,
  }: { gapMs: Record<string, number>; retryMs?: number; cooldownMs?: number; retryAfterMaxMs?: number; now?: () => number },
): PacedFetch {
  const nextAt = new Map<string, number>()
  /** Hosts that kept refusing: asked no more until then, so a refused host costs no time per request (it cost 6 s each, for an hour). */
  const blockedUntil = new Map<string, number>()
  /** Hosts that were blocked and are being tried again: one attempt, no waiting between retries. */
  const probing = new Set<string>()
  const refused = (status: number) => [403, 429, 503].includes(status)
  /** How long the host asked to be left alone (`Retry-After` in seconds), capped; 0 when it said nothing usable. */
  const askedFor = (response: { headers?: { get: (name: string) => string | null } }) => {
    const seconds = Number(response.headers?.get('retry-after'))
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, retryAfterMaxMs) : 0
  }
  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (ms <= 0) return resolve()
      const timer = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(abortError())
      }, { once: true })
    })

  async function turn(host: string, signal?: AbortSignal) {
    const gap = gapMs[host]
    if (!gap) return
    const at = Math.max(now(), nextAt.get(host) ?? 0)
    nextAt.set(host, at + gap)
    await wait(at - now(), signal)
  }

  const paced: PacedFetch = async (url, init) => {
    const host = new URL(url).hostname
    if (gapMs[host] && (blockedUntil.get(host) ?? 0) > now()) return { ok: false, status: 429, json: async () => ({}) }
    await turn(host, init?.signal)
    let response = await fetch(url, init)
    if (gapMs[host] && refused(response.status)) {
      let named = askedFor(response)
      const delays = probing.has(host) ? [] : [retryMs, retryMs * 2]
      for (const delay of delays) {
        await wait(Math.max(delay, named), init?.signal)
        await turn(host, init?.signal)
        response = await fetch(url, init)
        if (!refused(response.status)) break
        named = Math.max(named, askedFor(response))
      }
      if (refused(response.status)) {
        // Still refused after the waits: leave the host alone for a while.
        blockedUntil.set(host, now() + (named ? Math.min(cooldownMs, Math.max(15_000, named * 3)) : cooldownMs))
        probing.add(host)
      } else {
        probing.delete(host)
      }
    } else if (gapMs[host]) {
      probing.delete(host)
    }
    return response
  }
  paced.blockedFor = (host) => Math.max(0, (blockedUntil.get(host) ?? 0) - now())
  return paced
}

// ------------------------------------------------------- what she has already

/**
 * Her Library, ready to answer "does she have this Book?" for a whole file at
 * once: the same Book, ISBN-13 or source id; for a Manual book, the same
 * title and first author.
 */
export function libraryIndex(entries: readonly LibraryEntry[]): (book: Book | BookSnapshot) => LibraryEntry | null {
  const byKey = new Map<string, LibraryEntry>()
  const manualKey = (book: Pick<BookSnapshot, 'title' | 'authors'>) => `manual:${normalise(book.title)}|${normalise(book.authors[0] ?? '')}`
  for (const entry of entries) {
    const theirs = entry.book
    byKey.set(`id:${theirs.id}`, entry)
    if (theirs.source === 'manual') {
      byKey.set(manualKey(theirs), entry)
      continue
    }
    if (theirs.isbn13) byKey.set(`isbn:${theirs.isbn13}`, entry)
    if (theirs.appleId) byKey.set(`apple:${theirs.appleId}`, entry)
    if (theirs.openLibraryEditionKey) byKey.set(`ol:${theirs.openLibraryEditionKey}`, entry)
  }
  return (book) => {
    if ('id' in book) return byKey.get(`id:${book.id}`) ?? null
    if (book.source === 'manual') return byKey.get(manualKey(book)) ?? null
    const keys = [
      book.isbn13 && `isbn:${book.isbn13}`,
      book.appleId && `apple:${book.appleId}`,
      book.openLibraryEditionKey && `ol:${book.openLibraryEditionKey}`,
    ]
    for (const key of keys) if (key && byKey.has(key)) return byKey.get(key)!
    return null
  }
}

/**
 * Her Library, ready to answer "does she have this row's book, under any
 * edition?" (issue #104): an entry whose Book has the same work title (brackets
 * and subtitle dropped) and an author with the first author's surname. After
 * Change edition the entry holds another edition than the file's ISBN finds,
 * so the Book itself no longer matches (`libraryIndex`). For a finished row
 * that has an end day, her entry's latest read must not have ended on another
 * day; an entry without a read, or a read without a day, still matches. The
 * database applies the same rule (`import_books`), so this only spares the
 * lookups. Edited dates, or a title she changed, may still import a second
 * entry: accepted, her own edit. An entry imported from one of the file's
 * other rows of the work (`otherKeys`, looked up in `imported`: key → entry
 * id) is another edition she shelved and never matches (#111).
 */
export function libraryTitleIndex(
  entries: readonly LibraryEntry[],
  imported: ReadonlyMap<string, string> = new Map(),
): (row: Pick<ImportBook, 'title' | 'authors' | 'status' | 'session' | 'otherKeys'>) => LibraryEntry | null {
  const byTitle = new Map<string, LibraryEntry[]>()
  for (const entry of entries) {
    const key = workTitle(entry.book.title)
    if (key) byTitle.set(key, [...(byTitle.get(key) ?? []), entry])
  }
  return (row) => {
    const candidates = byTitle.get(workTitle(row.title))
    if (!candidates) return null
    const wanted = surname(row.authors[0])
    const endedOn = row.status === 'finished' ? row.session?.endedOn : null
    const siblings = new Set((row.otherKeys ?? []).map((key) => imported.get(key)).filter(Boolean))
    return (
      candidates.find((entry) => {
        if (siblings.has(entry.id)) return false
        // Another volume of the same series shares the work title ("Heartstopper: Volume Two").
        if (!sameVolume(row.title, entry.book.title)) return false
        if (wanted && !entry.book.authors.some((name) => surname(name) === wanted)) return false
        const ended = entry.latestSession?.endedOn
        return !(endedOn && ended && ended !== endedOn)
      }) ?? null
    )
  }
}

/** The member's entry for one Book, if she has it (`libraryIndex`). */
export function entryFor(book: Book | BookSnapshot, entries: readonly LibraryEntry[]): LibraryEntry | null {
  return libraryIndex(entries)(book)
}

// ----------------------------------------------------------------- writing

/**
 * One row as `import_books` takes it: the file's row, the Book it found, the
 * Collections she chose for its shelves, and another edition's Book whose
 * cover it takes when its own finds none.
 */
export type ImportRow = Pick<ImportBook, 'key' | 'status' | 'session' | 'addedOn' | 'title' | 'authors' | 'extraReads' | 'pageCount' | 'otherKeys'> &
  Partial<Pick<ImportBook, 'earlierReads'>> & {
    book: Book | BookSnapshot
    collections?: readonly string[]
    coverFrom?: Book | BookSnapshot | null
    /** The cover came from the cover fill (see `Edition.filled`). */
    coverFilled?: boolean
  }

export type RowOutcome = {
  key: string
  /** added · imported (this row was imported before) · in_library (she has the Book) · failed. */
  outcome: 'added' | 'imported' | 'in_library' | 'failed'
  entryId: string | null
  error: LibraryErrorCode | 'key_invalid' | null
}

/** A row as the `import_books` argument: the Book by id when it has one, else its snapshot, and the file's title and first author. */
export function importArguments(row: ImportRow) {
  const { book, session } = row
  return {
    key: row.key,
    // The file's own words, for the book she has under another edition (#104).
    file_title: row.title,
    file_author: row.authors[0] ?? null,
    // The file's other rows of this work: other editions she shelved (#111).
    other_keys: row.otherKeys,
    ...('id' in book ? { book_id: book.id } : { book: bookToRow(book) }),
    status: row.status,
    started_on: session?.startedOn ?? null,
    ended_on: session?.endedOn ?? null,
    rating: session?.rating ?? null,
    review: session?.review ?? null,
    outcome: session?.outcome === 'abandoned' ? 'abandoned' : null,
    added_on: row.addedOn,
    // Her earlier reads (undated: Read Count; dated: several reads), her page count, her shelves (#111).
    extra_reads: row.extraReads,
    earlier_reads: (row.earlierReads ?? []).map((read) => ({ started_on: read.startedOn, ended_on: read.endedOn })),
    page_count: row.pageCount,
    collections: row.collections ?? [],
  }
}

type RawOutcome = { key: string; outcome: RowOutcome['outcome']; entry_id?: string; error?: string }

/** Writes up to 100 rows in one call; each row's outcome, in order. */
export async function writeRows(client: SupabaseClient, rows: readonly ImportRow[]): Promise<Result<RowOutcome[]>> {
  const { data, error } = await client.rpc('import_books', { p_rows: rows.map(importArguments) })
  if (error) return { data: null, error: mapLibraryError(error) }
  return {
    data: (data as RawOutcome[]).map((raw) => ({
      key: raw.key,
      outcome: raw.outcome,
      entryId: raw.entry_id ?? null,
      error: raw.outcome === 'failed' ? (raw.error === 'key_invalid' ? 'key_invalid' : mapLibraryError({ message: raw.error })) : null,
    })),
    error: null,
  }
}

/**
 * Every entry the member imported from a supported app's export before (any of
 * them): its key → the entry's id. Asked page by page (the API answers 1,000
 * rows a request), so a library of any size is known whole.
 */
export async function importedKeys(client: SupabaseClient): Promise<Result<Map<string, string>>> {
  const keys = new Map<string, string>()
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await client
      .from('library_entries')
      .select('id, import_key')
      .not('import_key', 'is', null)
      .order('id')
      .range(from, from + page - 1)
      .returns<{ id: string; import_key: string }[]>()
    if (error) return { data: null, error: mapLibraryError(error) }
    for (const row of data) {
      if (SUPPORTED_SOURCES.some((source) => row.import_key.startsWith(`${source}:`))) keys.set(row.import_key, row.id)
    }
    if (data.length < page) return { data: keys, error: null }
  }
}

/** How many covers one `fill_book_covers` call takes. */
const COVER_FILL_CALL = 200

/**
 * A Catalogue Book that entered without a cover keeps none for every member after her (the Catalogue
 * keeps the first snapshot): a cover this import found, or resolved for a Book that was there bare, is
 * handed to `fill_book_covers`, which gives it to a Book without one only (a cover that is there stays), if
 * she holds the Book and the address is on the allow-list. A failure here costs nothing: the import is written.
 */
export async function fillCatalogueCovers(client: SupabaseClient, books: readonly (Book | BookSnapshot)[]): Promise<void> {
  const covers = books.flatMap((book) =>
    book.source === 'manual' || !book.coverUrl || (!('id' in book) && !book.isbn13)
      ? []
      : [
          {
            ...('id' in book ? { book_id: book.id } : { isbn13: book.isbn13 }),
            cover_url: book.coverUrl,
            cover_thumbhash: book.coverThumbhash,
            cover_dominant: book.coverColors?.dominant ?? null,
            cover_secondary: book.coverColors?.secondary ?? null,
          },
        ],
  )
  for (let from = 0; from < covers.length; from += COVER_FILL_CALL) {
    try {
      await client.rpc('fill_book_covers', { p_covers: covers.slice(from, from + COVER_FILL_CALL) })
    } catch {
      /* a cover is a nicety: the rows are written */
    }
  }
}

/**
 * A Book new to the Catalogue gets its Cover first (as on add); a Book with an id or a Manual book goes as it is.
 * A cover the cover fill found (it has its thumbhash: data/coverFill.ts) is not resolved again.
 */
export async function withCover(
  book: Book | BookSnapshot,
  probe: ProbeImage,
  coverFrom?: Book | BookSnapshot | null,
): Promise<Book | BookSnapshot> {
  if ('id' in book || book.source === 'manual') return book
  if (book.coverUrl && book.coverThumbhash) return book
  const own = await resolveBookCover(book, { probe })
  if (own.coverUrl || !coverFrom) return { ...book, ...own }
  // Nothing for its own ISBN: the same work's edition lends its cover.
  const lent =
    'id' in coverFrom || (coverFrom.coverUrl && coverFrom.coverThumbhash)
      ? { coverUrl: coverFrom.coverUrl, coverThumbhash: coverFrom.coverThumbhash, coverColors: coverFrom.coverColors }
      : await resolveBookCover(coverFrom, { probe })
  return { ...book, ...(lent.coverUrl ? lent : own) }
}

/** Waits `ms` (nothing for 0), or rejects when `signal` aborts. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    if (ms <= 0) return resolve()
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(timer), reject(abortError())), { once: true })
  })
}

/** What Choose edition offers beyond the match's own finds: its work's editions, best first, then the close ones. `failed`: a source could not be asked and nothing is there. */
export type ChoiceCandidates = { editions: (Book | BookSnapshot)[]; failed: boolean }

/**
 * Choose edition's list for a row, from the match's own pool and ranking: every
 * question of the ladder (`titleCandidates`), then the Open Library work's
 * editions (the edition's work, else one its finds name); the row's work best
 * first (`rankEditions`), the work's editions under another title (a
 * translation) after them, then what is close (`nearEditions`). Rejects only
 * when `signal` aborts.
 */
export async function choiceCandidates(row: ImportBook, edition: Edition, lookups: Lookups, signal?: AbortSignal): Promise<ChoiceCandidates> {
  const found = await titleCandidates(row, lookups, signal, { all: true })
  const work =
    edition.book.openLibraryWorkKey ?? [...(edition.alternatives ?? []), ...found.same].find((book) => book.openLibraryWorkKey)?.openLibraryWorkKey ?? null
  let fromWork: BookSnapshot[] = []
  let workFailed = false
  if (work && lookups.search.workEditions) {
    try {
      fromWork = await lookups.search.workEditions({ key: work, authors: row.authors }, { signal })
    } catch {
      if (signal?.aborted) throw abortError()
      workFailed = true
    }
  }
  const same = rankEditions(row, [...found.same, ...fromWork].map((book) => ({ book }))).map(({ book }) => book)
  const translated = fromWork
    .filter((book) => !same.includes(book))
    .map((book, order) => ({ book, order, fit: editionFit(row, book) }))
    .sort((a, b) => b.fit - a.fit || a.order - b.order)
    .map(({ book }) => book)
  const seen = new Set<string>()
  const editions = [...same, ...translated, ...found.near].filter((book) => {
    const keys = editionKeys(book)
    if (keys.some((key) => seen.has(key))) return false
    for (const key of keys) seen.add(key)
    return true
  })
  return { editions, failed: !editions.length && (found.incomplete || workFailed) }
}

/** Title questions whose answers one import keeps (a file of 709 rows asks about 2,000). */
export const ANSWERS_KEPT = 5000

/**
 * The lookups with the title questions' answers kept: a question every source
 * answered is not asked again within the import (the second pass, Choose
 * edition's ladder), so Apple's per-address limit is spent once per question.
 * An answer with a source missing is not kept: asking again is the point.
 */
export function rememberingAnswers(lookups: Lookups): Lookups {
  const kept = new Map<string, SearchOutcome>()
  const search: Lookups['search']['search'] = async (query, options = {}) => {
    const key = `${(options.sources ?? []).join(',')}|${query.trim().toLowerCase().replace(/\s+/g, ' ')}`
    const known = kept.get(key)
    if (known) return known
    const outcome = await lookups.search.search(query, options)
    if (!outcome.failed && !outcome.unanswered?.length) {
      if (kept.size >= ANSWERS_KEPT) kept.delete(kept.keys().next().value!)
      kept.set(key, outcome)
    }
    return outcome
  }
  // The Catalogue's answer for an ISBN is kept too: `match` asks for the whole file's ISBNs before it primes Apple
  // with the ones the Catalogue lacks, and each row's own lookup then meets the same answer.
  const isbns = new Map<string, Found[]>()
  const catalogue: Lookups['catalogue']['search'] = async (query, signal) => {
    const isbn = parseIsbn(query)
    if (!isbn) return lookups.catalogue.search(query, signal)
    const known = isbns.get(isbn)
    if (known) return known
    const found = await lookups.catalogue.search(query, signal)
    if (isbns.size >= ANSWERS_KEPT) isbns.delete(isbns.keys().next().value!)
    isbns.set(isbn, found)
    return found
  }
  return { ...lookups, catalogue: { ...lookups.catalogue, search: catalogue }, search: { ...lookups.search, search } }
}

export type BookImport = {
  /** Finds every row's edition, a few at a time; `onEdition` as each is found. Rejects only when `signal` aborts. */
  match: (
    rows: readonly ImportBook[],
    options: {
      signal?: AbortSignal
      onEdition: (index: number, edition: Edition) => void
      /** The second, slower pass over the rows a source could not be asked about: how many it has, and how far it is. */
      onSecondPass?: (done: number, total: number) => void
      /** Aborting this ends the second pass only: what the first found stays, the rest keeps its first answer. */
      secondPassSignal?: AbortSignal
      /** How long the second pass may run (`SECOND_PASS_BUDGET_MS`). */
      secondPassBudgetMs?: number
    },
  ) => Promise<void>
  /** Choose edition's finds for a row, through the same lookups, pool and ranking as the match (`choiceCandidates`). */
  candidates: (row: ImportBook, edition: Edition, options?: { signal?: AbortSignal }) => Promise<ChoiceCandidates>
  /**
   * Resolves the Covers and writes the rows, a few per call; `onWritten` with
   * each call's outcomes. A call that fails ends the import with its error
   * (what was written stays written: importing again picks up the rest).
   */
  write: (
    rows: readonly ImportRow[],
    options: {
      onWritten: (outcomes: RowOutcome[]) => void
      /** Asked for each row just before its chunk's covers are resolved: what the cover fill found since (data/coverFill.ts). */
      refresh?: (row: ImportRow) => ImportRow
    },
  ) => Promise<Result<RowOutcome[]>>
}

export function createBookImport(
  client: SupabaseClient,
  { lookups: given, probe, online = () => true }: { lookups: Lookups; probe: ProbeImage } & WriteOptions,
): BookImport {
  const lookups = rememberingAnswers(given)
  return {
    async match(rows, { signal, onEdition, onSecondPass, secondPassSignal, secondPassBudgetMs = SECOND_PASS_BUDGET_MS }) {
      const retry: number[] = []
      const first = new Map<number, Edition>()
      // Apple's answers for every ISBN of the file, a few batch requests at once (instead of two requests a row):
      // not for an ISBN the Catalogue holds with a cover, which settles its row without Apple (`catalogueOnly`).
      const isbnRows = rows.flatMap((row) => (row.isbn13 ? [{ isbn13: row.isbn13, title: row.title, authors: row.authors }] : []))
      const primed = (async () => {
        if (!lookups.search.primeIsbns || !isbnRows.length) return
        const ask = asker(lookups, signal, () => {})
        const held = isbnRows.map(() => false)
        await eachLimited(isbnRows, IMPORT_CONCURRENCY, async (row, index) => {
          const found = await ask((s) => lookups.catalogue.search(row.isbn13, s))
          held[index] = Boolean(found?.some(({ book }) => book.isbn13 === row.isbn13 && book.coverUrl))
        })
        const unknown = isbnRows.filter((_, index) => !held[index])
        if (unknown.length) await lookups.search.primeIsbns(unknown, (row, book) => isSameWork(row, book), { signal })
      })().catch(() => {})
      // The rows without an ISBN first: they need no batch answer and are looked up while it comes.
      const order = rows.map((_, index) => index).sort((a, b) => Number(Boolean(rows[a]!.isbn13)) - Number(Boolean(rows[b]!.isbn13)) || a - b)
      await eachLimited(
        order,
        IMPORT_CONCURRENCY,
        async (index) => {
          const row = rows[index]!
          if (row.isbn13) await primed
          const edition = await findEdition(row, lookups, signal)
          // Only what a source could not be asked about is asked again: a row every source answered is final.
          if (edition.unsure || edition.retry) retry.push(index)
          first.set(index, edition)
          onEdition(index, edition)
        },
        signal,
      )
      // Once more, slower, for rows a source could not be asked about (it
      // refused a burst, answered late or failed), once the paced host lets us
      // back (`busyFor`). Counted aloud (`onSecondPass`) and stoppable on its
      // own (`secondPassSignal`): the first answers are final then.
      const again = retry.sort((a, b) => a - b)
      if (!again.length) return
      const second = new AbortController()
      const stop = () => second.abort()
      signal?.addEventListener('abort', stop, { once: true })
      secondPassSignal?.addEventListener('abort', stop, { once: true })
      if (secondPassSignal?.aborted) stop()
      const budget = setTimeout(stop, secondPassBudgetMs)
      let done = 0
      onSecondPass?.(0, again.length)
      try {
        await eachLimited(
          again,
          Math.max(1, IMPORT_CONCURRENCY / 2),
          async (index) => {
            await pause(lookups.busyFor?.() ?? 0, second.signal)
            const edition = await findEdition(rows[index]!, lookups, second.signal)
            // A second answer that is no better (unsure again, or nothing, where the first had found the work) leaves the first.
            const before = first.get(index)
            if (!(before?.via && (edition.unsure || !edition.via))) onEdition(index, edition)
            onSecondPass?.(++done, again.length)
          },
          second.signal,
        )
      } catch (error) {
        // Only the second pass was stopped: the first pass's answers stand.
        if (signal?.aborted || !second.signal.aborted) throw error
      } finally {
        clearTimeout(budget)
        signal?.removeEventListener('abort', stop)
        secondPassSignal?.removeEventListener('abort', stop)
      }
    },
    async candidates(row, edition, { signal } = {}) {
      return choiceCandidates(row, edition, lookups, signal)
    },

    async write(rows, { onWritten, refresh }) {
      const outcomes: RowOutcome[] = []
      // The covers of a chunk are resolved all at once, and those of the next chunk
      // while this one is written: the image probes (a download and a decode each)
      // were what made a long import take minutes after "Import" was pressed.
      const covered = async (start: number): Promise<ImportRow[]> => {
        const chunk = rows.slice(start, start + IMPORT_CHUNK).map((row) => refresh?.(row) ?? row)
        await eachLimited(chunk, IMPORT_CHUNK, async (row, index) => {
          chunk[index] = { ...row, book: await withCover(row.book, probe, row.coverFrom).catch(() => row.book) }
        })
        return chunk
      }
      // The covers of the rows written, for the Catalogue Books that have none yet (`fillCatalogueCovers`).
      const coverOf = new Map<string, Book | BookSnapshot>()
      const settle = async (result: Result<RowOutcome[]>): Promise<Result<RowOutcome[]>> => {
        const failed = new Set(outcomes.filter((outcome) => outcome.outcome === 'failed').map((outcome) => outcome.key))
        await fillCatalogueCovers(client, [...coverOf].filter(([key]) => !failed.has(key)).map(([, book]) => book))
        return result
      }
      let next = rows.length ? covered(0) : null
      for (let start = 0; start < rows.length; start += IMPORT_CHUNK) {
        if (!online()) return settle({ data: null, error: 'offline' })
        const chunk = await next!
        next = start + IMPORT_CHUNK < rows.length ? covered(start + IMPORT_CHUNK) : null
        const written = await writeRows(client, chunk)
        if (written.error) return settle(written)
        outcomes.push(...written.data)
        // A snapshot may have met a Catalogue Book that is bare; a Catalogue Book only gets what the fill found for it.
        for (const row of chunk) if (row.book.coverUrl && (!('id' in row.book) || row.coverFilled)) coverOf.set(row.key, row.book)
        onWritten(written.data)
      }
      return settle({ data: outcomes, error: null })
    },
  }
}
