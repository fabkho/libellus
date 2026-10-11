import { describe, expect, it } from 'vitest'
import { createRereads } from '../app/utils/rereads'

// What is read again once the app is back online after a write that got no answer (social v1, gate 2, M1): pure.

describe('the reads a write that got no answer leaves to ask again', () => {
  it('keeps what an unanswered write may have changed, once', () => {
    const rereads = createRereads<'mine' | 'people'>()
    rereads.note(true, 'offline', ['mine', 'people'])
    rereads.note(true, 'offline', ['people'])
    expect(rereads.take().sort()).toEqual(['mine', 'people'])
    expect(rereads.take()).toEqual([])
  })

  it('keeps nothing for a write refused before it was sent, an answered one or a refusal', () => {
    const rereads = createRereads<string>()
    rereads.note(false, 'offline', ['mine'])
    rereads.note(true, null, ['mine'])
    rereads.note(true, 'follow_self', ['mine'])
    expect(rereads.take()).toEqual([])
  })

  it('forgets everything on clear (a sign-out)', () => {
    const rereads = createRereads<string>()
    rereads.note(true, 'offline', ['a'])
    rereads.clear()
    expect(rereads.take()).toEqual([])
  })
})
