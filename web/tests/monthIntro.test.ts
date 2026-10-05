import { describe, expect, it } from 'vitest'
import { MAX_STAGGER, rowDelay, SPREAD, startOffsets, STAGGER_BUDGET } from '../app/utils/monthIntro'

/** The month rows' opening (utils/monthIntro.ts): a stagger like Regal's pile and a spread from the row's start. */
describe('rowDelay', () => {
  it('starts the first row at once', () => {
    expect(rowDelay(0, 12)).toBe(0)
  })

  it('steps rows by Regal’s 40 ms', () => {
    expect(rowDelay(1, 12)).toBe(MAX_STAGGER)
    expect(rowDelay(11, 12)).toBe(11 * MAX_STAGGER)
  })

  it('squeezes a long list into the budget', () => {
    expect(rowDelay(99, 100)).toBeCloseTo(STAGGER_BUDGET)
  })

  it('has no delay for a lone row', () => {
    expect(rowDelay(0, 1)).toBe(0)
  })
})

describe('startOffsets', () => {
  it('keeps the first cover and moves the others by their distance', () => {
    expect(startOffsets([0, 44, 88], 0.25)).toEqual([0, 11, 22])
  })

  it('spreads by SPREAD unless told otherwise', () => {
    expect(startOffsets([40])[0]).toBe(40 * SPREAD)
  })

  it('has nothing to spread in an empty row', () => {
    expect(startOffsets([])).toEqual([])
  })
})
