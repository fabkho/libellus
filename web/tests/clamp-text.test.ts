import { describe, expect, it } from 'vitest'
import { heightKeyframes, isCut } from '../app/utils/clampText'

/** The pure rules behind components/ui/ClampText.vue: when "more" shows, and how the height glides. */

describe('isCut', () => {
  it('is cut when the full text runs past the clamped box', () => {
    expect(isCut(90, 40)).toBe(true)
  })
  it('is not cut when it fits, or within a pixel of rounding', () => {
    expect(isCut(40, 40)).toBe(false)
    expect(isCut(41, 40)).toBe(false)
    expect(isCut(0, 0)).toBe(false)
  })
})

describe('heightKeyframes', () => {
  it('glides from the old height to the new one', () => {
    expect(heightKeyframes(40, 100, false)).toEqual([{ height: '40px' }, { height: '100px' }])
  })
  it('animates a fold the same way, back down', () => {
    expect(heightKeyframes(100, 40, false)).toEqual([{ height: '100px' }, { height: '40px' }])
  })
  it('returns null under Reduce Motion', () => {
    expect(heightKeyframes(40, 100, true)).toBeNull()
  })
  it('returns null when the height does not change', () => {
    expect(heightKeyframes(40, 40, false)).toBeNull()
  })
})
