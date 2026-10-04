import { thumbHashToDataURL } from 'thumbhash'
import type { CoverColors } from '../data/books'
import { appleArtwork } from '../data/apple'
import { openLibraryCoverAt } from '../data/openLibrary'

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

/** `UiCover`'s sizes. */
export type CoverSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

/**
 * The Apple artwork box each size asks for: about 3× the cover's width (tokens
 * `size.cover.*`: 30, 40, 72, 82, 140 px), so it is sharp at a phone's pixel
 * ratio and no larger (docs/covers.md: 120x180bb is 11 KB, 200x300bb 25 KB).
 * Neighbouring sizes share a box, so one download serves both (a search row
 * and the Add sheet). `xl` is the size a Book's cover is stored at, so the
 * book page shows the very image the Catalogue keeps.
 */
export const APPLE_BOX: Record<CoverSize, readonly [number, number]> = {
  xs: [120, 180],
  sm: [120, 180],
  md: [240, 360],
  lg: [240, 360],
  xl: [600, 900],
}

/** OpenLibrary's size for each: 'M' (180 px wide) up to `md`, 'L' (about 330 px) above. 'S' (38 px) is too small for any. */
export const OPENLIBRARY_SIZE: Record<CoverSize, 'M' | 'L'> = { xs: 'M', sm: 'M', md: 'M', lg: 'L', xl: 'L' }

/**
 * The image to load for a cover shown at `size`. Apple's CDN renders any size
 * from the stored large URL, so a list row does not download the book page's
 * image; OpenLibrary has three sizes; other sources come as they are.
 */
export function coverSrc(url: string | null | undefined, size: CoverSize): string | null {
  if (!url) return null
  const [width, height] = APPLE_BOX[size]
  if (/mzstatic\.com\//.test(url)) return appleArtwork(url, width, height)
  return openLibraryCoverAt(url, OPENLIBRARY_SIZE[size])
}
