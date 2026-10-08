import { randomInt } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { addDays, isoDay } from '../app/utils/dates'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'
import { unusedIsbn13 } from './enriched'

/**
 * Series she has started, for Home's "Next in your series" (e2e/home-series.spec.ts, e2e/a11y.spec.ts): each a
 * series of two works, Saga 1 … Saga n. She finished its first work `n` days ago (so Saga 1 is the latest and
 * comes first) and the second is the next open work, in the Catalogue by its ISBN (its edition in English), so
 * "+ Want to read" needs no source. A series she only wants, one she gave up on and one she finished whole are
 * there too when asked: none of them is started, so none is listed. Every id is invented and every title carries
 * the run tag; `forgetEnriched` removes the works and series afterwards (e2e/enriched.ts).
 */

const qid = () => `Q9${randomInt(100_000_000, 999_999_999)}`

function snapshot(title: string): BookSnapshot {
  return {
    title,
    authors: ['Sage Tester'],
    isbn13: null,
    isbn10: null,
    pageCount: 300,
    year: 2001,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

export type StartedFixture = {
  /** Wikidata ids invented, for `forgetEnriched`. */
  ids: string[]
  /** The series' names, latest activity first. */
  names: string[]
  /** The title of the next open work of each, in the same order. */
  nextTitles: string[]
}

export async function startedSeries(client: SupabaseClient, count: number, { notStarted = false }: { notStarted?: boolean } = {}): Promise<StartedFixture> {
  const library = createLibrary(client)
  const ids: string[] = []
  const names: string[] = []
  const nextTitles: string[] = []

  async function series(name: string, positions: number): Promise<{ series: string; works: { id: string; title: string; position: number }[] }> {
    const key = qid()
    ids.push(key)
    const [row] = await sql<{ id: string }>(`insert into public.series (name, wikidata_id, source) values ($1, $2, 'wikidata') returning id`, [name, key])
    const works: { id: string; title: string; position: number }[] = []
    for (let position = 1; position <= positions; position++) {
      const workKey = qid()
      ids.push(workKey)
      const title = runTitle(`${name} Part ${position}`)
      const isbn = await unusedIsbn13()
      const editions = { en: { title, isbn13: isbn, openlibrary_edition_key: null, cover_url: null } }
      const [work] = await sql<{ id: string }>(`insert into public.works (wikidata_id, title, editions) values ($1, $2, $3) returning id`, [workKey, title, editions])
      await sql(`insert into public.work_series (work_id, series_id, position, source) values ($1, $2, $3, 'wikidata')`, [work!.id, row!.id, position])
      works.push({ id: work!.id, title, position })
    }
    return { series: row!.id, works }
  }

  /** Her Book of a work, in her Library with the status; the work's Book in the Catalogue by its ISBN when she has none. */
  async function hers(work: { id: string; title: string }, how: Parameters<typeof library.addToLibrary>[1]) {
    const entry = (await library.addToLibrary(snapshot(work.title), how)).data!
    await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'title')`, [entry.book.id, work.id])
    return entry
  }
  /** The Catalogue's Book for the next open work: an edition she can add. */
  async function catalogued(work: { id: string; title: string }) {
    const [edition] = await sql<{ isbn: string }>(`select editions -> 'en' ->> 'isbn13' as isbn from public.works where id = $1`, [work.id])
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, apple_id, publisher, isbn13, published_year) values ($1, $2, 'apple', $3, $4, $5, 2002) returning id`,
      [work.title, ['Sage Tester'], uniqueAppleId(), TEST_PUBLISHER, edition!.isbn],
    )
    // Enrichment has matched it to its work, so what she adds of it counts for the series.
    await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'isbn')`, [book!.id, work.id])
  }

  for (let n = 1; n <= count; n++) {
    const name = runTitle(`Saga ${n}`)
    const { works } = await series(name, 2)
    await hers(works[0]!, { status: 'finished', endedOn: addDays(isoDay(), -n), rating: 16 })
    await catalogued(works[1]!)
    names.push(name)
    nextTitles.push(works[1]!.title)
  }

  if (notStarted) {
    // Only wanted, or only given up on: neither starts a series. One finished whole is complete.
    const wanted = await series(runTitle('Wanted only'), 2)
    await hers(wanted.works[0]!, undefined)
    await catalogued(wanted.works[1]!)
    const given = await series(runTitle('Given up'), 2)
    const entry = await hers(given.works[0]!, { status: 'reading', startedOn: addDays(isoDay(), -9) })
    await sql(`update public.reading_sessions set ended_on = $2, outcome = 'abandoned' where entry_id = $1 and outcome is null`, [entry.id, addDays(isoDay(), -8)])
    await catalogued(given.works[1]!)
    const whole = await series(runTitle('Whole'), 2)
    await hers(whole.works[0]!, { status: 'finished', endedOn: addDays(isoDay(), -3) })
    await hers(whole.works[1]!, { status: 'finished', endedOn: addDays(isoDay(), -2) })
  }
  return { ids, names, nextTitles }
}
