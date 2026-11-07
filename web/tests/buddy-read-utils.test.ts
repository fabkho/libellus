import { describe, expect, it } from 'vitest'
import type { SendJob } from '#layers/chat/app/types/adapter'
import { chapterFromJson, marksOf, messageFromJson, readFromJson, whereFromJson, type BuddyMember, type BuddyRead } from '@/data/buddyReads'
import { bumpCounts, clearUnread, countsOf, mergeBubble, pendingBubble, reactedBy, sentBubble, settleBubbles, tombstoneOf, type BuddyBubble } from '@/utils/buddyRead'

/** The pure rules of a buddy read thread (utils/buddyRead.ts) and the shapes (data/buddyReads.ts): no database, no store. */

const stored = (id: string, over: Partial<BuddyBubble> = {}): BuddyBubble =>
  sentBubble({ id, conversationId: 'r', threadId: 's', senderId: 'ben', clientId: `c-${id}`, kind: 'text', body: id, createdAt: `2026-11-13T10:00:00.${id.padStart(6, '0')}+00:00`, replyTo: null, spoiler: false, media: null, authorName: 'Ben', deletedAt: null, reactions: [], ...over })
const job = (clientId: string, createdAt = '2026-11-13T09:00:00.000Z'): SendJob => ({ conversationId: 'r', threadId: 's', clientId, kind: 'text', body: clientId, replyTo: null, spoiler: false, createdAt })

describe('a thread, oldest first', () => {
  it('puts a stored row where the server’s time says, microseconds kept, and a row seen before is not new', () => {
    const list: BuddyBubble[] = []
    expect(mergeBubble(list, stored('2'))).toBe(true)
    expect(mergeBubble(list, stored('3'))).toBe(true)
    // A catch-up brings one from between.
    expect(mergeBubble(list, stored('1'))).toBe(true)
    expect(list.map((m) => m.id)).toEqual(['1', '2', '3'])
    expect(mergeBubble(list, stored('2', { body: 'edited' }))).toBe(false)
    expect(list.map((m) => m.body)).toEqual(['1', 'edited', '3'])
  })

  it('keeps her bubbles after the stored rows, whatever her device’s clock said, until the stored row replaces them by client id', () => {
    const list: BuddyBubble[] = [stored('5')]
    mergeBubble(list, pendingBubble(job('mine', '2026-11-13T08:00:00.000Z'), 'ada', 'Ada'))
    mergeBubble(list, stored('6'))
    expect(list.map((m) => [m.id, m.state])).toEqual([['5', 'sent'], ['6', 'sent'], ['local:mine', 'sending']])
    // The row the database made: same client id, same sender.
    const row = stored('7', { senderId: 'ada', clientId: 'mine', authorName: null })
    expect(mergeBubble(list, row)).toBe(true)
    expect(list.map((m) => [m.id, m.state])).toEqual([['5', 'sent'], ['6', 'sent'], ['7', 'sent']])
    // Its echo on her other topic: the same row, not new, and the name she knew stays.
    expect(mergeBubble(list, row)).toBe(false)
  })

  it('keeps a failed bubble with its code among the rest, and what the thread knows of a live row’s author and reactions', () => {
    const list: BuddyBubble[] = [stored('1', { reactions: [{ emoji: '🔥', count: 2, mine: true }] })]
    mergeBubble(list, { ...pendingBubble(job('x'), 'ada', null), state: 'failed', error: 'buddy_read_archived' })
    mergeBubble(list, stored('1', { authorName: null, reactions: [] }), { live: true })
    expect(list[0]).toMatchObject({ authorName: 'Ben', reactions: [{ emoji: '🔥', count: 2, mine: true }] })
    expect(list[1]).toMatchObject({ state: 'failed', error: 'buddy_read_archived' })
    settleBubbles(list)
    expect(list.map((m) => m.state)).toEqual(['sent', 'failed'])
  })

  it('turns a message into a tombstone: no words, no picture, no reactions, it reads as text', () => {
    const gif = stored('1', { kind: 'gif', body: 'caption', media: { kind: 'gif', path: null, url: 'https://static.klipy.com/x', width: 1, height: 1 }, reactions: [{ emoji: '🔥', count: 1, mine: false }] })
    expect(tombstoneOf(gif, 'now')).toMatchObject({ kind: 'text', body: '', media: null, reactions: [], deletedAt: 'now' })
    expect(tombstoneOf(tombstoneOf(gif, 'first'), 'second').deletedAt).toBe('first')
  })
})

describe('her reaction, before the database says', () => {
  const fire = { emoji: '🔥', count: 2, mine: false }
  it('adds hers, moves it, takes it back, and the same tap again takes it back too', () => {
    expect(reactedBy([], '🔥')).toEqual([{ emoji: '🔥', count: 1, mine: true }])
    expect(reactedBy([fire], '🔥')).toEqual([{ emoji: '🔥', count: 3, mine: true }])
    const mine = [{ emoji: '🔥', count: 3, mine: true }, { emoji: '📚', count: 1, mine: false }]
    expect(reactedBy(mine, '📚')).toEqual([{ emoji: '🔥', count: 2, mine: false }, { emoji: '📚', count: 2, mine: true }])
    expect(reactedBy(mine, null)).toEqual([{ emoji: '🔥', count: 2, mine: false }, { emoji: '📚', count: 1, mine: false }])
    expect(reactedBy(mine, '🔥')).toEqual([{ emoji: '🔥', count: 2, mine: false }, { emoji: '📚', count: 1, mine: false }])
    expect(reactedBy([{ emoji: '🔥', count: 1, mine: true }], null)).toEqual([])
  })
})

describe('the shapes of a read', () => {
  const member = (id: string, where: BuddyMember['where']): BuddyMember => ({ id, name: id, photo: null, role: 'member', where })

  it('maps a Section to the layer’s chapter: part is chapter, end is the whole book, pages only when both are there', () => {
    expect(chapterFromJson({ id: 's', position: 2, kind: 'part', label: 'Part 2', start_page: 10, end_page: 20, count: 3, unread: 1 })).toEqual({ id: 's', position: 2, kind: 'chapter', title: 'Part 2', pages: [10, 20], count: 3, unread: 1 })
    expect(chapterFromJson({ id: 'e', position: 3, kind: 'end', label: 'The whole book', start_page: null, end_page: 20, count: 0, unread: 0 })).toMatchObject({ kind: 'end', pages: null })
  })

  it('reads where a member is: a Section, the end, not set, or nothing across a block', () => {
    expect(whereFromJson({ kind: 'section', section: 3 })).toEqual({ kind: 'section', section: 3 })
    expect(whereFromJson({ kind: 'end' })).toEqual({ kind: 'end' })
    expect(whereFromJson({ kind: 'not_set' })).toEqual({ kind: 'not_set' })
    expect(whereFromJson(null)).toBeNull()
  })

  it('turns where into the layer’s markers: reading Section k is read through k - 1, the end is every part, not set has none, hers is her own', () => {
    const members = [member('a', { kind: 'section', section: 3 }), member('b', { kind: 'end' }), member('c', { kind: 'not_set' }), member('d', null), member('me', { kind: 'section', section: 1 })]
    expect(marksOf(members, 4, { id: 'me', readThrough: 0 })).toEqual([
      { memberId: 'a', readThrough: 2 },
      { memberId: 'b', readThrough: 4 },
      { memberId: 'me', readThrough: 0 },
    ])
  })

  it('maps a whole read: the layer’s fields and the app’s, no creation time (the start day stands in), the list of a Section-less answer survives', () => {
    const read = readFromJson(
      {
        id: 'r', book: { id: 'b', title: 'T', authors: ['A', 'B'], published_year: 2000, cover_url: 'https://c', cover_thumbhash: null, cover_dominant: null, cover_secondary: null, manual: false },
        status: 'finished', starts_on: '2026-11-01', finished_at: '2026-11-10T00:00:00Z', archived_at: null, sections_from: 'list', page_count: null, role: 'member', can_manage: false,
        room: { count: 2, unread: 1 }, sections: [], members: [], me: { entry_id: 'e', auto: 2, hand: null, read_through: 2, where: { kind: 'section', section: 3 } }, link_token: null, invited: null,
      },
      'me',
    )
    expect(read).toMatchObject({ conversationId: 'r', book: { title: 'T', author: 'A, B', cover: 'https://c' }, chaptersFrom: null, sectionsFrom: 'list', createdAt: '2026-11-01', startsOn: '2026-11-01', readThrough: 2, finishedAt: '2026-11-10T00:00:00Z', room: { count: 2, unread: 1 }, invited: [] })
    expect(read.me).toEqual({ entryId: 'e', auto: 2, hand: null, readThrough: 2, where: { kind: 'section', section: 3 } })
  })

  it('maps a tombstone and a GIF row into the layer’s ChatRecord', () => {
    const base = { id: 'm', section_id: null, author: { id: 'a', name: 'A' }, client_id: 'c', created_at: 'x', deleted_at: null, reply_to: null, reactions: null }
    expect(messageFromJson('r', { ...base, kind: 'gif', body: '', media_url: 'https://static.klipy.com/g', media_width: 4, media_height: 3 })).toMatchObject({ kind: 'gif', media: { kind: 'gif', url: 'https://static.klipy.com/g', width: 4, height: 3, path: null }, reactions: [] })
    expect(messageFromJson('r', { ...base, kind: 'text', body: null, media_url: null, media_width: null, media_height: null, deleted_at: 'y' })).toMatchObject({ body: '', media: null, deletedAt: 'y', threadId: null, conversationId: 'r' })
  })
})

describe('the numbers of a thread', () => {
  const read = { room: { count: 1, unread: 1 }, chapters: [{ id: 's', count: 2, unread: 2 }] } as unknown as BuddyRead

  it('counts the room and a Section, never below nothing, and reads one as caught up', () => {
    expect(countsOf(read, null)).toBe(read.room)
    expect(countsOf(read, 'nope')).toBeNull()
    bumpCounts(read, 's', { count: 1, unread: 1 })
    expect(countsOf(read, 's')).toMatchObject({ count: 3, unread: 3 })
    bumpCounts(read, 's', { count: -9 })
    expect(countsOf(read, 's')!.count).toBe(0)
    clearUnread(read, 's')
    clearUnread(read, null)
    expect([countsOf(read, 's')!.unread, read.room.unread]).toEqual([0, 0])
    bumpCounts(read, 'nope', { count: 1 })
  })
})
