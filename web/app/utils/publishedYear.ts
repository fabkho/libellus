import type { Book } from '~/data/books'

/**
 * Two years for one Book: when the *work* was first published, and when the *edition* she holds was printed. The
 * Book page's hero shows the first; the edition line under About says the second, so a 2023 reprint of a 1956 novel
 * reads "1956" at the top and "This edition: … , 2023" under the description.
 *
 * Framework-free on purpose (no Vue, no i18n): the display rules are what the tests pin (tests/publishedYear.test.ts).
 *
 * Where the work's year comes from (`docs/proposals/first-published-data-2026-11-15.md` §1): `works.first_year`, which
 * enrich writes from Wikidata's P577 on the work item, else from Open Library's earliest catalogued edition. That is the
 * *original-language* first publication — a German edition of an English novel shows the English year, which is what the
 * owner asked for.
 */

/**
 * The year the hero should show for a Book: the work's first publication where it can be trusted.
 *
 * | `firstYear`     | edition `year` | shows       | why                                              |
 * | --------------- | -------------- | ----------- | ------------------------------------------------ |
 * | set, <= `year`  | set            | `firstYear` | the reprint case, the whole point                 |
 * | set, >  `year`  | set            | `year`      | G1: impossible — a wrong work link               |
 * | set             | null           | `firstYear` | nothing to contradict it                          |
 * | null            | set            | `year`      | not matched to a work (a third of them): today's   |
 * | null            | null           | `null`      | nothing known, the fact drops out as it does now  |
 *
 * **G1** is the whole guard: a work cannot be first published after an edition of it was printed, so `firstYear > year`
 * means the Book is linked to the wrong work (`Dream Again`: a 1900 edition pointing at a 2020 work, one of six known).
 * The edition's year is always at least true of the copy in hand, so it is what falls back.
 *
 * **G2** — the work's title disagreeing with the Book's — is *not* here: the work's title is not on this payload, and
 * adding it for one guard is not worth it (docs/proposals §2, the PR body). It stays open: *The Unhoneymooners* (a 2020
 * edition of a 1934 work) passes G1 because 1934 is a plausible first publication for a 2020 reprint, and only the titles
 * could say it is the wrong book. A large gap that passes G1 is the feature, not a bug: 1984 and The Time Machine have
 * fifty- and seventy-year-old first publications because they are reprints.
 */
export function firstPublishedYear(book: Pick<Book, 'firstYear' | 'year'>): number | null {
  const first = book.firstYear ?? null
  const edition = book.year ?? null
  if (first === null) return edition
  if (edition !== null && first > edition) return edition
  return first
}

/** The parts of an edition's line that are known: what the "This edition:" sentence is built from. */
export type EditionParts = { publisher: string | null; year: number | null }

/**
 * What the edition line says, or null for no line at all: `{ publisher, year }` with what is unknown left null, so the
 * screen says "This edition: Penguin, 2023", "This edition: 2023" or "This edition: Penguin".
 *
 * The rule: **the line appears only where the hero and this copy disagree**, i.e. when the year the hero shows is not the
 * edition's year. When they agree the hero already says it and a second "2023" under the description is noise — which is
 * exactly the third of the Catalogue with no work matched (`firstYear` null, so the hero's year *is* the edition's) and
 * every Book whose work happens to date from its own edition. A copy with neither a publisher nor a year has nothing to
 * add either way.
 *
 * `firstPublishedYear` is what it compares against, not `firstYear`, so the G1 fallback does not print the suppressed
 * work year a second time: an impossible link leaves both the hero and this line on the edition's year, i.e. no line.
 */
export function editionLine(book: Pick<Book, 'firstYear' | 'year' | 'publisher'>): EditionParts | null {
  const publisher = book.publisher?.trim() || null
  const year = book.year ?? null
  // Nothing known about this copy, or a year the hero already says: either way, nothing to add.
  if (publisher === null && year === null) return null
  if (firstPublishedYear(book) === year) return null
  return { publisher, year }
}
