import type { BookAuthor, LifeDate } from '~/data/enrich/authors'
import type { BookSeriesPlace, NextInSeries } from '~/data/enrich/series'
import type { WorkCard } from '~/data/enrich/works'

/**
 * What the author pages, the series line and Home's "Next in your series"
 * (issue #167) show of the enrichment data, as plain rules: framework-free, so
 * a native port copies them and `tests/enrich-present.test.ts` pins them.
 */

/** A life date's year (Wikidata dates may have a year only); negative years are BCE and shown as written. */
export function yearOf(date: LifeDate | undefined): number | null {
  if (!date?.date) return null
  const match = /^(-?\d{1,6})/.exec(date.date)
  return match ? Number(match[1]) : null
}

/** The life dates as the hero shows them: both years, the birth alone (alive), or the death alone. */
export type LifeSpan = { kind: 'span'; born: number; died: number } | { kind: 'born'; born: number } | { kind: 'died'; died: number } | null

export function lifeSpan(born: LifeDate | undefined, died: LifeDate | undefined): LifeSpan {
  const b = yearOf(born)
  const d = yearOf(died)
  if (b !== null && d !== null) return { kind: 'span', born: b, died: d }
  if (b !== null) return { kind: 'born', born: b }
  if (d !== null) return { kind: 'died', died: d }
  return null
}

/** A position as it is read: 2, 2.5, 0.5 (never 2.50). */
export function positionText(position: number | null | undefined): string | null {
  if (position === null || position === undefined || !Number.isFinite(position)) return null
  return String(Math.round(position * 100) / 100)
}

/**
 * The Book page's series line, from the most specific series the Book is in:
 * "Book 2 of 9 · The Expanse" (`of`, a whole-numbered position within the
 * count), "Book 2.5 · The Expanse" (a novella between two, or a count the
 * position is past), or the name alone (the series gives no position).
 */
export type SeriesLine = { name: string; position: string | null; count: number | null }

export function seriesLine(place: Pick<BookSeriesPlace, 'name' | 'position' | 'count'> | undefined): SeriesLine | null {
  if (!place) return null
  const position = positionText(place.position)
  const whole = place.position !== null && Number.isInteger(place.position) && place.position >= 1
  const count = whole && place.count >= (place.position ?? 0) && place.count > 1 ? place.count : null
  return { name: place.name, position, count }
}

/** Where a work opens: her Book's page, else the edition in her language (by ISBN, else Open Library); null when there is none. */
export function workBookKey(work: Pick<WorkCard, 'entry' | 'edition'>): string | null {
  if (work.entry?.bookId) return work.entry.bookId
  const isbn = work.edition?.isbn13
  if (isbn && /^97[89]\d{10}$/.test(isbn)) return `isbn-${isbn}`
  const ol = work.edition?.openlibrary_edition_key
  if (ol && /^OL\d+M$/.test(ol)) return `ol-${ol}`
  return null
}

/** A work's cover: the one the page chose (hers, else in her language), else its edition's. */
export function workCover(work: Pick<WorkCard, 'coverUrl' | 'edition'>): string | null {
  return work.coverUrl ?? work.edition?.cover_url ?? null
}

/**
 * Home's "Next in your series": the next work she has not started. One she is
 * reading already is on Home as a card, so it is left out here; a series whose
 * next work cannot be opened (no Book of hers, no edition to add) too.
 */
export function upNextInSeries(items: readonly NextInSeries[], limit = 3): NextInSeries[] {
  return items.filter((item) => item.next.entry?.status !== 'reading' && item.next.entry?.status !== 'finished' && workBookKey(item.next)).slice(0, limit)
}

/** Names compared the way people write them: case, accents, dots and spacing aside. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      // Letters with a stroke have no accent to drop.
      .replace(/[łđøħ]/g, (c) => ({ ł: 'l', đ: 'd', ø: 'o', ħ: 'h' })[c]!)
      .replace(/[.\s]+/g, ' ')
      .trim()
  return norm(a) === norm(b)
}

/**
 * The Book page's author line, as parts: each name the edition credits, linked
 * to its author page where one of the Book's linked authors has that name.
 * When the edition spells a single author differently ("T. Pratchett") and the
 * Book has one linked author, the name links to that author all the same. The
 * line keeps `formatAuthors`' shape: one name, two with "&", or the first and
 * "et al.".
 */
export type AuthorPart = { text: string; key?: string; separator?: boolean }

export function authorParts(names: readonly string[], linked: readonly BookAuthor[], etAl: string): AuthorPart[] {
  const keyOf = (name: string) => {
    const match = linked.find((a) => sameName(a.name, name))
    if (match) return match.key
    if (names.length === 1 && linked.length === 1) return linked[0]!.key
    return undefined
  }
  const part = (name: string): AuthorPart => {
    const key = keyOf(name)
    return key ? { text: name, key } : { text: name }
  }
  if (!names.length) return linked.length ? [{ text: linked[0]!.name, key: linked[0]!.key }] : []
  if (names.length === 1) return [part(names[0]!)]
  if (names.length === 2) return [part(names[0]!), { text: ' & ', separator: true }, part(names[1]!)]
  return [part(names[0]!), { text: ` ${etAl}`, separator: true }]
}

/** The author a list row's author line opens: the first linked author in credit order, if any. */
export function rowAuthorKey(linked: readonly BookAuthor[] | undefined): string | null {
  if (!linked?.length) return null
  return [...linked].sort((a, b) => a.position - b.position)[0]!.key
}


/** An author's initials for the portrait's ring: the first and the last name ("Ursula K. Le Guin" → "UG"). */
export function authorInitials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (!words.length) return '?'
  const first = [...words[0]!][0]!
  const last = words.length > 1 ? [...words[words.length - 1]!][0]! : ''
  return (first + last).toLocaleUpperCase()
}

/**
 * A position as she types it: "2", "2.5", "2,5" (a comma for the decimal
 * point too), or nothing (a series with no place for it). The database's
 * limits: 0 ≤ p < 10000, two decimals at most. `invalid` for anything else.
 */
export function parsePosition(text: string): number | null | 'invalid' {
  const value = text.trim().replace(',', '.')
  if (!value) return null
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(value)) return 'invalid'
  return Number(value)
}
