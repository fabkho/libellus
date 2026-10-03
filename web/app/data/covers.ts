import { rgbaToThumbHash } from 'thumbhash'
import type { CoverColors } from './books'

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
