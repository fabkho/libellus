/**
 * Typographic helpers for direction b: ratings set as vulgar fractions, roman
 * numerals for sessions, day counts. Pure functions, no Vue.
 */

const quarters = ['', '¼', '½', '¾']

/** Quarter stars (1–20) → "3¾", "4¼", "5", "¾". */
export function fractionRating(q: number | null): string {
  if (q == null) return ''
  const whole = Math.floor(q / 4)
  const part = quarters[q % 4]
  return whole === 0 ? part! : `${whole}${part}`
}

/** Quarter stars → words, for captions: "three and three quarters". */
export function ratingWords(q: number): string {
  const words = ['', 'one', 'two', 'three', 'four', 'five']
  const parts = ['', 'a quarter', 'a half', 'three quarters']
  const whole = Math.floor(q / 4)
  const part = q % 4
  if (!part) return words[whole]!
  if (!whole) return parts[part]!
  return `${words[whole]} and ${parts[part]}`
}

export function roman(n: number): string {
  const table: [number, string][] = [
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ]
  let out = ''
  for (const [value, glyph] of table) {
    while (n >= value) {
      out += glyph
      n -= value
    }
  }
  return out
}

export function ordinalWord(n: number): string {
  return ['', 'First', 'Second', 'Third', 'Fourth', 'Fifth'][n] ?? `${n}th`
}

/** Days between two ISO dates, inclusive of the first day ("day 131"). */
export function dayOf(startIso: string, todayIso: string): number {
  const ms = Date.parse(`${todayIso}T12:00:00Z`) - Date.parse(`${startIso}T12:00:00Z`)
  return Math.round(ms / 86_400_000) + 1
}

/** ISO week number of an ISO date. */
export function isoWeek(iso: string): number {
  const date = new Date(`${iso}T12:00:00Z`)
  const day = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - day + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  return 1 + Math.round(((date.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
}

/** "Friday" for an ISO date. */
export function weekday(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`))
}

/** Two-digit index number: 1 → "01". */
export function folio(n: number): string {
  return String(n).padStart(2, '0')
}

export type IconName =
  | 'home'
  | 'library'
  | 'search'
  | 'back'
  | 'plus'
  | 'more'
  | 'close'
  | 'check'
  | 'drag'
  | 'chevron'
  | 'calendar'
  | 'lock'
  | 'pen'
  | 'mail'
  | 'arrow'
  | 'trash'

/** "2 October 2026" — the dateline's long form (the shared helper abbreviates). */
export function fullDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  )
}

/** The first sentence of a description, for a standfirst. */
export function firstSentence(text: string | null): string {
  if (!text) return ''
  const match = text.match(/^.+?[.!?](?=\s|$)/)
  return match ? match[0] : text
}
