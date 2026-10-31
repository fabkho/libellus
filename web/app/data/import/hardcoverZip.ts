import { strFromU8, unzip, type UnzipFileInfo } from 'fflate'
import { plainText } from '../apple.ts'
import type { EntryStatus } from '../library.ts'
import { authorsOfCredits, seriesWithPosition, type Credit } from './hardcover.ts'
import { languageCode } from './editions.ts'
import { splitSeriesTitle } from './readingTracker.ts'
import {
  clipReview,
  collectBooks,
  collectionNames,
  HardcoverZipError,
  importDay,
  importKey,
  importRating,
  isbnPair,
  MAX_EXTRA_READS,
  splitRatingReview,
  tidy,
  yearOf,
  type CoverHint,
  type ImportBook,
  type ImportFile,
  type ImportProblem,
  type ImportProgress,
  type ImportRead,
  type ImportSession,
  type SkippedRow,
} from './rows.ts'

/**
 * The Hardcover "everything" zip (plan: docs/plans/hardcover-zip.md): Settings → Export your data → Everything (zip). Its
 * `manifest.json` says `"format": "hardcover-everything", "version": 1`; the export's own README.md documents every file and field.
 *
 * Two pure steps, so the unzip can be loaded on its own (importUpload.ts imports this module only when a zip is picked):
 * - `readHardcoverZip(bytes)`: the zip's bytes → the JSON files the import needs, with limits. Only those entries are inflated.
 * - `mapHardcoverExport(export, today)`: the files → `ImportFile`, one row per book of her library and one per book that is only
 *   on one of her lists. Every rule reuses the CSV adapter's helpers (hardcover.ts, rows.ts), so the two cannot drift.
 *
 * What the zip adds to a row: `session.progress`, `coverHint`, and, on the file, `collectionOrder` and `emptyCollections`. The upload
 * carries all but `coverHint` to the job (importUpload.ts; the cover address waits for the plan's PR 3).
 */

// ------------------------------------------------------------------ reading

/** Against zip bombs and memory. The real export (a few hundred kB, 66 entries, 2 MB inflated) is far below every one. */
export const ZIP_LIMITS = {
  /** The file itself. */
  file: 50 * 1024 * 1024,
  /** Entries in the central directory. */
  entries: 1000,
  /** One admitted entry's declared (inflated) size. */
  entry: 64 * 1024 * 1024,
  /** The admitted entries' declared sizes together. */
  total: 160 * 1024 * 1024,
  /** The manifest alone (a few kB in a real export). */
  manifest: 1024 * 1024,
} as const

/** The format the manifest names, and the one version read. */
export const ZIP_FORMAT = 'hardcover-everything'
export const ZIP_VERSION = 1

/** The files read besides the manifest; one missing is `zipMissing`. */
const NEEDED = [
  'user_books',
  'user_book_reads',
  'books',
  'editions',
  'lists',
  'list_books',
  'book_series',
  'series',
  'publishers',
  'languages',
] as const

/** Read only when an edition's and its book's `cached_contributors` are both empty. A missing one is no error. */
const FALLBACK = ['contributions', 'authors'] as const

type Rec = Record<string, unknown>

/** The files of an export, read. Arrays of the export's own records; their fields are checked when mapped. */
export type HardcoverExport = {
  manifest: { userId: number | null }
  userBooks: Rec[]
  userBookReads: Rec[]
  books: Rec[]
  editions: Rec[]
  lists: Rec[]
  listBooks: Rec[]
  bookSeries: Rec[]
  series: Rec[]
  publishers: Rec[]
  languages: Rec[]
  /** Only when some book has no contributors of its own cached; else empty. */
  contributions: Rec[]
  authors: Rec[]
}

const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Runs fflate's async unzip (large entries are inflated on a worker, off the main thread). `filter` decides which entries are
 * inflated at all; the central directory is read either way, every entry passing the filter once.
 */
function unzipping(bytes: Uint8Array, filter: (file: UnzipFileInfo) => boolean): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    try {
      unzip(bytes, { filter }, (error, files) => (error ? reject(error) : resolve(files)))
    } catch (error) {
      reject(error)
    }
  })
}

/** An entry at the root or one folder deep (a member who zipped the folder again), never a macOS resource fork. */
function locate(names: readonly string[], file: string): string | null {
  const at = (name: string) => !name.startsWith('__MACOSX/') && !/(^|\/)\._/.test(name)
  const root = names.find((name) => name === file)
  if (root) return root
  return names.find((name) => at(name) && new RegExp(`^[^/]+/${file.replace('.', '\\.')}$`).test(name)) ?? null
}

function parse(data: Uint8Array | undefined): unknown {
  if (!data) throw new HardcoverZipError('unreadable')
  try {
    return JSON.parse(strFromU8(data))
  } catch {
    throw new HardcoverZipError('unreadable')
  }
}

/**
 * The zip's bytes → the files the import needs. Throws `HardcoverZipError`.
 *
 * The limits are checked on the declared sizes before anything is inflated. fflate inflates each entry into a buffer of its
 * declared size: an entry that really holds more is cut at that size without an error (measured, tests/import-hardcover-zip.test.ts),
 * so memory stays within the declared sizes, and the cut JSON then fails to parse: `unreadable`.
 */
export async function readHardcoverZip(bytes: Uint8Array): Promise<HardcoverExport> {
  if (bytes.length > ZIP_LIMITS.file) throw new HardcoverZipError('zipTooBig')

  // 1. The central directory: names and declared sizes, nothing inflated.
  const entries: Pick<UnzipFileInfo, 'name' | 'originalSize'>[] = []
  let count = 0
  try {
    await unzipping(bytes, (file) => {
      if (++count <= ZIP_LIMITS.entries) entries.push({ name: file.name, originalSize: file.originalSize })
      return false
    })
  } catch {
    throw new HardcoverZipError('unreadable')
  }
  if (count > ZIP_LIMITS.entries) throw new HardcoverZipError('zipTooBig')
  const names = entries.map((entry) => entry.name)

  // 2. The manifest: which export, which version.
  const manifestName = locate(names, 'manifest.json')
  if (!manifestName) throw new HardcoverZipError('zipUnknown')
  const folder = manifestName.slice(0, manifestName.length - 'manifest.json'.length)
  const declared = (name: string) => entries.filter((entry) => entry.name === name).reduce((sum, entry) => sum + entry.originalSize, 0)
  if (declared(manifestName) > ZIP_LIMITS.manifest) throw new HardcoverZipError('zipTooBig')
  const manifest = parse((await extract(bytes, [manifestName]))[manifestName])
  if (!isRec(manifest) || manifest.format !== ZIP_FORMAT) throw new HardcoverZipError('zipUnknown')
  if (manifest.version !== ZIP_VERSION) throw new HardcoverZipError('zipVersion')

  // 3. The files, their declared sizes against the limits, then inflated.
  const path = (file: string) => `${folder}${file}.json`
  const missing = NEEDED.filter((file) => !names.includes(path(file))).map((file) => `${file}.json`)
  if (missing.length) throw new HardcoverZipError('zipMissing', missing)
  const check = (files: readonly string[]) => {
    const sizes = files.map((file) => declared(path(file)))
    if (sizes.some((size) => size > ZIP_LIMITS.entry) || sizes.reduce((sum, size) => sum + size, 0) > ZIP_LIMITS.total) {
      throw new HardcoverZipError('zipTooBig')
    }
  }
  check(NEEDED)
  const read = async (files: readonly string[]): Promise<Record<string, Rec[]>> => {
    const inflated = await extract(bytes, files.map(path))
    return Object.fromEntries(
      files.map((file) => {
        const value = parse(inflated[path(file)])
        if (!Array.isArray(value)) throw new HardcoverZipError('unreadable')
        return [file, value.filter(isRec)]
      }),
    )
  }
  const files = await read(NEEDED)

  // 4. Only when a book has no contributors cached, the credits behind them (the manifest's own total still bounds the two).
  const exp: HardcoverExport = {
    manifest: { userId: whole(manifest.user_id) },
    userBooks: files.user_books!,
    userBookReads: files.user_book_reads!,
    books: files.books!,
    editions: files.editions!,
    lists: files.lists!,
    listBooks: files.list_books!,
    bookSeries: files.book_series!,
    series: files.series!,
    publishers: files.publishers!,
    languages: files.languages!,
    contributions: [],
    authors: [],
  }
  const fallback = FALLBACK.filter((file) => names.includes(path(file)))
  if (fallback.length === FALLBACK.length && needsCredits(exp)) {
    check([...NEEDED, ...FALLBACK])
    const more = await read(FALLBACK)
    exp.contributions = more.contributions!
    exp.authors = more.authors!
  }
  return exp
}

/** The entries named, inflated (those only). */
async function extract(bytes: Uint8Array, names: readonly string[]): Promise<Record<string, Uint8Array>> {
  const wanted = new Set(names)
  try {
    return await unzipping(bytes, (file) => wanted.has(file.name))
  } catch {
    throw new HardcoverZipError('unreadable')
  }
}

// ------------------------------------------------------------------ values

/** A whole number from a JSON number or a string of digits; else null. */
function whole(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  return typeof value === 'string' && /^-?\d{1,15}$/.test(value.trim()) ? Number(value) : null
}

/** A whole number above 0 (and, with `max`, no more than it). A zero is never trusted: `progress_seconds` is 0, not null, on print reads. */
function positiveWhole(value: unknown, max = Number.MAX_SAFE_INTEGER): number | null {
  const number = whole(value)
  return number !== null && number > 0 && number <= max ? number : null
}

/** A number from a JSON number or a decimal string (`"4.5"`); else null. */
function decimal(value: unknown): number | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) ? number : null
}

const text = (value: unknown): string => (typeof value === 'string' ? tidy(value) : '')

/** The page numbers the database accepts (`import_books` drops others). */
const MAX_PAGES = 99_999

// ---- covers

/** The one host a cover hint may name, and the least short side it may have (px): below it the image is a thumbnail. */
export const COVER_HINT_HOST = 'assets.hardcover.app'
export const COVER_HINT_MIN_SIDE = 150

/** What a cover address of the export comes to: kept as a hint, too small, on another host, or none. */
export type CoverVerdict = 'kept' | 'small' | 'otherHost' | 'none'

/** `cached_image` (`{id, url, width, height, color, color_name}`) → a hint, or why not. */
export function judgeCover(image: unknown): { hint: CoverHint | null; verdict: CoverVerdict } {
  if (!isRec(image) || typeof image.url !== 'string' || !image.url) return { hint: null, verdict: 'none' }
  let url: URL
  try {
    url = new URL(image.url)
  } catch {
    return { hint: null, verdict: 'otherHost' }
  }
  if (url.protocol !== 'https:' || url.hostname !== COVER_HINT_HOST || url.port || url.username || url.password || image.url.length > 500) {
    return { hint: null, verdict: 'otherHost' }
  }
  const width = positiveWhole(image.width)
  const height = positiveWhole(image.height)
  if (!width || !height || Math.min(width, height) < COVER_HINT_MIN_SIDE) return { hint: null, verdict: 'small' }
  return { hint: { url: url.href, width, height }, verdict: 'kept' }
}

// ------------------------------------------------------------------ mapping

/** The README's fixed ids (user_book_statuses.json), constants here, not read. */
const STATUS: Readonly<Record<number, string>> = {
  1: 'Want to Read',
  2: 'Currently Reading',
  3: 'Read',
  4: 'Paused',
  5: 'Did Not Finish',
  6: 'Ignored',
}

/** reading_formats.json: 1 Read, 2 Listened, 3 Both, 4 Ebook. */
const READING_FORMAT_BINDING: Readonly<Record<number, string>> = { 2: 'Audiobook', 4: 'Ebook' }

/** One read of an entry, its days checked. */
type Read = {
  startedOn: string | null
  endedOn: string | null
  /** Has a finish (a day, or the precision 0: finished, when unknown). */
  finished: boolean
  pausedOn: string | null
  editionId: number | null
  pages: number | null
  percent: number | null
  seconds: number | null
}

type Edition = { rec: Rec; id: number }

/**
 * Whether a row's authors need `contributions.json` and `authors.json`: `authorsOf` takes the edition the row is written with, else
 * the book's own, else those files. So a book with no cached contributors needs them when an edition the row may use has none (or it
 * has no edition). Over-reads when a better candidate comes first, never under-reads.
 */
function needsCredits(exp: HardcoverExport): boolean {
  const index = indexOf(exp)
  const credited = (rec: Rec) => Array.isArray(rec.cached_contributors) && rec.cached_contributors.length > 0
  const needs = (bookId: number | null, editionIds: readonly (number | null)[]) => {
    const book = bookId === null ? undefined : index.books.get(bookId)
    if (!book || credited(book)) return false
    const editions = [...editionIds, whole(book.default_physical_edition_id)].flatMap((id) => {
      const rec = id === null ? undefined : index.editions.get(id)
      return rec && (whole(rec.book_id) === null || whole(rec.book_id) === bookId) ? [rec] : []
    })
    return editions.length === 0 || editions.some((edition) => !credited(edition))
  }
  return (
    exp.userBooks.some((entry) => {
      const reads = index.readsOf.get(whole(entry.id) ?? -1) ?? []
      return needs(whole(entry.book_id), [whole(entry.edition_id), ...reads.map((read) => whole(read.edition_id))])
    }) ||
    exp.listBooks.some((entry) => needs(whole(entry.book_id), [whole(entry.edition_id)]))
  )
}

/** The export's records indexed for the mapping. */
function indexOf(exp: HardcoverExport) {
  const byId = (rows: Rec[]) => new Map(rows.flatMap((rec) => (whole(rec.id) === null ? [] : [[whole(rec.id)!, rec] as const])))
  const group = (rows: Rec[], key: string) => {
    const map = new Map<number, Rec[]>()
    for (const rec of rows) {
      const id = whole(rec[key])
      if (id !== null) map.set(id, [...(map.get(id) ?? []), rec])
    }
    return map
  }
  const credits = new Map<string, Rec[]>()
  for (const rec of exp.contributions) {
    const key = `${text(rec.contributable_type)}:${whole(rec.contributable_id)}`
    credits.set(key, [...(credits.get(key) ?? []), rec])
  }
  return {
    books: byId(exp.books),
    editions: byId(exp.editions),
    publishers: byId(exp.publishers),
    languages: byId(exp.languages),
    series: byId(exp.series),
    authors: byId(exp.authors),
    credits,
    readsOf: group(exp.userBookReads, 'user_book_id'),
    seriesOf: group(exp.bookSeries, 'book_id'),
  }
}

type Index = ReturnType<typeof indexOf>

/** Credits of a record: its `cached_contributors`, as names with roles. */
function cachedCredits(rec: Rec | undefined): Credit[] {
  if (!rec || !Array.isArray(rec.cached_contributors)) return []
  return rec.cached_contributors.flatMap((entry): Credit[] => {
    if (!isRec(entry) || !isRec(entry.author)) return []
    const name = text(entry.author.name)
    return name ? [{ name, role: text(entry.contribution) || null }] : []
  })
}

/** The edition's authors, else the book's, else `contributions` + `authors` (the edition's credits first, then the book's). */
function authorsOf(index: Index, book: Rec, edition: Rec | null): string[] {
  const own = cachedCredits(edition ?? undefined)
  if (own.length) return authorsOfCredits(own)
  const works = cachedCredits(book)
  if (works.length) return authorsOfCredits(works)
  for (const [type, id] of [['Edition', edition ? whole(edition.id) : null], ['Book', whole(book.id)]] as const) {
    if (id === null) continue
    const found = (index.credits.get(`${type}:${id}`) ?? []).flatMap((credit): Credit[] => {
      const author = index.authors.get(whole(credit.author_id) ?? -1)
      const name = author ? text(author.name) : ''
      return name ? [{ name, role: text(credit.contribution) || null }] : []
    })
    if (found.length) return authorsOfCredits(found)
  }
  return []
}

/** The book's series: the featured one, else the first; `Name, #n`. */
function seriesOf(index: Index, bookId: number): string | null {
  const links = index.seriesOf.get(bookId) ?? []
  const link = links.find((one) => one.featured === true) ?? links[0]
  const series = link ? index.series.get(whole(link.series_id) ?? -1) : null
  return series ? seriesWithPosition(text(series.name), decimal(link!.position)) : null
}

/** The edition of a row: the first candidate that is an edition of this book. */
function pickEdition(index: Index, bookId: number, candidates: readonly (number | null)[]): Edition | null {
  for (const id of candidates) {
    const rec = id === null ? undefined : index.editions.get(id)
    if (rec && (whole(rec.book_id) === null || whole(rec.book_id) === bookId)) return { rec, id: id! }
  }
  return null
}

/**
 * Where an open (or given-up) read stands, the first that applies: a page (not past the row's page count), else a percent
 * strictly between 0 and 100, else seconds of the audiobook's length as a percent; 0 and 100 are not progress.
 */
function progressOf(read: Read, pageCount: number | null, audioSeconds: number | null): ImportProgress | null {
  if (read.pages !== null && pageCount !== null && read.pages <= pageCount) return { page: read.pages }
  const percent = (value: number) => {
    const whole = Math.round(value)
    return whole >= 1 && whole <= 99 ? { percent: whole } : null
  }
  if (read.percent !== null && read.percent > 0 && read.percent < 100) return percent(read.percent)
  if (read.seconds !== null && audioSeconds !== null && read.seconds < audioSeconds) return percent((read.seconds / audioSeconds) * 100)
  return null
}

/** Told, per row, what became of its cover address. */
export type CoverCount = (kind: 'library' | 'listOnly', verdict: CoverVerdict) => void

/** The Collections a row of the file is on, from her lists. */
type Lists = {
  /** Her lists' names, once each (any case). */
  names: string[]
  /** book id → names of her lists that hold it, in the lists' order. */
  byBook: Map<number, string[]>
  /** book id → the books that are only on lists: the edition of the first entry that names one, the earliest day added. */
  entries: { book: number; edition: number | null; addedOn: string | null }[]
  /** Her ranked lists: name → book ids in rank order (position, nulls last, then day added). */
  ranked: Map<string, number[]>
}

function readLists(exp: HardcoverExport, owner: number | null, today: string): Lists {
  const names = collectionNames(exp.lists.flatMap((list) => (isHers(list, owner) ? [text(list.name)] : [])))
  const canonical = new Map(names.map((name) => [name.toLowerCase(), name]))
  const byBook = new Map<number, string[]>()
  const only = new Map<number, { book: number; edition: number | null; addedOn: string | null }>()
  const ranked = new Map<string, number[]>()
  for (const list of exp.lists) {
    const id = whole(list.id)
    const name = isHers(list, owner) ? canonical.get(text(list.name).toLowerCase()) : undefined
    if (id === null || !name) continue
    const entries = exp.listBooks
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => whole(entry.list_id) === id && whole(entry.book_id) !== null)
    if (list.ranked === true) {
      const rank = (one: { entry: Rec; index: number }) => whole(one.entry.position) ?? Number.POSITIVE_INFINITY
      const added = (one: { entry: Rec }) => text(one.entry.date_added)
      entries.sort((a, b) => (rank(a) === rank(b) ? added(a).localeCompare(added(b)) || a.index - b.index : rank(a) < rank(b) ? -1 : 1))
      ranked.set(name, [...(ranked.get(name) ?? []), ...entries.map(({ entry }) => whole(entry.book_id)!)])
    }
    for (const { entry } of entries) {
      const book = whole(entry.book_id)!
      const on = byBook.get(book) ?? []
      if (!on.includes(name)) byBook.set(book, [...on, name])
      const day = importDay(text(entry.date_added), today)
      const added = day === 'invalid' ? null : day
      const seen = only.get(book)
      only.set(book, {
        book,
        edition: seen?.edition ?? whole(entry.edition_id),
        addedOn: [seen?.addedOn, added].filter((one): one is string => Boolean(one)).sort()[0] ?? null,
      })
    }
  }
  return { names, byBook, entries: [...only.values()], ranked }
}

/** A list of hers: the export also holds lists of others she only contributed to. */
const isHers = (list: Rec, owner: number | null) => owner !== null && whole(list.user_id) === owner

/**
 * The export, mapped: one row per entry of `user_books` (its reads, rating, review, edition and her lists), then one per book
 * that is only on a list of hers (Want to read, problem `fromList`). Pure: the same export and day always give the same file.
 * `onCover`, when given, is told what became of each row's cover address (the counts script, scripts/import-zip-counts.ts).
 */
export function mapHardcoverExport(exp: HardcoverExport, today: string, onCover?: CoverCount): ImportFile {
  const index = indexOf(exp)
  const owner = exp.manifest.userId ?? whole(exp.userBooks[0]?.user_id)
  const lists = readLists(exp, owner, today)

  const mapped: (ImportBook | SkippedRow)[] = []
  const shelved = new Set<number>()
  for (const entry of exp.userBooks) {
    const book = whole(entry.book_id)
    const row = mapEntry(index, lists, entry, mapped.length + 1, today, onCover)
    // An entry she keeps off her shelves (Ignored, no status) is no shelved book: on a list, it is a list-only one (option A).
    if (book !== null && !('problem' in row && row.problem.code === 'notShelved')) shelved.add(book)
    mapped.push(row)
  }
  // Books that are only on her lists: Want to read, each in its Collections.
  for (const only of lists.entries) {
    if (shelved.has(only.book)) continue
    mapped.push(mapListOnly(index, lists, only, mapped.length + 1, onCover))
  }

  const file = collectBooks('hardcover', mapped)
  // Ranked lists keep their order; lists without a book still become Collections. Only rows the file has count.
  const keyOf = new Map<number, string>()
  for (const book of file.books) if (book.sourceId) keyOf.set(Number(book.sourceId), book.key)
  const hers = new Set(file.books.flatMap((book) => book.shelves.map((name) => name.toLowerCase())))
  const collectionOrder = [...lists.ranked]
    .map(([name, books]) => ({ name, keys: [...new Set(books.flatMap((book) => keyOf.get(book) ?? []))] }))
    .filter((order) => order.keys.length)
  const limited = limitLists(collectionOrder, lists.names.filter((name) => !hers.has(name.toLowerCase())))
  file.collectionOrder = limited.collectionOrder
  file.emptyCollections = limited.emptyCollections
  return file
}

/**
 * What `start_import_job` takes of the lists (20261111010000_import_zip_job.sql: at most 500 lists, 10,000 keys a list, 1 MB): a
 * file over it is trimmed here (lists past the limits lose their rank or their Collection) instead of letting the server refuse the
 * whole job with `collections_invalid`. The byte cap is under the server's, because the database counts its own binary form.
 */
export const LIST_LIMITS = { lists: 500, keys: 10_000, bytes: 700_000 } as const

export function limitLists(
  order: { name: string; keys: string[] }[],
  empty: string[],
): { collectionOrder: { name: string; keys: string[] }[]; emptyCollections: string[] } {
  const ranked: { name: string; keys: string[] }[] = []
  let bytes = 0
  for (const list of order.slice(0, LIST_LIMITS.lists)) {
    const trimmed = { name: list.name, keys: list.keys.slice(0, LIST_LIMITS.keys) }
    const size = JSON.stringify(trimmed).length
    if (bytes + size > LIST_LIMITS.bytes) break
    bytes += size
    ranked.push(trimmed)
  }
  return { collectionOrder: ranked, emptyCollections: empty.slice(0, LIST_LIMITS.lists) }
}

/** The days, kept apart from the problems of a row. */
function reader(today: string, problems: ImportProblem[]) {
  return (value: unknown): string | null => {
    const day = importDay(typeof value === 'string' ? value : '', today)
    if (day !== 'invalid') return day
    if (!problems.some((problem) => problem.code === 'dateInvalid')) problems.push({ code: 'dateInvalid' })
    return null
  }
}

/** The reads of an entry, oldest first (undated ones first): precision decides which day a finish is. */
function readsOf(index: Index, entryId: number | null, day: (value: unknown) => string | null, problems: ImportProblem[]): Read[] {
  const reads = (entryId === null ? [] : (index.readsOf.get(entryId) ?? [])).map((rec): Read => {
    const precision = whole(rec.finished_at_precision)
    const given = typeof rec.finished_at === 'string' && rec.finished_at.trim() !== ''
    let endedOn = precision === 0 ? null : day(rec.finished_at)
    // Hardcover writes the first day of the month or year; a day inside it is moved there.
    if (endedOn && precision === 2) endedOn = `${endedOn.slice(0, 7)}-01`
    if (endedOn && precision === 3) endedOn = `${endedOn.slice(0, 4)}-01-01`
    let startedOn = day(rec.started_at)
    // A month or a year is no day: a start inside it is the more exact word, so the finish is not moved before it.
    const period = precision === 2 ? startedOn?.slice(0, 7) : precision === 3 ? startedOn?.slice(0, 4) : undefined
    if (startedOn && endedOn && period && endedOn < startedOn && endedOn.startsWith(period)) endedOn = startedOn
    if (startedOn && endedOn && endedOn < startedOn) {
      problems.push({ code: 'dateInvalid' })
      startedOn = null
    }
    return {
      startedOn,
      endedOn,
      finished: given || precision === 0,
      pausedOn: day(rec.paused_at),
      editionId: whole(rec.edition_id),
      pages: positiveWhole(rec.progress_pages, MAX_PAGES),
      percent: decimal(rec.progress),
      seconds: positiveWhole(rec.progress_seconds),
    }
  })
  const at = (read: Read) => read.endedOn ?? read.startedOn ?? ''
  return reads.sort((a, b) => at(a).localeCompare(at(b)))
}

/** An entry of her library as a row, or why it is none. */
function mapEntry(index: Index, lists: Lists, entry: Rec, number: number, today: string, onCover?: CoverCount): ImportBook | SkippedRow {
  const problems: ImportProblem[] = []
  const bookId = whole(entry.book_id)
  const book = bookId === null ? undefined : index.books.get(bookId)
  const statusId = whole(entry.status_id)
  const shelf = statusId === null ? '' : (STATUS[statusId] ?? '')
  const entryId = whole(entry.id)
  const day = reader(today, problems)
  const reads = readsOf(index, entryId, day, problems)

  const edition = book && bookId !== null ? pickEdition(index, bookId, [whole(entry.edition_id), reads.at(-1)?.editionId ?? null, whole(book.default_physical_edition_id)]) : null
  const rawTitle = text(edition?.rec.title) || text(book?.title)
  if (!book || bookId === null || !rawTitle) return { row: number, title: rawTitle, problem: { code: 'noTitle' } }
  const { title, seriesTitle } = splitSeriesTitle(rawTitle)
  if (!shelf || shelf === 'Ignored') return { row: number, title, problem: { code: 'notShelved' } }

  const addedOn = day(entry.date_added)
  const { verdict, ...common } = describe(index, book, bookId, edition?.rec ?? null, title, seriesTitle)
  onCover?.('library', verdict)

  // Rating and review: only a finished read keeps them.
  let rating = importRating(typeof entry.rating === 'number' ? String(entry.rating) : text(entry.rating))
  if (rating === undefined) {
    problems.push({ code: 'ratingInvalid' })
    rating = null
  }
  const markdown = typeof entry.review_markdown === 'string' ? plainText(entry.review_markdown) : null
  const raw = typeof entry.review_raw === 'string' ? tidyReview(entry.review_raw) : null
  const html = typeof entry.review === 'string' ? plainText(entry.review) : null
  const split = splitRatingReview(markdown ?? raw ?? html, rating, problems)
  rating = split.rating
  const review = clipReview(split.review, problems)

  let status: EntryStatus
  let session: ImportSession | null = null
  let earlierReads: ImportRead[] = []
  let extraReads = 0
  const pastReads = (finished: readonly Read[]) => {
    const dated = finished.filter((read) => read.startedOn || read.endedOn)
    extraReads = finished.length - dated.length
    return dated.map((read): ImportRead => ({ startedOn: read.startedOn, endedOn: read.endedOn })).slice(-MAX_EXTRA_READS)
  }
  const open = [...reads].reverse().find((read) => !read.finished) ?? null
  const pages = common.pageCount
  const progress = (read: Read | null) => (read ? progressOf(read, pages, positiveWhole(edition?.rec.audio_seconds) ?? positiveWhole(book.audio_seconds)) : null)

  if (shelf === 'Read') {
    status = 'finished'
    const finished = reads.filter((read) => read.finished)
    const last = finished.at(-1) ?? reads.at(-1) ?? null
    session = { startedOn: last?.startedOn ?? null, endedOn: last?.endedOn ?? null, outcome: 'finished', rating, review, progress: null }
    earlierReads = pastReads(finished.slice(0, -1))
  } else if (shelf === 'Did Not Finish') {
    status = 'finished'
    const last = open ?? reads.at(-1) ?? null
    if (rating !== null) problems.push({ code: 'abandonedRating' })
    // The day she gave up: the finish, else the pause, else none.
    const endedOn = last?.endedOn ?? last?.pausedOn ?? null
    let startedOn = last?.startedOn ?? null
    if (startedOn && endedOn && endedOn < startedOn) {
      problems.push({ code: 'dateInvalid' })
      startedOn = null
    }
    session = { startedOn, endedOn, outcome: 'abandoned', rating: null, review, progress: progress(last) }
    earlierReads = pastReads(reads.filter((read) => read !== last && read.finished))
  } else if (shelf === 'Currently Reading' || shelf === 'Paused') {
    status = 'reading'
    if (shelf === 'Paused') problems.push({ code: 'paused' })
    session = { startedOn: open?.startedOn ?? addedOn ?? today, endedOn: null, outcome: null, rating: null, review: null, progress: progress(open) }
    earlierReads = pastReads(reads.filter((read) => read !== open && read.finished && (!read.endedOn || read.endedOn <= session!.startedOn!)))
    if (rating !== null || review) problems.push({ code: 'notFinishedRating' })
  } else {
    status = 'want_to_read'
    if (rating !== null || review) problems.push({ code: 'notFinishedRating' })
  }
  if (earlierReads.length) problems.push({ code: 'earlierReads', count: earlierReads.length })
  if (extraReads) problems.push({ code: 'extraReads', count: extraReads })

  const shelves = collectionNames([...(lists.byBook.get(bookId) ?? []), ...(entry.owned === true ? ['Owned'] : [])])
  return {
    source: 'hardcover',
    key: importKey('hardcover', String(bookId), common),
    sourceId: String(bookId).length <= 12 ? String(bookId) : null,
    row: number,
    ...common,
    shelf,
    shelves,
    status,
    session,
    earlierReads,
    extraReads,
    otherKeys: [],
    addedOn,
    problems,
  }
}

/** A book that is only on one of her lists, as a Want to read row. */
function mapListOnly(index: Index, lists: Lists, only: Lists['entries'][number], number: number, onCover?: CoverCount): ImportBook | SkippedRow {
  const book = index.books.get(only.book)
  const edition = book ? pickEdition(index, only.book, [only.edition, whole(book.default_physical_edition_id)]) : null
  const rawTitle = text(edition?.rec.title) || text(book?.title)
  if (!book || !rawTitle) return { row: number, title: rawTitle, problem: { code: 'noTitle' } }
  const { title, seriesTitle } = splitSeriesTitle(rawTitle)
  // Its Collections are the only reason to add it: a list whose name makes no Collection (over 80 characters) never brings one.
  const shelves = lists.byBook.get(only.book) ?? []
  const { verdict, ...common } = describe(index, book, only.book, edition?.rec ?? null, title, seriesTitle)
  onCover?.('listOnly', verdict)
  return {
    source: 'hardcover',
    key: importKey('hardcover', String(only.book), common),
    sourceId: String(only.book).length <= 12 ? String(only.book) : null,
    row: number,
    ...common,
    shelf: 'Want to Read',
    shelves,
    status: 'want_to_read',
    session: null,
    earlierReads: [],
    extraReads: 0,
    otherKeys: [],
    addedOn: only.addedOn,
    problems: [{ code: 'fromList' }],
  }
}

/** A review in the export's raw text, as it is: lines kept, a blank one is none. */
const tidyReview = (value: string): string | null => value.replace(/\r\n?/g, '\n').trim() || null

/** What describes the book itself, from the edition and the book (the same for a library row and a list-only one). */
function describe(index: Index, book: Rec, bookId: number, edition: Rec | null, title: string, seriesTitle: string | null) {
  const { isbn13, isbn10 } = isbnPair(text(edition?.isbn_13), text(edition?.isbn_10))
  const readingFormat = whole(edition?.reading_format_id)
  const language = edition ? index.languages.get(whole(edition.language_id) ?? -1) : undefined
  const publisher = edition ? index.publishers.get(whole(edition.publisher_id) ?? -1) : undefined
  const releaseYear = (rec: Rec | null) => yearOf(String(whole(rec?.release_year) ?? '')) ?? yearOf(text(rec?.release_date).slice(0, 4))
  const originalYear = yearOf(String(whole(book.release_year) ?? ''))
  // The edition's image, else the book's (an edition image that is too small is not swapped for the book's: it is the edition she has).
  const cover = judgeCover(edition && isRec(edition.cached_image) ? edition.cached_image : book.cached_image)
  return {
    verdict: cover.verdict,
    title: title.slice(0, 500),
    series: seriesOf(index, bookId) ?? seriesTitle,
    authors: authorsOf(index, book, edition),
    isbn13,
    isbn10,
    pageCount: positiveWhole(edition?.pages, MAX_PAGES) ?? positiveWhole(book.pages, MAX_PAGES),
    year: releaseYear(edition) ?? originalYear,
    originalYear,
    binding: text(edition?.edition_format) || (readingFormat !== null ? (READING_FORMAT_BINDING[readingFormat] ?? null) : null),
    language: languageCode(text(language?.code2)),
    publisher: text(publisher?.name) || null,
    coverHint: cover.hint,
  }
}
