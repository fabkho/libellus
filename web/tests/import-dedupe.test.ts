import { randomInt } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createCatalogueSearch } from '@/data/catalogueSearch'
import { entryFor, importedKeys, libraryIndex, libraryTitleIndex } from '@/data/import/dedupe'
import type { ImportBook } from '@/data/import/rows'
import { createLibrary } from '@/data/library'
import { createManualBooks } from '@/data/manualBooks'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The device's questions about what she has already (data/import/dedupe.ts), asked directly: whether she holds a row's book
 * under any edition (`libraryIndex`, `libraryTitleIndex`, `entryFor`) and which entries an earlier import of a supported
 * app's export made (`importedKeys`). The same rules are exercised through the match engine in goodreads-import.test.ts and
 * hardcover-import.test.ts; here they are the subject, so a change to them is caught by a test that names them. Against the
 * local stack, as a real signed-in member, like the rest of the data layer.
 */

/** A valid ISBN-13 no real book has (979-0, the music range), unique enough per run. */
function uniqueIsbn(): string {
  const body = `9790${String(randomInt(0, 1e8)).padStart(8, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}

function snapshot(overrides: Partial<BookSnapshot>): BookSnapshot {
  return {
    title: runTitle('Snapshot'),
    authors: ['A. Writer'],
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
    ...overrides,
  }
}

/** A file's row, as much of one as the title index reads. */
const row = (over: Partial<Pick<ImportBook, 'title' | 'authors' | 'status' | 'session' | 'otherKeys'>> = {}) => ({
  title: runTitle('Row'),
  authors: ['A. Writer'],
  status: 'finished' as const,
  session: { startedOn: null, endedOn: '2024-03-09', rating: null, review: null, outcome: 'finished' as const, progress: null },
  otherKeys: [],
  ...over,
})

describe('what she has already, on the device side of the import', () => {
  it('answers a Book by its id, its ISBN, its Apple id or its Open Library key, and a Manual book by title and first author', async () => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    const added = await library.addToLibrary(snapshot({ title: runTitle('The Lighthouse'), isbn13: uniqueIsbn() }), { status: 'finished', endedOn: '2024-03-09' })
    expect(added.error).toBeNull()
    const manual = await createManualBooks(ada.client).addManualBook({ title: runTitle('My Own Copy'), author: 'Somebody Else', pageCount: '320' })
    expect(manual.error).toBeNull()
    // The whole Library, as the upload path reads it.
    const entries = await createCatalogueSearch(ada.client).libraryEntries()
    const held = libraryIndex(entries)

    // The Book itself, and a source's snapshot of the same edition: its ISBN is enough.
    expect(held(added.data!.book)?.id).toBe(added.data!.id)
    const { id: _id, ...asSnapshot } = added.data!.book
    expect(held(asSnapshot as never)?.id).toBe(added.data!.id)
    // A Manual book is told by its title and first author, whichever way she capitalised the title.
    const manualHers = entries.find((entry) => entry.id === manual.data!.id)!.book
    expect(held({ ...manualHers, title: manualHers.title.toUpperCase() } as never)?.id).toBe(manual.data!.id)
    // Another edition of anything else: nothing of hers.
    expect(held({ ...(asSnapshot as object), isbn13: uniqueIsbn(), appleId: uniqueAppleId(), openLibraryEditionKey: null } as never)).toBeNull()
    // `entryFor` is the same question, one Book at a time.
    expect(entryFor(added.data!.book, entries)?.id).toBe(added.data!.id)
    expect(entryFor({ ...added.data!.book, id: 'no-such-book' } as never, entries)).toBeNull()
  })

  it('finds the entry she holds under another edition by work title and surname, and leaves a namesake or another day alone', async () => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    const title = runTitle('Harbour Lights')
    const mine = await library.addToLibrary(snapshot({ title, authors: ['Mira Okafor'], isbn13: uniqueIsbn() }), { status: 'finished', endedOn: '2024-03-09' })
    expect(mine.error).toBeNull()
    // Change edition: her entry's Book is no longer the one this row's ISBN finds.
    const changed = await library.changeEdition(mine.data!.id, snapshot({ title: `${title}: Volume One`, authors: ['M. Okafor'], isbn13: uniqueIsbn() }))
    expect(changed.error).toBeNull()
    // The same title, another author: another book.
    const namesake = await library.addToLibrary(snapshot({ title, authors: ['Someone Else'], isbn13: uniqueIsbn() }), { status: 'want_to_read' })
    expect(namesake.error).toBeNull()

    const entries = await createCatalogueSearch(ada.client).libraryEntries()
    const owned = libraryTitleIndex(entries)
    expect(owned(row({ title, authors: ['Mira Okafor'] }))?.id).toBe(mine.data!.id)
    expect(owned(row({ title, authors: ['Nobody At All'] }))).toBeNull()
    // A finished row whose read ended on another day is another read of it.
    expect(owned(row({ title, authors: ['Mira Okafor'], session: { ...row().session, endedOn: '2020-01-01' } }))).toBeNull()
    // No end day known, or not a finished row: the title and the author are enough.
    expect(owned(row({ title, authors: ['Mira Okafor'], session: { ...row().session, endedOn: null } }))?.id).toBe(mine.data!.id)
    expect(owned(row({ title, authors: ['Mira Okafor'], status: 'want_to_read', session: null }))?.id).toBe(mine.data!.id)
    // A subtitle is dropped from the work title, so the row with one is the same book.
    expect(owned(row({ title: `${title}: A Novel`, authors: ['Mira Okafor'] }))?.id).toBe(mine.data!.id)
    // Another volume of the same series is another book.
    expect(owned(row({ title: `${title}: Volume Two`, authors: ['Mira Okafor'] }))).toBeNull()
  })

  it('never counts the entry this file made from another of its rows of the work as another edition she shelved', async () => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    const title = runTitle('Two Editions')
    const first = await library.addToLibrary(snapshot({ title, authors: ['Mira Okafor'], isbn13: uniqueIsbn() }), { status: 'want_to_read' })
    expect(first.error).toBeNull()
    const entries = await createCatalogueSearch(ada.client).libraryEntries()
    // The file's other row of this work made that entry: it is another edition she shelved, not a match.
    const siblings = libraryTitleIndex(entries, new Map([['goodreads:2', first.data!.id]]))
    expect(siblings(row({ title, authors: ['Mira Okafor'], otherKeys: ['goodreads:2'] }))).toBeNull()
    // Another row of the file did not make it: it is hers, under another edition.
    expect(siblings(row({ title, authors: ['Mira Okafor'], otherKeys: ['goodreads:9'] }))?.id).toBe(first.data!.id)
    // A row with no other keys at all (the last of its work in the file) is hers as well.
    expect(libraryTitleIndex(entries)(row({ title, authors: ['Mira Okafor'] }))?.id).toBe(first.data!.id)
  })

  it("answers the keys of every entry an import of a supported app made, and no other entry's", async () => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    const goodreads = (await library.addToLibrary(snapshot({ title: runTitle('Imported Once') }), { status: 'finished', endedOn: '2024-03-09' })).data!
    const other = (await library.addToLibrary(snapshot({ title: runTitle('Another App') }), { status: 'want_to_read' })).data!
    // An entry the app added carries no key, and is none of the file's rows.
    const added = (await library.addToLibrary(snapshot({ title: runTitle('By Hand') }), { status: 'want_to_read' })).data!
    await sql('update public.library_entries set import_key = $1 where id = $2', [`goodreads:${goodreads.id}`, goodreads.id])
    await sql('update public.library_entries set import_key = $1 where id = $2', [`reado:${other.id}`, other.id])

    const keys = await importedKeys(ada.client)
    expect(keys.error).toBeNull()
    // The supported app's key, and only it: another app's entry is not one this file's rows would meet again.
    expect([...keys.data!]).toEqual([[`goodreads:${goodreads.id}`, goodreads.id]])
    expect(keys.data!.has(`reado:${other.id}`)).toBe(false)
    expect(keys.data!.has(added.id)).toBe(false)
  })
})
