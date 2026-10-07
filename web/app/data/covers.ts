import { rgbaToThumbHash } from 'thumbhash'
import { appleArtwork, COVER_LARGE } from './apple'
import type { BookSnapshot, CoverColors } from './books'
import { openLibraryCoverAt, openLibraryIsbnCover } from './openLibrary'

/**
 * A Cover is resolved once, when its Book enters the Catalogue (issue #1,
 * Covers): its URL is stored with a thumbhash to show while it loads and its
 * two dominant colours for the light it throws. In v1 that happens on the
 * client, from the image itself (Apple's CDN allows cross-origin reads).
 * The maths is pure and tested; reading the pixels is the platform's job and
 * comes in from outside.
 */

/** An image's pixels, RGBA, at most 100 × 100 (thumbhash's limit). */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array }

export type CoverDescription = { thumbhash: string; colors: CoverColors }

/** Reads a small image's pixels; rejects when it cannot (offline, CORS, a broken image). */
export type LoadPixels = (url: string) => Promise<Pixels>

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const hex = (rgb: readonly number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)
}

/**
 * The two colours a cover is made of: the most common one, and the most common
 * one clearly different from it (or, on a one-colour cover, a darker shade of
 * it). Pixels are pooled into coarse buckets so noise and gradients count as
 * one colour; transparent pixels are ignored.
 */
export function coverColors(pixels: Pixels): CoverColors {
  const buckets = new Map<number, { count: number; sum: [number, number, number] }>()
  const { data } = pixels
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue
    const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] }
    bucket.count++
    bucket.sum[0] += r
    bucket.sum[1] += g
    bucket.sum[2] += b
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()]
    .sort((x, y) => y.count - x.count)
    .map((bucket) => bucket.sum.map((v) => v / bucket.count))
  const dominant = ranked[0] ?? [128, 128, 128]
  const secondary = ranked.find((rgb) => distance(rgb, dominant) > 64) ?? dominant.map((v) => v * 0.6)
  return { dominant: hex(dominant), secondary: hex(secondary) }
}

/** Thumbhash (base64) and colours of a cover's pixels. */
export function describeCover(pixels: Pixels): CoverDescription {
  if (pixels.width > 100 || pixels.height > 100) throw new Error('Thumbhash needs an image of at most 100 × 100')
  const hash = rgbaToThumbHash(pixels.width, pixels.height, pixels.data as Uint8Array)
  return { thumbhash: toBase64(hash), colors: coverColors(pixels) }
}

/**
 * Describes the cover at `url`, or null when its pixels cannot be read in
 * time: the Book is added anyway, with a quiet fill instead of the blur.
 */
export async function resolveCover(
  url: string | null,
  loadPixels: LoadPixels,
  timeoutMs = 4000,
): Promise<CoverDescription | null> {
  if (!url) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  try {
    const pixels = await Promise.race([loadPixels(url), timeout])
    return pixels ? describeCover(pixels) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * The browser's way of reading pixels: a cross-origin image drawn onto a canvas
 * no larger than 100 × 100. Only usable where `document` exists.
 */
export const loadPixelsInBrowser: LoadPixels = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => {
      try {
        const scale = Math.min(1, 100 / Math.max(image.naturalWidth, image.naturalHeight))
        const width = Math.max(1, Math.round(image.naturalWidth * scale))
        const height = Math.max(1, Math.round(image.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('No 2D canvas')
        context.drawImage(image, 0, 0, width, height)
        resolve({ width, height, data: context.getImageData(0, 0, width, height).data })
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => reject(new Error(`Could not load ${url}`))
    image.src = url
  })

// ----------------------------------------------------------- the cover chain

/**
 * An image as it was read: its own size, and its pixels scaled down to at most
 * 100 × 100. Null from a probe means there is no image there (a 404, not an
 * image); a rejection means it could not be told (offline, a timeout).
 */
export type ProbedImage = { width: number; height: number; pixels: Pixels }
export type ProbeImage = (url: string) => Promise<ProbedImage | null>

/** An image smaller than this on its short side is a thumbnail, not a Cover. */
export const MIN_COVER_SIDE = 150

/**
 * True for an image of one flat colour: the blank stand-in a source sends when
 * it has no cover. A real cover, however plain, has its title on it.
 */
export function isPlaceholderImage(pixels: Pixels): boolean {
  const { data } = pixels
  let low = 255
  let high = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < 128) continue
    const luma = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
    low = Math.min(low, luma)
    high = Math.max(high, luma)
  }
  return high - low < 12
}

/** Whether a read image will do as a Cover. */
export function coverVerdict(image: ProbedImage): 'ok' | 'tooSmall' | 'placeholder' {
  if (Math.min(image.width, image.height) < MIN_COVER_SIDE) return 'tooSmall'
  return isPlaceholderImage(image.pixels) ? 'placeholder' : 'ok'
}

/** The cover fields of a Book entering the Catalogue. `coverUrl` null: the Placeholder cover. */
export type ResolvedCover = { coverUrl: string | null; coverThumbhash: string | null; coverColors: CoverColors | null }

/** One place a cover may be: the URL to keep, and a smaller one to read it from. */
export type CoverCandidate = { url: string; probe: string }

export type CoverSources = {
  probe: ProbeImage
  /** Apple's edition with this ISBN-13 (its artwork); null when Apple has none. */
  lookupAppleIsbn?: (isbn13: string) => Promise<{ coverUrl: string | null } | null>
  /** How long the whole chain may take before the Book goes in with what it has. */
  budgetMs?: number
}

const APPLE_CDN = /mzstatic\.com\//
const OPENLIBRARY_COVERS = /^https:\/\/covers\.openlibrary\.org\//

function appleCandidate(url: string): CoverCandidate {
  return {
    url: appleArtwork(url, COVER_LARGE.width, COVER_LARGE.height),
    probe: appleArtwork(url, MIN_COVER_SIDE * 2, MIN_COVER_SIDE * 3),
  }
}

function openLibraryCandidate(url: string): CoverCandidate {
  return { url: openLibraryCoverAt(url, 'L'), probe: openLibraryCoverAt(url, 'M') }
}

const TIMEOUT = Symbol('timeout')

function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMEOUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, ms))
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Resolves a Book's Cover once, when it enters the Catalogue (issue #1,
 * Covers), trying in order until one image will do:
 *
 * 1. its Apple artwork, asked for large;
 * 2. Apple's edition with its ISBN (an OpenLibrary find often has one there);
 * 3. OpenLibrary's cover by the cover id it came with;
 * 4. OpenLibrary's cover by its ISBN.
 *
 * An image that is too small (MIN_COVER_SIDE) or of one flat colour is
 * passed over. The one that will do is kept as a large URL with its thumbhash
 * and colours. If none will do, the Book gets the Placeholder cover (no URL) —
 * unless its own image just could not be read in time, which is no reason to
 * throw it away: then it goes in without thumbhash and colours.
 */
export async function resolveBookCover(book: BookSnapshot, sources: CoverSources): Promise<ResolvedCover> {
  const deadline = Date.now() + (sources.budgetMs ?? 6000)
  const remaining = () => deadline - Date.now()
  const tried = new Set<string>()
  const own = book.coverUrl
  const ownCandidate =
    own && APPLE_CDN.test(own) ? appleCandidate(own) : own && OPENLIBRARY_COVERS.test(own) ? openLibraryCandidate(own) : null
  let unreadOwn: string | null = null

  async function attempt(candidate: CoverCandidate | null): Promise<ResolvedCover | null> {
    if (!candidate || tried.has(candidate.url) || remaining() <= 0) return null
    tried.add(candidate.url)
    let image: ProbedImage | null | typeof TIMEOUT
    try {
      image = await within(sources.probe(candidate.probe), remaining())
    } catch {
      image = TIMEOUT
    }
    if (image === TIMEOUT) {
      if (candidate.url === ownCandidate?.url) unreadOwn = candidate.url
      return null
    }
    if (!image || coverVerdict(image) !== 'ok') return null
    const { thumbhash, colors } = describeCover(image.pixels)
    return { coverUrl: candidate.url, coverThumbhash: thumbhash, coverColors: colors }
  }

  const steps: (() => Promise<CoverCandidate | null>)[] = [
    async () => (own && APPLE_CDN.test(own) ? appleCandidate(own) : null),
    async () => {
      if (!book.isbn13 || !sources.lookupAppleIsbn || remaining() <= 0) return null
      try {
        const found = await within(sources.lookupAppleIsbn(book.isbn13), remaining())
        return found !== TIMEOUT && found?.coverUrl && APPLE_CDN.test(found.coverUrl) ? appleCandidate(found.coverUrl) : null
      } catch {
        return null
      }
    },
    async () => (own && OPENLIBRARY_COVERS.test(own) ? openLibraryCandidate(own) : null),
    async () =>
      book.isbn13
        ? { url: openLibraryIsbnCover(book.isbn13, 'L'), probe: openLibraryIsbnCover(book.isbn13, 'M') }
        : null,
  ]

  for (const step of steps) {
    const resolved = await attempt(await step())
    if (resolved) return resolved
  }
  return { coverUrl: unreadOwn, coverThumbhash: null, coverColors: null }
}

/**
 * The Cover of the member's own edition ("My edition isn't listed"): the image
 * she gave (an https URL) is kept whatever it is, with its thumbhash and
 * colours when it can be read (most hosts do not allow it: then it shows
 * without them). Without one, her edition's ISBN may still have a cover at
 * Apple or OpenLibrary (`resolveBookCover`); else the Placeholder cover.
 */
export async function resolveOwnCover(book: BookSnapshot, sources: CoverSources): Promise<ResolvedCover> {
  const own = book.coverUrl
  if (!own) return resolveBookCover(book, sources)
  try {
    const image = await within(sources.probe(own), sources.budgetMs ?? 6000)
    if (image !== TIMEOUT && image) {
      const { thumbhash, colors } = describeCover(image.pixels)
      return { coverUrl: own, coverThumbhash: thumbhash, coverColors: colors }
    }
  } catch {
    // Not readable from here (no CORS, offline): kept as it is.
  }
  return { coverUrl: own, coverThumbhash: null, coverColors: null }
}

/**
 * The browser's way of reading an image: fetched with CORS (Apple's CDN and
 * OpenLibrary's covers allow it), decoded off the page, drawn no larger than
 * 100 × 100. A bitmap made from a fetched blob never taints the canvas, even
 * when the page showed the same image before without CORS.
 */
export const probeImageInBrowser: ProbeImage = async (url) => {
  const response = await fetch(url, { mode: 'cors' })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Could not load ${url}: ${response.status}`)
  const blob = await response.blob()
  if (!blob.type.startsWith('image/')) return null
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    return null
  }
  const scale = Math.min(1, 100 / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('No 2D canvas')
  context.drawImage(bitmap, 0, 0, width, height)
  const image = { width: bitmap.width, height: bitmap.height, pixels: { width, height, data: context.getImageData(0, 0, width, height).data } }
  bitmap.close()
  return image
}
