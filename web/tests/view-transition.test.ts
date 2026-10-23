import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserAnimation, imagesDecoded } from '../app/utils/viewTransition'

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
