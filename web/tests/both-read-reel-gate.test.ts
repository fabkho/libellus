import { describe, expect, it, vi } from 'vitest'
import { hasWebgl, reelWanted, saveDataOn, slowDevice, webglAvailable, type ReelGate } from '../app/utils/bothReadReel'

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

describe('the throwaway WebGL context', () => {
  it('is let go at once (WEBGL_lose_context), whatever came, and failing to let go changes nothing', () => {
    let lost = 0
    const gl = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => void lost++ } : null) }
    expect(hasWebgl({ createElement: () => ({ getContext: (kind: string) => (kind === 'webgl2' ? gl : null) }) } as unknown as Document)).toBe(true)
    expect(lost).toBe(1)
    const stubborn = { getExtension: () => ({ loseContext: () => { throw new Error('already lost') } }) }
    expect(hasWebgl({ createElement: () => ({ getContext: () => stubborn }) } as unknown as Document)).toBe(true)
  })
  it('is asked once for the page load', () => {
    let canvases = 0
    vi.stubGlobal('document', { createElement: () => (canvases++, { getContext: () => ({}) }) })
    expect(webglAvailable()).toBe(true)
    expect(webglAvailable()).toBe(true)
    expect(canvases).toBe(1)
    vi.unstubAllGlobals()
  })
})

describe('slowDevice (no background downloads on a 2g connection or a phone with 2 GB or less)', () => {
  it('knows them', () => {
    expect(slowDevice({ connection: { effectiveType: '2g' } })).toBe(true)
    expect(slowDevice({ connection: { effectiveType: 'slow-2g' } })).toBe(true)
    expect(slowDevice({ deviceMemory: 2 })).toBe(true)
    expect(slowDevice({ deviceMemory: 1 })).toBe(true)
    expect(slowDevice({ connection: { effectiveType: '4g' }, deviceMemory: 8 })).toBe(false)
    expect(slowDevice({})).toBe(false)
  })
})
