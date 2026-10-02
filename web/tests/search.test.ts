import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  appleArtwork,
  createSearch,
  isAbort,
  isbnFromArtwork,
  plainText,
  splitAuthors,
  storefrontsFor,
  type FetchLike,
} from '@/data/search'
import { isbn10To13, parseBookKey, parseIsbn } from '@/data/books'

/**
 * The search repository on recorded Apple responses (tests/fixtures/apple,
 * recorded from the iTunes Search API on 2 Oct 2026). The live API is never
 * called: every request goes to `recorded`, which answers from the fixture
 * named after it and remembers what was asked.
 */

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/apple/${name}.json`, import.meta.url), 'utf8')) as unknown

/** `search?term=piranesi&country=us` → `search-piranesi-us`, `lookup?id=1&country=us` → `lookup-1-us`. */
function fixtureName(url: URL): string {
  const country = url.searchParams.get('country')
  if (url.pathname === '/search') {
    const term = url.searchParams.get('term')!.toLowerCase()
    const name = { piranesi: 'piranesi', 'klara und die sonne': 'klara' }[term] ?? 'nothing'
    return `search-${name}-${country}`
  }
  const isbn = url.searchParams.get('isbn')
  return isbn ? `lookup-isbn-${isbn}-${country}` : `lookup-${url.searchParams.get('id')}-${country}`
}

type Recorded = FetchLike & { asked: URL[] }

function recorded(options: { failing?: string[]; hold?: Promise<void> } = {}): Recorded {
  const asked: URL[] = []
  const fetch = (async (input: string, init?: { signal?: AbortSignal }) => {
    const url = new URL(input)
    asked.push(url)
    if (options.hold) {
      await Promise.race([
        options.hold,
        new Promise((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
        ),
      ])
    }
    if (url.hostname !== 'itunes.apple.com') throw new Error(`Unexpected request to ${url.hostname}`)
    if (options.failing?.includes(url.searchParams.get('country')!)) {
      return { ok: false, status: 503, json: async () => ({}) }
    }
    let body: unknown
    try {
      body = fixture(fixtureName(url))
    } catch {
      body = { resultCount: 0, results: [] }
    }
    return { ok: true, status: 200, json: async () => body }
  }) as Recorded
  fetch.asked = asked
  return fetch
}

describe('the storefront', () => {
  it('is German first for a German device, then the US', () => {
    expect(storefrontsFor(['de-DE', 'en-US'])).toEqual(['de', 'us'])
    expect(storefrontsFor(['de'])).toEqual(['de', 'us'])
  })

  it('is the US first for everyone else, then Britain', () => {
    expect(storefrontsFor(['en-GB'])).toEqual(['us', 'gb'])
    expect(storefrontsFor(['fr-FR', 'de-DE'])).toEqual(['us', 'gb'])
    expect(storefrontsFor([])).toEqual(['us', 'gb'])
  })

  it('decides which Apple storefronts are asked, both at once', async () => {
    const fetch = recorded()
    await createSearch({ fetch, languages: ['de-DE'] }).search('Klara und die Sonne')
    expect(fetch.asked.map((url) => url.searchParams.get('country'))).toEqual(['de', 'us'])
    expect(fetch.asked.every((url) => url.searchParams.get('media') === 'ebook')).toBe(true)
  })
})

describe('searching Apple Books', () => {
  it('turns Apple ebooks into Books with title, authors, year and a large cover', async () => {
    const { results, failed } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi')

    expect(failed).toBe(false)
    expect(results[0]).toMatchObject({
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      year: 2020,
      source: 'apple',
      appleId: '1504159680',
      coverUrl: expect.stringMatching(/\/1031214040\.jpg\/600x900bb\.jpg$/),
    })
    expect(results[0]!.description).toMatch(/^The award-winning, New York Times bestselling fantasy sensation that Madeline Miller called, "a miraculous/)
    expect(results[0]!.description).not.toMatch(/<br|&#/)
  })

  it('ranks the first storefront first and lists every edition once', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('Piranesi')
    const ids = results.map((book) => book.appleId)

    // The US answer leads; Britain only adds what the US does not sell.
    expect(ids.slice(0, 3)).toEqual(['1504159680', '1575146619', '1080796080'])
    expect(ids).toContain('1496423620') // the British edition
    expect(ids.indexOf('1496423620')).toBeGreaterThan(ids.indexOf('1504159680'))
    expect(new Set(ids).size).toBe(ids.length)
    const isbns = results.map((book) => book.isbn13).filter(Boolean)
    expect(new Set(isbns).size).toBe(isbns.length)
  })

  it('ranks German editions first on a German device', async () => {
    const { results } = await createSearch({ fetch: recorded(), languages: ['de-DE'] }).search('Klara und die Sonne')
    expect(results[0]).toMatchObject({ title: 'Klara und die Sonne', authors: ['Kazuo Ishiguro'], isbn13: '9783641274436' })
  })

  it('reads the ISBN-13 out of artwork named after it, and only a valid one', () => {
    expect(isbnFromArtwork('https://x.test/a/9783641274436.jpg/100x100bb.jpg')).toBe('9783641274436')
    expect(isbnFromArtwork('https://x.test/a/9788284321257_L2_Piranesi_Cover.jpg/100x100bb.jpg')).toBe('9788284321257')
    expect(isbnFromArtwork('https://x.test/a/1031214040.jpg/100x100bb.jpg')).toBeNull()
    expect(isbnFromArtwork('https://x.test/a/9783641274437.jpg/100x100bb.jpg')).toBeNull()
  })

  it('splits Apple\'s author line in order', () => {
    expect(splitAuthors('Edward Gibbon, Gian Battista Piranesi & Daniel J. Boorstin')).toEqual([
      'Edward Gibbon',
      'Gian Battista Piranesi',
      'Daniel J. Boorstin',
    ])
    expect(splitAuthors('Martin Luther King, Jr.')).toEqual(['Martin Luther King, Jr.'])
  })

  it('keeps paragraphs and decodes entities in descriptions', () => {
    expect(plainText('<b>Bold</b> &amp; &#34;quoted&#34;<br/>\n<br/>\nNext&nbsp;one')).toBe('Bold & "quoted"\n\nNext one')
  })

  it('asks for any cover size from the artwork URL', () => {
    expect(appleArtwork('https://x.test/a/1.jpg/100x100bb.jpg', 200, 300)).toBe('https://x.test/a/1.jpg/200x300bb.jpg')
  })

  it('answers an empty list when nothing matches', async () => {
    const outcome = await createSearch({ fetch: recorded(), languages: ['en-US'] }).search('qxzvwlmbrt')
    expect(outcome).toEqual({ results: [], failed: false })
  })

  it('does not ask anything for a query that is too short', async () => {
    const fetch = recorded()
    const outcome = await createSearch({ fetch, languages: ['en-US'] }).search(' p ')
    expect(outcome).toEqual({ results: [], failed: false })
    expect(fetch.asked).toEqual([])
  })
})

describe('an ISBN query', () => {
  it('is looked up by ISBN instead of searched as text, hyphens and all', async () => {
    const fetch = recorded()
    const { results } = await createSearch({ fetch, languages: ['de-DE'] }).search('978-3-641-26486-4')
    expect(fetch.asked.every((url) => url.pathname === '/lookup' && url.searchParams.get('isbn') === '9783641264864')).toBe(true)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ title: 'Piranesi', isbn13: '9783641264864', appleId: '1506831259' })
  })

  it('reads ISBN-10s as their ISBN-13', () => {
    expect(isbn10To13('3641264863')).toBe('9783641264864')
    expect(parseIsbn('3-641-26486-3')).toBe('9783641264864')
    expect(parseIsbn('Piranesi')).toBeNull()
    expect(parseIsbn('9783641264865')).toBeNull()
  })
})

describe('when a source fails', () => {
  it('shows what the other storefront found', async () => {
    const { results, failed } = await createSearch({ fetch: recorded({ failing: ['us'] }), languages: ['en-US'] }).search(
      'Piranesi',
    )
    expect(failed).toBe(false)
    expect(results[0]!.appleId).toBe('1496423620')
  })

  it('says so when no storefront answered', async () => {
    const outcome = await createSearch({ fetch: recorded({ failing: ['us', 'gb'] }), languages: ['en-US'] }).search(
      'Piranesi',
    )
    expect(outcome).toEqual({ results: [], failed: true })
  })
})

describe('a query replaced by a newer one', () => {
  it('is aborted in flight and never resolves with its results', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => (release = resolve))
    const search = createSearch({ fetch: recorded({ hold }), languages: ['en-US'] })

    const older = new AbortController()
    const stale = search.search('Piranesi', { signal: older.signal })
    older.abort()
    release()

    const error = await stale.catch((reason: unknown) => reason)
    expect(isAbort(error)).toBe(true)
  })

  it('is dropped even when its answer already arrived', async () => {
    const controller = new AbortController()
    const fetch = (async (url: string, init?: { signal?: AbortSignal }) => {
      const answer = await recorded()(url, init)
      controller.abort() // a newer query came in while this one was being read
      return answer
    }) as FetchLike
    const error = await createSearch({ fetch, languages: ['en-US'] })
      .search('Piranesi', { signal: controller.signal })
      .catch((reason: unknown) => reason)
    expect(isAbort(error)).toBe(true)
  })
})

describe('one Book by its id', () => {
  it('is looked up in every storefront and found where it is sold', async () => {
    const book = await createSearch({ fetch: recorded(), languages: ['en-GB'] }).lookupApple('1504159680')
    expect(book).toMatchObject({ title: 'Piranesi', appleId: '1504159680' })
  })

  it('has a page address that reads back', () => {
    expect(parseBookKey('apple-1504159680')).toEqual({ kind: 'apple', appleId: '1504159680' })
    expect(parseBookKey('isbn-9783641264864')).toEqual({ kind: 'isbn', isbn13: '9783641264864' })
    expect(parseBookKey('0f8e4a52-3c1b-4d2e-9a7f-5b6c7d8e9f00')).toEqual({
      kind: 'catalogue',
      id: '0f8e4a52-3c1b-4d2e-9a7f-5b6c7d8e9f00',
    })
    expect(parseBookKey('nonsense')).toBeNull()
  })
})
