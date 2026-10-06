/**
 * How long ago something was, in words of the locale ("5 minutes ago",
 * "yesterday"): minutes up to an hour, hours up to a day, days after that.
 * `now` is a clock reading in milliseconds, so a screen counts against the
 * moment it was loaded and a test against a fixed one.
 */
export function relativeTime(then: Date, now: number, locale: string): string {
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const seconds = Math.max(0, Math.round((now - then.getTime()) / 1000))
  if (seconds < 60) return format.format(0, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return format.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return format.format(-hours, 'hour')
  return format.format(-Math.round(hours / 24), 'day')
}
