import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../app/data/library'
import { canWantToRead, carriesWantToRead, wantState } from '../app/utils/wantToRead'

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

const entry = (status: LibraryEntry['status'], over: Partial<LibraryEntry> = {}) => ({ status, latestSession: null, ...over }) as unknown as LibraryEntry

describe('wantState (the icon in the right column of a row)', () => {
  it('is an add for a Book she does not have', () => {
    expect(wantState(catalogue, null)).toEqual({ kind: 'add' })
  })

  it('is a quiet bookmark that opens the Book, with where it stands, for a Book she has', () => {
    expect(wantState(catalogue, entry('want_to_read'))).toEqual({ kind: 'have', where: 'wantToRead' })
    expect(wantState(catalogue, entry('reading'))).toEqual({ kind: 'have', where: 'reading' })
    expect(wantState(catalogue, entry('finished', { latestSession: { outcome: 'finished' } as never }))).toEqual({ kind: 'have', where: 'read' })
    expect(wantState(catalogue, entry('finished', { latestSession: { outcome: 'abandoned' } as never }))).toEqual({ kind: 'have', where: 'notFinished' })
  })

  it('is nothing for a Manual book or one the check could not confirm, whatever her Library has', () => {
    expect(wantState({ manual: true }, null)).toBeNull()
    expect(wantState({ manual: false, unverified: true }, entry('reading'))).toBeNull()
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
