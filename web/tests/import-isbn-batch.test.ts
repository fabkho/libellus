import { describe, expect, it } from 'vitest'
import type { AppleItem } from '@/data/apple'
import { isSameWork } from '@/data/import/editions'
import { APPLE_ISBN_BATCH, createSearch, type FetchLike, type IsbnRow } from '@/data/search'

/**
 * The import's batch lookup by ISBN (`createSearch().primeIsbns`, search.ts:
 * Apple Books asked for many ISBNs in one request a storefront,
 * `APPLE_ISBN_BATCH` a request): which ISBN an answer is primed under, and
 * which ISBNs stay to their own lookup. A fake `fetch` records every URL and
 * answers from what each case says (apple.ts's `{ resultCount, results }` of
 * iTunes items; anything else an empty OpenLibrary answer) — the live APIs are
 * never called. The rows are invented ("Bleak House"/"Charles Dickens",
 * "Persuasion"/"Jane Austen"), their ISBNs invented 979s with a real check
 * digit (as tests/goodreads-import.test.ts's `uniqueIsbn`).
 */

/** An invented ISBN-13 of the 979 range, its check digit computed. */
function isbn(body: string): string {
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

/** A fetch that records every URL it is given (tests/search.test.ts's `recorded`) and answers as `answer` says. */
type FakeFetch = FetchLike & { asked: URL[] }

function recording(answer: (url: URL) => { ok?: boolean; status?: number; body: unknown }): FakeFetch {
  const asked: URL[] = []
  const fetch = ((input: string) => {
    const url = new URL(input)
    asked.push(url)
    const { ok = true, status = 200, body } = answer(url)
    return Promise.resolve({ ok, status, json: async () => body })
  }) as FakeFetch
  fetch.asked = asked
  return fetch
}

/** Apple's answer to a lookup: these items (apple.ts reads `resultCount`/`results`). */
const appleBody = (items: AppleItem[]) => ({ resultCount: items.length, results: items })

/** What the fake answers everything that is not Apple with (OpenLibrary's shape). */
const openLibraryBody = { docs: [], numFound: 0 }

/** One iTunes Search API ebook result (apple.ts's `AppleItem`). */
function item(overrides: Partial<AppleItem>): AppleItem {
  return {
    kind: 'ebook',
    trackId: 9101,
    trackName: 'Bleak House',
    artistName: 'Charles Dickens',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Pub11/v4/aa/bb/cc/cover.jpg/100x100bb.jpg',
    ...overrides,
  }
}

const rowOf = (isbn13: string, title: string, author: string): IsbnRow => ({ isbn13, title, authors: [author] })

/** Apple answers the batch request (many ISBNs, comma-separated) with `batch`; every single lookup finds nothing. */
function batchAnswer(batch: AppleItem[], { refuse = false } = {}) {
  return (url: URL) => {
    if (url.hostname !== 'itunes.apple.com') return { body: openLibraryBody }
    const asked = url.searchParams.get('isbn') ?? ''
    if (!asked.includes(',')) return { body: appleBody([]) }
    return refuse ? { ok: false, status: 429, body: {} } : { body: appleBody(batch) }
  }
}

const batchUrls = (fetch: FakeFetch) => fetch.asked.filter((url) => (url.searchParams.get('isbn') ?? '').includes(','))

describe('primeIsbns', () => {
  it('keeps the ISBN an item’s artwork names, and a primed miss asks Apple nothing more', async () => {
    const a = isbn('979000000101')
    const b = isbn('979000000102')
    // Most editions' artwork file name carries their ISBN (apple.ts's `isbnFromArtwork`).
    const named = item({
      trackId: 9101,
      artworkUrl100: `https://is1-ssl.mzstatic.com/image/thumb/Pub11/v4/aa/bb/cc/${a}.jpg/100x100bb.jpg`,
    })
    const fetch = recording(batchAnswer([named]))
    const search = createSearch({ fetch, languages: ['de-DE', 'en-US'] })
    await search.primeIsbns([rowOf(a, 'Bleak House', 'Charles Dickens'), rowOf(b, 'Persuasion', 'Jane Austen')], (row, book) => isSameWork(row, book))
    expect(batchUrls(fetch)).toHaveLength(2) // one batch request per storefront (de, us)

    const asked = fetch.asked.length
    expect(await search.lookupAppleIsbn(a)).toMatchObject({ isbn13: a, appleId: '9101' })
    // The other ISBN was answered for in the batch (Apple surely has none): no request of its own.
    expect(await search.lookupAppleIsbn(b)).toBeNull()
    expect(fetch.asked).toHaveLength(asked)
  })

  it('attributes an item whose artwork names no ISBN to the row whose work it is', async () => {
    const a = isbn('979000000103')
    const b = isbn('979000000104')
    const anonymous = item({
      trackId: 9201,
      trackName: 'Persuasion',
      artistName: 'Jane Austen',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Pub11/v4/aa/bb/cc/anon.jpg/100x100bb.jpg',
    })
    const fetch = recording(batchAnswer([anonymous]))
    const search = createSearch({ fetch, languages: ['de-DE', 'en-US'] })
    await search.primeIsbns([rowOf(a, 'Bleak House', 'Charles Dickens'), rowOf(b, 'Persuasion', 'Jane Austen')], (row, book) => isSameWork(row, book))

    const asked = fetch.asked.length
    // The batch primed it under the row's ISBN, with that ISBN on the book.
    expect(await search.lookupAppleIsbn(b)).toMatchObject({ isbn13: b, appleId: '9201' })
    expect(await search.lookupAppleIsbn(a)).toBeNull()
    expect(fetch.asked).toHaveLength(asked)
  })

  it('an item no row owns leaves every ISBN of the batch to its own lookup', async () => {
    const a = isbn('979000000105')
    const b = isbn('979000000106')
    const stranger = item({
      trackId: 9301,
      trackName: 'Moby Dick',
      artistName: 'Herman Melville',
      artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Pub11/v4/aa/bb/cc/anon.jpg/100x100bb.jpg',
    })
    const fetch = recording(batchAnswer([stranger]))
    const search = createSearch({ fetch, languages: ['de-DE', 'en-US'] })
    await search.primeIsbns([rowOf(a, 'Bleak House', 'Charles Dickens'), rowOf(b, 'Persuasion', 'Jane Austen')], (row, book) => isSameWork(row, book))
    expect(fetch.asked).toHaveLength(2) // only the batch, in both storefronts

    // The orphan may be any ISBN's edition: nothing was primed, the lookup asks on its own.
    expect(await search.lookupAppleIsbn(a)).toBeNull()
    expect(fetch.asked).toHaveLength(4) // its own lookup, in both storefronts
  })

  it('a refused batch primes nothing: each ISBN is looked up on its own', async () => {
    const a = isbn('979000000107')
    const b = isbn('979000000108')
    const fetch = recording(batchAnswer([], { refuse: true }))
    const search = createSearch({ fetch, languages: ['de-DE', 'en-US'] })
    await search.primeIsbns([rowOf(a, 'Bleak House', 'Charles Dickens'), rowOf(b, 'Persuasion', 'Jane Austen')], (row, book) => isSameWork(row, book))
    expect(fetch.asked).toHaveLength(2) // both storefronts refused the batch

    expect(await search.lookupAppleIsbn(a)).toBeNull()
    expect(fetch.asked).toHaveLength(4) // asked on its own, in both storefronts
  })

  it(`41 rows cost two batch requests per storefront (${APPLE_ISBN_BATCH} a request)`, async () => {
    expect(APPLE_ISBN_BATCH).toBe(40)
    const rows = Array.from({ length: 41 }, (_, index) =>
      rowOf(isbn(`9790000001${String(index).padStart(2, '0')}`), `The Quiet Harbour ${index}`, 'Lena Marsh'),
    )
    const fetch = recording((url) => ({ body: url.hostname === 'itunes.apple.com' ? appleBody([]) : openLibraryBody }))
    const search = createSearch({ fetch, languages: ['de-DE', 'en-US'] })
    await search.primeIsbns(rows, (row, book) => isSameWork(row, book))

    // 40 + 1: two batch requests per storefront (de, us) — the 40-ISBN one carries a
    // comma-separated isbn parameter per storefront, the 41st ISBN rides alone.
    expect(batchUrls(fetch)).toHaveLength(2)
    for (const country of ['de', 'us']) {
      expect(fetch.asked.filter((url) => url.searchParams.get('country') === country)).toHaveLength(2)
    }
    const asked = new Set(fetch.asked.flatMap((url) => (url.searchParams.get('isbn') ?? '').split(',').filter(Boolean)))
    expect(asked.size).toBe(41) // every row's ISBN was asked, none twice
  })
})
