import { describe, expect, it } from 'vitest'
import type { BookFormat, BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { readAsOf } from '@/data/readAs'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId, uniqueEditionKey } from './support/stack'

/** Read as (issue #169) through the repository, against the local stack, as real signed-in members. */

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

describe('setReadAs', () => {
  it('starts unset, is set to each of the three ways and taken back with null', async () => {
    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const { data: added } = await library.addToLibrary(book())
    expect(added!.readAs).toBeNull()

    for (const way of ['physical', 'ebook', 'audiobook'] as const) {
      const set = await library.setReadAs(added!.id, way)
      expect(set.error).toBeNull()
      expect(set.data).toMatchObject({ id: added!.id, readAs: way })
      expect((await library.entry(added!.id)).data!.readAs).toBe(way)
    }
    expect((await library.setReadAs(added!.id, null)).data!.readAs).toBeNull()
  })

  it('is listed with the entries of its Status and survives a read', async () => {
    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const { data: added } = await library.addToLibrary(book())
    await library.setReadAs(added!.id, 'audiobook')
    await library.startReading(added!.id, '2026-05-01')
    await library.finish(added!.id, { endedOn: '2026-05-09', rating: 16 })

    const finished = await library.entries('finished')
    expect(finished.data!.find((e) => e.id === added!.id)).toMatchObject({ readAs: 'audiobook', latestSession: { rating: 16 } })
  })

  it('refuses a word it does not know, and another member\'s entry', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const library = createLibrary(ida.client)
    const { data: added } = await library.addToLibrary(book())

    expect(await library.setReadAs(added!.id, 'paper' as never)).toEqual({ data: null, error: 'read_as_invalid' })
    expect(await createLibrary(max.client).setReadAs(added!.id, 'ebook')).toEqual({ data: null, error: 'entry_not_found' })
    expect((await library.entry(added!.id)).data!.readAs).toBeNull()
  })

  it('is refused offline before anything is sent', async () => {
    const ida = await signUpMember()
    const { data: added } = await createLibrary(ida.client).addToLibrary(book())
    const offline = createLibrary(ida.client, { online: () => false })
    expect(await offline.setReadAs(added!.id, 'ebook')).toEqual({ data: null, error: 'offline' })
    expect((await createLibrary(ida.client).entry(added!.id)).data!.readAs).toBeNull()
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
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(printed('Solaris', 'paperback'))
    await library.setReadAs(added!.id, 'physical')

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
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(edition('Solaris'))
    await library.setReadAs(added!.id, 'ebook')

    const { data } = await library.changeEdition(added!.id, printed('Solaris', null), 'audiobook')
    expect(data).toMatchObject({ readAs: 'audiobook', formatOverride: 'audiobook', book: { format: null } })
  })

  it('leaves what she said when the new edition\'s format is unknown, and when it is read the same way', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(printed('Solaris', 'paperback'))
    await library.setReadAs(added!.id, 'audiobook')

    expect((await library.changeEdition(added!.id, printed('Solaris', null))).data!.readAs).toBe('audiobook')
    expect((await library.changeEdition(added!.id, printed('Solaris', 'hardcover'))).data!.readAs).toBe('physical')
    await library.setReadAs(added!.id, 'audiobook')
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
    const library = createLibrary(member.client)
    const { data: added } = await library.addToLibrary(printed('Solaris', 'paperback'))
    const other = edition('Solaris, again')
    await library.addToLibrary(other)
    await library.setReadAs(added!.id, 'physical')

    expect((await library.changeEdition(added!.id, other)).error).toBe('edition_in_library')
    expect((await library.entry(added!.id)).data!.readAs).toBe('physical')
  })
})
