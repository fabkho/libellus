import type { SupabaseClient } from '@supabase/supabase-js'
import type { Book, BookSnapshot } from './books'
import type { CatalogueSearch } from './catalogueSearch'
import { resolveBookCover, type ProbeImage } from './covers'
import { abortError, type FetchLike } from './fetching'
import { bookFromRow, isSameWork, titleQuery, GOODREADS_KEY_PREFIX, type GoodreadsBook } from './import/goodreads'
import { bookToRow, mapLibraryError, type LibraryEntry, type LibraryErrorCode, type Result, type WriteOptions } from './library'
import { normalise } from './merge'
import type { Search } from './search'

/**
 * Importing a Goodreads export in the app (issue #40), after the file is read
 * (data/import/goodreads.ts): finding each book's edition the way search does,
 * and writing the rows.
 *
 * Finding an edition, per row, the first that answers:
 *   1. the Catalogue by its ISBN (a Book some member added before);
 *   2. Apple Books, then OpenLibrary, by its ISBN (the exact edition);
 *   3. a title + author search over all three, taking only a result of the
 *      same work (`isSameWork`): another edition of the same book;
 *   4. the file's own fields: an `import` Book keyed by its ISBN, or without
 *      one a Manual book of the member's (`bookFromRow`).
 * Rows are looked up a few at a time (`concurrency`), each source call with a
 * deadline, so a slow network slows the import down instead of stopping it; a
 * row nothing was found for is tried once more at the end (a source may have
 * refused a burst or answered too late), then falls back to step 4, and says
 * so when a source could not be asked (`unsure`).
 *
 * Writing: the Cover of each Book that is new to the Catalogue is resolved
 * first (as on add, data/covers.ts), then a few rows go to `import_books` per
 * call (the rules are the database's: supabase/migrations/*_import_books.sql).
 * Each row's key (`goodreads:<Book Id>`) is stored on its entry and session,
 * so the same file twice adds nothing.
 *
 * Framework-free: the Supabase client, the search repositories and the image
 * probe come in from outside.
 */

/** Rows looked up at once. */
export const IMPORT_CONCURRENCY = 4

/** Rows written per call. */
export const IMPORT_CHUNK = 10

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
}

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
export async function findEdition(row: GoodreadsBook, lookups: Lookups, signal?: AbortSignal): Promise<Edition> {
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

  const isbn = row.isbn13
  if (isbn) {
    const stored = await ask((s) => lookups.catalogue.search(isbn, s))
    const known = stored?.find((found) => found.book.isbn13 === isbn)
    if (known) return { book: known.book, via: 'isbn', unsure: false }
    const edition = await ask((s) => lookups.search.lookupIsbn(isbn, { signal: s }))
    if (edition) return { book: edition, via: 'isbn', unsure: false }
  }

  const outcome = await ask((s) => lookups.search.search(titleQuery(row), { signal: s }))
  if (outcome?.failed) unsure = true
  const same = outcome?.results.find((result) => isSameWork(row, result.book))
  if (same) return { book: same.book, via: 'title', unsure: false }

  return { book: bookFromRow(row), via: null, unsure }
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

/**
 * A `fetch` that keeps its distance from hosts that count requests: at least
 * `gapMs` between two requests to one host, and a request the host refused
 * for being too many (403, 429, 503) tried twice more, after `retryMs` and
 * twice that. Apple's
 * Search API allows only a few requests a minute per address before it starts
 * refusing; a whole Library looked up at once would otherwise lose Apple
 * halfway through.
 */
export function pacedFetch(fetch: FetchLike, { gapMs, retryMs = 2000 }: { gapMs: Record<string, number>; retryMs?: number }): FetchLike {
  const nextAt = new Map<string, number>()
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
    const now = Date.now()
    const at = Math.max(now, nextAt.get(host) ?? 0)
    nextAt.set(host, at + gap)
    await wait(at - now, signal)
  }

  return async (url, init) => {
    const host = new URL(url).hostname
    await turn(host, init?.signal)
    let response = await fetch(url, init)
    for (const delay of [retryMs, retryMs * 2]) {
      if (![403, 429, 503].includes(response.status) || !gapMs[host]) break
      await wait(delay, init?.signal)
      await turn(host, init?.signal)
      response = await fetch(url, init)
    }
    return response
  }
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

/** The member's entry for one Book, if she has it (`libraryIndex`). */
export function entryFor(book: Book | BookSnapshot, entries: readonly LibraryEntry[]): LibraryEntry | null {
  return libraryIndex(entries)(book)
}

// ----------------------------------------------------------------- writing

/** One row as `import_books` takes it. */
export type ImportRow = Pick<GoodreadsBook, 'key' | 'status' | 'session' | 'addedOn'> & { book: Book | BookSnapshot }

export type RowOutcome = {
  key: string
  /** added · imported (this row was imported before) · in_library (she has the Book) · failed. */
  outcome: 'added' | 'imported' | 'in_library' | 'failed'
  entryId: string | null
  error: LibraryErrorCode | 'key_invalid' | null
}

/** A row as the `import_books` argument: the Book by id when it has one, else its snapshot. */
export function importArguments(row: ImportRow) {
  const { book, session } = row
  return {
    key: row.key,
    ...('id' in book ? { book_id: book.id } : { book: bookToRow(book) }),
    status: row.status,
    started_on: session?.startedOn ?? null,
    ended_on: session?.endedOn ?? null,
    rating: session?.rating ?? null,
    review: session?.review ?? null,
    added_on: row.addedOn,
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

/** The keys of every entry the member imported from Goodreads before. */
export async function importedKeys(client: SupabaseClient): Promise<Result<Set<string>>> {
  const { data, error } = await client
    .from('library_entries')
    .select('import_key')
    .like('import_key', `${GOODREADS_KEY_PREFIX}%`)
    .returns<{ import_key: string }[]>()
  if (error) return { data: null, error: mapLibraryError(error) }
  return { data: new Set(data.map((row) => row.import_key)), error: null }
}

/** A Book new to the Catalogue gets its Cover first (as on add); a Book with an id or a Manual book goes as it is. */
export async function withCover(book: Book | BookSnapshot, probe: ProbeImage): Promise<Book | BookSnapshot> {
  if ('id' in book || book.source === 'manual') return book
  return { ...book, ...(await resolveBookCover(book, { probe })) }
}

export type GoodreadsImport = {
  /** Finds every row's edition, a few at a time; `onEdition` as each is found. Rejects only when `signal` aborts. */
  match: (
    rows: readonly GoodreadsBook[],
    options: { signal?: AbortSignal; onEdition: (index: number, edition: Edition) => void },
  ) => Promise<void>
  /**
   * Resolves the Covers and writes the rows, a few per call; `onWritten` with
   * each call's outcomes. A call that fails ends the import with its error
   * (what was written stays written: importing again picks up the rest).
   */
  write: (rows: readonly ImportRow[], options: { onWritten: (outcomes: RowOutcome[]) => void }) => Promise<Result<RowOutcome[]>>
}

export function createGoodreadsImport(
  client: SupabaseClient,
  { lookups, probe, online = () => true }: { lookups: Lookups; probe: ProbeImage } & WriteOptions,
): GoodreadsImport {
  return {
    async match(rows, { signal, onEdition }) {
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
      await eachLimited(
        retry.sort((a, b) => a - b),
        Math.max(1, IMPORT_CONCURRENCY / 2),
        async (index) => onEdition(index, await findEdition(rows[index]!, lookups, signal)),
        signal,
      )
    },

    async write(rows, { onWritten }) {
      const outcomes: RowOutcome[] = []
      for (let start = 0; start < rows.length; start += IMPORT_CHUNK) {
        if (!online()) return { data: null, error: 'offline' }
        const chunk = [...rows.slice(start, start + IMPORT_CHUNK)]
        await eachLimited(chunk, IMPORT_CONCURRENCY, async (row, index) => {
          chunk[index] = { ...row, book: await withCover(row.book, probe) }
        })
        const written = await writeRows(client, chunk)
        if (written.error) return written
        outcomes.push(...written.data)
        onWritten(written.data)
      }
      return { data: outcomes, error: null }
    },
  }
}
