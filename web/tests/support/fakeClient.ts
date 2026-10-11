import type { SupabaseClient } from '@supabase/supabase-js'
import type { EntryRow, EntryStatus } from '@/data/library'

/**
 * A stand-in for the slice of the Supabase client the repositories read through, answering like
 * PostgREST does: the filters and orders of a request are recorded, `range` is honoured, and no
 * answer is longer than `MAX_ROWS` (`max_rows` in supabase/config.toml), cut without a word.
 */

export const MAX_ROWS = 1000

export type Asked = { table: string; filters: string[]; orders: string[]; from: number | null; to: number | null }

/**
 * The slice of the Supabase client the repositories use, answering like PostgREST: filters and
 * orders recorded, `range` honoured and cut at `MAX_ROWS`. `rows(asked)` is the table, already in
 * the order the query asks for; `fail(asked)` makes a request fail.
 */
export function fakeClient(rows: (asked: Asked) => unknown[], fail: (asked: Asked, n: number) => boolean = () => false) {
  const requests: Asked[] = []
  function builder(table: string) {
    const asked: Asked = { table, filters: [], orders: [], from: null, to: null }
    const chain: Record<string, unknown> = {}
    for (const name of ['select', 'eq', 'in', 'not', 'gte', 'lte', 'returns', 'limit']) chain[name] = (...args: unknown[]) => (asked.filters.push(`${name}:${args.map(String).join(',')}`), chain)
    chain.order = (column: string) => (asked.orders.push(column), chain)
    chain.range = (from: number, to: number) => ((asked.from = from), (asked.to = to), chain)
    chain.then = (resolve: (answer: unknown) => unknown, reject?: (error: unknown) => unknown) => {
      requests.push(asked)
      const answer = fail(asked, requests.length) ? { data: null, error: { message: 'boom', code: '57014' } } : { data: serve(rows(asked), asked), error: null }
      return Promise.resolve(answer).then(resolve, reject)
    }
    return chain
  }
  /** What the server sends: the range, but never more than `max_rows`; the whole table when no range is asked. */
  function serve(all: unknown[], { from, to }: Asked) {
    const start = from ?? 0
    const end = to === null ? all.length : Math.min(to + 1, all.length)
    return all.slice(start, Math.min(end, start + MAX_ROWS))
  }
  const client = { from: (table: string) => builder(table), rpc: (name: string) => builder(`rpc:${name}`) }
  return { client: client as unknown as SupabaseClient, requests }
}

export const pad = (n: number) => String(n).padStart(5, '0')
export const entryRow = (n: number, status: EntryStatus = 'finished'): EntryRow => ({
  id: `entry-${pad(n)}`,
  status,
  added_at: '2026-10-01T00:00:00Z',
  page_count_override: null,
  book: {
    id: `book-${pad(n)}`,
    title: `Book ${n}`,
    authors: ['A. Writer'],
    isbn13: null,
    isbn10: null,
    page_count: 200,
    published_year: 2020,
    language: 'en',
    publisher: null,
    cover_url: null,
    cover_thumbhash: null,
    cover_dominant: null,
    cover_secondary: null,
    source: 'apple',
    apple_id: null,
    openlibrary_edition_key: null,
    openlibrary_work_key: null,
    created_at: '2026-10-01T00:00:00Z',
  },
  latest: null,
})
export const library = (count: number, status: EntryStatus = 'finished') => Array.from({ length: count }, (_, i) => entryRow(i, status))

