/**
 * What the reader keeps on this device per book (#131 phase 2), under the
 * `libellus.` prefix so that signing out clears it (data/localData.ts):
 *
 * - **highlights**: where (a CFI), which colour, the words; this device only in v1;
 * - **the place**: where the book was left (a CFI, the fraction, the copy's
 *   fingerprint and when), the device's own copy of what is also saved
 *   server-side (data/readerPlaces.ts) — the newer of the two wins, and a CFI is
 *   only trusted on a copy with the same fingerprint (else the fraction).
 *
 * Framework-free; the storage comes in.
 */
import { LOCAL_DATA_PREFIX, type DeviceStorage } from '../localData'

/** The four highlight colours (tokens `highlightLamp|Sage|Sky|Rose`). */
export const HIGHLIGHT_COLORS = ['lamp', 'sage', 'sky', 'rose'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export interface Highlight {
  cfi: string
  color: HighlightColor
  text: string
  /** The book's section it is in (foliate draws a section's highlights when it loads). */
  index: number
}

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

const isHighlight = (h: unknown): h is Highlight =>
  !!h &&
  typeof (h as Highlight).cfi === 'string' &&
  HIGHLIGHT_COLORS.includes((h as Highlight).color) &&
  typeof (h as Highlight).text === 'string' &&
  Number.isInteger((h as Highlight).index)

export function readHighlights(storage: Pick<DeviceStorage, 'getItem'>, memberId: string, entryId: string): Highlight[] {
  const list = readJson<unknown[]>(storage, highlightsKey(memberId, entryId))
  return Array.isArray(list) ? list.filter(isHighlight) : []
}
export function writeHighlights(storage: Pick<DeviceStorage, 'setItem' | 'removeItem'>, memberId: string, entryId: string, list: readonly Highlight[]) {
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
