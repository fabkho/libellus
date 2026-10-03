import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createCatalogueSearch } from '@/data/catalogueSearch'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTag, runTitle, sql, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The own Catalogue as a search source, against the local stack, as real
 * signed-in members (issue #12). Test Books carry the run tag in their title,
 * and every query names it, so a query only ever finds this run's Books.
 */

function book(title: string, authors: string[]): BookSnapshot {
  return {
    title: runTitle(title),
    authors,
    isbn13: null,
    isbn10: null,
    pageCount: null,
    year: 2020,
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
  }
}

const titles = (found: { book: { title: string } }[]) => found.map((hit) => hit.book.title).sort()

describe('searching the Catalogue', () => {
  it('finds Books other members added by the beginnings of title and author words, accents ignored', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    await createLibrary(ida.client).addToLibrary(book('Klára und die Sonne', ['Kazuo Ishiguro']))
    await createLibrary(ida.client).addToLibrary(book('Die Straße', ['Klaus Önder']))

    const search = createCatalogueSearch(max.client)
    const tag = runTag()
    expect(titles(await search.search(`klara son ${tag}`))).toEqual([runTitle('Klára und die Sonne')])
    expect(titles(await search.search(`ISHIGURO ${tag}`))).toEqual([runTitle('Klára und die Sonne')])
    expect(titles(await search.search(`strasse onder ${tag}`))).toEqual([runTitle('Die Straße')])
    expect(titles(await search.search(`kla ${tag}`))).toEqual([runTitle('Die Straße'), runTitle('Klára und die Sonne')])
    expect(await search.search(`lara ${tag}`)).toEqual([])
    // What it finds comes as Catalogue Books, with their ids.
    const [found] = await search.search(`klara ${tag}`)
    expect(found).toMatchObject({ source: 'catalogue', book: { id: expect.any(String), authors: ['Kazuo Ishiguro'] } })
  })

  it('finds an ISBN, an ISBN-10 converted', async () => {
    const ida = await signUpMember()
    // An ISBN no real Book in a developer's Catalogue has: 979 and a run-unique body.
    const body = `9799${String(Date.now()).slice(-8)}`
    const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0)
    const isbn13 = `${body}${(10 - (sum % 10)) % 10}`
    await createLibrary(ida.client).addToLibrary({ ...book('Numbered', ['Ida']), isbn13 })

    const found = await createCatalogueSearch(ida.client).search(isbn13.replace(/^(\d{3})(\d{4})/, '$1-$2-'))
    expect(found.map((hit) => hit.book.isbn13)).toEqual([isbn13])
  })

  it('brings the member\'s own Manual books along, never another member\'s', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    for (const member of [ida, max]) {
      await sql(`insert into public.books (title, authors, source, owner_id) values ($1, $2, 'manual', $3)`, [
        runTitle(`Notizbuch ${member === ida ? 'Ida' : 'Max'}`),
        ['Someone'],
        member.id,
      ])
    }
    const tag = runTag()
    expect(titles(await createCatalogueSearch(ida.client).search(`notizbuch ${tag}`))).toEqual([runTitle('Notizbuch Ida')])
    expect(titles(await createCatalogueSearch(max.client).search(`notizbuch ${tag}`))).toEqual([runTitle('Notizbuch Max')])
  })

  it('reads the member\'s whole Library to mark what she has', async () => {
    const ida = await signUpMember()
    const added = await createLibrary(ida.client).addToLibrary(book('Piranesi', ['Susanna Clarke']))
    const entries = await createCatalogueSearch(ida.client).libraryEntries()
    expect(entries).toEqual([added.data])
  })
})
