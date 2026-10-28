import { describe, expect, it } from 'vitest'
import { hasWebgl, posterSlot, reelWanted, saveDataOn, type ReelGate } from '../app/utils/bothReadReel'

const ok: ReelGate = { built: true, count: 12, reducedMotion: false, webgl: true, saveData: false, near: true, idle: true }

describe('reelWanted (the loading rules)', () => {
  it('draws the 3D when every rule holds', () => expect(reelWanted(ok)).toBe(true))
  it.each([
    ['no Regal in the build', { built: false }],
    ['one Book', { count: 1 }],
    ['no Books', { count: 0 }],
    ['Reduce Motion', { reducedMotion: true }],
    ['no WebGL', { webgl: false }],
    ['Save-Data', { saveData: true }],
    ['far from the screen', { near: false }],
    ['the browser busy', { idle: false }],
  ])('keeps the poster: %s', (_why, change) => expect(reelWanted({ ...ok, ...change })).toBe(false))
  it('two Books can move', () => expect(reelWanted({ ...ok, count: 2 })).toBe(true))
})

describe('environment checks', () => {
  it('reads Save-Data where the browser tells', () => {
    expect(saveDataOn({})).toBe(false)
    expect(saveDataOn({ connection: { saveData: false } })).toBe(false)
    expect(saveDataOn({ connection: { saveData: true } })).toBe(true)
  })
  it('has WebGL when a context comes, never throws', () => {
    expect(hasWebgl({ createElement: () => ({ getContext: (kind: string) => (kind === 'webgl' ? {} : null) }) } as unknown as Document)).toBe(true)
    expect(hasWebgl({ createElement: () => ({ getContext: () => null }) } as unknown as Document)).toBe(false)
    expect(hasWebgl({ createElement: () => { throw new Error('no') } } as unknown as Document)).toBe(false)
  })
})

describe('posterSlot', () => {
  it('puts the front in the middle at full size and mirrors the neighbours', () => {
    expect(posterSlot(0)).toEqual({ x: 0, scale: 1, opacity: 1 })
    expect(posterSlot(-1)!.x).toBe(-posterSlot(1)!.x)
    expect(posterSlot(2)!.scale).toBeLessThan(posterSlot(1)!.scale)
  })
  it('draws two places each side and no more', () => {
    expect(posterSlot(2)).not.toBeNull()
    expect(posterSlot(-2)).not.toBeNull()
    expect(posterSlot(3)).toBeNull()
  })
})
