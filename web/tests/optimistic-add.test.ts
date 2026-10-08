import { describe, expect, it } from 'vitest'
import { bookKey, sourceKeys, type BookSnapshot } from '@/data/books'
import { createLibrary, type EntryStatus, type LibraryEntry } from '@/data/library'
import { createOutbox, createSender, memoryOutboxStorage, type OutboxItem, type Send } from '@/data/outbox'
import { applyWrites, isLocalId, type WriteQueue } from '@/data/queuedWrites'
import { isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Adding a Book from search's results is optimistic: the add goes into the
 * outbox like an offline write and answers at once with the entry as it will be,
 * and the outbox sends it. Against the local stack as a real member, through the
 * repository the store uses: the entry it answers with, the line, what the
 * database ends up with, a refusal, a double tap, order, and the offline case.
 */

/** What a source says about a Book: no id, not in the Catalogue yet. */
function result(title: string, overrides: Partial<BookSnapshot> = {}): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Octavia E. Butler'],
    isbn13: null,
    isbn10: null,
    pageCount: 288,
    year: 1979,
    language: 'en',
    publisher: TEST_PUBLISHER,
    description: null,
    coverUrl: 'https://example.invalid/cover.jpg',
    coverThumbhash: null,
    coverColors: null,
    source: 'apple',
    appleId: uniqueAppleId(),
    openLibraryEditionKey: null,
    openLibraryWorkKey: null,
    ...overrides,
  }
}

const today = isoDay()

/** The phone as the stores make it: the device's Library copy, the outbox, the repository wired to both. */
function device(member: TestMember, { send, prepare }: { send?: Send; prepare?: (item: OutboxItem) => Promise<Record<string, unknown>> } = {}) {
  const copy = new Map<string, LibraryEntry>()
  const state = { offline: false, signedIn: true }
  const outbox = createOutbox({ memberId: member.id, storage: memoryOutboxStorage(), send: send ?? createSender(member.client), prepare })
  const queue: WriteQueue = {
    open: () => state.signedIn,
    holds: () => state.offline || outbox.items().length > 0,
    entry: (id) => copy.get(id) ?? null,
    entryForBook: (bookId) => [...copy.values()].find((entry) => entry.book.id === bookId || sourceKeys(entry.book).includes(bookId)) ?? null,
    collection: () => null,
    add: (write) => outbox.add(write),
  }
  const library = createLibrary(member.client, { online: () => !state.offline, queue })
  const keep = <T extends { data: LibraryEntry | null }>(answer: T): T => {
    if (answer.data) copy.set(answer.data.id, answer.data)
    return answer
  }
  return { state, outbox, copy, library, keep }
}

/** The member's entries as the database has them. */
async function onServer(member: TestMember): Promise<LibraryEntry[]> {
  const library = createLibrary(member.client)
  const statuses: EntryStatus[] = ['want_to_read', 'reading', 'finished']
  const lists = await Promise.all(statuses.map((status) => library.entries(status)))
  return lists.flatMap((list) => list.data ?? [])
}

describe('an optimistic add', () => {
  it('answers at once with the entry as it will be, and the database has nothing until the line is sent', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const hit = result('Kindred')

    const added = phone.keep(await phone.library.addToLibrary(hit, { status: 'want_to_read' }, { optimistic: true }))
    expect(added.error).toBeNull()
    // Online and nothing waiting: a plain add would have asked the database. This one did not.
    expect(await onServer(member)).toEqual([])
    expect(isLocalId(added.data!.id)).toBe(true)
    expect(added.data).toMatchObject({ status: 'want_to_read', latestSession: null, book: { title: hit.title, id: bookKey(hit) } })
    expect(phone.outbox.items()).toHaveLength(1)
    expect(phone.outbox.items()[0]).toMatchObject({ action: 'add_to_library', coverPending: true, about: hit.title })

    const report = await phone.outbox.flush()
    expect(report).toMatchObject({ refused: [], waiting: 0 })
    const [entry] = await onServer(member)
    expect(entry).toMatchObject({ status: 'want_to_read', book: { title: hit.title, appleId: hit.appleId } })
    expect(isLocalId(entry!.id)).toBe(false)
    // The page key the optimistic entry was reached by is one of the Catalogue's Book's own.
    expect(sourceKeys(entry!.book)).toContain(added.data!.book.id)
  })

  it('shows Currently reading and Finished with their first read, as the database will make it', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const reading = phone.keep(await phone.library.addToLibrary(result('Dawn'), { status: 'reading', startedOn: today }, { optimistic: true }))
    expect(reading.data).toMatchObject({ status: 'reading', latestSession: { startedOn: today, endedOn: null, outcome: null } })
    const finished = phone.keep(
      await phone.library.addToLibrary(result('Parable of the Sower'), { status: 'finished', startedOn: today, endedOn: today, rating: 18, review: 'Hard to put down.' }, { optimistic: true }),
    )
    expect(finished.data).toMatchObject({ status: 'finished', latestSession: { outcome: 'finished', rating: 18, review: 'Hard to put down.' } })

    expect(await phone.outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
    const entries = await onServer(member)
    expect(entries.map((entry) => entry.status).sort()).toEqual(['finished', 'reading'])
  })

  it('refuses a locally known duplicate at once, and a double tap puts one write in the line', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const hit = result('Wild Seed')
    const first = phone.keep(await phone.library.addToLibrary(hit, undefined, { optimistic: true }))
    expect(first.error).toBeNull()

    // The second tap, before the first one has synced: the same Book, refused on the device's copy.
    const second = await phone.library.addToLibrary({ ...hit }, undefined, { optimistic: true })
    expect(second).toEqual({ data: null, error: 'already_in_library' })
    expect(phone.outbox.items()).toHaveLength(1)

    await phone.outbox.flush()
    expect(await onServer(member)).toHaveLength(1)
    expect(phone.outbox.failures()).toEqual([])
  })

  it('keeps the order: a write on the new entry waits behind the add and finds the database\'s id once it synced', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const added = phone.keep(await phone.library.addToLibrary(result('Dawn'), undefined, { optimistic: true }))
    // The add has not synced: the line holds, so the next write waits behind it instead of overtaking it.
    const started = phone.keep(await phone.library.startReading(added.data!.id, today))
    expect(started.data).toMatchObject({ status: 'reading' })
    expect(phone.outbox.items().map((item) => item.action)).toEqual(['add_to_library', 'start_reading'])

    const report = await phone.outbox.flush()
    expect(report).toMatchObject({ refused: [], waiting: 0 })
    expect(report.taken.map((item) => item.action)).toEqual(['add_to_library', 'start_reading'])
    const [entry] = await onServer(member)
    expect(entry).toMatchObject({ status: 'reading', latestSession: { startedOn: today } })
  })

  it('resolves the Cover just before the send, once, and sends what it came back with', async () => {
    const member = await signUpMember()
    const prepared: string[] = []
    const phone = device(member, {
      prepare: async (item) => {
        prepared.push(item.about)
        return { ...item.args, p_book: { ...(item.args.p_book as object), cover_url: 'https://example.invalid/resolved.jpg' } }
      },
    })
    const hit = result('Fledgling')
    phone.keep(await phone.library.addToLibrary(hit, undefined, { optimistic: true }))
    // The tap did not wait for it: the entry shows the snapshot's own cover.
    expect(prepared).toEqual([])
    await phone.outbox.flush()
    expect(prepared).toEqual([hit.title])
    const [entry] = await onServer(member)
    expect(entry!.book.coverUrl).toBe('https://example.invalid/resolved.jpg')
  })

  it('still sends a Book whose Cover could not be resolved', async () => {
    const member = await signUpMember()
    const phone = device(member, { prepare: () => Promise.reject(new Error('probe failed')) })
    phone.keep(await phone.library.addToLibrary(result('Bloodchild'), undefined, { optimistic: true }))
    expect(await phone.outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
    expect(await onServer(member)).toHaveLength(1)
  })

  it('is a failure in the outbox when the database refuses it, and leaves nothing to show once the Library is read again', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const hit = result('Kindred')
    // Another device had it already: the phone's copy did not know.
    await createLibrary(member.client).addToLibrary(hit)

    const added = phone.keep(await phone.library.addToLibrary(hit, undefined, { optimistic: true }))
    expect(added.error).toBeNull()
    const waiting = [...phone.outbox.items()]

    const report = await phone.outbox.flush()
    expect(report.taken).toEqual([])
    expect(report.refused).toEqual([expect.objectContaining({ action: 'add_to_library', code: 'already_in_library', domain: 'library', about: hit.title })])
    expect(phone.outbox.failures()).toHaveLength(1)
    expect(phone.outbox.items()).toEqual([])
    // The database has the one entry it had; laid over with what still waits (nothing), the Library shows just that.
    const entries = await onServer(member)
    expect(entries).toHaveLength(1)
    const shown = applyWrites({ want_to_read: entries, reading: [], finished: [] }, phone.outbox.items())
    expect(shown.want_to_read).toEqual(entries)
    // While it waited, the same read would not have shown it twice either.
    const whileWaiting = applyWrites({ want_to_read: entries, reading: [], finished: [] }, waiting)
    expect(whileWaiting.want_to_read).toEqual(entries)
  })

  it('does not queue a snapshot nothing can name (the database says what is wrong), and the next add still goes', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const bad = result('No Way Home', { appleId: null, openLibraryEditionKey: null, isbn13: null })
    // A snapshot nothing can name: the device cannot even page it, so it is not queued; the database says why.
    const refused = await phone.library.addToLibrary(bad, undefined, { optimistic: true })
    expect(refused.error).not.toBeNull()
    expect(phone.outbox.items()).toEqual([])

    const good = phone.keep(await phone.library.addToLibrary(result('Imago'), undefined, { optimistic: true }))
    expect(good.error).toBeNull()
    expect(await phone.outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
  })

  it('does not show the entry twice while the database already has it and the add has not left the line', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const hit = result('Dawn')
    phone.keep(await phone.library.addToLibrary(hit, undefined, { optimistic: true }))
    const waiting = [...phone.outbox.items()]
    await phone.outbox.flush()
    // A read that lands between the database taking the add and the line forgetting it.
    const entries = await onServer(member)
    const shown = applyWrites({ want_to_read: entries, reading: [], finished: [] }, waiting)
    expect(shown.want_to_read).toHaveLength(1)
    expect(isLocalId(shown.want_to_read[0]!.id)).toBe(false)
  })

  it('waits when the device is offline, and goes when it is back', async () => {
    const member = await signUpMember()
    const phone = device(member)
    phone.state.offline = true
    const added = phone.keep(await phone.library.addToLibrary(result('Lilith\'s Brood'), { status: 'reading', startedOn: today }, { optimistic: true }))
    expect(added.error).toBeNull()
    expect(added.data).toMatchObject({ status: 'reading' })
    expect(await onServer(member)).toEqual([])

    phone.state.offline = false
    expect(await phone.outbox.flush()).toMatchObject({ refused: [], waiting: 0 })
    expect((await onServer(member))[0]).toMatchObject({ status: 'reading' })
  })

  it('keeps a search result online-only when the add is not optimistic (offline it is refused, as before)', async () => {
    const member = await signUpMember()
    const phone = device(member)
    phone.state.offline = true
    expect((await phone.library.addToLibrary(result('Clay\'s Ark'))).error).toBe('offline')
    expect(phone.outbox.items()).toEqual([])
  })

  it('asks the database as before when there is no line to write into', async () => {
    const member = await signUpMember()
    const phone = device(member)
    phone.state.signedIn = false
    const added = await phone.library.addToLibrary(result('Mind of My Mind'), undefined, { optimistic: true })
    expect(added.error).toBeNull()
    expect(isLocalId(added.data!.id)).toBe(false)
    expect(phone.outbox.items()).toEqual([])
    expect(await onServer(member)).toHaveLength(1)
  })

  it('never puts a Manual book in the line', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const manual = result('By Hand', { source: 'manual', appleId: null, isbn13: null })
    const added = await phone.library.addToLibrary(manual, undefined, { optimistic: true })
    expect(phone.outbox.items()).toEqual([])
    expect(added.data === null || !isLocalId(added.data.id)).toBe(true)
  })
})
