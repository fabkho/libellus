import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { hasImportedBooks } from '@/data/importedBooks'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Whether the member has an entry that came in through an import: what Home asks before it offers the
 * import to a member with a few entries (utils/importHint.ts holds the rest of the offer's rules).
 * Against the local stack, as a signed-in member.
 */

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 200,
    year: 1969,
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

describe('hasImportedBooks', () => {
  it('is false for a member with nothing in her Library, and for entries she added herself', async () => {
    const ada = await signUpMember()
    expect(await hasImportedBooks(ada.client)).toEqual({ data: false, error: null })

    await createLibrary(ada.client).addToLibrary(book('The Left Hand of Darkness'))
    expect(await hasImportedBooks(ada.client)).toEqual({ data: false, error: null })
  })

  it('is true once one entry carries an import key, whichever app it came from', async () => {
    const ada = await signUpMember()
    const library = createLibrary(ada.client)
    await library.addToLibrary(book('A Wizard of Earthsea'))
    const imported = (await library.addToLibrary(book('The Dispossessed'))).data!
    await sql('update public.library_entries set import_key = $1 where id = $2', [`goodreads:${imported.id}`, imported.id])

    expect(await hasImportedBooks(ada.client)).toEqual({ data: true, error: null })
  })

  it('does not count another member\'s import', async () => {
    const ada = await signUpMember()
    const bea = await signUpMember()
    const entry = (await createLibrary(bea.client).addToLibrary(book('The Lathe of Heaven'))).data!
    await sql('update public.library_entries set import_key = $1 where id = $2', [`hardcover:${entry.id}`, entry.id])
    await createLibrary(ada.client).addToLibrary(book('Always Coming Home'))

    expect(await hasImportedBooks(ada.client)).toEqual({ data: false, error: null })
    expect(await hasImportedBooks(bea.client)).toEqual({ data: true, error: null })
  })
})
