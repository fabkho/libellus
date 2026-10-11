import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createCollections } from '@/data/collections'
import { createLibrary } from '@/data/library'
import { mapReadoExport, parseReadoExport, READO_KEY_PREFIX, toImportEntry, type ReadoPlan } from '@/data/import/reado'
import { findMemberId, writeImport } from '../scripts/fable/write'
import { writeCollections } from '../scripts/reado/collections'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, stack, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The Reado import's writes (stage 1) against the local stack, from the
 * synthetic export in tests/fixtures/reado: mapped, given the editions a
 * lookup would find (made up here: tests never call live APIs), written as the
 * service role into a real member, then written again. Nothing is doubled; the
 * Status is the database's; what the member made in the app is left alone, and
 * so is what another import wrote. What the member sees is read the way the
 * app reads it, through the repositories.
 */

function serviceRoleKey(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY
  const env = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const match = env.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m)
  if (!match) throw new Error('`supabase status` did not report SERVICE_ROLE_KEY')
  return match[1]!
}

/** A valid ISBN-13 in 979-0, a range no book uses (it is music's), so no real Book is ever touched. */
function testIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

const fixture = readFileSync(new URL('./fixtures/reado/export.json', import.meta.url), 'utf8')

/** The plan with every ISBN of the fixture replaced by one of this run's own, keys and all. */
function freshPlan(): ReadoPlan {
  const mapped = mapReadoExport(parseReadoExport(fixture))
  let json = JSON.stringify(mapped)
  for (const book of mapped.books) json = json.replaceAll(book.isbn13, testIsbn())
  return JSON.parse(json) as ReadoPlan
}

/** The edition a lookup would have found: a Catalogue-less `import` Book of this run. */
const editionOf = (isbn13: string, title: string): BookSnapshot => ({
  title: runTitle(title), authors: ['Ada Example'], isbn13, isbn10: null, pageCount: null, year: 2021, language: 'en',
  publisher: TEST_PUBLISHER, description: null, coverUrl: null, coverThumbhash: null, coverColors: null, source: 'import',
  appleId: null, openLibraryEditionKey: null, openLibraryWorkKey: null,
})

let service: SupabaseClient
let member: TestMember
let plan: ReadoPlan
let appMade: BookSnapshot

const entriesOf = (p: ReadoPlan) => p.books.map((book) => toImportEntry(book, editionOf(book.isbn13, `Reado ${book.isbn13.slice(-4)}`)))
const options = { keyPrefix: READO_KEY_PREFIX }

async function entryOf(key: string) {
  const { data, error } = await member.client.from('library_entries').select('id, status, book_id, import_key').eq('import_key', key)
  if (error) throw error
  return data[0] ?? null
}

async function sessionsOf(entryId: string) {
  const { data, error } = await member.client
    .from('reading_sessions')
    .select('started_on, ended_on, outcome, rating, review, import_key')
    .eq('entry_id', entryId)
    .order('created_at')
  if (error) throw error
  return data
}

const keyOf = (isbnTail: 'b1' | 'b2' | 'b3' | 'b5' | 'b6' | 'b7' | 'b8' | 'b10') => {
  const index = { b1: 0, b2: 1, b3: 2, b5: 3, b6: 4, b7: 5, b8: 6, b10: 7 }[isbnTail]
  return plan.books[index]!.key
}

beforeAll(async () => {
  service = createClient(stack.url, serviceRoleKey(), { auth: { persistSession: false, autoRefreshToken: false } })
  member = await signUpMember()
  plan = freshPlan()
  // The planned books are in ISBN order, which is the fixture's b1 … b10 order (b4 and b9 are left out).
  expect(plan.books).toHaveLength(8)

  // In the app, before the import: a Collection with another case of a name the export has, and the book b2
  // added by hand (the Catalogue edition with the ISBN the export has).
  expect((await createCollections(member.client).create('favourites')).error).toBeNull()
  appMade = { ...editionOf(plan.books[1]!.isbn13, 'Added in the app'), source: 'apple', appleId: uniqueAppleId() }
  expect((await createLibrary(member.client).addToLibrary(appMade)).error).toBeNull()
})

describe('the Reado import writes', () => {
  it('writes the entries and their reads under the reado: key space, the Status the database derives', async () => {
    const result = await writeImport(service, member.id, entriesOf(plan), options)

    expect(result.problems).toEqual([])
    // The one she added by hand is adopted, not doubled.
    expect(result.entries).toMatchObject({ created: 7, adopted: 1 })
    expect(result.sessions).toEqual({ created: 8, updated: 0, unchanged: 0, deleted: 0 })
    expect((await createLibrary(member.client).entries('finished')).data!.filter((entry) => entry.book.isbn13 === appMade.isbn13)).toHaveLength(1)

    const b1 = (await entryOf(keyOf('b1')))!
    expect(b1.status).toBe('finished')
    expect(await sessionsOf(b1.id)).toEqual([
      { started_on: '2025-01-10', ended_on: '2025-02-20', outcome: 'finished', rating: 18, review: 'A review of an invented book.\n\nSecond paragraph.', import_key: keyOf('b1') },
    ])
    expect(await sessionsOf((await entryOf(keyOf('b2')))!.id)).toEqual([
      expect.objectContaining({ started_on: '2025-03-05', ended_on: '2025-03-21', outcome: 'finished', rating: 12 }),
    ])
    // Read twice: the second read has its own key.
    expect((await sessionsOf((await entryOf(keyOf('b10')))!.id)).map((session) => [session.import_key, session.ended_on, session.rating])).toEqual([
      [keyOf('b10'), '2022-03-15', null],
      [`${keyOf('b10')}#2`, '2024-02-01', 20],
    ])
    expect(await sessionsOf((await entryOf(keyOf('b3')))!.id)).toEqual([
      expect.objectContaining({ started_on: '2024-05-01', ended_on: '2024-05-09', outcome: 'abandoned', rating: null }),
    ])
    expect((await entryOf(keyOf('b5')))!.status).toBe('reading')
    expect(await sessionsOf((await entryOf(keyOf('b5')))!.id)).toEqual([expect.objectContaining({ started_on: '2026-09-01', ended_on: null, outcome: null })])
    expect((await entryOf(keyOf('b6')))!.status).toBe('want_to_read')
    // Finished with no days at all.
    expect(await sessionsOf((await entryOf(keyOf('b8')))!.id)).toEqual([
      expect.objectContaining({ started_on: null, ended_on: null, outcome: 'finished', rating: 14 }),
    ])
  })

  it('puts the entries on their Collections, found by name in any case, made at the end of her list otherwise', async () => {
    const result = await writeCollections(service, member.id, plan.collections)

    expect(result.missingEntries).toEqual([])
    expect(result.collections).toEqual({ created: 2, existing: 1 })
    expect(result.memberships).toEqual({ added: 4, present: 0 })

    const collections = createCollections(member.client)
    const list = (await collections.list()).data!
    // Hers came first and kept its own spelling: the export's Favourites went onto it.
    expect(list.map((collection) => [collection.name, collection.count])).toEqual([['favourites', 1], ['2025', 2], ['Ebook TBR', 1]])
    const year = (await collections.get(list[1]!.id)).data!
    expect(year.entries.map((entry) => entry.book.isbn13)).toEqual([plan.books[0]!.isbn13, plan.books[1]!.isbn13])
  })

  it('changes nothing when run again', async () => {
    const before = await createLibrary(member.client).entries('finished')
    const result = await writeImport(service, member.id, entriesOf(plan), options)
    expect(result.problems).toEqual([])
    expect(result.books).toMatchObject({ created: 0 })
    expect(result.entries).toMatchObject({ created: 0, adopted: 0, moved: 0, unchanged: 8, stale: [] })
    expect(result.sessions).toEqual({ created: 0, updated: 0, unchanged: 8, deleted: 0 })

    const collections = await writeCollections(service, member.id, plan.collections)
    expect(collections.collections).toEqual({ created: 0, existing: 3 })
    expect(collections.memberships).toEqual({ added: 0, present: 4 })
    expect(await createLibrary(member.client).entries('finished')).toEqual(before)
  })

  it('leaves what the member arranged in the app alone, and adds only what is new', async () => {
    const collections = createCollections(member.client)
    const list = (await collections.list()).data!
    const ebook = list.find((collection) => collection.name === 'Ebook TBR')!
    const entry = (await entryOf(keyOf('b6')))!
    // In the app: she takes the entry off the Collection.
    const removed = await member.client.rpc('remove_from_collection', { p_collection: ebook.id, p_entry: entry.id })
    expect(removed.error).toBeNull()

    // The import is additive: it puts it back only because the list still says so, and never takes anything off.
    const again = await writeCollections(service, member.id, plan.collections)
    expect(again.memberships).toEqual({ added: 1, present: 3 })
    expect((await collections.get(ebook.id)).data!.entries).toHaveLength(1)
  })

  it('prunes only its own key space, and only what the export no longer has', async () => {
    // Another import's entry: the member's, with a key of another space.
    const other = (await entryOf(keyOf('b8')))!
    const { error } = await service.from('library_entries').update({ import_key: 'goodreads:12345' }).eq('id', other.id)
    expect(error).toBeNull()

    const smaller: ReadoPlan = { ...plan, books: plan.books.filter((book) => book.key !== keyOf('b6') && book.key !== keyOf('b8')) }
    const result = await writeImport(service, member.id, entriesOf(smaller), { ...options, prune: true })

    expect(result.entries).toMatchObject({ pruned: 1, stale: [keyOf('b6')] })
    expect(await entryOf(keyOf('b6'))).toBeNull()
    expect((await entryOf('goodreads:12345'))!.id).toBe(other.id)
    expect(await sessionsOf(other.id)).toHaveLength(1)
  })

  it('reads everything and writes nothing on a dry run', async () => {
    const fresh = await signUpMember()
    const result = await writeImport(service, fresh.id, entriesOf(plan), { ...options, dryRun: true })
    expect(result.entries.created).toBe(8)
    expect(result.sessions.created).toBe(8)
    const collections = await writeCollections(service, fresh.id, plan.collections, { dryRun: true })
    expect(collections.collections.created).toBe(3)
    expect((await createLibrary(fresh.client).entries('finished')).data).toEqual([])
    expect((await createCollections(fresh.client).list()).data).toEqual([])
  })

  it('finds the member by address, as the script does', async () => {
    expect(await findMemberId(service, member.email)).toBe(member.id)
  })
})
