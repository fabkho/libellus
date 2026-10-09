import { describe, expect, it } from 'vitest'
import type { AuthorPage, BookAuthor } from '@/data/enrich'
import type { WorkCard } from '@/data/enrich/works'
import type { StartedSeries } from '@/data/enrich/series'
import { DEVICE_ENRICH_KEY, emptyCopy, readEnrichCopy, remembered, saveEnrichCopy } from '@/data/enrich/device'
import {
  authorInitials,
  authorParts,
  isCurrentWork,
  moreFromAuthor,
  lifeSpan,
  moveMuted,
  parsePosition,
  positionText,
  rowAuthorKey,
  sameName,
  seriesLine,
  nextPlace,
  startedOnHome,
  workBookKey,
} from '@/utils/enrich'
import type { DeviceStorage } from '@/data/localData'

/**
 * What the author pages, the series line and Home's "Next in your series"
 * (issue #167) make of the enrichment data, and the device's copy of it.
 */

function memoryStorage(): DeviceStorage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

const pratchett: BookAuthor = { position: 1, name: 'Terry Pratchett', authorId: 'a1', key: 'Q46248' }
const gaiman: BookAuthor = { position: 2, name: 'Neil Gaiman', authorId: 'a2', key: 'Q210059' }

describe('the hero', () => {
  it('reads life dates by year, whatever their precision', () => {
    expect(lifeSpan({ date: '1948-04-28', precision: 11 }, { date: '2015-03-12', precision: 11 })).toEqual({ kind: 'span', born: 1948, died: 2015 })
    expect(lifeSpan({ date: '1943-01-01', precision: 9 }, undefined)).toEqual({ kind: 'born', born: 1943 })
    expect(lifeSpan(undefined, { date: '1616-04-23', precision: 11 })).toEqual({ kind: 'died', died: 1616 })
    expect(lifeSpan(undefined, undefined)).toBeNull()
  })

  it('puts the first and last name in the ring', () => {
    expect(authorInitials('Ursula K. Le Guin')).toBe('UG')
    expect(authorInitials('Homer')).toBe('H')
    expect(authorInitials('')).toBe('?')
  })

})

describe('the series line', () => {
  it('says "Book n of count" for a whole place within the count', () => {
    expect(seriesLine({ name: 'The Expanse', position: 2, count: 9 })).toEqual({ name: 'The Expanse', position: '2', count: 9 })
  })

  it('leaves the count out for a novella between two, a place past the count, or a series of one', () => {
    expect(seriesLine({ name: 'The Expanse', position: 2.5, count: 9 })).toEqual({ name: 'The Expanse', position: '2.5', count: null })
    expect(seriesLine({ name: 'Earthsea', position: 0.5, count: 6 })).toEqual({ name: 'Earthsea', position: '0.5', count: null })
    expect(seriesLine({ name: 'Mine', position: 4, count: 2 })).toEqual({ name: 'Mine', position: '4', count: null })
    expect(seriesLine({ name: 'Mine', position: 1, count: 1 })?.count).toBeNull()
  })

  it('is the name alone where the series gives no place, and nothing for no series', () => {
    expect(seriesLine({ name: 'Discworld', position: null, count: 41 })).toEqual({ name: 'Discworld', position: null, count: null })
    expect(seriesLine(undefined)).toBeNull()
  })

  it('writes places as they are read', () => {
    expect(positionText(2)).toBe('2')
    expect(positionText(2.5)).toBe('2.5')
    expect(positionText(2.25)).toBe('2.25')
    expect(positionText(null)).toBeNull()
  })

  it('takes the place she types, a comma for the point too', () => {
    expect(parsePosition('2')).toBe(2)
    expect(parsePosition(' 2,5 ')).toBe(2.5)
    expect(parsePosition('')).toBeNull()
    expect(parsePosition('two')).toBe('invalid')
    expect(parsePosition('-1')).toBe('invalid')
    expect(parsePosition('10000')).toBe('invalid')
    expect(parsePosition('1.234')).toBe('invalid')
  })
})

describe('where a work opens', () => {
  it('opens her Book, else the edition in her language by ISBN, else by Open Library edition', () => {
    expect(workBookKey({ entry: { entryId: 'e', bookId: 'b1', status: 'finished' } })).toBe('b1')
    expect(workBookKey({ edition: { title: 'Mort', isbn13: '9780552131063', openlibrary_edition_key: 'OL1M', cover_url: null } })).toBe('isbn-9780552131063')
    expect(workBookKey({ edition: { title: 'Mort', isbn13: null, openlibrary_edition_key: 'OL7353617M', cover_url: null } })).toBe('ol-OL7353617M')
    expect(workBookKey({ edition: { title: 'Mort', isbn13: '123', openlibrary_edition_key: null, cover_url: null } })).toBeNull()
    expect(workBookKey({})).toBeNull()
  })
})

const work = (title: string, extra: Partial<WorkCard> = {}): WorkCard => ({
  workId: `w-${title}`,
  title,
  edition: { title, isbn13: null, openlibrary_edition_key: `OL${title.length}M`, cover_url: null },
  ...extra,
})
const pageOf = (parts: Partial<AuthorPage> = {}, author: Partial<AuthorPage['author']> = {}): AuthorPage => ({
  author: { id: 'a1', key: 'Q46248', name: 'Terry Pratchett', ...author },
  genres: [],
  series: [],
  standalone: [],
  other: [],
  stale: false,
  ...parts,
})
const ISBN = '9780552131063'
const reading = { bookId: 'b-mort', key: 'b-mort', isbn13: null, title: 'Mort' }

describe('more from the author', () => {
  it('tells the Book the page is on by her entry, its key, its ISBN or its title', () => {
    expect(isCurrentWork(work('Other', { entry: { entryId: 'e', bookId: 'b-mort', status: 'reading' } }), reading)).toBe(true)
    expect(isCurrentWork(work('Mort', { edition: { title: 'Mort', isbn13: '9780552131063', openlibrary_edition_key: null, cover_url: null } }), { ...reading, bookId: null, key: `isbn-${ISBN}` })).toBe(true)
    expect(isCurrentWork(work('Other', { edition: { title: 'Other', isbn13: '9780552131063', openlibrary_edition_key: 'OL9M', cover_url: null } }), { ...reading, bookId: null, isbn13: '9780552131063' })).toBe(true)
    expect(isCurrentWork(work('MORT'), reading)).toBe(true)
    expect(isCurrentWork(work('Guards! Guards!'), reading)).toBe(false)
  })

  it('offers three of her other works, those that open a Book first, each once, in the page order', () => {
    const none = { workId: 'w-x', title: 'Nothing to open' }
    const page = pageOf({
      series: [{ id: 's1', name: 'Discworld', works: [work('Mort'), none, work('Eric'), work('Sourcery')] }],
      standalone: [work('Nation'), work('Eric')],
      other: [work('Dodger')],
    })
    const more = moreFromAuthor(page, reading)
    expect(more?.works.map((w) => w.title)).toEqual(['Eric', 'Sourcery', 'Nation'])
    expect(more?.total).toBe(6)
    expect(more?.more).toBe(true)
  })

  it('has no "Show all" when everything is shown, and shows what is left of a short list', () => {
    const more = moreFromAuthor(pageOf({ standalone: [work('Mort'), work('Nation')] }), reading)
    expect(more?.works.map((w) => w.title)).toEqual(['Nation'])
    expect(more?.more).toBe(false)
  })

  it('is nothing for no page, or an author known by her name alone with nothing else of hers', () => {
    expect(moreFromAuthor(null, reading)).toBeNull()
    expect(moreFromAuthor(pageOf({ standalone: [work('Mort')] }), reading)).toBeNull()
  })

  it('still shows an author with a photo, dates or intro when this is her only known work', () => {
    const born = { date: '1948-04-28T00:00:00Z', precision: 11 as const }
    const more = moreFromAuthor(pageOf({ standalone: [work('Mort')] }, { born }), reading)
    expect(more?.works).toEqual([])
    expect(more?.author.name).toBe('Terry Pratchett')
  })

  it('shows works of an author with nothing but the name', () => {
    expect(moreFromAuthor(pageOf({ standalone: [work('Mort'), work('Nation')] }), reading)?.works).toHaveLength(1)
  })
})

describe('the author line', () => {
  it('links each credited name to the linked author of that name', () => {
    expect(authorParts(['Terry Pratchett', 'Neil Gaiman'], [pratchett, gaiman], 'et al.')).toEqual([
      { text: 'Terry Pratchett', key: 'Q46248' },
      { text: ' & ', separator: true },
      { text: 'Neil Gaiman', key: 'Q210059' },
    ])
  })

  it('links a single author the edition spells differently, but never guesses between several', () => {
    expect(authorParts(['T. Pratchett'], [pratchett], 'et al.')).toEqual([{ text: 'T. Pratchett', key: 'Q46248' }])
    expect(authorParts(['T. Pratchett', 'N. Gaiman'], [pratchett, gaiman], 'et al.')).toEqual([
      { text: 'T. Pratchett' },
      { text: ' & ', separator: true },
      { text: 'N. Gaiman' },
    ])
  })

  it('keeps a translator the edition credits as text, and the line\'s "et al." shape', () => {
    expect(authorParts(['Stanisław Lem', 'Michael Kandel'], [{ ...pratchett, name: 'Stanislaw Lem', key: 'Q42' }], 'et al.')).toEqual([
      { text: 'Stanisław Lem', key: 'Q42' },
      { text: ' & ', separator: true },
      { text: 'Michael Kandel' },
    ])
    expect(authorParts(['A', 'B', 'C'], [], 'et al.')).toEqual([{ text: 'A' }, { text: ' et al.', separator: true }])
  })

  it('compares names without case, accents or dots', () => {
    expect(sameName('Ursula K. Le Guin', 'ursula k le guin')).toBe(true)
    expect(sameName('Stanisław Lem', 'Stanislaw Lem')).toBe(true)
    expect(sameName('Terry Pratchett', 'Neil Gaiman')).toBe(false)
  })

  it('opens a list row\'s author by the first in credit order', () => {
    expect(rowAuthorKey([gaiman, pratchett])).toBe('Q46248')
    expect(rowAuthorKey([])).toBeNull()
    expect(rowAuthorKey(undefined)).toBeNull()
  })
})

describe('next in your series', () => {
  const item = (title: string, isbn: string | null = '9780552131063', position: number | null = 2, count?: number): StartedSeries => ({
    series: { id: title, name: 'Discworld' },
    finished: 1,
    ...(count ? { count } : {}),
    next: {
      title,
      ...(position === null ? {} : { position }),
      edition: { title, isbn13: isbn, openlibrary_edition_key: null, cover_url: null },
    },
  })

  it('lists five at most and says whether there are more, leaving out one with nothing to open', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((t) => item(t))
    expect(startedOnHome(six).shown.map((i) => i.next.title)).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(startedOnHome(six).more).toBe(true)
    expect(startedOnHome(six).all).toHaveLength(6)

    const five = ['A', 'B', 'C', 'D', 'E'].map((t) => item(t))
    expect(startedOnHome(five).more).toBe(false)
    expect(startedOnHome([...five.slice(0, 4), item('X', null), item('Y')]).all.map((i) => i.next.title)).toEqual(['A', 'B', 'C', 'D', 'Y'])
  })

  it('moves a muted series to the muted list and back, each in the database\'s order', () => {
    const at = (title: string, activeOn: string): StartedSeries => ({ ...item(title), activeOn })
    const a = at('A', '2026-09-03')
    const b = at('B', '2026-09-01')
    const c = at('C', '2026-09-02')
    const muted = moveMuted({ started: [a, b, c], muted: [] }, 'B', true)
    expect(muted.started.map((i) => i.next.title)).toEqual(['A', 'C'])
    expect(muted.muted.map((i) => i.next.title)).toEqual(['B'])

    const back = moveMuted({ started: muted.started, muted: [...muted.muted, c] }, 'C', false)
    expect(back.started.map((i) => i.next.title)).toEqual(['A', 'C'])
    expect(back.muted.map((i) => i.next.title)).toEqual(['B'])
    const both = moveMuted(muted, 'B', false)
    expect(both.started.map((i) => i.next.title)).toEqual(['A', 'C', 'B'])
    expect(both.muted).toEqual([])
    // A series not in the list it leaves changes nothing.
    expect(moveMuted(muted, 'Z', true)).toEqual(muted)
  })

  it('says where the next work stands: of the count when it is whole and within it', () => {
    expect(nextPlace(item('A', undefined, 3, 10))).toEqual({ n: '3', count: 10 })
    expect(nextPlace(item('A', undefined, 2.5, 10))).toEqual({ n: '2.5', count: null })
    expect(nextPlace(item('A', undefined, 12, 10))).toEqual({ n: '12', count: null })
    expect(nextPlace(item('A', undefined, 3))).toEqual({ n: '3', count: null })
    expect(nextPlace(item('A', undefined, null, 10))).toBeNull()
  })
})

describe('the device\'s copy', () => {
  it('keeps what was read for the member who read it, and never shows it to another', () => {
    const storage = memoryStorage()
    const copy = { ...emptyCopy('ada'), bookAuthors: { b1: [pratchett] } }
    expect(saveEnrichCopy(storage, copy)).toBe(true)
    expect(readEnrichCopy(storage, 'ada').bookAuthors).toEqual({ b1: [pratchett] })
    expect(readEnrichCopy(storage, 'bea')).toEqual(emptyCopy('bea'))
  })

  it('forgets a torn copy', () => {
    const storage = memoryStorage()
    storage.setItem(DEVICE_ENRICH_KEY, '{"version":1,"data":')
    expect(readEnrichCopy(storage, 'ada')).toEqual(emptyCopy('ada'))
    expect(storage.getItem(DEVICE_ENRICH_KEY)).toBeNull()
  })

  it('keeps the newest first and drops the oldest past the limit', () => {
    let record: Record<string, number> = {}
    for (const key of ['Q1', 'Q2', 'Q3']) record = remembered(record, key, 0, 2)
    expect(Object.keys(record)).toEqual(['Q3', 'Q2'])
    record = remembered(record, 'Q2', 1, 2)
    expect(record).toEqual({ Q2: 1, Q3: 0 })
    expect(Object.keys(record)).toEqual(['Q2', 'Q3'])
  })
})
