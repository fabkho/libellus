import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, mapLibraryError } from '@/data/library'
import { createMemberStats } from '@/data/memberStats'
import { createSocial } from '@/data/social'
import { isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The checked Catalogue through the repositories against the social stack (social v2a contract §5):
 * `books.description` is not an API column, so a Book's blurb comes through `book_descriptions` (her own
 * Library's, a checked Book's, never another member's unchecked one) and `select *` of `books` is refused;
 * a Book the check could not confirm reaches another member as "unverified" (nothing a member sent);
 * the day's limit of new Catalogue Books is a named refusal the add maps to its error line.
 */

function book(title: string, overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['An Author'],
    isbn13: null,
    isbn10: null,
    pageCount: 200,
    year: 2001,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: `Blurb of ${title}`,
    coverUrl: 'https://example.org/cover.jpg',
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

async function adds(member: TestMember, snapshot: BookSnapshot, status: 'want_to_read' | 'finished' = 'want_to_read') {
  const result = await createLibrary(member.client).addToLibrary(
    snapshot,
    status === 'finished' ? { status, startedOn: isoDay(), endedOn: isoDay() } : { status },
  )
  expect(result.error).toBeNull()
  return result.data!
}

describe('a description is read through one guarded path', () => {
  it('the API refuses books.description and select *; the named columns are read', async () => {
    const ada = await signUpMember()
    const entry = await adds(ada, book('Guarded'))

    const description = await ada.client.from('books').select('description').eq('id', entry.book.id)
    expect(description.error?.code).toBe('42501')
    const everything = await ada.client.from('books').select('*').eq('id', entry.book.id)
    expect(everything.error?.code).toBe('42501')
    const filtered = await ada.client.from('books').select('id').not('description', 'is', null).limit(1)
    expect(filtered.error?.code).toBe('42501')
    const named = await ada.client.from('books').select('id, title, cover_url').eq('id', entry.book.id).single()
    expect(named.error).toBeNull()
    expect(named.data?.title).toBe(entry.book.title)
  })

  it('her own Library, the Book page and a checked Book show their blurb; another member\'s unchecked one is not read', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    const entry = await adds(ada, book('Planter'))
    const adaLibrary = createLibrary(ada.client)
    const benLibrary = createLibrary(ben.client)

    // Hers: through her entries, and the Book by id.
    const mine = (await adaLibrary.entries('want_to_read')).data!.find((e) => e.id === entry.id)!
    expect(mine.book.description).toBe('Blurb of Planter')
    expect((await adaLibrary.book(entry.book.id)).data?.description).toBe('Blurb of Planter')

    // Ben's reading of her unchecked Book: no blurb (the row, its title and cover, are the Catalogue's to show).
    const seen = (await benLibrary.book(entry.book.id)).data!
    expect(seen.title).toBe(entry.book.title)
    expect(seen.description).toBeNull()
    expect((await benLibrary.catalogueByAppleId([entry.book.appleId!])).data?.get(entry.book.appleId!)?.description).toBeNull()

    // The server's check read it: now it is the source's, for everyone.
    await sql('select public.catalogue_check_save($1, $2::jsonb)', [
      entry.book.id,
      JSON.stringify({ title: entry.book.title, description: 'What the source says.' }),
    ])
    expect((await benLibrary.book(entry.book.id)).data?.description).toBe('What the source says.')
    expect((await adaLibrary.book(entry.book.id)).data?.description).toBe('What the source says.')

    // Ben has it in his own Library too (the same row): his entry carries it.
    const benEntry = await adds(ben, book('Planter', { appleId: entry.book.appleId }))
    expect(benEntry.book.id).toBe(entry.book.id)
  })

  it('the catalogue search hands an unchecked Book without its blurb, and a failed one not at all', async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    const pending = await adds(ada, book('Searchable Pending'))
    const failed = await adds(ada, book('Searchable Failed'))
    await sql('select public.catalogue_check_miss($1)', [failed.book.id])

    const search = async (member: TestMember, text: string) => {
      const result = await member.client.rpc('search_books', { p_query: runTitle(text), p_limit: 10 })
      expect(result.error).toBeNull()
      return result.data as { id: string; description: string | null }[]
    }
    expect((await search(ben, 'Searchable Pending')).map((row) => [row.id, row.description])).toEqual([[pending.book.id, null]])
    expect(await search(ben, 'Searchable Failed')).toEqual([])
    expect((await search(ada, 'Searchable Pending')).map((row) => row.description)).toEqual(['Blurb of Searchable Pending'])
    expect((await search(ada, 'Searchable Failed')).map((row) => row.id)).toEqual([failed.book.id])
  })
})

describe('a Book the check could not confirm', () => {
  it('reaches a follower as unverified in her record, and shown as the one string', async () => {
    const ada = await signUpMember()
    const entry = await adds(ada, book('Planted'), 'finished')
    await sql('select public.catalogue_check_miss($1)', [entry.book.id])
    const ben = await signUpMember()
    // Her account is private by default: Ben asks, she accepts.
    const mine = await ada.client.rpc('my_social')
    expect((await ben.client.rpc('follow_target', { p_token: mine.data.link })).error).toBeNull()
    expect((await ben.client.rpc('follow', { p_member: ada.id })).error).toBeNull()
    expect((await ada.client.rpc('answer_request', { p_member: ben.id, p_accept: true })).error).toBeNull()

    const record = (await createMemberStats(ben.client, { outside: () => 'Outside the catalogue' }).record(ada.id)).data!
    expect(record.reads).toHaveLength(1)
    const shown = record.reads[0]!.book
    expect(shown.unverified).toBe(true)
    expect(shown.title).toBe('Outside the catalogue')
    expect([shown.authors, shown.coverUrl, shown.description, shown.isbn13, shown.appleId]).toEqual([[], null, null, null, null])

    const profile = (await createSocial(ben.client).profile(ada.id)).data!
    expect(profile.visible && profile.finished[0]!.book).toMatchObject({ unverified: true, title: '', authors: [], coverUrl: null })

    // Hers, she reads as she added it.
    const own = (await createMemberStats(ada.client).record(ada.id)).data
    expect(own).toBeNull()
    expect((await createLibrary(ada.client).book(entry.book.id)).data).toMatchObject({ title: entry.book.title, description: 'Blurb of Planted' })
  })
})

describe('the day\'s limit of new Catalogue Books', () => {
  it('is a named refusal (429) the add maps to its error line; a Book that is in the Catalogue already is no new one', async () => {
    expect(mapLibraryError({ message: 'catalogue_limit', code: 'PT429' })).toBe('catalogue_limit')

    const ada = await signUpMember()
    const ben = await signUpMember()
    const there = await adds(ben, book('Already There'))
    // Her day is spent (the count is the database's own; 200 adds would only fill the Catalogue).
    await sql('insert into private.catalogue_additions (member_id, day, n) values ($1, current_date, 200)', [ada.id])

    const library = createLibrary(ada.client)
    const refused = await library.addToLibrary(book('One Too Many'), { status: 'want_to_read' })
    expect(refused).toEqual({ data: null, error: 'catalogue_limit' })
    expect((await library.entries('want_to_read')).data).toEqual([])

    const shared = await library.addToLibrary(book('Already There', { appleId: there.book.appleId }), { status: 'want_to_read' })
    expect(shared.error).toBeNull()
    expect(shared.data?.book.id).toBe(there.book.id)
  })
})
