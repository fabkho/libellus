import { describe, expect, it } from 'vitest'
import { afterRise, defersFieldFocus, fieldMayTakeFocus, FIELD_FOCUS_AFTER_RISE, RISE_FOCUS_MARGIN } from '@/utils/sheetFocus'

/**
 * When a sheet's field takes focus (UiSheet, utils/sheetFocus.ts): the panel at
 * once, the field once the rise is over. UiSheet's wiring is the Playwright
 * flow (e2e/sheet-focus.spec.ts); the rules are here.
 */
const IPHONE = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5 }
const PIXEL = { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/145.0 Mobile Safari/537.36', platform: 'Linux armv81', maxTouchPoints: 5 }
const DESKTOP = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 }

describe('the platform switch', () => {
  it('defers everywhere as shipped', () => {
    expect(FIELD_FOCUS_AFTER_RISE).toEqual({ ios: true, elsewhere: true })
    for (const env of [IPHONE, PIXEL, DESKTOP]) expect(defersFieldFocus(env)).toBe(true)
  })

  it('flips iOS alone: tap-time on an iPhone, deferred on Android and desktop', () => {
    const policy = { ios: false, elsewhere: true }
    expect(defersFieldFocus(IPHONE, policy)).toBe(false)
    expect(defersFieldFocus(PIXEL, policy)).toBe(true)
    expect(defersFieldFocus(DESKTOP, policy)).toBe(true)
  })
})

/** An element tree reduced to what `contains` needs. */
function tree() {
  const inside = { id: 'inside' } as unknown as Element
  const panel = { contains: (node: unknown) => node === panel || node === inside } as unknown as Element
  const outside = { id: 'outside' } as unknown as Element
  return { panel, inside, outside }
}

describe('no stolen focus', () => {
  it('lets the field have it from the panel, the body, nothing or somewhere outside the sheet', () => {
    const { panel, outside } = tree()
    expect(fieldMayTakeFocus(panel, panel)).toBe(true)
    expect(fieldMayTakeFocus(null, panel)).toBe(true)
    expect(fieldMayTakeFocus(outside, panel)).toBe(true)
  })

  it('leaves it where the member put it inside the sheet', () => {
    const { panel, inside } = tree()
    expect(fieldMayTakeFocus(inside, panel)).toBe(false)
  })
})

/** A clock that runs only when told to. */
function clock() {
  const pending = new Map<number, { at: number; run: () => void }>()
  let now = 0
  let next = 1
  return {
    timers: {
      set: (run: () => void, ms: number) => {
        pending.set(next, { at: now + ms, run })
        return next++
      },
      clear: (handle: unknown) => void pending.delete(handle as number),
    },
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...pending]) {
        if (timer.at > now) continue
        pending.delete(id)
        timer.run()
      }
    },
    get armed() {
      return pending.size
    },
  }
}

describe('waiting for the rise', () => {
  const FALLBACK = 380 + RISE_FOCUS_MARGIN

  it('holds the field back until the sheet says it is in place', () => {
    const time = clock()
    let focused = 0
    const wait = afterRise(() => focused++, FALLBACK, time.timers)
    time.advance(FALLBACK - 1)
    expect(focused).toBe(0)
    wait.settled()
    expect(focused).toBe(1)
    expect(time.armed).toBe(0)
  })

  it('focuses once: the signal and then the timer do not repeat it', () => {
    const time = clock()
    let focused = 0
    const wait = afterRise(() => focused++, FALLBACK, time.timers)
    wait.settled()
    wait.settled()
    time.advance(FALLBACK * 2)
    expect(focused).toBe(1)
  })

  it('falls back to a timer when the signal never comes', () => {
    const time = clock()
    let focused = 0
    afterRise(() => focused++, FALLBACK, time.timers)
    time.advance(FALLBACK)
    expect(focused).toBe(1)
  })

  it('does nothing once cancelled (the sheet closed first)', () => {
    const time = clock()
    let focused = 0
    const wait = afterRise(() => focused++, FALLBACK, time.timers)
    wait.cancel()
    wait.settled()
    time.advance(FALLBACK * 2)
    expect(focused).toBe(0)
    expect(time.armed).toBe(0)
  })
})
