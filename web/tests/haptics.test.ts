import { afterEach, describe, expect, it, vi } from 'vitest'
import { hapticsKind, isRatingStep, tick, TICK_MS } from '@/utils/haptics'

describe('a haptic tick on the rating', () => {
  it('ticks when the Rating moves to another step, not when it stays', () => {
    expect(isRatingStep(null, 4)).toBe(true)
    expect(isRatingStep(4, 5)).toBe(true)
    expect(isRatingStep(20, null)).toBe(true)
    expect(isRatingStep(7, 7)).toBe(false)
    // Empty is empty, whether null or 0.
    expect(isRatingStep(null, null)).toBe(false)
    expect(isRatingStep(null, 0)).toBe(false)
  })

  describe('on a device', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('does nothing without a navigator, or where the browser has no way to tick', () => {
      vi.stubGlobal('navigator', undefined)
      expect(hapticsKind()).toBeNull()
      expect(() => tick()).not.toThrow()
      vi.stubGlobal('navigator', { maxTouchPoints: 0 })
      expect(hapticsKind()).toBeNull()
      expect(() => tick()).not.toThrow()
    })

    it('vibrates a few milliseconds where the Vibration API exists', () => {
      const vibrate = vi.fn(() => true)
      vi.stubGlobal('navigator', { vibrate, maxTouchPoints: 5 })
      expect(hapticsKind()).toBe('vibrate')
      tick()
      expect(vibrate).toHaveBeenCalledExactlyOnceWith(TICK_MS)
    })

    it('uses the switch checkbox on a touch WebKit without the Vibration API', () => {
      vi.stubGlobal('navigator', { maxTouchPoints: 5 })
      vi.stubGlobal('document', {})
      vi.stubGlobal('CSS', { supports: (name: string) => name === '-webkit-touch-callout' })
      expect(hapticsKind()).toBe('switch')
    })

    it('leaves a touchless WebKit (desktop Safari) alone', () => {
      vi.stubGlobal('navigator', { maxTouchPoints: 0 })
      vi.stubGlobal('document', {})
      vi.stubGlobal('CSS', { supports: () => true })
      expect(hapticsKind()).toBeNull()
    })

    it('swallows a browser that refuses the vibration', () => {
      vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked') } })
      expect(() => tick()).not.toThrow()
    })
  })
})
