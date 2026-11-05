import type { DeviceStorage } from '../data/localData'

/**
 * A buddy read link (`/t/<token>`, docs/plans/buddy-read-shared.md W3) opened while nobody was signed in: the token is kept on
 * the device through the sign-in (or the sign-up with an invite code) so the member lands on the join card once she is in.
 * The twin of pendingFollow.ts: under the `libellus.` prefix, so signing out forgets it, and dropped after an hour like the pending
 * sign-in address. Nothing is kept in a build without buddy reads (the middleware asks the flag first).
 */
export const PENDING_BUDDY_READ_KEY = 'libellus.pendingBuddyRead'
export const PENDING_BUDDY_READ_TTL_MS = 60 * 60 * 1000

/** A buddy read link's token: 128 random bits, 22 base64url characters (`private.reading_page_token`, checked again by `join_buddy_read`). */
const BUDDY_READ_TOKEN = /^[A-Za-z0-9_-]{22}$/
const BUDDY_READ_PATH = /^\/t\/([^/]+)\/?$/

export function isBuddyReadToken(value: unknown): value is string {
  return typeof value === 'string' && BUDDY_READ_TOKEN.test(value)
}

/** The token in a buddy read link's path (`/t/<token>`, with or without the slash Pages adds); null for any other path or a malformed token. */
export function buddyReadTokenIn(path: string): string | null {
  const token = BUDDY_READ_PATH.exec(path)?.[1]
  return token && isBuddyReadToken(token) ? token : null
}

/** Keeps a token for the sign-in; a malformed one is not kept. True when it was. */
export function keepBuddyRead(storage: DeviceStorage, token: string, now = Date.now()): boolean {
  if (!isBuddyReadToken(token)) return false
  storage.setItem(PENDING_BUDDY_READ_KEY, JSON.stringify({ token, at: now }))
  return true
}

/** Reads the kept token without removing it; null when there is none, it is malformed or it is too old. */
export function peekBuddyRead(storage: DeviceStorage, now = Date.now()): string | null {
  const raw = storage.getItem(PENDING_BUDDY_READ_KEY)
  if (!raw) return null
  try {
    const kept = JSON.parse(raw) as { token?: unknown; at?: unknown }
    if (isBuddyReadToken(kept.token) && typeof kept.at === 'number' && now - kept.at <= PENDING_BUDDY_READ_TTL_MS) return kept.token
  } catch {
    // Unreadable: treated as none, and removed below.
  }
  storage.removeItem(PENDING_BUDDY_READ_KEY)
  return null
}

/** Reads the kept token and forgets it. */
export function takeBuddyRead(storage: DeviceStorage, now = Date.now()): string | null {
  const token = peekBuddyRead(storage, now)
  storage.removeItem(PENDING_BUDDY_READ_KEY)
  return token
}

/**
 * Where a signed-in member is sent for a link kept before her sign-in: `/t/<token>`, or null for no move. Not while she is already on a
 * buddy read link (that one resolves, and the page forgets the kept one), and not while a share or a follow link is waiting (or a share is
 * being taken in on `/share`): those go first and this waits for the next navigation.
 */
export function buddyReadToOpen(path: string, kept: string | null, otherWaiting: boolean): string | null {
  if (!kept || otherWaiting || path === '/share' || BUDDY_READ_PATH.test(path)) return null
  return `/t/${kept}`
}
