// Design round #65 — the stub world the three Update progress prototypes share.
// Prototype code: nothing in production imports it. Three books being read, as
// the owner's Home would show them: a print book with a page count, one
// without, and an ebook whose reader counts its own pages (#60, a custom
// total). Each direction gets its own copy of the state, so trying one never
// changes another; a reload (or Reset in the proto bar) starts over.
import { reactive } from 'vue'
import type { CoverColors } from '~/data/books'

export type ProtoBook = {
  key: string
  title: string
  authors: string[]
  year: number
  publisher: string
  /** The edition's page count, null when the source had none. */
  pageCount: number | null
  format: 'print' | 'ebook'
  coverUrl: string
  coverThumbhash: string
  coverColors: CoverColors
  description: string
}

/** One day's reading, as Direction C logs it (and A/B remember the last one). */
export type ProtoDay = { day: string; from: number; to: number }

export type ProtoRead = {
  book: ProtoBook
  startedOn: string
  /** Where the member is: a page when there is a total, else a percent. */
  page: number | null
  percent: number | null
  /** The member's own total for this read (#60), over the edition's. */
  total: number | null
  /** Progress by day, oldest first; `from`/`to` in the read's unit. */
  log: ProtoDay[]
  finished: boolean
  rating: number | null
}

export type Direction = 'a' | 'b' | 'c' | 'd'

// --------------------------------------------------------------------- days

export function isoDay(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function daysAgo(n: number): string {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return isoDay(date)
}

export function dayIndex(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  const then = new Date(y!, m! - 1, d!)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return Math.round((now.getTime() - then.getTime()) / 86_400_000)
}

const WEEKDAY = new Intl.DateTimeFormat('en', { weekday: 'short' })
const DAY_MONTH = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' })
export function dayWords(day: string): string {
  const ago = dayIndex(day)
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  if (ago === 0) return 'Today'
  if (ago === 1) return 'Yesterday'
  if (ago < 7) return WEEKDAY.format(date)
  return DAY_MONTH.format(date)
}
export function dayMonth(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  return DAY_MONTH.format(new Date(y!, m! - 1, d!))
}

// -------------------------------------------------------------------- books

const BOOKS: Record<string, ProtoBook> = {
  eden: {
    key: 'eden',
    title: 'East of Eden',
    authors: ['John Steinbeck'],
    year: 2002,
    publisher: 'Penguin Classics',
    pageCount: 608,
    format: 'print',
    coverUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Publication211/v4/c9/22/af/c922af7c-69d4-7640-f90e-f9994a08813b/9781440631320.d.jpg/600x900bb.jpg',
    coverThumbhash: 'cfgNBQKYh4B4aIiHiIioqNXPfQlY',
    coverColors: { dominant: '#f8f5ea', secondary: '#656a6b' },
    description:
      'In his journal, Nobel Prize winner John Steinbeck called East of Eden "the first book," and indeed it has the primordial power and simplicity of myth. Set in the rich farmland of California\'s Salinas Valley, this sprawling and often brutal novel follows the intertwined destinies of two families.',
  },
  gods: {
    key: 'gods',
    title: 'Small Gods',
    authors: ['Terry Pratchett'],
    year: 2008,
    publisher: 'Transworld',
    pageCount: null,
    format: 'print',
    coverUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Publication112/v4/eb/c6/7f/ebc67f66-8e1e-bcd4-c9d0-a47a143b22e5/9781407034843.jpg/600x900bb.jpg',
    coverThumbhash: 'GugJTRAHh4qHaJi3d3R5OHiAgwc4',
    coverColors: { dominant: '#48351a', secondary: '#886638' },
    description:
      'Just because you can\'t explain it, doesn\'t mean it\'s a miracle. In the beginning was the Word. And the Word was: "Hey, you!" For Brutha the novice, the Great God Om has a very important message.',
  },
  leviathan: {
    key: 'leviathan',
    title: 'Leviathan Wakes',
    authors: ['James S. A. Corey'],
    year: 2011,
    publisher: 'Orbit',
    pageCount: 592,
    format: 'ebook',
    coverUrl:
      'https://is1-ssl.mzstatic.com/image/thumb/Publication124/v4/1d/08/2b/1d082b19-5f04-4f29-c2e8-e43265b4cb25/9780316134675.jpg/600x900bb.jpg',
    coverThumbhash: 'ItcJHQRGlS+Y1nlWlnRYR1WWL6C5',
    coverColors: { dominant: '#fcfcfc', secondary: '#080808' },
    description:
      'Humanity has colonized the solar system — Mars, the Moon, the Asteroid Belt and beyond — but the stars are still out of our reach. Jim Holden is XO of an ice miner making runs from the rings of Saturn to the mining stations of the Belt.',
  },
}

/** A history that ends where the read is, oldest first: pages (or percent) per day, with rest days. */
function history(to: number, perDay: readonly number[]): ProtoDay[] {
  const days: ProtoDay[] = []
  let at = to
  // perDay is newest first; index = days ago (0 is today, usually nothing yet).
  perDay.forEach((amount, ago) => {
    if (!amount) return
    days.unshift({ day: daysAgo(ago), from: at - amount, to: at })
    at -= amount
  })
  return days
}

function fresh(): ProtoRead[] {
  return [
    {
      book: BOOKS.eden!,
      startedOn: daysAgo(11),
      page: 212,
      percent: null,
      total: null,
      log: history(212, [0, 24, 31, 0, 18, 22, 40, 0, 12, 27, 21, 17]),
      finished: false,
      rating: null,
    },
    {
      book: BOOKS.leviathan!,
      startedOn: daysAgo(19),
      page: 1012,
      percent: null,
      // Read on a phone at a large font: the reader says 1,204 pages.
      total: 1204,
      log: history(1012, [0, 66, 0, 48, 71, 59, 0, 0, 83, 52, 64, 0, 58, 45, 61, 77, 39, 54, 66, 49]),
      finished: false,
      rating: null,
    },
    {
      book: BOOKS.gods!,
      startedOn: daysAgo(5),
      page: null,
      percent: 44,
      total: null,
      log: history(44, [0, 9, 12, 0, 15, 8]),
      finished: false,
      rating: null,
    },
  ]
}

const worlds = reactive<Record<Direction, ProtoRead[]>>({ a: fresh(), b: fresh(), c: fresh(), d: fresh() })

export function useProtoReads(direction: Direction) {
  return {
    reads: worlds[direction],
    reset: () => worlds[direction].splice(0, worlds[direction].length, ...fresh()),
  }
}

// -------------------------------------------------------------------- maths

/** The total pages progress counts against: the member's own, else the edition's. */
export function totalOf(read: ProtoRead): number | null {
  return read.total ?? read.book.pageCount
}

export function usesPages(read: ProtoRead): boolean {
  return totalOf(read) !== null
}

/** Where the read is, in its unit (page, or percent without a total). */
export function positionOf(read: ProtoRead): number {
  return usesPages(read) ? (read.page ?? 0) : (read.percent ?? 0)
}

/** The largest position: the total, or 100. */
export function maxOf(read: ProtoRead): number {
  return totalOf(read) ?? 100
}

export function fractionOf(read: ProtoRead, at = positionOf(read)): number {
  return Math.min(Math.max(at / maxOf(read), 0), 1)
}

export function percentOf(read: ProtoRead, at = positionOf(read)): number {
  return Math.round(fractionOf(read, at) * 100)
}

/** Pages (or percent) read per reading day over the last two weeks, rounded; null with too little to go on. */
export function paceOf(read: ProtoRead): number | null {
  const recent = read.log.filter((d) => dayIndex(d.day) < 14)
  if (recent.length < 2) return null
  const read14 = recent.reduce((sum, d) => sum + (d.to - d.from), 0)
  const span = Math.max(1, dayIndex(recent[0]!.day) + 1)
  return Math.max(1, Math.round(read14 / span))
}

/** Days left at the pace, or null. */
export function daysLeftOf(read: ProtoRead): number | null {
  const pace = paceOf(read)
  if (!pace) return null
  return Math.max(1, Math.ceil((maxOf(read) - positionOf(read)) / pace))
}

/** The last day something was read (not today), for "last time". */
export function lastSessionOf(read: ProtoRead): ProtoDay | null {
  const before = read.log.filter((d) => dayIndex(d.day) > 0)
  return before.at(-1) ?? null
}

export function todayOf(read: ProtoRead): ProtoDay | null {
  const last = read.log.at(-1)
  return last && dayIndex(last.day) === 0 ? last : null
}

/** Moves the read to `to` and keeps today's line in the log (merged, as C shows it). */
export function setPosition(read: ProtoRead, to: number) {
  const value = Math.min(Math.max(Math.round(to), 0), maxOf(read))
  const from = positionOf(read)
  if (usesPages(read)) read.page = value
  else read.percent = value
  if (value === from) return
  const today = todayOf(read)
  if (today) {
    today.to = value
    if (today.to <= today.from) read.log.pop()
  } else if (value > from) read.log.push({ day: isoDay(), from, to: value })
}

/** Sets the member's own total (#60); the position follows when it would not fit. */
export function setTotal(read: ProtoRead, total: number | null) {
  const before = totalOf(read)
  const fraction = fractionOf(read)
  read.total = total && total !== read.book.pageCount ? total : null
  const after = totalOf(read)
  if (before === null && after !== null) {
    // A percent book gains pages: carry the place over.
    read.page = Math.round(fraction * after)
    read.percent = null
    read.log = read.log.map((d) => ({ ...d, from: Math.round((d.from / 100) * after), to: Math.round((d.to / 100) * after) }))
  } else if (before !== null && after !== null && before !== after) {
    read.page = Math.round(fraction * after)
    read.log = read.log.map((d) => ({ ...d, from: Math.round((d.from / before) * after), to: Math.round((d.to / before) * after) }))
  } else if (before !== null && after === null) {
    // Back to percent (a book without a page count).
    read.percent = Math.round(fraction * 100)
    read.page = null
    read.log = read.log.map((d) => ({ ...d, from: Math.round((d.from / before) * 100), to: Math.round((d.to / before) * 100) }))
  }
}

// -------------------------------------------------------------------- words

const NUMBER = new Intl.NumberFormat('en')
export const n = (value: number) => NUMBER.format(value)

/** "p. 212 of 608" / "44 %". */
export function valueWords(read: ProtoRead, at = positionOf(read)): string {
  const total = totalOf(read)
  return total === null ? `${at} %` : `p. ${n(at)} of ${n(total)}`
}

export function leftWords(read: ProtoRead, at = positionOf(read)): string {
  const left = maxOf(read) - at
  if (left <= 0) return 'The end'
  return usesPages(read) ? `${n(left)} pages left` : `${left} % left`
}

export function unitWord(read: ProtoRead, count: number): string {
  return usesPages(read) ? (count === 1 ? 'page' : 'pages') : '%'
}

export function daysWords(days: number): string {
  if (days <= 1) return 'about a day'
  if (days < 14) return `about ${days} days`
  return `about ${Math.round(days / 7)} weeks`
}

// ------------------------------------------------------------------ haptics

/**
 * Haptics from the web. Android Chrome has `navigator.vibrate` (after the page
 * has had a tap: Chrome wants a user activation first). iOS Safari has no
 * vibration API; since iOS 18 a click on a `<input type="checkbox" switch>`
 * plays the system's selection tick, so the discrete taps (a chip, a step)
 * reach iPhones too. Drags only tick on Android.
 */
export type Haptic = 'tick' | 'step' | 'edge' | 'done'
const PATTERNS: Record<Haptic, number | number[]> = { tick: 6, step: 14, edge: [22], done: [14, 70, 28] }
let lastBuzz = 0
let iosSwitch: HTMLLabelElement | null = null

export function haptic(kind: Haptic, { fromClick = false } = {}) {
  if (typeof navigator === 'undefined') return
  const now = performance.now()
  // A fling crosses steps faster than a motor can tell them apart.
  if (kind === 'tick' && now - lastBuzz < 32) return
  lastBuzz = now
  if (typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate(PATTERNS[kind])
    } catch {
      /* no activation yet */
    }
    return
  }
  if (fromClick) iosTick()
}

function iosTick() {
  if (!iosSwitch) {
    iosSwitch = document.createElement('label')
    iosSwitch.ariaHidden = 'true'
    iosSwitch.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('switch', '')
    input.tabIndex = -1
    iosSwitch.append(input)
    document.body.append(iosSwitch)
  }
  iosSwitch.click()
}

export function hapticsAvailable(): 'vibrate' | 'ios-switch' | 'none' {
  if (typeof navigator === 'undefined') return 'none'
  if (typeof navigator.vibrate === 'function') return 'vibrate'
  return /iPhone|iPad/.test(navigator.userAgent) ? 'ios-switch' : 'none'
}

// ------------------------------------------------------------------- holding

/** Press-and-hold repeat for a − / + button: once, then faster and faster. */
export function useHoldRepeat(step: (times: number) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let count = 0
  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
    count = 0
  }
  function start(event: PointerEvent) {
    if (event.button !== 0) return
    stop()
    step(1)
    const go = () => {
      count++
      step(count > 20 ? 10 : count > 8 ? 5 : 1)
      timer = setTimeout(go, count > 4 ? 60 : 110)
    }
    timer = setTimeout(go, 380)
  }
  return { start, stop }
}
