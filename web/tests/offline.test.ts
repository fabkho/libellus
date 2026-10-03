import { describe, expect, it } from 'vitest'
import { createAuth } from '@/data/auth'
import type { BookSnapshot } from '@/data/books'
import { createCollections } from '@/data/collections'
import type { SessionStorage } from '@/data/createSupabaseClient'
import {
  DEVICE_COLLECTIONS_KEY,
  DEVICE_LIBRARY_KEY,
  forgetLibrary,
  readCollections,
  readLibrary,
  readSavedMember,
  saveCollections,
  saveLibrary,
} from '@/data/deviceLibrary'
import { createLibrary, type EntryStatus } from '@/data/library'
import { clearLocalData, LOCAL_DATA_PREFIX, type DeviceStorage } from '@/data/localData'
import { createManualBooks } from '@/data/manualBooks'
import { searchLibrary } from '@/data/search'
import { signUpMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Offline (issue #15) through the data layer: the member's Library is kept on
 * the device after a load and read back on the next start, it belongs to that
 * member only, signing out removes it, and a write without a connection is
 * refused before anything is sent. The Library itself comes from the local
 * stack, as a real signed-in member has it.
 */

/** localStorage, as far as the app uses it: the session and the device's copy share it, as in the browser. */
function browserStorage(quota = Infinity): SessionStorage & DeviceStorage & { keys: () => string[] } {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      const used = [...items].reduce((sum, [k, v]) => sum + (k === key ? 0 : k.length + v.length), 0)
      if (used + key.length + value.length > quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
    get length() {
      return items.size
    },
    key: (index) => [...items.keys()][index] ?? null,
    keys: () => [...items.keys()].sort(),
  }
}

function book(title: string, author = 'Odile Marsh', overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle(title),
    authors: [author],
    isbn13: null,
    isbn10: null,
    pageCount: 272,
    year: 2020,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: 'A house of endless halls and tides.',
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

const STATUSES: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']

/** A member with a Book in each Status (the finished one rated and reviewed) and a Collection holding two of them. */
async function memberWithLibrary(storage = browserStorage()) {
  const member = await signUpMember(storage)
  const library = createLibrary(member.client)
  const collections = createCollections(member.client)
  const want = (await library.addToLibrary(book('Halls of Tide'))).data!
  const reading = (await library.addToLibrary(book('The Night Lamp', 'Pell Ravenscar'), { status: 'reading', startedOn: '2026-09-20' })).data!
  const finished = (
    await library.addToLibrary(book('Winter Pages', 'Ilse Varga'), {
      status: 'finished',
      startedOn: '2026-08-01',
      endedOn: '2026-08-20',
      rating: 18,
      review: 'Cold and warm at once.',
    })
  ).data!
  const shelf = (await collections.create('Nightstand')).data!
  await collections.addEntry(shelf.id, want.book)
  await collections.addEntry(shelf.id, reading.book)
  return { member, storage, library, collections, want, reading, finished, shelf }
}

describe("the device's copy of the Library", () => {
  it('is what the last load saw, read back on the next start, latest sessions included', async () => {
    const { member, storage, library, collections, finished, shelf } = await memberWithLibrary()

    // A load, as the Library store does it: the three lists, then the copy.
    const lists = Object.fromEntries(
      await Promise.all(STATUSES.map(async (status) => [status, (await library.entries(status)).data!] as const)),
    ) as Record<EntryStatus, Awaited<ReturnType<typeof library.entries>>['data'] & object>
    expect(saveLibrary(storage, { member: { id: member.id, email: member.email }, lists, readInYear: { year: 2026, count: 1 } })).toBe(true)
    const list = (await collections.list()).data!
    const opened = (await collections.get(shelf.id)).data!
    expect(saveCollections(storage, { memberId: member.id, list, collections: [opened], memberships: {} })).toBe(true)

    // The next start: nothing but the storage.
    const saved = readLibrary(storage, member.id)
    expect(saved?.member).toEqual({ id: member.id, email: member.email })
    expect(saved?.lists).toEqual(lists)
    expect(saved?.lists.finished[0]?.latestSession).toMatchObject({
      id: finished.latestSession!.id,
      endedOn: '2026-08-20',
      rating: 18,
      review: 'Cold and warm at once.',
      outcome: 'finished',
    })
    expect(saved?.lists.reading[0]?.latestSession).toMatchObject({ startedOn: '2026-09-20', outcome: null })
    expect(saved?.readInYear).toEqual({ year: 2026, count: 1 })
    expect(readSavedMember(storage)).toEqual({ id: member.id, email: member.email })

    const savedCollections = readCollections(storage, member.id)
    expect(savedCollections?.list).toEqual(list)
    expect(savedCollections?.collections[0]?.entries.map((entry) => entry.book.title)).toEqual([
      runTitle('Halls of Tide'),
      runTitle('The Night Lamp'),
    ])
  })

  it("is only ever the member's own: another member starting on the device gets none of it", async () => {
    const storage = browserStorage()
    const { member, library } = await memberWithLibrary(storage)
    const want = (await library.entries('want_to_read')).data!
    saveLibrary(storage, { member: { id: member.id, email: member.email }, lists: { want_to_read: want, reading: [], finished: [] }, readInYear: null })
    saveCollections(storage, { memberId: member.id, list: [], collections: [], memberships: {} })

    const other = await signUpMember()
    expect(readLibrary(storage, other.id)).toBeNull()
    expect(readCollections(storage, other.id)).toBeNull()
  })

  it('is cleared when the member signs out, with the session', async () => {
    const storage = browserStorage()
    const { member, library } = await memberWithLibrary(storage)
    const want = (await library.entries('want_to_read')).data!
    saveLibrary(storage, { member: { id: member.id, email: member.email }, lists: { want_to_read: want, reading: [], finished: [] }, readInYear: null })
    saveCollections(storage, { memberId: member.id, list: [], collections: [], memberships: {} })
    storage.setItem('libellus-theme', 'dark')

    // What the session store's signOut does: end the session, then clear the device.
    await createAuth(member.client).signOut()
    clearLocalData(storage)

    expect(readLibrary(storage, member.id)).toBeNull()
    expect(readCollections(storage, member.id)).toBeNull()
    expect(readSavedMember(storage)).toBeNull()
    // The theme is the device's, not the member's: it stays.
    expect(storage.keys()).toEqual(['libellus-theme'])
  })

  it('can be forgotten on its own, leaving a pending sign-in alone', () => {
    const storage = browserStorage()
    storage.setItem(`${LOCAL_DATA_PREFIX}pendingSignIn`, '{"email":"a@libellus.test"}')
    saveLibrary(storage, { member: { id: 'm', email: 'm@libellus.test' }, lists: { want_to_read: [], reading: [], finished: [] }, readInYear: null })
    saveCollections(storage, { memberId: 'm', list: [], collections: [], memberships: {} })

    forgetLibrary(storage)

    expect(storage.keys()).toEqual([`${LOCAL_DATA_PREFIX}pendingSignIn`])
  })

  it('ignores (and removes) a copy it cannot read: torn, or of an older shape', () => {
    const storage = browserStorage()
    storage.setItem(DEVICE_LIBRARY_KEY, '{"version":1,"data":')
    expect(readLibrary(storage, 'm')).toBeNull()
    expect(storage.getItem(DEVICE_LIBRARY_KEY)).toBeNull()

    storage.setItem(DEVICE_COLLECTIONS_KEY, JSON.stringify({ version: 0, data: { memberId: 'm', list: [], collections: [] } }))
    expect(readCollections(storage, 'm')).toBeNull()
    expect(storage.getItem(DEVICE_COLLECTIONS_KEY)).toBeNull()
  })

  it('is dropped, not half-written, when the storage is full', () => {
    const storage = browserStorage(4_000)
    const member = { id: 'm', email: 'm@libellus.test' }
    const empty = { want_to_read: [], reading: [], finished: [] }
    expect(saveLibrary(storage, { member, lists: empty, readInYear: null })).toBe(true)

    const huge = Array.from({ length: 50 }, (_, i) => ({ id: String(i), note: 'x'.repeat(100) }))
    const tooMuch = { ...empty, want_to_read: huge as never[] }
    expect(saveLibrary(storage, { member, lists: tooMuch, readInYear: null })).toBe(false)
    // The older copy would be wrong now: there is none.
    expect(readLibrary(storage, 'm')).toBeNull()
  })
})

describe('writes without a connection', () => {
  it('are refused with `offline` before anything is sent', async () => {
    const member = await signUpMember()
    const offline = { online: () => false }
    const library = createLibrary(member.client, offline)
    const collections = createCollections(member.client, offline)

    expect(await library.addToLibrary(book('Halls of Tide'))).toEqual({ data: null, error: 'offline' })
    expect(await collections.create('Nightstand')).toEqual({ data: null, error: 'offline' })
    expect(await createManualBooks(member.client, offline).addManualBook({ title: 'Notebook', author: 'Me' })).toEqual({
      data: null,
      error: 'offline',
    })

    // Nothing reached the database. Reads are not refused: they fail on their own when the network does.
    expect((await library.entries('want_to_read')).data).toEqual([])
    expect((await collections.list()).data).toEqual([])
  })

  it('go through once the connection is back, on the same repository', async () => {
    const member = await signUpMember()
    let online = false
    const library = createLibrary(member.client, { online: () => online })
    const snapshot = book('Halls of Tide')

    expect((await library.addToLibrary(snapshot)).error).toBe('offline')
    online = true
    const added = await library.addToLibrary(snapshot)
    expect(added.error).toBeNull()
    expect((await library.startReading(added.data!.id, '2026-10-01')).data?.status).toBe('reading')
    online = false
    expect(await library.finish(added.data!.id, { endedOn: '2026-10-02' })).toEqual({ data: null, error: 'offline' })

    // The history's writes (#11) too: editing a read, deleting it, removing the Book.
    const read = (await library.entry(added.data!.id)).data!.latestSession!
    const edit = { startedOn: '2026-09-30', endedOn: '', rating: null, review: '', abandonReason: '' }
    expect(await library.updateSession(added.data!.id, read, edit)).toEqual({ data: null, error: 'offline' })
    expect(await library.deleteSession(added.data!.id, read.id)).toEqual({ data: null, error: 'offline' })
    expect(await library.removeFromLibrary(added.data!.id)).toEqual({ data: null, error: 'offline' })
    const still = (await library.entry(added.data!.id)).data!
    expect(still.latestSession).toMatchObject({ id: read.id, startedOn: '2026-10-01' })
  })
})

describe('search without a connection', () => {
  it("finds the member's own Books by title, author or ISBN, best match first", async () => {
    const { library } = await memberWithLibrary()
    const entries = (await Promise.all(STATUSES.map((status) => library.entries(status)))).flatMap((r) => r.data!)

    expect(searchLibrary(entries, 'halls').map((r) => r.book.title)).toEqual([runTitle('Halls of Tide')])
    expect(searchLibrary(entries, 'varga').map((r) => r.book.title)).toEqual([runTitle('Winter Pages')])
    expect(searchLibrary(entries, 'night lamp')[0]?.entry?.status).toBe('reading')
    // Not one of hers, or only some of the words: nothing.
    expect(searchLibrary(entries, 'dune')).toEqual([])
    expect(searchLibrary(entries, 'halls dune')).toEqual([])
  })

  it('finds an edition by its ISBN', () => {
    const entry = {
      id: 'e',
      status: 'want_to_read' as const,
      addedAt: '2026-10-01T00:00:00Z',
      book: { ...book('Halls of Tide', 'Odile Marsh', { isbn13: '9781526622426' }), id: 'b', createdAt: '2026-10-01T00:00:00Z' },
      latestSession: null,
    }
    expect(searchLibrary([entry], '978-1-5266-2242-6').map((r) => r.entry?.id)).toEqual(['e'])
    expect(searchLibrary([entry], '9780593318171')).toEqual([])
  })
})
