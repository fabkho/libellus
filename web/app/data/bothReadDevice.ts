import { LOCAL_DATA_PREFIX, type DeviceStorage } from './localData'
import type { BothRead, SocialBook } from './socialShapes'
import { ownCopy } from '../utils/ownCoverPath'

/**
 * The device's copy of "You both read" (docs/plans/shared-books-slideshow.md): the last answer of `both_read` for each
 * friend, so her section is drawn at once on a return visit while a fresh answer is read in the background. The same
 * pattern as the feed's copy (`data/feed.ts`): under `libellus.`, so signing out clears it with the rest
 * (`data/localData.ts`); a copy is only read back for the member who saved it, never older than `BOTH_READ_KEEP_DAYS`,
 * and of this version's shape (an older one reads as none, never misread).
 *
 * **What is kept is a whitelist**, as what reaches Regal is (`data/bothReadReel.ts`): for a Book its id, title, authors,
 * year, cover address, the key and widths of our stored copy, thumbhash and colours, and the two flags the app needs to draw and open it (`manual`,
 * `unverified`); for each side the rating and the day. `saveBothRead` builds every record from those keys alone, so a
 * field the answer may carry one day (a review, a blurb, her address) is never written, and `readBothRead` rebuilds the
 * same way from what it reads (a foreign or torn value is as good as none). Bounded: at most `BOTH_READ_FRIENDS` friends
 * (the least recently saved go first) and `BOTH_READ_BOOKS` Books each (the newest of an answer longer than that:
 * the screen shows the copy at once, and the fresh answer, all of it, replaces it as it comes). An answer equal to the
 * copy is not written again (the storage is touched at most once a day for it, to keep the copy's age). The copy goes when she turns her
 * finished section off, closes her profile, or the relation ends (the store says so: `forgetBothRead`).
 * Framework-free.
 */

/** Bumped when the shape changes. */
export const DEVICE_BOTH_READ_VERSION = 1
export const DEVICE_BOTH_READ_KEY = `${LOCAL_DATA_PREFIX}bothRead`
export const BOTH_READ_KEEP_DAYS = 30
export const BOTH_READ_FRIENDS = 8
export const BOTH_READ_BOOKS = 100

const DAY_MS = 86_400_000

type Saved = { memberId: string; friends: Record<string, { savedAt: string; items: BothRead[] }> }

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const whole = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

function bookOf(value: unknown): SocialBook | null {
  const book = value as Partial<SocialBook> | null
  if (!book || typeof book.id !== 'string' || typeof book.title !== 'string') return null
  const colors = book.coverColors
  const copy = ownCopy(book.coverKey, book.coverWidths)
  return {
    id: book.id,
    title: book.title,
    authors: Array.isArray(book.authors) ? book.authors.filter((author): author is string => typeof author === 'string') : [],
    year: whole(book.year),
    coverUrl: text(book.coverUrl),
    coverThumbhash: text(book.coverThumbhash),
    coverColors: colors && typeof colors.dominant === 'string' && typeof colors.secondary === 'string' ? { dominant: colors.dominant, secondary: colors.secondary } : null,
    coverKey: copy?.coverKey ?? null,
    coverWidths: copy?.coverWidths ?? null,
    manual: book.manual === true,
    unverified: book.unverified === true,
  }
}

function sideOf(value: unknown) {
  const side = value as { rating?: unknown; endedOn?: unknown } | null
  return { rating: whole(side?.rating), endedOn: text(side?.endedOn) }
}

/** One answer, rebuilt from the whitelisted keys alone; null when it is not one. */
export function bothReadOf(value: unknown): BothRead | null {
  const item = value as Partial<BothRead> | null
  const book = bookOf(item?.book)
  return book ? { book, mine: sideOf(item?.mine), hers: sideOf(item?.hers) } : null
}

function readAll(storage: DeviceStorage): Saved | null {
  try {
    const raw = storage.getItem(DEVICE_BOTH_READ_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { version?: number; data?: Saved }
    const data = parsed?.version === DEVICE_BOTH_READ_VERSION ? parsed.data : null
    return data && typeof data.memberId === 'string' && data.friends && typeof data.friends === 'object' ? data : null
  } catch {
    return null
  }
}

function writeAll(storage: DeviceStorage, data: Saved): boolean {
  try {
    if (!Object.keys(data.friends).length) storage.removeItem(DEVICE_BOTH_READ_KEY)
    else storage.setItem(DEVICE_BOTH_READ_KEY, JSON.stringify({ version: DEVICE_BOTH_READ_VERSION, data }))
    return true
  } catch {
    // Full or switched off: an older copy would be wrong, so none.
    try {
      storage.removeItem(DEVICE_BOTH_READ_KEY)
    } catch {
      // Nothing more to do.
    }
    return false
  }
}

/** How long an equal answer leaves the copy as it is before its age is renewed. */
const RENEW_AFTER_MS = DAY_MS

/**
 * Keeps the answer for this friend (newest first, as read; the first `BOTH_READ_BOOKS` of a longer one). Returns whether
 * the storage is as asked: an answer equal to the copy that is less than a day old writes nothing.
 */
export function saveBothRead(storage: DeviceStorage, memberId: string, friendId: string, items: readonly BothRead[], now: Date): boolean {
  const held = readAll(storage)
  const data: Saved = held && held.memberId === memberId ? held : { memberId, friends: {} }
  if (!items.length) delete data.friends[friendId]
  else {
    const kept = items.slice(0, BOTH_READ_BOOKS).flatMap((item) => bothReadOf(item) ?? [])
    const before = data.friends[friendId]
    if (before && Array.isArray(before.items) && sameBothRead(before.items, kept) && now.getTime() - new Date(before.savedAt).getTime() < RENEW_AFTER_MS) return true
    data.friends[friendId] = { savedAt: now.toISOString(), items: kept }
    const newest = Object.entries(data.friends).sort(([, a], [, b]) => b.savedAt.localeCompare(a.savedAt))
    for (const [id] of newest.slice(BOTH_READ_FRIENDS)) delete data.friends[id]
  }
  return writeAll(storage, data)
}

/** The saved answer for this friend: this member's, of this shape, at most `BOTH_READ_KEEP_DAYS` old; else null. */
export function readBothRead(storage: DeviceStorage, memberId: string, friendId: string, now: Date): BothRead[] | null {
  const held = readAll(storage)
  if (!held || held.memberId !== memberId) return null
  const saved = held.friends[friendId]
  if (!saved || !Array.isArray(saved.items)) return null
  const age = now.getTime() - new Date(saved.savedAt).getTime()
  if (!Number.isFinite(age) || age > BOTH_READ_KEEP_DAYS * DAY_MS) return null
  const items = saved.items.map(bothReadOf)
  return items.length && items.every((item): item is BothRead => item !== null) ? items : null
}

/** Takes her copy away (her finished section went off, her profile closed, the relation ended). */
export function forgetBothRead(storage: DeviceStorage, memberId: string, friendId: string): void {
  const held = readAll(storage)
  if (!held || held.memberId !== memberId || !(friendId in held.friends)) return
  delete held.friends[friendId]
  writeAll(storage, held)
}

/** Whether two answers are the same Books with the same ratings and days (a fresh answer equal to the copy changes nothing). */
export function sameBothRead(a: readonly BothRead[], b: readonly BothRead[]): boolean {
  return a.length === b.length && JSON.stringify(a.map(bothReadOf)) === JSON.stringify(b.map(bothReadOf))
}
