import { describe, expect, it } from 'vitest'
import type { BookSnapshot } from '@/data/books'
import { createLibrary } from '@/data/library'
import { createOutbox, createSender, memoryOutboxStorage, type Send } from '@/data/outbox'
import type { LocalHighlight } from '@/data/reader/device'
import {
  adoptLegacy,
  capExcerpt,
  createReaderHighlights,
  EXCERPT_MAX,
  fromAnotherCopy,
  highlightWrite,
  markSent,
  mergeHighlights,
  placedOn,
  stampAfter,
  TOMBSTONE_KEEP_MS,
  unsent,
  withHighlight,
  withoutHighlight,
  withoutHighlightId,
  type ReaderHighlight,
} from '@/data/readerHighlights'
import { signUpMember, type TestMember } from './support/member'
import { runTitle, TEST_PUBLISHER, uniqueAppleId } from './support/stack'

/**
 * The reader's highlights kept server-side (issue #131): the rules that merge
 * the device's list with the server's (last write wins per id, tombstones,
 * another copy of the book), the write that waits in the outbox offline, and
 * the whole trip through the repository and `sync_write` against the local
 * stack as real signed-in members: a highlight made on one phone is read back
 * by another, a removal wins over an older edit, nobody sees another member's.
 */

const HASH_A = 'aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900'
const HASH_B = 'bb11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900'
const CFI = 'epubcfi(/6/14[chap05]!/4/2,/1:0,/1:12)'
const iso = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 10, 12, 0) - minutesAgo * 60_000).toISOString()
const NOW = new Date(Date.UTC(2026, 9, 10, 12, 0))

let counter = 0
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`

function local(over: Partial<LocalHighlight> = {}): LocalHighlight {
  return {
    id: newId(),
    entryId: 'entry-1',
    fileHash: HASH_A,
    cfi: CFI,
    index: 3,
    color: 'sage',
    text: 'Fear is the mind-killer',
    note: null,
    createdAt: iso(30),
    updatedAt: iso(30),
    deletedAt: null,
    sent: true,
    ...over,
  }
}
const remote = (over: Partial<ReaderHighlight> = {}): ReaderHighlight => {
  const { sent: _sent, ...row } = local(over)
  return row
}

describe('merging the device with the server', () => {
  it('lets the newer change of each highlight win, whichever side it is on', () => {
    const a = local({ color: 'sage', updatedAt: iso(20) })
    const b = local({ color: 'sky', updatedAt: iso(20) })
    const merged = mergeHighlights([a, b], [remote({ ...a, color: 'rose', updatedAt: iso(10) }), remote({ ...b, color: 'lamp', updatedAt: iso(40) })], NOW)
    expect(merged.find((h) => h.id === a.id)?.color).toBe('rose')
    expect(merged.find((h) => h.id === b.id)?.color).toBe('sky')
  })

  it('takes the server\'s highlights this device never had, and keeps the ones the server has not got yet', () => {
    const mine = local({ sent: false })
    const theirs = remote({ cfi: 'epubcfi(/6/20!/4/2,/1:0,/1:4)', text: 'Arrakis' })
    const merged = mergeHighlights([mine], [theirs], NOW)
    expect(merged.map((h) => h.id).sort()).toEqual([mine.id, theirs.id].sort())
    expect(merged.find((h) => h.id === theirs.id)?.sent).toBe(true)
    expect(merged.find((h) => h.id === mine.id)?.sent).toBe(false)
  })

  it('keeps the device\'s newer change unsent, and marks the server\'s as nothing left to send', () => {
    const id = newId()
    const newer = local({ id, color: 'rose', updatedAt: iso(1), sent: false })
    expect(mergeHighlights([newer], [remote({ id, color: 'sage', updatedAt: iso(9) })], NOW)[0]).toMatchObject({ color: 'rose', sent: false })
    const older = local({ id, color: 'rose', updatedAt: iso(9), sent: false })
    expect(mergeHighlights([older], [remote({ id, color: 'sage', updatedAt: iso(1) })], NOW)[0]).toMatchObject({ color: 'sage', sent: true })
  })

  it('lets a removal beat an older edit, and an edit made after it bring the highlight back', () => {
    const id = newId()
    const removed = remote({ id, text: '', deletedAt: iso(5), updatedAt: iso(5) })
    const olderEdit = local({ id, color: 'rose', updatedAt: iso(8), sent: false })
    const [afterRemoval] = mergeHighlights([olderEdit], [removed], NOW)
    expect(afterRemoval?.deletedAt).not.toBeNull()
    expect(placedOn([afterRemoval!], HASH_A)).toEqual([])

    const laterEdit = local({ id, color: 'rose', updatedAt: iso(2), sent: false })
    const [back] = mergeHighlights([laterEdit], [removed], NOW)
    expect(back).toMatchObject({ deletedAt: null, color: 'rose' })
  })

  it('does not let a highlight removed on the server come back from a device that never heard', () => {
    const id = newId()
    const stale = local({ id, updatedAt: iso(30) })
    const [merged] = mergeHighlights([stale], [remote({ id, text: '', deletedAt: iso(3), updatedAt: iso(3) })], NOW)
    expect(merged?.deletedAt).toBe(iso(3))
  })

  it('lets old tombstones the server has go, and keeps the ones it may not have', () => {
    const old = new Date(NOW.getTime() - TOMBSTONE_KEEP_MS - 60_000).toISOString()
    const synced = local({ text: '', deletedAt: old, updatedAt: old, sent: true })
    const unsentOne = local({ text: '', deletedAt: old, updatedAt: old, sent: false })
    expect(mergeHighlights([synced, unsentOne], [], NOW).map((h) => h.id)).toEqual([unsentOne.id])
  })
})

describe('which copy of the book a highlight belongs to', () => {
  it('places the live highlights made in this file and lists the ones made in another, unplaced', () => {
    const here = local({ cfi: 'epubcfi(/6/2!/4/2:0)' })
    const there = local({ fileHash: HASH_B, text: 'From the other edition', createdAt: iso(20) })
    const earlierThere = local({ fileHash: HASH_B, text: 'Earlier', createdAt: iso(50) })
    const gone = local({ fileHash: HASH_B, text: '', deletedAt: iso(1), updatedAt: iso(1) })
    const list = [here, there, earlierThere, gone]
    expect(placedOn(list, HASH_A).map((h) => h.id)).toEqual([here.id])
    expect(fromAnotherCopy(list, HASH_A).map((h) => h.text)).toEqual(['Earlier', 'From the other edition'])
    // On the other copy it is the other way round.
    expect(placedOn(list, HASH_B)).toHaveLength(2)
    expect(fromAnotherCopy(list, HASH_B).map((h) => h.id)).toEqual([here.id])
  })
})

describe('what the member does on a copy', () => {
  const highlight = { cfi: CFI, color: 'lamp', text: 'Fear is the mind-killer', index: 3 } as const

  it('makes a highlight with an id, the copy it was made in and its words, unsent', () => {
    const [made] = withHighlight([], 'entry-1', HASH_A, highlight, NOW, newId)
    expect(made).toMatchObject({ entryId: 'entry-1', fileHash: HASH_A, color: 'lamp', text: 'Fear is the mind-killer', note: null, deletedAt: null, sent: false })
    expect(made?.createdAt).toBe(NOW.toISOString())
  })

  it('cuts the words at the cap, by characters', () => {
    expect(capExcerpt('é'.repeat(EXCERPT_MAX + 50))).toHaveLength(EXCERPT_MAX)
    expect(Array.from(capExcerpt('😀'.repeat(EXCERPT_MAX + 5)))).toHaveLength(EXCERPT_MAX)
    const [made] = withHighlight([], 'entry-1', HASH_A, { ...highlight, text: 'x'.repeat(5000) }, NOW, newId)
    expect(made?.text).toHaveLength(EXCERPT_MAX)
  })

  it('recolours the live highlight over the same range as a newer change of the same id', () => {
    const [first] = withHighlight([], 'entry-1', HASH_A, highlight, NOW, newId)
    const list = withHighlight([markSent([first!], first!.id, first!.updatedAt)[0]!], 'entry-1', HASH_A, { ...highlight, color: 'rose' }, new Date(NOW.getTime() + 5000), newId)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: first!.id, color: 'rose', sent: false, createdAt: first!.createdAt })
    expect(Date.parse(list[0]!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt))
  })

  it('removes as a tombstone with none of the words, newer than what it replaces, even on a clock that stepped back', () => {
    const made = local({ updatedAt: iso(-10), sent: true })
    const [removed] = withoutHighlight([made], HASH_A, CFI, NOW)
    expect(removed).toMatchObject({ id: made.id, text: '', note: null, sent: false })
    expect(removed!.deletedAt).toBe(removed!.updatedAt)
    expect(Date.parse(removed!.updatedAt)).toBeGreaterThan(Date.parse(made.updatedAt))
    // Nothing to remove over another copy's range.
    expect(withoutHighlight([made], HASH_B, CFI, NOW)[0]).toEqual(made)
  })

  it('makes a new highlight over a range whose last one was removed, not the old one back', () => {
    const [gone] = withoutHighlight([local()], HASH_A, CFI, NOW)
    const list = withHighlight([gone!], 'entry-1', HASH_A, highlight, NOW, newId)
    expect(list).toHaveLength(2)
    expect(list.filter((h) => h.deletedAt === null)).toHaveLength(1)
    expect(list.find((h) => h.deletedAt === null)?.id).not.toBe(gone!.id)
  })

  it('removes one of another copy by its id', () => {
    const there = local({ fileHash: HASH_B })
    const [removed] = withoutHighlightId([there], there.id, NOW)
    expect(removed).toMatchObject({ text: '', sent: false })
    expect(removed!.deletedAt).not.toBeNull()
  })

  it('stamps after the last change of the same highlight', () => {
    expect(stampAfter(null, NOW)).toBe(NOW.toISOString())
    expect(stampAfter(iso(5), NOW)).toBe(NOW.toISOString())
    expect(stampAfter(iso(-5), NOW)).toBe(new Date(Date.parse(iso(-5)) + 1).toISOString())
  })

  it('marks a change handed over only if no newer one was made meanwhile', () => {
    const [h] = withHighlight([], 'entry-1', HASH_A, highlight, NOW, newId)
    const [changed] = withHighlight([h!], 'entry-1', HASH_A, { ...highlight, color: 'sky' }, new Date(NOW.getTime() + 1000), newId)
    expect(markSent([changed!], h!.id, h!.updatedAt)[0]?.sent).toBe(false)
    expect(markSent([changed!], h!.id, changed!.updatedAt)[0]?.sent).toBe(true)
  })
})

describe('the highlights from before the sync', () => {
  it('are given ids and the copy open now, and go up once', () => {
    const adopted = adoptLegacy(
      [
        { cfi: CFI, color: 'sky', text: 'Gregor', index: 1 },
        { cfi: 'epubcfi(/6/4!/4/2:0)', color: 'rose', text: 'x'.repeat(2000), index: 0 },
      ],
      HASH_A,
      'entry-1',
      NOW,
      newId,
    )
    expect(adopted).toHaveLength(2)
    expect(new Set(adopted.map((h) => h.id)).size).toBe(2)
    expect(adopted.every((h) => h.fileHash === HASH_A && h.entryId === 'entry-1' && !h.sent && h.deletedAt === null)).toBe(true)
    expect(adopted[1]?.text).toHaveLength(EXCERPT_MAX)
    expect(unsent(adopted)).toHaveLength(2)
    expect(unsent(adopted.map((h) => ({ ...h, sent: true })))).toEqual([])
  })
})

describe('the write that waits in the outbox', () => {
  it('carries the arguments of save_reader_highlight by name, and a removal without words', () => {
    const live = highlightWrite(remote({ note: 'mine' }), 'Dune')
    expect(live).toMatchObject({ action: 'save_reader_highlight', about: 'Dune' })
    expect(live.entryId).toBeUndefined()
    expect(live.args).toMatchObject({ p_entry_id: 'entry-1', p_file_hash: HASH_A, p_cfi: CFI, p_section_index: 3, p_color: 'sage', p_excerpt: 'Fear is the mind-killer', p_note: 'mine', p_deleted: false })
    const removed = highlightWrite(remote({ text: '', note: null, deletedAt: iso(2), updatedAt: iso(2) }), 'Dune')
    expect(removed.args).toMatchObject({ p_excerpt: '', p_note: null, p_deleted: true, p_at: iso(2) })
  })

  it('waits offline in order, survives a restart, and is sent once the connection is back', async () => {
    const sent: { action: string; args: Record<string, unknown> }[] = []
    let offline = true
    const send: Send = async (item) => {
      if (offline) return { kind: 'unreachable' }
      sent.push({ action: item.action, args: item.args })
      return { kind: 'taken', result: {} }
    }
    const storage = memoryOutboxStorage()
    const first = createOutbox({ memberId: 'm1', storage, send })
    const made = remote({ color: 'rose' })
    const removed = remote({ id: made.id, color: 'rose', text: '', deletedAt: iso(1), updatedAt: iso(1) })
    await first.add(highlightWrite(made, 'Dune'))
    await first.add(highlightWrite(removed, 'Dune'))
    expect((await first.flush()).waiting).toBe(2)

    // The app is closed and opened again: the line is read from the device.
    const second = createOutbox({ memberId: 'm1', storage, send })
    await second.ready
    expect(second.items().map((item) => item.args.p_deleted)).toEqual([false, true])
    offline = false
    second.wake()
    const report = await second.flush()
    expect(report).toMatchObject({ waiting: 0, refused: [] })
    expect(sent.map((s) => s.args.p_deleted)).toEqual([false, true])
  })
})

// ---------------------------------------------------- against the local stack

function book(title: string): BookSnapshot {
  return {
    title: runTitle(title),
    authors: ['Frank Herbert'],
    isbn13: null,
    isbn10: null,
    pageCount: 600,
    year: 1965,
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

/** A member with a Book in her Library, and the phone's outbox, which sends through the real `sync_write`. */
async function phoneOf(member: TestMember, entryId: string, storage = memoryOutboxStorage()) {
  const outbox = createOutbox({ memberId: member.id, storage, send: createSender(member.client) })
  return { outbox, repo: createReaderHighlights(member.client), entryId }
}

async function readerWithEntry(title = 'Dune') {
  const member = await signUpMember()
  const entry = (await createLibrary(member.client).addToLibrary(book(title))).data!
  return { member, entryId: entry.id }
}

describe('highlights through the database', () => {
  it('a highlight made on one phone is read back by another, with its copy, and a removal follows', async () => {
    const { member, entryId } = await readerWithEntry()
    const phoneA = await phoneOf(member, entryId)
    const [made] = withHighlight([], entryId, HASH_A, { cfi: CFI, color: 'sky', text: 'Fear is the mind-killer', index: 3 }, new Date(), newId)

    await phoneA.outbox.add(highlightWrite(made!, 'Dune'))
    expect(await phoneA.outbox.flush()).toMatchObject({ waiting: 0, refused: [] })

    // Another phone, nothing on it, signed in as the same member.
    const phoneB = await phoneOf(member, entryId)
    const read = await phoneB.repo.list(entryId)
    expect(read.error).toBeNull()
    expect(read.data).toEqual([expect.objectContaining({ id: made!.id, entryId, fileHash: HASH_A, cfi: CFI, index: 3, color: 'sky', text: 'Fear is the mind-killer', deletedAt: null })])
    expect(placedOn(mergeHighlights([], read.data!), HASH_A)).toHaveLength(1)
    expect(fromAnotherCopy(mergeHighlights([], read.data!), HASH_B)).toHaveLength(1)

    // Phone B removes it; phone A, which had it, learns of the tombstone.
    const [gone] = withoutHighlight(mergeHighlights([], read.data!), HASH_A, CFI, new Date(Date.now() + 1000))
    await phoneB.outbox.add(highlightWrite(gone!, 'Dune'))
    await phoneB.outbox.flush()
    const again = await phoneA.repo.list(entryId)
    expect(again.data).toEqual([expect.objectContaining({ id: made!.id, text: '', deletedAt: expect.any(String) })])
    expect(placedOn(mergeHighlights([{ ...made!, sent: true }], again.data!), HASH_A)).toEqual([])
  })

  it('applies a write once however often it is sent, and an older change never replaces a newer one', async () => {
    const { member, entryId } = await readerWithEntry('Emma')
    const phone = await phoneOf(member, entryId)
    const now = Date.now()
    const base = remote({ entryId, id: newId(), color: 'sage', updatedAt: new Date(now - 60_000).toISOString(), createdAt: new Date(now - 60_000).toISOString() })
    const newer = { ...base, color: 'rose' as const, updatedAt: new Date(now - 30_000).toISOString() }
    const older = { ...base, color: 'lamp' as const, updatedAt: new Date(now - 90_000).toISOString() }

    // The newer one reaches the database first, the older one (from a phone that was offline longer) after it.
    await phone.outbox.add(highlightWrite(newer, 'Emma'))
    await phone.outbox.add(highlightWrite(older, 'Emma'))
    expect(await phone.outbox.flush()).toMatchObject({ waiting: 0, refused: [] })
    expect((await phone.repo.list(entryId)).data).toEqual([expect.objectContaining({ id: base.id, color: 'rose' })])

    // A write whose answer was lost is sent again with the same id: the second send changes nothing.
    const item = await phone.outbox.add(highlightWrite({ ...newer, color: 'sky', updatedAt: new Date(now - 10_000).toISOString() }, 'Emma'))
    const direct = await member.client.rpc('sync_write', { p_request_id: item.id, p_action: item.action, p_args: item.args })
    expect(direct.data).toMatchObject({ replayed: false })
    await phone.outbox.flush()
    expect((await phone.repo.list(entryId)).data).toEqual([expect.objectContaining({ color: 'sky' })])
  })

  it('cuts words past the cap and keeps no words on a tombstone', async () => {
    const { member, entryId } = await readerWithEntry('Solaris')
    const phone = await phoneOf(member, entryId)
    const long = remote({ entryId, id: newId(), text: 'é'.repeat(1500), createdAt: new Date(Date.now() - 5000).toISOString(), updatedAt: new Date(Date.now() - 5000).toISOString() })
    await phone.outbox.add(highlightWrite(long, 'Solaris'))
    await phone.outbox.flush()
    const [stored] = (await phone.repo.list(entryId)).data!
    expect(Array.from(stored!.text)).toHaveLength(EXCERPT_MAX)

    // Even a client that sends words with a removal leaves none behind.
    const removed = await member.client.rpc('save_reader_highlight', {
      p_id: long.id, p_entry_id: entryId, p_file_hash: HASH_A, p_cfi: CFI, p_section_index: 3, p_color: 'sage',
      p_excerpt: 'still here?', p_note: 'and this', p_deleted: true, p_at: new Date().toISOString(),
    })
    expect(removed.error).toBeNull()
    expect((await phone.repo.list(entryId)).data).toEqual([expect.objectContaining({ text: '', note: null, deletedAt: expect.any(String) })])
  })

  it('shows a member none of another\'s highlights, and refuses one on an entry that is not hers', async () => {
    const ada = await readerWithEntry('Ubik')
    const ben = await signUpMember()
    const phone = await phoneOf(ada.member, ada.entryId)
    const mine = remote({ entryId: ada.entryId, id: newId(), createdAt: iso(-1), updatedAt: iso(-1) })
    await phone.outbox.add(highlightWrite({ ...mine, createdAt: new Date(Date.now() - 5000).toISOString(), updatedAt: new Date(Date.now() - 5000).toISOString() }, 'Ubik'))
    await phone.outbox.flush()

    expect((await createReaderHighlights(ben.client).list(ada.entryId)).data).toEqual([])
    const refused = await createOutbox({ memberId: ben.id, storage: memoryOutboxStorage(), send: createSender(ben.client) })
    await refused.add(highlightWrite({ ...mine, id: newId() }, 'Ubik'))
    const report = await refused.flush()
    expect(report.refused).toEqual([expect.objectContaining({ action: 'save_reader_highlight', code: 'entry_not_found' })])
  })

  it('goes with the member when she deletes her account', async () => {
    const { member, entryId } = await readerWithEntry('Roadside Picnic')
    const phone = await phoneOf(member, entryId)
    await phone.outbox.add(highlightWrite(remote({ entryId, id: newId(), createdAt: new Date(Date.now() - 5000).toISOString(), updatedAt: new Date(Date.now() - 5000).toISOString() }), 'Roadside Picnic'))
    await phone.outbox.flush()
    expect((await phone.repo.list(entryId)).data).toHaveLength(1)
    const deleted = await member.client.rpc('delete_my_account')
    expect(deleted.error).toBeNull()
    const { sql } = await import('./support/stack')
    const left = await sql<{ n: string }>('select count(*) as n from public.reader_highlights where entry_id = $1', [entryId])
    expect(Number(left[0]?.n)).toBe(0)
  })

  it('is not read offline, before anything is sent', async () => {
    const { member, entryId } = await readerWithEntry('Hyperion')
    expect(await createReaderHighlights(member.client, { online: () => false }).list(entryId)).toEqual({ data: null, error: 'offline' })
  })
})
