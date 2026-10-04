import { afterEach, describe, expect, it, vi } from 'vitest'
import { hapticsKind, isRatingStep, STEP_GAP_MS, stepTick, tick, TICK_MS } from '@/utils/haptics'

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

describe('a tick per value on the progress wheel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('vibrates once per value, but never closer together than a motor can tell apart', () => {
    const vibrate = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate, maxTouchPoints: 5 })
    const start = 1_000_000
    expect(stepTick(start)).toBe(true)
    expect(stepTick(start + STEP_GAP_MS / 2)).toBe(false)
    expect(stepTick(start + STEP_GAP_MS)).toBe(true)
    expect(vibrate).toHaveBeenCalledTimes(2)
    expect(vibrate).toHaveBeenCalledWith(TICK_MS)
  })

  it('stays silent where there is no Vibration API (iOS, desktops): no switch trick while dragging', () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 5 })
    vi.stubGlobal('document', {})
    vi.stubGlobal('CSS', { supports: () => true })
    expect(stepTick(2_000_000)).toBe(false)
    vi.stubGlobal('navigator', undefined)
    expect(stepTick(3_000_000)).toBe(false)
  })

  it('swallows a browser that refuses the vibration', () => {
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('blocked') } })
    expect(stepTick(4_000_000)).toBe(false)
  })
})
