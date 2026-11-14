import { describe, expect, it } from 'vitest'
import type { SessionStorage } from '@/data/createSupabaseClient'
import { DEVICE_LIBRARY_KEY } from '@/data/deviceLibrary'
import { IMPRINT_ENABLED } from '@/legal/config'
import { type DeviceStorage } from '@/data/localData'
import { keepPending, peekPending } from '@/utils/pendingLink'
import { knownSignedOut, PENDING_SIGN_IN_KEY, pendingLinkToOpen, signedOutDestination, withoutSlash } from '@/utils/signedOutRoute'
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
const JOINING = 'B'.repeat(22)
const SHARE = { title: 'A Book' }
const nothing = { share: null, follow: null, buddyRead: null }

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

  it('lets the access screens, the public reading pages and the privacy notice be', () => {
    for (const path of ['/sign-in', '/sign-in/', '/sign-up', '/r/some-token', '/r/some-token/book/1', '/privacy', '/privacy/']) {
      expect(signedOutDestination(at(path), { pending: false, storage: storage() })).toBeUndefined()
    }
    expect(signedOutDestination(at('/verify'), { pending: true, storage: storage() })).toBeUndefined()
    // Not even a code in the air sends her away from the privacy notice she was reading before she signed up.
    expect(signedOutDestination(at('/privacy'), { pending: true, storage: storage() })).toBeUndefined()
  })

  it('treats the imprint as any address behind the sign-in while it is postponed', () => {
    const imprint = signedOutDestination(at('/imprint'), { pending: false, storage: storage() })
    expect(imprint).toBe(IMPRINT_ENABLED ? undefined : '/sign-in')
  })

  it('sends a code in the air back to the verify screen, and verify without one to sign-in', () => {
    expect(signedOutDestination(at('/'), { pending: true, storage: storage() })).toBe('/verify')
    expect(signedOutDestination(at('/verify'), { pending: false, storage: storage() })).toBe('/sign-in')
  })

  it('keeps a follow link and a share through the sign-in', () => {
    const kept = storage()
    expect(signedOutDestination(at(`/f/${FOLLOW}/`), { pending: false, storage: kept })).toBe('/sign-in')
    expect(peekPending(kept, 'follow')).toBe(FOLLOW)
    expect(signedOutDestination(at('/f/not-a-token'), { pending: false, storage: kept })).toBe('/sign-in')

    const shared = storage()
    expect(signedOutDestination(at('/share', { title: ['A Book'], url: 'https://example.com/b' }), { pending: false, storage: shared })).toBe('/sign-in')
    expect(peekPending(shared, 'share')).toMatchObject({ title: 'A Book', url: 'https://example.com/b' })
    const nothing = storage()
    signedOutDestination(at('/share'), { pending: false, storage: nothing })
    expect(peekPending(nothing, 'share')).toBeNull()
  })

  it('keeps a buddy read link the same way, and only a token it could resolve', () => {
    const kept = storage()
    expect(signedOutDestination(at(`/t/${JOINING}/`), { pending: false, storage: kept })).toBe('/sign-in')
    expect(peekPending(kept, 'buddyRead')).toBe(JOINING)
    expect(signedOutDestination(at('/t/not-a-token'), { pending: false, storage: kept })).toBe('/sign-in')
    expect(peekPending(kept, 'follow')).toBeNull()
  })

  it('keeps nothing without a storage', () => {
    expect(signedOutDestination(at('/share', { title: 'x' }), { pending: false, storage: null })).toBe('/sign-in')
  })

  it('compares paths without the trailing slash', () => {
    expect(withoutSlash('/sign-up/')).toBe('/sign-up')
    expect(withoutSlash('/')).toBe('/')
  })
})

/**
 * One pending link opens at a time, and which one is not a detail: a wrong order sends a member to the wrong screen
 * after her sign-in. The order lives in `pendingLinkToOpen`, beside the rule for where a signed-out visitor goes.
 */
describe('pendingLinkToOpen: the priority a member lands by', () => {
  it('opens the share first, then the follow link, then the buddy read link', () => {
    expect(pendingLinkToOpen('/', { share: SHARE, follow: FOLLOW, buddyRead: JOINING })).toBe('/share')
    expect(pendingLinkToOpen('/', { share: null, follow: FOLLOW, buddyRead: JOINING })).toBe(`/f/${FOLLOW}`)
    expect(pendingLinkToOpen('/', { share: null, follow: null, buddyRead: JOINING })).toBe(`/t/${JOINING}`)
    // Nothing waiting, nothing opened.
    expect(pendingLinkToOpen('/', nothing)).toBeNull()
  })

  it('opens from anywhere else, whatever the address', () => {
    for (const path of ['/', '/sign-in', '/verify', '/library', '/profile', '/book/abc']) {
      expect(pendingLinkToOpen(path, { ...nothing, follow: FOLLOW }), path).toBe(`/f/${FOLLOW}`)
      expect(pendingLinkToOpen(path, { ...nothing, buddyRead: JOINING }), path).toBe(`/t/${JOINING}`)
      expect(pendingLinkToOpen(path, { ...nothing, share: SHARE }), path).toBe('/share')
    }
  })

  it('opens nothing on /share: the page in hand is taking a share in', () => {
    expect(pendingLinkToOpen('/share', { share: SHARE, follow: FOLLOW, buddyRead: JOINING })).toBeNull()
    expect(pendingLinkToOpen('/share', { ...nothing, follow: FOLLOW })).toBeNull()
    expect(pendingLinkToOpen('/share', { ...nothing, buddyRead: JOINING })).toBeNull()
  })

  it('does not reopen the link she is already on (that page spends it), and a share waiting still goes first', () => {
    expect(pendingLinkToOpen(`/f/${FOLLOW}`, { ...nothing, follow: FOLLOW })).toBeNull()
    expect(pendingLinkToOpen(`/f/${FOLLOW}/`, { ...nothing, follow: FOLLOW })).toBeNull()
    expect(pendingLinkToOpen(`/t/${JOINING}`, { ...nothing, buddyRead: JOINING })).toBeNull()
    expect(pendingLinkToOpen(`/t/${JOINING}/`, { ...nothing, buddyRead: JOINING })).toBeNull()
    // A share still waiting is not the link she is on: it goes first even from a link's own page.
    expect(pendingLinkToOpen(`/f/${FOLLOW}`, { share: SHARE, follow: FOLLOW, buddyRead: null })).toBe('/share')
    // The other link is another address: it opens.
    expect(pendingLinkToOpen(`/t/${JOINING}`, { ...nothing, follow: FOLLOW })).toBe(`/f/${FOLLOW}`)
    expect(pendingLinkToOpen(`/f/${FOLLOW}`, { ...nothing, buddyRead: JOINING })).toBe(`/t/${JOINING}`)
  })
})
