import type { SupabaseClient } from '@supabase/supabase-js'
import { LOCAL_DATA_PREFIX, type DeviceStorage } from './localData'
import { isNoAnswer } from './network'
import {
  cardFromJson,
  mapSocialError,
  socialBookFromJson,
  type MemberCard,
  type SocialBook,
  type SocialErrorCode,
  type SocialResult,
} from './socialShapes'

/**
 * The feed (social v1, docs/proposals/social-v1-contract.md §1.5 D4 and §2): what the members she
 * follows did, newest first, a page at a time. The database answers one entry per fact
 * (`feed`, settled and filtered by what each owner shows); this file turns a list of them into
 * what the screen shows, and keeps the last list on the device.
 *
 * - `createFeed(client, { online }).page(before?)` reads one page, refused with `offline` before
 *   anything is sent when the device is offline. `before` is the last entry of the page she has.
 * - `feedDays` is pure: entries to days to rows. Three or more of one kind by one member on one
 *   of her days ("finished 3 books") fold into one batch row, where the newest of them was.
 * - `saveFeed` / `readFeed` are the device's copy (`libellus.feed`, cleared with the rest on
 *   signing out), so the feed opens without a connection on what was last seen. It is the
 *   member's own, at most `FEED_KEEP_DAYS` old; anything else reads as none. A storage that
 *   refuses the write is ignored: the next load tries again.
 *
 * Framework-free like every repository: the stores hand in the client, `online` and the storage.
 */

export type FeedKind = 'started' | 'finished' | 'abandoned' | 'want' | 'reviewed'

export type FeedEntry = {
  /** `activity.id`: with `at`, the keyset for the next page. */
  id: string
  /** When it became visible (ISO). */
  at: string
  member: MemberCard
  kind: FeedKind
  /** A `started` entry with an earlier finished read of the same Book. */
  again: boolean
  /** The day the member says it happened (`YYYY-MM-DD`), when she does. */
  day: string | null
  book: SocialBook
  /** Quarters, on `finished` and `reviewed` only, and only when she shows ratings. */
  rating: number | null
  review: string | null
}

export type FeedRow =
  | { type: 'entry'; entry: FeedEntry }
  | { type: 'batch'; member: MemberCard; kind: FeedKind; day: string | null; entries: FeedEntry[] }

/** `day`: the calendar day of `at` as the caller's `dayOf` has it. */
export type FeedDay = { day: string; rows: FeedRow[] }

export const FEED_PAGE = 30
/** Three or more of one kind, one member, one day, become one row. */
export const BATCH_FROM = 3
/** The device's copy is at most this many days old. */
export const FEED_KEEP_DAYS = 7

/**
 * Entries (newest first, as `feed` answers) to days, newest first, each with its rows.
 * Within a day the entries of one member and one kind, when there are `BATCH_FROM` or more,
 * are one `batch` row (newest first) placed where the newest of them was; the rest stay
 * `entry` rows in their place. Other members, kinds and days never batch together.
 */
export function feedDays(entries: readonly FeedEntry[], dayOf: (at: string) => string): FeedDay[] {
  const days = new Map<string, FeedEntry[]>()
  for (const entry of entries) {
    const day = dayOf(entry.at)
    const list = days.get(day)
    if (list) list.push(entry)
    else days.set(day, [entry])
  }

  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => {
      const groups = new Map<string, FeedEntry[]>()
      for (const entry of list) {
        const key = `${entry.member.id}\u0000${entry.kind}`
        const group = groups.get(key)
        if (group) group.push(entry)
        else groups.set(key, [entry])
      }

      const rows: FeedRow[] = []
      const placed = new Set<string>()
      for (const entry of list) {
        const key = `${entry.member.id}\u0000${entry.kind}`
        const group = groups.get(key)!
        if (group.length < BATCH_FROM) {
          rows.push({ type: 'entry', entry })
        } else if (!placed.has(key)) {
          placed.add(key)
          rows.push({ type: 'batch', member: entry.member, kind: entry.kind, day: entry.day, entries: group })
        }
      }
      return { day, rows }
    })
}

type FeedJson = {
  id: string
  at: string
  member: Parameters<typeof cardFromJson>[0]
  kind: FeedKind
  again: boolean
  day: string | null
  book: Parameters<typeof socialBookFromJson>[0]
  rating: number | null
  review: string | null
}

function entryFromJson(json: FeedJson): FeedEntry {
  return {
    id: json.id,
    at: json.at,
    member: cardFromJson(json.member),
    kind: json.kind,
    again: Boolean(json.again),
    day: json.day ?? null,
    book: socialBookFromJson(json.book),
    rating: json.rating ?? null,
    review: json.review ?? null,
  }
}

export interface Feed {
  /** One page, newest first; `before`: the last entry of the page she has. Fewer than `FEED_PAGE`: the end. */
  page(before?: { at: string; id: string }): Promise<SocialResult<FeedEntry[]>>
}

export function createFeed(client: SupabaseClient, { online }: { online: () => boolean }): Feed {
  return {
    async page(before) {
      if (!online()) return { data: null, error: 'offline' satisfies SocialErrorCode }
      const answer = await client.rpc('feed', {
        p_before: before?.at ?? null,
        p_before_id: before?.id ?? null,
        p_limit: FEED_PAGE,
      })
      // No answer at all is offline, so the page offers the copy and reads again on reconnect.
      if (isNoAnswer(answer)) return { data: null, error: 'offline' satisfies SocialErrorCode }
      if (answer.error) return { data: null, error: mapSocialError(answer.error) }
      return { data: ((answer.data ?? []) as FeedJson[]).map(entryFromJson), error: null }
    },
  }
}

// ------------------------------------------------------------------ the device's copy

/** Bumped when the shape changes: an older copy is then ignored, never misread. */
export const DEVICE_FEED_VERSION = 1
export const DEVICE_FEED_KEY = `${LOCAL_DATA_PREFIX}feed`

type SavedFeed = { memberId: string; savedAt: string; entries: FeedEntry[] }

const DAY_MS = 86_400_000

function isEntry(value: unknown): value is FeedEntry {
  const entry = value as FeedEntry | null
  return (
    typeof entry?.id === 'string' &&
    typeof entry.at === 'string' &&
    typeof entry.kind === 'string' &&
    typeof entry.member?.id === 'string' &&
    typeof entry.book?.id === 'string' &&
    typeof entry.book.title === 'string'
  )
}

/** Writes the feed's entries as this member last saw them. Returns whether the storage took it. */
export function saveFeed(storage: DeviceStorage, memberId: string, entries: readonly FeedEntry[], now: Date): boolean {
  const data: SavedFeed = { memberId, savedAt: now.toISOString(), entries: [...entries] }
  try {
    storage.setItem(DEVICE_FEED_KEY, JSON.stringify({ version: DEVICE_FEED_VERSION, data }))
    return true
  } catch {
    // Full or switched off: an older copy would be wrong, so none.
    try {
      storage.removeItem(DEVICE_FEED_KEY)
    } catch {
      // Nothing more to do.
    }
    return false
  }
}

/** The saved entries, when they are this member's, of this shape, and at most `FEED_KEEP_DAYS` old. */
export function readFeed(storage: DeviceStorage, memberId: string, now: Date): FeedEntry[] | null {
  let raw: string | null
  try {
    raw = storage.getItem(DEVICE_FEED_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { version?: number; data?: SavedFeed }
    const saved = parsed?.version === DEVICE_FEED_VERSION ? parsed.data : null
    if (saved && Array.isArray(saved.entries) && saved.entries.every(isEntry)) {
      if (saved.memberId !== memberId) return null
      const age = now.getTime() - new Date(saved.savedAt).getTime()
      if (Number.isFinite(age) && age <= FEED_KEEP_DAYS * DAY_MS) return saved.entries
    }
  } catch {
    // A torn or foreign value: as good as none.
  }
  return null
}
