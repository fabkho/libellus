import { randomInt } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookSnapshot } from '../app/data/books'
import { createLibrary, type LibraryEntry } from '../app/data/library'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from '../tests/support/stack'

/**
 * Enriched Books for the author and series flows (#167): what the `enrich`
 * edge function stores for Terry Pratchett (Discworld with its City Watch
 * sub-series), Ursula K. Le Guin (Earthsea, two novels, a collection) and Joe
 * Haldeman (The Forever War), recorded from the local stack's real answers and
 * cut down, stored the way the function stores them (`enrich_save` over SQL,
 * the service's side). The member gets a few of the Books in her Library (their
 * titles run-tagged: her edition's title is the one her pages show).
 *
 * Every Wikidata id is invented and every name carries the run tag, so a run
 * never touches what a developer's stack really holds (an author or a series
 * is also matched by name); `forgetEnriched` removes the authors, works and
 * series afterwards, the global teardown the run's Books and members.
 */

const qid = () => `Q9${randomInt(100_000_000, 999_999_999)}`

/** A valid ISBN-13 no Book has (979…). */
export async function unusedIsbn13(): Promise<string> {
  for (;;) {
    const body = `979${String(randomInt(0, 1e9)).padStart(9, '0')}`
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
    const isbn = `${body}${(10 - (sum % 10)) % 10}`
    if (!(await sql('select 1 from public.books where isbn13 = $1', [isbn])).length) return isbn
  }
}

function snapshot(title: string, author: string, year: number): BookSnapshot {
  return {
    title,
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: 300,
    year,
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

export type Enriched = {
  ids: string[]
  authors: { pratchett: string; leGuin: string; haldeman: string }
  names: { pratchett: string; leGuin: string; haldeman: string; cityWatch: string; discworld: string; earthsea: string; foreverWar: string }
  entries: { guards: LibraryEntry; menAtArms: LibraryEntry; feetOfClay: LibraryEntry; wizard: LibraryEntry; dispossessed: LibraryEntry; foreverWar: LibraryEntry }
  /** Mort: in the Catalogue (by its ISBN, its title run-tagged), not in her Library. */
  mort: { isbn13: string; title: string }
}

type Work = { key: string; title: string; titles?: Record<string, string>; year: number; kind: string; series?: { key: string; position: number }[]; isbn13?: string; genres?: string[] }

/**
 * Stores the three authors with their works and series, and gives the member
 * Guards! Guards! and Men at Arms finished, Feet of Clay to read, A Wizard of
 * Earthsea finished, The Dispossessed to read and The Forever War finished.
 */
export async function enrichedLibrary(client: SupabaseClient): Promise<Enriched> {
  const authors = { pratchett: qid(), leGuin: qid(), haldeman: qid() }
  const series = { discworld: qid(), cityWatch: qid(), earthsea: qid(), foreverWar: qid() }
  const names = {
    pratchett: runTitle('Terry Pratchett'),
    leGuin: runTitle('Ursula K. Le Guin'),
    haldeman: runTitle('Joe Haldeman'),
    discworld: runTitle('Discworld'),
    cityWatch: runTitle('City Watch'),
    earthsea: runTitle('Earthsea'),
    foreverWar: runTitle('The Forever War'),
  }
  const mortIsbn = await unusedIsbn13()
  const tombsIsbn = await unusedIsbn13()
  const freeIsbn = await unusedIsbn13()

  const w = (title: string, year: number, kind: string, inSeries: [string, number][] = [], extra: Partial<Work> = {}): Work => ({
    key: qid(),
    title,
    year,
    kind,
    series: inSeries.map(([key, position]) => ({ key, position })),
    ...extra,
  })
  const works = {
    guards: w('Guards! Guards!', 1989, 'novel', [[series.discworld, 8], [series.cityWatch, 1]], { genres: ['fantasy'] }),
    menAtArms: w('Men at Arms', 1993, 'novel', [[series.discworld, 15], [series.cityWatch, 2]], { genres: ['fantasy'] }),
    feetOfClay: w('Feet of Clay', 1996, 'novel', [[series.discworld, 19], [series.cityWatch, 3]], { genres: ['fantasy', 'crime'] }),
    mort: w('Mort', 1987, 'novel', [[series.discworld, 4]], { isbn13: mortIsbn, genres: ['fantasy'] }),
    // Named in English only by Wikidata's default label (`mul`): its own title, with the German beside it.
    smallGods: w('Small Gods', 1992, 'novel', [[series.discworld, 13]], { genres: ['fantasy'], titles: { de: 'Einfach göttlich' } }),
    slip: w('A Slip of the Keyboard', 2014, 'nonfiction', [], { genres: ['essays'] }),
    wizard: w('A Wizard of Earthsea', 1968, 'novel', [[series.earthsea, 1]], { genres: ['fantasy', 'ya'] }),
    tombs: w('The Tombs of Atuan', 1970, 'novel', [[series.earthsea, 2]], { isbn13: tombsIsbn, genres: ['fantasy'] }),
    shore: w('The Farthest Shore', 1972, 'novel', [[series.earthsea, 3]], { genres: ['fantasy'] }),
    dispossessed: w('The Dispossessed', 1974, 'novel', [], { genres: ['sci-fi'] }),
    lathe: w('The Lathe of Heaven', 1971, 'novel', [], { genres: ['sci-fi'] }),
    quarters: w('The Wind’s Twelve Quarters', 1975, 'collection', [], { genres: ['short-stories'] }),
    foreverWar: w('The Forever War', 1974, 'novel', [[series.foreverWar, 1]], { genres: ['sci-fi'] }),
    foreverFree: w('Forever Free', 1999, 'novel', [[series.foreverWar, 2]], { isbn13: freeIsbn, genres: ['sci-fi'] }),
  }
  const ids = [...Object.values(authors), ...Object.values(series), ...Object.values(works).map((x) => x.key)]

  const authorOf = (key: string) => ({ wikidata: key, name: key === authors.pratchett ? names.pratchett : key === authors.leGuin ? names.leGuin : names.haldeman })
  const workPayload = (work: Work, author: string) => ({
    wikidata: work.key,
    title: work.title,
    ...(work.titles ? { titles: work.titles } : {}),
    year: work.year,
    kind: work.kind,
    genres: work.genres ?? [],
    authors: [authorOf(author)],
    series: (work.series ?? []).map((s) => ({ series: { wikidata: s.key }, position: s.position, source: 'wikidata' })),
    ...(work.isbn13 ? { editions: { en: { title: work.title, isbn13: work.isbn13, openlibrary_edition_key: null, cover_url: null } } } : {}),
  })
  const byAuthor: [string, Work[]][] = [
    [authors.pratchett, [works.guards, works.menAtArms, works.feetOfClay, works.mort, works.smallGods, works.slip]],
    [authors.leGuin, [works.wizard, works.tombs, works.shore, works.dispossessed, works.lathe, works.quarters]],
    [authors.haldeman, [works.foreverWar, works.foreverFree]],
  ]

  await sql('select public.enrich_save($1::jsonb)', [{
    authors: [
      {
        ...authorOf(authors.pratchett), fetched: true, worksFetched: true,
        birthDate: '1948-04-28', birthPrecision: 11, deathDate: '2015-03-12', deathPrecision: 11,
        photoUrl: null,
        summaries: { en: { text: 'Sir Terence David John Pratchett was an English author, humorist, and satirist, best known for the Discworld series of 41 comic fantasy novels.', title: 'Terry Pratchett', url: 'https://en.wikipedia.org/wiki/Terry_Pratchett' } },
      },
      {
        ...authorOf(authors.leGuin), fetched: true, worksFetched: true,
        birthDate: '1929-10-21', birthPrecision: 11, deathDate: '2018-01-22', deathPrecision: 11,
        photoUrl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2e/Ursula_Le_Guin.jpg/500px-Ursula_Le_Guin.jpg',
        photoCredit: { source: 'commons', artist: 'Marian Wood Kolisch', licence: 'CC BY-SA 2.0', licenceUrl: 'https://creativecommons.org/licenses/by-sa/2.0', fileUrl: 'https://commons.wikimedia.org/wiki/File:Ursula_Le_Guin.jpg' },
        summaries: { en: { text: 'Ursula Kroeber Le Guin was an American author. She is best known for her works of speculative fiction, including science fiction works set in her Hainish universe, and the Earthsea fantasy series.', title: 'Ursula K. Le Guin', url: 'https://en.wikipedia.org/wiki/Ursula_K._Le_Guin' } },
      },
      {
        ...authorOf(authors.haldeman), fetched: true, worksFetched: true, birthDate: '1943-06-09', birthPrecision: 11, deathDate: null,
        summaries: { en: { text: 'Joe William Haldeman is an American science fiction author.', title: 'Joe Haldeman', url: 'https://en.wikipedia.org/wiki/Joe_Haldeman' } },
      },
    ],
    series: [
      { wikidata: series.discworld, name: names.discworld, fetched: true },
      { wikidata: series.cityWatch, name: names.cityWatch, parent: { wikidata: series.discworld }, fetched: true },
      { wikidata: series.earthsea, name: names.earthsea, fetched: true },
      { wikidata: series.foreverWar, name: names.foreverWar, fetched: true },
    ],
    works: byAuthor.flatMap(([author, list]) => list.map((work) => workPayload(work, author))),
  }])

  // Mort is in the Catalogue (an edition someone added), so "+ Want to read" needs no source.
  await sql('insert into public.books (title, authors, source, apple_id, publisher, isbn13, published_year) values ($1, $2, $3, $4, $5, $6, $7)', [
    runTitle('Mort'), [names.pratchett], 'apple', uniqueAppleId(), TEST_PUBLISHER, mortIsbn, 1987,
  ])

  const library = createLibrary(client)
  const add = async (work: Work, author: string, how: Parameters<ReturnType<typeof createLibrary>['addToLibrary']>[1] = undefined) => {
    const entry = (await library.addToLibrary(snapshot(runTitle(work.title), authorOf(author).name, work.year), how)).data!
    await sql('select public.enrich_save($1::jsonb)', [{
      book: {
        id: entry.book.id, matchedBy: 'title', status: 'enriched', mapVersion: 1, sources: ['wikidata'], signals: [],
        work: workPayload(work, author),
        authors: [{ position: 1, author: authorOf(author) }],
        genres: (work.genres ?? []).map((genre, i) => ({ genre, rank: i + 1, source: 'wikidata', confidence: 1 })),
      },
    }])
    return entry
  }
  const finished = (endedOn: string, rating: number) => ({ status: 'finished' as const, endedOn, rating })
  const entries = {
    guards: await add(works.guards, authors.pratchett, finished('2026-05-01', 18)),
    menAtArms: await add(works.menAtArms, authors.pratchett, finished('2026-06-01', 16)),
    feetOfClay: await add(works.feetOfClay, authors.pratchett),
    wizard: await add(works.wizard, authors.leGuin, finished('2026-07-01', 20)),
    dispossessed: await add(works.dispossessed, authors.leGuin),
    foreverWar: await add(works.foreverWar, authors.haldeman, finished('2026-08-01', 17)),
  }
  return { ids, authors, names, entries, mort: { isbn13: mortIsbn, title: runTitle('Mort') } }
}

/** Removes what `enrichedLibrary` stored besides the run's Books (those go with the global teardown). */
export async function forgetEnriched(ids: string[]) {
  if (!ids.length) return
  await sql('delete from public.works where wikidata_id = any($1)', [ids])
  await sql('delete from public.series where wikidata_id = any($1)', [ids])
  await sql('delete from public.authors where wikidata_id = any($1)', [ids])
}
