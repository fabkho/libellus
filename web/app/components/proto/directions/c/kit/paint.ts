/**
 * Shelf's colour and size maths: spine colours derived from a cover's
 * precomputed palette, spine thickness from page count, a stable "height" per
 * title (real books differ in format), placeholder cloth colours, day counts.
 * Pure functions; the palette toggle tints everything to match the room.
 */
import type { CoverColors } from '../../../data'

export type Palette = 'wood' | 'pastel' | 'ink'

export interface Paint {
  bg: string
  fg: string
  band: string
}

type BookLike = { title: string; coverColors?: CoverColors | null; pageCount?: number | null }

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

function hex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v!))).toString(16).padStart(2, '0')).join('')}`
}

/** `t` = share of `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a)
  const y = rgb(b)
  return hex(x.map((v, i) => v + (y[i]! - v) * t))
}

/** Relative luminance, 0–1. */
export function luminance(color: string): number {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function saturation(color: string): number {
  const [r, g, b] = rgb(color).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

/** Stable small hash of a string. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

const cloth: Record<Palette, string[]> = {
  wood: ['#2f7a6e', '#b9472f', '#3d4f8f', '#d79a2b', '#7a4b6e', '#4f6b3a'],
  pastel: ['#8fcfc0', '#f4a39a', '#a9b8ec', '#f6d27e', '#cfa8e0', '#b5d69a'],
  ink: ['#3f8f81', '#c4573d', '#5568b0', '#d9a441', '#9b6a90', '#6a8a52'],
}

const tint: Record<Palette, { toward: string; amount: number }> = {
  wood: { toward: '#f6eddf', amount: 0 },
  pastel: { toward: '#fff6f4', amount: 0.42 },
  ink: { toward: '#1d2130', amount: 0.12 },
}

const inkDark: Record<Palette, string> = { wood: '#2b1d14', pastel: '#3b2948', ink: '#1d2130' }
const inkLight = '#fffaf2'

/** The colour a book's spine (or placeholder cloth) wears in the current palette. */
export function paint(book: BookLike, palette: Palette = 'wood'): Paint {
  let base: string
  let other: string
  const colors = book.coverColors
  if (colors) {
    // Near-white covers make pale, anonymous spines: wear the cover's second colour instead.
    const pale = luminance(colors.dominant) > 0.78
    const useSecondary = pale && (luminance(colors.secondary) < 0.62 || saturation(colors.secondary) > 0.3)
    base = useSecondary ? colors.secondary : colors.dominant
    other = useSecondary ? colors.dominant : colors.secondary
  } else {
    const swatches = cloth[palette]
    base = swatches[hash(book.title) % swatches.length]!
    other = '#f4e7c8'
  }
  const { toward, amount } = tint[palette]
  const bg = amount ? mix(base, toward, amount) : base
  const fg = luminance(bg) > 0.36 ? inkDark[palette] : inkLight
  const bandSource = amount ? mix(other, toward, amount) : other
  const contrast = Math.abs(luminance(bandSource) - luminance(bg))
  const band = contrast > 0.12 ? bandSource : mix(bg, fg, 0.45)
  return { bg, fg, band }
}

/** Spine thickness in px from the page count (192 pp ≈ 26 px, 928 pp ≈ 50 px). */
export function thickness(pageCount: number | null | undefined, min = 26, max = 50): number {
  const pages = pageCount ?? 300
  const t = Math.max(0, Math.min(1, (pages - 180) / 760))
  return Math.round(min + t * (max - min))
}

/** A book's standing height on the shelf, stable per title. */
export function standing(book: BookLike, base = 168, spread = 34): number {
  const pages = book.pageCount ?? 300
  const bump = pages > 520 ? 8 : 0
  return base + (hash(book.title) % 5) * (spread / 4) - spread / 2 + bump
}

/** Whole days between two ISO dates. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`)
  const b = Date.parse(`${to}T12:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** "17 MAY 2026" for stamps. */
export function stampDate(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(`${iso}T12:00:00Z`)
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase().slice(0, 3)
  return `${day} ${month} ${date.getUTCFullYear()}`
}

/** ["17", "MAY"] for the call-number sticker on a spine. */
export function stickerDate(iso: string | null): [string, string] {
  if (!iso) return ['', '']
  const date = new Date(`${iso}T12:00:00Z`)
  return [
    String(date.getUTCDate()),
    date.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase().slice(0, 3),
  ]
}

function toHsl(color: string): [number, number, number] {
  const [r, g, b] = rgb(color).map((v) => v / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [30, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return hex([f(0) * 255, f(8) * 255, f(4) * 255])
}

const room: Record<Palette, { s: [number, number]; l: number }> = {
  wood: { s: [0.32, 0.55], l: 0.87 },
  pastel: { s: [0.4, 0.7], l: 0.9 },
  ink: { s: [0.18, 0.3], l: 0.24 },
}

/**
 * A soft wash of a book's colour for cards and heroes: the spine's hue, its
 * saturation kept in a friendly band, lightness fixed so the palette's ink
 * always reads on it. Greys fall back to a warm paper.
 */
export function wash(book: BookLike, palette: Palette = 'wood', lightness?: number): string {
  const [h, s] = toHsl(paint(book, 'wood').bg)
  const { s: band, l } = room[palette]
  const sat = s < 0.08 ? band[0] * 0.5 : Math.max(band[0], Math.min(band[1], s))
  return fromHsl(s < 0.08 ? 34 : h, sat, lightness ?? l)
}

/**
 * Splits books into shelf rows: as few rows as fit `max` px each (gaps
 * included), at least `minRows`, books spread evenly so no shelf is crammed
 * while the next stands empty.
 */
export function packRows<T>(items: T[], widthOf: (item: T) => number, max: number, minRows = 1, gap = 2): T[][] {
  const total = items.reduce((sum, item) => sum + widthOf(item) + gap, 0)
  let rows = Math.max(minRows, Math.ceil(total / max))
  rows = Math.min(rows, items.length || 1)
  for (;;) {
    const target = total / rows
    const out: T[][] = [[]]
    let width = 0
    for (const item of items) {
      const w = widthOf(item) + gap
      if (width + w / 2 > target && out.length < rows && out.at(-1)!.length) {
        out.push([])
        width = 0
      }
      out.at(-1)!.push(item)
      width += w
    }
    const widest = Math.max(...out.map((row) => row.reduce((sum, item) => sum + widthOf(item) + gap, 0)))
    if (widest <= max || rows >= items.length) return out
    rows += 1
  }
}
