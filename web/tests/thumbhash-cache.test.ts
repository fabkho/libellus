import { afterEach, describe, expect, it, vi } from 'vitest'
import { rgbaToThumbHash } from 'thumbhash'
import { clearThumbhashCache, thumbhashCacheSize, thumbhashDataUrl } from '@/utils/thumbhash'
import { thumbhashDataUrl as fromCover } from '@/utils/cover'

/** A distinct valid thumbhash: a 4x4 image of one colour. */
function hashOf(seed: number): string {
  const rgba = new Uint8Array(4 * 4 * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([seed % 256, (seed >> 8) % 256, 90, 255], i)
  return btoa(String.fromCharCode(...rgbaToThumbHash(4, 4, rgba)))
}

describe('the thumbhash decoder', () => {
  afterEach(() => {
    clearThumbhashCache()
    vi.restoreAllMocks()
  })

  it('gives a PNG data URL, nothing for no hash or a bad one, and cover.ts has the same function', () => {
    const hash = hashOf(1)
    expect(thumbhashDataUrl(hash)).toMatch(/^data:image\/png;base64,/)
    expect(thumbhashDataUrl(null)).toBeNull()
    expect(thumbhashDataUrl(undefined)).toBeNull()
    expect(thumbhashDataUrl('')).toBeNull()
    expect(thumbhashDataUrl('***')).toBeNull()
    expect(fromCover(hash)).toBe(thumbhashDataUrl(hash))
  })

  it('decodes a hash once: the second ask is the first answer', () => {
    const atobSpy = vi.spyOn(globalThis, 'atob')
    const hash = hashOf(2)
    const first = thumbhashDataUrl(hash)
    const second = thumbhashDataUrl(hash)
    expect(second).toBe(first)
    expect(atobSpy).toHaveBeenCalledTimes(1)
  })

  it('remembers a bad hash too, so it is not retried on every mount', () => {
    const atobSpy = vi.spyOn(globalThis, 'atob')
    expect(thumbhashDataUrl('***')).toBeNull()
    expect(thumbhashDataUrl('***')).toBeNull()
    expect(atobSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps a bounded number, dropping the least recently used first', () => {
    const atobSpy = vi.spyOn(globalThis, 'atob')
    const keep = hashOf(0)
    thumbhashDataUrl(keep)
    for (let i = 1; i <= 600; i++) {
      thumbhashDataUrl(hashOf(i))
      thumbhashDataUrl(keep) // used all along, so it is never the oldest
    }
    expect(thumbhashCacheSize()).toBeLessThanOrEqual(512)
    atobSpy.mockClear()
    thumbhashDataUrl(keep)
    expect(atobSpy).not.toHaveBeenCalled() // still there
    thumbhashDataUrl(hashOf(1)) // long gone
    expect(atobSpy).toHaveBeenCalledTimes(1)
  })
})
