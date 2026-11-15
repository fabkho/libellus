import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BookFormat, BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { readAsOf, type ReadAs } from '@/data/readAs'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId, uniqueEditionKey } from './support/stack'

/**
 * The `read_as` column (issue #169) and the Change-edition preset, against the local stack, as real
 * signed-in members. The app no longer has a control for the column (the edition's format is the
 * answer), so what is hers here is written the way the database still lets a member write it:
 * `set_read_as`, called as herself.
 */

/** Her word on how she read the entry, as the app used to say it: through the function, as herself. */
async function say(client: SupabaseClient, entryId: string, readAs: ReadAs | null) {
  const set = await client.rpc('set_read_as', { p_entry_id: entryId, p_read_as: readAs })
  if (set.error) throw new Error(`set_read_as failed: ${set.error.message}`)
}

function book(): BookSnapshot {
  return {
    title: runTitle('Hyperion'),
    authors: ['Dan Simmons'],
    isbn13: null,
    isbn10: null,
    pageCount: 482,
    year: 1989,
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

describe('the read_as column, set through the database\'s own function', () => {
  it('starts unset, takes each of the three words and is taken back with null', async () => {
    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const { data: added } = await library.addToLibrary(book())
    expect(added!.readAs).toBeNull()

    for (const way of ['physical', 'ebook', 'audiobook'] as const) {
      await say(ida.client, added!.id, way)
      expect((await library.entry(added!.id)).data!.readAs).toBe(way)
    }
    await say(ida.client, added!.id, null)
    expect((await library.entry(added!.id)).data!.readAs).toBeNull()
  })

  it('is listed with the entries of its Status and survives a read', async () => {
    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const { data: added } = await library.addToLibrary(book())
    await say(ida.client, added!.id, 'audiobook')
    await library.startReading(added!.id, '2026-05-01')
    await library.finish(added!.id, { endedOn: '2026-05-09', rating: 16 })

    const finished = await library.entries('finished')
    expect(finished.data!.find((e) => e.id === added!.id)).toMatchObject({ readAs: 'audiobook', latestSession: { rating: 16 } })
  })

  it('the database holds only the three words', async () => {
    const ida = await signUpMember()
    const { data: added } = await createLibrary(ida.client).addToLibrary(book())
    await expect(sql(`update public.library_entries set read_as = 'paper' where id = $1`, [added!.id])).rejects.toThrow(/library_entries_read_as_known/)
  })
})

describe('changing the edition presets Read as from its format', () => {
  const edition = (title: string, fields: Partial<BookSnapshot> = {}): BookSnapshot => ({
    ...book(),
    title: runTitle(title),
    ...fields,
  })
  const printed = (title: string, format: BookFormat | null): BookSnapshot =>
    edition(title, { source: 'openlibrary', appleId: null, openLibraryEditionKey: uniqueEditionKey(), format })

  it('says it as the new edition is read, in the same call that moves the entry', async () => {
    const member = await signUpMember()
    const as = (entryId: string, readAs: ReadAs | null) => say(member.client, entryId, readAs)
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(printed('Solaris', 'paperback'))
    await as(added!.id, 'physical')

    const ebook = await library.changeEdition(added!.id, edition('Solaris'))
    expect(ebook.data).toMatchObject({ id: added!.id, readAs: 'ebook', book: { format: 'ebook' } })
    expect((await library.entry(added!.id)).data!.readAs).toBe('ebook')

    const audio = await library.changeEdition(added!.id, printed('Solaris', 'audiobook'))
    expect(audio.data!.readAs).toBe('audiobook')
    const hardcover = await library.changeEdition(added!.id, printed('Solaris', 'hardcover'))
    expect(hardcover.data!.readAs).toBe('physical')
  })

  it('takes the format she says for the new edition when its source said none', async () => {
    const member = await signUpMember()
    const as = (entryId: string, readAs: ReadAs | null) => say(member.client, entryId, readAs)
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(edition('Solaris'))
    await as(added!.id, 'ebook')

    const { data } = await library.changeEdition(added!.id, printed('Solaris', null), 'audiobook')
    expect(data).toMatchObject({ readAs: 'audiobook', formatOverride: 'audiobook', book: { format: null } })
  })

  it('leaves what she said when the new edition\'s format is unknown, and when it is read the same way', async () => {
    const member = await signUpMember()
    const as = (entryId: string, readAs: ReadAs | null) => say(member.client, entryId, readAs)
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(printed('Solaris', 'paperback'))
    await as(added!.id, 'audiobook')

    expect((await library.changeEdition(added!.id, printed('Solaris', null))).data!.readAs).toBe('audiobook')
    expect((await library.changeEdition(added!.id, printed('Solaris', 'hardcover'))).data!.readAs).toBe('physical')
    await as(added!.id, 'audiobook')
    // Paper to paper: her word was about how she read it, not about the cover.
    expect((await library.changeEdition(added!.id, printed('Solaris', 'paperback'))).data!.readAs).toBe('audiobook')
  })

  it('keeps an unset word unset: the edition\'s format is its default already', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(printed('Solaris', 'paperback'))

    const { data } = await library.changeEdition(added!.id, edition('Solaris'))
    expect(data!.readAs).toBeNull()
    expect(readAsOf(data!)).toBe('ebook')
  })

  it('is not done by a refused change', async () => {
    const member = await signUpMember()
    const as = (entryId: string, readAs: ReadAs | null) => say(member.client, entryId, readAs)
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(printed('Solaris', 'paperback'))
    const other = edition('Solaris, again')
    await library.addToLibrary(other)
    await as(added!.id, 'physical')

    expect((await library.changeEdition(added!.id, other)).error).toBe('edition_in_library')
    expect((await library.entry(added!.id)).data!.readAs).toBe('physical')
  })
})
