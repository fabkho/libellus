import { describe, expect, it } from 'vitest'
import type { LibraryEntry } from '../app/data/library'
import { carriesWantToRead, wantToReadFace } from '../app/utils/wantToRead'

/**
 * What the Want to read button on a friend's Book says (utils/wantToRead.ts, social v2a §3): add it,
 * or where it already is; nothing on a Manual book.
 */

const catalogue = { manual: false }
const entry = (status: LibraryEntry['status'], outcome: 'finished' | 'abandoned' | null = null) =>
  ({ status, latestSession: outcome ? { outcome } : null }) as Pick<LibraryEntry, 'status' | 'latestSession'>

describe('wantToReadFace', () => {
  it('offers to add a Book that is not in her Library', () => {
    expect(wantToReadFace(catalogue, null)).toEqual({ kind: 'add' })
  })

  it('says where a Book already is, for each status', () => {
    expect(wantToReadFace(catalogue, entry('want_to_read'))).toEqual({ kind: 'in', where: 'want_to_read' })
    expect(wantToReadFace(catalogue, entry('reading'))).toEqual({ kind: 'in', where: 'reading' })
    expect(wantToReadFace(catalogue, entry('finished', 'finished'))).toEqual({ kind: 'in', where: 'finished' })
  })

  it('does not call a read she stopped Read', () => {
    expect(wantToReadFace(catalogue, entry('finished', 'abandoned'))).toEqual({ kind: 'in', where: 'not_finished' })
  })

  it('has no button on a Manual book, in her Library or not', () => {
    expect(wantToReadFace({ manual: true }, null)).toBeNull()
    expect(wantToReadFace({ manual: true }, entry('reading'))).toBeNull()
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
