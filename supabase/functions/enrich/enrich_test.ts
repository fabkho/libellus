/**
 * What the function finds for the acceptance authors of issue #167, from
 * recorded source answers (fixtures/, record_fixtures.ts): Pratchett and
 * Discworld with its sub-series, Le Guin and Earthsea with her standalones,
 * Haldeman and The Forever War with an introducer credited, and a Book nobody
 * knows. Never calls a source: an unrecorded URL fails the test.
 */
import { assert, assertEquals } from '@std/assert'
import { appleGenres, enrichBook, type Payload } from './enrich.ts'
import { createHttp } from './http.ts'
import { AUTHORS_FRESH, LANGUAGES, type ScenarioName, SCENARIOS } from './scenarios.ts'
import { createSources } from './sources.ts'
import { fakeClock, recordedFetch } from './test_support.ts'

async function run(name: ScenarioName, fresh = false): Promise<{ payload: Payload; asked: string[] }> {
  const authorsFresh = fresh || AUTHORS_FRESH.includes(name)
  const recorded = recordedFetch([name])
  const sources = createSources(createHttp({ fetch: recorded.fetch, userAgent: 'test', clock: fakeClock().clock }), LANGUAGES)
  const book = SCENARIOS[name]
  const apple = await appleGenres([book], sources)
  const payload = await enrichBook(book, {
    sources,
    authorFresh: () => Promise.resolve(authorsFresh),
    seriesFresh: () => Promise.resolve(fresh),
  }, apple.get(book.id) ?? [])
  return { payload, asked: recorded.asked.map((a) => a.url) }
}

Deno.test('Pratchett, Small Gods: found by ISBN, Discworld 13, fantasy, the author in full', async () => {
  const { payload } = await run('pratchett-small-gods')
  const book = payload.book!
  assertEquals(book.status, 'enriched')
  assertEquals(book.matchedBy, 'isbn')
  assertEquals(book.sources, ['apple', 'openlibrary', 'wikidata'])
  assertEquals(book.work?.wikidata, 'Q1307144')
  assertEquals(book.work?.openlibrary, 'OL453697W')
  assertEquals(book.work?.titles, { en: 'Small Gods', de: 'Einfach göttlich' })
  assertEquals(book.work?.series?.map((s) => [s.series.name, s.position]), [['Discworld', 13]])
  assertEquals(book.genres[0], { genre: 'fantasy', source: 'wikidata', confidence: 1, rank: 1 })
  assertEquals(book.genres.length <= 3, true)
  assertEquals(new Set(book.genres.map((g) => g.genre)).size, book.genres.length)
  assertEquals(book.authors, [{ position: 1, author: { openlibrary: 'OL25712A', wikidata: 'Q46248', name: 'Terry Pratchett' } }])

  const author = payload.authors.find((a) => a.wikidata === 'Q46248')!
  assertEquals([author.birthDate, author.birthPrecision, author.deathDate], ['1948-04-28', 11, '2015-03-12'])
  assert(author.photoUrl?.startsWith('https://'))
  assertEquals(author.photoCredit?.source, 'commons')
  assertEquals(author.photoCredit?.licence, 'CC BY 3.0')
  assertEquals(author.photoCredit?.artist, 'Luigi Novi')
  assertEquals(author.summaries?.en?.url, 'https://en.wikipedia.org/wiki/Terry_Pratchett')
  assert(author.summaries?.de?.text)

  // The series' neighbours, and Discworld's sub-series with their parent.
  const titles = payload.works.map((w) => w.title)
  assert(titles.includes('Guards! Guards!'))
  const witches = payload.series.find((s) => s.name === 'Witches')
  assertEquals(witches?.parent?.wikidata, 'Q3257270')
  const feetOfClay = payload.works.find((w) => w.wikidata === 'Q2089569')!
  assertEquals(feetOfClay.series?.length, 2)
  // No short stories and no series items among the works.
  assert(payload.works.every((w) => w.kind !== 'short-story'))
})

Deno.test('Le Guin, A Wizard of Earthsea: by its Open Library key; Earthsea 1; standalones on her page', async () => {
  const { payload } = await run('le-guin-earthsea')
  const book = payload.book!
  assertEquals(book.matchedBy, 'openlibrary')
  assertEquals(book.work?.wikidata, 'Q1771810')
  assertEquals(book.work?.series?.map((s) => [s.series.name, s.position]), [['Earthsea series', 1]])
  assertEquals(book.genres.map((g) => g.genre), ['fantasy'])
  const lathe = payload.works.find((w) => w.title === 'The Lathe of Heaven')!
  assertEquals([lathe.kind, lathe.series?.length ?? 0], ['novel', 0])
  assert(lathe.editions?.en?.isbn13)
  const author = payload.authors[0]!
  assertEquals([author.wikidata, author.openlibrary, author.name], ['Q181659', 'OL31353A', 'Ursula K. Le Guin'])
  assertEquals(author.photoCredit?.licence, 'CC BY-SA 2.0')
})

Deno.test('Haldeman, The Forever War: the introducer credited by the edition is not linked', async () => {
  const { payload } = await run('haldeman-forever-war')
  const book = payload.book!
  assertEquals(book.authors.map((a) => [a.position, a.author.name]), [[1, 'Joe Haldeman']])
  assertEquals(book.work?.series?.map((s) => [s.series.name, s.position]), [['The Forever War series', 1]])
  assertEquals(book.genres.map((g) => g.genre), ['sci-fi'])
  const forever = payload.works.filter((w) => w.series?.some((s) => s.series.wikidata === 'Q7734811'))
  assert(forever.some((w) => w.title === 'Forever Peace'))
})

Deno.test('Rowling, a German edition: the work found, a series item without an English or German label named after Open Library\'s', async () => {
  const { payload } = await run('rowling-feuerkelch')
  const book = payload.book!
  assertEquals(book.work?.wikidata, 'Q46751')
  assertEquals(book.work?.series?.map((s) => [s.series.name, s.position]), [['Harry Potter', 4]])
  assertEquals(book.authors.map((a) => [a.position, a.author.wikidata]), [[1, 'Q34660']])
  assert(book.genres.some((g) => g.genre === 'fantasy'))
  assertEquals(payload.authors, [])
})

Deno.test('a Book nobody knows: not found, its first author by name only, no genres', async () => {
  const { payload } = await run('no-data')
  assertEquals(payload.book, {
    id: SCENARIOS['no-data'].id,
    work: null,
    matchedBy: null,
    authors: [{ position: 1, author: { name: 'Ann Zzyzx' } }],
    genres: [],
    mapVersion: 1,
    status: 'not_found',
    sources: [],
    signals: [],
  })
  assertEquals([payload.authors, payload.works, payload.series], [[], [], []])
})

Deno.test('an author and series fetched within 30 days are not asked about again', async () => {
  const { payload, asked } = await run('haldeman-forever-war', true)
  assertEquals(payload.authors, [])
  assertEquals(payload.series, [])
  assert(!asked.some((url) => url.includes('/authors/OL26980A') && url.includes('search')))
  assert(!asked.some((url) => url.includes('wikipedia.org')))
})
