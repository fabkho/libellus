import { describe, expect, it } from 'vitest'
import { followBackFace, memberActions, peopleSegments, requestRows, startSegment, type RequestItem } from '../app/utils/people'

// What People and the member sheet decide (social v1, U3): pure, no stack needed.
describe('the segments', () => {
  it('shows Requests only while a request waits', () => {
    expect(peopleSegments(false)).toEqual(['following', 'followers'])
    expect(peopleSegments(true)).toEqual(['following', 'followers', 'requests'])
  })

  it('opens on Requests when one waits, else on Following', () => {
    expect(startSegment(true)).toBe('requests')
    expect(startSegment(false)).toBe('following')
  })
})

describe('the member sheet', () => {
  it('offers Unfollow for someone she follows, Remove for a follower, both for both, Block always', () => {
    expect(memberActions({ following: true, follower: false })).toEqual(['unfollow', 'block'])
    expect(memberActions({ following: false, follower: true })).toEqual(['remove', 'block'])
    expect(memberActions({ following: true, follower: true })).toEqual(['unfollow', 'remove', 'block'])
    expect(memberActions({ following: false, follower: false })).toEqual(['block'])
  })
})

describe('Follow back on a follower', () => {
  const none = new Set<string>()
  const noAnswers = new Map<string, 'following' | 'requested'>()

  it('is offered when she does not follow them', () => {
    expect(followBackFace({ id: 'a', followsBack: false }, none, noAnswers)).toBe('offer')
  })

  it('is not offered when she follows them already', () => {
    expect(followBackFace({ id: 'a', followsBack: true }, none, noAnswers)).toBeNull()
  })

  it('says Requested when she asked already', () => {
    expect(followBackFace({ id: 'a', followsBack: false }, new Set(['a']), noAnswers)).toBe('requested')
  })

  it('shows at once what the answer was: following (the button goes) or requested', () => {
    expect(followBackFace({ id: 'a', followsBack: false }, none, new Map([['a', 'following' as const]]))).toBeNull()
    expect(followBackFace({ id: 'a', followsBack: false }, none, new Map([['a', 'requested' as const]]))).toBe('requested')
  })
})

describe('the Requests rows', () => {
  const ida = { id: 'ida', name: 'Ida', photo: null, askedAt: '2026-10-08T10:00:00Z' }
  const tom = { id: 'tom', name: 'Tom', photo: null, askedAt: '2026-10-05T10:00:00Z' }
  const none = new Map<string, RequestItem>()

  it('lists the waiting ones, newest first', () => {
    expect(requestRows([tom, ida], none, new Set()).map((r) => [r.id, r.state])).toEqual([
      ['ida', 'asked'],
      ['tom', 'asked'],
    ])
  })

  it('keeps one she accepted here, in its place, saying so even when the database no longer lists it', () => {
    const accepted = new Map<string, RequestItem>([['ida', { ...ida, state: 'accepted' }]])
    expect(requestRows([tom], accepted, new Set()).map((r) => [r.id, r.state])).toEqual([
      ['ida', 'accepted'],
      ['tom', 'asked'],
    ])
    expect(requestRows([ida, tom], accepted, new Set()).map((r) => [r.id, r.state])).toEqual([
      ['ida', 'accepted'],
      ['tom', 'asked'],
    ])
  })

  it('drops one she declined at once', () => {
    expect(requestRows([ida, tom], none, new Set(['ida'])).map((r) => r.id)).toEqual(['tom'])
  })
})
