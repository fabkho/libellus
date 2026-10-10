/**
 * The check against real Open Library answers (recorded once into fixtures/real_books.json: the editions,
 * works and authors the live check read, pruned to the fields it uses). These twelve Books of the demo seed
 * were all failed by the first identity rule (edition key, ISBN-10 or title "disagreements" that are only
 * Open Library's bookkeeping: another edition of the ISBN, a work the edition is not in, an ISBN-10 that is
 * not the ISBN-13's twin, a reprint's title); none may be failed. The planted rows built from the same real
 * records (an ISBN with another Book's title or id, the review's exploits) still are.
 */
import { assertEquals } from '@std/assert'
import { type CheckBook, checkBook } from './check.ts'
import { answer, book, testHttp } from './test_support.ts'

type Recorded = Record<string, unknown>
type Case = { row: Omit<CheckBook, 'id'>; recorded: Recorded }
const cases: Case[] = JSON.parse(await Deno.readTextFile(new URL('./fixtures/real_books.json', import.meta.url)))

/** The recorded answers as routes: a redirect (`/isbn/<isbn>.json` → the edition) answers 302, a failure its status. */
function routes(recorded: Recorded) {
  const out: Record<string, unknown> = {}
  for (const [url, value] of Object.entries(recorded)) {
    const v = value as { __redirect?: string; __status?: number }
    if (v?.__redirect) out[url] = () => new Response(null, { status: 302, headers: { location: v.__redirect! } })
    else if (v?.__status) out[url] = () => answer(v.__status!, { error: 'recorded' })
    else out[url] = value
  }
  return out as Parameters<typeof testHttp>[0]
}

const TITLES = [
  'Brave New World',
  'Dune',
  'Fahrenheit 451',
  'Gardens of the moon',
  'Lonesome Dove',
  'Memoirs of Hadrian',
  'Nineteen Eighty-Four',
  'Queen Amid Ashes',
  'Rebecca',
  'Swan song',
  'The first man in Rome',
  'The Hobbit',
]

Deno.test('the twelve real Books the first rule failed are all found, keys kept', async () => {
  assertEquals([...new Set(cases.map((c) => c.row.title))].sort(), [...TITLES].sort())
  for (const { row, recorded } of cases) {
    const { http } = testHttp(routes(recorded))
    const outcome = await checkBook(http, book(row))
    assertEquals(outcome.status, 'found', `${row.title}: ${JSON.stringify(outcome)}`)
    if (outcome.status === 'found') {
      assertEquals(typeof outcome.result.title, 'string')
    }
  }
})

Deno.test('the same Books, with their titles in the forms a member or a source gives them', async () => {
  for (const { row, recorded } of cases) {
    const variants = [String(row.title).toUpperCase(), `The ${row.title}`, `${row.title}: A Novel`, `${row.title} (Series, #1)`]
    for (const title of variants) {
      const outcome = await checkBook(testHttp(routes(recorded)).http, book({ ...row, title }))
      assertEquals(outcome.status, 'found', `${title}: ${JSON.stringify(outcome)}`)
    }
  }
})

Deno.test('the planted rows built from the real records still fail: a real ISBN under another Book\'s title', async () => {
  const dune = cases.find((c) => c.row.title === 'Dune')!
  const orwell = cases.find((c) => c.row.title === 'Nineteen Eighty-Four')!
  const both = routes({ ...dune.recorded, ...orwell.recorded })
  // Exploit 2: the ISBN of Dune with the edition key and the title of Nineteen Eighty-Four.
  const exploit2 = await checkBook(testHttp(both).http, book({ ...dune.row, title: 'Nineteen Eighty-Four', openlibrary_edition_key: orwell.row.openlibrary_edition_key, openlibrary_work_key: orwell.row.openlibrary_work_key }))
  assertEquals(exploit2, { status: 'mismatch', reason: 'title' })
  // The ISBN of Dune with Dune's own title but the keys of Nineteen Eighty-Four: Dune's data, never Orwell's.
  const keysOnly = await checkBook(testHttp(both).http, book({ ...dune.row, openlibrary_edition_key: orwell.row.openlibrary_edition_key }))
  assertEquals(keysOnly.status === 'found' ? keysOnly.result.title : null, 'Dune')
  // Exploit 1, at Apple: the ISBN of Dune, another Book's id and title.
  const item = { kind: 'ebook', trackId: 4242, trackName: 'Dune', artistName: 'Frank Herbert', description: 'd' }
  const apple = testHttp({ [`https://itunes.apple.com/lookup?isbn=${dune.row.isbn13}&country=us`]: { results: [item] } })
  assertEquals(
    await checkBook(apple.http, book({ title: 'Nineteen Eighty-Four', isbn13: dune.row.isbn13, apple_id: '1111', source: 'apple' })),
    { status: 'mismatch', reason: 'title' },
  )
  // … and with Dune's own title it is Dune, written from Apple's record of the ISBN.
  assertEquals((await checkBook(testHttp({ [`https://itunes.apple.com/lookup?isbn=${dune.row.isbn13}&country=us`]: { results: [item] } }).http, book({ title: 'Dune', isbn13: dune.row.isbn13, apple_id: '1111', source: 'apple' }))).status, 'found')
})
