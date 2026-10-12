import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from './books'
import type { CatalogueSearch } from './catalogueSearch'
import { resolveBookCover, type ProbeImage } from './covers'
import { abortError, type FetchLike } from './fetching'
import { SUPPORTED_SOURCES } from './import/detect'
import { editionSignature } from './editions'
import { bookFromRow, rankEditions, sameVolume, titleQuery } from './import/editions'
import type { ImportBook } from './import/rows'
import { surname, workTitle } from './import/readingTracker'
import { bookToRow, mapLibraryError, type LibraryEntry, type LibraryErrorCode, type Result, type WriteOptions } from './library'
import { editionKeys, normalise } from './merge'
import type { Search } from './search'

/**
 * Importing an export in the app (issues #40, #111), after the file is read
 * and its app detected (data/import/detect.ts → the normalised rows of
 * data/import/rows.ts): finding each book's edition the way search does, and
 * writing the rows. Nothing here knows which app wrote the file.
 *
 * Finding an edition, per row, the first that answers (#111: the exact edition
 * the member shelved, not just the same work):
 *   1. by its ISBN: the Catalogue (a Book some member added before), then
 *      Apple Books, then OpenLibrary;
 *   2. a title + author search over all three, taking the result of the same
 *      work (`isSameWork`) whose edition fits the row best (`pickEdition`:
 *      the file's language (else told from the title), page count, format,
 *      year; all from the file itself, no app's book pages, #155);
 *   3. the file's own fields: an `import` Book keyed by its ISBN, or without
 *      one a Manual book of the member's (`bookFromRow`). A row whose ISBN no
 *      source knows stays that exact edition even when a title search finds
 *      the work: the work's edition only lends it its cover (`coverFrom`).
 * Rows are looked up a few at a time (`concurrency`), each source call with a
 * deadline, so a slow network slows the import down instead of stopping it; a
 * row nothing was found for is tried once more at the end (a source may have
 * refused a burst or answered too late), then falls back to step 3, and says
 * so when a source could not be asked (`unsure`).
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
  /** Another edition of the same work, whose cover the file's own Book takes when its ISBN finds none. */
  coverFrom?: Book | BookSnapshot | null
  /** The cover fill found its cover (data/coverFill.ts): for a Catalogue Book it is handed to `fill_book_covers` once written. */
  filled?: boolean
  /**
   * The other editions of the row's work its title search found, best fit
   * first (the order the match was picked in): what the preview offers when
   * the member chooses another edition herself. Kept only for a row not found
   * by its ISBN; at most `ALTERNATIVES_KEPT`.
   */
  alternatives?: (Book | BookSnapshot)[]
}

/** Alternatives kept per row (a file can be thousands of rows). */
export const ALTERNATIVES_KEPT = 20

export type Lookups = {
  catalogue: Pick<CatalogueSearch, 'search'>
  search: Pick<Search, 'lookupIsbn' | 'search'>
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

/** Finds the edition of one row (see the steps above). Rejects only when `signal` aborts. */
export async function findEdition(row: ImportBook, lookups: Lookups, signal?: AbortSignal): Promise<Edition> {
  const timeout = lookups.timeoutMs ?? LOOKUP_TIMEOUT_MS
  let unsure = false
  async function ask<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    try {
      return await withDeadline(timeout, signal, task)
    } catch {
      if (signal?.aborted) throw abortError()
      unsure = true
      return null
    }
  }

  async function byIsbn(isbn: string): Promise<Book | BookSnapshot | null> {
    const stored = await ask((s) => lookups.catalogue.search(isbn, s))
    const known = stored?.find((found) => found.book.isbn13 === isbn)
    if (known) return known.book
    return ask((s) => lookups.search.lookupIsbn(isbn, { signal: s }))
  }

  if (row.isbn13) {
    const exact = await byIsbn(row.isbn13)
    if (exact) return { book: exact, via: 'isbn', unsure: false }
  }

  const outcome = await ask((s) => lookups.search.search(titleQuery(row), { signal: s }))
  if (outcome?.failed) unsure = true
  let ranked = outcome ? rankEditions(row, outcome.results).map((result) => result.book) : []
  // An author written with initials ("H.D. Carlton") is no word OpenLibrary's text search finds
  // the book by: asked again with the title and the surname alone (what the match checks anyway).
  const lastName = surname(row.authors[0])
  if (!ranked.length && !outcome?.failed && lastName) {
    const retry = `${row.title} ${lastName}`.trim()
    if (retry.toLowerCase() !== titleQuery(row).toLowerCase()) {
      const again = await ask((s) => lookups.search.search(retry, { signal: s }))
      if (again?.failed) unsure = true
      if (again) ranked = rankEditions(row, again.results).map((result) => result.book)
    }
  }
  const alternatives = ranked.slice(0, ALTERNATIVES_KEPT)
  const same = ranked[0] ?? null
  const own = bookFromRow(row)
  // An ISBN no source knows is still the edition she shelved: hers, with the work's cover.
  if (own.isbn13) return { book: own, via: null, unsure, coverFrom: same, alternatives }
  if (same) return { book: same, via: 'title', unsure: false, alternatives }
  return { book: own, via: null, unsure, alternatives }
}

/**
 * The row as the file has it, no source's edition (the choice "Keep as in the
 * file"): the `import` Book of its ISBN or the member's own Manual book, an
 * ISBN no source knows keeping the best edition's cover, as the match does.
 */
export function fileEdition(row: ImportBook, alternatives: readonly (Book | BookSnapshot)[] = []): Edition {
  const own = bookFromRow(row)
  return { book: own, via: null, unsure: false, ...(own.isbn13 ? { coverFrom: alternatives[0] ?? null } : {}), alternatives: [...alternatives] }
}

/**
 * Whether a row of the preview is one to look at for sure: nothing identifies it
 * (no source knows its edition and the file has no ISBN for it, or a source could
 * not be asked: a better edition may exist), or it is not looked up yet. A row a
 * source found, or whose ISBN the file names, is identified: a missing cover is a
 * quiet note (`import.note.noCover`), never a review item. The cover fill
 * (data/coverFill.ts) looks for it in the background and the Book is added
 * without one when none is found; the wrong edition would not show in its cover
 * anyway, the member sees the edition's facts when she opens Choose edition.
 */
export function needsLook(
  verdict: 'imported' | 'inLibrary' | 'matched' | 'fromFile' | null,
  shown: Pick<BookSnapshot, 'coverUrl'> | null,
  row: { isbn13?: string | null; unsure?: boolean } = {},
): boolean {
  if (verdict === 'fromFile') return !row.isbn13 || Boolean(row.unsure)
  if (verdict === 'matched') return false
  return !shown?.coverUrl
}

/** One row of the choice sheet: the edition, whether the preview has it now, and whether it is the file's own. */
export type EditionChoice = { book: Book | BookSnapshot; current: boolean; file?: boolean }

/**
 * What a member can choose between for a row at first (before the edition
 * search adds its finds): the edition the preview has now (marked), the row as
 * the file has it, then the editions its match found, best fit first. One row
 * per look: an edition shown already, or one that looks like one, is left out.
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
  for (const book of alternatives) {
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

export type BookImport = {
  /** Finds every row's edition, a few at a time; `onEdition` as each is found. Rejects only when `signal` aborts. */
  match: (
    rows: readonly ImportBook[],
    options: {
      signal?: AbortSignal
      onEdition: (index: number, edition: Edition) => void
      /** The second, slower pass over the rows the first found nothing for: how many it has, and how far it is. */
      onSecondPass?: (done: number, total: number) => void
      /** Aborting this ends the second pass only: what the first found stays, the rest keeps its first answer. */
      secondPassSignal?: AbortSignal
      /** How long the second pass may run (`SECOND_PASS_BUDGET_MS`). */
      secondPassBudgetMs?: number
    },
  ) => Promise<void>
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
  { lookups, probe, online = () => true }: { lookups: Lookups; probe: ProbeImage } & WriteOptions,
): BookImport {
  return {
    async match(rows, { signal, onEdition, onSecondPass, secondPassSignal, secondPassBudgetMs = SECOND_PASS_BUDGET_MS }) {
      const retry: number[] = []
      await eachLimited(
        rows,
        IMPORT_CONCURRENCY,
        async (row, index) => {
          const edition = await findEdition(row, lookups, signal)
          if (edition.unsure || !edition.via) retry.push(index)
          onEdition(index, edition)
        },
        signal,
      )
      // Once more, slower, for rows nothing found or nothing could be asked
      // about: a source that refused a burst or answered late may answer now.
      // Counted aloud (`onSecondPass`) and stoppable on its own
      // (`secondPassSignal`): the first answers are final then.
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
            const edition = await findEdition(rows[index]!, lookups, second.signal)
            onEdition(index, edition)
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
