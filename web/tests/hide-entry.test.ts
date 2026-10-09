import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary, entryFromRow, type EntryRow, type LibraryEntry } from '@/data/library'
import { createOutbox, createSender, memoryOutboxStorage } from '@/data/outbox'
import { applyWrite, QUEUED_ACTIONS, type QueuedWrite, type WriteQueue } from '@/data/queuedWrites'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * Hide a Book from followers (social v1, W3): `setHidden` through the Library repository against the
 * social stack, online and queued. What a hidden entry does to what others see is the database's
 * (supabase/tests); here: the flag reaches the app, another member's entry is `entry_not_found`, and a
 * hide made offline waits in the outbox as `set_entry_hidden`, shows at once, and syncs through `sync_write`.
 */

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Ursula K. Le Guin'],
    isbn13: null,
    isbn10: null,
    pageCount: 250,
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

/** The phone, as outbox.test.ts makes it: the device's copy of the Library, the outbox and the switch. */
function device(member: TestMember) {
  const copy = new Map<string, LibraryEntry>()
  const state = { offline: false }
  const outbox = createOutbox({ memberId: member.id, storage: memoryOutboxStorage(), send: createSender(member.client) })
  const queue: WriteQueue = {
    open: () => true,
    holds: () => state.offline || outbox.items().length > 0,
    entry: (id) => copy.get(id) ?? null,
    entryForBook: (bookId) => [...copy.values()].find((entry) => entry.book.id === bookId) ?? null,
    collection: () => null,
    add: (write) => outbox.add(write),
  }
  const library = createLibrary(member.client, { online: () => !state.offline, queue })
  const keep = <T extends { data: LibraryEntry | null; error: unknown }>(result: T): T => {
    if (result.data) copy.set(result.data.id, result.data)
    return result
  }
  return { state, outbox, library, keep }
}

describe('hiding a Book from followers', () => {
  it('sets and clears the flag, and the entry read back has it', async () => {
    const member = await signUpMember()
    const library = createLibrary(member.client)
    const entry = (await library.addToLibrary(book('Hidden Online'))).data!
    expect(entry.hidden).toBe(false)

    const hidden = await library.setHidden(entry.id, true)
    expect(hidden.error).toBeNull()
    expect(hidden.data).toMatchObject({ id: entry.id, hidden: true })
    expect((await library.entry(entry.id)).data?.hidden).toBe(true)
    expect((await library.entries('want_to_read')).data?.find((one) => one.id === entry.id)?.hidden).toBe(true)

    const shown = await library.setHidden(entry.id, false)
    expect(shown.data).toMatchObject({ id: entry.id, hidden: false })
    expect((await library.entry(entry.id)).data?.hidden).toBe(false)
  })

  it("refuses another member's entry with entry_not_found", async () => {
    const ada = await signUpMember()
    const ben = await signUpMember()
    const entry = (await createLibrary(ada.client).addToLibrary(book('Ada Only'))).data!

    expect(await createLibrary(ben.client).setHidden(entry.id, true)).toEqual({ data: null, error: 'entry_not_found' })
    expect(await createLibrary(ben.client).setHidden('not-an-id', true)).toEqual({ data: null, error: 'entry_not_found' })
    expect((await createLibrary(ada.client).entry(entry.id)).data?.hidden).toBe(false)
  })

  it('is refused offline when nothing can wait', async () => {
    const member = await signUpMember()
    const entry = (await createLibrary(member.client).addToLibrary(book('No Outbox'))).data!
    expect(await createLibrary(member.client, { online: () => false }).setHidden(entry.id, true)).toEqual({ data: null, error: 'offline' })
    expect((await createLibrary(member.client).entry(entry.id)).data?.hidden).toBe(false)
  })

  it('waits in the outbox when offline, shows at once, and syncs through sync_write', async () => {
    const member = await signUpMember()
    const phone = device(member)
    const entry = phone.keep(await phone.library.addToLibrary(book('Hidden Offline'))).data!

    phone.state.offline = true
    const hidden = phone.keep(await phone.library.setHidden(entry.id, true))
    expect(hidden.error).toBeNull()
    expect(hidden.data).toMatchObject({ id: entry.id, hidden: true, status: 'want_to_read' })
    expect(phone.outbox.items().map((item) => ({ action: item.action, args: item.args }))).toEqual([
      { action: 'set_entry_hidden', args: { p_entry: entry.id, p_hidden: true } },
    ])
    // Nothing reached the database yet.
    expect((await createLibrary(member.client).entry(entry.id)).data?.hidden).toBe(false)

    phone.state.offline = false
    const report = await phone.outbox.flush()
    expect(report).toMatchObject({ refused: [], waiting: 0, retryAt: null })
    expect(report.taken.map((item) => item.action)).toEqual(['set_entry_hidden'])
    expect((await createLibrary(member.client).entry(entry.id)).data?.hidden).toBe(true)

    // And back again, while earlier writes wait (online, but the line is not empty).
    phone.state.offline = true
    const shown = phone.keep(await phone.library.setHidden(entry.id, false))
    expect(shown.data?.hidden).toBe(false)
    phone.state.offline = false
    await phone.outbox.flush()
    expect((await createLibrary(member.client).entry(entry.id)).data?.hidden).toBe(false)
  })
})

describe('a hide as the device applies it', () => {
  const write = (args: Record<string, unknown>): QueuedWrite => ({ action: 'set_entry_hidden', args, about: 'A Book', queuedAt: new Date().toISOString(), entryId: 'e1' })
  const row = {
    id: 'e1',
    status: 'want_to_read',
    added_at: '2026-01-01T00:00:00Z',
    page_count_override: null,
    book: { id: 'b1', title: 'A Book', authors: [], created_at: '2026-01-01T00:00:00Z', source: 'apple' },
    latest: null,
  } as unknown as EntryRow

  it('is a queued action, and moves nothing but the flag', () => {
    expect(QUEUED_ACTIONS).toContain('set_entry_hidden')
    const entry = entryFromRow(row)
    expect(applyWrite(entry, write({ p_entry: 'e1', p_hidden: true }))).toEqual({ ...entry, hidden: true })
    expect(applyWrite({ ...entry, hidden: true }, write({ p_entry: 'e1', p_hidden: false }))).toEqual({ ...entry, hidden: false })
    expect(applyWrite(null, write({ p_entry: 'e1', p_hidden: true }))).toBe('entry_not_found')
  })

  it('reads as false for a row or a device copy that has no hidden', () => {
    expect(entryFromRow(row).hidden).toBe(false)
    expect(entryFromRow({ ...row, hidden: true }).hidden).toBe(true)
    const kept = { ...entryFromRow(row) } as Partial<LibraryEntry>
    delete kept.hidden
    expect(applyWrite(kept as LibraryEntry, write({ p_entry: 'e1', p_hidden: true }))).toMatchObject({ hidden: true })
  })
})
