import { describe, expect, it } from 'vitest'
import { betterCover, COVER_KINDS, coverKindOf, coverRank, isLent } from '@/data/coverRank'

/** The one ranking of covers (data/coverRank.ts): pure, so a table is the whole test. */
describe('the cover ranking', () => {
  it('goes edition-exact, the work\'s ebook, another edition, Goodreads, the cloth', () => {
    expect(COVER_KINDS).toEqual(['exact', 'ebook', 'sameWork', 'goodreads', 'placeholder'])
    expect(COVER_KINDS.map(coverRank)).toEqual([0, 1, 2, 3, 4])
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
  })

  it('lends every kind but the edition itself (and the cloth, which is no image)', () => {
    expect(COVER_KINDS.filter(isLent)).toEqual(['ebook', 'sameWork', 'goodreads'])
  })
})
