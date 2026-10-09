import { describe, expect, it } from 'vitest'
import type { DeviceStorage } from '@/data/localData'
import {
  followToOpen,
  followTokenIn,
  isFollowToken,
  keepFollow,
  peekFollow,
  PENDING_FOLLOW_KEY,
  PENDING_FOLLOW_TTL_MS,
  takeFollow,
} from '@/utils/pendingFollow'

/** A follow link kept through the sign-in (social v1, U2): the twin of the kept share. */
function memoryStorage(): DeviceStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  } as DeviceStorage
}

const TOKEN = `${'abc-_'.repeat(5)}XY`
const OTHER = `${'Q7'.repeat(10)}-_`
const NOW = 1_700_000_000_000

describe('follow tokens', () => {
  it('are 22 base64url characters', () => {
    expect(TOKEN).toHaveLength(22)
    expect(isFollowToken(TOKEN)).toBe(true)
    for (const bad of ['', 'short', `${TOKEN}x`, TOKEN.slice(1), `${TOKEN.slice(1)}+`, `${TOKEN.slice(1)}=`, `${TOKEN.slice(1)} `, null, undefined, 42]) {
      expect(isFollowToken(bad)).toBe(false)
    }
  })

  it('are read from /f/<token>, with or without the slash Pages adds', () => {
    expect(followTokenIn(`/f/${TOKEN}`)).toBe(TOKEN)
    expect(followTokenIn(`/f/${TOKEN}/`)).toBe(TOKEN)
    expect(followTokenIn('/f/short')).toBeNull()
    expect(followTokenIn(`/f/${TOKEN}/more`)).toBeNull()
    expect(followTokenIn(`/friends/${TOKEN}`)).toBeNull()
    expect(followTokenIn('/')).toBeNull()
  })
})

describe('the kept follow link', () => {
  it('is kept under the prefix signing out clears, and read back', () => {
    const storage = memoryStorage()
    expect(PENDING_FOLLOW_KEY.startsWith('libellus.')).toBe(true)
    expect(keepFollow(storage, TOKEN, NOW)).toBe(true)
    expect(peekFollow(storage, NOW + 1000)).toBe(TOKEN)
    // Peeking keeps it.
    expect(peekFollow(storage, NOW + 2000)).toBe(TOKEN)
  })

  it('is forgotten when taken', () => {
    const storage = memoryStorage()
    keepFollow(storage, TOKEN, NOW)
    expect(takeFollow(storage, NOW)).toBe(TOKEN)
    expect(storage.getItem(PENDING_FOLLOW_KEY)).toBeNull()
    expect(takeFollow(storage, NOW)).toBeNull()
  })

  it('is replaced by a newer link', () => {
    const storage = memoryStorage()
    keepFollow(storage, TOKEN, NOW)
    keepFollow(storage, OTHER, NOW + 10)
    expect(peekFollow(storage, NOW + 20)).toBe(OTHER)
  })

  it('lives an hour, then is gone and removed', () => {
    const storage = memoryStorage()
    keepFollow(storage, TOKEN, NOW)
    expect(peekFollow(storage, NOW + PENDING_FOLLOW_TTL_MS)).toBe(TOKEN)
    expect(peekFollow(storage, NOW + PENDING_FOLLOW_TTL_MS + 1)).toBeNull()
    expect(storage.getItem(PENDING_FOLLOW_KEY)).toBeNull()
  })

  it('never keeps a malformed token', () => {
    const storage = memoryStorage()
    expect(keepFollow(storage, 'nope', NOW)).toBe(false)
    expect(keepFollow(storage, `${TOKEN}!`, NOW)).toBe(false)
    expect(storage.getItem(PENDING_FOLLOW_KEY)).toBeNull()
  })

  it('reads nothing from what is unreadable or malformed, and removes it', () => {
    for (const raw of ['{not json', '{}', JSON.stringify({ token: 'bad', at: NOW }), JSON.stringify({ token: TOKEN }), JSON.stringify({ token: TOKEN, at: 'now' })]) {
      const storage = memoryStorage()
      storage.setItem(PENDING_FOLLOW_KEY, raw)
      expect(peekFollow(storage, NOW)).toBeNull()
      expect(storage.getItem(PENDING_FOLLOW_KEY)).toBeNull()
    }
  })
})

describe('followToOpen: where a signed-in member is sent', () => {
  it('to the kept link, from anywhere else', () => {
    for (const path of ['/', '/sign-in', '/verify', '/library', '/profile']) expect(followToOpen(path, TOKEN, false)).toBe(`/f/${TOKEN}`)
  })

  it('nowhere when nothing is kept (expired and malformed ones are read as null)', () => {
    expect(followToOpen('/', null, false)).toBeNull()
  })

  it('nowhere when she is already on a follow link', () => {
    expect(followToOpen(`/f/${TOKEN}`, OTHER, false)).toBeNull()
    expect(followToOpen(`/f/${TOKEN}/`, OTHER, false)).toBeNull()
  })

  it('after a share: not while one waits, nor on the share page taking it in', () => {
    expect(followToOpen('/', TOKEN, true)).toBeNull()
    expect(followToOpen('/share', TOKEN, false)).toBeNull()
    expect(followToOpen('/share', TOKEN, true)).toBeNull()
    // The share has gone: the next navigation picks the follow up.
    expect(followToOpen('/book/abc', TOKEN, false)).toBe(`/f/${TOKEN}`)
  })
})
