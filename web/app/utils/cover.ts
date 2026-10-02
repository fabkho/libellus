import { thumbHashToDataURL } from 'thumbhash'
import type { CoverColors } from '../data/books'
import { appleArtwork } from '../data/search'

/**
 * Pure helpers behind the Cover component (components/ui/Cover.vue): the
 * placeholder while an image loads, the cloth of a Placeholder cover, and the
 * light a cover throws into the room. Framework-free, so a native port copies
 * them and tests/cover.test.ts pins them.
 */

/** A cover's two precomputed colours, `#rrggbb`, resolved once with the cover (data/books.ts). */
export type { CoverColors }

/** The six Placeholder-cover cloths (tokens `color.cloth1…6`). */
export const CLOTH_COUNT = 6

/** Which cloth a Placeholder cover gets, 1–6: the same title always gets the same one. */
export function clothOf(title: string): number {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return (hash % CLOTH_COUNT) + 1
}

/** A stored thumbhash (base64) → a tiny PNG data URL to show while the cover loads. */
export function thumbhashDataUrl(hash: string | null | undefined): string | null {
  if (!hash) return null
  try {
    const bytes = Uint8Array.from(atob(hash), (c) => c.charCodeAt(0))
    return thumbHashToDataURL(bytes)
  } catch {
    return null
  }
}

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6 : max === gg ? ((bb - rr) / d + 2) / 6 : ((rr - gg) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const hue = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255)) as Rgb
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(v * 255)) as Rgb
}

/** The two tones of a cover's light, as `r g b` for `rgb(var(--glow-a) / α)`. */
export type Glow = { a: string; b: string }

/** A warm neutral for covers whose colours are not known (yet). */
export const NEUTRAL_GLOW: Glow = { a: '150 130 110', b: '90 80 70' }

/**
 * The light a cover throws into the room. Picks whichever of the two colours
 * carries more colour (a white cover with an indigo figure glows indigo, not
 * grey), then brings both to a mid lightness so they read as light on the dark
 * room and as a tint on paper.
 */
export function glowOf(colors: CoverColors | null | undefined): Glow {
  if (!colors) return NEUTRAL_GLOW
  const tones = [colors.dominant, colors.secondary]
    .map((hex) => {
      const [h, s, l] = rgbToHsl(hexToRgb(hex))
      return { h, s, score: s * (1 - Math.abs(l - 0.5) * 1.5) }
    })
    .sort((x, y) => y.score - x.score)
  const lift = ({ h, s }: { h: number; s: number }) =>
    hslToRgb(h, Math.min(0.68, Math.max(s * 1.5, 0.08)), 0.52).join(' ')
  return { a: lift(tones[0]!), b: lift(tones[1]!) }
}

/** The cover widths of `UiCover`'s sizes, as the image size to ask for (2× for sharp edges, 3:2). */
const COVER_FETCH = { xs: [200, 300], sm: [200, 300], md: [300, 450], lg: [300, 450], xl: [600, 900] } as const

/**
 * The image to load for a cover shown at `size`. Apple's CDN renders any size
 * from the stored large URL, so a list row does not download the book page's
 * image; other sources come as they are.
 */
export function coverSrc(url: string | null | undefined, size: keyof typeof COVER_FETCH): string | null {
  if (!url) return null
  const [width, height] = COVER_FETCH[size]
  return /mzstatic\.com\//.test(url) ? appleArtwork(url, width, height) : url
}
