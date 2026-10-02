import { describe, expect, it } from 'vitest'
import { initialsOf } from '@/utils/initials'

describe('the avatar initials', () => {
  it.each([
    ['ida.tester@example.com', 'IT'],
    ['ida_tester+books@example.com', 'IT'],
    ['ida@example.com', 'ID'],
    ['x@example.com', 'X'],
    ['élodie-martin@example.com', 'ÉM'],
    ['', '?'],
    ['@example.com', '?'],
  ])('%s → %s', (email, expected) => {
    expect(initialsOf(email)).toBe(expected)
  })
})
