import { randomInt } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createAuthors, createBookGenres, createSeries } from '@/data/enrich'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The enrichment data layer (issues #166–#168) against the local stack, as
 * real signed-in members: a Book's genres (computed, hers, reset), its series
 * (the most specific first, her correction by name, "in no series", reset),
 * Home's started series, the author page with her statuses, a Book's linked
 * authors; writes refused offline before anything is sent.
 *
 * What the `enrich` edge function would store is stored the same way here, by
 * `enrich_save` over SQL (the service's side); the function itself is tested
 * with recorded sources in supabase/functions/enrich. Test Books carry the run
 * tag; the works, authors and series get invented Wikidata ids, removed after.
 */

const qid = () => `Q9${randomInt(100_000_000, 999_999_999)}`
const AUTHOR = qid()
const SERIES = qid()
const SUBSERIES = qid()
const WORKS = { one: qid(), two: qid(), three: qid(), essays: qid() }
const invented = [AUTHOR, SERIES, SUBSERIES, ...Object.values(WORKS)]

afterAll(async () => {
  await sql('delete from public.works where wikidata_id = any($1)', [invented])
  await sql('delete from public.series where wikidata_id = any($1)', [invented])
  await sql('delete from public.authors where wikidata_id = any($1)', [invented])
})

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ann Leckie-Test'],
    isbn13: null,
    isbn10: null,
    pageCount: 300,
    year: 2013,
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

const author = { wikidata: AUTHOR, name: 'Ann Leckie-Test' }
const inSeries = (position: number, sub: number | null) => [
  { series: { wikidata: SERIES }, position, source: 'wikidata' },
  ...(sub === null ? [] : [{ series: { wikidata: SUBSERIES }, position: sub, source: 'wikidata' }]),
]

/** What the function would store for a Book: its work in the series, its author, its genres. */
async function enrich(bookId: string, work: string, title: string, series: unknown[], genres: string[]) {
  await sql('select public.enrich_save($1::jsonb)', [{
    authors: [{
      ...author, fetched: true, worksFetched: true, birthDate: '1966-03-02', birthPrecision: 11, deathDate: null,
      photoUrl: 'https://upload.wikimedia.org/ann.jpg', photoCredit: { source: 'commons', licence: 'CC BY-SA 4.0', artist: 'Someone' },
      summaries: { en: { text: 'An American author.', title: 'Ann Leckie', url: 'https://en.wikipedia.org/wiki/Ann_Leckie' } },
    }],
    series: [
      { wikidata: SERIES, name: runTitle('Imperial Radch'), fetched: true },
      { wikidata: SUBSERIES, name: runTitle('Breq'), parent: { wikidata: SERIES }, fetched: true },
    ],
    works: [
      { wikidata: WORKS.three, title: 'Ancillary Mercy', year: 2015, kind: 'novel', authors: [author], series: inSeries(3, 3),
        editions: { en: { title: 'Ancillary Mercy', isbn13: '9780316246682', openlibrary_edition_key: null, cover_url: null } } },
      { wikidata: WORKS.essays, title: 'Essays on Ships', kind: 'nonfiction', authors: [author] },
    ],
    book: {
      id: bookId, matchedBy: 'title', status: 'enriched', mapVersion: 1, sources: ['wikidata'], signals: [],
      work: { wikidata: work, title, kind: 'novel', genres, series },
      authors: [{ position: 1, author }],
      genres: genres.map((genre, i) => ({ genre, rank: i + 1, source: 'wikidata', confidence: 1 })),
    },
  }])
}

/** A member who finished book one and wants book two, both enriched. */
async function reader() {
  const member = await signUpMember()
  const library = createLibrary(member.client)
  const one = (await library.addToLibrary(book('Ancillary Justice'), { status: 'finished', endedOn: '2026-09-01', rating: 18 })).data!
  const two = (await library.addToLibrary(book('Ancillary Sword'))).data!
  await enrich(one.book.id, WORKS.one, 'Ancillary Justice', inSeries(1, 1), ['sci-fi'])
  await enrich(two.book.id, WORKS.two, 'Ancillary Sword', inSeries(2, 2), ['sci-fi', 'thriller'])
  return { member, one, two }
}

describe('a Book\'s genres', () => {
  it('are the computed ones until she chooses her own, which only she sees, until she resets them', async () => {
    const { member, two } = await reader()
    const genres = createBookGenres(member.client)
    expect(await genres.forBook(two.book.id)).toEqual({ data: { genres: ['sci-fi', 'thriller'], overridden: false }, error: null })

    expect(await genres.set(two.id, ['thriller', 'crime', 'thriller'])).toEqual({ data: ['thriller', 'crime'], error: null })
    expect(await genres.forBook(two.book.id)).toEqual({ data: { genres: ['thriller', 'crime'], overridden: true }, error: null })
    const library = (await genres.library()).data!
    expect(library.find((e) => e.entryId === two.id)).toMatchObject({ genres: ['thriller', 'crime'], overridden: true })

    const other = await signUpMember()
    expect((await createBookGenres(other.client).forBook(two.book.id)).data).toEqual({ genres: ['sci-fi', 'thriller'], overridden: false })
    expect((await createBookGenres(other.client).set(two.id, ['crime'])).error).toBe('entry_not_found')

    expect(await genres.reset(two.id)).toEqual({ data: ['sci-fi', 'thriller'], error: null })
  })

  it('refuses more than three or an unknown genre, and anything offline', async () => {
    const { member, two } = await reader()
    const genres = createBookGenres(member.client)
    expect((await genres.set(two.id, ['sci-fi', 'fantasy', 'horror', 'crime'])).error).toBe('invalid')
    expect((await genres.set(two.id, ['space-western' as never])).error).toBe('invalid')
    const offline = createBookGenres(member.client, { online: () => false })
    expect(await offline.set(two.id, ['crime'])).toEqual({ data: null, error: 'offline' })
    expect(await offline.reset(two.id)).toEqual({ data: null, error: 'offline' })
  })
})

describe('series', () => {
  it('a Book\'s series, the most specific first, with its position and its neighbours\' statuses', async () => {
    const { member, one, two } = await reader()
    const info = (await createSeries(member.client).forBook(two.book.id)).data!
    expect(info.overridden).toBe(false)
    expect(info.series.map((s) => [s.name, s.position])).toEqual([[runTitle('Breq'), 2], [runTitle('Imperial Radch'), 2]])
    const breq = info.series[0]!
    expect(breq.parentName).toBe(runTitle('Imperial Radch'))
    expect(breq.count).toBe(3)
    expect(breq.works.map((w) => [w.position, w.entry?.status ?? null])).toEqual([[1, 'finished'], [2, 'want_to_read'], [3, null]])
    expect(breq.works[0]!.entry).toMatchObject({ entryId: one.id, rating: 18 })
    expect(breq.works[2]!.edition?.isbn13).toBe('9780316246682')
  })

  it('started series: the one she finished, its next open work named by the sub-series, with her status of it', async () => {
    const { member } = await reader()
    const started = (await createSeries(member.client).started()).data!
    expect(started.map((s) => [s.series.name, s.finished, s.count, s.activeOn, s.next.title, s.next.position, s.next.entry?.status])).toEqual([
      [runTitle('Breq'), 1, 3, '2026-09-01', runTitle('Ancillary Sword'), 2, 'want_to_read'],
    ])
  })

  it('a series is started by reading its first book, and Want to read alone does not start it', async () => {
    const reading = await signUpMember()
    const library = createLibrary(reading.client)
    const one = (await library.addToLibrary(book('Ancillary Justice'), { status: 'reading', startedOn: '2026-09-05' })).data!
    await enrich(one.book.id, WORKS.one, 'Ancillary Justice', inSeries(1, 1), ['sci-fi'])
    expect((await createSeries(reading.client).started()).data!.map((s) => [s.series.name, s.finished, s.activeOn, s.next.title, s.next.entry?.status ?? null]))
      .toEqual([[runTitle('Breq'), 0, '2026-09-05', 'Ancillary Sword', null]])

    const wanting = await signUpMember()
    const wanted = (await createLibrary(wanting.client).addToLibrary(book('Ancillary Justice'))).data!
    await enrich(wanted.book.id, WORKS.one, 'Ancillary Justice', inSeries(1, 1), ['sci-fi'])
    expect(await createSeries(wanting.client).started()).toEqual({ data: [], error: null })
  })

  it('is hers alone', async () => {
    await reader()
    const other = await signUpMember()
    expect(await createSeries(other.client).started()).toEqual({ data: [], error: null })
  })

  it('she mutes a whole started series, finds it in the muted list and unmutes it; it stays muted when she reads on', async () => {
    const { member, two } = await reader()
    const series = createSeries(member.client)
    const breq = (await series.started()).data![0]!.series.id

    expect(await series.muted()).toEqual({ data: [], error: null })
    expect(await series.mute(breq)).toEqual({ data: true, error: null })
    expect(await series.mute(breq)).toEqual({ data: true, error: null })
    expect(await series.started()).toEqual({ data: [], error: null })
    const muted = (await series.muted()).data!
    expect(muted.map((s) => [s.series.name, s.finished, s.next.title])).toEqual([[runTitle('Breq'), 1, runTitle('Ancillary Sword')]])

    // Reading the next work of it does not unmute it; the muted item moves on.
    await createLibrary(member.client).startReading(two.id, '2026-09-10')
    expect((await series.started()).data).toEqual([])
    expect((await series.muted()).data!.map((s) => s.next.title)).toEqual(['Ancillary Mercy'])

    expect(await series.unmute(breq)).toEqual({ data: true, error: null })
    expect(await series.unmute(breq)).toEqual({ data: true, error: null })
    expect((await series.started()).data!.map((s) => s.series.name)).toEqual([runTitle('Breq')])
    expect(await series.muted()).toEqual({ data: [], error: null })
  })

  it('a mute is hers alone, an unknown series is refused, and offline nothing is sent', async () => {
    const { member } = await reader()
    const breq = (await createSeries(member.client).started()).data![0]!.series.id
    await createSeries(member.client).mute(breq)

    const other = await signUpMember()
    expect(await createSeries(other.client).muted()).toEqual({ data: [], error: null })
    expect((await createSeries(other.client).mute(crypto.randomUUID())).error).toBe('series_not_found')
    expect((await createSeries(other.client).unmute(crypto.randomUUID())).error).toBe('series_not_found')
    await createSeries(other.client).unmute(breq)
    expect((await createSeries(member.client).muted()).data).toHaveLength(1)

    const offline = createSeries(member.client, { online: () => false })
    expect(await offline.mute(breq)).toEqual({ data: null, error: 'offline' })
    expect(await offline.unmute(breq)).toEqual({ data: null, error: 'offline' })
    expect((await createSeries(member.client).muted()).data).toHaveLength(1)
  })

  it('she corrects a series by name, says "in no series", and resets; offline nothing is sent', async () => {
    const { member, two } = await reader()
    const series = createSeries(member.client)
    const named = (await series.set(two.id, { name: runTitle('My Own Series'), position: 2.5 })).data!
    expect([named.overridden, named.series[0]!.name, named.series[0]!.position, named.series[0]!.membership])
      .toEqual([true, runTitle('My Own Series'), 2.5, 'member'])
    expect((await series.clear(two.id)).data).toEqual({ overridden: true, series: [] })
    expect((await series.reset(two.id)).data!.series[0]!.name).toBe(runTitle('Breq'))
    expect((await series.set(two.id, { name: ' ', position: 1 })).error).toBe('invalid')
    expect((await series.set(two.id, { seriesId: crypto.randomUUID(), position: 1 })).error).toBe('series_not_found')
    expect(await createSeries(member.client, { online: () => false }).clear(two.id)).toEqual({ data: null, error: 'offline' })
  })
})

describe('the author page', () => {
  it('has the hero with its credits, the works grouped, her statuses', async () => {
    const { member, one, two } = await reader()
    const authors = createAuthors(member.client)
    expect((await authors.forBook(two.book.id)).data).toEqual([
      { position: 1, name: 'Ann Leckie-Test', authorId: expect.any(String), key: AUTHOR },
    ])
    const linked = { position: 1, name: 'Ann Leckie-Test', authorId: expect.any(String), key: AUTHOR }
    expect((await authors.forBooks([two.book.id, one.book.id, two.book.id, crypto.randomUUID()])).data).toEqual({
      [two.book.id]: [linked],
      [one.book.id]: [linked],
    })
    expect(await authors.forBooks([])).toEqual({ data: {}, error: null })
    const page = (await authors.page(AUTHOR)).data!
    expect(page.author).toMatchObject({
      key: AUTHOR,
      name: 'Ann Leckie-Test',
      born: { date: '1966-03-02', precision: 11 },
      photo: { url: 'https://upload.wikimedia.org/ann.jpg', credit: { licence: 'CC BY-SA 4.0' } },
      summary: { url: 'https://en.wikipedia.org/wiki/Ann_Leckie', language: 'en' },
    })
    expect(page.genres).toContain('sci-fi')
    expect(page.series.map((s) => s.name)).toEqual([runTitle('Breq')])
    expect(page.series[0]!.works.map((w) => [w.position, w.title, w.entry?.status ?? null])).toEqual([
      [1, runTitle('Ancillary Justice'), 'finished'],
      [2, runTitle('Ancillary Sword'), 'want_to_read'],
      [3, 'Ancillary Mercy', null],
    ])
    expect(page.other.map((w) => w.title)).toEqual(['Essays on Ships'])
    expect(page.stale).toBe(false)
    expect(await authors.page('Q1')).toEqual({ data: null, error: null })
    expect(await createAuthors(member.client, { online: () => false }).refresh(AUTHOR)).toEqual({ data: null, error: 'offline' })
  })
})
