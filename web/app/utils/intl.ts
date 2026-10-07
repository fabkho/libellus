/**
 * Intl formatters, built once per locale and options and kept. Building one
 * (locale negotiation, the locale's data) costs far more than formatting with
 * it, and the lists format a date or a figure for every row on every render:
 * a Library of a few hundred Books built a thousand of them per refresh.
 * The output is the same as a fresh formatter's. Framework-free.
 */

const dateFormats = new Map<string, Intl.DateTimeFormat>()
const numberFormats = new Map<string, Intl.NumberFormat>()

function cached<F>(store: Map<string, F>, locale: string, options: object, make: () => F): F {
  const key = `${locale}|${JSON.stringify(options)}`
  let format = store.get(key)
  if (!format) {
    format = make()
    store.set(key, format)
  }
  return format
}

/** `new Intl.DateTimeFormat(locale, options)`, made once. */
export function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cached(dateFormats, locale, options, () => new Intl.DateTimeFormat(locale, options))
}

/** `new Intl.NumberFormat(locale, options)`, made once. */
export function numberFormat(locale: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  return cached(numberFormats, locale, options, () => new Intl.NumberFormat(locale, options))
}
