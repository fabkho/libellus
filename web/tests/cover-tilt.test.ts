import { describe, expect, it } from 'vitest'
import { FLAT, TILT_MAX_DEG, between, leanAt, leanTransform, mayLean, stillCovers } from '../app/utils/coverTilt'
import { progressAt, timeAt } from '../app/utils/motion'

/**
 * The hero cover's lean (utils/coverTilt.ts; docs/MOTION.md, Hero cover): the arithmetic and the
 * gate. The gesture itself (pointer events, the spring back) is checked by eye on a phone.
 */
const box = { left: 100, top: 50, width: 140, height: 210 }

describe('leanAt', () => {
  it('is flat with the finger in the middle', () => {
    expect(leanAt(box, 170, 155)).toEqual(FLAT)
  })

  it('turns to the finger, at most the maximum at the edge', () => {
    // Top right corner: the top edge and the right edge come near (both negative).
    expect(leanAt(box, 240, 50)).toEqual({ x: -TILT_MAX_DEG, y: -TILT_MAX_DEG })
    // Bottom left corner: the other way round.
    expect(leanAt(box, 100, 260)).toEqual({ x: TILT_MAX_DEG, y: TILT_MAX_DEG })
    // Halfway to the right edge, halfway down: half the lean on each axis.
    const half = leanAt(box, 205, 207.5)
    expect(half.x).toBeCloseTo(TILT_MAX_DEG / 2)
    expect(half.y).toBeCloseTo(-TILT_MAX_DEG / 2)
  })

  it('leans no further when the finger leaves the cover', () => {
    expect(leanAt(box, 2000, -500)).toEqual({ x: -TILT_MAX_DEG, y: -TILT_MAX_DEG })
  })

  it('is flat for a cover with no size', () => {
    expect(leanAt({ left: 0, top: 0, width: 0, height: 0 }, 10, 10)).toEqual(FLAT)
  })
})

describe('leanTransform', () => {
  it('is a rotation in perspective, flat at rest', () => {
    expect(leanTransform(FLAT)).toBe('perspective(700px) rotateX(0.000deg) rotateY(0.000deg)')
    expect(leanTransform({ x: -8, y: 4.5 })).toBe('perspective(700px) rotateX(-8.000deg) rotateY(4.500deg)')
  })
})

describe('between', () => {
  it('goes from one lean to the other', () => {
    expect(between(FLAT, { x: 8, y: -4 }, 0)).toEqual(FLAT)
    expect(between(FLAT, { x: 8, y: -4 }, 0.5)).toEqual({ x: 4, y: -2 })
    expect(between({ x: 8, y: -4 }, FLAT, 1)).toEqual(FLAT)
  })
})

describe('mayLean', () => {
  it('leans only when nothing moves, the cover is showing and Reduce Motion is off', () => {
    expect(mayLean({ reduced: false, moving: false, hidden: false })).toBe(true)
    // The cover's flight or its hand-over (and any other mover): the measured box must stay the cover's.
    expect(mayLean({ reduced: false, moving: true, hidden: false })).toBe(false)
    // A copy flies in the cover's place.
    expect(mayLean({ reduced: false, moving: false, hidden: true })).toBe(false)
    // Reduce Motion: nothing moves, not even under the finger.
    expect(mayLean({ reduced: true, moving: false, hidden: false })).toBe(false)
  })
})

describe('stillCovers', () => {
  it('does nothing when no cover leans', () => {
    expect(() => stillCovers()).not.toThrow()
  })
})

describe('progressAt', () => {
  const standard = 'cubic-bezier(0.2, 0, 0, 1)'

  it('starts at 0 and ends at 1', () => {
    expect(progressAt(standard, 0)).toBeCloseTo(0)
    expect(progressAt(standard, 1)).toBeCloseTo(1)
  })

  it('is fast out of the gate on the standard curve', () => {
    expect(progressAt(standard, 0.5)).toBeGreaterThan(0.8)
  })

  it('is the reverse of timeAt', () => {
    for (const time of [0.1, 0.3, 0.6, 0.9]) expect(timeAt(standard, progressAt(standard, time))).toBeCloseTo(time, 4)
  })

  it('is linear for anything that is not a cubic-bezier, and clamped', () => {
    expect(progressAt('linear', 0.3)).toBe(0.3)
    expect(progressAt(standard, 1.5)).toBeCloseTo(1)
    expect(progressAt(standard, -1)).toBeCloseTo(0)
  })
})
