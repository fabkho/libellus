import { thumbHashToDataURL } from 'thumbhash'

/**
 * A stored thumbhash (base64) → the tiny PNG data URL shown while a cover loads, decoded once.
 *
 * Every cover that mounts asks for its own; the same Book shows on Home, in the Library and on its
 * page, and a Library of 150 mounts 150 of them at once. The decode (base64, DCT, a PNG with its
 * CRC and Adler checksums) is ~0.2 ms at 1x and 29 ms of a Library mount at 4x, so the answer is
 * kept by hash: a small least-recently-used map (a PNG data URL is ~0.4 KB, so 512 are ~200 KB).
 * Framework-free: `utils/cover.ts` re-exports it, a native port has its own.
 */
const CAPACITY = 512
const decoded = new Map<string, string | null>()

export function thumbhashDataUrl(hash: string | null | undefined): string | null {
  if (!hash) return null
  const hit = decoded.get(hash)
  if (hit !== undefined) {
    // Most recently used goes last: a Map iterates in insertion order.
    decoded.delete(hash)
    decoded.set(hash, hit)
    return hit
  }
  let url: string | null
  try {
    url = thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))
  } catch {
    url = null
  }
  decoded.set(hash, url)
  if (decoded.size > CAPACITY) decoded.delete(decoded.keys().next().value!)
  return url
}

/** Forgets every decoded hash (tests). */
export function clearThumbhashCache(): void {
  decoded.clear()
}

/** How many hashes are kept (tests). */
export const thumbhashCacheSize = (): number => decoded.size
