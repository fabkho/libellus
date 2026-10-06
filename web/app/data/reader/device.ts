/**
 * What the reader keeps on this device per book (#131 phase 2), under the
 * `libellus.` prefix so that signing out clears it (data/localData.ts):
 *
 * - **highlights**: the device's copy of the list that is also kept server-side
 *   (data/readerHighlights.ts): per entry every highlight with its id, the file
 *   it was made in, its moments, tombstones of the removed ones, and whether the
 *   latest change has been handed to the outbox (`sent`). Before the sync a
 *   highlight was only {cfi, color, text, index}; those records are read as
 *   `legacy` and adopted once (`adoptLegacy`);
 * - **the place**: where the book was left (a CFI, the fraction, the copy's
 *   fingerprint and when), the device's own copy of what is also saved
 *   server-side (data/readerPlaces.ts) — the newer of the two wins, and a CFI is
 *   only trusted on a copy with the same fingerprint (else the fraction).
 *
 * Framework-free; the storage comes in.
 */
import { LOCAL_DATA_PREFIX, type DeviceStorage } from '../localData'
import type { ReaderHighlight } from '../readerHighlights'

/** The four highlight colours (tokens `highlightLamp|Sage|Sky|Rose`). */
export const HIGHLIGHT_COLORS = ['lamp', 'sage', 'sky', 'rose'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

/** What the engine draws: a range, its colour, the words. */
export interface Highlight {
  cfi: string
  color: HighlightColor
  text: string
  /** The book's section it is in (foliate draws a section's highlights when it loads). */
  index: number
}

/** A highlight as the device keeps it: the server's record, and whether its latest change is in the outbox (or on the server). */
export type LocalHighlight = ReaderHighlight & { sent: boolean }

export interface Place {
  cfi: string
  fraction: number
  fileHash: string
  /** ISO time it was left there. */
  at: string
}

const highlightsKey = (memberId: string, entryId: string) => `${LOCAL_DATA_PREFIX}reader.highlights.${memberId}.${entryId}`
const placeKey = (memberId: string, entryId: string) => `${LOCAL_DATA_PREFIX}reader.place.${memberId}.${entryId}`

function readJson<T>(storage: Pick<DeviceStorage, 'getItem'>, key: string): T | null {
  try {
    return JSON.parse(storage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
function writeJson(storage: Pick<DeviceStorage, 'setItem'>, key: string, value: unknown) {
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Full or switched off: kept for this visit only.
  }
}

const isColor = (c: unknown): c is HighlightColor => HIGHLIGHT_COLORS.includes(c as HighlightColor)
const isHighlight = (h: unknown): h is Highlight =>
  !!h && typeof (h as Highlight).cfi === 'string' && isColor((h as Highlight).color) && typeof (h as Highlight).text === 'string' && Number.isInteger((h as Highlight).index)
const isLocalHighlight = (h: unknown): h is LocalHighlight => {
  const r = h as LocalHighlight
  return (
    isHighlight(r) &&
    typeof r.id === 'string' &&
    typeof r.entryId === 'string' &&
    typeof r.fileHash === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.updatedAt === 'string' &&
    (r.deletedAt === null || typeof r.deletedAt === 'string') &&
    typeof r.sent === 'boolean'
  )
}

/**
 * What the device holds for an entry: the synced list (`kept`, tombstones
 * included) and the records from before the sync (`legacy`, no id yet).
 */
export function readHighlights(
  storage: Pick<DeviceStorage, 'getItem'>,
  memberId: string,
  entryId: string,
): { kept: LocalHighlight[]; legacy: Highlight[] } {
  const list = readJson<unknown[]>(storage, highlightsKey(memberId, entryId))
  if (!Array.isArray(list)) return { kept: [], legacy: [] }
  const kept = list.filter(isLocalHighlight)
  const legacy = list.filter((h) => isHighlight(h) && typeof (h as { id?: unknown }).id !== 'string') as Highlight[]
  return { kept, legacy: legacy.map(({ cfi, color, text, index }) => ({ cfi, color, text, index })) }
}
export function writeHighlights(storage: Pick<DeviceStorage, 'setItem' | 'removeItem'>, memberId: string, entryId: string, list: readonly LocalHighlight[]) {
  if (list.length) writeJson(storage, highlightsKey(memberId, entryId), list)
  else storage.removeItem(highlightsKey(memberId, entryId))
}

export function readPlace(storage: Pick<DeviceStorage, 'getItem'>, memberId: string, entryId: string): Place | null {
  const p = readJson<Place>(storage, placeKey(memberId, entryId))
  return p && typeof p.cfi === 'string' && typeof p.fraction === 'number' && typeof p.fileHash === 'string' && typeof p.at === 'string' ? p : null
}
export function writePlace(storage: Pick<DeviceStorage, 'setItem'>, memberId: string, entryId: string, place: Place) {
  writeJson(storage, placeKey(memberId, entryId), place)
}

/** Where to open: the newer of the device's place and the server's; its CFI only for the same copy (else its fraction). */
export function openingPlace(local: Place | null, remote: Place | null, fileHash: string): { cfi: string } | { fraction: number } | null {
  const newer = !local ? remote : !remote ? local : Date.parse(remote.at) > Date.parse(local.at) ? remote : local
  if (!newer) return null
  return newer.fileHash === fileHash ? { cfi: newer.cfi } : { fraction: newer.fraction }
}
