import type { AuthorHero, AuthorPage, BookAuthor, LifeDate } from '~/data/enrich/authors'
import type { BookSeriesPlace, StartedSeries } from '~/data/enrich/series'
import type { WorkCard } from '~/data/enrich/works'
import { coverFallbacks, coverSrc, type CoverSize } from './cover'

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
 * The images behind a work's cover at `size`: the one it asks for and what it
 * tries when that fails (OpenLibrary's cover of its edition by ISBN). The work
 * card carries no thumbhash or colours of its own (only her Book has them,
 * `WorkRow`), so these are all a row can do to be ready.
 */
export function workCoverImages(work: Pick<WorkCard, 'coverUrl' | 'edition'>, size: CoverSize): { src: string | null; fallbacks: string[] } {
  const url = workCover(work)
  return { src: coverSrc(url, size), fallbacks: coverFallbacks({ coverUrl: url, isbn13: work.edition?.isbn13 ?? null }, size) }
}

/**
 * The covers of a section's works to ask for before their rows are on screen,
 * once the page that names them has arrived: each work's own image at `size`
 * (the one its row will ask for, so the browser has it already), each once,
 * the first `limit` of them. Not the fallbacks: only a cover that failed needs one.
 */
export function coversToPrefetch(works: readonly Pick<WorkCard, 'coverUrl' | 'edition'>[], size: CoverSize, limit: number): string[] {
  const urls: string[] = []
  for (const work of works) {
    if (urls.length >= limit) break
    const { src } = workCoverImages(work, size)
    if (src && !urls.includes(src)) urls.push(src)
  }
  return urls
}

/** How many series Home's "Next in your series" lists; the rest are in its sheet. */
export const HOME_SERIES = 5

/**
 * Home's "Next in your series": the series she has started (the database's
 * `started_series`: a work she reads or finished, still one open), the latest
 * activity first. One whose next work cannot be opened (no Book of hers, no
 * edition to add) is left out, as there is nothing to do with it. `shown` are
 * the first `limit`; `all` is what the sheet lists, and it only has a way in
 * when there are more than `limit`.
 */
export function startedOnHome(items: readonly StartedSeries[], limit = HOME_SERIES): { shown: StartedSeries[]; all: StartedSeries[]; more: boolean } {
  const all = items.filter((item) => workBookKey(item.next))
  return { shown: all.slice(0, limit), all, more: all.length > limit }
}

/**
 * A series muted (`on`) or unmuted: its item moves from one list to the other, each kept in the
 * database's order (latest activity first, then the name). A series that is not in the list it
 * leaves is left alone (the lists are asked again right after).
 */
export function moveMuted(
  lists: { started: readonly StartedSeries[]; muted: readonly StartedSeries[] },
  seriesId: string,
  on: boolean,
): { started: StartedSeries[]; muted: StartedSeries[] } {
  const from = on ? lists.started : lists.muted
  const to = on ? lists.muted : lists.started
  const item = from.find((s) => s.series.id === seriesId)
  if (!item) return { started: [...lists.started], muted: [...lists.muted] }
  const rest = from.filter((s) => s !== item)
  const into = [...to.filter((s) => s.series.id !== seriesId), item].sort(
    (a, b) => (b.activeOn ?? '').localeCompare(a.activeOn ?? '') || a.series.name.localeCompare(b.series.name),
  )
  return on ? { started: rest, muted: into } : { started: into, muted: rest }
}

/**
 * Where the next work stands in its series, as a row says it: "Book 3 of 10"
 * (a whole-numbered place within the count), "Book 2.5" (a novella, or a place
 * past the count), or none when the series gives no place.
 */
export function nextPlace(item: Pick<StartedSeries, 'series' | 'count' | 'next'>): { n: string; count: number | null } | null {
  const line = seriesLine({ name: item.series.name, position: item.next.position ?? null, count: item.count ?? 0 })
  return line?.position ? { n: line.position, count: line.count } : null
}

/**
 * The works of an author's Standalone and Other groups, newest first (on her page the series keep their
 * reading order, so they do not go through this there; the Book page's teaser sorts every group with
 * it): the latest year first, works without a year last, the title (the locale's collation) between
 * equals so the order never depends on how they came.
 */
export function newestFirst(works: readonly WorkCard[]): WorkCard[] {
  return [...works].sort((a, b) => byYear(a, b) || a.title.localeCompare(b.title))
}

/**
 * Two works by year alone: the later year first, a work without a year after any that has one, and 0
 * between two of the same year (each caller settles that tie itself).
 */
function byYear(a: WorkCard, b: WorkCard): number {
  if (a.year != null && b.year != null && a.year !== b.year) return b.year - a.year
  if ((a.year == null) !== (b.year == null)) return a.year == null ? 1 : -1
  return 0
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

/** The Book a Book page is on, as far as its works can be told from the author's others. */
export type CurrentBook = { bookId: string | null; key: string; isbn13?: string | null; title: string }

/** Whether an author's work is the Book the page is about: her entry of it, its edition's key or ISBN, or the same title. */
export function isCurrentWork(work: WorkCard, current: CurrentBook): boolean {
  if (current.bookId && work.entry?.bookId === current.bookId) return true
  const key = workBookKey(work)
  if (key && (key === current.key || key === current.bookId)) return true
  if (current.isbn13 && work.edition?.isbn13 === current.isbn13) return true
  return sameName(work.title, current.title)
}

/** How many of the author's other works the Book page's "More from the author" shows; "Show all" has the rest. */
export const MORE_FROM_AUTHOR = 3

/** What the Book page's "More from the author" shows. */
export type MoreFromAuthor = {
  author: AuthorHero
  /** All the works her page lists (this Book's included): what "Show all" says. */
  total: number
  /** Up to `limit` others, her latest first, each once; a work that opens a Book page before another of the same year. */
  works: WorkCard[]
  /** More other works than the ones shown: "Show all" has a reason to be there. */
  more: boolean
}

/**
 * The section's content from an author page, or null when there is nothing to
 * show: no page, or none of her other works to offer. What it offers is her
 * latest, so it does not follow her own page's order.
 */
export function moreFromAuthor(page: AuthorPage | null | undefined, current: CurrentBook, limit = MORE_FROM_AUTHOR): MoreFromAuthor | null {
  if (!page) return null
  const all = [...page.series.flatMap((s) => s.works), ...page.standalone, ...page.other]
  const seen = new Set<string>()
  const others: WorkCard[] = []
  for (const work of all) {
    const id = work.workId ?? `${work.title}\n${work.year ?? ''}`
    if (seen.has(id)) continue
    seen.add(id)
    if (!isCurrentWork(work, current)) others.push(work)
  }
  // Her latest first, as her page's Novels and Other are: this is a teaser of what she has written last,
  // not a reading order (the series' own order is her page's). Among the works of one year a work that
  // opens a Book page comes first (the reader can tap through to it), never ahead of a newer work; the
  // title settles the rest, so the order never depends on how her page arrived.
  const works = [...others]
    .sort(
      (a, b) =>
        byYear(a, b) ||
        (workBookKey(a) ? 0 : 1) - (workBookKey(b) ? 0 : 1) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, limit)
  if (!works.length) return null
  return { author: page.author, total: seen.size, works, more: others.length > works.length }
}
