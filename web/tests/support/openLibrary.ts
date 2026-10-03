import { readFileSync } from 'node:fs'

/**
 * OpenLibrary's answers, as recorded from its search API on 3 Oct 2026
 * (tests/fixtures/openlibrary), with the reduced field list the app asks for.
 * The search tests and the Playwright flows answer every request to
 * openlibrary.org from here, so no automated test ever calls the live API.
 * Queries without a recording get an empty answer.
 */
const RECORDED_TERMS: Record<string, string> = { piranesi: 'piranesi', 'klara und die sonne': 'klara' }

const fixtures = new URL('../fixtures/openlibrary/', import.meta.url)

function read(name: string): unknown | null {
  try {
    return JSON.parse(readFileSync(new URL(`${name}.json`, fixtures), 'utf8'))
  } catch {
    return null
  }
}

/** The recorded answer to a request to OpenLibrary's search API. */
export function openLibraryAnswer(url: URL): unknown {
  const isbn = url.searchParams.get('isbn')
  const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
  const edition = /^edition_key:(ol\d+m)$/.exec(q)
  const name = isbn
    ? `isbn-${isbn}`
    : edition
      ? `edition-${edition[1]!.toUpperCase()}`
      : `search-${RECORDED_TERMS[q] ?? 'nothing'}`
  return read(name) ?? { numFound: 0, docs: [] }
}
