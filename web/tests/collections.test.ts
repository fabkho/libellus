import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createCollections, isValidName, normaliseName } from '@/data/collections'
import { createLibrary } from '@/data/library'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Collections through the repository, against the local stack, as real
 * signed-in members (issue #14). Test Books carry the run tag and a fresh
 * Apple id, so they never meet a real Catalogue Book and the teardown finds
 * them; a member's Collections go with her.
 */

function book(title: string, overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 304,
    year: 1969,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: `https://is1-ssl.mzstatic.com/image/thumb/${title.replace(/\W/g, '')}/600x900bb.jpg`,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

describe('names', () => {
  it('are kept trimmed, with inner runs of spaces collapsed, up to 80 characters', () => {
    expect(normaliseName('  Gifts   for\tMum ')).toBe('Gifts for Mum')
    expect(isValidName('Sci-fi')).toBe(true)
    expect(isValidName('   ')).toBe(false)
    expect(isValidName('x'.repeat(80))).toBe(true)
    expect(isValidName('x'.repeat(81))).toBe(false)
  })
})

describe('create, rename, delete', () => {
  it('creates Collections at the end of her list, one per name', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)

    const scifi = await collections.create('  Sci-fi ')
    expect(scifi.error).toBeNull()
    expect(scifi.data).toMatchObject({ name: 'Sci-fi', count: 0, covers: [] })
    const gifts = await collections.create('Gifts')

    const list = (await collections.list()).data!
    expect(list.map((c) => c.name)).toEqual(['Sci-fi', 'Gifts'])
    expect(list[0]!.id).toBe(scifi.data!.id)
    expect(list[1]!.id).toBe(gifts.data!.id)

    expect((await collections.create('SCI-FI')).error).toBe('name_taken')
    expect((await collections.create('  ')).error).toBe('name_invalid')
    expect((await collections.create('x'.repeat(81))).error).toBe('name_invalid')
  })

  it('renames a Collection, not onto another of her names', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!
    await collections.create('Gifts')

    const renamed = await collections.rename(scifi.id, 'Science fiction')
    expect(renamed.data?.name).toBe('Science fiction')
    expect((await collections.get(scifi.id)).data?.name).toBe('Science fiction')
    expect((await collections.rename(scifi.id, 'gifts')).error).toBe('name_taken')
    expect((await collections.rename(scifi.id, ' ')).error).toBe('name_invalid')
  })

  it('deletes a Collection and never the Books on it', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const library = createLibrary(ida.client)
    const gifts = (await collections.create('Gifts')).data!
    const entry = (await collections.addEntry(gifts.id, book('The Dispossessed'))).data!

    expect((await collections.delete(gifts.id)).error).toBeNull()

    expect((await collections.list()).data).toEqual([])
    expect((await collections.get(gifts.id)).data).toBeNull()
    expect((await library.entryForBook(entry.book.id)).data?.id).toBe(entry.id)
    expect((await collections.delete(gifts.id)).error).toBe('collection_missing')
  })
})

describe('addEntry', () => {
  it('puts a Book from search that is not in her Library on Want to read, in the same call', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const library = createLibrary(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!
    const leftHand = book('The Left Hand of Darkness')

    const { data: entry, error } = await collections.addEntry(scifi.id, leftHand)

    expect(error).toBeNull()
    expect(entry).toMatchObject({ status: 'want_to_read', book: { title: leftHand.title, appleId: leftHand.appleId } })
    expect((await library.entries('want_to_read')).data!.map((e) => e.id)).toContain(entry!.id)
    expect((await collections.get(scifi.id)).data!.entries.map((e) => e.id)).toEqual([entry!.id])
  })

  it('takes a Book already in her Library by its id, without a second entry', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const library = createLibrary(ida.client)
    const added = (await library.addToLibrary(book('Lathe of Heaven'))).data!
    const scifi = (await collections.create('Sci-fi')).data!
    const favourites = (await collections.create('Favourites')).data!

    const onScifi = await collections.addEntry(scifi.id, added.book)
    const onFavourites = await collections.addEntry(favourites.id, added.book)

    expect(onScifi.data?.id).toBe(added.id)
    expect(onFavourites.data?.id).toBe(added.id)
    expect((await library.entries('want_to_read')).data!.filter((e) => e.book.id === added.book.id)).toHaveLength(1)
    // Non-exclusive: the entry is on both.
    expect(new Set((await collections.memberships(added.id)).data)).toEqual(new Set([scifi.id, favourites.id]))
  })

  it('takes a search result already in her Library as the same entry', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const snapshot = book('Rocannon\'s World')
    const added = (await createLibrary(ida.client).addToLibrary(snapshot)).data!
    const scifi = (await collections.create('Sci-fi')).data!

    expect((await collections.addEntry(scifi.id, snapshot)).data?.id).toBe(added.id)
  })

  it('refuses the same Book twice on one Collection', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!
    const snapshot = book('Planet of Exile')
    await collections.addEntry(scifi.id, snapshot)

    expect((await collections.addEntry(scifi.id, snapshot)).error).toBe('already_in_collection')
  })

  it('refuses a Book that cannot enter the Catalogue, and a Collection that is not there', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!

    expect((await collections.addEntry(scifi.id, book('Nothing', { appleId: null }))).error).toBe('book_invalid')
    await collections.delete(scifi.id)
    expect((await collections.addEntry(scifi.id, book('City of Illusions'))).error).toBe('collection_missing')
  })
})

describe('the list and one Collection', () => {
  it('shows each Collection with its size and the covers of its first four, in her order', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!
    const titles = ['One', 'Two', 'Three', 'Four', 'Five'].map((t) => runTitle(t))
    const entries = []
    for (const title of titles) {
      entries.push((await collections.addEntry(scifi.id, book(title, { title }))).data!)
    }
    // The last one first: the mosaic follows her order, not the order added.
    await collections.reorder(scifi.id, [entries[4]!.id, ...entries.slice(0, 4).map((e) => e.id)])

    const [summary] = (await collections.list()).data!
    expect(summary).toMatchObject({ id: scifi.id, name: 'Sci-fi', count: 5 })
    expect(summary!.covers.map((b) => b.title)).toEqual([titles[4], titles[0], titles[1], titles[2]])
    expect(summary!.covers[0]!.coverUrl).toBe(entries[4]!.book.coverUrl)
  })

  it('reads one Collection with its entries and their Books', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!
    const entry = (await collections.addEntry(scifi.id, book('The Word for World Is Forest'))).data!

    const read = (await collections.get(scifi.id)).data!
    expect(read).toMatchObject({ id: scifi.id, name: 'Sci-fi' })
    expect(read.entries).toEqual([entry])
    expect((await collections.get('not-a-uuid')).data).toBeNull()
  })
})

describe('removeEntry and reorder', () => {
  it('takes an entry off a Collection; it stays in the Library and on her others', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const library = createLibrary(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!
    const gifts = (await collections.create('Gifts')).data!
    const entry = (await collections.addEntry(scifi.id, book('Malafrena'))).data!
    await collections.addEntry(gifts.id, entry.book)

    expect((await collections.removeEntry(scifi.id, entry.id)).error).toBeNull()

    expect((await collections.get(scifi.id)).data!.entries).toEqual([])
    expect((await collections.memberships(entry.id)).data).toEqual([gifts.id])
    expect((await library.entryForBook(entry.book.id)).data?.id).toBe(entry.id)
    expect((await collections.removeEntry(scifi.id, entry.id)).error).toBe('not_in_collection')
  })

  it('keeps the order she gives, and refuses one that is out of date', async () => {
    const ida = await signUpMember()
    const collections = createCollections(ida.client)
    const scifi = (await collections.create('Sci-fi')).data!
    const a = (await collections.addEntry(scifi.id, book('A'))).data!
    const b = (await collections.addEntry(scifi.id, book('B'))).data!
    const c = (await collections.addEntry(scifi.id, book('C'))).data!
    const order = async () => (await collections.get(scifi.id)).data!.entries.map((e) => e.id)
    expect(await order()).toEqual([a.id, b.id, c.id])

    expect((await collections.reorder(scifi.id, [c.id, a.id, b.id])).error).toBeNull()
    expect(await order()).toEqual([c.id, a.id, b.id])

    // Something was added elsewhere since: the old list no longer fits.
    const d = (await collections.addEntry(scifi.id, book('D'))).data!
    expect((await collections.reorder(scifi.id, [a.id, b.id, c.id])).error).toBe('order_mismatch')
    expect(await order()).toEqual([c.id, a.id, b.id, d.id])
  })
})

describe('privacy', () => {
  it('keeps a member\'s Collections to herself', async () => {
    const ida = await signUpMember()
    const max = await signUpMember()
    const idas = createCollections(ida.client)
    const maxs = createCollections(max.client)
    const scifi = (await idas.create('Sci-fi')).data!
    const entry = (await idas.addEntry(scifi.id, book('The Telling'))).data!

    expect((await maxs.list()).data).toEqual([])
    expect((await maxs.get(scifi.id)).data).toBeNull()
    expect((await maxs.memberships(entry.id)).data).toEqual([])
    expect((await maxs.rename(scifi.id, 'Mine')).error).toBe('collection_missing')
    expect((await maxs.addEntry(scifi.id, book('Four Ways to Forgiveness'))).error).toBe('collection_missing')
    expect((await maxs.removeEntry(scifi.id, entry.id)).error).toBe('collection_missing')
    expect((await maxs.reorder(scifi.id, [entry.id])).error).toBe('collection_missing')
    expect((await maxs.delete(scifi.id)).error).toBe('collection_missing')
    // Names are per member.
    expect((await maxs.create('Sci-fi')).error).toBeNull()
    expect((await idas.get(scifi.id)).data?.entries.map((e) => e.id)).toEqual([entry.id])
  })
})
