import { emptyCounters, isDone, type UpgradeList, type UpgradeRow } from '../data/coverUpgrade'

/**
 * Where the one-time Apple cover upgrade's work lists live (data/coverUpgrade.ts, issue #366): on the device, per member, in
 * `localStorage`, next to what the import keeps of its own lookups (utils/importMatches.ts). Apple's limit is per address, so the
 * device that ran the import is the one that asks; nothing of it goes to the server but the covers themselves (`fill_book_covers`).
 *
 * One list per import, made when that import is written and holding only the Catalogue Books it added. A list that is worked off
 * is removed (`done for good`: nothing here can start it again; a later import makes a new one, for its own books). A list not
 * worked off is kept until it is (an app closed meanwhile continues on the next start), but not past `UPGRADE_LIST_DAYS`, and a full
 * storage just means nothing is kept. Framework-free, so Vitest pins it in plain Node.
 */

export const UPGRADE_LISTS_KEY = 'libellus.cover-upgrade.v1'
/** A list that is not worked off within this many days is let go (an address that stays refused should not nag forever). */
export const UPGRADE_LIST_DAYS = 60
/** At most this many lists, and this many rows in all, are kept per member. */
export const UPGRADE_LISTS_MAX = 5
export const UPGRADE_ROWS_MAX = 3000

export type UpgradeStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

type Stored = { members: Record<string, UpgradeList[]> }

const isRow = (row: unknown): row is UpgradeRow => {
  const value = row as UpgradeRow | null
  return Boolean(value) && typeof value!.bookId === 'string' && typeof value!.title === 'string' && Array.isArray(value!.authors)
}

const isList = (list: unknown): list is UpgradeList => {
  const value = list as UpgradeList | null
  return Boolean(value) && typeof value!.id === 'string' && typeof value!.at === 'number' && Array.isArray(value!.rows) && value!.rows.every(isRow)
}

function readAll(storage: Pick<UpgradeStorage, 'getItem'>): Stored {
  try {
    const stored = JSON.parse(storage.getItem(UPGRADE_LISTS_KEY) ?? 'null') as Stored | null
    return stored && typeof stored.members === 'object' && stored.members ? stored : { members: {} }
  } catch {
    return { members: {} }
  }
}

/** The member's lists that are not worked off and not too old, oldest first; empty for anything unreadable. */
export function readUpgradeLists(storage: Pick<UpgradeStorage, 'getItem'>, member: string, now = Date.now()): UpgradeList[] {
  const lists = readAll(storage).members[member]
  if (!Array.isArray(lists)) return []
  return lists
    .filter(isList)
    .map((list) => ({ ...list, counters: { ...emptyCounters(), ...list.counters } }))
    .filter((list) => !isDone(list) && now - list.at <= UPGRADE_LIST_DAYS * 86_400_000)
    .sort((a, b) => a.at - b.at)
}

/** Keeps the member's lists as given (a worked-off one is dropped here: it is done for good); storage that refuses keeps nothing and says nothing. */
export function writeUpgradeLists(storage: Pick<UpgradeStorage, 'getItem' | 'setItem' | 'removeItem'>, member: string, lists: readonly UpgradeList[]): void {
  try {
    const all = readAll(storage)
    let rows = 0
    const kept = lists
      .filter((list) => !isDone(list))
      .slice(-UPGRADE_LISTS_MAX)
      .filter((list) => (rows += list.rows.length) <= UPGRADE_ROWS_MAX)
    if (kept.length) all.members[member] = kept
    else delete all.members[member]
    if (Object.keys(all.members).length) storage.setItem(UPGRADE_LISTS_KEY, JSON.stringify(all))
    else storage.removeItem(UPGRADE_LISTS_KEY)
  } catch {
    try {
      storage.removeItem(UPGRADE_LISTS_KEY)
    } catch {
      /* nothing to keep it in */
    }
  }
}

/** A list for an import: only rows worth asking Apple about; null when there are none (no list is made for nothing). */
export function makeUpgradeList(id: string, rows: readonly UpgradeRow[], now = Date.now()): UpgradeList | null {
  const kept = rows.filter((row) => !row.result)
  return kept.length ? { id, at: now, rows: kept.map((row) => ({ ...row })), counters: emptyCounters() } : null
}

/**
 * The entries an import's list is made from: the ones that import ADDED, never a row she held already (`in_library`), imported
 * before (`imported`) or failed, and never a row she picked an edition for herself in the preview (`pickedKeys`: her cover choice).
 * Books she adds later (search, scan, Choose edition) are no import's rows at all: nothing here ever names them.
 */
export function importedEntryIds(outcomes: readonly { key: string; outcome: string; entryId: string | null }[], pickedKeys: ReadonlySet<string | undefined>): string[] {
  return outcomes.flatMap((outcome) => (outcome.outcome === 'added' && outcome.entryId && !pickedKeys.has(outcome.key) ? [outcome.entryId] : []))
}
