import { describe, expect, it } from 'vitest'
import { dayPartOf } from '@/composables/useGreeting'

describe('dayPartOf', () => {
  it('is morning from 5, afternoon from 12 and evening from 18 until 5', () => {
    const at = (hour: number) => dayPartOf(new Date(2026, 9, 3, hour, 30))
    expect([4, 5, 11].map(at)).toEqual(['evening', 'morning', 'morning'])
    expect([12, 17].map(at)).toEqual(['afternoon', 'afternoon'])
    expect([18, 23, 0].map(at)).toEqual(['evening', 'evening', 'evening'])
  })
})
