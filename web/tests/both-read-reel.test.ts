import { describe, expect, it } from 'vitest'
import { BOTH_READ_REEL_LIMIT, REEL_ASSET_KEYS, REEL_BOOK_KEYS, bothReadReelDocument, reelItems, reelPreloadUrls, sameReelBooks } from '../app/data/bothReadReel'
import { validateLibraryFile } from '../app/data/export/regalLibraryFile'
import type { BothRead } from '../app/data/socialShapes'
import { bookColour } from '../app/utils/bookColour'

/**
 * "You both read" as Regal's reel (data/bothReadReel.ts): the document carries only the whitelisted keys of a
 * friend's data (the privacy test), manual and unverified Books, colours, cover sizes, the cap. Synthetic data.
 */

const OUTSIDE = 'Outside the catalogue'
let counter = 0

function item(over: Partial<BothRead['book']> = {}, hers: Partial<BothRead['hers']> = {}): BothRead {
  counter++
  return {
    book: {
      id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
      title: `Shared ${counter}`,
      authors: ['A. Writer', 'B. Writer'],
      year: 2019,
      coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/${counter}.jpg/600x900bb.jpg`,
      coverThumbhash: null,
      coverColors: { dominant: '#1f3f5b', secondary: '#d9c9a3' },
      manual: false,
      unverified: false,
      ...over,
    },
    hers: { rating: 18, endedOn: '2026-03-02', ...hers },
    mine: { rating: 12, endedOn: '2026-01-05' },
  }
}

const docOf = (items: BothRead[], limit?: number) => bothReadReelDocument(items, { outside: OUTSIDE, generatedAt: '2026-10-28T09:00:00Z', limit })

describe('bothReadReelDocument', () => {
  it('is a valid Regal library file', () => {
    const result = validateLibraryFile(docOf([item(), item({ coverUrl: null, coverColors: null }), item({ manual: true })]))
    expect(result.ok).toBe(true)
  })

  it('carries only the whitelisted keys of a friend’s data (the privacy test)', () => {
    const rich = item({}, { rating: 20, endedOn: '2026-09-09' })
    // What a later change might be tempted to add: nothing of it may reach the component.
    Object.assign(rich.book, { review: 'Spoiler: she dies', description: 'A blurb', pageCount: 412, isbn13: '9780000000002' })
    const doc = docOf([rich, item()])
    for (const book of doc.books) {
      expect(Object.keys(book).sort()).toEqual([...REEL_BOOK_KEYS].filter((key) => key in book).sort())
      for (const key of Object.keys(book.assets ?? {})) expect(REEL_ASSET_KEYS as readonly string[]).toContain(key)
      expect(book.status).toBe('read')
    }
    expect(Object.keys(doc).sort()).toEqual(['books', 'generatedAt', 'generator', 'version'])
    // No rating, no day, none of the caller's own read, no free text, anywhere in the serialised document.
    const text = JSON.stringify(doc)
    for (const leak of ['Spoiler', 'A blurb', '412', '9780000000002', '2026-09-09', '2026-03-02', '2026-01-05', 'rating', 'hers', 'mine', 'dateRead', 'review', 'pages']) {
      expect(text).not.toContain(leak)
    }
  })

  it('keeps her edition’s id, title and authors in the order of the answer (her newest first)', () => {
    const items = [item(), item(), item()]
    const doc = docOf(items)
    expect(doc.books.map((b) => b.id)).toEqual(items.map((i) => i.book.id))
    expect(doc.books[0]).toMatchObject({ title: items[0]!.book.title, authors: ['A. Writer', 'B. Writer'] })
  })

  it('draws the cover at xl in front and md in the pile; the colour is the Book’s one colour', () => {
    const only = item()
    const [book] = docOf([only]).books
    expect(book!.assets!.front).toContain('600x900')
    expect(book!.assets!.pile!.front).toContain('240x360')
    expect(book!.assets!.color).toBe(bookColour(only.book).colour)
  })

  it('a Book without a cover has no image and its Placeholder’s colour', () => {
    const bare = item({ coverUrl: null, coverColors: null })
    const [book] = docOf([bare]).books
    expect(book!.assets).toEqual({ color: bookColour(bare.book).colour })
  })

  it('a Manual book is drawn as any other', () => {
    const [book] = docOf([item({ manual: true })]).books
    expect(book!.title).toMatch(/^Shared/)
    expect(book!.assets!.front).toBeTruthy()
  })

  it('an unverified Book is the one string: no title, authors or cover of it reach the document', () => {
    const secret = item({ title: 'Secret Title', authors: ['Secret Author'], unverified: true })
    const doc = docOf([secret])
    const text = JSON.stringify(doc)
    expect(doc.books[0]).toMatchObject({ title: OUTSIDE, authors: [] })
    expect(doc.books[0]!.assets).toEqual({ color: bookColour({ title: OUTSIDE, coverUrl: null, coverColors: null, coverThumbhash: null }).colour })
    expect(text).not.toContain('Secret')
    expect(text).not.toContain('mzstatic')
  })

  it('caps the reel at the newest 24 and keeps a Book once', () => {
    const many = Array.from({ length: 300 }, () => item())
    expect(docOf(many).books).toHaveLength(BOTH_READ_REEL_LIMIT)
    expect(docOf(many).books[0]!.id).toBe(many[0]!.book.id)
    const again = item()
    expect(reelItems([again, item(), again])).toHaveLength(2)
    expect(docOf(many, 5).books).toHaveLength(5)
  })

  it('is empty for no Books', () => {
    expect(docOf([]).books).toEqual([])
  })
})

describe('sameReelBooks', () => {
  it('holds when the same answer arrives again, whatever the time or the array', () => {
    const items = [item(), item()]
    const first = bothReadReelDocument(items, { outside: OUTSIDE, generatedAt: '2026-10-28T09:00:00Z' })
    const again = bothReadReelDocument(structuredClone(items), { outside: OUTSIDE, generatedAt: '2026-10-28T09:05:00Z' })
    expect(sameReelBooks(first, again)).toBe(true)
  })
  it('breaks when a Book, its cover or the order changes', () => {
    const items = [item(), item()]
    const base = docOf(items)
    expect(sameReelBooks(base, docOf([items[1]!, items[0]!]))).toBe(false)
    expect(sameReelBooks(base, docOf([items[0]!]))).toBe(false)
    expect(sameReelBooks(base, docOf([items[0]!, item({ coverUrl: null })]))).toBe(false)
  })
  it('changes with the language of the one string an unverified Book shows', () => {
    const items = [item({ unverified: true })]
    expect(sameReelBooks(docOf(items), bothReadReelDocument(items, { outside: 'Außerhalb des Katalogs' }))).toBe(false)
  })
})

describe('reelPreloadUrls (the covers to warm before the reel is there)', () => {
  const doc = (count: number) => ({
    version: 1,
    generatedAt: '',
    generator: '',
    books: Array.from({ length: count }, (_, i) => ({ id: `b${i}`, title: `T${i}`, authors: [], status: 'read', assets: { front: `https://x/${i}-xl.jpg`, pile: { front: `https://x/${i}-md.jpg` } } })),
  }) as never
  it('takes the five Books the arc starts with: the last two and the first three, by the copy the canvas reads', () => {
    expect(reelPreloadUrls(doc(12))).toEqual([
      'https://x/11-md.jpg',
      'https://x/10-md.jpg',
      'https://x/0-md.jpg',
      'https://x/1-md.jpg',
      'https://x/2-md.jpg',
      'https://x/11-xl.jpg',
    ])
  })
  it('takes every Book of a short reel, once each, and nothing for none', () => {
    expect(reelPreloadUrls(doc(2)).slice(0, 2)).toEqual(['https://x/0-md.jpg', 'https://x/1-md.jpg'])
    expect(reelPreloadUrls(doc(0))).toEqual([])
  })
})
