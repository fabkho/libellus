import { describe, expect, it } from 'vitest'
import { createCatalogueSearch } from '@/data/catalogueSearch'
import { createBookGenres } from '@/data/enrich/bookGenres'
import { createLibrary } from '@/data/library'
import { allPages, PAGE_SIZE, uniqueById } from '@/data/paging'
import { fakeClient, library, MAX_ROWS, pad } from './support/fakeClient'

/**
 * The 1,000-row cap (perf F4): PostgREST answers at most `max_rows` rows a request and says nothing
 * when it cuts, so a member with more entries than that (a big Goodreads import) silently lost
 * books. Every whole-table read of hers goes through `allPages` (data/paging.ts). Here a client
 * that behaves like the server (it cuts every answer at 1,000 rows, as supabase/config.toml says)
 * holds 2,500 rows and the reads must come back with all of them, in order, from three requests;
 * and a page that fails must not leave a partial list where a whole one was.
 */


describe('allPages', () => {
  it('asks again until a page comes back short, and sends each range once', async () => {
    const asked: [number, number][] = []
    const result = await allPages<number>(async (from, to) => {
      asked.push([from, to])
      return { data: Array.from({ length: Math.max(0, Math.min(to + 1, 2500) - from) }, (_, i) => from + i), error: null }
    })
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(result.data).toHaveLength(2500)
    expect(result.error).toBeNull()
  })

  it('a list that is a whole number of pages ends with an empty one', async () => {
    const asked: number[] = []
    const result = await allPages<number>(async (from) => {
      asked.push(from)
      return { data: from < 2000 ? Array.from({ length: PAGE_SIZE }, (_, i) => from + i) : [], error: null }
    })
    expect(asked).toEqual([0, 1000, 2000])
    expect(result.data).toHaveLength(2000)
  })

  it('all or nothing: the first failed page is the answer, with no rows', async () => {
    const result = await allPages<number>(async (from) =>
      from === 1000 ? { data: null, error: { message: 'boom' } } : { data: Array.from({ length: PAGE_SIZE }, (_, i) => from + i), error: null },
    )
    expect(result).toEqual({ data: null, error: { message: 'boom' } })
  })

  it('keeps a row that two pages both carried once', () => {
    expect(uniqueById([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }]).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('the Library lists (data/library.ts, entries)', () => {
  it('2,500 entries come back whole, in order, from three requests of one page each', async () => {
    const table = library(2500)
    const { client, requests } = fakeClient(() => table)
    const { data, error } = await createLibrary(client).entries('finished')
    expect(error).toBeNull()
    expect(data).toHaveLength(2500)
    expect(data!.map((e) => e.id)).toEqual(table.map((r) => r.id))
    expect(new Set(data!.map((e) => e.id)).size).toBe(2500)
    expect(requests.map((r) => [r.from, r.to])).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    // The pages are of the server's size, never above it: a bigger one would be cut and look like the last.
    expect(PAGE_SIZE).toBeLessThanOrEqual(MAX_ROWS)
  })

  it('every request orders by the list day, the day added and, last, the id: a total order the pages meet in', async () => {
    const { client, requests } = fakeClient(() => library(10))
    const lists = createLibrary(client)
    await lists.entries('finished')
    await lists.entries('reading')
    await lists.entries('want_to_read')
    expect(requests.map((r) => r.orders)).toEqual([
      ['latest(ended_on)', 'added_at', 'id'],
      ['latest(started_on)', 'added_at', 'id'],
      ['added_at', 'id'],
    ])
  })

  it('a member under the cap still costs one request', async () => {
    const { client, requests } = fakeClient(() => library(150))
    expect((await createLibrary(client).entries('finished')).data).toHaveLength(150)
    expect(requests).toHaveLength(1)
  })

  it('a row two pages both carried (a write between them) is listed once', async () => {
    const table = library(1500)
    // The table as the second page saw it: its first row is the first page's last, moved down by an insert.
    const overlapped = [...table.slice(0, 1000), table[999]!, ...table.slice(1000)]
    const { data } = await createLibrary(fakeClient(() => overlapped).client).entries('finished')
    expect(data).toHaveLength(1500)
    expect(new Set(data!.map((e) => e.id)).size).toBe(1500)
  })

  it('a failed page is the error, and no partial list', async () => {
    const { client, requests } = fakeClient(() => library(2500), (_asked, n) => n === 2)
    const result = await createLibrary(client).entries('finished')
    expect(result).toEqual({ data: null, error: 'unknown' })
    expect(requests).toHaveLength(2)
  })
})

describe('the other whole-table reads', () => {
  it('Search\'s Library copy pages through every entry, by id', async () => {
    const table = library(2500)
    const { client, requests } = fakeClient(() => table)
    const entries = await createCatalogueSearch(client).libraryEntries()
    expect(entries).toHaveLength(2500)
    expect(requests.map((r) => r.orders)).toEqual([['id'], ['id'], ['id']])
    await expect(createCatalogueSearch(fakeClient(() => table, (_a, n) => n === 3).client).libraryEntries()).rejects.toThrow('boom')
  })

  it('the genres of 2,500 entries come back whole through the RPC, ordered by entry', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ entry_id: `entry-${pad(i)}`, book_id: `book-${pad(i)}`, genre_ids: ['fantasy'], overridden: false }))
    const { client, requests } = fakeClient(() => rows)
    const { data, error } = await createBookGenres(client).library()
    expect(error).toBeNull()
    expect(data).toHaveLength(2500)
    expect(requests.map((r) => [r.table, r.orders, r.from])).toEqual([
      ['rpc:library_genres', ['entry_id'], 0],
      ['rpc:library_genres', ['entry_id'], 1000],
      ['rpc:library_genres', ['entry_id'], 2000],
    ])
    expect((await createBookGenres(fakeClient(() => rows, (_a, n) => n === 2).client).library()).error).not.toBeNull()
  })

  it('the days of the reads on screen are paged by session, then day', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ session_id: 's1', day: `d${pad(i)}`, start_page: i, start_percent: null, end_page: i + 1, end_percent: null }))
    const { client, requests } = fakeClient(() => rows)
    const { data } = await createLibrary(client).progressDays(['s1'])
    expect(data!.s1).toHaveLength(1200)
    expect(requests.map((r) => r.orders)).toEqual([['session_id', 'day'], ['session_id', 'day']])
  })
})

