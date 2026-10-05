import { describe, expect, it } from 'vitest'
import type { Book, BookSnapshot } from '@/data/books'
import { createCollections, type CollectionSummary } from '@/data/collections'
import { createLibrary, type EntryStatus, type LibraryEntry } from '@/data/library'
import {
  backoff,
  createOutbox,
  createSender,
  GIVE_UP_AFTER,
  memoryOutboxStorage,
  type OutboxItem,
  type Send,
} from '@/data/outbox'
import { NO_PROGRESS } from '@/data/progress'
import { applyWrite, applyWrites, isLocalId, type WriteQueue } from '@/data/queuedWrites'
import { addDays, isoDay } from '@/utils/dates'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Save offline, sync later (issue #93) through the data layer: a write made
 * while the device is offline waits in the outbox and answers at once with the
 * entry as it will be; once the connection is back the outbox sends the writes
 * in order through `sync_write`, at most once each, against the local stack as
 * a real signed-in member. A write the database refuses leaves the line as a
 * failure and the ones behind it still go; a write whose answer was lost is not
 * applied twice; a pause between tries doubles; the line outlives a restart.
 */

function book(title: string, pageCount: number | null = 400): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount,
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

const today = isoDay()

/**
 * The phone, as the stores make it: the member's Library as the device holds it
 * (every answer lands there, as `entryChanged` does), the outbox on an in-memory
 * storage, and the repositories wired to both. `offline` is the switch.
 */
function device(member: TestMember, { send, storage = memoryOutboxStorage() }: { send?: Send; storage?: ReturnType<typeof memoryOutboxStorage> } = {}) {
  const copy = new Map<string, LibraryEntry>()
  const collections = new Map<string, CollectionSummary>()
  const state = { offline: false }
  const outbox = createOutbox({ memberId: member.id, storage, send: send ?? createSender(member.client) })
  const queue: WriteQueue = {
    holds: () => state.offline || outbox.items().length > 0,
    entry: (id) => copy.get(id) ?? null,
    entryForBook: (bookId) => [...copy.values()].find((entry) => entry.book.id === bookId) ?? null,
    collection: (id) => collections.get(id) ?? null,
    add: (write) => outbox.add(write),
  }
  const options = { online: () => !state.offline, queue }
  const library = createLibrary(member.client, options)
  const keep = <T extends { data: LibraryEntry | null; error: unknown }>(result: T): T => {
    if (result.data) copy.set(result.data.id, result.data)
    return result
  }
  return { state, outbox, storage, copy, collections, library, collectionsRepo: createCollections(member.client, options), keep }
}

/** The entry as the database has it now. */
async function server(member: TestMember, entryId: string) {
  return (await createLibrary(member.client).entry(entryId)).data
}

describe('a write made offline', () => {
  it('waits, answers with the entry as it will be, and syncs in order once online', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const added = phone.keep(await phone.library.addToLibrary(book('The Lathe of Heaven'), { status: 'want_to_read' }))
    const entryId = added.data!.id

    phone.state.offline = true
    const started = phone.keep(await phone.library.startReading(entryId, addDays(today, -2)))
    expect(started.error).toBeNull()
    expect(started.data?.status).toBe('reading')
    expect(isLocalId(started.data?.latestSession?.id)).toBe(true)
    const progressed = phone.keep(await phone.library.updateProgress(entryId, { page: 120 }, undefined, today))
    expect(progressed.data?.latestSession?.progressPage).toBe(120)
    const finished = phone.keep(await phone.library.finish(entryId, { endedOn: today, rating: 16, review: '  Dreams.  ' }))
    expect(finished.data?.status).toBe('finished')
    expect(finished.data?.latestSession).toMatchObject({ outcome: 'finished', rating: 16, review: 'Dreams.', progressPage: 120 })

    // Nothing reached the database yet.
    expect((await server(member, entryId))?.status).toBe('want_to_read')
    expect(phone.outbox.items().map((item) => item.action)).toEqual(['start_reading', 'update_progress', 'finish_reading'])
    // What the database would refuse is refused at once, and does not wait.
    expect((await phone.library.updateProgress(entryId, { page: 130 }, undefined, today)).error).toBe('not_reading')
    expect(phone.outbox.items()).toHaveLength(3)

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report).toMatchObject({ refused: [], waiting: 0, retryAt: null })
    expect(report.taken.map((item) => item.action)).toEqual(['start_reading', 'update_progress', 'finish_reading'])
    const synced = await server(member, entryId)
    expect(synced?.status).toBe('finished')
    expect(synced?.latestSession).toMatchObject({
      startedOn: addDays(today, -2),
      endedOn: today,
      rating: 16,
      review: 'Dreams.',
      progressPage: 120,
    })
  })

  it('syncs the Undo of a first save as a clear: the read goes back to none, not to page 0 (#104)', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const added = phone.keep(await phone.library.addToLibrary(book('The Dispossessed'), { status: 'reading', startedOn: today }))
    phone.state.offline = true
    phone.keep(await phone.library.updateProgress(added.data!.id, { page: 50 }, undefined, today))
    const undone = phone.keep(await phone.library.updateProgress(added.data!.id, NO_PROGRESS, undefined, today))
    // What the device shows meanwhile: no progress at all.
    expect(undone.data!.latestSession).toMatchObject({ progressPage: null, progressPercent: null, progressUpdatedAt: null })
    expect(phone.outbox.items().map((item) => item.args)).toEqual([
      expect.objectContaining({ p_page: 50 }),
      expect.objectContaining({ p_page: null, p_percent: null, p_clear: true }),
    ])

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report).toMatchObject({ refused: [], waiting: 0 })
    expect((await server(member, added.data!.id))?.latestSession).toMatchObject({
      progressPage: null,
      progressPercent: null,
      progressUpdatedAt: null,
    })
  })

  it('keeps writing into the line while earlier writes wait, even online, so they stay in order', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const added = phone.keep(await phone.library.addToLibrary(book('Always Coming Home'), { status: 'reading', startedOn: today }))
    phone.state.offline = true
    phone.keep(await phone.library.updateProgress(added.data!.id, { page: 50 }, undefined, today))
    phone.state.offline = false
    // Online again, but the first write has not synced: the second must not overtake it.
    phone.keep(await phone.library.updateProgress(added.data!.id, { page: 80 }, undefined, today))
    expect(phone.outbox.items().map((item) => item.args.p_page)).toEqual([50, 80])
    expect((await server(member, added.data!.id))?.latestSession?.progressPage).toBeNull()
    await phone.outbox.flush()
    expect((await server(member, added.data!.id))?.latestSession?.progressPage).toBe(80)
    // The line is empty: the next write goes straight to the database again.
    const direct = await phone.library.updateProgress(added.data!.id, { page: 90 }, undefined, today)
    expect(phone.outbox.items()).toHaveLength(0)
    expect(isLocalId(direct.data?.latestSession?.id)).toBe(false)
    expect((await server(member, added.data!.id))?.latestSession?.progressPage).toBe(90)
  })

  it('adds a Catalogue Book under a local id, and the writes behind it follow the database\'s id', async () => {
    const member = await signUpMember()
    const phone = device(member)
    // The Book is in the Catalogue (someone added it); the member removed hers.
    const first = await phone.library.addToLibrary(book('The Dispossessed', 380))
    const catalogued: Book = first.data!.book
    await phone.library.removeFromLibrary(first.data!.id)

    phone.state.offline = true
    expect((await phone.library.addToLibrary(book('A search result'))).error).toBe('offline')
    const added = phone.keep(await phone.library.addToLibrary(catalogued, { status: 'reading', startedOn: today }))
    expect(added.error).toBeNull()
    const localEntry = added.data!.id
    expect(isLocalId(localEntry)).toBe(true)
    expect(added.data).toMatchObject({ status: 'reading', book: { id: catalogued.id } })
    expect((await phone.library.addToLibrary(catalogued)).error).toBe('already_in_library')
    phone.keep(await phone.library.updateProgress(localEntry, { page: 30 }, undefined, today))
    phone.keep(await phone.library.abandon(localEntry, { endedOn: today, reason: 'Not now.' }))

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report.refused).toEqual([])
    const realId = (await createLibrary(member.client).entryForBook(catalogued.id)).data!.id
    expect(isLocalId(realId)).toBe(false)
    expect((await server(member, realId))?.latestSession).toMatchObject({ outcome: 'abandoned', abandonReason: 'Not now.', progressPage: 30 })
    // A write made later with the local id still finds the entry.
    phone.state.offline = true
    phone.keep(await phone.library.readAgain(localEntry, today))
    expect(phone.outbox.items()[0]?.args.p_entry_id).toBe(realId)
    phone.state.offline = false
    await phone.outbox.flush()
    expect((await server(member, realId))?.status).toBe('reading')
  })
})

describe('sending', () => {
  it('drops a write the database refuses as a failure, and still sends the ones behind it', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const a = phone.keep(await phone.library.addToLibrary(book('The Word for World Is Forest'), { status: 'reading', startedOn: today }))
    const b = phone.keep(await phone.library.addToLibrary(book('Lavinia'), { status: 'reading', startedOn: today }))

    phone.state.offline = true
    phone.keep(await phone.library.finish(a.data!.id, { endedOn: today }))
    phone.keep(await phone.library.updateProgress(b.data!.id, { page: 12 }, undefined, today))
    // Meanwhile, on another device, the first read is abandoned.
    await createLibrary(member.client).abandon(a.data!.id, { endedOn: today })

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report.taken.map((item) => item.action)).toEqual(['update_progress'])
    expect(report.refused).toEqual([expect.objectContaining({ action: 'finish_reading', code: 'not_reading', domain: 'library', about: runTitle('The Word for World Is Forest') })])
    expect(phone.outbox.failures()).toHaveLength(1)
    // The database stays as the other device left it; the store reads it again to undo what the phone showed.
    expect((await server(member, a.data!.id))?.latestSession?.outcome).toBe('abandoned')
    expect((await server(member, b.data!.id))?.latestSession?.progressPage).toBe(12)

    await phone.outbox.dismiss(report.refused[0]!.id)
    expect(phone.outbox.failures()).toEqual([])
  })

  it('never applies a write twice when its answer was lost', async () => {
    const member = await signUpMember()
    const real = createSender(member.client)
    let loseNext = true
    // The call reaches the database; the answer never reaches the phone.
    const send: Send = async (item) => {
      const outcome = await real(item)
      if (loseNext) {
        loseNext = false
        return { kind: 'unreachable' }
      }
      return outcome
    }
    let clock = Date.now()
    const storage = memoryOutboxStorage()
    const phone = device(member, { send, storage })
    const added = phone.keep(await phone.library.addToLibrary(book('Four Ways to Forgiveness'), { status: 'want_to_read' }))
    phone.state.offline = true
    phone.keep(await phone.library.startReading(added.data!.id, today))
    phone.state.offline = false

    const outbox = createOutbox({ memberId: member.id, storage, send, now: () => clock })
    await outbox.ready
    expect(outbox.items()).toHaveLength(1)
    const lost = await outbox.flush()
    expect(lost).toMatchObject({ taken: [], waiting: 1 })
    expect((await server(member, added.data!.id))?.status).toBe('reading')

    clock += backoff(1)
    const again = await outbox.flush()
    // Sent again: a replay, not `already_reading`, and no second read.
    expect(again).toMatchObject({ refused: [], waiting: 0 })
    expect((await createLibrary(member.client).sessions(added.data!.id)).data).toHaveLength(1)
  })
})

describe('the outbox', () => {
  const write = (n: number) => ({
    action: 'update_progress' as const,
    args: { p_entry_id: 'e', p_page: n },
    about: 'A Book',
    queuedAt: new Date(0).toISOString(),
    entryId: 'e',
  })

  it('pauses after a try that did not get through, longer each time, and wakes when the connection is back', async () => {
    let clock = 1_000_000
    const sent: number[] = []
    let reachable = false
    const outbox = createOutbox({
      memberId: 'm',
      storage: memoryOutboxStorage(),
      now: () => clock,
      send: async (item) => {
        if (!reachable) return { kind: 'unreachable' }
        sent.push(item.args.p_page as number)
        return { kind: 'taken', result: {} }
      },
    })
    await outbox.add(write(1))
    await outbox.add(write(2))
    expect(await outbox.flush()).toMatchObject({ waiting: 2, retryAt: clock + backoff(1) })
    expect(await outbox.flush()).toMatchObject({ waiting: 2, retryAt: clock + backoff(1) })
    clock += backoff(1)
    expect(await outbox.flush()).toMatchObject({ retryAt: clock + backoff(2) })
    expect(backoff(2)).toBe(2 * backoff(1))
    expect(backoff(30)).toBe(5 * 60_000)

    reachable = true
    // Still pausing …
    expect(await outbox.flush()).toMatchObject({ waiting: 2 })
    // … until the connection comes back.
    outbox.wake()
    expect(await outbox.flush()).toMatchObject({ waiting: 0 })
    expect(sent).toEqual([1, 2])
  })

  it(`gives a write up as a failure after ${GIVE_UP_AFTER} server errors`, async () => {
    let clock = 0
    const outbox = createOutbox({
      memberId: 'm',
      storage: memoryOutboxStorage(),
      now: () => clock,
      send: async () => ({ kind: 'failed', code: 'unknown' }),
    })
    await outbox.add(write(1))
    for (let i = 1; i < GIVE_UP_AFTER; i++) {
      expect(await outbox.flush()).toMatchObject({ waiting: 1 })
      clock += backoff(i)
    }
    expect(await outbox.flush()).toMatchObject({ waiting: 0, refused: [expect.objectContaining({ code: 'unknown' })] })
  })

  it('outlives a restart, for its member only', async () => {
    const storage = memoryOutboxStorage()
    const send: Send = async () => ({ kind: 'unreachable' })
    const before = createOutbox({ memberId: 'ida', storage, send })
    await before.add(write(1))
    await before.add(write(2))
    const after = createOutbox({ memberId: 'ida', storage, send })
    await after.ready
    expect(after.items().map((item: OutboxItem) => item.args.p_page)).toEqual([1, 2])
    const someoneElse = createOutbox({ memberId: 'max', storage, send })
    await someoneElse.ready
    expect(someoneElse.items()).toEqual([])
  })

  it('sends one write at a time, oldest first, even when asked twice at once', async () => {
    const order: number[] = []
    let inFlight = 0
    const outbox = createOutbox({
      memberId: 'm',
      storage: memoryOutboxStorage(),
      send: async (item) => {
        inFlight++
        expect(inFlight).toBe(1)
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push(item.args.p_page as number)
        inFlight--
        return { kind: 'taken', result: {} }
      },
    })
    for (const n of [1, 2, 3]) await outbox.add(write(n))
    await Promise.all([outbox.flush(), outbox.flush()])
    expect(order).toEqual([1, 2, 3])
  })
})

describe('Collections offline', () => {
  it('renames, reorders and takes a Book off a Collection the device holds, and syncs', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const one = phone.keep(await phone.library.addToLibrary(book('Tehanu')))
    const two = phone.keep(await phone.library.addToLibrary(book('Tales from Earthsea')))
    const shelf = (await phone.collectionsRepo.create(runTitle('Earthsea'))).data!
    phone.collections.set(shelf.id, shelf)
    await phone.collectionsRepo.addEntry(shelf.id, one.data!.book)

    phone.state.offline = true
    expect((await phone.collectionsRepo.rename(shelf.id, `  ${runTitle('Archipelago')} `)).data?.name).toBe(runTitle('Archipelago'))
    // A Book in her Library can go onto it; one that is not (a search result) cannot, offline.
    expect((await phone.collectionsRepo.addEntry(shelf.id, two.data!.book)).data?.id).toBe(two.data!.id)
    expect((await phone.collectionsRepo.addEntry(shelf.id, book('Not in her Library'))).error).toBe('offline')
    expect((await phone.collectionsRepo.reorder(shelf.id, [two.data!.id, one.data!.id])).error).toBeNull()
    expect((await phone.collectionsRepo.removeEntry(shelf.id, one.data!.id)).error).toBeNull()
    expect((await phone.collectionsRepo.rename('00000000-0000-4000-8000-000000000000', 'x')).error).toBe('offline')
    // Making a Collection stays online-only.
    expect((await phone.collectionsRepo.create(runTitle('Later'))).error).toBe('offline')

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report.refused).toEqual([])
    const synced = (await phone.collectionsRepo.get(shelf.id)).data!
    expect(synced.name).toBe(runTitle('Archipelago'))
    expect(synced.entries.map((entry) => entry.id)).toEqual([two.data!.id])
  })
})

describe('applyWrite / applyWrites', () => {
  const session = { id: 's', startedOn: '2026-01-02', endedOn: null, outcome: null, rating: null, review: null, abandonReason: null, progressPage: 40, progressPercent: null, progressUpdatedAt: null, createdAt: '2026-01-02T00:00:00Z' }
  const entry = (id: string, status: EntryStatus, latest = status === 'reading' ? session : null): LibraryEntry => ({
    id,
    status,
    addedAt: '2026-01-01T00:00:00Z',
    book: { ...book(id, 300), id: `book-${id}`, createdAt: '2026-01-01T00:00:00Z' },
    pageCountOverride: null,
    latestSession: latest,
  })
  const w = (action: Parameters<typeof applyWrite>[1]['action'], entryId: string, args: Record<string, unknown> = {}) => ({
    action,
    entryId,
    args: { p_entry_id: entryId, ...args },
    about: '',
    queuedAt: '2026-01-05T10:00:00Z',
  })

  it('refuses what the database would refuse, as its code', () => {
    expect(applyWrite(entry('a', 'want_to_read'), w('finish_reading', 'a'))).toBe('not_reading')
    expect(applyWrite(entry('a', 'reading'), w('start_reading', 'a'))).toBe('already_reading')
    expect(applyWrite(entry('a', 'want_to_read'), w('read_again', 'a'))).toBe('never_read')
    expect(applyWrite(entry('a', 'reading'), w('update_progress', 'a', { p_page: 301 }))).toBe('progress_invalid')
    expect(applyWrite(entry('a', 'reading'), w('finish_reading', 'a', { p_ended_on: '2026-01-01' }))).toBe('ended_before_started')
    expect(applyWrite(null, w('remove_from_library', 'a'))).toBe('entry_not_found')
  })

  it('clears the progress when the write says so, and refuses a clear that names a value', () => {
    const started = applyWrite(entry('a', 'reading'), w('update_progress', 'a', { p_page: 20 })) as LibraryEntry
    expect(started.latestSession).toMatchObject({ progressPage: 20 })
    const cleared = applyWrite(started, w('update_progress', 'a', { p_page: null, p_percent: null, p_clear: true }))
    expect(cleared).toMatchObject({ latestSession: { progressPage: null, progressPercent: null, progressUpdatedAt: null } })
    expect(applyWrite(started, w('update_progress', 'a', { p_page: 5, p_clear: true }))).toBe('progress_invalid')
  })

  it('sets her own total with the progress, and a total that repeats the edition\'s is none', () => {
    const own = applyWrite(entry('a', 'reading'), w('update_progress', 'a', { p_page: 20, p_set_page_count: true, p_page_count: 25 }))
    expect(own).toMatchObject({ pageCountOverride: 25, latestSession: { progressPage: 20 } })
    const cut = applyWrite(own as LibraryEntry, w('update_progress', 'a', { p_set_page_count: true, p_page_count: 10 }))
    expect(cut).toMatchObject({ pageCountOverride: 10, latestSession: { progressPage: 10 } })
    expect(applyWrite(own as LibraryEntry, w('update_progress', 'a', { p_set_page_count: true, p_page_count: 300 }))).toMatchObject({ pageCountOverride: null })
  })

  it('lays the waiting writes over a Library, each list in its order, and skips what no longer fits', () => {
    const lists = { want_to_read: [entry('a', 'want_to_read')], reading: [entry('b', 'reading')], finished: [] as LibraryEntry[] }
    const writes = [
      w('start_reading', 'a', { p_started_on: '2026-01-05' }),
      w('finish_reading', 'b', { p_ended_on: '2026-01-04' }),
      w('remove_from_library', 'gone'),
    ]
    const after = applyWrites(lists, writes)
    expect(after.want_to_read).toEqual([])
    expect(after.reading.map((e) => e.id)).toEqual(['a'])
    expect(after.finished.map((e) => e.id)).toEqual(['b'])
    // Laid over a copy that shows them already, they change nothing more.
    expect(applyWrites(after, writes)).toEqual(after)
  })
})
