import { describe, expect, it } from 'vitest'
import type { WorkCard } from '@/data/enrich/works'
import { createAuthors } from '@/data/enrich/authors'
import { filterByGenres, matchesGenres, popularityOf, standaloneByKind } from '@/utils/authorPage'

/**
 * What the author page makes of its works (Wave C5): the standalone group split by what a work is, the hero's genre chips
 * as a filter over every work below, and the one popularity figure a row shows. The page's template only draws what these
 * say, so the split and the predicate are tested here rather than end to end.
 */

const work = (title: string, extra: Partial<WorkCard> = {}): WorkCard => ({ title, ...extra })

describe('standaloneByKind', () => {
  it('puts the novels first, then the novellas, then anything else; the order within a group is the one it was given', () => {
    const groups = standaloneByKind([
      work('A novella', { kind: 'novella' }),
      work('A novel', { kind: 'novel' }),
      work('Another novel', { kind: 'novel' }),
      work('No kind at all'),
    ])
    expect(groups.novels.map((w) => w.title)).toEqual(['A novel', 'Another novel'])
    expect(groups.novellas.map((w) => w.title)).toEqual(['A novella'])
    expect(groups.rest.map((w) => w.title)).toEqual(['No kind at all'])
  })

  it('leaves the groups empty when there is nothing of that kind', () => {
    expect(standaloneByKind([work('Only a novel', { kind: 'novel' })])).toEqual({ novels: [expect.anything()], novellas: [], rest: [] })
    expect(standaloneByKind([])).toEqual({ novels: [], novellas: [], rest: [] })
  })

  it('does not re-sort: the server’s order (most-read first) is what each group keeps', () => {
    const groups = standaloneByKind([
      work('Popular', { kind: 'novel', wantToReadCount: 900 }),
      work('Quiet', { kind: 'novel', wantToReadCount: 3 }),
    ])
    expect(groups.novels.map((w) => w.title)).toEqual(['Popular', 'Quiet'])
  })

  it('does not change the list it is given', () => {
    const list = [work('A', { kind: 'novella' }), work('B', { kind: 'novel' })]
    standaloneByKind(list)
    expect(list.map((w) => w.title)).toEqual(['A', 'B'])
  })
})

describe('matchesGenres', () => {
  const sciFi = work('S', { genres: ['sci-fi'] })
  const both = work('Both', { genres: ['sci-fi', 'fantasy'] })
  const none = work('Plain')

  it('passes everything while no chip is pressed', () => {
    expect(matchesGenres(none, [])).toBe(true)
    expect(matchesGenres(sciFi, [])).toBe(true)
  })

  it('keeps a work whose genres include a pressed chip', () => {
    expect(matchesGenres(sciFi, ['sci-fi'])).toBe(true)
    expect(matchesGenres(sciFi, ['fantasy'])).toBe(false)
    expect(matchesGenres(both, ['fantasy'])).toBe(true)
  })

  it('is an OR across the pressed chips', () => {
    expect(matchesGenres(sciFi, ['sci-fi', 'crime'])).toBe(true)
    expect(matchesGenres(work('C', { genres: ['crime'] }), ['sci-fi', 'crime'])).toBe(true)
    expect(matchesGenres(work('H', { genres: ['horror'] }), ['sci-fi', 'crime'])).toBe(false)
  })

  it('leaves a work that carries no genre out while a chip is pressed', () => {
    expect(matchesGenres(none, ['sci-fi'])).toBe(false)
    expect(matchesGenres({ title: 'No list', genres: undefined }, ['sci-fi'])).toBe(false)
  })
})

describe('filterByGenres', () => {
  it('keeps the order the server gave', () => {
    const list = [work('First', { genres: ['sci-fi'] }), work('Plain'), work('Third', { genres: ['sci-fi'] })]
    expect(filterByGenres(list, ['sci-fi']).map((w) => w.title)).toEqual(['First', 'Third'])
  })

  it('returns the whole list, untouched, while nothing is pressed', () => {
    const list = [work('A'), work('B')]
    expect(filterByGenres(list, []).map((w) => w.title)).toEqual(['A', 'B'])
  })

  it('can leave nothing at all', () => {
    expect(filterByGenres([work('A', { genres: ['horror'] })], ['sci-fi'])).toEqual([])
  })
})

describe('popularityOf', () => {
  it('shows one figure, the most-read signal first', () => {
    expect(popularityOf(work('A', { wantToReadCount: 1200, readinglogCount: 40, ratingsCount: 900 }))).toEqual({ key: 'wantToRead', count: 1200 })
    expect(popularityOf(work('B', { readinglogCount: 40, ratingsCount: 900 }))).toEqual({ key: 'reading', count: 40 })
    expect(popularityOf(work('C', { ratingsCount: 900 }))).toEqual({ key: 'ratings', count: 900 })
  })

  it('says nothing when every count is unknown, and a 0 is unknown', () => {
    expect(popularityOf(work('A'))).toBeNull()
    expect(popularityOf(work('B', { wantToReadCount: 0, readinglogCount: 0, ratingsCount: 0 }))).toBeNull()
  })
})

describe('the repository asks for the most-read order', () => {
  /** A client that only records what the page RPC was asked, as a standalone page with nothing on it. */
  function recorder() {
    const calls: Record<string, unknown>[] = []
    const client = {
      rpc: async (_fn: string, args: Record<string, unknown>) => {
        calls.push(args)
        return { data: { author: { id: 'a', key: 'Q1', name: 'A' }, genres: [], series: [], standalone: [], other: [], stale: false }, error: null }
      },
      functions: { invoke: async () => ({ data: null, error: null }) },
    }
    return { calls, client: client as unknown as Parameters<typeof createAuthors>[0] }
  }

  it('passes p_order = most-read by default and lets a caller ask for the old order', async () => {
    const { calls, client } = recorder()
    const authors = createAuthors(client)
    await authors.page('Q1', 'de')
    await authors.page('Q1', 'de', 'default')
    expect(calls).toEqual([
      { p_author: 'Q1', p_language: 'de', p_order: 'most-read' },
      { p_author: 'Q1', p_language: 'de', p_order: 'default' },
    ])
  })
})
