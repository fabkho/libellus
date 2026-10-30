import { describe, expect, it } from 'vitest'
import { artworkOf, coverChain, coverSrc, coverSrcset, type CoverSize } from '@/utils/cover'
import { coverAt, coverImage, ownWidthFor, type CoverBook } from '@/utils/coverRef'
import { coverFor } from '@/utils/coverSize'
import { isOwnCoverKey, isOwnCoverWidth, ownCopy, ownCoverObject, ownCoverUrl, ownCoverWidths, parseOwnCoverPath } from '@/utils/ownCoverPath'
import { bookFromRow, type BookRow } from '@/data/library'
import { publicBookFromRow } from '@/data/readingPage'

/**
 * The one decision of a cover's image (utils/coverRef.ts): our stored copy at the width that is sharp, else `/cover`,
 * else the source; never another artwork on the way (docs/plans/owned-covers.md §1, §9 PR 4). Pure: no network, no stack.
 */

const KEY = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
const APPLE = 'https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/bf/b3/c8bfb35c/9780593983768.d.jpg/600x900bb.jpg'
const OL = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
const GOODREADS = 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1/1-L._SY475_.jpg'
const APPLE_WIDTHS = [120, 240, 360, 600]
const OL_WIDTHS = [180, 326]

const apple: CoverBook = { coverUrl: APPLE, coverKey: KEY, coverWidths: APPLE_WIDTHS }
const own = { own: true }
const SIZES: CoverSize[] = ['xs', 'sm', 'md', 'lg', 'xl']

describe('our own copy', () => {
  it('is the address /c/<key>/<width>, on the page\'s origin or the one asked for', () => {
    expect(ownCoverUrl(KEY, 240)).toBe(`/c/${KEY}/240`)
    expect(ownCoverUrl(KEY, 240, 'https://libellus.fabkho.dev')).toBe(`https://libellus.fabkho.dev/c/${KEY}/240`)
    expect(ownCoverObject(KEY, 240)).toBe(`c/${KEY}/240`)
  })

  it('is shown at the smallest stored width that is sharp for the size, the widest when none is', () => {
    expect(coverImage(apple, 'xs', own).src).toBe(`/c/${KEY}/120`)
    expect(coverImage(apple, 'sm', own).src).toBe(`/c/${KEY}/120`)
    expect(coverImage(apple, 'md', own).src).toBe(`/c/${KEY}/240`)
    expect(coverImage(apple, 'lg', own).src).toBe(`/c/${KEY}/240`)
    expect(coverImage(apple, 'xl', own).src).toBe(`/c/${KEY}/600`)
    expect(ownWidthFor(OL_WIDTHS, 120)).toBe(180)
    expect(ownWidthFor(OL_WIDTHS, 600)).toBe(326)
  })

  it('offers its stored widths up to that one as the srcset, with the size\'s token width as sizes', () => {
    const md = coverImage(apple, 'md', own)
    expect(md.srcset).toBe(`/c/${KEY}/120 120w, /c/${KEY}/240 240w`)
    expect(md.sizes).toBe('72px')
    expect(coverImage(apple, 'xl', own).srcset).toBe(APPLE_WIDTHS.map((w) => `/c/${KEY}/${w} ${w}w`).join(', '))
    // A size with one candidate has no srcset (its src is it).
    expect(coverImage(apple, 'sm', own).srcset).toBeNull()
    // The real widths of Open Library's two sizes, not Apple's four.
    expect(coverImage({ coverUrl: OL, coverKey: KEY, coverWidths: OL_WIDTHS }, 'lg', own)).toMatchObject({
      src: `/c/${KEY}/326`,
      srcset: `/c/${KEY}/180 180w, /c/${KEY}/326 326w`,
    })
    // One stored width (Goodreads): one candidate, no srcset, always that one.
    expect(coverImage({ coverUrl: GOODREADS, coverKey: KEY, coverWidths: [475] }, 'xl', own)).toMatchObject({ src: `/c/${KEY}/475`, srcset: null })
  })

  it('takes the widths however they arrive: unsorted, repeated or invalid ones are dropped', () => {
    expect(ownCoverWidths([600, 120, 120, 5, 3000, 2.5, '240', null, 240])).toEqual([120, 240, 600])
    expect(ownCoverWidths(null)).toEqual([])
    expect(ownCoverWidths('120')).toEqual([])
    expect(coverImage({ ...apple, coverWidths: [600, 120, 120, 7] }, 'md', own).src).toBe(`/c/${KEY}/600`)
  })
})

describe('without our copy, a Book shows what it showed before', () => {
  const plain: CoverBook = { coverUrl: APPLE }

  it.each(SIZES)('is exactly ui.cover.sources of its address at %s (the source; /cover when it is on)', (size) => {
    for (const proxy of [false, true]) {
      const image = coverImage(plain, size, { proxy })
      const src = coverSrc(APPLE, size, proxy)
      expect(image).toEqual({
        src,
        srcset: coverSrcset(src, size),
        sizes: expect.stringMatching(/px$/),
        fallbacks: coverChain(src, size).filter((url) => url !== src),
      })
    }
  })

  it('goes through /cover when the proxy is on, and to the source when it is off', () => {
    expect(coverImage(plain, 'md', { proxy: true }).src).toMatch(/^\/cover\?u=/)
    expect(coverImage(plain, 'md', { proxy: false }).src).toBe(coverSrc(APPLE, 'md'))
    expect(coverImage({ coverUrl: GOODREADS }, 'md', { proxy: true }).src).toBe(GOODREADS)
  })

  it('has no image without a cover address, whatever else it carries (the database hands out key and address together)', () => {
    expect(coverImage({ coverUrl: null, coverKey: KEY, coverWidths: APPLE_WIDTHS }, 'md', { ...own, proxy: true })).toEqual({ src: null, srcset: null, sizes: '72px', fallbacks: [] })
    expect(coverImage({}, 'md', own).src).toBeNull()
    expect(coverImage(null, 'md', own).src).toBeNull()
    expect(coverImage(undefined, 'md', own).src).toBeNull()
    expect(coverAt({ coverUrl: null, coverKey: KEY, coverWidths: [240] }, { height: 300, ...own })).toBeNull()
    expect(coverAt(null, { height: 300 })).toBeNull()
  })

  it.each([
    ['no key', { coverUrl: APPLE, coverWidths: APPLE_WIDTHS }],
    ['a null key', { coverUrl: APPLE, coverKey: null, coverWidths: APPLE_WIDTHS }],
    ['a key that is not one', { coverUrl: APPLE, coverKey: '../../secret', coverWidths: APPLE_WIDTHS }],
    ['an upper-case key', { coverUrl: APPLE, coverKey: KEY.toUpperCase(), coverWidths: APPLE_WIDTHS }],
    ['no widths', { coverUrl: APPLE, coverKey: KEY }],
    ['empty widths', { coverUrl: APPLE, coverKey: KEY, coverWidths: [] }],
    ['widths that are none', { coverUrl: APPLE, coverKey: KEY, coverWidths: [1, 99999] }],
  ] as [string, CoverBook][])('does not use a copy with %s', (_, book) => {
    const image = coverImage(book, 'md', { ...own, proxy: true })
    expect(image.src).toMatch(/^\/cover\?u=/)
    expect(coverAt(book, { height: 300, ...own })).toBe(coverFor(APPLE, { height: 300 }))
  })
})

describe('the switch', () => {
  it('off: today\'s addresses, whatever the Book carries', () => {
    for (const hosts of [{}, { own: false }, { own: false, proxy: true }]) {
      const image = coverImage(apple, 'md', hosts)
      expect(image.src).not.toContain('/c/')
      expect(image.srcset ?? '').not.toContain('/c/')
      expect(image.fallbacks.join(' ')).not.toContain('/c/')
      expect(coverAt(apple, { height: 300, dpr: 2, ...hosts })).not.toContain('/c/')
    }
  })

  it('on: our copy first, and only the Books that have one', () => {
    expect(coverImage(apple, 'md', own).src).toBe(`/c/${KEY}/240`)
    expect(coverImage({ coverUrl: APPLE }, 'md', own).src).toBe(coverSrc(APPLE, 'md'))
  })
})

describe('the chain never changes the artwork', () => {
  it.each([
    ['Apple', apple],
    ['Open Library', { coverUrl: OL, coverKey: KEY, coverWidths: OL_WIDTHS }],
    ['Goodreads', { coverUrl: GOODREADS, coverKey: KEY, coverWidths: [475] }],
  ] as [string, CoverBook][])('is ours, then /cover, then the source, all of one picture (%s)', (_, book) => {
    for (const size of SIZES) {
      const image = coverImage(book, size, { own: true, proxy: true })
      expect(image.src).toMatch(new RegExp(`^/c/${KEY}/\\d+$`))
      const rest = image.fallbacks
      // The fallbacks are today's chain: `/cover` first (a host it serves), then the source's own addresses.
      expect(rest).toEqual(coverChain(coverSrc(book.coverUrl, size, true), size))
      for (const url of rest) expect(artworkOf(url), `${size}: ${url}`).toBe(artworkOf(book.coverUrl!))
      expect(rest.at(-1)).not.toContain('/c/')
      expect(rest).not.toContain(image.src)
    }
  })

  it('ends at the source when /cover is off: the copy, then the source\'s sizes', () => {
    const image = coverImage(apple, 'md', own)
    expect(image.fallbacks[0]).toBe(coverSrc(APPLE, 'md'))
    expect(image.fallbacks.every((url) => artworkOf(url) === artworkOf(APPLE))).toBe(true)
  })

  it('has the source as the last resort even for a host /cover does not serve', () => {
    const image = coverImage({ coverUrl: GOODREADS, coverKey: KEY, coverWidths: [475] }, 'sm', { own: true, proxy: true })
    expect(image.fallbacks).toEqual([GOODREADS])
  })
})

describe('a cover at a size no token names (the reel)', () => {
  it('is our copy at the width that is sharp for its height and the pixel ratio, absolute with an origin', () => {
    const site = 'https://libellus.fabkho.dev'
    // 300 px tall = 200 wide: 1× needs 200 -> 240; 2× needs 400 -> 600; 3× needs 600.
    expect(coverAt(apple, { height: 300, dpr: 1, ...own, origin: site })).toBe(`${site}/c/${KEY}/240`)
    expect(coverAt(apple, { height: 300, dpr: 2, ...own, origin: site })).toBe(`${site}/c/${KEY}/600`)
    expect(coverAt(apple, { height: 300, dpr: 3, ...own })).toBe(`/c/${KEY}/600`)
    expect(coverAt({ coverUrl: OL, coverKey: KEY, coverWidths: OL_WIDTHS }, { height: 300, dpr: 3, ...own })).toBe(`/c/${KEY}/326`)
  })

  it('is coverFor\'s answer without a copy or with the switch off (/cover on the page\'s origin, else the source)', () => {
    const site = 'https://libellus.fabkho.dev'
    expect(coverAt({ coverUrl: APPLE }, { height: 300, dpr: 2, proxy: true, origin: site, own: true })).toBe(coverFor(APPLE, { height: 300, dpr: 2, proxy: true, origin: site }))
    expect(coverAt(apple, { height: 300, dpr: 2, proxy: false })).toBe(coverFor(APPLE, { height: 300, dpr: 2 }))
    expect(coverAt(apple, { height: 300, dpr: 2, proxy: true, origin: site, own: false })).toMatch(new RegExp(`^${site}/cover\\?u=`))
  })
})

describe('the address of a copy', () => {
  it.each([
    [`/c/${KEY}/240`, { key: KEY, width: 240 }],
    [`/c/${KEY}/16`, { key: KEY, width: 16 }],
    [`/c/${KEY}/2000`, { key: KEY, width: 2000 }],
  ])('%s is a copy', (path, expected) => {
    expect(parseOwnCoverPath(path)).toEqual(expected)
  })

  it.each([
    '/c',
    '/c/',
    `/c/${KEY}`,
    `/c/${KEY}/`,
    `/c/${KEY}/240/`,
    `/c/${KEY}/240/extra`,
    `/c/${KEY}/15`,
    `/c/${KEY}/2001`,
    `/c/${KEY}/0240`,
    `/c/${KEY}/+240`,
    `/c/${KEY}/2.4e2`,
    `/c/${KEY}/240.0`,
    `/c/${KEY}/-240`,
    `/c/${KEY}/abc`,
    `/c/${KEY.toUpperCase()}/240`,
    `/c/${KEY.slice(1)}/240`,
    `/c/${KEY}0/240`,
    `/c/${KEY.replace('a', 'g')}/240`,
    `/c/../${KEY}/240`,
    `/x/${KEY}/240`,
    `//c/${KEY}/240`,
    `/c/%2e%2e/240`,
  ])('%s is not', (path) => {
    expect(parseOwnCoverPath(path)).toBeNull()
  })

  it('knows a key and a width', () => {
    expect(isOwnCoverKey(KEY)).toBe(true)
    expect(isOwnCoverKey(null)).toBe(false)
    expect(isOwnCoverKey(123)).toBe(false)
    expect([16, 120, 2000].every(isOwnCoverWidth)).toBe(true)
    expect([15, 2001, 1.5, NaN, '120', null].some(isOwnCoverWidth)).toBe(false)
    expect(ownCopy(KEY, [240, 120])).toEqual({ coverKey: KEY, coverWidths: [120, 240] })
    expect(ownCopy(KEY, [])).toBeNull()
    expect(ownCopy(null, [240])).toBeNull()
  })
})

describe('what a row or an answer hands to a Book', () => {
  const row = {
    id: 'b', title: 'T', authors: ['A'], isbn13: null, isbn10: null, page_count: null, published_year: null, language: null, publisher: null,
    cover_url: APPLE, cover_thumbhash: null, cover_dominant: null, cover_secondary: null, source: 'apple', apple_id: null,
    openlibrary_edition_key: null, openlibrary_work_key: null, created_at: '2026-11-01T00:00:00Z',
  } as unknown as BookRow

  it('a Library row carries the copy when it has one, and reads as it always did when not (no key at all)', () => {
    expect(bookFromRow({ ...row, cover_key: KEY, cover_widths: [240, 120] })).toMatchObject({ coverKey: KEY, coverWidths: [120, 240] })
    for (const bare of [row, { ...row, cover_key: null, cover_widths: null }, { ...row, cover_key: KEY, cover_widths: [] }, { ...row, cover_key: 'bad', cover_widths: [240] }]) {
      const book = bookFromRow(bare)
      expect('coverKey' in book).toBe(false)
      expect('coverWidths' in book).toBe(false)
    }
  })

  it('a Library Book then draws from its copy', () => {
    const book = bookFromRow({ ...row, cover_key: KEY, cover_widths: APPLE_WIDTHS })
    expect(coverImage(book, 'md', own).src).toBe(`/c/${KEY}/240`)
    expect(coverImage(bookFromRow(row), 'md', own).src).toBe(coverSrc(APPLE, 'md'))
  })

  it('the public reading page\'s Book carries both keys, null without a usable copy', () => {
    const page = { id: 'b', title: 'T', authors: [], published_year: null, cover_url: APPLE, cover_thumbhash: null, cover_dominant: null, cover_secondary: null }
    expect(publicBookFromRow({ ...page, cover_key: KEY, cover_widths: [120, 600] })).toMatchObject({ coverKey: KEY, coverWidths: [120, 600] })
    expect(publicBookFromRow({ ...page, cover_key: null, cover_widths: null })).toMatchObject({ coverKey: null, coverWidths: null })
    expect(publicBookFromRow(page)).toMatchObject({ coverKey: null, coverWidths: null })
  })
})
