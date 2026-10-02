import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The Library actions through the repository, against the local stack, as
 * real signed-in members (SPEC.md, Testing). Test Books carry the run tag and
 * a fresh Apple id, so they never meet a real Catalogue Book and the teardown
 * finds them.
 */

function book(overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle('Piranesi'),
    authors: ['Susanna Clarke'],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: 'Piranesi\'s house is no ordinary building.',
    coverUrl: 'https://is1-ssl.mzstatic.com/image/thumb/Publication116/v4/2c/2e/b4/1031214040.jpg/600x900bb.jpg',
    coverThumbhash: '1QcSHQRnh493V4dIh4eXh1h4kJUI',
    coverColors: { dominant: '#2a4a6e', secondary: '#d8c8a0' },
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

describe('addToLibrary', () => {
  it('puts a Book from search on Want to read in one call, with its cover', async () => {
    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const piranesi = book()

    const { data: entry, error } = await library.addToLibrary(piranesi)

    expect(error).toBeNull()
    expect(entry).toMatchObject({
      status: 'want_to_read',
      book: {
        title: piranesi.title,
        authors: ['Susanna Clarke'],
        year: 2020,
        pageCount: 272,
        source: 'apple',
        appleId: piranesi.appleId,
        coverUrl: piranesi.coverUrl,
        coverThumbhash: piranesi.coverThumbhash,
        coverColors: piranesi.coverColors,
      },
    })

    const wantToRead = await library.entries('want_to_read')
    expect(wantToRead.data?.map((e) => e.id)).toContain(entry!.id)
  })

  it('fails clearly when the member already has the Book', async () => {
    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const piranesi = book()

    await library.addToLibrary(piranesi)
    const again = await library.addToLibrary({ ...piranesi, description: 'Another snapshot' })

    expect(again).toEqual({ data: null, error: 'already_in_library' })
  })

  it('finds the Catalogue Book another member added and keeps its first snapshot', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const first = book({ isbn13: null })
    const { data: idas } = await createLibrary(ida.client).addToLibrary(first)

    const { data: maxs } = await createLibrary(max.client).addToLibrary({
      ...first,
      title: runTitle('Piranesi, retitled'),
      coverUrl: null,
    })

    expect(maxs!.book.id).toBe(idas!.book.id)
    expect(maxs!.book.title).toBe(first.title)
    expect(maxs!.book.coverUrl).toBe(first.coverUrl)
  })

  it('matches a Book by ISBN-13 across source ids', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const isbn13 = await unusedIsbn13()
    const { data: idas } = await createLibrary(ida.client).addToLibrary(book({ isbn13 }))

    const { data: maxs } = await createLibrary(max.client).addToLibrary(book({ isbn13, appleId: uniqueAppleId() }))

    expect(maxs!.book.id).toBe(idas!.book.id)
  })

  it('refuses a Book it could never find again', async () => {
    const ida = await signUpMember()
    const result = await createLibrary(ida.client).addToLibrary(book({ appleId: null, isbn13: null }))
    expect(result).toEqual({ data: null, error: 'book_invalid' })
  })
})

describe('the Want to read list', () => {
  it('is newest first and holds only the member\'s own entries', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const idas = createLibrary(ida.client)

    const older = await idas.addToLibrary(book({ title: runTitle('Older') }))
    const newer = await idas.addToLibrary(book({ title: runTitle('Newer') }))
    const maxs = await createLibrary(max.client).addToLibrary(book({ title: runTitle('Max only') }))

    const list = (await idas.entries('want_to_read')).data!.map((entry) => entry.id)
    expect(list.indexOf(newer.data!.id)).toBeLessThan(list.indexOf(older.data!.id))
    expect(list).not.toContain(maxs.data!.id)
    expect((await idas.entries('reading')).data).toEqual([])
  })
})

describe('reading the Catalogue', () => {
  it('finds an added Book by its Apple id or ISBN, with the member\'s entry for it', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const isbn13 = await unusedIsbn13()
    const piranesi = book({ isbn13 })
    const { data: entry } = await createLibrary(ida.client).addToLibrary(piranesi)

    const maxs = createLibrary(max.client)
    expect((await maxs.catalogueBook({ appleId: piranesi.appleId! })).data?.id).toBe(entry!.book.id)
    expect((await maxs.catalogueBook({ isbn13 })).data?.id).toBe(entry!.book.id)
    expect((await maxs.book(entry!.book.id)).data?.title).toBe(piranesi.title)
    // The Book is shared; Ida's entry for it is not.
    expect((await maxs.entryForBook(entry!.book.id)).data).toBeNull()
    expect((await createLibrary(ida.client).entryForBook(entry!.book.id)).data?.id).toBe(entry!.id)
  })

  it('tells search which results are already in the Library', async () => {
    const ida = await signUpMember()
    const library = createLibrary(ida.client)
    const inLibrary = book()
    const elsewhere = uniqueAppleId()
    await library.addToLibrary(inLibrary)

    const statuses = (await library.statusesByAppleId([inLibrary.appleId!, elsewhere])).data!
    expect(statuses.get(inLibrary.appleId!)?.status).toBe('want_to_read')
    expect(statuses.has(elsewhere)).toBe(false)
  })

  it('gives search the stored cover of results already in the Catalogue', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const catalogued = book()
    await createLibrary(ida.client).addToLibrary(catalogued)

    const covers = (await createLibrary(max.client).catalogueByAppleId([catalogued.appleId!, uniqueAppleId()])).data!
    expect([...covers.keys()]).toEqual([catalogued.appleId])
    expect(covers.get(catalogued.appleId!)).toMatchObject({
      coverThumbhash: catalogued.coverThumbhash,
      coverColors: catalogued.coverColors,
    })
  })
})

/** A valid ISBN-13 no Catalogue Book has yet. */
async function unusedIsbn13(): Promise<string> {
  for (;;) {
    const body = `979${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`
    const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
    const isbn = `${body}${(10 - (sum % 10)) % 10}`
    const taken = await sql('select 1 from public.books where isbn13 = $1', [isbn])
    if (!taken.length) return isbn
  }
}
