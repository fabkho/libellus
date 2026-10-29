import { describe, expect, it } from 'vitest'
import { hasWebgl, reelWanted, saveDataOn, type ReelGate } from '../app/utils/bothReadReel'

const ok: ReelGate = { built: true, count: 12, reducedMotion: false, webgl: true, saveData: false }

describe('reelWanted (the loading rules: the live reel; otherwise Regal\'s still)', () => {
  it('draws the 3D when every rule holds', () => expect(reelWanted(ok)).toBe(true))
  it.each([
    ['no Regal in the build', { built: false }],
    ['one Book', { count: 1 }],
    ['no Books', { count: 0 }],
    ['Reduce Motion', { reducedMotion: true }],
    ['no WebGL', { webgl: false }],
    ['Save-Data', { saveData: true }],
  ])('gives the still: %s', (_why, change) => expect(reelWanted({ ...ok, ...change })).toBe(false))
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
