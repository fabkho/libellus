/**
 * Small pure helpers for direction d: the lamp light a cover casts (from its
 * precomputed `coverColors`, never sampled at runtime), rating and day counts.
 */
import type { CoverColors } from '../../../data'
import { today } from '../../../data'

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

export interface Glow {
  /** The cover's most colourful tone, lifted to lamp brightness: `r g b`. */
  a: string
  /** The other tone, same treatment. */
  b: string
}

/**
 * The light a cover throws into the room. Picks whichever of the two
 * precomputed colours carries more colour (a white cover with an indigo
 * figure glows indigo, not grey), then brings both to a mid lightness so they
 * read as light on near-black.
 */
export function glowOf(colors: CoverColors | null | undefined): Glow | null {
  if (!colors) return null
  const tones = [colors.dominant, colors.secondary]
    .map((hex) => {
      const [h, s, l] = rgbToHsl(hexToRgb(hex))
      return { h, s, l, score: s * (1 - Math.abs(l - 0.5) * 1.5) }
    })
    .sort((x, y) => y.score - x.score)
  const lift = ({ h, s }: { h: number; s: number }) =>
    hslToRgb(h, Math.min(0.68, Math.max(s * 1.5, 0.08)), 0.52).join(' ')
  return { a: lift(tones[0]!), b: lift(tones[1]!) }
}

/** CSS variables for an element lit by a cover. */
export function glowStyle(colors: CoverColors | null | undefined): Record<string, string> {
  const glow = glowOf(colors) ?? { a: '150 130 110', b: '90 80 70' }
  return { '--glow-a': glow.a, '--glow-b': glow.b }
}

/** Quarters (1–20) → "3.75", always two decimals so columns line up. */
export function ratingText(quarters: number | null | undefined): string {
  return quarters == null ? '' : (quarters / 4).toFixed(2)
}

/** Whole days from `from` to `to` (ISO dates), default to today. */
export function daysBetween(from: string | null, to: string | null = today): number {
  if (!from || !to) return 0
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
}

/** Deterministic cloth colours for Placeholder covers, picked by title. */
const cloths = ['#3b2430', '#22303f', '#2c3a2e', '#4a3220', '#30293f', '#4a2624']

export function clothOf(title: string): string {
  let hash = 0
  for (const char of title) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return cloths[hash % cloths.length]!
}

/** The names of direction d's icons (Icon.vue). */
export type IconName =
  | 'home'
  | 'library'
  | 'search'
  | 'back'
  | 'plus'
  | 'more'
  | 'close'
  | 'check'
  | 'grip'
  | 'chevron'
  | 'down'
  | 'calendar'
  | 'lock'
  | 'mail'
  | 'repeat'
  | 'slash'
  | 'stack'
  | 'globe'
  | 'mic'
  | 'shift'
  | 'delete'
  | 'pencil'
  | 'flag'
  | 'arrow'
