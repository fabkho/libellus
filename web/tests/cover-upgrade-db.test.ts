import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createBookImport, type ImportRow, type Lookups } from '@/data/bookImport'
import { emptyCounters, runCoverUpgrade, type CoverUpgradeDeps, type UpgradeList } from '@/data/coverUpgrade'
import { createUpgradeCatalogue } from '@/data/coverUpgradeCatalogue'
import type { ProbeImage } from '@/data/covers'
import { importedEntryIds, makeUpgradeList } from '@/utils/coverUpgradeList'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER } from './support/stack'

/**
 * The cover upgrade against the real Catalogue (issue #366), as signed-in members: the books of an import's own `added` rows
 * are listed, the larger Apple cover replaces the small one through `fill_book_covers`, a book she added herself or that is
 * not hers is never touched, and a second member's import of the same Catalogue Book finds it done. Apple is a stub.
 */

function uniqueIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const OL = (n: number) => `https://covers.openlibrary.org/b/id/${900_000 + n}-L.jpg`
const APPLE = (n: number) => `https://is1-ssl.mzstatic.com/image/thumb/Publication/${n}/600x900bb.jpg`
const PIXELS = { width: 10, height: 10, data: Uint8ClampedArray.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) }

const snapshot = (n: number, isbn13: string): BookSnapshot => ({
  title: runTitle(`Upgrade Book ${n}`),
  authors: ['Mira Okafor'],
  isbn13,
  isbn10: null,
  pageCount: null,
  year: null,
  language: null,
  publisher: TEST_PUBLISHER,
  description: null,
  coverUrl: OL(n),
  coverThumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rg==',
  coverColors: null,
  source: 'openlibrary',
  appleId: null,
  openLibraryEditionKey: null,
  openLibraryWorkKey: null,
})

const rowOf = (key: string, book: BookSnapshot): ImportRow => ({
  key,
  title: book.title,
  authors: book.authors,
  status: 'want_to_read',
  session: null,
  extraReads: 0,
  pageCount: null,
  otherKeys: [],
  addedOn: null,
  book,
})

const nowhere: Lookups['search'] = {
  lookupIsbn: async () => null,
  search: async () => ({ results: [], pending: false, failed: false }),
}

/** Apple, as a stub: the edition of every ISBN it was given; counts its calls. */
function apple(editions: Record<string, BookSnapshot>) {
  const calls = { batches: 0, searches: 0 }
  const primed = new Map<string, BookSnapshot | null>()
  const search: CoverUpgradeDeps['search'] = {
    async primeIsbns(rows) {
      calls.batches++
      for (const row of rows) primed.set(row.isbn13, editions[row.isbn13] ?? null)
      return { failed: false }
    },
    primedApple: (isbn13) => primed.get(isbn13),
    async searchCovers() {
      calls.searches++
      return { results: [], pending: false, failed: false }
    },
  }
  return { calls, search }
}

const probe: ProbeImage = async (url) => (url.includes('mzstatic') ? { width: 600, height: 900, pixels: PIXELS } : { width: 120, height: 180, pixels: PIXELS })

describe('the cover upgrade against the Catalogue', () => {
  it('upgrades only what the import added; a book she added herself, or that another member holds alone, keeps its cover; a second member finds it done', async () => {
    const her = await signUpMember()
    const [one, two, mine] = [uniqueIsbn(), uniqueIsbn(), uniqueIsbn()]
    const books = [snapshot(1, one), snapshot(2, two), snapshot(3, mine)]

    // She adds a book herself first (search, scan, Choose edition: no import row): it is a Catalogue Book with a small cover.
    const addedHerself = await createBookImport(her.client, { lookups: { catalogue: { search: async () => [] }, search: nowhere }, probe: async () => null }).write(
      [rowOf('goodreads:900', books[2]!)],
      { onWritten: () => {} },
    )
    expect(addedHerself.data?.[0]?.outcome).toBe('added')

    // The import: two rows added.
    const importer = createBookImport(her.client, { lookups: { catalogue: { search: async () => [] }, search: nowhere }, probe: async () => null })
    const written = await importer.write([rowOf('goodreads:1', books[0]!), rowOf('goodreads:2', books[1]!)], { onWritten: () => {} })
    expect(written.data?.map((outcome) => outcome.outcome)).toEqual(['added', 'added'])

    const catalogue = createUpgradeCatalogue(her.client)
    // Only the import's own entries are asked for: hers from before never enters the list.
    const rows = await catalogue.rowsForEntries(importedEntryIds(written.data!, new Set()))
    expect(rows?.map((row) => row.isbn13).sort()).toEqual([one, two].sort())
    const list = makeUpgradeList('import-1', rows!)!

    const { calls, search } = apple({ [one]: { ...books[0]!, coverUrl: APPLE(1), source: 'apple' }, [two]: { ...books[1]!, coverUrl: APPLE(2), source: 'apple' }, [mine]: { ...books[2]!, coverUrl: APPLE(3), source: 'apple' } })
    const deps: CoverUpgradeDeps = { search, probe, currentCovers: catalogue.currentCovers, write: catalogue.write, wait: async () => {} }
    expect(await runCoverUpgrade(list, deps)).toEqual({ done: true, paused: false })
    expect(list.rows.map((row) => row.result)).toEqual(['upgraded', 'upgraded'])
    expect(calls).toEqual({ batches: 1, searches: 0 })

    const covers = await sql<{ isbn13: string; cover_url: string; cover_thumbhash: string | null }>('select isbn13, cover_url, cover_thumbhash from public.books where isbn13 = any($1)', [[one, two, mine]])
    const byIsbn = Object.fromEntries(covers.map((row) => [row.isbn13, row.cover_url]))
    expect(byIsbn[one]).toBe(APPLE(1))
    expect(byIsbn[two]).toBe(APPLE(2))
    // The book she added herself was never asked about and keeps its cover.
    expect(byIsbn[mine]).toBe(OL(3))
    expect(covers.find((row) => row.isbn13 === one)!.cover_thumbhash).toBeTruthy()

    // Idempotent: running the worked-off list again asks Apple nothing.
    expect(await runCoverUpgrade(list, deps)).toEqual({ done: true, paused: false })
    expect(calls).toEqual({ batches: 1, searches: 0 })

    // A second member imports the same Catalogue Book later: its cover is Apple's already, nothing is asked, nothing replaced.
    const other = await signUpMember()
    const second = await createBookImport(other.client, { lookups: { catalogue: { search: async () => [] }, search: nowhere }, probe: async () => null }).write(
      [rowOf('goodreads:1', books[0]!)],
      { onWritten: () => {} },
    )
    const otherCatalogue = createUpgradeCatalogue(other.client)
    const none = await otherCatalogue.rowsForEntries(importedEntryIds(second.data!, new Set()))
    expect(none).toEqual([])
    expect(makeUpgradeList('import-2', none!)).toBeNull()
  })

  it('never replaces a cover somebody else changed meanwhile, and never touches a book she does not hold', async () => {
    const her = await signUpMember()
    const stranger = await signUpMember()
    const [held, notHers] = [uniqueIsbn(), uniqueIsbn()]
    const importer = (client: typeof her.client) => createBookImport(client, { lookups: { catalogue: { search: async () => [] }, search: nowhere }, probe: async () => null })
    const mineWritten = await importer(her.client).write([rowOf('goodreads:1', snapshot(11, held))], { onWritten: () => {} })
    await importer(stranger.client).write([rowOf('goodreads:2', snapshot(12, notHers))], { onWritten: () => {} })
    const [{ id: heldId }] = await sql<{ id: string }>('select id from public.books where isbn13 = $1', [held])
    const [{ id: strangerId }] = await sql<{ id: string }>('select id from public.books where isbn13 = $1', [notHers])

    const catalogue = createUpgradeCatalogue(her.client)
    // The cover changed since the list was made (another member's upgrade): the compare-and-swap leaves it.
    await sql('update public.books set cover_url = $1 where id = $2', [APPLE(99), heldId])
    expect(await catalogue.write([{ book_id: heldId, cover_url: APPLE(11), cover_thumbhash: 'h', cover_dominant: null, cover_secondary: null, replaces: OL(11) }])).toBe(true)
    expect((await sql<{ cover_url: string }>('select cover_url from public.books where id = $1', [heldId]))[0]!.cover_url).toBe(APPLE(99))
    // A book she does not hold is not hers to upgrade.
    expect(await catalogue.write([{ book_id: strangerId, cover_url: APPLE(12), cover_thumbhash: 'h', cover_dominant: null, cover_secondary: null, replaces: OL(12) }])).toBe(true)
    expect((await sql<{ cover_url: string }>('select cover_url from public.books where id = $1', [strangerId]))[0]!.cover_url).toBe(OL(12))
    expect(mineWritten.data?.[0]?.outcome).toBe('added')

    // The list reads the Catalogue first: the changed cover is skipped, no Apple call.
    const list: UpgradeList = { id: 'x', at: Date.now(), counters: emptyCounters(), rows: [{ bookId: heldId, isbn13: held, title: 't', authors: ['a'], language: null, pageCount: null, year: null, cover: OL(11) }] }
    const { calls, search } = apple({})
    expect(await runCoverUpgrade(list, { search, probe, currentCovers: catalogue.currentCovers, write: catalogue.write, wait: async () => {} })).toEqual({ done: true, paused: false })
    expect(list.rows[0]!.result).toBe('skipped')
    expect(calls).toEqual({ batches: 0, searches: 0 })
  })
})
