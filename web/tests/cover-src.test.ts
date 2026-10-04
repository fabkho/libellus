import { describe, expect, it } from 'vitest'
import { APPLE_BOX, coverSrc, type CoverSize } from '@/utils/cover'

/**
 * The image a cover asks for at each size (issue #63, docs/covers.md): about
 * three times its width on Apple's CDN, OpenLibrary's 'M' for the small ones.
 */

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bfb35c-53b3-7373-ad0e-561c68761d74/9780593983768.d.jpg/600x900bb.jpg'
const OPENLIBRARY = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
/** The tokens' cover widths (`size.cover.*`, tokens.generated.css). */
const WIDTH: Record<CoverSize, number> = { xs: 30, sm: 40, md: 72, lg: 82, xl: 140 }

describe('the image a cover asks for', () => {
  it('asks Apple for a list row at 120 × 180, not the book page’s 600 × 900', () => {
    expect(coverSrc(APPLE, 'sm')).toBe(APPLE.replace('600x900bb', '120x180bb'))
    // The Add sheet's small cover shares the search row's image.
    expect(coverSrc(APPLE, 'xs')).toBe(coverSrc(APPLE, 'sm'))
    expect(coverSrc(APPLE, 'md')).toBe(APPLE.replace('600x900bb', '240x360bb'))
    expect(coverSrc(APPLE, 'xl')).toBe(APPLE)
  })

  it.each(Object.keys(WIDTH) as CoverSize[])('asks Apple for %s at 2.5–4.5× its width, in 2:3', (size) => {
    const [width, height] = APPLE_BOX[size]
    expect(width / WIDTH[size]).toBeGreaterThanOrEqual(2.5)
    expect(width / WIDTH[size]).toBeLessThanOrEqual(4.5)
    expect(height / width).toBe(1.5)
  })

  it('resizes Apple artwork from whatever size it was stored or found at', () => {
    const found = 'https://is3-ssl.mzstatic.com/image/thumb/Publication/v4/1.jpg/100x100bb.jpg'
    expect(coverSrc(found, 'sm')).toBe('https://is3-ssl.mzstatic.com/image/thumb/Publication/v4/1.jpg/120x180bb.jpg')
  })

  it('asks OpenLibrary for its medium up to md and its large above, never its 38 px small', () => {
    expect(coverSrc(OPENLIBRARY, 'xs')).toBe('https://covers.openlibrary.org/b/id/8231856-M.jpg')
    expect(coverSrc(OPENLIBRARY, 'sm')).toBe('https://covers.openlibrary.org/b/id/8231856-M.jpg')
    expect(coverSrc(OPENLIBRARY, 'md')).toBe('https://covers.openlibrary.org/b/id/8231856-M.jpg')
    expect(coverSrc(OPENLIBRARY, 'lg')).toBe(OPENLIBRARY)
    expect(coverSrc(OPENLIBRARY, 'xl')).toBe(OPENLIBRARY)
    for (const size of Object.keys(WIDTH) as CoverSize[]) expect(coverSrc(OPENLIBRARY, size)).not.toMatch(/-S\.jpg/)
  })

  it('keeps OpenLibrary’s ISBN covers a 404 when there is none', () => {
    expect(coverSrc('https://covers.openlibrary.org/b/isbn/9783150160671-L.jpg?default=false', 'sm')).toBe(
      'https://covers.openlibrary.org/b/isbn/9783150160671-M.jpg?default=false',
    )
  })

  it('leaves other images as they are, and no URL no image', () => {
    expect(coverSrc('https://example.test/cover.png', 'sm')).toBe('https://example.test/cover.png')
    expect(coverSrc(null, 'sm')).toBeNull()
    expect(coverSrc('', 'sm')).toBeNull()
  })
})
