/**
 * The work tests' world: Open Library answering from recordings (fixtures/openlibrary.json, made by
 * record_fixtures.ts from the live Open Library for the rows below; a URL nobody recorded answers an empty search, so
 * no test reaches the network), a Catalogue and a National Library that know nothing.
 */
import type { ImportBook } from '../../../web/app/data/import/rows.ts'
import type { OpenLibrary, UpstreamAnswer } from '../openlibrary/client.ts'

/** A row of a Goodreads file, as data/import/goodreads.ts maps one. */
export function row(fields: Partial<ImportBook> & Pick<ImportBook, 'key' | 'title' | 'authors'>, index = 1): ImportBook {
  return {
    source: 'goodreads',
    sourceId: /^goodreads:(\d+)$/.exec(fields.key)?.[1] ?? null,
    row: index,
    series: null,
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: null,
    originalYear: null,
    binding: null,
    language: null,
    publisher: null,
    shelf: 'read',
    shelves: [],
    status: 'finished',
    session: { startedOn: null, endedOn: '2024-03-09', outcome: 'finished', rating: 16, review: null },
    earlierReads: [],
    extraReads: 0,
    otherKeys: [],
    addedOn: '2024-01-02',
    problems: [],
    ...fields,
  } as ImportBook
}

/** The rows the recordings were made for. */
export const PIRANESI = row({ key: 'goodreads:50202953', title: 'Piranesi', authors: ['Susanna Clarke'], isbn13: '9781635575637', binding: 'Hardcover', language: 'en' })
export const NOBODY = row({ key: 'goodreads:99999999', title: 'A Book Nobody Ever Wrote', authors: ['Nobody Atall'] }, 2)

export const RECORDINGS: Record<string, string> = JSON.parse(Deno.readTextFileSync(new URL('./fixtures/openlibrary.json', import.meta.url)))

/** Open Library from the recordings; an unknown search answers no docs. `fail`: every request fails (unreachable). */
export function recordedOpenLibrary({ fail = false } = {}) {
  const asked: string[] = []
  const openLibrary: OpenLibrary = {
    ask(path, query): Promise<UpstreamAnswer> {
      const url = `https://openlibrary.org${path}${query ? `?${query}` : ''}`
      asked.push(url)
      if (fail) return Promise.reject(new Error('unreachable'))
      const body = RECORDINGS[url] ?? (path.startsWith('/api/books') ? '{}' : JSON.stringify({ numFound: 0, docs: [] }))
      return Promise.resolve({ status: 200, body, contentType: 'application/json', retryAfter: null })
    },
  }
  return { openLibrary, asked }
}

/** The Catalogue as the member sees it, in memory: `search_books` answers nothing (the builder's `abortSignal` is all the search asks of it). */
export const emptyCatalogue = {
  rpc(_name: string, _args: Record<string, unknown>) {
    const answer = Promise.resolve({ data: [], error: null })
    return Object.assign(answer, { abortSignal: () => answer })
  },
}

/** The service-role client's functions: the National Library knows nothing (`invoked`: what it was asked). */
export function functions() {
  const invoked: { name: string; body: Record<string, unknown> }[] = []
  return {
    invoked,
    client: {
      functions: {
        invoke(name: string, options: { body: unknown }) {
          invoked.push({ name, body: options.body as Record<string, unknown> })
          return Promise.resolve({ data: { editions: [], edition: null, status: 'not_found' }, error: null })
        },
      },
    },
  }
}
