import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { createReaderPlaces } from '@/data/readerPlaces'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The reader's place kept server-side (issue #131, phase 2), through the
 * repository against the local stack, as real signed-in members: a place saved
 * on one device is read back on another, a save older than the stored one never
 * wins, a member sees none of another's places, and a save offline is refused
 * before anything is sent. Test Books carry the run tag and a fresh Apple id;
 * a member's places go with her when the run is swept.
 */

const CFI = 'epubcfi(/6/14[chap05]!/4/2/2[p17]:0)'
const LATER_CFI = 'epubcfi(/6/20!/4/2/2[p42]:0)'
const HASH_A = 'aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900'
const HASH_B = 'bb11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900'

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

function book(title: string): BookSnapshot {
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
    coverUrl: null,
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
  }
}

/** A member with one Book in her Library, and the repository under test. */
async function reader(title = 'The Dispossessed') {
  const member = await signUpMember()
  const entry = (await createLibrary(member.client).addToLibrary(book(title))).data!
  return { member, entryId: entry.id, places: createReaderPlaces(member.client) }
}

describe('her place in a book', () => {
  it('is none until she saves one, and is read back as it was saved', async () => {
    const { entryId, places } = await reader()
    expect(await places.get(entryId)).toEqual({ data: null, error: null })

    const saved = await places.save({ entryId, cfi: CFI, fraction: 0.25, fileHash: HASH_A, at: ago(60_000) })
    expect(saved.error).toBeNull()
    expect(saved.data).toMatchObject({ entryId, cfi: CFI, fraction: 0.25, fileHash: HASH_A })

    // What another device of hers reads when it opens the same Book.
    const read = await places.get(entryId)
    expect(read).toEqual({ data: saved.data, error: null })
    expect(Date.parse(read.data!.updatedAt)).toBeLessThanOrEqual(Date.now())
  })

  it('moves on as she reads, and never backwards', async () => {
    const { entryId, places } = await reader('The Left Hand of Darkness')
    await places.save({ entryId, cfi: CFI, fraction: 0.25, fileHash: HASH_A, at: ago(60_000) })
    const later = await places.save({ entryId, cfi: LATER_CFI, fraction: 0.5, fileHash: HASH_A, at: ago(10_000) })
    expect(later.data).toMatchObject({ cfi: LATER_CFI, fraction: 0.5 })

    // The other device had the Book open earlier and syncs now: its place is older.
    const older = await places.save({ entryId, cfi: CFI, fraction: 0.125, fileHash: HASH_B, at: ago(3_600_000) })
    expect(older.error).toBeNull()
    expect(older.data).toEqual(later.data)
    expect((await places.get(entryId)).data).toEqual(later.data)
  })

  it('is hers alone: another member reads none of it and saves none on her entry', async () => {
    const ada = await reader('A Wizard of Earthsea')
    await ada.places.save({ entryId: ada.entryId, cfi: CFI, fraction: 0.25, fileHash: HASH_A, at: ago(60_000) })

    const ben = await signUpMember()
    const hisPlaces = createReaderPlaces(ben.client)
    expect(await hisPlaces.get(ada.entryId)).toEqual({ data: null, error: null })
    expect(await hisPlaces.save({ entryId: ada.entryId, cfi: CFI, fraction: 0.9, fileHash: HASH_B, at: ago(1_000) })).toEqual({
      data: null,
      error: 'entry_not_found',
    })
    expect((await ada.places.get(ada.entryId)).data).toMatchObject({ cfi: CFI, fraction: 0.25 })
  })

  it('is not saved offline, and nothing is sent', async () => {
    const { member, entryId } = await reader('The Lathe of Heaven')
    const offline = createReaderPlaces(member.client, { online: () => false })
    expect(await offline.save({ entryId, cfi: CFI, fraction: 0.25, fileHash: HASH_A, at: ago(1_000) })).toEqual({
      data: null,
      error: 'offline',
    })
    expect(await createReaderPlaces(member.client).get(entryId)).toEqual({ data: null, error: null })
  })

  it('is refused when the place itself is wrong, here and in the database', async () => {
    const { member, entryId, places } = await reader('The Word for World Is Forest')
    const wrong = { entryId, cfi: CFI, fraction: 0.25, fileHash: HASH_A, at: ago(1_000) }
    expect(await places.save({ ...wrong, cfi: '' })).toEqual({ data: null, error: 'place_invalid' })
    expect(await places.save({ ...wrong, cfi: 'a'.repeat(2001) })).toEqual({ data: null, error: 'place_invalid' })
    expect(await places.save({ ...wrong, fraction: 1.5 })).toEqual({ data: null, error: 'place_invalid' })
    expect(await places.save({ ...wrong, fileHash: HASH_A.toUpperCase() })).toEqual({ data: null, error: 'place_invalid' })
    expect((await places.get(entryId)).data).toBeNull()

    // Whatever a client sends, the database refuses it too.
    const { error } = await member.client.rpc('save_reader_place', {
      p_entry_id: entryId,
      p_cfi: CFI,
      p_fraction: 2,
      p_file_hash: HASH_A,
      p_at: wrong.at,
    })
    expect(error?.message).toContain('place_invalid')
  })
})
