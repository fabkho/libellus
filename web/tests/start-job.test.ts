import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { startJobFromFile } from '@/data/import/startJob'
import { parseExport } from '@/data/import/detect'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The device's whole part of an import, behind one door (data/import/startJob.ts): a real export read, its rows counted and
 * the ones she holds already left out, the `start_import_job` call made with what the server takes, and each refusal the file
 * and the server can answer with — through a client that stands in for the two calls, so no job is started and no lookups are
 * made. The start itself, and the file's own rows against the real function, are `tests/import-job.test.ts` and
 * `tests/import-hardcover-zip.test.ts`; the job's phases are nobody's here (only the Edge Function drives them).
 *
 * The real fixture is Goodreads' own shape (its rows without a title, or on a shelf it does not read, are not books): 7 of
 * them, which the device sends whole to an empty Library.
 */

const BYTES = new Uint8Array(readFileSync(new URL('./fixtures/goodreads/library_export.csv', import.meta.url)))
/** The books that fixture holds (the adapter skips a row with no title, and counts the same Book Id once). */
const BOOKS = 7

const device = () => 'dev-start-job-test'

type Call = { name: string; args: Record<string, unknown> }

/**
 * A client that stands in for the two remote calls the start makes and records them: one page of the member's import keys
 * (`importedKeys`) and `start_import_job`. Everything else is a failure of the test, not of the code. The member's Library,
 * which the title index reads through the Catalogue search, is the real one: the start is handed the real stack as well, so the
 * two halves are what the app meets (see `startWith`).
 */
function fakeClient(options: { importKeys?: Map<string, string>; start?: { data: string | null; error?: { message: string } | null; throw?: boolean } } = {}) {
  const calls: Call[] = []
  const keys = [...(options.importKeys ?? [])]
  const client = {
    from(table: string) {
      calls.push({ name: `from:${table}`, args: {} })
      const data = table === 'library_entries' ? keys.slice(0, 1000).map(([import_key, id]) => ({ id, import_key })) : []
      const answer = { data, error: null }
      const query = {
        select: () => query,
        not: () => query,
        order: () => query,
        range: () => query,
        returns: () => Promise.resolve(answer),
        then: (resolve: (value: typeof answer) => unknown) => Promise.resolve(answer).then(resolve),
      }
      return query
    },
    rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args })
      if (name !== 'start_import_job') return Promise.resolve({ data: null, error: { message: 'unexpected' }, status: 400 })
      if (options.start?.throw) return Promise.reject(new Error('network'))
      const data = options.start ? options.start.data : 'job-1'
      return Promise.resolve({ data, error: options.start?.error ?? null, status: options.start?.error ? 500 : 200 })
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

const startCalls = (calls: Call[]) => calls.filter((call) => call.name === 'start_import_job')

/**
 * The start, with the fake in front of the two calls and the real stack (this run's member) behind them: `Library` reads are
 * answered by the member's own Library — the title index needs her real entries — while the import keys and `start_import_job`
 * are the fake's, so no job is started and no key has to be written.
 */
async function startWith(
  member: Awaited<ReturnType<typeof signUpMember>>,
  options: Parameters<typeof fakeClient>[0],
  bytes = BYTES,
  languages: readonly string[] = ['en'],
  zip = false,
) {
  const { client, calls } = fakeClient(options)
  const real = member.client
  // Both reads are of `library_entries`: the import keys (the columns `importedKeys` asks for) are the fake's, the whole
  // Library (a Catalogue search's `ENTRY_COLUMNS`) is her real one.
  const router = {
    from(table: string) {
      const query = real.from(table)
      return {
        select: (columns?: string) => (columns?.includes('import_key') ? client.from(table) : query).select(columns as never),
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => client.rpc(name, args),
  } as unknown as SupabaseClient
  const started = await startJobFromFile(router, bytes, { today: '2026-11-05', zip, device, languages })
  return { started, calls }
}

describe('starting a job from a file, on the device', () => {
  it('reads a real export, counts its rows and sends them, with the day, the device and the languages', async () => {
    const ada = await signUpMember()
    const { started, calls } = await startWith(ada, {}, BYTES, ['en', 'de'])
    expect(started).toEqual({ ok: true, jobId: 'job-1', already: 0, total: BOOKS })

    const [call] = startCalls(calls)
    expect(call!.args).toMatchObject({ p_source: 'goodreads', p_device: 'dev-start-job-test', p_already: 0, p_languages: ['en', 'de'] })
    const rows = call!.args.p_rows as Record<string, unknown>[]
    expect(rows).toHaveLength(BOOKS)
    // Every row is what the server takes: a key of its own, its Collections, its session.
    expect(new Set(rows.map((row) => row.key)).size).toBe(BOOKS)
    for (const row of rows) expect(row).toHaveProperty('collections')
    // A CSV has no zip-only argument: its start is the call it always was.
    expect(call!.args).not.toHaveProperty('p_collection_order')
    expect(call!.args).not.toHaveProperty('p_empty_collections')
  })

  it('leaves out the books she has already, by import key and by title under another edition, and says how many', async () => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    // One entry of the file's own kind: a row of the fixture, as an earlier import of it left it.
    const second = 'goodreads:1002'
    const held = await library.addToLibrary(
      {
        title: runTitle('Held Under Another Edition'),
        authors: ['Someone Else'],
        isbn13: null,
        isbn10: null,
        pageCount: null,
        year: null,
        language: null,
        publisher: TEST_PUBLISHER,
        description: null,
        coverUrl: null,
        coverThumbhash: null,
        coverColors: null,
        source: 'apple',
        appleId: uniqueAppleId(),
        openLibraryEditionKey: null,
        openLibraryWorkKey: null,
      },
      { status: 'want_to_read' },
    )
    expect(held.error).toBeNull()
    // And one she holds under another edition: the fixture's first book, under a title of her own (its work title is hers).
    const keeper = await library.addToLibrary(
      {
        title: runTitle('The Lantern Keeper'),
        authors: ['Mira Okafor'],
        isbn13: null,
        isbn10: null,
        pageCount: null,
        year: null,
        language: null,
        publisher: TEST_PUBLISHER,
        description: null,
        coverUrl: null,
        coverThumbhash: null,
        coverColors: null,
        source: 'apple',
        appleId: uniqueAppleId(),
        openLibraryEditionKey: null,
        openLibraryWorkKey: null,
      },
      { status: 'want_to_read' },
    )
    expect(keeper.error).toBeNull()

    const { started, calls } = await startWith(ada, { importKeys: new Map([[second, held.data!.id]]) })
    // One book behind the file's row, and one she holds under another edition: both kept back.
    expect(started).toEqual({ ok: true, jobId: 'job-1', already: 2, total: BOOKS - 2 })
    const rows = startCalls(calls)[0]!.args.p_rows as Record<string, unknown>[]
    expect(rows.map((row) => row.key)).not.toContain(second)
    expect(rows.map((row) => row.key)).not.toContain('goodreads:1001')
    expect(rows).toHaveLength(BOOKS - 2)
    expect(startCalls(calls)[0]!.args).toMatchObject({ p_already: 2 })
  })

  it('starts no job when every book of the file is in her Library already: nothing new is not a refusal', async () => {
    const ada = await signUpMember()
    // Every row of the fixture, keyed as an earlier import of it left them.
    const keys = parseExport(new TextDecoder().decode(BYTES), '2026-11-05').books.map((book, at) => [book.key, `entry-${at}`] as const)
    const { started, calls } = await startWith(ada, { importKeys: new Map(keys) })
    expect(started).toEqual({ ok: true, jobId: '', already: BOOKS, total: 0 })
    expect(startCalls(calls)).toHaveLength(0)
  })

  it('tells each way the file itself can be refused, with what the message needs', async () => {
    const ada = await signUpMember()
    const start = (bytes: Uint8Array) => startWith(ada, {}, bytes).then(({ started }) => started)
    // No header of any supported app: not a CSV of one, then not a text table at all, then nothing in it.
    expect(await start(new TextEncoder().encode('a,b\n1,2\n'))).toMatchObject({ ok: false, error: 'notSupported' })
    expect(await start(new TextEncoder().encode('a,b\n1,\u00002\n'))).toMatchObject({ ok: false, error: 'notCsv' })
    expect(await start(new TextEncoder().encode('Book Id,Title,Author,ISBN13,Exclusive Shelf'))).toMatchObject({ ok: false, error: 'empty' })
    // A Goodreads header without the columns its rows need: the app and the columns come with the code.
    expect(await start(new TextEncoder().encode('Book Id,Title,Exclusive Shelf\n1,Some Book,read\n'))).toMatchObject({
      ok: false,
      error: 'missingColumns',
      detail: { source: 'goodreads' },
    })
    // A zip is read only with the flag on (the build's `NUXT_PUBLIC_IMPORT_ZIP`); off, it is what it always was, no CSV.
    const zip = zipSync({ 'manifest.json': strToU8('{}') })
    expect(await startWith(ada, {}, zip).then(({ started }) => started)).toMatchObject({ ok: false, error: 'notCsv' })
    // On, its own codes come through: here the manifest is no Hardcover export.
    expect(await startWith(ada, {}, zip, ['en'], true).then(({ started }) => started)).toMatchObject({ ok: false, error: 'zipUnknown' })
  })

  it("tells the server's refusals as they come, and offline when the call never arrives", async () => {
    const ada = await signUpMember()
    const at = async (start: Parameters<typeof fakeClient>[0]['start']) => (await startWith(ada, { start })).started
    for (const code of ['import_too_soon', 'device_import_running', 'import_running', 'rows_invalid', 'job_unknown']) {
      expect(await at({ data: null, error: { message: code } })).toEqual({ ok: false, error: code })
    }
    // A failure with no code of its own, and a call that never got an answer.
    expect(await at({ data: null, error: { message: 'boom' } })).toEqual({ ok: false, error: 'unknown' })
    expect(await at({ data: null, throw: true })).toEqual({ ok: false, error: 'offline' })
  })
})
