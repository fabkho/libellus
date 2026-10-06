/**
 * The four highlight colours (fixed, as the owner asked): the lamp, sage, sky
 * and rose. Content colours, like the cloths of Placeholder covers — the same in
 * every room; how strongly they wash the page is the room's (`--overlayer-*`
 * on the reader). In production they become tokens (`highlight1–4`).
 */
export const HIGHLIGHTS = [
  { key: 'lamp', name: 'Lamp', color: '#efb768' },
  { key: 'sage', name: 'Sage', color: '#9cc58a' },
  { key: 'sky', name: 'Sky', color: '#8fb8e8' },
  { key: 'rose', name: 'Rose', color: '#ef9fae' },
] as const

const KEY = 'libellus-reader-proto-highlights:'

export function readHighlights<T>(book: string): T[] {
  try {
    return JSON.parse(localStorage.getItem(KEY + book) ?? '[]') as T[]
  } catch {
    return []
  }
}
export function writeHighlights<T>(book: string, list: T[]) {
  try {
    localStorage.setItem(KEY + book, JSON.stringify(list))
  } catch {
    // Storage full or off: the highlights last for this visit.
  }
}
