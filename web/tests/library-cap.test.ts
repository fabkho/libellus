import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createCatalogueSearch } from '@/data/catalogueSearch'
import { createCollections } from '@/data/collections'
import { createBookGenres } from '@/data/enrich/bookGenres'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER } from './support/stack'

/**
 * The 1,000-row cap against the real PostgREST (perf F4): a member with 1,150 entries, all added at
 * the same instant and every read ending the same day (so only the id tells them apart), reads every one of them through the Library
 * lists, Search's copy and the genres, where one plain request is cut at `max_rows` without a word.
 * The mocked client in paging.test.ts proves the paging; this proves the server's side of it: the
 * to-one ordering (`latest(ended_on)`) and the RPC's `order`/`range` are accepted and meet.
 */

const ENTRIES = 1150

describe('a Library past PostgREST\'s max_rows', () => {
  it('is read whole: the lists, Search\'s copy and the genres', async () => {
    const member = await signUpMember()
    const base = randomInt(1, 2 ** 40)
    await sql(
      `with b as (
         insert into public.books (title, authors, source, apple_id, publisher)
         select format('Cap book %s', g) || $5, array['A. Writer'], 'apple', '99' || lpad(($2::bigint + g)::text, 15, '0'), $3
           from generate_series(1, $1) g
         returning id)
       insert into public.library_entries (member_id, book_id, added_at)
       select $4, id, '2026-10-01T00:00:00Z' from b`,
      [ENTRIES, base, TEST_PUBLISHER, member.id, runTitle('')],
    )
    // One finished read each, all ending the same day: the status follows the sessions (a trigger).
    await sql(
      `insert into public.reading_sessions (entry_id, started_on, ended_on, outcome)
       select id, '2026-09-01', '2026-09-20', 'finished' from public.library_entries where member_id = $1`,
      [member.id],
    )

    // The cap itself: one plain request is cut, with no error.
    const plain = await member.client.from('library_entries').select('id')
    expect(plain.error).toBeNull()
    expect(plain.data).toHaveLength(1000)

    const finished = await createLibrary(member.client).entries('finished')
    expect(finished.error).toBeNull()
    expect(finished.data).toHaveLength(ENTRIES)
    expect(new Set(finished.data!.map((e) => e.id)).size).toBe(ENTRIES)

    const copy = await createCatalogueSearch(member.client).libraryEntries()
    expect(new Set(copy.map((e) => e.id)).size).toBe(ENTRIES)

    const genres = await createBookGenres(member.client).library()
    expect(genres.error).toBeNull()
    expect(new Set(genres.data!.map((g) => g.entryId)).size).toBe(ENTRIES)
  })

  it('a Collection page reads all its entries: max_rows cuts the rows embedded under one Collection too', async () => {
    const member = await signUpMember()
    const base = randomInt(1, 2 ** 40)
    await sql(
      `with b as (
         insert into public.books (title, authors, source, apple_id, publisher)
         select format('Cap book %s', g) || $5, array['A. Writer'], 'apple', '99' || lpad(($2::bigint + g)::text, 15, '0'), $3
           from generate_series(1, $1) g
         returning id),
       e as (
         insert into public.library_entries (member_id, book_id) select $4, id from b returning id),
       c as (
         insert into public.collections (member_id, name, position) values ($4, 'Everything', 0) returning id)
       insert into public.collection_entries (collection_id, entry_id, position)
       select c.id, e.id, row_number() over () from c, e`,
      [ENTRIES, base, TEST_PUBLISHER, member.id, runTitle('')],
    )
    const collections = createCollections(member.client)
    const listed = await collections.list()
    expect(listed.error).toBeNull()
    const id = listed.data![0]!.id
    // The cut itself, as a plain embedded read meets it.
    const plain = await member.client.from('collections').select('id, entries:collection_entries(entry_id)').eq('id', id).single()
    expect((plain.data as { entries: unknown[] }).entries).toHaveLength(1000)

    const found = await collections.get(id)
    expect(found.data?.entries).toHaveLength(ENTRIES)
    expect(new Set(found.data!.entries.map((e) => e.id)).size).toBe(ENTRIES)
  })
})
