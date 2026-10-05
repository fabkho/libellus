import type { DeviceStorage } from '../data/localData'
import type { SharedPayload } from './shared'

/**
 * A share that arrived while nobody was signed in (issue #91): kept on the
 * device through the sign-in so the member lands on the Book after the code,
 * not on Home. Under the `libellus.` prefix, so signing out forgets it, and
 * dropped after an hour like the pending sign-in address.
 */
export const PENDING_SHARE_KEY = 'libellus.pendingShare'
export const PENDING_SHARE_TTL_MS = 60 * 60 * 1000

export function keepShare(storage: DeviceStorage, payload: SharedPayload, now = Date.now()) {
  storage.setItem(PENDING_SHARE_KEY, JSON.stringify({ payload, at: now }))
}

/** Reads the kept share without removing it; null when there is none or it is too old. */
export function peekShare(storage: DeviceStorage, now = Date.now()): SharedPayload | null {
  const raw = storage.getItem(PENDING_SHARE_KEY)
  if (!raw) return null
  try {
    const kept = JSON.parse(raw) as { payload?: SharedPayload; at?: number }
    if (kept.payload && typeof kept.at === 'number' && now - kept.at <= PENDING_SHARE_TTL_MS) return kept.payload
  } catch {
    // Unreadable: treated as none, and removed below.
  }
  storage.removeItem(PENDING_SHARE_KEY)
  return null
}

/** Reads the kept share and forgets it. */
export function takeShare(storage: DeviceStorage, now = Date.now()): SharedPayload | null {
  const payload = peekShare(storage, now)
  storage.removeItem(PENDING_SHARE_KEY)
  return payload
}
