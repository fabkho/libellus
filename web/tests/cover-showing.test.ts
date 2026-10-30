import { describe, expect, it } from 'vitest'
import { artworkOf, coverChain } from '@/utils/cover'
import { coverImage, type CoverBook } from '@/utils/coverRef'
import { coverFailed, coverInputChanged, coverNow, coverShown, startCover, type CoverInput, type CoverShowing } from '#layers/ui/app/utils/coverShowing'

/**
 * One Book, one cover (docs/plans/covers-consistency.md): a mounted cover shows
 * what its Book says now, so a list row kept alive (Home, the Library) and the
 * Book's page mounted later show the same picture. It replaced A8 (docs/covers.md:
 * a cover in view held on to its first artwork), which is what let the row show
 * the device's old cover while the page showed the Catalogue's new one.
 */

const apple = (box: string, file = '9780593983768') => `https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/${file}.d.jpg/${box}bb.jpg`
const SMALL = apple('120x180')
const LARGE = apple('600x900')
/** What the Catalogue stores later: another artwork of the same edition (the check, a fill, another member's add). */
const CHANGED = apple('120x180', '9780593983999')
const input = (src: string | null, size: 'sm' | 'xl' = 'sm', identity = '9780593983768'): CoverInput => ({
  src,
  fallbacks: coverChain(src, size).filter((url) => url !== src),
  identity,
})

/** A cover with its image loaded and in view, then given `more`. */
function inView(url = SMALL, ...more: CoverInput[]): CoverShowing {
  let state = coverShown(startCover(input(url)), url)
  for (const next of more) state = coverInputChanged(state, next, artworkOf)
  return state
}

describe('a mounted cover follows its Book', () => {
  it('shows the Book’s new artwork, as the Book’s page mounted now does', () => {
    const row = inView(SMALL, input(CHANGED))
    const page = startCover(input(apple('600x900', '9780593983999'), 'xl'))
    expect(coverNow(row)).toBe(CHANGED)
    expect(row.shown).toBeNull() // the old picture is gone, the new one loads
    expect(artworkOf(coverNow(row)!)).toBe(artworkOf(coverNow(page)!))
  })

  it('shows the Placeholder when the Book has lost its cover, as its page does', () => {
    expect(coverNow(inView(SMALL, input(null)))).toBeNull()
  })

  it('takes another size of the artwork in view as that artwork: it stays in view until the size has loaded', () => {
    const state = inView(SMALL, input(LARGE, 'xl'))
    expect(coverNow(state)).toBe(LARGE)
    expect(state.shown).toBe(SMALL)
  })

  it('stays as it is when the same chain comes again (a parent re-rendered)', () => {
    const state = inView(SMALL)
    expect(coverInputChanged(state, input(SMALL), artworkOf)).toBe(state)
  })

  it('starts afresh when what the cover is of changes, even at the same artwork (a change of edition)', () => {
    const state = inView(SMALL, input(LARGE, 'xl', '9780000000002'))
    expect(coverNow(state)).toBe(LARGE)
    expect(state.shown).toBeNull()
  })
})

describe('a size that fails is the same picture at another size', () => {
  it('moves from a row’s size to the stored one, never to another picture or the Placeholder first', () => {
    const state = coverFailed(startCover(input(SMALL)), SMALL, artworkOf)
    expect(coverNow(state)).toBe(LARGE)
  })

  it('moves from the page’s size to a row’s, so the page shows what the row shows', () => {
    const state = coverFailed(startCover(input(LARGE, 'xl')), LARGE, artworkOf)
    expect(coverNow(state)).toBe(SMALL)
  })

  it('does the same for Open Library’s M and L (a 503 from its archive for one of them)', () => {
    const m = 'https://covers.openlibrary.org/b/id/8231856-M.jpg'
    const l = 'https://covers.openlibrary.org/b/id/8231856-L.jpg'
    expect(coverNow(coverFailed(startCover(input(m)), m, artworkOf))).toBe(l)
    expect(coverNow(coverFailed(startCover(input(l, 'xl')), l, artworkOf))).toBe(m)
  })

  it('ends in the Placeholder only when every size of it failed', () => {
    const state = coverFailed(coverFailed(startCover(input(SMALL)), SMALL, artworkOf), LARGE, artworkOf)
    expect(coverNow(state)).toBeNull()
  })

  it('leaves the artwork in view when another size of it fails (a srcset pick that 404s)', () => {
    const state = coverFailed(inView(SMALL, input(LARGE, 'xl')), LARGE, artworkOf)
    expect(coverNow(state)).toBe(SMALL)
    expect(state.shown).toBe(SMALL)
    expect(state.srcset).toBe(false) // it does not offer the sizes again
    expect(state.chain).toEqual([SMALL]) // and does not try the shown one twice
  })

  it('moves on from the image in view when it fails itself, to its other size', () => {
    const state = coverFailed(inView(SMALL), SMALL, artworkOf)
    expect(coverNow(state)).toBe(LARGE)
    expect(state.shown).toBeNull()
  })
})

describe('what is one artwork', () => {
  it('is the same through Apple’s boxes and OpenLibrary’s sizes', () => {
    expect(artworkOf(SMALL)).toBe(artworkOf(LARGE))
    expect(artworkOf(SMALL)).not.toBe(artworkOf(CHANGED))
    expect(artworkOf('https://covers.openlibrary.org/b/id/8231856-M.jpg')).toBe(artworkOf('https://covers.openlibrary.org/b/id/8231856-L.jpg'))
    expect(artworkOf('https://covers.openlibrary.org/b/id/8231856-M.jpg')).not.toBe(
      artworkOf('https://covers.openlibrary.org/b/isbn/9780593983768-M.jpg?default=false'),
    )
  })

  // Our own stored copies (docs/plans/owned-covers.md §1, §5): one key's widths are one artwork, so a cover switching
  // from the 120 it showed to the 240 its screen needs (`srcset`) is another size of the image in view, never another
  // picture; another key is another artwork.
  it('is the key of one of our copies, whatever the width or the origin', () => {
    const key = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
    const other = '0123456789abcdef0123456789abcdef'
    expect(artworkOf(`/c/${key}/120`)).toBe(artworkOf(`/c/${key}/240`))
    expect(artworkOf(`https://libellus.example/c/${key}/600`)).toBe(artworkOf(`/c/${key}/120`))
    expect(artworkOf(`/c/${key}/120`)).not.toBe(artworkOf(`/c/${other}/120`))
    // And a cover that keeps the image in view across the two widths: one loaded at 120, then asked for the 240.
    const at = (width: number) => input(`/c/${key}/${width}`)
    const next = coverInputChanged(coverShown(startCover(at(120)), `/c/${key}/120`), at(240), artworkOf)
    expect(next.shown).toBe(`/c/${key}/120`)
    expect(coverNow(next)).toBe(`/c/${key}/240`)
  })

  // A Book that gains its copy while its cover is on screen (the Library read again, the store job's minute): the source's
  // address becomes `/c/<key>/<width>`, and the image in view must stay until the copy has loaded, not start over (a
  // thumbhash flash on every screen it is on). `coverImage` records which artwork a copy is of (utils/cover.ts).
  it('is one artwork with the source it copies, so a copy arriving does not restart the cover', () => {
    const key = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0'
    const plain: CoverBook = { coverUrl: SMALL }
    const keyed: CoverBook = { coverUrl: SMALL, coverKey: key, coverWidths: [120, 240, 320, 600] }
    const hosts = { own: true, proxy: true }
    const source = coverImage(plain, 'sm', hosts)
    const copy = coverImage(keyed, 'sm', hosts)
    expect(source.src).toMatch(/^\/cover\?u=/)
    expect(copy.src).toBe(`/c/${key}/120`)
    expect(artworkOf(copy.src!)).toBe(artworkOf(source.src!))
    // And what the cover in view does with it: the source stays until the copy has loaded, then the copy is shown.
    const identity = '9780593983768'
    const before = input(source.src!, 'sm', identity)
    const after = { ...input(copy.src!, 'sm', identity), fallbacks: copy.fallbacks }
    const shown = coverShown(startCover(before), source.src!)
    const arrived = coverInputChanged(shown, after, artworkOf)
    expect(arrived.shown).toBe(source.src)
    expect(coverNow(arrived)).toBe(copy.src)
    // A copy failing falls back through the same artwork (its source chain), never to another picture.
    expect(coverFailed(arrived, copy.src!, artworkOf).chain).toContain(source.src)
  })
})
