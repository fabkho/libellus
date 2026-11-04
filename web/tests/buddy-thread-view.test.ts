import { describe, expect, it } from 'vitest'
import type { BuddyMember, BuddyRead } from '@/data/buddyReads'
import { currentChoice, markerChoices, roomRows, titleSaysNumber, trackOf, trackPlace } from '@/utils/buddyRoom'
import { sectionTitle } from '@/utils/buddySectionTitle'
import { isReadId, isSectionSegment, sectionOfSegment, threadPath } from '@/utils/buddyRoute'
import { sentBubble, type BuddyBubble } from '@/utils/buddyRead'
import { quoteOf, reportInput, sameAuthorRun, threadItems, type ThreadContext } from '@/utils/buddyThread'

/** What the room and a thread draw (utils/buddyRoom.ts, buddyThread.ts, buddyRoute.ts): the veil, the tombstone, the quote, the track, the report. No database, no store. */

const bubble = (id: string, over: Partial<BuddyBubble> = {}): BuddyBubble =>
  sentBubble({ id, conversationId: 'r', threadId: 's', senderId: 'ben', clientId: `c-${id}`, kind: 'text', body: `Words of ${id}`, createdAt: `2026-11-13T10:00:00.${id.padStart(6, '0')}+00:00`, replyTo: null, spoiler: false, media: null, authorName: 'Ben', deletedAt: null, reactions: [], ...over })

const ctx = (over: Partial<ThreadContext> = {}): ThreadContext => ({ me: 'ada', open: true, revealed: new Set(), nameOf: (id) => (id === 'ben' ? 'Ben' : null), errorWord: (code) => `word:${code}`, ...over })

describe('the veil in a thread', () => {
  it('has no message at all in a Section that is not open, whatever the store holds', () => {
    const held = [bubble('1'), bubble('2', { spoiler: true })]
    expect(threadItems(held, ctx({ open: false }))).toEqual([])
    expect(threadItems(held, ctx({ open: true }))).toHaveLength(2)
  })

  it('veils a comment marked Spoiler for the others until it is tapped, never her own', () => {
    const items = (revealed: string[]) => threadItems([bubble('1', { spoiler: true }), bubble('2', { spoiler: true, senderId: 'ada' })], ctx({ revealed: new Set(revealed) }))
    expect(items([]).map((i) => i.veiled)).toEqual([true, false])
    expect(items(['c-1']).map((i) => i.veiled)).toEqual([false, false])
  })

  it('keeps a message’s key from its bubble to its stored row (the client id), and its id null until it is stored', () => {
    const sending = { ...bubble('9', { senderId: 'ada', clientId: 'mine', id: 'local:mine' }), state: 'sending' as const }
    const [item] = threadItems([sending], ctx())
    expect(item).toMatchObject({ key: 'mine', id: null, mine: true, delivery: 'sending' })
    const [stored] = threadItems([bubble('9', { senderId: 'ada', clientId: 'mine' })], ctx())
    expect(stored).toMatchObject({ key: 'mine', id: '9', delivery: 'sent' })
  })

  it('words a refused message with the app’s sentence for its code', () => {
    const failed = { ...bubble('3', { senderId: 'ada' }), state: 'failed' as const, error: 'buddy_read_archived' as const }
    expect(threadItems([failed], ctx())[0]).toMatchObject({ delivery: 'failed', error: 'word:buddy_read_archived' })
  })

  it('turns a deleted message into a system line with no words and no reactions: "Message removed" is drawn by the screen', () => {
    const gone = bubble('4', { deletedAt: '2026-11-13T11:00:00Z', body: 'still here?', reactions: [{ emoji: '🔥', count: 2, mine: true }], spoiler: true })
    const [item] = threadItems([gone], ctx())
    expect(item).toMatchObject({ kind: 'system', removed: true, body: '', reactions: [], myReaction: null, veiled: false })
  })

  it('names the author from the message, else from the members; a reaction of hers is her own', () => {
    const [a, b] = threadItems([bubble('5', { authorName: null }), bubble('6', { reactions: [{ emoji: '❤️', count: 1, mine: true }] })], ctx())
    expect(a!.author).toBe('Ben')
    expect(b).toMatchObject({ myReaction: '❤️', reactions: [{ emoji: '❤️', count: 1, mine: true }] })
  })
})

describe('a quote', () => {
  const words = { deleted: 'Message deleted', spoiler: 'Spoiler', someone: 'A reader', you: 'You' }
  const items = threadItems([bubble('1', { body: '  The   ending\nwas  great ' }), bubble('2', { spoiler: true }), bubble('3', { deletedAt: 'x' }), bubble('4', { senderId: 'ada' })], ctx())

  it('shows who wrote it and its first words on one line', () => {
    expect(quoteOf(items, '1', words)).toEqual({ id: '1', mine: false, name: 'Ben', preview: 'The ending was great' })
    expect(quoteOf(items, '4', words)).toMatchObject({ mine: true, name: 'You' })
  })

  it('gives no word of a spoiler she has not tapped, and says a removed or unknown message is gone', () => {
    expect(quoteOf(items, '2', words)?.preview).toBe('Spoiler')
    expect(quoteOf(items, '3', words)).toMatchObject({ id: null, preview: 'Message deleted' })
    expect(quoteOf(items, 'nowhere', words)).toMatchObject({ id: null, name: 'A reader', preview: 'Message deleted' })
    expect(quoteOf(items, null, words)).toBeNull()
  })
})

describe('the report', () => {
  it('sends the reason and the note trimmed, nothing for no note, and never a reason the database would refuse', () => {
    expect(reportInput('spam', '  Looks like an ad.  ')).toEqual({ reason: 'spam', note: 'Looks like an ad.' })
    expect(reportInput('harassment', '   \n ')).toEqual({ reason: 'harassment', note: null })
    expect(reportInput('nonsense', 'x')).toBeNull()
    expect(reportInput(null, 'x')).toBeNull()
  })

  it('cuts a note to what the database keeps, by characters, never in the middle of one', () => {
    const note = reportInput('other', '📚'.repeat(1200))!.note!
    expect([...note]).toHaveLength(1000)
    expect(note.endsWith('📚')).toBe(true)
  })
})

// ------------------------------------------------------------------ the room

const member = (id: string, where: BuddyMember['where']): BuddyMember => ({ id, name: id, photo: null, role: 'member', where })
const readOf = (over: Partial<BuddyRead> = {}): BuddyRead =>
  ({
    chapters: [
      { id: 's1', position: 1, kind: 'chapter', title: 'One', pages: null, count: 3, unread: 1 },
      { id: 's2', position: 2, kind: 'chapter', title: 'Two', pages: null, count: 12, unread: 4 },
      { id: 's3', position: 3, kind: 'chapter', title: 'Three', pages: null, count: 0, unread: 0 },
      { id: 'end', position: 4, kind: 'end', title: 'The whole book', pages: null, count: 2, unread: 2 },
    ],
    room: { count: 5, unread: 2 },
    members: [member('ada', { kind: 'section', section: 2 }), member('ben', { kind: 'section', section: 2 }), member('cy', { kind: 'section', section: 1 }), member('di', { kind: 'end' }), member('ed', { kind: 'not_set' })],
    ...over,
  }) as BuddyRead

describe('the rows of the room', () => {
  // Ada has read through Section 1: 1 is open, 2 and 3 and the whole book are veiled.
  const view = (id: string) => ({ s1: { open: true, veiled: false, showTitle: true, showUnread: true } }[id] ?? { open: false, veiled: true, showTitle: false, showUnread: false })
  const rows = roomRows(readOf(), view)

  it('lists the room first (always open, with its own news), then the Sections, the whole book last', () => {
    expect(rows.map((r) => [r.kind, r.segment, r.veiled])).toEqual([['room', 'room', false], ['part', 's1', false], ['part', 's2', true], ['part', 's3', true], ['end', 'end', true]])
    expect(rows[0]).toMatchObject({ count: 5, unread: 2 })
  })

  it('gives a veiled row its number and count only: no title, no new-message dot, no faces', () => {
    for (const row of rows.filter((r) => r.veiled)) expect(row).toMatchObject({ title: '', unread: 0, faces: [] })
    expect(rows[3]).toMatchObject({ number: '3', count: 0 })
    expect(rows[2]).toMatchObject({ number: '2', count: 12 })
  })

  it('names who is in an open Section, and the whole book’s readers when it is open', () => {
    expect(rows[1]).toMatchObject({ title: 'One', unread: 1 })
    expect(rows[1]!.faces.map((f) => f.id)).toEqual(['cy'])
    const open = roomRows(readOf(), () => ({ open: true, veiled: false, showTitle: true, showUnread: true }))
    expect(open[2]!.faces.map((f) => f.id)).toEqual(['ada', 'ben'])
    expect(open[4]!.faces.map((f) => f.id)).toEqual(['di'])
  })

  it('draws a Section the view does not know as veiled, so nothing leaks on a doubt', () => {
    expect(roomRows(readOf(), () => null).slice(1).every((r) => r.veiled && r.title === '')).toBe(true)
  })
})

describe('the track', () => {
  it('puts a member in the middle of her Section, the end at the end, and nobody for "not set"', () => {
    expect(trackPlace({ where: { kind: 'section', section: 1 } }, 4)).toBeCloseTo(0.125)
    expect(trackPlace({ where: { kind: 'section', section: 4 } }, 4)).toBeCloseTo(0.875)
    expect(trackPlace({ where: { kind: 'end' } }, 4)).toBe(1)
    expect(trackPlace({ where: { kind: 'not_set' } }, 4)).toBeNull()
    expect(trackPlace({ where: null }, 4)).toBeNull()
  })

  it('keeps two readers of one Section apart, her own first, and a crowd inside the bar', () => {
    const placed = trackOf(readOf().members, 3, 'ben', 9)
    expect(placed.map((p) => p.member.id)).toEqual(['cy', 'ben', 'ada', 'di'])
    const at = placed.map((p) => p.at)
    for (let i = 1; i < at.length; i++) expect(at[i]! - at[i - 1]!).toBeGreaterThanOrEqual(9 - 1e-9)
    expect(Math.min(...at)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...at)).toBeLessThanOrEqual(100)
    const crowd = Array.from({ length: 12 }, (_, i) => member(`m${i}`, { kind: 'end' }))
    const packed = trackOf(crowd, 3, null, 9).map((p) => p.at)
    expect(Math.max(...packed)).toBeLessThanOrEqual(100)
    expect(Math.min(...packed)).toBeGreaterThanOrEqual(0)
  })
})

describe('where are you', () => {
  it('offers automatic, Section 1…N (reading Section k is k - 1 parts read) and "I’ve read it" (all N)', () => {
    expect(markerChoices(3).map((c) => [c.key, c.through])).toEqual([['auto', null], ['section-1', 0], ['section-2', 1], ['section-3', 2], ['end', 3]])
  })

  it('marks the hand she set, else automatic', () => {
    expect(currentChoice(null, 3)).toBe('auto')
    expect(currentChoice(0, 3)).toBe('section-1')
    expect(currentChoice(2, 3)).toBe('section-3')
    expect(currentChoice(3, 3)).toBe('end')
  })
})

describe('the addresses', () => {
  const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
  it('takes a read’s id and a thread of it, the room or a Section', () => {
    expect(isReadId(id)).toBe(true)
    expect(isReadId('nope')).toBe(false)
    expect(isSectionSegment('room')).toBe(true)
    expect(isSectionSegment(id)).toBe(true)
    expect(isSectionSegment('rooms')).toBe(false)
    expect(sectionOfSegment('room')).toBeNull()
    expect(sectionOfSegment(id)).toBe(id)
    expect(sectionOfSegment('x')).toBeUndefined()
    expect(threadPath(id, null)).toBe(`/together/${id}/room`)
    expect(threadPath(id, 's1')).toBe(`/together/${id}/s1`)
  })
})

describe('a message that was refused', () => {
  const failed = (error: 'buddy_read_archived' | 'not_found' | 'message_body_invalid' | 'unknown' | 'message_rate_limited' | 'busy') => ({ ...bubble('7', { senderId: 'ada' }), state: 'failed' as const, error })

  it('is permanent when a second try cannot change why (removed, blocked, archived, invalid), and has no id to answer or react to', () => {
    for (const code of ['buddy_read_archived', 'not_found', 'message_body_invalid'] as const) {
      expect(threadItems([failed(code)], ctx())[0], code).toMatchObject({ delivery: 'failed', permanent: true, id: null, error: `word:${code}` })
    }
  })

  it('may be tried again when it was the connection, the limit or a failure nobody explained', () => {
    for (const code of ['unknown', 'message_rate_limited', 'busy'] as const) expect(threadItems([failed(code)], ctx())[0]!.permanent, code).toBe(false)
  })

  it('is never permanent while it is on its way or stored', () => {
    const sending = { ...bubble('8', { senderId: 'ada' }), state: 'sending' as const }
    expect(threadItems([sending, bubble('9')], ctx()).map((i) => i.permanent)).toEqual([false, false])
  })
})

describe('what a row says about its number, and a Section in the viewer’s words', () => {
  it('says its number only when the title ends with it on its own: not as the tail of a longer number or a range', () => {
    expect(titleSaysNumber('Section 9', '9')).toBe(true)
    expect(titleSaysNumber('Abschnitt 9 ', '9')).toBe(true)
    expect(titleSaysNumber('9', '9')).toBe(true)
    expect(titleSaysNumber('Chapter 19', '9')).toBe(false)
    expect(titleSaysNumber('Section 1–2', '2')).toBe(false)
    expect(titleSaysNumber('Part 3-4', '4')).toBe(false)
    expect(titleSaysNumber('The Storm', '9')).toBe(false)
    expect(titleSaysNumber('Anything', '')).toBe(false)
  })

  const words = { whole: () => 'The whole book', label: (n: string) => `Section ${n}` }
  it('words the setup’s own labels again in the viewer’s language, in any language the setup writes, and keeps a title the host typed', () => {
    expect(sectionTitle({ kind: 'chapter', title: 'Abschnitt 3' }, words)).toBe('Section 3')
    expect(sectionTitle({ kind: 'chapter', title: 'Section 3–4' }, words)).toBe('Section 3–4')
    expect(sectionTitle({ kind: 'chapter', title: 'Abschnitt 12–13' }, words)).toBe('Section 12–13')
    expect(sectionTitle({ kind: 'chapter', title: 'The Storm' }, words)).toBe('The Storm')
    expect(sectionTitle({ kind: 'chapter', title: 'Section 3: The Storm' }, words)).toBe('Section 3: The Storm')
    // The whole book is the viewer's own words whatever the host's tool wrote.
    expect(sectionTitle({ kind: 'end', title: 'Das ganze Buch' }, words)).toBe('The whole book')
  })

  it('puts them on the rows of the room, and never the title of a veiled one', () => {
    const read = {
      room: { count: 0, unread: 0 },
      members: [],
      chapters: [
        { id: 's1', position: 1, kind: 'chapter', title: 'Abschnitt 1', pages: null, count: 0, unread: 0 },
        { id: 's2', position: 2, kind: 'chapter', title: 'Abschnitt 2', pages: null, count: 0, unread: 0 },
        { id: 'e', position: 3, kind: 'end', title: 'Das ganze Buch', pages: null, count: 0, unread: 0 },
      ],
    } as unknown as BuddyRead
    const open = { open: true, veiled: false, showTitle: true, showUnread: true }
    const rows = roomRows(read, (id) => (id === 's2' ? { ...open, open: false, veiled: true, showTitle: false, showUnread: false } : open), (c) => sectionTitle(c, words))
    expect(rows.map((r) => r.title)).toEqual(['', 'Section 1', '', 'The whole book'])
  })
})

describe('the runs of a thread (UiChatThread `sameRun`)', () => {
  // The base's `follows`: a row follows the one before it when it is an item and `sameRun(before, item)` holds (a day separator in between ends the run).
  const run = (items: ReturnType<typeof threadItems>) => items.map((item, i) => (i > 0 && sameAuthorRun(items[i - 1]!, item) ? 'follows' : 'starts'))
  const of = (...senders: string[]) =>
    threadItems(senders.map((who, i) => bubble(String(i + 1), { senderId: who, authorName: who })), ctx({ me: 'ada' }))

  it('starts a run when another person writes, even if both are somebody else’s: three members, interleaved', () => {
    // Bram twice, Mara twice, Bram, Mara, Ada twice (hers), Mara.
    expect(run(of('bram', 'bram', 'mara', 'mara', 'bram', 'mara', 'ada', 'ada', 'mara'))).toEqual(['starts', 'follows', 'starts', 'follows', 'starts', 'starts', 'starts', 'follows', 'starts'])
  })

  it('keeps one person’s messages in one run, and her own apart from everybody’s', () => {
    expect(run(of('ben', 'ben', 'ben'))).toEqual(['starts', 'follows', 'follows'])
    expect(run(of('ben', 'ada'))).toEqual(['starts', 'starts'])
  })

  it('breaks a run at a tombstone, before and after it, whoever wrote it', () => {
    const items = threadItems([bubble('1'), bubble('2', { deletedAt: 'x' }), bubble('3'), bubble('4', { senderId: 'mara', authorName: 'Mara' })], ctx())
    expect(items.map((i) => i.kind)).toEqual(['text', 'system', 'text', 'text'])
    expect(run(items)).toEqual(['starts', 'starts', 'starts', 'starts'])
  })

  it('treats a member who has gone as one author among others: two of her messages are one run, not the next member’s', () => {
    const items = threadItems([bubble('1', { senderId: null, authorName: null }), bubble('2', { senderId: null, authorName: null }), bubble('3', { senderId: 'mara', authorName: 'Mara' })], ctx())
    expect(run(items)).toEqual(['starts', 'follows', 'starts'])
  })
})
