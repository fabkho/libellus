import type { DeviceStorage } from '../data/localData'

/**
 * The hosted auth lets one email code go out per user per `smtp_max_frequency`
 * (20 s, mirrored in supabase/config.toml `[auth.email] max_frequency`). This is
 * the device's side of it: when the last code was mailed, so the screens count
 * the window down and never ask for a second mail the server would refuse.
 */
export const CODE_COOLDOWN_MS = 20_000

// Under the prefix every device cache uses (data/localData.ts). Signing out keeps it (stores/session.ts): the window is the server's,
// and a member who signs out and in again inside it must not be sent into a refusal. It outlives only that window (`recentCode`).
export const CODE_SENT_KEY = 'libellus.codeSent'

export type CodeSent = {
  /** Whose address (`whoIs`): not the address itself, which a sign-out must not leave on the device. */
  who: string
  /** When the mail was asked for (ms). */
  at: number
  /** The code was entered: it is spent, so it is no use to be sent back to the code step. */
  used: boolean
}

/** What to do when a member asks for a code to an address. */
export type CodeStep =
  /** Nothing went out lately: ask. */
  | 'send'
  /** A code to this address went out inside the window and is still good: its step, no second mail. */
  | 'enter'
  /** The last code was used inside the window: a new one cannot go out yet. */
  | 'wait'

/** A short fingerprint of an address, to tell "the same address" without keeping it (FNV-1a over its lowercase form). */
export function whoIs(email: string): string {
  let hash = 0x811c9dc5
  for (const char of email.trim().toLowerCase()) {
    hash ^= char.codePointAt(0)!
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function keepCodeSent(storage: DeviceStorage, sent: CodeSent) {
  storage.setItem(CODE_SENT_KEY, JSON.stringify(sent))
}

/** The last code mailed from this device while its window is open; older records are removed. */
export function recentCode(storage: DeviceStorage, now = Date.now()): CodeSent | null {
  const raw = storage.getItem(CODE_SENT_KEY)
  if (!raw) return null
  try {
    const kept = JSON.parse(raw) as Partial<CodeSent>
    if (typeof kept.who === 'string' && typeof kept.at === 'number' && now - kept.at < CODE_COOLDOWN_MS && now >= kept.at) {
      return { who: kept.who, at: kept.at, used: kept.used === true }
    }
  } catch {
    // Unreadable: treated as none, and removed below.
  }
  storage.removeItem(CODE_SENT_KEY)
  return null
}

/** Whole seconds left of the window that opened at `at` (0 when it has closed). */
export function secondsLeft(at: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((at + CODE_COOLDOWN_MS - now) / 1000))
}

/** What asking for a code to `email` comes to, given the last code mailed from this device (`recentCode`). */
export function stepFor(recent: CodeSent | null, email: string, now = Date.now()): CodeStep {
  if (!recent || recent.who !== whoIs(email) || secondsLeft(recent.at, now) === 0) return 'send'
  return recent.used ? 'wait' : 'enter'
}
