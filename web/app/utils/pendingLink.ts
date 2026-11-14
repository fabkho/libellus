import { LOCAL_DATA_PREFIX, type DeviceStorage } from '../data/localData'
import type { SharedPayload } from './shared'

/**
 * Something she opened while signed out, kept on the device through the sign-in so that she lands where she was
 * going once she is in: a share (issue #91, pages/share.vue), a follow link (social v1, pages/f/[token].vue) and a
 * buddy read link (docs/plans/buddy-read-shared.md W3, pages/t/[token].vue). One concept, one shape — keep, peek,
 * take, a TTL, a token in a path — where three twin modules used to be. Which one opens first is not decided here:
 * `utils/signedOutRoute.ts` is the one place that says where a signed-out visitor goes.
 *
 * The keys are the ones devices already hold, under the prefix signing out clears (data/localData.ts), so a member
 * who signs out forgets what waited and a link kept by the build this one replaces is still read (`peekPending`).
 */
export type PendingKind = 'share' | 'follow' | 'buddyRead'

/** The kinds whose value is a token in a path: `/f/<token>` for a follow link, `/t/<token>` for a buddy read link. */
export type PendingTokenKind = Exclude<PendingKind, 'share'>

/** What each kind keeps: a share's payload (`/share?title=&text=&url=`, issue #91) or a link's token. */
export type PendingValue = { share: SharedPayload; follow: string; buddyRead: string }

export const PENDING_LINK_KEY: { readonly [K in PendingKind]: string } = {
  share: `${LOCAL_DATA_PREFIX}pendingShare`,
  follow: `${LOCAL_DATA_PREFIX}pendingFollow`,
  buddyRead: `${LOCAL_DATA_PREFIX}pendingBuddyRead`,
}

/** Every kept link's key, for the device layers that clear the device and name what a session keeps (stores/session.ts). */
export const PENDING_LINK_KEYS: readonly string[] = [PENDING_LINK_KEY.share, PENDING_LINK_KEY.follow, PENDING_LINK_KEY.buddyRead]

/** An hour, like the pending sign-in address: long enough for a code and a tap, and it dies on its own when she does not come back. */
export const PENDING_LINK_TTL_MS = 60 * 60 * 1000

/** A follow or buddy read token: 128 random bits, 22 base64url characters (data/social.ts, `private.reading_page_token`). */
const TOKEN = /^[A-Za-z0-9_-]{22}$/

/** A link's path: its token, under the one segment that says which link it is. */
const LINK_PATH = /^\/([ft])\/([^/]+)\/?$/
const SEGMENT: { readonly [K in PendingTokenKind]: string } = { follow: 'f', buddyRead: 't' }

/** The one token shape both links share. */
export function isPendingToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN.test(value)
}

/**
 * The token in a link's path (`/f/<token>` or `/t/<token>`, with or without the slash Pages adds); null for any
 * other path, for the other link's path, and for a malformed token.
 */
export function pendingTokenIn(kind: PendingTokenKind, path: string): string | null {
  const match = LINK_PATH.exec(path)
  const token = match?.[1] === SEGMENT[kind] ? match[2] : undefined
  return isPendingToken(token) ? token : null
}

/** True for a link's path whatever its token: how "she is already on that link" is asked. */
export function pendingLinkPath(kind: PendingTokenKind, path: string): boolean {
  return LINK_PATH.exec(path)?.[1] === SEGMENT[kind]
}

/** Where a signed-in member is sent for what was kept of `kind`: `/share`, or the link's own address. */
export function pendingPath(kind: 'share', value: SharedPayload): string
export function pendingPath(kind: PendingTokenKind, value: string): string
export function pendingPath(kind: PendingKind, value: SharedPayload | string): string {
  return kind === 'share' ? '/share' : `/${SEGMENT[kind]}/${value}`
}

/** Keeps what she opened for the sign-in; a malformed token is not kept, as the page it leads to could not resolve it. */
export function keepPending<K extends PendingKind>(storage: DeviceStorage, kind: K, value: PendingValue[K], now = Date.now()): boolean {
  if (kind !== 'share' && !isPendingToken(value)) return false
  storage.setItem(PENDING_LINK_KEY[kind], JSON.stringify({ value, at: now }))
  return true
}

/** Reads what was kept without removing it; null when there is none, it is malformed or it is too old (and then it is removed). */
export function peekPending<K extends PendingKind>(storage: DeviceStorage, kind: K, now = Date.now()): PendingValue[K] | null {
  const key = PENDING_LINK_KEY[kind]
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    // The build this one replaces kept a share's payload under `payload` and a link's token under `token`: a link
    // kept across that update still resolves.
    const kept = JSON.parse(raw) as { value?: unknown; payload?: unknown; token?: unknown; at?: unknown }
    const value = kept.value ?? kept.payload ?? kept.token
    if (typeof kept.at === 'number' && now - kept.at <= PENDING_LINK_TTL_MS) {
      const read = valueOf<K>(kind, value)
      if (read !== null) return read
    }
  } catch {
    // Unreadable: treated as none, and removed below.
  }
  storage.removeItem(key)
  return null
}

/** Reads what was kept and forgets it. */
export function takePending<K extends PendingKind>(storage: DeviceStorage, kind: K, now = Date.now()): PendingValue[K] | null {
  const value = peekPending(storage, kind, now)
  storage.removeItem(PENDING_LINK_KEY[kind])
  return value
}

/** Forgets what was kept of `kind`: a link she opened is the one that counts, and a share in the address replaces one from before. */
export function forgetPending(storage: DeviceStorage, kind: PendingKind): void {
  storage.removeItem(PENDING_LINK_KEY[kind])
}

/** What was read is the kind's own value or nothing: a token of the shared shape, a share's non-empty payload. */
function valueOf<K extends PendingKind>(kind: K, value: unknown): PendingValue[K] | null {
  if (kind === 'share') return value && typeof value === 'object' ? (value as PendingValue[K]) : null
  return isPendingToken(value) ? (value as PendingValue[K]) : null
}
