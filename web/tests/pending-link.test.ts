import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { DeviceStorage } from '@/data/localData'
import {
  forgetPending,
  isPendingToken,
  keepPending,
  PENDING_LINK_KEY,
  PENDING_LINK_KEYS,
  PENDING_LINK_TTL_MS,
  type PendingKind,
  pendingLinkPath,
  pendingPath,
  pendingTokenIn,
  type PendingValue,
  peekPending,
  takePending,
} from '@/utils/pendingLink'

/**
 * Something she opened while signed out, kept through the sign-in: a share (issue #91), a follow link (social v1) and
 * a buddy read link (W3) are one concept, so this is one boundary suite over the three kinds. The cases the twin
 * suites (tests/pending-follow.test.ts, tests/pending-buddy-read.test.ts, and the share cases in
 * tests/shared.test.ts) repeated — malformed token dropped, the hour's TTL, take-forgets — are here once; the share
 * kind, which had no suite of its own, is covered beside the links.
 */
function memoryStorage(): DeviceStorage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  }
}

const TOKEN = `${'abc-_'.repeat(4)}XY`
const OTHER = `${'Q7'.repeat(10)}-_`
const NOW = 1_700_000_000_000
const SHARE: PendingValue['share'] = { title: 'Piranesi', url: 'https://www.amazon.com/dp/163557563X' }
const OTHER_SHARE: PendingValue['share'] = { text: 'Klara and the Sun' }

/** Every case that is the same for all three kinds is written once, here, and run for each of them. */
function eachKind(check: <K extends PendingKind>(kind: K, value: PendingValue[K], other: PendingValue[K]) => void) {
  check('share', SHARE, OTHER_SHARE)
  check('follow', TOKEN, OTHER)
  check('buddyRead', TOKEN, OTHER)
}

describe('one key scheme, one TTL, under the prefix signing out clears', () => {
  it('names a key per kind, all of them under `libellus.`', () => {
    expect(PENDING_LINK_KEY).toEqual({ share: 'libellus.pendingShare', follow: 'libellus.pendingFollow', buddyRead: 'libellus.pendingBuddyRead' })
    expect(PENDING_LINK_KEYS).toEqual([PENDING_LINK_KEY.share, PENDING_LINK_KEY.follow, PENDING_LINK_KEY.buddyRead])
    for (const key of PENDING_LINK_KEYS) expect(key.startsWith('libellus.')).toBe(true)
  })

  it('keeps every kind for one hour: the three modules each declared 60 * 60 * 1000, so the collapse changes no lifetime', () => {
    expect(PENDING_LINK_TTL_MS).toBe(60 * 60 * 1000)
  })
})

describe('the one token shape the two links share', () => {
  it('is 22 base64url characters', () => {
    expect(TOKEN).toHaveLength(22)
    expect(isPendingToken(TOKEN)).toBe(true)
    for (const bad of ['', 'short', `${TOKEN}x`, TOKEN.slice(1), `${TOKEN.slice(1)}+`, `${TOKEN.slice(1)}=`, `${TOKEN.slice(1)} `, null, undefined, 42]) {
      expect(isPendingToken(bad), String(bad)).toBe(false)
    }
  })

  it('is read from its own link and from nothing else, with or without the slash Pages adds', () => {
    expect(pendingTokenIn('follow', `/f/${TOKEN}`)).toBe(TOKEN)
    expect(pendingTokenIn('follow', `/f/${TOKEN}/`)).toBe(TOKEN)
    expect(pendingTokenIn('buddyRead', `/t/${TOKEN}`)).toBe(TOKEN)
    expect(pendingTokenIn('buddyRead', `/t/${TOKEN}/`)).toBe(TOKEN)
    // One kind never reads the other's link.
    expect(pendingTokenIn('follow', `/t/${TOKEN}`)).toBeNull()
    expect(pendingTokenIn('buddyRead', `/f/${TOKEN}`)).toBeNull()
    expect(pendingTokenIn('follow', '/f/short')).toBeNull()
    expect(pendingTokenIn('follow', `/f/${TOKEN}/more`)).toBeNull()
    expect(pendingTokenIn('follow', `/friends/${TOKEN}`)).toBeNull()
    expect(pendingTokenIn('buddyRead', '/together/abc')).toBeNull()
    expect(pendingTokenIn('follow', '/')).toBeNull()
  })

  it('recognises a link path whatever its token, and no other path', () => {
    expect(pendingLinkPath('follow', `/f/${TOKEN}`)).toBe(true)
    expect(pendingLinkPath('follow', '/f/')).toBe(false)
    expect(pendingLinkPath('follow', `/t/${TOKEN}`)).toBe(false)
    expect(pendingLinkPath('buddyRead', `/t/${OTHER}/`)).toBe(true)
    expect(pendingLinkPath('buddyRead', `/f/${TOKEN}`)).toBe(false)
    expect(pendingLinkPath('buddyRead', '/t/')).toBe(false)
  })

  it('says where each kind is opened', () => {
    expect(pendingPath('share', SHARE)).toBe('/share')
    expect(pendingPath('follow', TOKEN)).toBe(`/f/${TOKEN}`)
    expect(pendingPath('buddyRead', TOKEN)).toBe(`/t/${TOKEN}`)
  })
})

describe('what she opened is kept, peeked and taken', () => {
  it('is kept, read back without being removed, and taken once', () => {
    eachKind((kind, value) => {
      const storage = memoryStorage()
      expect(peekPending(storage, kind, NOW)).toBeNull()
      expect(keepPending(storage, kind, value, NOW)).toBe(true)
      expect(peekPending(storage, kind, NOW + 1000)).toEqual(value)
      expect(peekPending(storage, kind, NOW + 2000)).toEqual(value)
      expect(takePending(storage, kind, NOW + 3000)).toEqual(value)
      expect(takePending(storage, kind, NOW + 4000)).toBeNull()
      expect(storage.getItem(PENDING_LINK_KEY[kind])).toBeNull()
    })
  })

  it('keeps the newer of two of the same kind, and one kind never stands in for another', () => {
    eachKind((kind, value, other) => {
      const storage = memoryStorage()
      keepPending(storage, kind, value, NOW)
      keepPending(storage, kind, other, NOW + 10)
      expect(peekPending(storage, kind, NOW + 20)).toEqual(other)
    })
    const storage = memoryStorage()
    keepPending(storage, 'follow', TOKEN, NOW)
    expect(peekPending(storage, 'buddyRead', NOW)).toBeNull()
    expect(peekPending(storage, 'share', NOW)).toBeNull()
    keepPending(storage, 'buddyRead', OTHER, NOW)
    expect(peekPending(storage, 'follow', NOW)).toBe(TOKEN)
    expect(peekPending(storage, 'buddyRead', NOW)).toBe(OTHER)
  })

  it('is forgotten on demand: the page she is on is the one that counts', () => {
    eachKind((kind, value) => {
      const storage = memoryStorage()
      keepPending(storage, kind, value, NOW)
      forgetPending(storage, kind)
      expect(storage.getItem(PENDING_LINK_KEY[kind])).toBeNull()
      // Forgetting one leaves the others alone.
      keepPending(storage, 'share', SHARE, NOW)
      keepPending(storage, 'follow', TOKEN, NOW)
      expect(peekPending(storage, 'share', NOW)).toEqual(SHARE)
      expect(peekPending(storage, 'follow', NOW)).toBe(TOKEN)
    })
  })

  it('never keeps a malformed follow or buddy read token; a share has no token to be wrong', () => {
    for (const kind of ['follow', 'buddyRead'] as const) {
      const storage = memoryStorage()
      expect(keepPending(storage, kind, 'nope', NOW)).toBe(false)
      expect(keepPending(storage, kind, `${TOKEN}!`, NOW)).toBe(false)
      expect(storage.getItem(PENDING_LINK_KEY[kind])).toBeNull()
    }
    const storage = memoryStorage()
    expect(keepPending(storage, 'share', { text: 'Piranesi' }, NOW)).toBe(true)
  })
})

describe('an hour, then nothing', () => {
  it('reads the kept value at the boundary and drops the one past it, removing it', () => {
    eachKind((kind, value) => {
      const storage = memoryStorage()
      keepPending(storage, kind, value, NOW)
      expect(peekPending(storage, kind, NOW + PENDING_LINK_TTL_MS)).toEqual(value)
      expect(peekPending(storage, kind, NOW + PENDING_LINK_TTL_MS + 1)).toBeNull()
      expect(storage.getItem(PENDING_LINK_KEY[kind])).toBeNull()
    })
  })

  it('reads nothing from what is unreadable or malformed, and removes it', () => {
    eachKind((kind) => {
      const raws = ['{not json', '{}', JSON.stringify({ value: 'bad', at: NOW }), JSON.stringify({ value: TOKEN }), JSON.stringify({ value: TOKEN, at: 'now' }), JSON.stringify({ at: NOW })]
      for (const raw of raws) {
        const storage = memoryStorage()
        storage.setItem(PENDING_LINK_KEY[kind], raw)
        expect(peekPending(storage, kind, NOW), `${kind}: ${raw}`).toBeNull()
        expect(storage.getItem(PENDING_LINK_KEY[kind])).toBeNull()
      }
    })
  })

  it('reads what the build this one replaces left: a share payload under `payload`, a link token under `token`', () => {
    const storage = memoryStorage()
    storage.setItem(PENDING_LINK_KEY.share, JSON.stringify({ payload: SHARE, at: NOW }))
    storage.setItem(PENDING_LINK_KEY.follow, JSON.stringify({ token: TOKEN, at: NOW }))
    storage.setItem(PENDING_LINK_KEY.buddyRead, JSON.stringify({ token: OTHER, at: NOW }))
    expect(peekPending(storage, 'share', NOW)).toEqual(SHARE)
    expect(peekPending(storage, 'follow', NOW)).toBe(TOKEN)
    expect(peekPending(storage, 'buddyRead', NOW)).toBe(OTHER)
    // Kept across the update, but not past its hour.
    expect(peekPending(storage, 'share', NOW + PENDING_LINK_TTL_MS)).toEqual(SHARE)
    expect(peekPending(storage, 'share', NOW + PENDING_LINK_TTL_MS + 1)).toBeNull()
  })
})

describe('the share kind, which had no suite of its own', () => {
  it('keeps any of the four things a share carries, and hands the payload back as it was written', () => {
    for (const payload of [{ title: 'Piranesi' }, { text: 'The House' }, { url: 'https://example.com/b' }, { ebooks: 'abc123abc123' }, SHARE]) {
      const storage = memoryStorage()
      expect(keepPending(storage, 'share', payload, NOW)).toBe(true)
      expect(peekPending(storage, 'share', NOW + 1)).toEqual(payload)
      expect(typeof peekPending(storage, 'share', NOW + 1)).toBe('object')
      expect(storage.getItem(PENDING_LINK_KEY.share)).toBe(JSON.stringify({ value: payload, at: NOW }))
      expect(takePending(storage, 'share', NOW + 2)).toEqual(payload)
    }
  })

  it('is what `signedOutDestination` writes for `/share`, and what the page takes in', () => {
    const storage = memoryStorage()
    keepPending(storage, 'share', { title: 'A Book', url: 'https://example.com/b' }, NOW)
    expect(takePending(storage, 'share', NOW + 1)).toEqual({ title: 'A Book', url: 'https://example.com/b' })
    expect(takePending(storage, 'share', NOW + 2)).toBeNull()
  })
})

/**
 * The session store is what clears the device, so it has to name every kept link: one missing there is a link a
 * member loses by signing out, or one another member's sign-in deletes. (What the clearing does with them is
 * tests/device-data.test.ts's.)
 */
describe('the session store keeps what she opened', () => {
  const session = readFileSync(new URL('../app/stores/session.ts', import.meta.url), 'utf8')

  it('names every kind in the keep list of a session that ended, and the buddy read link when another member signs in over it', () => {
    expect(session).toMatch(/keep: accountDeleted \? \[\] : \[PENDING_SIGN_IN_KEY, \.\.\.PENDING_LINK_KEYS\]/)
    expect(session).toMatch(/await forgetDevice\(\{ keepForNext: \[PENDING_LINK_KEY\.buddyRead\] \}\)/)
  })
})
