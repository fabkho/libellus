import { describe, expect, it } from 'vitest'
import { COVER_BUDGET, coverDelay, MAX_STAGGER, rowDelay, STAGGER_BUDGET } from '../app/utils/monthIntro'

/** The month rows' opening (utils/monthIntro.ts): Regal's pile stagger, by row and by cover. */
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

describe('coverDelay', () => {
  it('starts the first cover with its row', () => {
    expect(coverDelay(0)).toBe(0)
  })

  it('steps covers by 40 ms', () => {
    expect(coverDelay(3)).toBe(3 * MAX_STAGGER)
  })

  it('keeps a long row within its budget', () => {
    expect(coverDelay(40)).toBe(COVER_BUDGET)
  })
})
