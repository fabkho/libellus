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
