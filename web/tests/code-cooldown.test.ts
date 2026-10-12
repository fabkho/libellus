import { describe, expect, it } from 'vitest'
import { mapAuthError } from '@/data/auth'
import type { DeviceStorage } from '@/data/localData'
import { CODE_COOLDOWN_MS, CODE_SENT_KEY, keepCodeSent, recentCode, secondsLeft, stepFor, whoIs } from '@/utils/codeCooldown'

/**
 * The server mails one code per address per 20 s (supabase/config.toml `max_frequency`). The member is
 * told what that means (a code is on its way: use it) and the device does not ask twice inside the window.
 */
function storage(): DeviceStorage & { items: Map<string, string> } {
  const items = new Map<string, string>()
  return {
    items,
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

describe('what GoTrue says about too many codes', () => {
  it('a second code for an address inside the window is code_just_sent', () => {
    expect(mapAuthError({ code: 'over_email_send_rate_limit', message: 'For security purposes, you can only request this after 20 seconds.' })).toBe('code_just_sent')
    // Without a code, GoTrue's wording alone says it too.
    expect(mapAuthError({ message: 'For security purposes, you can only request this after 20 seconds.' })).toBe('code_just_sent')
  })

  it('the project-wide hourly cap on mails is not the member to wait out: rate_limited', () => {
    expect(mapAuthError({ code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' })).toBe('rate_limited')
  })

  it('too many requests stay the generic rate_limited', () => {
    expect(mapAuthError({ code: 'over_request_rate_limit', message: 'Request rate limit reached' })).toBe('rate_limited')
    expect(mapAuthError({ message: 'Too many requests' })).toBe('rate_limited')
  })
})

describe('the window of the last code', () => {
  const at = 1_000_000

  it('counts whole seconds down, to zero', () => {
    expect(secondsLeft(at, at)).toBe(20)
    expect(secondsLeft(at, at + 1)).toBe(20)
    expect(secondsLeft(at, at + 1_000)).toBe(19)
    expect(secondsLeft(at, at + CODE_COOLDOWN_MS - 1)).toBe(1)
    expect(secondsLeft(at, at + CODE_COOLDOWN_MS)).toBe(0)
    expect(secondsLeft(at, at + 5 * CODE_COOLDOWN_MS)).toBe(0)
  })

  it('tells the same address by its fingerprint, case and spaces aside', () => {
    expect(whoIs(' Ada@Example.com ')).toBe(whoIs('ada@example.com'))
    expect(whoIs('ada@example.com')).not.toBe(whoIs('ben@example.com'))
    expect(whoIs('ada@example.com')).not.toContain('ada')
  })

  it('goes straight to the code step when the code mailed a moment ago is unused', () => {
    const recent = { who: whoIs('ada@example.com'), at, used: false }
    expect(stepFor(recent, 'Ada@example.com', at + 5_000)).toBe('enter')
  })

  it('waits when that code was used (signing out and in again), then sends', () => {
    const recent = { who: whoIs('ada@example.com'), at, used: true }
    expect(stepFor(recent, 'ada@example.com', at + 5_000)).toBe('wait')
    expect(stepFor(recent, 'ada@example.com', at + CODE_COOLDOWN_MS)).toBe('send')
  })

  it('sends for another address, and when nothing went out', () => {
    expect(stepFor({ who: whoIs('ada@example.com'), at, used: false }, 'ben@example.com', at + 1_000)).toBe('send')
    expect(stepFor(null, 'ada@example.com', at)).toBe('send')
  })
})

describe('the record on the device', () => {
  const at = 1_000_000

  it('is read while the window is open', () => {
    const device = storage()
    keepCodeSent(device, { who: whoIs('ada@example.com'), at, used: false })
    expect(recentCode(device, at + 19_000)).toEqual({ who: whoIs('ada@example.com'), at, used: false })
  })

  it('is dropped once the window has closed', () => {
    const device = storage()
    keepCodeSent(device, { who: whoIs('ada@example.com'), at, used: true })
    expect(recentCode(device, at + CODE_COOLDOWN_MS)).toBeNull()
    expect(device.items.size).toBe(0)
  })

  it('is dropped when unreadable or from the future (a clock set back)', () => {
    const device = storage()
    device.setItem(CODE_SENT_KEY, 'not json')
    expect(recentCode(device, at)).toBeNull()
    expect(device.items.size).toBe(0)
    keepCodeSent(device, { who: 'x', at: at + 60_000, used: false })
    expect(recentCode(device, at)).toBeNull()
  })

  it('holds a fingerprint, not the address', () => {
    const device = storage()
    keepCodeSent(device, { who: whoIs('ada.private@example.com'), at, used: false })
    expect(device.getItem(CODE_SENT_KEY)).not.toContain('ada')
  })
})
