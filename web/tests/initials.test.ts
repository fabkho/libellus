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

describe('the avatar initials with a name', () => {
  it.each([
    ['Fabian', 'F'],
    ['ida tester', 'IT'],
    ['Anna-Lena Maier', 'AL'],
    ['  élodie  ', 'É'],
    ['', 'IT'],
    [null, 'IT'],
    ['--', 'IT'],
  ])('%s → %s (the address is ida.tester@…)', (name, expected) => {
    expect(initialsOf('ida.tester@example.com', name)).toBe(expected)
  })
})
