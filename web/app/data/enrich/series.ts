import type { SupabaseClient } from '@supabase/supabase-js'
import { isNoAnswer } from '../network'
import type { WorkCard } from './works'
import { type EnrichResult, mapError, OFFLINE } from './result'

/**
 * Series (issue #167): a Book's series and its place in them, a series in
 * reading order, Home's "Next in your series", and the member's own
 * correction. Positions may have decimals (0.5 a prequel, 2.5 a novella).
 *
 *   forBook(book)         book_series_info: the most specific series first (City
 *                         Watch before Discworld), each with the Book's position,
 *                         how many whole-numbered books the series has ("Book 2 of 9")
 *                         and its works with her statuses; her correction if she made one
 *   series(id)            series_works: one series in order (the series sheet)
 *   started()             started_series: per series she has started (a work she is
 *                         reading or finished; Want to read or abandoned alone do not
 *                         count) that still has a work open, the next open one, the
 *                         latest activity first. A series whose every work the
 *                         Catalogue knows is finished (or being read) is not listed:
 *                         a total nobody knows never makes a series unfinished
 *   set / clear / reset   set_entry_series / reset_entry_series, keyed by her entry
 *
 * Titles and covers come in `language` where the work has an edition in it,
 * her own edition's where she has one. Writes are refused offline.
 */

export type SeriesInfo = {
  id: string
  name: string
  wikidataId?: string
  parentId?: string | null
  parentName?: string | null
  source: 'wikidata' | 'openlibrary' | 'member'
  /** Whole-numbered positions in the series: "Book n of <count>". */
  count: number
  works: WorkCard[]
}

export type BookSeriesPlace = SeriesInfo & {
  /** The Book's position in this series (null when the series gives none). */
  position: number | null
  /** Where the membership comes from: her correction, or a source. */
  membership: 'member' | 'wikidata' | 'openlibrary'
}

export type BookSeries = {
  /** True when she corrected the Book's series herself. */
  overridden: boolean
  /** Most specific first; empty when the Book is in no series (or she said so). */
  series: BookSeriesPlace[]
}

/** One series she has started and not finished: what Home's "Next in your series" lists. */
export type StartedSeries = {
  series: { id: string; name: string; parentId?: string }
  /** How many of its works she finished. */
  finished: number
  /** How many whole-numbered works it has ("Book 3 of 10"); none when the series gives no numbers. */
  count?: number
  /** The day she last finished or began reading a work of it (YYYY-MM-DD). */
  activeOn?: string
  /** The next work open: its cover, title, place and her status of it (none, or Want to read). */
  next: WorkCard
}

/** Her correction: an existing series (by id) or one by name, at a position; or none. */
export type SeriesCorrection = { seriesId: string; position: number | null } | { name: string; position: number | null }

export type SeriesRepository = {
  forBook: (bookId: string, language?: string) => Promise<EnrichResult<BookSeries>>
  series: (seriesId: string, language?: string) => Promise<EnrichResult<SeriesInfo | null>>
  started: (limit?: number, language?: string) => Promise<EnrichResult<StartedSeries[]>>
  set: (entryId: string, correction: SeriesCorrection) => Promise<EnrichResult<BookSeries>>
  /** She says the Book is in no series. */
  clear: (entryId: string) => Promise<EnrichResult<BookSeries>>
  /** Back to the computed series. */
  reset: (entryId: string) => Promise<EnrichResult<BookSeries>>
}

/** The database's limits: positions 0 ≤ p < 10000, two decimals; names up to 300 characters. */
export const POSITION_MAX = 10000
export const SERIES_NAME_MAX = 300

function validPosition(position: number | null): boolean {
  return position === null || (Number.isFinite(position) && position >= 0 && position < POSITION_MAX)
}

function numbered<T extends { position?: unknown }>(item: T): T {
  return item.position === undefined || item.position === null ? item : { ...item, position: Number(item.position) }
}

function normalizeSeries<T extends { works?: WorkCard[]; position?: unknown }>(series: T): T {
  return numbered({ ...series, works: (series.works ?? []).map(numbered) })
}

export function createSeries(
  client: SupabaseClient,
  { online = () => true }: { online?: () => boolean } = {},
): SeriesRepository {
  async function write(name: string, args: Record<string, unknown>): Promise<EnrichResult<BookSeries>> {
    if (!online()) return OFFLINE
    const result = await client.rpc(name, args)
    if (isNoAnswer(result)) return OFFLINE
    if (result.error) return { data: null, error: mapError(result.error) }
    return { data: toBookSeries(result.data), error: null }
  }

  function toBookSeries(data: unknown): BookSeries {
    const value = (data ?? {}) as { overridden?: boolean; series?: BookSeriesPlace[] }
    return { overridden: Boolean(value.overridden), series: (value.series ?? []).map(normalizeSeries) }
  }

  return {
    async forBook(bookId, language = 'en') {
      const { data, error } = await client.rpc('book_series_info', { p_book: bookId, p_language: language })
      if (error) return { data: null, error: mapError(error) }
      return { data: toBookSeries(data), error: null }
    },

    async series(seriesId, language = 'en') {
      const { data, error } = await client.rpc('series_works', { p_series: seriesId, p_language: language })
      if (error) return { data: null, error: mapError(error) }
      return { data: data ? normalizeSeries(data as SeriesInfo) : null, error: null }
    },

    async started(limit = 100, language = 'en') {
      const { data, error } = await client.rpc('started_series', { p_limit: limit, p_language: language })
      if (error) return { data: null, error: mapError(error) }
      return {
        data: ((data ?? []) as StartedSeries[]).map((item) => ({ ...item, finished: Number(item.finished), next: numbered(item.next) })),
        error: null,
      }
    },

    async set(entryId, correction) {
      if (!validPosition(correction.position)) return { data: null, error: 'invalid' }
      if ('name' in correction) {
        const name = correction.name.trim()
        if (!name || name.length > SERIES_NAME_MAX) return { data: null, error: 'invalid' }
        return write('set_entry_series', { p_entry: entryId, p_series: null, p_name: name, p_position: correction.position })
      }
      return write('set_entry_series', { p_entry: entryId, p_series: correction.seriesId, p_name: null, p_position: correction.position })
    },

    clear: (entryId) => write('set_entry_series', { p_entry: entryId, p_series: null, p_name: null, p_position: null }),
    reset: (entryId) => write('reset_entry_series', { p_entry: entryId }),
  }
}
