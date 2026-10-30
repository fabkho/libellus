import { describe, expect, it } from 'vitest'
import { COVER_WIDTHS, coverFor, coverIsCacheable, coverPixels, coverProxyUrl, coverVariant, coverWidthFor, parseCoverRequest, unproxied } from '@/utils/coverSize'
import { artworkOf, coverChain, coverSrc, coverSrcset } from '@/utils/cover'

/**
 * A cover at the size it is shown at (utils/coverSize.ts) and the address of our own cache (`/cover`,
 * functions/cover.js): Apple's and Open Library's patterns as the production data has them, the widths the
 * cache serves, hosts that pass through, and what the chain does when the cache is not there.
 */

const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bfb35c-53b3-7373-ad0e-561c68761d74/9780593983768.d.jpg/600x900bb.jpg'
const apple = (box: string) => APPLE.replace('600x900bb', `${box}bb`)
const OL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
const OL_ISBN = 'https://covers.openlibrary.org/b/isbn/9780141439518-L.jpg?default=false'

describe('the size a cover needs', () => {
  it('is its CSS width, or the 2:3 width of its height, times the pixel ratio', () => {
    expect(coverPixels({ height: 300, dpr: 2 })).toBe(400)
    expect(coverPixels({ width: 40, dpr: 3 })).toBe(120)
    expect(coverPixels({ width: 100, height: 300, dpr: 1 })).toBe(200)
    expect(coverPixels({ height: 300 })).toBe(200)
  })

  it('takes a pixel ratio that is nonsense for 1', () => {
    expect(coverPixels({ width: 100, dpr: 0 })).toBe(100)
    expect(coverPixels({ width: 100, dpr: Number.NaN })).toBe(100)
  })

  it('is met by the smallest width of the cache that is at least that, the largest when none is', () => {
    expect(coverWidthFor(1)).toBe(120)
    expect(coverWidthFor(120)).toBe(120)
    expect(coverWidthFor(121)).toBe(240)
    expect(coverWidthFor(400)).toBe(480)
    expect(coverWidthFor(600)).toBe(600)
    expect(coverWidthFor(900)).toBe(600)
    expect([...COVER_WIDTHS]).toEqual([...COVER_WIDTHS].sort((a, b) => a - b))
  })
})

describe('an Apple cover at a size', () => {
  it('keeps the file and the 2:3 box, whatever size it was stored at', () => {
    expect(coverVariant(APPLE, 100)).toBe(apple('120x180'))
    expect(coverVariant(APPLE, 240)).toBe(apple('240x360'))
    expect(coverVariant(apple('120x180'), 400)).toBe(apple('480x720'))
    expect(coverVariant(apple('100x100'), 600)).toBe(APPLE)
  })

  it('is the box the reel needs: 300 px tall cards at 2× and 3×', () => {
    expect(coverFor(APPLE, { height: 300, dpr: 2 })).toBe(apple('480x720'))
    expect(coverFor(APPLE, { height: 300, dpr: 3 })).toBe(APPLE)
    expect(coverFor(APPLE, { height: 300, dpr: 1 })).toBe(apple('240x360'))
  })

  it('serves a list thumbnail the 120 × 180 the app already asks for', () => {
    expect(coverFor(APPLE, { width: 40, dpr: 3 })).toBe(coverSrc(APPLE, 'sm'))
  })
})

describe('an Open Library cover at a size', () => {
  it('is the smallest of S, M and L at least as wide as it needs', () => {
    expect(coverVariant(OL, 30)).toBe('https://covers.openlibrary.org/b/id/8231856-S.jpg')
    expect(coverVariant(OL, 38)).toBe('https://covers.openlibrary.org/b/id/8231856-S.jpg')
    expect(coverVariant(OL, 120)).toBe('https://covers.openlibrary.org/b/id/8231856-M.jpg')
    expect(coverVariant(OL, 180)).toBe('https://covers.openlibrary.org/b/id/8231856-M.jpg')
    expect(coverVariant(OL, 181)).toBe('https://covers.openlibrary.org/b/id/8231856-L.jpg')
    expect(coverVariant('https://covers.openlibrary.org/b/id/8231856-S.jpg', 500)).toBe(OL)
  })

  it('keeps the one query the app sends, by ISBN', () => {
    expect(coverVariant(OL_ISBN, 100)).toBe('https://covers.openlibrary.org/b/isbn/9780141439518-M.jpg?default=false')
  })
})

describe('an address that is not theirs', () => {
  it.each([
    'https://example.com/cover.jpg',
    'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1/2.jpg',
    'https://books.fabkho.dev/covers/x.jpg',
    'http://is1-ssl.mzstatic.com/image/thumb/a/b/c.jpg/600x900bb.jpg',
    'https://mzstatic.com.evil.test/image/thumb/a/b/c.jpg/600x900bb.jpg',
    'https://covers.openlibrary.org.evil.test/b/id/1-L.jpg',
    'https://user@covers.openlibrary.org/b/id/1-L.jpg',
    'https://is1-ssl.mzstatic.com/not-artwork/c.jpg',
    'https://is1-ssl.mzstatic.com/image/thumb/a/b/c.jpg',
    'https://covers.openlibrary.org/b/id/1-L.jpg?x=1',
    'https://covers.openlibrary.org/a/olid/OL1A-L.jpg',
    'not a url',
    'javascript:alert(1)',
  ])('is left as it is, and not served by the cache: %s', (url) => {
    expect(coverVariant(url, 300)).toBe(url)
    expect(coverProxyUrl(url, 300)).toBe(url)
    expect(coverFor(url, { height: 300, dpr: 2, proxy: true })).toBe(url)
    expect(coverIsCacheable(url)).toBe(false)
    expect(parseCoverRequest(new URLSearchParams({ u: url, w: '240' }))).toBeNull()
  })

  it('has nothing to size when there is no cover', () => {
    expect(coverFor(null, { height: 300 })).toBeNull()
    expect(coverFor('', { height: 300, proxy: true })).toBeNull()
    expect(coverFor(undefined, { height: 300 })).toBeNull()
  })
})

describe('the address of our cache', () => {
  it('names the cover and one of its widths', () => {
    const address = coverProxyUrl(APPLE, 400)
    expect(address.startsWith('/cover?')).toBe(true)
    const query = new URL(address, 'https://libellus.test').searchParams
    // `u` is the cover at the sized address the edge keys by, so the browser's and the worker's cache keys match it.
    expect(query.get('u')).toBe(apple('480x720'))
    expect(query.get('w')).toBe('480')
  })

  it('is one address for the spellings of one cover at a width (the browser caches it once, as the edge does)', () => {
    expect(coverProxyUrl(APPLE, 400)).toBe(coverProxyUrl(apple('120x180'), 400))
    expect(coverProxyUrl(OL, 100)).toBe(coverProxyUrl('https://covers.openlibrary.org/b/id/8231856-M.jpg', 100))
    expect(coverProxyUrl(OL, 100)).not.toBe(coverProxyUrl(OL, 300))
  })

  it('goes on the origin it is given', () => {
    expect(coverFor(OL, { height: 300, dpr: 2, proxy: true, origin: 'https://libellus.fabkho.dev' })).toMatch(/^https:\/\/libellus\.fabkho\.dev\/cover\?u=https%3A%2F%2Fcovers\.openlibrary\.org/)
  })

  it('is read back as the cover it asks for, by the Function and by the app', () => {
    const address = coverFor(APPLE, { height: 300, dpr: 2, proxy: true })!
    expect(unproxied(address)).toBe(apple('480x720'))
    expect(unproxied(`https://libellus.fabkho.dev${address}`)).toBe(apple('480x720'))
    expect(unproxied(APPLE)).toBe(APPLE)
    expect(parseCoverRequest(new URL(address, 'https://x.test').searchParams)).toEqual({ source: apple('480x720'), width: 480 })
  })

  it('resolves to the same sized address whatever size the stored URL has', () => {
    const a = parseCoverRequest(new URLSearchParams({ u: APPLE, w: '240' }))
    const b = parseCoverRequest(new URLSearchParams({ u: apple('120x180'), w: '240' }))
    expect(a).toEqual(b)
    expect(parseCoverRequest(new URLSearchParams({ u: OL, w: '120' }))?.source).toBe('https://covers.openlibrary.org/b/id/8231856-M.jpg')
    expect(parseCoverRequest(new URLSearchParams({ u: 'https://covers.openlibrary.org/b/id/8231856-M.jpg', w: '600' }))?.source).toBe(OL)
  })

  it('serves only the widths it lists, and only for an address of a host it knows', () => {
    for (const w of ['', '0', '100', '241', '601', '9999', '-240', 'abc', '240.5']) expect(parseCoverRequest(new URLSearchParams({ u: APPLE, w }))).toBeNull()
    expect(parseCoverRequest(new URLSearchParams({ w: '240' }))).toBeNull()
    expect(parseCoverRequest(new URLSearchParams({ u: APPLE }))).toBeNull()
    expect(parseCoverRequest(new URLSearchParams({ u: `${APPLE}#${'x'.repeat(700)}`, w: '240' }))).toBeNull()
  })
})

describe('covers through our cache, where the app asks for them', () => {
  const proxied = (url: string, size: Parameters<typeof coverSrc>[1]) => coverSrc(url, size, true)!

  it('asks for the widths the direct URLs have, so a size is one image either way', () => {
    for (const size of ['xs', 'sm', 'md', 'lg', 'xl'] as const) {
      const address = proxied(APPLE, size)
      expect(parseCoverRequest(new URL(address, 'https://x.test').searchParams)!.source).toBe(coverSrc(APPLE, size))
      const ol = proxied(OL, size)
      expect(parseCoverRequest(new URL(ol, 'https://x.test').searchParams)!.source).toBe(coverSrc(OL, size))
    }
  })

  it('leaves a cover of another host, and every cover when not asked, as it was', () => {
    expect(coverSrc('https://example.test/cover.png', 'sm', true)).toBe('https://example.test/cover.png')
    expect(coverSrc(APPLE, 'sm', false)).toBe(apple('120x180'))
    expect(coverSrc(null, 'sm', true)).toBeNull()
  })

  it('reads an address of ours as the cover behind it', () => {
    expect(coverSrc(proxied(APPLE, 'sm'), 'xl')).toBe(APPLE)
    expect(coverSrc(proxied(OL, 'sm'), 'xl')).toBe(OL)
  })

  it('is one artwork with the host’s own sizes of it', () => {
    expect(artworkOf(proxied(APPLE, 'sm'))).toBe(artworkOf(APPLE))
    expect(artworkOf(`https://libellus.test${proxied(OL, 'xl')}`)).toBe(artworkOf(coverSrc(OL, 'sm')!))
    expect(artworkOf(proxied(APPLE, 'sm'))).not.toBe(artworkOf(proxied(OL, 'sm')))
  })

  it('offers the srcset through the cache, only when the src comes through it', () => {
    const own = proxied(APPLE, 'lg')
    const set = coverSrcset(own, 'lg')!
    expect(set.split(', ').map((entry) => entry.split(' ')[1])).toEqual(['120w', '240w'])
    for (const entry of set.split(', ')) expect(entry.startsWith('/cover?u=')).toBe(true)
    expect(coverSrcset(coverSrc(APPLE, 'lg'), 'lg')).toBe(`${apple('120x180')} 120w, ${apple('240x360')} 240w`)
    expect(coverSrcset(proxied(OL, 'lg'), 'lg')).toBeNull()
  })

  it('tries the host’s own addresses when the cache fails, never another picture', () => {
    const own = proxied(APPLE, 'md')
    const chain = coverChain(own, 'md')
    expect(chain[0]).toBe(own)
    expect(chain.slice(1)).toEqual(coverChain(APPLE, 'md'))
    expect(new Set(chain.map(artworkOf)).size).toBe(1)
    // As it was when the cache is not in use.
    expect(coverChain(APPLE, 'md')).toEqual([apple('240x360'), APPLE, apple('120x180')])
    expect(coverChain(null, 'md')).toEqual([])
  })
})
