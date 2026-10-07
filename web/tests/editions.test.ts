import { describe, expect, it } from 'vitest'
import type { Book, BookSnapshot } from '@/data/books'
import type { CatalogueSearch } from '@/data/catalogueSearch'
import { createCollections } from '@/data/collections'
import {
  createEditions,
  editionFacts,
  editionsQuery,
  languageCode,
  languageName,
  mergeEditions,
  appendEditions,
  editionSignature,
  isEditionOf,
  type EditionsOutcome,
} from '@/data/editions'
import type { FetchLike } from '@/data/fetching'
import { createLibrary, type LibraryEntry } from '@/data/library'
import { createManualBooks } from '@/data/manualBooks'
import { snapshotFromApple, type AppleItem } from '@/data/apple'
import { snapshotFromWorkEdition } from '@/data/openLibrary'
import { addDays, isoDay } from '@/utils/dates'
import { appleAnswer } from './support/apple'
import { signUpMember } from './support/member'
import { openLibraryAnswer } from './support/openLibrary'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Changing an entry's edition (issue #41). The editions lookup on recorded
 * responses (Apple, tests/fixtures/apple; OpenLibrary's search and a work's
 * editions list, tests/fixtures/openlibrary): the work's editions and a
 * title + author search in one list, one row per ISBN-13, the current edition
 * first. Then the repository's `changeEdition` against the local stack, as a
 * real signed-in member: the entry keeps its reads and Collections, a page past
 * the new edition's end is clamped, an edition she already holds is refused,
 * a Manual book switches to a Catalogue edition and is gone, offline nothing is sent.
 */

const PIRANESI_WORK = 'OL20893680W'

function snapshot(fields: Partial<BookSnapshot>): BookSnapshot {
  return {
    title: 'Piranesi',
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    language: null,
    publisher: null,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: null,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...fields,
  }
}

function book(fields: Partial<Book>): Book {
  return { ...snapshot(fields), id: fields.id ?? crypto.randomUUID(), createdAt: '2026-10-03T00:00:00Z', ...fields }
}

type Recorded = FetchLike & { asked: URL[] }

function recorded({ failing = [] as string[] } = {}): Recorded {
  const asked: URL[] = []
  const fetch = (async (input: string) => {
    const url = new URL(input)
    asked.push(url)
    const apple = url.hostname === 'itunes.apple.com'
    if (!apple && url.hostname !== 'openlibrary.org') throw new Error(`Unexpected request to ${url.hostname}`)
    if (failing.includes(apple ? 'apple' : 'openlibrary')) return { ok: false, status: 503, json: async () => ({}) }
    const body = apple ? appleAnswer(url) : openLibraryAnswer(url)
    return { ok: true, status: 200, json: async () => body }
  }) as Recorded
  fetch.asked = asked
  return fetch
}

function catalogueOf(books: Book[], { failing = false } = {}): CatalogueSearch & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    async search(query) {
      asked.push(query)
      if (failing) throw new Error('The database is away')
      return books.map((found) => ({ book: found, source: 'catalogue' as const, popularity: 0 }))
    },
    libraryEntries: async () => [],
  }
}

const isbns = (outcome: EditionsOutcome) => outcome.candidates.map((candidate) => candidate.book.isbn13)

// ------------------------------------------------------------- pure helpers

describe('languages', () => {
  it('reads OpenLibrary\'s MARC codes and ISO codes as one', () => {
    expect(languageCode('ger')).toBe('de')
    expect(languageCode('de')).toBe('de')
    expect(languageCode('de-AT')).toBe('de')
    expect(languageCode('ENG')).toBe('en')
    expect(languageCode(null)).toBeNull()
  })

  it('names a language in the interface language, and nothing it does not know', () => {
    expect(languageName('ger')).toBe('German')
    expect(languageName('en')).toBe('English')
    expect(languageName('spa')).toBe('Spanish')
    expect(languageName('zzz')).toBeNull()
    expect(languageName('')).toBeNull()
  })
})

describe('an Apple edition\'s language (#104)', () => {
  const words = { locale: 'en', pages: (count: number) => `${count} pages`, format: (format: string) => format }

  it('has none to read: Apple\'s ebook answers carry no language field, so the snapshot has none', () => {
    const asked: [string, string][] = [['piranesi', 'us'], ['piranesi', 'gb'], ['klara und die sonne', 'de']]
    const items = asked.flatMap(([term, country]) => {
      const url = new URL(`https://itunes.apple.com/search?${new URLSearchParams({ term, country })}`)
      return (appleAnswer(url) as { results: AppleItem[] }).results
    })
    expect(items.length).toBeGreaterThan(10)
    // Whatever Apple sends, none of the keys is a language.
    expect(new Set(items.flatMap((item) => Object.keys(item)).filter((key) => /lang/i.test(key)))).toEqual(new Set())
    for (const item of items) expect(snapshotFromApple(item)?.language ?? null).toBeNull()
  })

  it('leaves the language out of the row\'s facts: it starts with the year, no placeholder', () => {
    const apple = { language: null, year: 2020, pageCount: null, publisher: null, source: 'apple' as const }
    expect(editionFacts(apple, words)).toEqual(['2020', 'ebook'])
    // Whatever is missing is missing: no empty entries, so the row draws no dash or stray separator.
    expect(editionFacts({ ...apple, year: null }, words)).toEqual(['ebook'])
    expect(editionFacts({ ...apple, year: null, source: 'openlibrary' }, words)).toEqual([])
    // An edition OpenLibrary filled in has it, first.
    expect(editionFacts({ ...apple, language: 'ger', pageCount: 272, publisher: ' Bloomsbury ' }, words)).toEqual([
      'German', '2020', '272 pages', 'ebook', 'Bloomsbury',
    ])
    // The format is the source's (an OpenLibrary paperback), or what the member said for hers.
    const paperback = { ...apple, source: 'openlibrary' as const, format: 'paperback' as const }
    expect(editionFacts(paperback, words)).toEqual(['2020', 'paperback'])
    expect(editionFacts(paperback, words, 'hardcover')).toEqual(['2020', 'hardcover'])
  })
})

describe('isEditionOf', () => {
  const brown = { title: 'Im Haus der Feinde', authors: ['Pierce Brown'] }

  it('takes a title with a series name before it, either way round, by the same author', () => {
    expect(isEditionOf(brown, { title: 'Red Rising - Im Haus der Feinde', authors: ['Pierce Brown'] })).toBe(true)
    expect(isEditionOf({ title: 'Red Rising - Im Haus der Feinde', authors: ['Pierce Brown'] }, { title: 'Im Haus der Feinde', authors: ['Brown'] })).toBe(true)
  })

  it('takes the same title whoever the edition credits', () => {
    expect(isEditionOf({ title: 'Todesmarsch', authors: ['Richard Bachman'] }, { title: 'Todesmarsch', authors: ['Stephen King'] })).toBe(true)
    expect(isEditionOf({ title: 'Klára & the Sun', authors: [] }, { title: 'Klara and the Sun!', authors: [] })).toBe(true)
  })

  it('leaves out another book the search found by its author or by a word of its title', () => {
    expect(isEditionOf(brown, { title: 'Eine Spur von Mord (Keri Locke Mystery--Buch #2)', authors: ['Blake Pierce'] })).toBe(false)
    expect(isEditionOf({ title: 'Piranesi', authors: ['Susanna Clarke'] }, { title: 'Jonathan Strange & Mr Norrell', authors: ['Susanna Clarke'] })).toBe(false)
    expect(isEditionOf({ title: 'Piranesi', authors: ['Susanna Clarke'] }, { title: 'Giovanni-Battista Piranesi', authors: ['Henri Focillon'] })).toBe(false)
    expect(isEditionOf({ title: 'Piranesi', authors: [] }, { title: 'Piranesi As Designer', authors: ['John Wilton-Ely'] })).toBe(false)
  })

  it('asks for the title and the first author', () => {
    expect(editionsQuery({ title: 'Tag der Entscheidung', authors: ['Pierce Brown', 'Someone Else'] })).toBe('Tag der Entscheidung Pierce Brown')
    expect(editionsQuery({ title: 'Anonymous', authors: [] })).toBe('Anonymous')
  })
})

describe('snapshotFromWorkEdition', () => {
  it('makes an edition of a work list a snapshot with the work\'s authors', () => {
    const edition = snapshotFromWorkEdition(
      {
        key: '/books/OL34985598M',
        title: 'Piranesi',
        covers: [-1, 15240267],
        isbn_13: ['9788418363283'],
        number_of_pages: 272,
        publish_date: '2021-12-07',
        publishers: ['Salamandra'],
        languages: [{ key: '/languages/spa' }],
      },
      { key: PIRANESI_WORK, authors: ['Susanna Clarke'] },
    )
    expect(edition).toMatchObject({
      title: 'Piranesi',
      authors: ['Susanna Clarke'],
      isbn13: '9788418363283',
      pageCount: 272,
      year: 2021,
      language: 'spa',
      publisher: 'Salamandra',
      coverUrl: 'https://covers.openlibrary.org/b/id/15240267-L.jpg',
      source: 'openlibrary',
      openLibraryEditionKey: 'OL34985598M',
      openLibraryWorkKey: PIRANESI_WORK,
    })
  })

  it('converts an ISBN-10 and leaves out an edition with no key or title', () => {
    expect(snapshotFromWorkEdition({ key: '/books/OL1M', title: 'X', isbn_10: ['0306406152'] }, { key: 'OL1W', authors: [] })?.isbn13).toBe('9780306406157')
    expect(snapshotFromWorkEdition({ title: 'X' }, { key: 'OL1W', authors: [] })).toBeNull()
    expect(snapshotFromWorkEdition({ key: '/books/OL1M' }, { key: 'OL1W', authors: [] })).toBeNull()
  })
})

describe('mergeEditions', () => {
  const current = book({ title: 'Piranesi', isbn13: '9781526622419', language: 'en', source: 'import' })

  it('puts the current edition first, marked, and merges the same edition from every source into one row', () => {
    const merged = mergeEditions(current, {
      catalogue: [book({ isbn13: '9781526622426', language: 'en', coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg', coverThumbhash: 'hash' })],
      work: [
        snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL1M', isbn13: '9781526622419' }),
        snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL2M', isbn13: '9781526622426' }),
        snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL3M', isbn10: '1635575648', pageCount: 272, language: 'eng' }),
      ],
      apple: [snapshot({ appleId: '1', isbn13: '9781635575644', coverUrl: 'https://is1-ssl.mzstatic.com/x/600x900bb.jpg' })],
    })

    expect(merged.map((c) => [c.book.isbn13, c.current])).toEqual([
      ['9781526622419', true],
      ['9781526622426', false],
      ['9781635575644', false],
    ])
    // The current edition is shown as it is; the Catalogue's row wins over a source's.
    expect(merged[0]!.book).toBe(current)
    expect(merged[1]!.book).toMatchObject({ coverThumbhash: 'hash' })
    expect('id' in merged[1]!.book).toBe(true)
    // Apple leads (its cover), OpenLibrary fills in what Apple does not know; source ids are not mixed.
    expect(merged[2]!.book).toMatchObject({ source: 'apple', appleId: '1', pageCount: 272, language: 'eng', isbn10: '1635575648', openLibraryEditionKey: null })
  })

  it('ranks editions with a cover first, then the current language, then by source', () => {
    const merged = mergeEditions(current, {
      work: [
        snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL1M', isbn13: '9790000000011', language: 'ger' }),
        snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL2M', isbn13: '9790000000028', language: 'eng', year: 2021 }),
        snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL3M', isbn13: '9790000000035', language: 'ger', coverUrl: 'https://covers.openlibrary.org/b/id/3-L.jpg' }),
      ],
      apple: [snapshot({ appleId: '4', isbn13: '9790000000042', coverUrl: 'https://is1-ssl.mzstatic.com/x/600x900bb.jpg' })],
    })
    expect(merged.slice(1).map((c) => c.book.isbn13)).toEqual(['9790000000035', '9790000000042', '9790000000028', '9790000000011'])
  })

  describe('rows that look the same', () => {
    const look = { language: 'en', year: 2002, pageCount: 387, publisher: 'Harper', coverUrl: 'https://covers.openlibrary.org/b/id/9-L.jpg' }

    it('are one row, the richest of them', () => {
      const merged = mergeEditions(current, {
        work: [
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL1M', isbn13: '9790000000011', ...look }),
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL2M', isbn13: '9790000000028', ...look, description: 'A long one.' }),
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL3M', isbn13: '9790000000035', ...look }),
        ],
      })
      expect(merged.map((c) => c.book.isbn13)).toEqual(['9781526622419', '9790000000028'])
      expect(merged[1]!.book.description).toBe('A long one.')
    })

    it('keep the Catalogue\'s on a tie, and the earliest place', () => {
      const catalogued = book({ id: 'c-1', isbn13: '9790000000042', ...look, source: 'openlibrary' })
      const merged = mergeEditions(current, {
        work: [
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL9M', isbn13: '9790000000099', language: 'ger' }),
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL1M', isbn13: '9790000000011', ...look }),
        ],
        apple: [],
        catalogue: [catalogued],
      })
      const keys = merged.slice(1).map((c) => c.book.isbn13)
      expect(keys).toContain('9790000000042')
      expect(keys).not.toContain('9790000000011')
    })

    it('differ by publisher, ebook and cover, so each of those keeps its row', () => {
      const merged = mergeEditions(current, {
        work: [
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL1M', isbn13: '9790000000011', ...look }),
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL2M', isbn13: '9790000000028', ...look, publisher: 'Gollancz' }),
          snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL3M', isbn13: '9790000000035', ...look, coverUrl: 'https://covers.openlibrary.org/b/id/10-L.jpg' }),
        ],
        apple: [snapshot({ appleId: '4', isbn13: '9790000000042', ...look })],
      })
      expect(merged).toHaveLength(5)
    })

    it('are no row at all when they look like the current edition', () => {
      const same = book({ isbn13: '9781526622419', ...look, source: 'openlibrary' })
      const merged = mergeEditions(same, {
        work: [snapshot({ source: 'openlibrary', openLibraryEditionKey: 'OL1M', isbn13: '9790000000011', ...look })],
      })
      expect(merged).toHaveLength(1)
    })

    it('are told by the same signature, whatever the case, accents or language code', () => {
      const a = snapshot({ title: 'Klára & the Sun', language: 'ger' })
      const b = snapshot({ title: 'klara and the sun', language: 'de' })
      expect(editionSignature(a)).toBe(editionSignature(b))
      expect(editionSignature(snapshot({ source: 'apple' }))).not.toBe(editionSignature(snapshot({ source: 'openlibrary' })))
      const apple = (host: string) => snapshot({ coverUrl: `https://${host}.mzstatic.com/image/thumb/Publication/v4/1.jpg/600x900bb.jpg` })
      expect(editionSignature(apple('is1-ssl'))).toBe(editionSignature(apple('is3-ssl')))
      expect(editionSignature(snapshot({ pageCount: 100 }))).not.toBe(editionSignature(snapshot({ pageCount: 101 })))
    })
  })

  it('never offers a Manual book, and leaves out a find with nothing to know it by', () => {
    const merged = mergeEditions(current, {
      catalogue: [book({ source: 'manual', title: 'Piranesi' })],
      apple: [snapshot({ title: 'Piranesi' })],
    })
    expect(merged).toHaveLength(1)
  })
})

describe('appendEditions', () => {
  const current = book({ isbn13: '9781526622419', language: 'en', source: 'import' })
  const row = (fields: Partial<BookSnapshot>) => ({ book: snapshot({ source: 'openlibrary', language: 'en', ...fields }), current: false })
  const own = { book: current, current: true }

  it('takes the first merge as it is', () => {
    const first = [own, row({ isbn13: '9790000000011', year: 2001 })]
    expect(appendEditions([], first)).toEqual(first)
  })

  it('keeps what is shown where it is and adds the new rows at the end, in the merge\'s order', () => {
    const shown = [own, row({ isbn13: '9790000000011', year: 2001 }), row({ isbn13: '9790000000028', year: 2002 })]
    // A slower source answered with a covered edition the sort would put first.
    const covered = row({ isbn13: '9790000000035', year: 2003, coverUrl: 'https://covers.openlibrary.org/b/id/3-L.jpg' })
    const grown = appendEditions(shown, [own, covered, ...shown.slice(1)])
    expect(grown.map((c) => c.book.isbn13)).toEqual(['9781526622419', '9790000000011', '9790000000028', '9790000000035'])
    expect(grown.slice(0, 3)).toEqual(shown)
  })

  it('lets a shown row take what a slower source learned about it, in the same place', () => {
    const shown = [own, row({ isbn13: null, appleId: '5', source: 'apple', year: 2001 }), row({ isbn13: '9790000000028', year: 2002 })]
    const learned = row({ isbn13: '9790000000011', appleId: '5', source: 'apple', year: 2001, language: 'en', pageCount: 300 })
    const grown = appendEditions(shown, [own, learned, shown[2]!])
    expect(grown).toHaveLength(3)
    expect(grown[1]!.book).toMatchObject({ appleId: '5', isbn13: '9790000000011', pageCount: 300 })
    expect(grown[2]).toEqual(shown[2])
  })

  it('does not add an edition that is shown already or looks the same as a shown one', () => {
    const shown = [own, row({ isbn13: '9790000000011', year: 2001, openLibraryEditionKey: 'OL1M' })]
    const lookalike = row({ isbn13: '9790000000099', year: 2001 })
    expect(appendEditions(shown, [own, shown[1]!, lookalike])).toEqual(shown)
  })

  it('is what the lookup reports: a slower source never moves a row that was reported', async () => {
    const reported: (string | null)[][] = []
    let releaseSlow!: () => void
    const slow = new Promise<void>((resolve) => (releaseSlow = resolve))
    const uncovered = book({ isbn13: '9790000000011', language: 'en', year: 2001 })
    const fetch = (async (input: string) => {
      const url = new URL(input)
      // The work's editions come late, with a covered edition the sort alone would put first.
      if (url.pathname === `/works/${PIRANESI_WORK}/editions.json`) {
        await slow
        const entries = [{ key: '/books/OL3M', title: 'Piranesi', isbn_13: ['9788418363283'], covers: [3], languages: [{ key: '/languages/eng' }], publish_date: '2003' }]
        return { ok: true, status: 200, json: async () => ({ entries }) }
      }
      return { ok: true, status: 200, json: async () => ({ results: [], docs: [] }) }
    }) as FetchLike
    const editions = createEditions({ fetch, languages: ['en'], catalogue: catalogueOf([uncovered]) })
    const withWork = book({ isbn13: '9781526622419', language: 'en', source: 'openlibrary', openLibraryWorkKey: PIRANESI_WORK })

    const run = editions.find(withWork, { onUpdate: (outcome) => reported.push(isbns(outcome)) })
    setTimeout(releaseSlow, 10)
    const outcome = await run

    expect(reported[0]).toEqual(['9781526622419', '9790000000011'])
    expect(outcome.candidates[1]!.book).toBe(uncovered)
    expect(isbns(outcome)).toEqual(['9781526622419', '9790000000011', '9788418363283'])
    for (const later of reported) expect(later.slice(0, 2)).toEqual(reported[0])
    // Merged alone, the covered edition would have led.
    expect(mergeEditions(withWork, { catalogue: [uncovered], work: [outcome.candidates[2]!.book] }).map((c) => c.book.isbn13)).toEqual([
      '9781526622419',
      '9788418363283',
      '9790000000011',
    ])
  })
})

// ------------------------------------------------------------ the lookup

describe('createEditions', () => {
  it('lists the work\'s editions, one row per ISBN, the current one first', async () => {
    const fetch = recorded()
    const current = book({ isbn13: '9781526622419', language: 'en', source: 'openlibrary', openLibraryEditionKey: 'OL61022665M', openLibraryWorkKey: PIRANESI_WORK })
    const outcome = await createEditions({ fetch, languages: ['en-GB'] }).find(current)

    expect(outcome.pending).toBe(false)
    expect(outcome.failed).toBe(false)
    expect(fetch.asked.some((url) => url.pathname === `/works/${PIRANESI_WORK}/editions.json`)).toBe(true)
    expect(outcome.candidates[0]).toEqual({ book: current, current: true })
    // The recording lists 23 editions, three ISBNs twice and the current one once: 19 others.
    expect(outcome.candidates).toHaveLength(20)
    expect(new Set(isbns(outcome)).size).toBe(20)
    // The German edition is there, with its cover and page count.
    expect(outcome.candidates.find((c) => c.book.isbn13 === '9783453321984')?.book).toMatchObject({
      pageCount: 272,
      coverUrl: 'https://covers.openlibrary.org/b/id/14609166-L.jpg',
      authors: ['Susanna Clarke'],
    })
    // Those with a cover come first.
    const covered = outcome.candidates.slice(1).map((c) => Boolean(c.book.coverUrl))
    expect(covered).toEqual([...covered].sort((a, b) => Number(b) - Number(a)))
  })

  it('finds the work of a Book without a work key by its ISBN', async () => {
    const fetch = recorded()
    const current = book({ isbn13: '9781526622419', source: 'apple', appleId: '1504159680' })
    const outcome = await createEditions({ fetch, languages: ['en'] }).find(current)
    expect(fetch.asked.some((url) => url.searchParams.get('isbn') === '9781526622419')).toBe(true)
    expect(outcome.candidates.length).toBeGreaterThan(10)
  })

  it('searches the title and first author in every source and keeps only editions of the Book', async () => {
    const fetch = recorded()
    // "Piranesi" with no first author asks exactly what the recordings know.
    const current = book({ title: 'Piranesi', authors: [], isbn13: '9790000000011', source: 'import' })
    const catalogue = catalogueOf([book({ title: 'Piranesi', isbn13: '9781526622426', coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' })])
    const outcome = await createEditions({ fetch, languages: ['en-US'], catalogue }).find(current)

    expect(catalogue.asked).toEqual(['Piranesi'])
    expect(fetch.asked.some((url) => url.hostname === 'itunes.apple.com' && url.searchParams.get('term') === 'Piranesi')).toBe(true)
    // Gibbon's histories and Piranesi as Designer share a word, not the title.
    for (const candidate of outcome.candidates) expect(candidate.book.title.toLowerCase()).toBe('piranesi')
    expect(outcome.candidates.length).toBeGreaterThan(2)
    expect(outcome.candidates.some((c) => c.book.isbn13 === '9781526622426')).toBe(true)
  })

  it('reports each source as it answers, and still lists what answered when one fails', async () => {
    const fetch = recorded({ failing: ['apple'] })
    const current = book({ openLibraryWorkKey: PIRANESI_WORK })
    const updates: EditionsOutcome[] = []
    const outcome = await createEditions({ fetch, languages: ['en'], catalogue: catalogueOf([], { failing: true }) }).find(current, {
      onUpdate: (update) => updates.push(update),
    })
    expect(updates.length).toBe(4)
    expect(updates.at(-1)!.pending).toBe(false)
    expect(outcome.failed).toBe(false)
    expect(outcome.candidates.length).toBeGreaterThan(1)
  })

  it('says so when every source fails, with the current edition still listed', async () => {
    const outcome = await createEditions({ fetch: recorded({ failing: ['apple', 'openlibrary'] }), languages: ['en'], catalogue: catalogueOf([], { failing: true }) })
      .find(book({ openLibraryWorkKey: PIRANESI_WORK }))
    expect(outcome.failed).toBe(true)
    expect(outcome.candidates).toHaveLength(1)
  })

  it('stops when the sheet closes', async () => {
    const controller = new AbortController()
    const found = createEditions({ fetch: recorded(), languages: ['en'] }).find(book({ openLibraryWorkKey: PIRANESI_WORK }), { signal: controller.signal })
    controller.abort()
    await expect(found).rejects.toMatchObject({ name: 'AbortError' })
  })
})

// ------------------------------------------------- changeEdition, on the stack

function edition(title: string, fields: Partial<BookSnapshot> = {}): BookSnapshot {
  return snapshot({ title: runTitle(title), publisher: TEST_PUBLISHER, appleId: uniqueAppleId(), ...fields })
}

const today = isoDay()

describe('changeEdition', () => {
  it('points the entry at the new edition and keeps its reads and Collections', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const collections = createCollections(member.client)
    const added = (await library.addToLibrary(edition('Piranesi', { pageCount: 400 }), {
      status: 'finished', startedOn: addDays(today, -30), endedOn: addDays(today, -20), rating: 17, review: 'The House is kind.',
    })).data as LibraryEntry
    expect((await library.readAgain(added.id, addDays(today, -2))).error).toBeNull()
    expect((await library.updateProgress(added.id, { page: 350 })).error).toBeNull()
    const shelf = (await collections.create(runTitle('Favourites'))).data!
    expect((await collections.addEntry(shelf.id, added.book)).error).toBeNull()
    const readsBefore = (await library.sessions(added.id)).data!

    const german = edition('Piranesi (German)', {
      language: 'de', pageCount: 272, coverUrl: 'https://covers.openlibrary.org/b/id/14609166-L.jpg',
    })
    const { data, error } = await library.changeEdition(added.id, german)

    expect(error).toBeNull()
    expect(data).toMatchObject({ id: added.id, status: 'reading', book: { title: german.title, appleId: german.appleId, pageCount: 272, coverUrl: german.coverUrl } })
    expect(data!.book.id).not.toBe(added.book.id)
    // Every read is still there, the finished one with its Rating and review; the open one's page clamped to 272.
    const readsAfter = (await library.sessions(added.id)).data!
    expect(readsAfter.map((read) => read.id)).toEqual(readsBefore.map((read) => read.id))
    expect(readsAfter.find((read) => read.outcome === 'finished')).toMatchObject({ rating: 17, review: 'The House is kind.' })
    expect(data!.latestSession).toMatchObject({ outcome: null, progressPage: 272 })
    // Still on the Collection, now with the new Book.
    expect((await collections.memberships(added.id)).data).toEqual([shelf.id])
    expect((await collections.get(shelf.id)).data!.entries.map((e) => e.book.id)).toEqual([data!.book.id])
    // The old edition is still in the Catalogue, and she can find her way back to it.
    expect((await library.book(added.book.id)).data).not.toBeNull()
    const back = await library.changeEdition(added.id, added.book)
    expect(back.data!.book.id).toBe(added.book.id)
  })

  it('refuses an edition she holds as another entry', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const dune = (await library.addToLibrary(edition('Dune'))).data!
    const emma = (await library.addToLibrary(edition('Emma'))).data!

    const { data, error } = await library.changeEdition(dune.id, emma.book)

    expect(data).toBeNull()
    expect(error).toBe('edition_in_library')
    expect((await library.entry(dune.id)).data!.book.id).toBe(dune.book.id)
  })

  it('does not touch another member\'s entry', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const shared = edition('Solaris')
    const maxEntry = (await createLibrary(max.client).addToLibrary(shared)).data!

    const { error } = await createLibrary(ida.client).changeEdition(maxEntry.id, edition('Solaris (other)'))

    expect(error).toBe('entry_not_found')
    expect((await createLibrary(max.client).entry(maxEntry.id)).data!.book.id).toBe(maxEntry.book.id)
  })

  it('switches a Manual book to a Catalogue edition, and the Manual book is gone', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const manual = (await createManualBooks(member.client).addManualBook(
      { title: runTitle('Todesmarsch'), author: 'Richard Bachman', pageCount: '363' },
      { status: 'finished', endedOn: addDays(today, -10), rating: 14 },
    )).data!

    const { data, error } = await library.changeEdition(manual.id, edition('Todesmarsch', { authors: ['Stephen King'] }))

    expect(error).toBeNull()
    expect(data).toMatchObject({ id: manual.id, status: 'finished', book: { source: 'apple', authors: ['Stephen King'] }, latestSession: { rating: 14 } })
    const [left] = await sql<{ n: number }>('select count(*)::int as n from public.books where id = $1', [manual.book.id])
    expect(left!.n).toBe(0)
  })

  it('is refused offline without sending anything', async () => {
    const member = await signUpMember()
    const entry = (await createLibrary(member.client).addToLibrary(edition('Kindred'))).data!
    const offline = createLibrary(member.client, { online: () => false })

    expect(await offline.changeEdition(entry.id, edition('Kindred (other)'))).toEqual({ data: null, error: 'offline' })
    expect((await createLibrary(member.client).entry(entry.id)).data!.book.id).toBe(entry.book.id)
  })
})
