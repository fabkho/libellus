import type { DeviceStorage } from '../data/localData'

/**
 * A follow link (`/f/<token>`, social v1) opened while nobody was signed in: the token is kept on
 * the device through the sign-in (or the sign-up with an invite code) so the member lands on the
 * link once she is in, and it resolves then. The twin of pendingShare.ts: under the `libellus.`
 * prefix, so signing out forgets it, and dropped after an hour like the pending sign-in address.
 */
export const PENDING_FOLLOW_KEY = 'libellus.pendingFollow'
export const PENDING_FOLLOW_TTL_MS = 60 * 60 * 1000

/** A follow token: 128 random bits, 22 base64url characters (data/social.ts). */
const FOLLOW_TOKEN = /^[A-Za-z0-9_-]{22}$/
const FOLLOW_PATH = /^\/f\/([^/]+)\/?$/

export function isFollowToken(value: unknown): value is string {
  return typeof value === 'string' && FOLLOW_TOKEN.test(value)
}

/** The token in a follow link's path (`/f/<token>`, with or without the slash Pages adds); null for any other path or a malformed token. */
export function followTokenIn(path: string): string | null {
  const token = FOLLOW_PATH.exec(path)?.[1]
  return token && isFollowToken(token) ? token : null
}

/** Keeps a follow token for the sign-in; a malformed one is not kept. True when it was. */
export function keepFollow(storage: DeviceStorage, token: string, now = Date.now()): boolean {
  if (!isFollowToken(token)) return false
  storage.setItem(PENDING_FOLLOW_KEY, JSON.stringify({ token, at: now }))
  return true
}

/** Reads the kept token without removing it; null when there is none, it is malformed or it is too old. */
export function peekFollow(storage: DeviceStorage, now = Date.now()): string | null {
  const raw = storage.getItem(PENDING_FOLLOW_KEY)
  if (!raw) return null
  try {
    const kept = JSON.parse(raw) as { token?: unknown; at?: unknown }
    if (isFollowToken(kept.token) && typeof kept.at === 'number' && now - kept.at <= PENDING_FOLLOW_TTL_MS) return kept.token
  } catch {
    // Unreadable: treated as none, and removed below.
  }
  storage.removeItem(PENDING_FOLLOW_KEY)
  return null
}

/** Reads the kept token and forgets it. */
export function takeFollow(storage: DeviceStorage, now = Date.now()): string | null {
  const token = peekFollow(storage, now)
  storage.removeItem(PENDING_FOLLOW_KEY)
  return token
}

/**
 * Where a signed-in member is sent for a follow link kept before her sign-in: `/f/<token>`, or null
 * for no move. Not while she is already on a follow link (that one resolves, and the page forgets
 * the kept one), and not while a share is waiting or being taken in on `/share`: the share goes
 * first and the follow waits for the next navigation.
 */
export function followToOpen(path: string, kept: string | null, shareWaiting: boolean): string | null {
  if (!kept || shareWaiting || path === '/share' || FOLLOW_PATH.test(path)) return null
  return `/f/${kept}`
}
