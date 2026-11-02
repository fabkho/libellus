/**
 * Buddy reads (Profile → Account → Buddy reads): the switch the whole feature sits behind in the first
 * release. Off until she turns it on: a setting of this device kept under `libellus.`, so signing out
 * (or another member signing in) puts it back to the default with the rest of what the device
 * remembered about the member (data/localData.ts). It gates the entry points — the Book page's row,
 * the Home card, invitations and the routes `/together/*` and `/t/*` — never her membership: an active
 * room keeps her in it while the switch is on or off, which is why the store refuses to turn it off
 * while she is in one (the confirm arrives with the room screens).
 * Framework-free, so Vitest pins it in plain Node (tests/buddy-reads-switch.test.ts).
 */
import { LOCAL_DATA_PREFIX } from '~/data/localData'

/**
 * The one thing a later release flips. The stored value is the *other* of the two states, so a device
 * that never chose reads the default, and a flipped release needs no other change here.
 */
export const BUDDY_READS_DEFAULT_ON = false

/** The local-storage key: under `libellus.`, so signing out clears it. */
export const BUDDY_READS_KEY = `${LOCAL_DATA_PREFIX}buddyReads`

/** The slice of Storage the setting needs; `window.localStorage` fits. */
export type BuddyReadsStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** What a stored string means: only an explicit `on` is on, only an explicit `off` is off; nothing, or anything unknown, is the default. */
export function parseBuddyReads(raw: string | null | undefined): boolean {
  if (raw === 'on') return true
  if (raw === 'off') return false
  return BUDDY_READS_DEFAULT_ON
}

export function readBuddyReads(storage: Pick<BuddyReadsStorage, 'getItem'>): boolean {
  try {
    return parseBuddyReads(storage.getItem(BUDDY_READS_KEY))
  } catch {
    // Storage can be unavailable (private mode, blocked): the default, off in the first release.
    return BUDDY_READS_DEFAULT_ON
  }
}

/** The default is stored as nothing at all: only the other state is written (`on` in the first release, `off` once the default flips). */
export function writeBuddyReads(storage: BuddyReadsStorage & { removeItem?: (key: string) => void }, on: boolean): void {
  try {
    if (on === BUDDY_READS_DEFAULT_ON) storage.removeItem?.(BUDDY_READS_KEY)
    else storage.setItem(BUDDY_READS_KEY, on ? 'on' : 'off')
  } catch {
    // Not persisted, but the setting still holds for this visit.
  }
}
