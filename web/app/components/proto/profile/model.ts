// Design round #78 — the stats the three Profile prototypes show, worked out
// from the stub library (library.ts) the way the database would: every figure
// here has its query in /tmp/libellus-78/COMPARE.md. Prototype code: nothing in
// production imports it. Copy is hard-coded in the proto files; the build moves
// it to en.json under `profile.*`.
import { ref } from 'vue'
import { BOOKS, DAYS, OVERRIDES, SESSIONS, TODAY, WANT, type StubBook, type StubDay, type StubSession } from './library'

export { TODAY }
export type { StubBook }
export type Direction = 'a' | 'b' | 'c'
export type Year = number | 'all'

export const MEMBER = { name: 'Fabian', email: 'fabian@libellus.local', initials: 'FK' }

// ------------------------------------------------------------------- days

export function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function addDays(day: string, n: number): string {
  const date = parseDay(day)
  date.setDate(date.getDate() + n)
  return isoDay(date)
}
/** Whole days from `a` to `b` (b − a). */
export function daysFrom(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000)
}
export const THIS_YEAR = Number(TODAY.slice(0, 4))

const fmt = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', options)
const DAY_MONTH = fmt({ day: 'numeric', month: 'short' })
const MONTH = fmt({ month: 'long' })
const MONTH_SHORT = fmt({ month: 'short' })
const MONTH_YEAR = fmt({ month: 'long', year: 'numeric' })
const WEEKDAY = fmt({ weekday: 'narrow' })
// en-GB says "Sept"; the app says "Sep".
const sep = (text: string) => text.replace('Sept', 'Sep')
export const dayMonth = (day: string) => sep(DAY_MONTH.format(parseDay(day)))
export const monthName = (month: number) => MONTH.format(new Date(2026, month, 1))
export const monthShort = (month: number) => sep(MONTH_SHORT.format(new Date(2026, month, 1)))
export const monthLetter = (month: number) => monthShort(month).slice(0, 1)
export const monthYear = (day: string) => MONTH_YEAR.format(parseDay(day))
export const weekdayLetter = (day: string) => WEEKDAY.format(parseDay(day))

const NUMBER = new Intl.NumberFormat('en-GB')
export const n = (value: number) => NUMBER.format(value)
/** 29,412 → "29.4k" for a tight figure; small numbers as they are. */
export function short(value: number): string {
  if (value < 10_000) return n(value)
  return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`
}
export const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`
/** Quarter stars 1–20 → "4.25" (UiStars' value). */
export const stars = (quarters: number) => (quarters / 4).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')

// ------------------------------------------------------------------ books

const BY_KEY = new Map(BOOKS.map((b) => [b.key, b]))
export const bookOf = (key: string): StubBook => BY_KEY.get(key)!
/** The pages a read counts: the member's own total (#60), else the edition's. */
export const pagesOf = (key: string): number | null => OVERRIDES[key] ?? bookOf(key).pages

export type Read = {
  id: string
  book: StubBook
  started: string | null
  ended: string | null
  outcome: StubSession['outcome']
  rating: number | null
  pages: number | null
  /** Days from start to end, both counted; null without both dates. */
  days: number | null
  /** Which read of the entry this is (2 = read again). */
  nth: number
}

const ALL: Read[] = (() => {
  const seen = new Map<string, number>()
  return [...SESSIONS]
    .sort((a, b) => (a.ended ?? a.started ?? '').localeCompare(b.ended ?? b.started ?? ''))
    .map((s, i) => {
      const nth = (seen.get(s.book) ?? 0) + 1
      seen.set(s.book, nth)
      return {
        id: `${s.book}-${i}`,
        book: bookOf(s.book),
        started: s.started,
        ended: s.ended,
        outcome: s.outcome,
        rating: s.rating,
        pages: pagesOf(s.book),
        days: s.started && s.ended ? daysFrom(s.started, s.ended) + 1 : null,
        nth,
      }
    })
})()

const yearOf = (r: Read) => (r.ended ? Number(r.ended.slice(0, 4)) : null)
const inYear = (year: Year) => (r: Read) => year === 'all' || yearOf(r) === year

/** Finished sessions (re-reads included), newest end first. */
export function finishedIn(year: Year): Read[] {
  return ALL.filter((r) => r.outcome === 'finished' && inYear(year)(r)).reverse()
}
export function abandonedIn(year: Year): Read[] {
  return ALL.filter((r) => r.outcome === 'abandoned' && inYear(year)(r)).reverse()
}
export const currentReads = ALL.filter((r) => r.outcome === null).map((r) => {
  const s = SESSIONS.find((x) => x.book === r.book.key && x.outcome === null)!
  return { ...r, page: s.page ?? null, percent: s.percent ?? null }
})
export const wantToRead = WANT.map((w) => ({ book: bookOf(w.book), added: w.added }))

/** The years with a finished read, newest first. */
export const YEARS = [...new Set(ALL.filter((r) => r.outcome === 'finished').map(yearOf).filter((y): y is number => y !== null))].sort(
  (a, b) => b - a,
)
export const FIRST_DAY = ALL.map((r) => r.started ?? r.ended).filter(Boolean).sort()[0]!

// ------------------------------------------------------------------ stats

export type AuthorCount = { name: string; count: number; rating: number | null; books: StubBook[] }

export type Stats = {
  year: Year
  books: number
  pages: number
  /** Finished reads without any page count: left out of `pages`. */
  pagesMissing: number
  rated: number
  unrated: number
  /** Mean rating in quarters, null with nothing rated. */
  average: number | null
  /** Ratings per whole star, 5 down to 1 (a 4.75 counts as 4). */
  byStar: { star: number; count: number }[]
  fives: Read[]
  /** Finished per month (a year) or per year (all time). */
  months: number[]
  perYear: { year: number; count: number; pages: number }[]
  medianDays: number | null
  fastest: Read | null
  slowest: Read | null
  longest: Read | null
  shortest: Read | null
  rereads: Read[]
  abandoned: Read[]
  authors: AuthorCount[]
  /** The highest-rated read, the latest on a tie. */
  favourite: Read | null
  first: Read | null
  last: Read | null
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

export function statsOf(year: Year): Stats {
  const reads = finishedIn(year)
  const rated = reads.filter((r) => r.rating)
  const timed = reads.filter((r) => r.days !== null)
  const paged = reads.filter((r) => r.pages)
  const byDays = [...timed].sort((a, b) => a.days! - b.days!)
  const byPages = [...paged].sort((a, b) => a.pages! - b.pages!)

  const authors = new Map<string, Read[]>()
  for (const r of reads) {
    const name = r.book.authors[0]!
    authors.set(name, [...(authors.get(name) ?? []), r])
  }
  const authorList = [...authors.entries()]
    .map(([name, rs]) => {
      const rr = rs.filter((r) => r.rating)
      return {
        name,
        count: rs.length,
        rating: rr.length ? rr.reduce((s, r) => s + r.rating!, 0) / rr.length : null,
        books: [...new Map(rs.map((r) => [r.book.key, r.book])).values()],
      }
    })
    .filter((a) => a.count > 1)
    .sort((a, b) => b.count - a.count || (b.rating ?? 0) - (a.rating ?? 0))

  const perYear = YEARS.map((y) => {
    const rs = finishedIn(y)
    return { year: y, count: rs.length, pages: rs.reduce((s, r) => s + (r.pages ?? 0), 0) }
  })
  const months =
    year === 'all'
      ? perYear.map((p) => p.count).reverse()
      : Array.from({ length: 12 }, (_, m) => reads.filter((r) => Number(r.ended!.slice(5, 7)) === m + 1).length)

  return {
    year,
    books: reads.length,
    pages: paged.reduce((s, r) => s + r.pages!, 0),
    pagesMissing: reads.length - paged.length,
    rated: rated.length,
    unrated: reads.length - rated.length,
    average: rated.length ? rated.reduce((s, r) => s + r.rating!, 0) / rated.length : null,
    byStar: [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((r) => Math.max(1, Math.floor(r.rating! / 4)) === star).length })),
    fives: reads.filter((r) => r.rating === 20),
    months,
    perYear,
    medianDays: median(timed.map((r) => r.days!)),
    fastest: byDays[0] ?? null,
    slowest: byDays.at(-1) ?? null,
    longest: byPages.at(-1) ?? null,
    shortest: byPages[0] ?? null,
    rereads: reads.filter((r) => r.nth > 1),
    abandoned: abandonedIn(year),
    authors: authorList,
    favourite: [...rated].sort((a, b) => b.rating! - a.rating! || (b.ended ?? '').localeCompare(a.ended ?? ''))[0] ?? null,
    first: reads.at(-1) ?? null,
    last: reads[0] ?? null,
  }
}

/** Finished so far this year at the same day last year, for a quiet comparison. */
export function sameDayLastYear(): number {
  const cut = `${THIS_YEAR - 1}${TODAY.slice(4)}`
  return finishedIn(THIS_YEAR - 1).filter((r) => r.ended! <= cut).length
}

// ----------------------------------------------------------- reading days

/** A day's pages (percent days count as a day read, with no pages). */
function amountOf(d: StubDay): number {
  return d.unit === 'percent' ? 0 : d.to - d.from
}

export type DayCell = { day: string; pages: number; read: boolean }

/** The last `count` days up to today: what was read on each, every book together. */
export function readingDays(count: number, until = TODAY): DayCell[] {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(until, i - count + 1)
    const rows = DAYS.filter((d) => d.day === day)
    return { day, pages: rows.reduce((s, d) => s + amountOf(d), 0), read: rows.some((d) => d.to > d.from) }
  })
}

export function readingDaysSummary(count = 30) {
  const cells = readingDays(count)
  const read = cells.filter((c) => c.read)
  const pages = cells.reduce((s, c) => s + c.pages, 0)
  const paged = cells.filter((c) => c.pages > 0)
  // The longest run of days in a row, said in the past tense, never as a streak to keep.
  let run = 0
  let best = 0
  for (const c of cells) {
    run = c.read ? run + 1 : 0
    best = Math.max(best, run)
  }
  return {
    cells,
    count,
    read: read.length,
    pages,
    perDay: paged.length ? Math.round(pages / paged.length) : null,
    bestRun: best,
    /** Since the first day logged: the table is new (#74), older reads have none. */
    since: DAYS.map((d) => d.day).sort()[0]!,
  }
}

// ------------------------------------------------------------------ theme

/** The prototypes' theme: the proto bar and the Dark mode rows both flip it. */
export const protoTheme = ref<'light' | 'dark'>('light')
export function applyTheme(value: 'light' | 'dark') {
  protoTheme.value = value
  document.documentElement.dataset.theme = value
}

export function readWords(r: Read): string {
  return r.days === null ? '' : r.days === 1 ? 'in a day' : `in ${r.days} days`
}

// ---------------------------------------------------------- current reads

export type CurrentRead = (typeof currentReads)[number]

/** One read's amounts for the last `count` days (ProgressSpark's input). */
export function amountsFor(key: string, count: number) {
  return Array.from({ length: count }, (_, i) => {
    const day = addDays(TODAY, i - count + 1)
    const row = DAYS.find((d) => d.book === key && d.day === day)
    return { day, amount: row ? row.to - row.from : 0 }
  })
}

/** data/progressDays.ts `paceOf`: the last two weeks, from the first day read. */
export function paceFor(key: string): number | null {
  const recent = amountsFor(key, 14).filter((d) => d.amount > 0)
  if (recent.length < 2) return null
  const total = recent.reduce((s, d) => s + d.amount, 0)
  return Math.max(1, Math.round(total / (daysFrom(recent[0]!.day, TODAY) + 1)))
}

export function positionWords(r: CurrentRead): string {
  return r.percent !== null ? `${r.percent} %` : `p. ${n(r.page ?? 0)} of ${n(r.pages ?? 0)}`
}
export function fractionOf(r: CurrentRead): number {
  return r.percent !== null ? r.percent / 100 : (r.page ?? 0) / (r.pages ?? 1)
}
export function paceWords(r: CurrentRead): string {
  const pace = paceFor(r.book.key)
  if (!pace) return `Since ${dayMonth(r.started!)} · day ${daysFrom(r.started!, TODAY) + 1}`
  const end = r.percent !== null ? 100 : (r.pages ?? 0)
  const at = r.percent ?? r.page ?? 0
  const left = Math.max(1, Math.ceil((end - at) / pace))
  return `${pace}${r.percent !== null ? ' %' : ''} a day · ${left} days`
}

/** A mean rating in quarters → "4.3" (one decimal, in stars). */
export const average = (quarters: number | null) => (quarters ? (quarters / 4).toFixed(1) : '–')
