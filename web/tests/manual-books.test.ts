import { describe, expect, it } from 'vitest'
import { createLibrary } from '@/data/library'
import { createManualBooks, validateManualBook } from '@/data/manualBooks'
import { signUpMember } from './support/member'
import { runTitle } from './support/stack'

/**
 * Manual books through the repository, against the local stack, as real
 * signed-in members. A Manual book belongs to its member, so the teardown that
 * removes the run's members removes these with them.
 */

describe('addManualBook', () => {
  it('makes a Manual book and puts it on Want to read in one call', async () => {
    const ida = await signUpMember()
    const title = runTitle('Meine Notizen')

    const { data: entry, error } = await createManualBooks(ida.client).addManualBook({
      title: `  ${title} `,
      author: ' Ida Beispiel ',
      isbn: '978-3-16-148410-0',
      pageCount: '312',
    })

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'want_to_read',
      book: {
        title,
        authors: ['Ida Beispiel'],
        isbn13: '9783161484100',
        pageCount: 312,
        source: 'manual',
        coverUrl: null,
        coverThumbhash: null,
        coverColors: null,
      },
    })

    const wantToRead = await createLibrary(ida.client).entries('want_to_read')
    expect(wantToRead.data?.map((e) => e.id)).toContain(entry!.id)
  })

  it('needs only a title and an author', async () => {
    const ida = await signUpMember()

    const { data: entry, error } = await createManualBooks(ida.client).addManualBook({
      title: runTitle('Nur Titel'),
      author: 'Ida Beispiel',
    })

    expect(error).toBeNull()
    expect(entry!.book).toMatchObject({ isbn13: null, isbn10: null, pageCount: null, source: 'manual' })
  })

  it('keeps an ISBN-10 and also finds the ISBN-13 for it', async () => {
    const ida = await signUpMember()

    const { data: entry } = await createManualBooks(ida.client).addManualBook({
      title: runTitle('Zehn'),
      author: 'Ida Beispiel',
      isbn: '0-306-40615-2',
    })

    expect(entry!.book).toMatchObject({ isbn10: '0306406152', isbn13: '9780306406157' })
  })

  it('refuses what the form refuses, with a code and nothing saved', async () => {
    const ida = await signUpMember()
    const manual = createManualBooks(ida.client)
    const title = runTitle('Abgelehnt')

    expect(await manual.addManualBook({ title: ' ', author: 'Ida' })).toEqual({ data: null, error: 'book_invalid' })
    expect(await manual.addManualBook({ title, author: ' ' })).toEqual({ data: null, error: 'book_invalid' })
    expect(await manual.addManualBook({ title, author: 'Ida', pageCount: '0' })).toEqual({
      data: null,
      error: 'book_invalid',
    })
    expect(await manual.addManualBook({ title, author: 'Ida', isbn: '9783161484101' })).toEqual({
      data: null,
      error: 'isbn_invalid',
    })

    const wantToRead = await createLibrary(ida.client).entries('want_to_read')
    expect(wantToRead.data).toEqual([])
  })

  it('stays private: another member neither sees the Book nor can look it up', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const { data: entry } = await createManualBooks(ida.client).addManualBook({
      title: runTitle('Privat'),
      author: 'Ida Beispiel',
      isbn: '9783161484100',
    })
    const bookId = entry!.book.id

    const idas = createLibrary(ida.client)
    expect((await idas.book(bookId)).data).toMatchObject({ id: bookId, source: 'manual' })

    const maxs = createLibrary(max.client)
    expect((await maxs.book(bookId)).data).toBeNull()
    expect((await maxs.catalogueBook({ isbn13: '9783161484100' })).data).toBeNull()
    expect((await maxs.entryForBook(bookId)).data).toBeNull()
    expect((await maxs.entries('want_to_read')).data).toEqual([])
  })
})

describe('validateManualBook', () => {
  it('marks the fields the database would refuse', () => {
    expect(validateManualBook({ title: '', author: '' })).toEqual({ title: true, author: true })
    expect(validateManualBook({ title: 'A', author: 'B', isbn: '1234', pageCount: '-3' })).toEqual({
      isbn: true,
      pageCount: true,
    })
    expect(validateManualBook({ title: 'A', author: 'B', isbn: '', pageCount: ' ' })).toEqual({})
    expect(validateManualBook({ title: 'A', author: 'B', isbn: '978-3-16-148410-0', pageCount: '312' })).toEqual({})
  })
})
