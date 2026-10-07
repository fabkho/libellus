import { describe, expect, it } from 'vitest'
import { AT_BOOK, AT_LIST, isBookPath, isCardPath, isFlightPath, lerpBox, onScreen, startAt, transformFrom, valueOf } from '../app/utils/flight'
import { timeAt } from '../app/utils/motion'

/**
 * The arithmetic of the cover's flight into the book page and back
 * (utils/flight.ts, docs/MOTION.md, Push to a book): the FLIP transform, the
 * boxes in between, what counts as on screen, and where a flight that turns
 * another around starts.
 */

const row = { left: 20, top: 600, width: 40, height: 60 }
const hero = { left: 126.5, top: 100, width: 140, height: 210 }
const STANDARD = 'cubic-bezier(0.2, 0, 0, 1)'

/** Applies `translate(x, y) scale(sx, sy)` with origin 0 0 to a box laid out at `at`. */
function drawn(at: typeof row, transform: string) {
  const [x, y, sx, sy] = /translate\((.+)px, (.+)px\) scale\((.+), (.+)\)/.exec(transform)!.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
  ]
  return { left: at.left + x, top: at.top + y, width: at.width * sx, height: at.height * sy }
}

describe('the flight transform', () => {
  it('draws the hero, laid out at its own box, over the row', () => {
    const box = drawn(hero, transformFrom(hero, row))
    expect(box.left).toBeCloseTo(row.left, 1)
    expect(box.top).toBeCloseTo(row.top, 1)
    expect(box.width).toBeCloseTo(row.width, 2)
    expect(box.height).toBeCloseTo(row.height, 2)
  })

  it('is no move at all from a box to itself', () => {
    expect(transformFrom(hero, hero)).toBe('translate(0px, 0px) scale(1, 1)')
  })

  it('passes through the boxes in between in a straight line', () => {
    expect(lerpBox(row, hero, 0)).toEqual(row)
    expect(lerpBox(row, hero, 1)).toEqual(hero)
    expect(lerpBox(row, hero, 0.5)).toEqual({ left: 73.25, top: 350, width: 90, height: 135 })
  })
})

describe('on screen', () => {
  const phone = { width: 393, height: 852 }

  it('counts a box any part of which is in the viewport', () => {
    expect(onScreen(row, phone)).toBe(true)
    expect(onScreen({ ...row, top: -50 }, phone)).toBe(true)
    expect(onScreen({ ...row, top: 840 }, phone)).toBe(true)
  })

  it('does not count a box scrolled away, or one without size', () => {
    expect(onScreen({ ...row, top: -60 }, phone)).toBe(false)
    expect(onScreen({ ...row, top: 852 }, phone)).toBe(false)
    expect(onScreen({ ...row, left: 400 }, phone)).toBe(false)
    expect(onScreen({ ...row, width: 0, height: 0 }, phone)).toBe(false)
  })
})

describe('turning a flight around', () => {
  it('starts a flight from rest at its beginning, either way', () => {
    expect(startAt(AT_LIST.cover, 'book', STANDARD, 250)).toBe(0)
    expect(startAt(AT_BOOK.cover, 'list', STANDARD, 200)).toBe(0)
  })

  it('starts the flight back where the push had got to, on its own curve and length', () => {
    // A push 100 ms into its 250: the cover shows this much of the way.
    const shown = valueOf(0.81, 'book')
    const back = startAt(shown, 'list', STANDARD, 200)
    // The flight back shows the same point on its first frame.
    expect(back).toBeGreaterThan(0)
    expect(back).toBeLessThan(200)
    const progress = 1 - shown
    expect(timeAt(STANDARD, progress) * 200).toBeCloseTo(back, 6)
  })

  it('reads a channel back from an animation either way', () => {
    expect(valueOf(0.3, 'book')).toBeCloseTo(0.3)
    expect(valueOf(0.3, 'list')).toBeCloseTo(0.7)
    // Not running (cancelled or never started): at its end.
    expect(valueOf(null, 'book')).toBe(1)
    expect(valueOf(null, 'list')).toBe(0)
  })

  it('round-trips: a channel value turned into a start and back is the same value', () => {
    for (const value of [0, 0.1, 0.5, 0.9, 1]) {
      const at = startAt(value, 'list', STANDARD, 200) / 200
      // The standard curve evaluated at that time gives back the progress 1 − value.
      const y = bezierY(STANDARD, at)
      expect(1 - y).toBeCloseTo(value, 3)
    }
  })
})

describe('book pages', () => {
  it('knows a book page by its address', () => {
    expect(isBookPath('/book/2f1c6a0e-9b1d-4c55-8f7b-3f1e2d6c9a10')).toBe(true)
    expect(isBookPath('/book/apple:123')).toBe(true)
    expect(isBookPath('/library')).toBe(false)
    expect(isBookPath('/book/')).toBe(false)
    expect(isBookPath('/book/a/b')).toBe(false)
  })

  it('knows a public Book card by its address, which a cover flies to as it does to a book page', () => {
    expect(isCardPath('/r/Zq1b2c3d4e5f6g7h8i9j0k/book/2f1c6a0e-9b1d-4c55-8f7b-3f1e2d6c9a10')).toBe(true)
    expect(isCardPath('/r/Zq1b2c3d4e5f6g7h8i9j0k')).toBe(false)
    expect(isCardPath('/r/Zq1b2c3d4e5f6g7h8i9j0k/book/')).toBe(false)
    expect(isCardPath('/r/a/book/b/c')).toBe(false)
    expect(isCardPath('/book/2f1c6a0e')).toBe(false)
    expect(isBookPath('/r/Zq1b2c3d4e5f6g7h8i9j0k/book/2f1c6a0e')).toBe(false)
    expect(isFlightPath('/book/apple:123')).toBe(true)
    expect(isFlightPath('/r/Zq1b2c3d4e5f6g7h8i9j0k/book/2f1c6a0e')).toBe(true)
    expect(isFlightPath('/r/Zq1b2c3d4e5f6g7h8i9j0k')).toBe(false)
    expect(isFlightPath('/library')).toBe(false)
  })
})

/** The curve's progress at time `t` (0–1), by bisection on its x — the forward of `timeAt`. */
function bezierY(easing: string, t: number): number {
  const [x1, y1, x2, y2] = /cubic-bezier\(([^)]+)\)/.exec(easing)![1]!.split(',').map(Number) as [number, number, number, number]
  const b = (a: number, c: number, s: number) => 3 * a * s * (1 - s) ** 2 + 3 * c * s ** 2 * (1 - s) + s ** 3
  let low = 0
  let high = 1
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2
    if (b(x1, x2, mid) < t) low = mid
    else high = mid
  }
  return b(y1, y2, (low + high) / 2)
}
