import { randomInt, randomUUID } from 'node:crypto'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary } from '../app/data/library'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'

/**
 * A Home that scrolls, for the flows about opening a Book from it and coming back (e2e/book-open.spec.ts):
 * Books being read, Books waiting, and `series` started series whose next work is open ("Next in your
 * series"). The next work of each has an edition in the Catalogue (its ISBN-13 opens it), so the Book
 * page finds it, with its description, after the requests the flow delays.
 */
export type SeededSeries = { series: string; next: string; isbn13: string; description: string }

const key = (suffix: 'W') => `OL${randomInt(1_000_000, 9_999_999)}${suffix}`

function isbn(): string {
  // 978 + nine random digits + the check digit: a well-formed ISBN-13 (`^97[89][0-9]{10}$` is all the app asks).
  const body = `978${randomInt(100_000_000, 999_999_999)}`
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

function snapshot(title: string, authors: string[], pages: number): BookSnapshot {
  const appleId = uniqueAppleId()
  return {
    title: runTitle(title),
    authors,
    isbn13: null,
    isbn10: null,
    pageCount: pages,
    year: 2019,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: 'Seeded for the flows about opening a Book.',
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/Seed/${appleId}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId,
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

export async function seedHome(client: Parameters<typeof createLibrary>[0], { series = 5, reading = 2, wanted = 6 } = {}) {
  const library = createLibrary(client)
  const today = new Date().toISOString().slice(0, 10)
  for (let i = 0; i < reading; i++)
    expectOk(await library.addToLibrary(snapshot(`Reading ${i + 1}`, ['Susanna Clarke'], 300 + i), { status: 'reading', startedOn: today }))
  for (let i = 0; i < wanted; i++) expectOk(await library.addToLibrary(snapshot(`Wanted ${i + 1}`, ['Ursula K. Le Guin'], 200 + i)))

  const seeded: SeededSeries[] = []
  // Series names are unique in the Catalogue, and flows that seed one run side by side.
  const sag = randomUUID().slice(0, 4)
  for (let i = 0; i < series; i++) {
    const name = runTitle(`Saga ${i + 1} ${sag}`)
    const [row] = await sql<{ id: string }>(`insert into public.series (name, source) values ($1, 'openlibrary') returning id`, [name])
    const work = async (title: string, position: number, edition: Record<string, unknown> | null) => {
      const [made] = await sql<{ id: string }>(
        `insert into public.works (openlibrary_key, title, first_year, kind, editions, fetched_at) values ($1, $2, 2019, 'novel', $3::jsonb, now()) returning id`,
        [key('W'), title, JSON.stringify(edition ? { en: edition } : {})],
      )
      await sql(`insert into public.work_series (work_id, series_id, position, source) values ($1, $2, $3, 'openlibrary')`, [made!.id, row!.id, position])
      return made!.id
    }
    // Book 1: finished, which is what starts the series.
    const first = (await library.addToLibrary(snapshot(`Saga ${i + 1} ${sag} One`, ['Tamsyn Muir'], 400), { status: 'finished', endedOn: today })).data!
    const firstWork = await work(first.book.title, 1, null)
    await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'title')`, [first.book.id, firstWork])
    // Book 2: the next, in the Catalogue by its ISBN-13 (its page finds it there) and not in her Library.
    const title = runTitle(`Saga ${i + 1} ${sag} Two`)
    const isbn13 = isbn()
    const description = `The second book of Saga ${i + 1}, which the page reads from the Catalogue. `.repeat(6)
    const cover = `https://is1-ssl.mzstatic.com/image/thumb/Seed/next${i}/600x900bb.jpg`
    const nextWork = await work(title, 2, { title, isbn13, openlibrary_edition_key: null, cover_url: cover })
    const [book] = await sql<{ id: string }>(
      `insert into public.books (title, authors, source, apple_id, isbn13, page_count, published_year, language, publisher, cover_url)
       values ($1, $2, 'apple', $3, $4, 512, 2020, 'en', $5, $6) returning id`,
      [title, ['Tamsyn Muir'], uniqueAppleId(), isbn13, TEST_PUBLISHER, cover],
    )
    // A Catalogue description is the server's to write, once it has checked the Book (a trigger clears one a client writes).
    await sql('update public.books set description = $2, checked_at = now() where id = $1', [book!.id, description])
    await sql(`insert into public.book_works (book_id, work_id, matched_by) values ($1, $2, 'isbn')`, [book!.id, nextWork])
    seeded.push({ series: name, next: title, isbn13, description })
  }
  return seeded
}

function expectOk(result: { error: unknown }) {
  if (result.error) throw new Error(`Seeding failed: ${JSON.stringify(result.error)}`)
}
