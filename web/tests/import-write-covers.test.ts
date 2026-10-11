import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createBookImport, findEdition, IMPORT_CHUNK, needsLook, pacedFetch, type ImportRow } from '@/data/bookImport'
import type { FetchLike } from '@/data/fetching'
import type { BookSnapshot } from '@/data/books'

/**
 * Writing a long file (the import's second wait): the Covers of a chunk are
 * resolved all at once, and those of the next chunk while this one is written,
 * so the minutes after "Import" are not spent one small wave of image probes at
 * a time. Synthetic rows only; the probe and the database are stubs.
 */

const snapshot = (n: number): BookSnapshot => ({
  title: `Book ${n}`,
  authors: ['Author'],
  isbn13: `97800000${String(n).padStart(5, '0')}`,
  isbn10: null,
  pageCount: null,
  year: null,
  language: null,
  publisher: null,
  description: null,
  coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/${n}/100x100bb.jpg`,
  coverThumbhash: null,
  coverColors: null,
  source: 'apple',
  appleId: String(n),
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})

const rowOf = (n: number): ImportRow => ({
  key: `goodreads:${n}`,
  title: `Book ${n}`,
  authors: ['Author'],
  status: 'want_to_read',
  session: null,
  extraReads: 0,
  pageCount: null,
  otherKeys: [],
  addedOn: null,
  book: snapshot(n),
})

describe('writing rows', () => {
  it('resolves a chunk\'s covers in parallel and the next chunk\'s while the first is written', async () => {
    const events: string[] = []
    let live = 0
    let peak = 0
    const probe = async () => {
      live++
      peak = Math.max(peak, live)
      await new Promise((resolve) => setTimeout(resolve, 5))
      live--
      return null
    }
    const client = {
      rpc: async (_name: string, args: { p_rows: { key: string }[] }) => {
        events.push(`write:${args.p_rows[0]!.key}`)
        await new Promise((resolve) => setTimeout(resolve, 30))
        return { data: args.p_rows.map((row) => ({ key: row.key, outcome: 'added', entry_id: 'e' })), error: null }
      },
    } as unknown as SupabaseClient
    const seen: string[] = []
    const importer = createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search: async () => ({ results: [], pending: false, failed: false }), lookupIsbn: async () => null } },
      probe: async (url) => {
        seen.push(url)
        return probe()
      },
    })
    const rows = Array.from({ length: IMPORT_CHUNK * 3 }, (_, n) => rowOf(n))
    const written: number[] = []
    const result = await importer.write(rows, { onWritten: (chunk) => written.push(chunk.length) })
    expect(result.error).toBeNull()
    expect(result.data).toHaveLength(rows.length)
    expect(written).toEqual([IMPORT_CHUNK, IMPORT_CHUNK, IMPORT_CHUNK])
    // Every row of a chunk is probed at once, not four at a time.
    expect(peak).toBeGreaterThan(4)
    // The second chunk's covers were being probed while the first was written.
    expect(events[0]).toBe('write:goodreads:0')
    expect(seen.length).toBeGreaterThanOrEqual(IMPORT_CHUNK * 2)
  })

  it('writes what was probed even when one cover lookup throws', async () => {
    const client = {
      rpc: async (_name: string, args: { p_rows: { key: string }[] }) => ({
        data: args.p_rows.map((row) => ({ key: row.key, outcome: 'added', entry_id: 'e' })),
        error: null,
      }),
    } as unknown as SupabaseClient
    const importer = createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search: async () => ({ results: [], pending: false, failed: false }), lookupIsbn: async () => null } },
      probe: async () => {
        throw new Error('decode failed')
      },
    })
    const result = await importer.write([rowOf(1), rowOf(2)], { onWritten: () => {} })
    expect(result.error).toBeNull()
    expect(result.data?.map((outcome) => outcome.outcome)).toEqual(['added', 'added'])
  })
})

describe('needsLook', () => {
  const cover = { coverUrl: 'https://example.test/c.jpg' }
  it('is true when no edition was found, whatever the cover', () => {
    expect(needsLook('fromFile', cover)).toBe(true)
    expect(needsLook('fromFile', null)).toBe(true)
  })
  it('is true when the edition found has no cover', () => {
    expect(needsLook('matched', { coverUrl: null })).toBe(true)
    expect(needsLook('matched', null)).toBe(true)
  })
  it('is false for a match with a cover (a similar edition is probably fine)', () => {
    expect(needsLook('matched', cover)).toBe(false)
  })
})

describe('the second pass of a lookup', () => {
  const book = (n: number) => ({
    key: `goodreads:${n}`, source: 'goodreads', sourceId: String(n), row: n, title: `Book ${n}`, series: null, authors: ['Author'],
    isbn13: null, isbn10: null, pageCount: null, year: null, originalYear: null, binding: null, language: null, publisher: null,
    shelf: 'to-read', shelves: [], status: 'want_to_read', session: null, earlierReads: [], extraReads: 0, otherKeys: [], addedOn: null, problems: [],
  }) as never
  const client = {} as SupabaseClient

  function importerWith(search: (query: string, options: { signal?: AbortSignal }) => Promise<{ results: never[]; pending: boolean; failed: boolean }>) {
    return createBookImport(client, {
      lookups: { catalogue: { search: async () => [] }, search: { search, lookupIsbn: async () => null } },
      probe: async () => null,
    })
  }

  it('is counted, and its answers arrive per book', async () => {
    const importer = importerWith(async () => ({ results: [], pending: false, failed: false }))
    const counts: string[] = []
    let editions = 0
    await importer.match([book(1), book(2), book(3)], {
      onEdition: () => void editions++,
      onSecondPass: (done, total) => counts.push(`${done}/${total}`),
    })
    // Nothing found the first time: all three are asked again, and every answer is reported again.
    expect(counts).toEqual(['0/3', '1/3', '2/3', '3/3'])
    expect(editions).toBe(6)
  })

  it('ends when its own signal aborts, keeping the first answers, and the match resolves', async () => {
    let calls = 0
    const importer = importerWith(async (_query, { signal }) => {
      calls++
      if (calls <= 2) return { results: [], pending: false, failed: false }
      // The second pass hangs until it is stopped.
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped'))))
    })
    const stop = new AbortController()
    const seen: number[] = []
    const started = importer.match([book(1), book(2)], {
      onEdition: (index) => void seen.push(index),
      onSecondPass: (done) => {
        if (done === 0) setTimeout(() => stop.abort(), 20)
      },
      secondPassSignal: stop.signal,
    })
    await expect(started).resolves.toBeUndefined()
    expect(seen).toEqual([0, 1])
  })

  it('ends by itself after its budget, so a stalled source cannot hold the preview back', async () => {
    let calls = 0
    const importer = importerWith(async (_query, { signal }) => {
      calls++
      if (calls <= 1) return { results: [], pending: false, failed: false }
      return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('stopped'))))
    })
    const started = performance.now()
    await importer.match([book(1)], { onEdition: () => {}, secondPassBudgetMs: 30 })
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('still rejects when the whole lookup is aborted', async () => {
    const importer = importerWith(async () => ({ results: [], pending: false, failed: false }))
    const all = new AbortController()
    const run = importer.match([book(1)], { signal: all.signal, onEdition: () => {}, onSecondPass: () => all.abort() })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('a host that keeps refusing', () => {
  it('is left alone for a while: its requests answer at once instead of costing the waits each time', async () => {
    let clock = 0
    let calls = 0
    const fetch: FetchLike = async () => {
      calls++
      return { ok: false, status: 403, json: async () => ({}) }
    }
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, cooldownMs: 1000, now: () => clock })
    const first = await paced('https://itunes.apple.com/search?term=a')
    expect(first.status).toBe(403)
    // The first request tried three times, then the host is blocked.
    expect(calls).toBe(3)
    const second = await paced('https://itunes.apple.com/search?term=b')
    expect(second.ok).toBe(false)
    expect(calls).toBe(3)
    // After the cool-down: one attempt only; refused again, blocked again.
    clock = 2000
    await paced('https://itunes.apple.com/search?term=c')
    expect(calls).toBe(4)
    await paced('https://itunes.apple.com/search?term=d')
    expect(calls).toBe(4)
  })

  it('asks again after the cool-down and goes on as before once it answers', async () => {
    let clock = 0
    let refusing = true
    const fetch: FetchLike = async () => (refusing ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({}) })
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, cooldownMs: 1000, now: () => clock })
    await paced('https://itunes.apple.com/search?term=a')
    refusing = false
    clock = 1500
    expect((await paced('https://itunes.apple.com/search?term=b')).status).toBe(200)
    expect((await paced('https://itunes.apple.com/search?term=c')).status).toBe(200)
  })

  it('does not hold back a host that is not paced', async () => {
    const fetch: FetchLike = async () => ({ ok: false, status: 429, json: async () => ({}) })
    const paced = pacedFetch(fetch, { gapMs: { 'itunes.apple.com': 1 }, retryMs: 1, now: () => 0 })
    await paced('https://itunes.apple.com/search?term=a')
    expect((await paced('https://openlibrary.org/search.json?q=a')).status).toBe(429)
  })
})

describe('finding an edition by title', () => {
  const row = {
    title: 'Haunting Adeline', authors: ['H.D. Carlton'], isbn13: null, isbn10: null, pageCount: null, year: null, binding: null, language: null,
  } as never
  const found = { book: { title: 'Haunting Adeline', authors: ['H. D. Carlton'], language: null, pageCount: null, year: null, source: 'openlibrary', coverUrl: 'https://x/c.jpg' } }

  it('asks again with the title and the surname when the first query finds nobody (initials in the author)', async () => {
    const asked: string[] = []
    const lookups = {
      catalogue: { search: async () => [] },
      search: {
        lookupIsbn: async () => null,
        search: async (query: string) => {
          asked.push(query)
          return { results: query === 'Haunting Adeline carlton' ? [found] : [], pending: false, failed: false } as never
        },
      },
    }
    const edition = await findEdition(row, lookups as never)
    expect(asked).toEqual(['Haunting Adeline H.D. Carlton', 'Haunting Adeline carlton'])
    expect(edition.via).toBe('title')
  })

  it('does not ask twice when the first query found the book', async () => {
    const asked: string[] = []
    const lookups = {
      catalogue: { search: async () => [] },
      search: { lookupIsbn: async () => null, search: async (query: string) => (asked.push(query), { results: [found], pending: false, failed: false } as never) },
    }
    expect((await findEdition(row, lookups as never)).via).toBe('title')
    expect(asked).toHaveLength(1)
  })
})
