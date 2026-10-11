import { describe, expect, it } from 'vitest'
import { likeable, shownFace, toggledFace } from '../app/utils/likes'

/** What a heart shows (utils/likes.ts, social v2a §3). */
describe('toggledFace', () => {
  it('adds a like and fills the heart', () => {
    expect(toggledFace({ likes: 0, liked: false })).toEqual({ likes: 1, liked: true })
    expect(toggledFace({ likes: 3, liked: false })).toEqual({ likes: 4, liked: true })
  })

  it('takes a like back, never below zero', () => {
    expect(toggledFace({ likes: 4, liked: true })).toEqual({ likes: 3, liked: false })
    expect(toggledFace({ likes: 0, liked: true })).toEqual({ likes: 0, liked: false })
  })
})

describe('shownFace', () => {
  const base = { likes: 3, liked: false }

  it('is the row when she has not tapped', () => {
    expect(shownFace(base, undefined)).toBe(base)
  })

  it('is her tap while the row still says what it said then', () => {
    expect(shownFace(base, { base: { ...base }, face: { likes: 4, liked: true } })).toEqual({ likes: 4, liked: true })
  })

  it('is the row once it says something else (a feed read afresh)', () => {
    expect(shownFace({ likes: 5, liked: true }, { base: { ...base }, face: { likes: 4, liked: true } })).toEqual({ likes: 5, liked: true })
  })
})

describe('likeable', () => {
  it('is for a row with a finished read behind it', () => {
    expect(likeable({ sessionId: 's1' })).toBe(true)
    expect(likeable({ sessionId: null })).toBe(false)
    expect(likeable({ sessionId: '' })).toBe(false)
    expect(likeable({})).toBe(false)
  })
})
