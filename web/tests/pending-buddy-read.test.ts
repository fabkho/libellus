import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DeviceStorage } from '@/data/localData'
import {
  buddyReadToOpen,
  buddyReadTokenIn,
  isBuddyReadToken,
  keepBuddyRead,
  peekBuddyRead,
  PENDING_BUDDY_READ_KEY,
  PENDING_BUDDY_READ_TTL_MS,
  takeBuddyRead,
} from '@/utils/pendingBuddyRead'
import { signedOutDestination } from '@/utils/signedOutRoute'

/** A buddy read link kept through the sign-in (W3): the twin of the kept follow link (tests/pending-follow.test.ts). */
function memoryStorage(): DeviceStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  } as DeviceStorage
}

const TOKEN = `${'abc-_'.repeat(4)}XY`
const OTHER = `${'Q7'.repeat(10)}-_`
const NOW = 1_700_000_000_000

describe('buddy read tokens', () => {
  it('are 22 base64url characters', () => {
    expect(TOKEN).toHaveLength(22)
    expect(isBuddyReadToken(TOKEN)).toBe(true)
    for (const bad of ['', 'short', `${TOKEN}x`, TOKEN.slice(1), `${TOKEN.slice(1)}+`, `${TOKEN.slice(1)}=`, `${TOKEN.slice(1)} `, null, undefined, 42]) {
      expect(isBuddyReadToken(bad)).toBe(false)
    }
  })

  it('are read from /t/<token>, with or without the slash Pages adds, and from nothing else', () => {
    expect(buddyReadTokenIn(`/t/${TOKEN}`)).toBe(TOKEN)
    expect(buddyReadTokenIn(`/t/${TOKEN}/`)).toBe(TOKEN)
    expect(buddyReadTokenIn('/t/short')).toBeNull()
    expect(buddyReadTokenIn(`/f/${TOKEN}`)).toBeNull()
    expect(buddyReadTokenIn(`/together/${TOKEN}`)).toBeNull()
    expect(buddyReadTokenIn(`/t/${TOKEN}/extra`)).toBeNull()
    expect(buddyReadTokenIn('/')).toBeNull()
  })
})

describe('a kept buddy read token', () => {
  it('is kept, peeked without being removed, and taken once', () => {
    const storage = memoryStorage()
    expect(peekBuddyRead(storage, NOW)).toBeNull()
    expect(keepBuddyRead(storage, TOKEN, NOW)).toBe(true)
    expect(peekBuddyRead(storage, NOW + 1000)).toBe(TOKEN)
    expect(peekBuddyRead(storage, NOW + 2000)).toBe(TOKEN)
    expect(takeBuddyRead(storage, NOW + 3000)).toBe(TOKEN)
    expect(takeBuddyRead(storage, NOW + 4000)).toBeNull()
  })

  it('keeps the newer of two links', () => {
    const storage = memoryStorage()
    keepBuddyRead(storage, TOKEN, NOW)
    keepBuddyRead(storage, OTHER, NOW + 10)
    expect(peekBuddyRead(storage, NOW + 20)).toBe(OTHER)
  })

  it('does not keep a malformed token', () => {
    const storage = memoryStorage()
    expect(keepBuddyRead(storage, 'nope', NOW)).toBe(false)
    expect(storage.getItem(PENDING_BUDDY_READ_KEY)).toBeNull()
  })

  it('expires after an hour, and an expired or unreadable value is removed', () => {
    const storage = memoryStorage()
    keepBuddyRead(storage, TOKEN, NOW)
    expect(peekBuddyRead(storage, NOW + PENDING_BUDDY_READ_TTL_MS)).toBe(TOKEN)
    expect(peekBuddyRead(storage, NOW + PENDING_BUDDY_READ_TTL_MS + 1)).toBeNull()
    expect(storage.getItem(PENDING_BUDDY_READ_KEY)).toBeNull()

    storage.setItem(PENDING_BUDDY_READ_KEY, '{not json')
    expect(peekBuddyRead(storage, NOW)).toBeNull()
    expect(storage.getItem(PENDING_BUDDY_READ_KEY)).toBeNull()

    storage.setItem(PENDING_BUDDY_READ_KEY, JSON.stringify({ token: 'bad', at: NOW }))
    expect(peekBuddyRead(storage, NOW)).toBeNull()
    expect(storage.getItem(PENDING_BUDDY_READ_KEY)).toBeNull()
  })

  it('lives under the prefix signing out clears', () => {
    expect(PENDING_BUDDY_READ_KEY.startsWith('libellus.')).toBe(true)
  })
})

describe('where a signed-in member is sent for a kept link', () => {
  it('opens /t/<token>, from anywhere else', () => {
    expect(buddyReadToOpen('/', TOKEN, false)).toBe(`/t/${TOKEN}`)
    expect(buddyReadToOpen('/sign-in', TOKEN, false)).toBe(`/t/${TOKEN}`)
  })

  it('does nothing without a kept link, on a buddy read link already, on /share, or while a share or follow link is waiting', () => {
    expect(buddyReadToOpen('/', null, false)).toBeNull()
    expect(buddyReadToOpen(`/t/${OTHER}`, TOKEN, false)).toBeNull()
    expect(buddyReadToOpen(`/t/${OTHER}/`, TOKEN, false)).toBeNull()
    expect(buddyReadToOpen('/share', TOKEN, false)).toBeNull()
    expect(buddyReadToOpen('/', TOKEN, true)).toBeNull()
  })
})

describe('a signed-out visitor on a buddy read link', () => {
  const at = (path: string) => ({ path, query: {} })

  it('is sent to sign-in and the link is kept', () => {
    const storage = memoryStorage()
    expect(signedOutDestination(at(`/t/${TOKEN}/`), { pending: false, storage })).toBe('/sign-in')
    expect(peekBuddyRead(storage)).toBe(TOKEN)
  })

  it('keeps nothing for a malformed token, nor without a storage', () => {
    const bad = memoryStorage()
    expect(signedOutDestination(at('/t/not-a-token'), { pending: false, storage: bad })).toBe('/sign-in')
    expect(peekBuddyRead(bad)).toBeNull()

    expect(signedOutDestination(at(`/t/${TOKEN}`), { pending: false, storage: null })).toBe('/sign-in')
  })

  it('is not a public path: the link needs the sign-in', () => {
    expect(signedOutDestination(at(`/t/${TOKEN}`), { pending: false, storage: memoryStorage() })).toBe('/sign-in')
    expect(signedOutDestination(at(`/t/${TOKEN}`), { pending: true, storage: memoryStorage() })).toBe('/verify')
  })
})

describe('the session store keeps the link a visitor opened (device data)', () => {
  const session = readFileSync(new URL('../app/stores/session.ts', import.meta.url), 'utf8')

  it('names the waiting link in the keep list of a session that ended, and keeps it when another member’s data is cleared away from a new sign-in', () => {
    expect(session).toMatch(/keep: accountDeleted \? \[\] : \[PENDING_SIGN_IN_KEY, PENDING_SHARE_KEY, PENDING_FOLLOW_KEY, PENDING_BUDDY_READ_KEY\]/)
    expect(session).toMatch(/await forgetDevice\(\{ keepForNext: \[PENDING_BUDDY_READ_KEY\] \}\)/)
  })
})
