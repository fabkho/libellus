/**
 * The read (issue #110): rows of `library_entries` with their Book and every
 * read, as the entries the Regal export maps, through a stand-in for
 * supabase-js that pages like PostgREST. The same mapping as the web app's
 * (`bookFromRow`, `sessionFromRow`, `sortSessions` in web/app/data/library.ts).
 *
 *   cd supabase/functions/regal-export && deno task test
 */
import { assertEquals, assertRejects } from '@std/assert'
import type { SupabaseClient } from '@supabase/supabase-js'
import { type EntryRow, ENTRY_SELECT, entryFromRow, findMemberId, PAGE, readLibrary, sortSessions } from './library.ts'
import { entryRows } from './test_support.ts'

Deno.test('maps a row onto an entry: the Book, the member’s own page count, the reads newest first', () => {
  const [leftHand, , parable, , wanted] = entryRows().map(entryFromRow)
  assertEquals(leftHand, {
    addedAt: '2024-03-01T23:30:00Z',
    pageCountOverride: 512,
    book: {
      id: '00000000-0000-4000-8000-000000000001',
      title: '  The Left Hand of Darkness ',
      authors: ['Ursula K. Le Guin'],
      isbn13: '9780441478125',
      isbn10: '0441478123',
      pageCount: 304,
      year: 1969,
      publisher: 'Ace Books',
      description: 'Winter, a planet of ice.',
      coverUrl: 'https://covers.example.test/left-hand.jpg',
      coverColors: { dominant: '#1a2b3c', secondary: '#f0e0d0' },
    },
    sessions: [
      { startedOn: '2024-02-01', endedOn: '2024-02-28', outcome: 'finished', rating: 19, review: 'Better the second time.', createdAt: '2024-02-01T10:00:00Z' },
      { startedOn: '2020-01-01', endedOn: '2020-01-20', outcome: 'finished', rating: 16, review: 'Kemmer.', createdAt: '2020-01-01T10:00:00Z' },
    ],
  } as unknown as typeof leftHand)
  assertEquals(parable!.book.coverColors, null)
  assertEquals(parable!.pageCountOverride, 99)
  assertEquals(wanted!.sessions, [])
})

Deno.test('sorts the reads as latest_session does: the open one, then by end, start and creation', () => {
  const read = (startedOn: string | null, endedOn: string | null, outcome: 'finished' | null, createdAt = '2024-01-01T00:00:00Z') =>
    ({ startedOn, endedOn, outcome, rating: null, review: null, createdAt })
  const sorted = sortSessions([
    read(null, null, 'finished', '2024-01-02T00:00:00Z'),
    read('2020-01-01', '2020-02-01', 'finished'),
    read('2024-05-01', null, null),
    read('2021-01-01', '2021-02-01', 'finished'),
    read(null, null, 'finished', '2024-01-03T00:00:00Z'),
  ])
  assertEquals(sorted.map((session) => [session.startedOn, session.endedOn, session.createdAt]), [
    ['2024-05-01', null, '2024-01-01T00:00:00Z'],
    ['2021-01-01', '2021-02-01', '2024-01-01T00:00:00Z'],
    ['2020-01-01', '2020-02-01', '2024-01-01T00:00:00Z'],
    [null, null, '2024-01-03T00:00:00Z'],
    [null, null, '2024-01-02T00:00:00Z'],
  ])
})

/** A supabase-js stand-in: `library_entries` pages like PostgREST, `auth.admin.listUsers` too. */
function fakeClient(rows: EntryRow[], users: { id: string; email?: string }[] = [], failWith: string | null = null) {
  const queries: { table: string; select: string; eq: [string, string]; order: string; range: [number, number] }[] = []
  const client = {
    from(table: string) {
      const query = { table, select: '', eq: ['', ''] as [string, string], order: '', range: [0, 0] as [number, number] }
      const builder = {
        select: (columns: string) => ((query.select = columns), builder),
        eq: (column: string, value: string) => ((query.eq = [column, value]), builder),
        order: (column: string) => ((query.order = column), builder),
        range: (from: number, to: number) => ((query.range = [from, to]), builder),
        returns: () => {
          queries.push(query)
          if (failWith) return Promise.resolve({ data: null, error: { message: failWith } })
          return Promise.resolve({ data: rows.slice(query.range[0], query.range[1] + 1), error: null })
        },
      }
      return builder
    },
    auth: {
      admin: {
        listUsers: ({ page, perPage }: { page: number; perPage: number }) =>
          Promise.resolve({ data: { users: users.slice((page - 1) * perPage, page * perPage) }, error: null }),
      },
    },
  }
  return { client: client as unknown as SupabaseClient, queries }
}

Deno.test('reads the member’s whole Library in pages of the row limit, in a stable order', async () => {
  const template = entryRows()[1]!
  const rows = Array.from({ length: PAGE + 2 }, (_, index) => ({
    ...template,
    id: `e-${String(index).padStart(5, '0')}`,
    book: { ...template.book, id: `b-${String(index).padStart(5, '0')}` },
  }))
  const { client, queries } = fakeClient(rows)
  const entries = await readLibrary(client, 'member-1')
  assertEquals(entries.length, PAGE + 2)
  assertEquals(entries.at(-1)!.book.id, `b-${String(PAGE + 1).padStart(5, '0')}`)
  assertEquals(queries.map((query) => query.range), [[0, PAGE - 1], [PAGE, 2 * PAGE - 1]])
  assertEquals(queries[0], {
    table: 'library_entries',
    select: ENTRY_SELECT,
    eq: ['member_id', 'member-1'],
    order: 'id',
    range: [0, PAGE - 1],
  })
})

Deno.test('asks for the member’s own page count with every entry', () => {
  assertEquals(ENTRY_SELECT.includes('page_count_override'), true)
  assertEquals(ENTRY_SELECT.includes('sessions:reading_sessions('), true)
})

Deno.test('passes a read failure on', async () => {
  const { client } = fakeClient([], [], 'permission denied')
  await assertRejects(() => readLibrary(client, 'member-1'), Error, 'Reading the Library: permission denied')
})

Deno.test('finds the owner by address, in any case, over pages of members', async () => {
  const users = Array.from({ length: 1500 }, (_, index) => ({ id: `u-${index}`, email: `member${index}@libellus.test` }))
  users.push({ id: 'owner', email: 'Owner@Libellus.test' })
  const { client } = fakeClient([], users)
  assertEquals(await findMemberId(client, ' owner@libellus.TEST '), 'owner')
  assertEquals(await findMemberId(client, 'nobody@libellus.test'), null)
})
