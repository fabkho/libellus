import { describe, expect, it } from 'vitest'
import { betterCover, COVER_KINDS, coverKindOf, kindRank, isLent } from '@/data/coverRank'

/** The one ranking of covers (data/coverRank.ts): pure, so a table is the whole test. */
describe('the cover ranking', () => {
  it('goes edition-exact, Hardcover\'s image of her edition, the work\'s ebook, another edition, Goodreads, the cloth', () => {
    expect(COVER_KINDS).toEqual(['exact', 'hardcover', 'ebook', 'sameWork', 'goodreads', 'placeholder'])
    expect(COVER_KINDS.map(kindRank)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('ranks a Hardcover cover right after the edition\'s own, before every lent kind', () => {
    expect(betterCover('hardcover', 'exact')).toBe('exact')
    expect(betterCover('ebook', 'hardcover')).toBe('hardcover')
    expect(betterCover('sameWork', 'hardcover')).toBe('hardcover')
    expect(betterCover('goodreads', 'hardcover')).toBe('hardcover')
    expect(betterCover('hardcover', 'ebook')).toBe('hardcover')
  })

  it('has the better of two kinds win, and the first on a tie', () => {
    expect(betterCover('sameWork', 'ebook')).toBe('ebook')
    expect(betterCover('ebook', 'exact')).toBe('exact')
    expect(betterCover('goodreads', 'sameWork')).toBe('sameWork')
    expect(betterCover('goodreads', 'placeholder')).toBe('goodreads')
    expect(betterCover('ebook', 'ebook')).toBe('ebook')
  })

  it('reads the kind off the source and the address: Apple is the ebook, Open Library by ISBN the edition itself', () => {
    expect(coverKindOf('openlibrary', 'https://covers.openlibrary.org/b/id/1-L.jpg')).toBe('exact')
    expect(coverKindOf('search', 'https://is1-ssl.mzstatic.com/image/thumb/x/200x300bb.jpg')).toBe('ebook')
    expect(coverKindOf('sibling', 'https://is1-ssl.mzstatic.com/image/thumb/x/200x300bb.jpg')).toBe('ebook')
    expect(coverKindOf('sibling', 'https://covers.openlibrary.org/b/id/1-L.jpg')).toBe('sameWork')
    expect(coverKindOf('work', 'https://covers.openlibrary.org/b/id/1-L.jpg')).toBe('sameWork')
    expect(coverKindOf('goodreads', 'https://i.gr-assets.com/images/x.jpg')).toBe('goodreads')
    expect(coverKindOf('hardcover', 'https://assets.hardcover.app/edition/1/x.jpg')).toBe('hardcover')
  })

  it('lends every kind but the edition itself (and the cloth, which is no image)', () => {
    expect(COVER_KINDS.filter(isLent)).toEqual(['hardcover', 'ebook', 'sameWork', 'goodreads'])
  })
})
