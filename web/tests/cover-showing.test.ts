import { describe, expect, it } from 'vitest'
import {
  artworkOf,
  coverFailed,
  coverInputChanged,
  coverNow,
  coverShown,
  startCover,
  type CoverInput,
  type CoverShowing,
} from '@/utils/cover'

/**
 * A cover shown never silently becomes another image (A8, docs/covers.md). The
 * paths the code allowed, each first as `before` (UiCover as it was: a watch on
 * `src` that starts over, and `next()` that walks `fallbacks`), then as the
 * rule keeps it.
 */

const apple = (box: string, file = '9780593983768') => `https://is1-ssl.mzstatic.com/image/thumb/Publication221/v4/c8/${file}.d.jpg/${box}bb.jpg`
const SMALL = apple('120x180')
const LARGE = apple('600x900')
/** What a re-sync stores: another artwork of the same edition. */
const RESYNCED = apple('120x180', '9780593983999')
const BY_ISBN = 'https://covers.openlibrary.org/b/isbn/9780593983768-M.jpg?default=false'
const input = (src: string | null, fallbacks: string[] = [BY_ISBN], identity = '9780593983768'): CoverInput => ({ src, fallbacks, identity })

/** UiCover before the guard: `src` changing starts over; a failure walks on. */
function before(state: { chain: readonly string[]; attempt: number }, next: CoverInput | 'fail') {
  if (next === 'fail') return { ...state, attempt: state.attempt + 1 }
  return { chain: next.src ? [next.src, ...next.fallbacks] : [], attempt: 0 }
}
const nowBefore = (state: { chain: readonly string[]; attempt: number }) => state.chain[state.attempt] ?? null

/** A cover with its image loaded and in view. */
function inView(url = SMALL, ...more: CoverInput[]): CoverShowing {
  let state = coverShown(startCover(input(url)), url)
  for (const next of more) state = coverInputChanged(state, next)
  return state
}

describe('path 1: a mounted cover is given another src (a re-synced or edition-changed coverUrl)', () => {
  it('before: swaps the image in view for the new artwork', () => {
    const state = before(before({ chain: [], attempt: 0 }, input(SMALL)), input(RESYNCED))
    expect(nowBefore(state)).toBe(RESYNCED)
  })

  it('keeps the image in view when the same edition arrives with another artwork', () => {
    const state = inView(SMALL, input(RESYNCED))
    expect(coverNow(state)).toBe(SMALL)
    expect(state.held).toEqual([RESYNCED, BY_ISBN])
  })

  it('keeps it when the src goes away (a Book that lost its cover)', () => {
    const state = inView(SMALL, input(null, []))
    expect(coverNow(state)).toBe(SMALL)
  })

  it('takes up the newer artwork once the one in view fails', () => {
    const held = inView(SMALL, input(RESYNCED, []))
    // The fallback of the old chain is tried first: it is what the cover was told to try after its own src.
    const failed = coverFailed(held, SMALL)
    expect(coverNow(failed)).toBe(BY_ISBN)
    const again = coverFailed(failed, BY_ISBN)
    expect(coverNow(again)).toBe(RESYNCED)
    expect(again.held).toBeNull()
    expect(again.shown).toBeNull()
  })

  it('shows the newer artwork at once while none is in view yet', () => {
    const state = coverInputChanged(startCover(input(SMALL)), input(RESYNCED))
    expect(coverNow(state)).toBe(RESYNCED)
    expect(state.attempt).toBe(0)
  })

  it('takes another size of the artwork in view as that artwork, not as another image', () => {
    const state = inView(SMALL, input(LARGE, []))
    expect(coverNow(state)).toBe(LARGE)
    expect(state.shown).toBe(SMALL) // still in view until the larger one is
    expect(state.held).toBeNull()
  })

  it('starts afresh when what the cover is of changes: the user changed edition', () => {
    const state = inView(SMALL, input(RESYNCED, [], '9780000000002'))
    expect(coverNow(state)).toBe(RESYNCED)
    expect(state.shown).toBeNull()
  })

  it('forgets a held artwork when the src comes back to what is in view', () => {
    const state = inView(SMALL, input(RESYNCED), input(SMALL))
    expect(state.held).toBeNull()
    expect(coverNow(state)).toBe(SMALL)
  })
})

describe('path 2: a late error or blank on an image already in view', () => {
  it('before: the fallback replaces the image in view, a different image', () => {
    const state = before(before({ chain: [], attempt: 0 }, input(SMALL)), 'fail')
    expect(nowBefore(state)).toBe(BY_ISBN)
  })

  it('leaves the artwork in view when another size of it fails (a srcset pick that 404s)', () => {
    // SMALL was shown; the size changed to LARGE, which fails or comes back blank.
    const state = coverFailed(inView(SMALL, input(LARGE)), LARGE)
    expect(coverNow(state)).toBe(SMALL)
    expect(state.shown).toBe(SMALL)
    expect(state.srcset).toBe(false) // it does not offer the sizes again
  })

  it('moves on to a fallback only when the image in view itself fails', () => {
    const state = coverFailed(inView(SMALL), SMALL)
    expect(coverNow(state)).toBe(BY_ISBN)
    expect(state.shown).toBeNull()
  })

  it('moves on from the size that stayed when that fails too, to the fallbacks that follow', () => {
    const reverted = coverFailed(inView(SMALL, input(LARGE)), LARGE)
    expect(coverNow(coverFailed(reverted, SMALL))).toBe(BY_ISBN)
  })

  it('ends in the Placeholder when nothing is left', () => {
    const state = coverFailed(coverFailed(inView(SMALL), SMALL), BY_ISBN)
    expect(coverNow(state)).toBeNull()
  })

  it('before any image was in view, a failure walks on as it always did', () => {
    const state = coverFailed(startCover(input(SMALL)), SMALL)
    expect(coverNow(state)).toBe(BY_ISBN)
    expect(coverNow(coverFailed(state, BY_ISBN))).toBeNull()
  })
})

describe('path 3: withCover resolves a cover when a Book is added', () => {
  it('is not a swap of a mounted cover: it runs before the Book has one (stores/library.ts, add only)', () => {
    // The Book's cover is resolved first and stored; nothing in view yet to replace. When the add
    // happens under a mounted cover of the same edition, it is path 1 and held.
    const state = inView(SMALL, input(RESYNCED))
    expect(coverNow(state)).toBe(SMALL)
  })
})

describe('what is one artwork', () => {
  it('is the same through Apple’s boxes and OpenLibrary’s sizes', () => {
    expect(artworkOf(SMALL)).toBe(artworkOf(LARGE))
    expect(artworkOf(SMALL)).not.toBe(artworkOf(RESYNCED))
    expect(artworkOf('https://covers.openlibrary.org/b/id/8231856-M.jpg')).toBe(artworkOf('https://covers.openlibrary.org/b/id/8231856-L.jpg'))
    expect(artworkOf('https://covers.openlibrary.org/b/id/8231856-M.jpg')).not.toBe(artworkOf(BY_ISBN))
  })
})
