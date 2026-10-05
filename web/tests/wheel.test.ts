import { describe, expect, it } from 'vitest'
import {
  decayAt,
  DECAY_MS,
  FLING_MIN_SPEED,
  FLING_MS,
  flingTarget,
  releaseSpeed,
  RUBBER_MAX_ROWS,
  rubberBand,
  tappedRow,
  valueAt,
} from '@/utils/wheel'

/**
 * The progress wheel's physics (issue #68, utils/wheel.ts): a drag inside the drum
 * is 1:1 and gives way past the ends, a release lands on a whole number where its
 * speed carries it, the coast slows and ends exactly there, and a tap knows which
 * row it hit. Pure functions, no browser.
 */
describe('the progress wheel', () => {
  it('follows the finger inside the drum and gives way less and less past an end', () => {
    expect(rubberBand(12.4, 608)).toBe(12.4)
    expect(rubberBand(0, 608)).toBe(0)
    expect(rubberBand(608, 608)).toBe(608)
    const a = rubberBand(-1, 608)
    const b = rubberBand(-4, 608)
    expect(a).toBeLessThan(0)
    expect(a).toBeGreaterThan(-1)
    expect(b).toBeLessThan(a)
    expect(rubberBand(-1000, 608)).toBeGreaterThan(-RUBBER_MAX_ROWS)
    expect(rubberBand(610, 608)).toBeGreaterThan(608)
    expect(rubberBand(610, 608)).toBeLessThan(610)
  })

  it('lands a release on a whole number: the nearest when slow, further on with a flick, within the drum', () => {
    expect(flingTarget(212.4, 0, 608)).toBe(212)
    expect(flingTarget(212.6, FLING_MIN_SPEED / 2, 608)).toBe(213)
    expect(flingTarget(212, 0.04, 608)).toBe(Math.round(212 + 0.04 * FLING_MS))
    expect(flingTarget(212, -0.04, 608)).toBe(Math.round(212 - 0.04 * FLING_MS))
    expect(flingTarget(600, 1, 608)).toBe(608)
    expect(flingTarget(3, -1, 608)).toBe(0)
  })

  it('coasts towards the landing row, slowing down, and ends exactly on it', () => {
    expect(decayAt(200, 230, 0)).toBe(200)
    const early = decayAt(200, 230, DECAY_MS / 2)
    const later = decayAt(200, 230, DECAY_MS * 2)
    expect(early).toBeGreaterThan(200)
    expect(later).toBeGreaterThan(early)
    expect(later).toBeLessThan(230)
    // Slower: the second half of the same time covers less ground.
    expect(later - decayAt(200, 230, DECAY_MS)).toBeLessThan(decayAt(200, 230, DECAY_MS) - 200)
    expect(decayAt(200, 230, DECAY_MS * 20)).toBe(230)
    expect(decayAt(230, 200, DECAY_MS * 20)).toBe(200)
  })

  it('shows the nearest whole number, within its ends', () => {
    expect(valueAt(11.4, 1, 3000)).toBe(12)
    expect(valueAt(11.6, 1, 3000)).toBe(13)
    expect(valueAt(-0.8, 0, 100)).toBe(0)
    expect(valueAt(101.2, 0, 100)).toBe(100)
  })

  it('measures a release by the last moments of the drag; a finger that stopped has no speed left', () => {
    const samples = [
      { t: 0, at: 10 },
      { t: 50, at: 12 },
      { t: 100, at: 15 },
      { t: 150, at: 19 },
    ]
    expect(releaseSpeed(samples, 150)).toBeCloseTo((19 - 15) / 50)
    expect(releaseSpeed(samples, 400)).toBe(0)
    expect(releaseSpeed([{ t: 0, at: 3 }], 0)).toBe(0)
  })

  it('knows which row a tap hit: the centre, or how many above or below', () => {
    expect(tappedRow(0, 44)).toBe(0)
    expect(tappedRow(20, 44)).toBe(0)
    expect(tappedRow(-30, 44)).toBe(-1)
    expect(tappedRow(90, 44)).toBe(2)
  })
})
