import { describe, expect, it } from 'vitest'
import { keyboardInsetOf, paletteLift, revealDelta, sheetLift } from '@/utils/keyboard'

/**
 * Following the iOS keyboard (composables/useKeyboardInset.ts, UiSheet): how
 * much of the window it covers, how far a sheet goes up to sit on it, and how
 * far the sheet's body scrolls to show the focused field.
 */
describe('the keyboard inset', () => {
  it('is what of the window the visual viewport neither shows nor has scrolled past', () => {
    // iPhone 16: 852 tall, a 336 keyboard.
    expect(keyboardInsetOf(852, { height: 516, offsetTop: 0 })).toBe(336)
    // Safari panned the page up by 120 to show the field: the keyboard still covers 336.
    expect(keyboardInsetOf(852, { height: 516, offsetTop: 0.4 })).toBe(336)
    expect(keyboardInsetOf(852, { height: 396, offsetTop: 120 })).toBe(336)
  })

  it('is 0 with the keyboard down, without a visual viewport, and never negative', () => {
    expect(keyboardInsetOf(852, { height: 852, offsetTop: 0 })).toBe(0)
    expect(keyboardInsetOf(852, null)).toBe(0)
    // Pinch-zoomed out past the window: nothing is covered.
    expect(keyboardInsetOf(852, { height: 900, offsetTop: 0 })).toBe(0)
  })
})

describe('a sheet on the keyboard', () => {
  it('goes up by the keyboard, less its home-indicator padding that may go behind it', () => {
    expect(sheetLift(336, 34)).toBe(302)
    expect(sheetLift(336, 0)).toBe(336)
  })

  it('stays where it is with the keyboard down', () => {
    expect(sheetLift(0, 34)).toBe(0)
    expect(sheetLift(20, 34)).toBe(0)
  })
})

describe('revealing the focused field in a sheet', () => {
  const body = { top: 100, bottom: 400 }

  it('leaves a field that shows whole', () => {
    expect(revealDelta(body, { top: 200, bottom: 250 }, 16)).toBe(0)
  })

  it('scrolls down just enough for a field below the fold, with the margin', () => {
    expect(revealDelta(body, { top: 380, bottom: 430 }, 16)).toBe(46)
  })

  it('scrolls up just enough for a field above it', () => {
    expect(revealDelta(body, { top: 60, bottom: 110 }, 16)).toBe(-56)
  })

  it('lines a field taller than the body up with its top', () => {
    expect(revealDelta(body, { top: 150, bottom: 600 }, 16)).toBe(34)
  })
})

describe('the search palette on the keyboard', () => {
  it('goes up by the keyboard plus its gap, less where float-bottom already puts it', () => {
    // 336 keyboard, 12 gap, resting 30 above the bottom edge (safe area 34 - 4).
    expect(paletteLift(336, 12, 30)).toBe(318)
  })

  it('stays where it is with the keyboard down, and never goes down', () => {
    expect(paletteLift(0, 12, 30)).toBe(0)
    expect(paletteLift(10, 12, 30)).toBe(0)
  })
})
