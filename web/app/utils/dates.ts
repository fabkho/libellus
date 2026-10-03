/**
 * The parts of a date as the header's eyebrow shows them ("Friday · 2 Oct").
 * The order and separator are copy (`home.today`), so another language can
 * rearrange them; the parts come from Intl in the app's locale.
 */
export function dateParts(date: Date, locale: string): { weekday: string; day: string; month: string } {
  return {
    weekday: new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date),
    day: new Intl.DateTimeFormat(locale, { day: 'numeric' }).format(date),
    month: new Intl.DateTimeFormat(locale, { month: 'short' }).format(date),
  }
}

/**
 * Days as the member picks them: `YYYY-MM-DD` in the device's time zone, the
 * way reading sessions store them (no time, no zone). "Today" is the member's
 * today, not the server's.
 */
export function isoDay(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM-DD` → that day at local midnight (never shifted by the time zone, as `new Date(day)` would be). */
export function parseDay(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year!, month! - 1, date!)
}

/** The day `count` days after (or before) a day. */
export function addDays(day: string, count: number): string {
  const date = parseDay(day)
  date.setDate(date.getDate() + count)
  return isoDay(date)
}

/** Whole calendar days from one day to a later one (0 for the same day), daylight saving or not. */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [parseDay(from), parseDay(to)].map((d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  return Math.round((b! - a!) / 86_400_000)
}
