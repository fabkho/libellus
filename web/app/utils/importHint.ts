/**
 * When Home offers the import to a member (a new member who finds it hidden behind
 * Profile → Import books), framework-free so Vitest pins the rules in plain Node and a
 * native port can copy them.
 *
 * - A Library with no entries at all: the empty state gets the offer, in full.
 * - A Library with only a few entries (`FEW_ENTRIES` or fewer): a smaller offer above them,
 *   so someone who added two books first still finds the import. It has a × that hides it
 *   for good on this device.
 * - Never to a member who imported before, never to one with a real Library.
 *
 * What the device remembers is per member, kept outside the `libellus.` prefix that signing
 * out clears (data/localData.ts), like the install hint: a dismissal is a setting of the
 * device, and signing in again should not bring a hidden card back.
 */

/** The local-storage key: a map of member id → what that member did about the offer. */
export const IMPORT_HINT_KEY = 'libellus-import-hint'

/** How many entries still count as "a few". */
export const FEW_ENTRIES = 3

/** `dismissed`: the member hid the small offer. `imported`: she has imported books (here or elsewhere). */
export type ImportHintMemory = 'dismissed' | 'imported'

/** What Home shows: nothing, the empty state's card, or the smaller one over a few entries. */
export type ImportOffer = 'none' | 'full' | 'small'

/** The slice of Storage the offer needs; `window.localStorage` fits. */
export type ImportHintStorage = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** The offer for a Library of `entryCount` entries and what the device remembers of this member. */
export function importOffer(entryCount: number, memory: ImportHintMemory | null): ImportOffer {
  if (memory === 'imported') return 'none'
  if (entryCount === 0) return 'full'
  if (entryCount <= FEW_ENTRIES && memory !== 'dismissed') return 'small'
  return 'none'
}

function readAll(storage: Pick<ImportHintStorage, 'getItem'>): Record<string, ImportHintMemory> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(IMPORT_HINT_KEY) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === 'dismissed' || value === 'imported')) as Record<
      string,
      ImportHintMemory
    >
  } catch {
    return {}
  }
}

/** What this device remembers of the member; null for nothing (or anything unreadable, or storage that refuses). */
export function readImportHint(storage: Pick<ImportHintStorage, 'getItem'>, memberId: string): ImportHintMemory | null {
  return readAll(storage)[memberId] ?? null
}

/**
 * Remembers what the member did. An import outranks a dismissal and is never taken back;
 * storage that refuses (private mode) just forgets, and the caller keeps it for the visit.
 */
export function writeImportHint(storage: ImportHintStorage, memberId: string, memory: ImportHintMemory): void {
  try {
    const all = readAll(storage)
    if (all[memberId] === 'imported') return
    storage.setItem(IMPORT_HINT_KEY, JSON.stringify({ ...all, [memberId]: memory }))
  } catch {
    // Nothing to keep it in.
  }
}
