import { describe, expect, it } from 'vitest'
import { canWantToRead, carriesWantToRead } from '../app/utils/wantToRead'

/**
 * When the Want to read button on a friend's Book is there (utils/wantToRead.ts, social v2a §3): only to add.
 */

const catalogue = { manual: false }

describe('canWantToRead', () => {
  it('offers to add a Book that is not in her Library', () => {
    expect(canWantToRead(catalogue, null)).toBe(true)
  })

  it('shows nothing for a Book she has, in any list', () => {
    for (const status of ['want_to_read', 'reading', 'finished'] as const) expect(canWantToRead(catalogue, { status })).toBe(false)
  })

  it('has no button on a Manual book', () => {
    expect(canWantToRead({ manual: true }, null)).toBe(false)
  })
})

describe('carriesWantToRead', () => {
  it('is for what a friend finished, reviewed or started', () => {
    expect(carriesWantToRead('finished')).toBe(true)
    expect(carriesWantToRead('reviewed')).toBe(true)
    expect(carriesWantToRead('started')).toBe(true)
  })

  it('is not for her Want to read or a read she gave up', () => {
    expect(carriesWantToRead('want')).toBe(false)
    expect(carriesWantToRead('abandoned')).toBe(false)
  })
})
