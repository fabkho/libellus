import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserAnimation, groupKeyframes, imagesDecoded, usableRect, visibleRect } from '../app/utils/viewTransition'

/**
 * The parts of the Profile's View Transition that are logic rather than looks
 * (utils/viewTransition.ts, plugins/profile-transition.client.ts): when the
 * browser's own animation of a Back counts, and the wait for the ring's photo.
 */

describe('the browser animated a Back', () => {
  it('counts for the navigation that follows, once', () => {
    let now = 0
    const animation = createBrowserAnimation(() => now)
    animation.noted(true)
    now = 200
    expect(animation.take()).toBe(true)
    expect(animation.take()).toBe(false)
  })

  it('can be asked without being used up, until the navigation takes it', () => {
    const animation = createBrowserAnimation(() => 0)
    animation.noted(true)
    expect(animation.peek()).toBe(true)
    expect(animation.peek()).toBe(true)
    expect(animation.take()).toBe(true)
    expect(animation.peek()).toBe(false)
  })

  it('does not count when the popstate said no', () => {
    const animation = createBrowserAnimation(() => 0)
    animation.noted(false)
    expect(animation.take()).toBe(false)
  })

  it('does not outlive its popstate: one no navigation took is not the next tap’s', () => {
    let now = 0
    const animation = createBrowserAnimation(() => now, 1500)
    animation.noted(true)
    now = 5000
    expect(animation.take()).toBe(false)
  })

  it('is replaced by the latest popstate', () => {
    const animation = createBrowserAnimation(() => 0)
    animation.noted(true)
    animation.noted(false)
    expect(animation.take()).toBe(false)
  })
})

/** A scope holding images whose `decode()` is the given one. */
function scopeOf(...decodes: Array<() => Promise<void>>) {
  return { querySelectorAll: () => decodes.map((decode) => ({ decode })) } as unknown as ParentNode
}

describe('waiting for the photo to decode', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('is no wait with no photo', async () => {
    await expect(imagesDecoded([scopeOf()], 250)).resolves.toBeUndefined()
    await expect(imagesDecoded([], 250)).resolves.toBeUndefined()
  })

  it('resolves when every photo is decoded, without waiting out the limit', async () => {
    let settled = false
    void imagesDecoded([scopeOf(() => Promise.resolve(), () => new Promise((r) => setTimeout(r, 50)))], 250).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(10)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    expect(settled).toBe(true)
  })

  it('stops waiting at the limit', async () => {
    let settled = false
    void imagesDecoded([scopeOf(() => new Promise(() => {}))], 250).then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(249)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(settled).toBe(true)
  })

  it('counts a photo that fails to decode as done', async () => {
    await expect(imagesDecoded([scopeOf(() => Promise.reject(new Error('EncodingError')))], 250)).resolves.toBeUndefined()
  })
})

describe('the ring group’s keyframes from the boxes we measured', () => {
  const phone = { width: 393, height: 852 }
  // The header's avatar (32 pt, at the trailing edge under the status bar) and the Profile's ring (72 pt, centred).
  const header = { left: 337, top: 62, width: 32, height: 32 }
  const ring = { left: 160.5, top: 118, width: 72, height: 72 }

  it('push: starts as the avatar, scaled down from the ring’s size, and ends at the ring at scale 1', () => {
    const [from, to] = groupKeyframes(header, ring, 'ease')!
    expect(from).toEqual({ transform: `translate(337px, 62px) scale(${32 / 72}, ${32 / 72})`, easing: 'ease' })
    expect(to).toEqual({ transform: 'translate(160.5px, 118px) scale(1, 1)' })
  })

  it('back: starts as the ring, scaled up from the avatar’s size, and ends at the avatar', () => {
    const [from, to] = groupKeyframes(ring, header)!
    expect(from).toEqual({ transform: 'translate(160.5px, 118px) scale(2.25, 2.25)', easing: 'linear' })
    expect(to).toEqual({ transform: 'translate(337px, 62px) scale(1, 1)' })
  })

  it('scales by one factor in both axes', () => {
    const [from] = groupKeyframes(header, { ...ring, height: 80 })!
    expect(from!.transform).toMatch(/scale\(([\d.]+), \1\)$/)
  })

  it('scrolled: the boxes are as the viewport shows them, a Back into a header scrolled partly out of view included', () => {
    const scrolled = { left: 337, top: -10, width: 32, height: 32 }
    expect(usableRect(scrolled, phone)).toEqual(scrolled)
    const [from, to] = groupKeyframes(ring, usableRect(scrolled, phone))!
    expect(from!.transform).toContain('translate(160.5px, 118px)')
    expect(to!.transform).toBe('translate(337px, -10px) scale(1, 1)')
  })

  it('falls back (null) without a box, or with one that is not drawn or off screen', () => {
    expect(groupKeyframes(null, ring)).toBeNull()
    expect(groupKeyframes(header, null)).toBeNull()
    expect(usableRect({ ...header, width: 0, height: 0 }, phone)).toBeNull()
    expect(usableRect({ ...header, width: Number.NaN }, phone)).toBeNull()
    expect(usableRect({ ...header, top: -33 }, phone)).toBeNull()
    expect(usableRect({ ...header, top: 852 }, phone)).toBeNull()
    expect(usableRect({ ...header, left: 393 }, phone)).toBeNull()
    expect(groupKeyframes(header, usableRect({ ...ring, top: -100 }, phone))).toBeNull()
    expect(groupKeyframes({ ...header, width: 0 }, ring)).toBeNull()
  })

  it('measures the first element that is drawn on screen', () => {
    const at = (left: number, top: number, width: number, height: number) =>
      ({ getBoundingClientRect: () => ({ left, top, width, height }) }) as unknown as Element
    expect(visibleRect([at(0, 0, 0, 0), at(10, 20, 30, 30)], phone)).toEqual({ left: 10, top: 20, width: 30, height: 30 })
    expect(visibleRect([at(0, 0, 0, 0)], phone)).toBeNull()
    expect(visibleRect([], phone)).toBeNull()
  })
})
