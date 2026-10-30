import { describe, expect, it } from 'vitest'
import { coversToPrefetch, workCover } from '@/utils/enrich'

/**
 * The cover a work's row shows, and the ones "More from the author" asks for
 * ahead of its rows (A9, docs/covers.md). A work card has a cover URL and an
 * edition with an ISBN, no thumbhash or colours. What it tries when the image
 * fails is UiCover's, the same artwork at its other sizes (tests/cover-src.test.ts).
 */

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bfb35c/9780593983768.d.jpg/600x900bb.jpg'
const OL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'

describe('the cover a work row shows', () => {
  it('is the card’s (work_card chose it for what the row opens), and none where the card has none', () => {
    expect(workCover({ coverUrl: APPLE })).toBe(APPLE)
    // Her Book, or the Catalogue's, has no cover: its page shows the Placeholder, so the row does too,
    // whatever cover the edition's record names.
    expect(workCover({ coverUrl: undefined })).toBeNull()
    expect(workCover({})).toBeNull()
  })
})

describe('the covers to ask for ahead of the rows', () => {
  const works = [{ coverUrl: OL }, { coverUrl: APPLE }, {}, { coverUrl: OL }, { coverUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg' }]

  it('is each work’s image at the row’s size, each once, without the works that have none', () => {
    expect(coversToPrefetch(works, 'sm', {}, 10)).toEqual([
      'https://covers.openlibrary.org/b/id/8231856-M.jpg',
      APPLE.replace('600x900bb', '120x180bb'),
      'https://covers.openlibrary.org/b/id/1-M.jpg',
    ])
  })

  it('stops at the limit', () => {
    expect(coversToPrefetch(works, 'sm', {}, 2)).toHaveLength(2)
    expect(coversToPrefetch(works, 'sm', {}, 0)).toEqual([])
  })

  // The hosts the rows draw with (utils/coverRef.ts), so the prefetch is the address the row will ask for: our copy where the
  // card has one, `/cover` when the hosts allow it, the source otherwise (docs/plans/owned-covers.md §5).
  it('asks for what the row will draw, on the build it is drawn on', () => {
    const key = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
    const keyed = [{ coverUrl: APPLE, coverKey: key, coverWidths: [120, 240, 360, 600] }]
    expect(coversToPrefetch(keyed, 'sm', { own: true }, 10)).toEqual([`/c/${key}/120`])
    expect(coversToPrefetch(keyed, 'sm', { proxy: true }, 10)).toEqual([`/cover?u=${encodeURIComponent(APPLE.replace('600x900bb', '120x180bb'))}&w=120`])
    // The switch off: the source, whatever the card carries (`proxy: false` is what every section but the reel is handed).
    expect(coversToPrefetch(keyed, 'sm', { own: false, proxy: false }, 10)).toEqual([APPLE.replace('600x900bb', '120x180bb')])
  })
})
