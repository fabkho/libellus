import { describe, expect, it } from 'vitest'
import { coversToPrefetch, workCoverImages } from '@/utils/enrich'

/**
 * The covers a work's row asks for, and the ones "More from the author" asks
 * for ahead of its rows (A9, docs/covers.md). A work card has a cover URL and
 * an edition with an ISBN, no thumbhash or colours.
 */

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bfb35c/9780593983768.d.jpg/600x900bb.jpg'
const OL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
const edition = (isbn13: string | null, cover_url: string | null = null) => ({ title: null, isbn13, openlibrary_edition_key: null, cover_url })

describe('the images a work row asks for', () => {
  it('asks the row’s size, and falls back to OpenLibrary’s cover of the edition by ISBN', () => {
    expect(workCoverImages({ coverUrl: APPLE, edition: edition('9780593983768') }, 'sm')).toEqual({
      src: APPLE.replace('600x900bb', '120x180bb'),
      fallbacks: ['https://covers.openlibrary.org/b/isbn/9780593983768-M.jpg?default=false'],
    })
  })

  it('takes the edition’s cover when the work has none of its own', () => {
    expect(workCoverImages({ edition: edition(null, OL) }, 'sm')).toEqual({ src: 'https://covers.openlibrary.org/b/id/8231856-M.jpg', fallbacks: [] })
  })

  it('has no fallback without an ISBN, and nothing without a cover', () => {
    expect(workCoverImages({ coverUrl: OL, edition: edition(null) }, 'sm').fallbacks).toEqual([])
    expect(workCoverImages({}, 'sm')).toEqual({ src: null, fallbacks: [] })
  })
})

describe('the covers to ask for ahead of the rows', () => {
  const works = [{ coverUrl: OL }, { coverUrl: APPLE }, {}, { coverUrl: OL }, { coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' }]

  it('is each work’s image at the row’s size, each once, without the works that have none', () => {
    expect(coversToPrefetch(works, 'sm', 10)).toEqual([
      'https://covers.openlibrary.org/b/id/8231856-M.jpg',
      APPLE.replace('600x900bb', '120x180bb'),
      'https://covers.openlibrary.org/b/id/1-M.jpg',
    ])
  })

  it('stops at the limit', () => {
    expect(coversToPrefetch(works, 'sm', 2)).toHaveLength(2)
    expect(coversToPrefetch(works, 'sm', 0)).toEqual([])
  })
})
