import { describe, expect, it } from 'vitest'
import type { SessionStorage } from '@/data/createSupabaseClient'
import { DEVICE_LIBRARY_KEY } from '@/data/deviceLibrary'
import { type DeviceStorage } from '@/data/localData'
import { peekFollow } from '@/utils/pendingFollow'
import { peekShare } from '@/utils/pendingShare'
import { knownSignedOut, PENDING_SIGN_IN_KEY, signedOutDestination, withoutSlash } from '@/utils/signedOutRoute'
import { signUpMember } from './support/member'

/**
 * The router's first navigation sends a visitor the device knows to be signed out to the sign-in screen
 * before the page behind her address is fetched (router.options.ts, docs/perf/bundle.md F1), and the auth
 * middleware sends every other signed-out visitor the same way: both ask `signedOutDestination`.
 */
function device(): DeviceStorage & SessionStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
  }
}

const at = (path: string, query: Record<string, unknown> = {}) => ({ path, query })
const FOLLOW = 'A'.repeat(22)

describe('knownSignedOut: only a device with nothing of a member', () => {
  it('is true for a first visit and for a device that holds only unrelated keys', () => {
    const storage = device()
    expect(knownSignedOut(storage)).toBe(true)
    storage.setItem('libellus.theme', 'dark')
    storage.setItem('sb-other-code-verifier', 'x')
    expect(knownSignedOut(storage)).toBe(true)
  })

  it('is false with a stored session, whatever the project is called', () => {
    for (const key of ['sb-127-auth-token', 'sb-perf-auth-token', 'sb-abcdefghijklmnop-auth-token']) {
      const storage = device()
      storage.setItem(key, '{}')
      expect(knownSignedOut(storage)).toBe(false)
    }
  })

  it('is false with the offline Library (the offline start opens it without a session) or a code in the air', () => {
    const library = device()
    library.setItem(DEVICE_LIBRARY_KEY, '{}')
    expect(knownSignedOut(library)).toBe(false)
    const pending = device()
    pending.setItem(PENDING_SIGN_IN_KEY, '{}')
    expect(knownSignedOut(pending)).toBe(false)
  })

  it('is false for the very key supabase-js writes for a signed-in member', async () => {
    const storage = device()
    expect(knownSignedOut(storage)).toBe(true)
    await signUpMember(storage)
    expect(knownSignedOut(storage)).toBe(false)
  })
})

describe('signedOutDestination', () => {
  const storage = () => device()

  it('sends every screen behind the sign-in to it, with or without the slash Pages adds', () => {
    for (const path of ['/', '/library', '/book/abc', '/profile/2026', '/friends/', '/collections']) {
      expect(signedOutDestination(at(path), { pending: false, storage: storage() })).toBe('/sign-in')
    }
  })

  it('lets the access screens and the public reading pages be', () => {
    for (const path of ['/sign-in', '/sign-in/', '/sign-up', '/r/some-token', '/r/some-token/book/1']) {
      expect(signedOutDestination(at(path), { pending: false, storage: storage() })).toBeUndefined()
    }
    expect(signedOutDestination(at('/verify'), { pending: true, storage: storage() })).toBeUndefined()
  })

  it('sends a code in the air back to the verify screen, and verify without one to sign-in', () => {
    expect(signedOutDestination(at('/'), { pending: true, storage: storage() })).toBe('/verify')
    expect(signedOutDestination(at('/verify'), { pending: false, storage: storage() })).toBe('/sign-in')
  })

  it('keeps a follow link and a share through the sign-in', () => {
    const kept = storage()
    expect(signedOutDestination(at(`/f/${FOLLOW}/`), { pending: false, storage: kept })).toBe('/sign-in')
    expect(peekFollow(kept)).toBe(FOLLOW)
    expect(signedOutDestination(at('/f/not-a-token'), { pending: false, storage: kept })).toBe('/sign-in')

    const shared = storage()
    expect(signedOutDestination(at('/share', { title: ['A Book'], url: 'https://example.com/b' }), { pending: false, storage: shared })).toBe('/sign-in')
    expect(peekShare(shared)).toMatchObject({ title: 'A Book', url: 'https://example.com/b' })
    const nothing = storage()
    signedOutDestination(at('/share'), { pending: false, storage: nothing })
    expect(peekShare(nothing)).toBeNull()
  })

  it('keeps nothing without a storage', () => {
    expect(signedOutDestination(at('/share', { title: 'x' }), { pending: false, storage: null })).toBe('/sign-in')
  })

  it('compares paths without the trailing slash', () => {
    expect(withoutSlash('/sign-up/')).toBe('/sign-up')
    expect(withoutSlash('/')).toBe('/')
  })
})
