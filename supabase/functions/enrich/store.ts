/**
 * The function's side of the database: the queue and the stored results, all
 * through the service-role RPCs of supabase/migrations/…_enrichment_queue.sql
 * and the readable tables. `createMemoryStore` stands in for the tests.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { GenreSignal, RankedGenre } from '../../../web/app/data/enrich/genres.ts'
import type { AuthorRef, BookRow, Payload } from './enrich.ts'

/** Facts older than this are fetched again. */
export const TTL_MS = 30 * 24 * 60 * 60 * 1000

export type StaleAuthor = { id: string; wikidata_id: string | null; openlibrary_key: string | null; name: string }

export type Store = {
  /** Claims up to `limit` due Books from the queue (with `bookId`, that one only). */
  claim: (limit: number, bookId?: string) => Promise<BookRow[]>
  save: (payload: Payload) => Promise<void>
  failed: (bookId: string, error: string) => Promise<void>
  authorFresh: (ref: AuthorRef) => Promise<boolean>
  seriesFresh: (wikidata: string) => Promise<boolean>
  staleAuthors: (limit: number) => Promise<StaleAuthor[]>
  authorByKey: (key: string) => Promise<StaleAuthor & { fetched_at: string | null } | null>
  /** Queues a Catalogue Book on a member's behalf; false when there is no such Book. */
  request: (bookId: string) => Promise<boolean>
  /** Books whose genres an older mapping computed, with their kept signals. */
  remapCandidates: (version: number, limit: number) => Promise<{ book_id: string; signals: GenreSignal[] }[]>
  saveGenres: (bookId: string, genres: (RankedGenre & { rank: number })[], version: number) => Promise<void>
  backfill: (limit: number | null) => Promise<number>
  status: () => Promise<Record<string, number>>
}

const BOOK_COLUMNS = 'id,title,authors,isbn13,isbn10,language,apple_id,openlibrary_edition_key,openlibrary_work_key'

function fresh(at: string | null | undefined, now: number): boolean {
  return Boolean(at) && now - Date.parse(at!) < TTL_MS
}

export function createSupabaseStore(supabase: SupabaseClient, now: () => number = () => Date.now()): Store {
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.rpc(name, args)
    if (error) throw new Error(`${name}: ${error.message}`)
    return data as T
  }

  return {
    async claim(limit, bookId) {
      const rows = await rpc<BookRow[]>('enrich_claim', { p_limit: limit, p_book: bookId ?? null })
      return (rows ?? []).map((row) => pick(row))
    },
    async save(payload) {
      await rpc('enrich_save', { p_payload: payload })
    },
    async failed(bookId, error) {
      await rpc('enrich_failed', { p_book: bookId, p_error: error })
    },
    async authorFresh(ref) {
      const filters = [
        ref.wikidata ? `wikidata_id.eq.${ref.wikidata}` : null,
        ref.openlibrary ? `openlibrary_key.eq.${ref.openlibrary}` : null,
      ].filter(Boolean)
      if (!filters.length) return true
      const { data, error } = await supabase.from('authors').select('fetched_at,works_fetched_at').or(filters.join(','))
      if (error) throw new Error(`authors: ${error.message}`)
      return (data ?? []).some((row) => fresh(row.fetched_at, now()) && fresh(row.works_fetched_at, now()))
    },
    async seriesFresh(wikidata) {
      const { data, error } = await supabase.from('series').select('fetched_at').eq('wikidata_id', wikidata).maybeSingle()
      if (error) throw new Error(`series: ${error.message}`)
      return fresh(data?.fetched_at, now())
    },
    async staleAuthors(limit) {
      return (await rpc<StaleAuthor[]>('enrich_stale_authors', { p_limit: limit })) ?? []
    },
    async authorByKey(key) {
      const column = /^Q\d+$/.test(key) ? 'wikidata_id' : /^OL\d+A$/.test(key) ? 'openlibrary_key' : 'id'
      if (column === 'id' && !/^[0-9a-f-]{36}$/i.test(key)) return null
      const { data, error } = await supabase
        .from('authors')
        .select('id,wikidata_id,openlibrary_key,name,fetched_at')
        .eq(column, key)
        .maybeSingle()
      if (error) throw new Error(`authors: ${error.message}`)
      return data
    },
    async request(bookId) {
      return await rpc<boolean>('enrich_request', { p_book: bookId })
    },
    async remapCandidates(version, limit) {
      const { data, error } = await supabase
        .from('book_enrichment')
        .select('book_id,signals')
        .lt('map_version', version)
        .limit(limit)
      if (error) throw new Error(`book_enrichment: ${error.message}`)
      return (data ?? []) as { book_id: string; signals: GenreSignal[] }[]
    },
    async saveGenres(bookId, genres, version) {
      await rpc('enrich_save_genres', { p_book: bookId, p_genres: genres, p_map_version: version })
    },
    async backfill(limit) {
      return await rpc<number>('enrich_backfill', { p_limit: limit })
    },
    async status() {
      return await rpc<Record<string, number>>('enrich_status', {})
    },
  }
}

function pick(row: Record<string, unknown>): BookRow {
  const out: Record<string, unknown> = {}
  for (const column of BOOK_COLUMNS.split(',')) out[column] = row[column] ?? null
  out.authors = Array.isArray(row.authors) ? row.authors : []
  return out as BookRow
}

/** An in-memory Store for the tests: a queue of Books, and the payloads saved. */
export function createMemoryStore(books: BookRow[] = []) {
  const queue = [...books]
  const saved: Payload[] = []
  const failures: { bookId: string; error: string }[] = []
  const freshAuthors = new Set<string>()
  const freshSeries = new Set<string>()
  const store: Store = {
    claim(limit, bookId) {
      if (!bookId) return Promise.resolve(queue.splice(0, limit))
      const index = queue.findIndex((b) => b.id === bookId)
      return Promise.resolve(index >= 0 ? queue.splice(index, 1) : [])
    },
    save(payload) {
      saved.push(structuredClone(payload))
      for (const author of payload.authors) {
        if (author.fetched) {
          if (author.wikidata) freshAuthors.add(author.wikidata)
          if (author.openlibrary) freshAuthors.add(author.openlibrary)
        }
      }
      for (const series of payload.series) if (series.fetched && series.wikidata) freshSeries.add(series.wikidata)
      return Promise.resolve()
    },
    failed(bookId, error) {
      failures.push({ bookId, error })
      return Promise.resolve()
    },
    authorFresh: (ref) =>
      Promise.resolve(Boolean((ref.wikidata && freshAuthors.has(ref.wikidata)) || (ref.openlibrary && freshAuthors.has(ref.openlibrary)))),
    seriesFresh: (wikidata) => Promise.resolve(freshSeries.has(wikidata)),
    staleAuthors: () => Promise.resolve([]),
    authorByKey: () => Promise.resolve(null),
    request(bookId) {
      const book = books.find((b) => b.id === bookId)
      if (book && !queue.includes(book)) queue.unshift(book)
      return Promise.resolve(Boolean(book))
    },
    remapCandidates: () => Promise.resolve([]),
    saveGenres: () => Promise.resolve(),
    backfill: () => Promise.resolve(0),
    status: () => Promise.resolve({ queued: queue.length }),
  }
  return { store, queue, saved, failures, freshAuthors, freshSeries }
}
