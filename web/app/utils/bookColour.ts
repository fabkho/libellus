import { thumbHashToAverageRGBA } from 'thumbhash'
import type { CoverColors } from '../data/books'
import { clothOf } from '#ui/utils/cloth'

/**
 * A Book's one colour on Your shelf (the owner's rule: "take the most common
 * colour from the book cover and colour the spine and the back in it"): the
 * colour its Spine and back are drawn in by Regal (`assets.color`, flat faces),
 * and the slab the shelf's loading pile shows. Framework-free and pure, so a
 * native port copies it and tests/book-colour.test.ts pins it.
 *
 * Where the colour comes from, first that applies:
 * 1. `cover`: the cover's most common colour, stored with it (`books.cover_dominant`,
 *    `coverColors` in data/covers.ts: the biggest bucket of its pixels);
 * 2. `thumbhash`: the average colour of its thumbhash, for a cover stored without colours;
 * 3. `cloth`: no cover (or neither of those): the Placeholder cover's cloth for the
 *    title (`clothOf`, tokens `color.cloth1…6`), the colour the app shows that Book in.
 *
 * Guard rails, so the pile reads as a bookcase and not as noise, and the type
 * printed on it always reads:
 * - saturation at most `MAX_SATURATION` (a neon cover becomes a strong, printable colour);
 * - lightness within `MIN_LIGHTNESS`…`MAX_LIGHTNESS` (white is a pale cloth, black a near-black);
 * - the ink is Regal's ink (`SHELF_INK`) or paper (`SHELF_PAPER`), whichever has the
 *   higher WCAG contrast; when neither reaches `MIN_INK_CONTRAST` (mid greys and mid
 *   tones), the lightness moves out of that middle band, the shorter way, until one does.
 * Hue is never changed: a blue Book stays blue.
 */

/** Regal's ink and paper (its `palette.ts`): the two inks its flat faces print in. */
export const SHELF_INK = '#2c2c2a'
export const SHELF_PAPER = '#f5f2eb'

export const MAX_SATURATION = 0.55
export const MIN_LIGHTNESS = 0.14
export const MAX_LIGHTNESS = 0.84
/** WCAG AA for normal text: the Spine's type is small on a phone. */
export const MIN_INK_CONTRAST = 4.5

/** The Placeholder covers' cloths, tokens `color.cloth1…6` (design/tokens.json), by `clothOf`. */
export const CLOTHS = ['#3b2430', '#22303f', '#2c3a2e', '#4a3220', '#30293f', '#4a2624'] as const

export type BookColourSource = 'cover' | 'thumbhash' | 'cloth'

export type CalmColour = {
  /** The Book's colour, `#rrggbb`, inside the guard rails. */
  colour: string
  /** The ink printed on it: `SHELF_INK` or `SHELF_PAPER`. */
  ink: string
  /** WCAG contrast of the ink on the colour, 1–21 (at least `MIN_INK_CONTRAST`). */
  contrast: number
}

export type BookColour = CalmColour & {
  /** Where the colour came from. */
  source: BookColourSource
  /** The colour before the guard rails. */
  raw: string
}

/** What a Book needs for its colour: the Library's Book has all of it. */
export type ColouredBook = {
  title: string
  coverUrl: string | null
  coverColors: CoverColors | null
  coverThumbhash: string | null
}

type Rgb = [number, number, number]

const HEX = /^#[\da-f]{6}$/i

/** The Book's one colour, from its cover (or its Placeholder's cloth), inside the guard rails. */
export function bookColour(book: ColouredBook): BookColour {
  const { raw, source } = rawColour(book)
  return { ...calmColour(raw), raw, source }
}

function rawColour(book: ColouredBook): { raw: string; source: BookColourSource } {
  if (book.coverUrl) {
    const dominant = book.coverColors?.dominant
    if (dominant && HEX.test(dominant)) return { raw: dominant.toLowerCase(), source: 'cover' }
    const average = thumbhashAverage(book.coverThumbhash)
    if (average) return { raw: average, source: 'thumbhash' }
  }
  return { raw: CLOTHS[clothOf(book.title) - 1]!, source: 'cloth' }
}

/** A thumbhash's average colour, `#rrggbb`; null for none or a broken one. */
export function thumbhashAverage(hash: string | null | undefined): string | null {
  if (!hash) return null
  try {
    const { r, g, b } = thumbHashToAverageRGBA(Uint8Array.from(atob(hash), (char) => char.charCodeAt(0)))
    return toHex([r * 255, g * 255, b * 255])
  } catch {
    return null
  }
}

/**
 * Any colour brought inside the guard rails (saturation, lightness, a readable
 * ink), with its ink. Idempotent: a calm colour stays as it is.
 */
export function calmColour(hex: string): CalmColour {
  const [h, s, l] = rgbToHsl(fromHex(hex))
  const saturation = Math.min(s, MAX_SATURATION)
  const lightness = Math.min(MAX_LIGHTNESS, Math.max(MIN_LIGHTNESS, l))
  const at = (light: number) => hslToRgb(h, saturation, light)

  const calm = toHex(at(lightness))
  const best = readableInk(fromHex(calm))
  if (best.contrast >= MIN_INK_CONTRAST) return { colour: calm, ...best }

  // The middle band: neither ink reads. Lighter until ink reads, or darker until paper does,
  // whichever is the smaller step (searched on lightness, where contrast only grows one way;
  // a hair over the minimum, so rounding to #rrggbb never takes it below).
  const target = MIN_INK_CONTRAST + 0.05
  const lighter = search(lightness, 1, (light) => contrast(at(light), INK) >= target)
  const darker = search(lightness, 0, (light) => contrast(at(light), PAPER) >= target)
  const light = Math.abs(lighter - lightness) <= Math.abs(darker - lightness) ? lighter : darker
  const colour = toHex(at(light))
  return { colour, ...readableInk(fromHex(colour)) }
}

/** The ink that reads best on a colour, by WCAG contrast. */
export function readableInk(rgb: Rgb): { ink: string; contrast: number } {
  const onInk = contrast(rgb, INK)
  const onPaper = contrast(rgb, PAPER)
  return onPaper >= onInk ? { ink: SHELF_PAPER, contrast: round(onPaper) } : { ink: SHELF_INK, contrast: round(onInk) }
}

/** The lightness nearest `from`, towards `to`, at which `ok` holds (`to` if it never does before). */
function search(from: number, to: number, ok: (light: number) => boolean): number {
  if (!ok(to)) return to
  let [bad, good] = [from, to]
  for (let step = 0; step < 24; step++) {
    const middle = (bad + good) / 2
    if (ok(middle)) good = middle
    else bad = middle
  }
  return good
}

const round = (value: number) => Math.round(value * 100) / 100

const INK = fromHex(SHELF_INK)
const PAPER = fromHex(SHELF_PAPER)

function fromHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function toHex(rgb: readonly number[]): string {
  return `#${rgb.map((value) => Math.round(Math.min(255, Math.max(0, value))).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG relative luminance, 0–1. */
function luminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1–21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255]
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6 : max === gg ? ((bb - rr) / d + 2) / 6 : ((rr - gg) / d + 4) / 6
  return [h, s, l]
}

/** HSL to RGB, unrounded (rounded once, in `toHex`), so a calm colour comes back as it went in. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue = (p: number, q: number, t: number) => {
    const tt = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}
