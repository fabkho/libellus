import { describe, expect, it } from 'vitest'
import { blockedValue, privacyValueKey, privateChange, requestsValue } from '../app/utils/friendsRows'

// What the Profile's Friends rows and the privacy sheet say (social v1, U1): pure, no stack needed.
describe('the People row', () => {
  it('shows nothing until her settings are known and while no request waits', () => {
    expect(requestsValue(null)).toBeNull()
    expect(requestsValue({ requests: 0 })).toBeNull()
  })

  it('shows how many requests wait', () => {
    expect(requestsValue({ requests: 1 })).toBe(1)
    expect(requestsValue({ requests: 4 })).toBe(4)
  })
})

describe('the Privacy row', () => {
  it('says Private or Public by her setting, nothing before it is known', () => {
    expect(privacyValueKey(null)).toBeNull()
    expect(privacyValueKey({ private: true })).toBe('friends.private')
    expect(privacyValueKey({ private: false })).toBe('friends.public')
  })
})

describe('the Blocked row', () => {
  it('shows a count, or nothing for none (the row says None)', () => {
    expect(blockedValue(null)).toBeNull()
    expect(blockedValue(0)).toBeNull()
    expect(blockedValue(2)).toBe(2)
  })
})

describe('Private account switch', () => {
  it('writes at once when turned on', () => {
    expect(privateChange(false, true)).toBe('write')
  })

  it('asks first when turned off: it accepts every request waiting', () => {
    expect(privateChange(true, false)).toBe('confirm')
  })

  it('does nothing when it is already as asked', () => {
    expect(privateChange(true, true)).toBe('none')
    expect(privateChange(false, false)).toBe('none')
  })
})
