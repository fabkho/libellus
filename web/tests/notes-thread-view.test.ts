import { describe, expect, it } from 'vitest'
import type { NoteMessage, NotesChapter, NotesRoom } from '@/data/notes'
import {
  chapterChoices,
  chapterOfSegment,
  chapterPath,
  chapterRows,
  currentChapterChoice,
  isChapterSegment,
  mergeNote,
  noteItems,
  noteJob,
  noteQuoteOf,
  pendingNote,
  reactedNote,
  sentNote,
  summaryRows,
  tombstoneNote,
  visibilityOfJob,
  type NoteBubble,
  type NoteThreadContext,
} from '@/utils/notes'
import { sameAuthorRun } from '@/utils/roomThread'

/** What the Notes page and a chapter draw (utils/notes.ts, utils/roomThread.ts): the veil, the quote shapes, the tombstones, the chapter rows. No database, no store. */

const card = (id: string, name: string | null = id) => ({ id, name, photo: null })
const note = (id: string, over: Partial<NoteMessage> = {}): NoteMessage => ({
  id,
  conversationId: 'room',
  threadId: 'ch5',
  senderId: 'ben',
  clientId: null,
  kind: 'text',
  body: `Words of ${id}`,
  createdAt: `2026-11-13T10:00:00.${id.padStart(6, '0')}+00:00`,
  replyTo: null,
  spoiler: false,
  media: null,
  voice: null,
  author: card('ben', 'Ben'),
  authorName: 'Ben',
  deletedAt: null,
  moderated: false,
  reactions: [],
  visibility: 'friends',
  effectiveVisibility: 'friends',
  quote: null,
  ...over,
})
const bubble = (id: string, over: Partial<NoteMessage> = {}): NoteBubble => sentNote(note(id, over))
const ctx = (over: Partial<NoteThreadContext> = {}): NoteThreadContext => ({ me: 'ada', open: true, revealed: new Set(), nameOf: () => null, errorWord: (code) => `word:${code}`, retryable: (code) => code === 'offline', ...over })

describe('the veil in a chapter', () => {
  it('has no note at all in a chapter that is not open, whatever the store holds', () => {
    const held = [bubble('1'), bubble('2', { spoiler: true })]
    expect(noteItems(held, ctx({ open: false }))).toEqual([])
    expect(noteItems(held, ctx({ open: true }))).toHaveLength(2)
  })

  it('veils a note marked Spoiler for the others until it is tapped, never her own', () => {
    const items = (revealed: string[]) => noteItems([bubble('1', { spoiler: true }), bubble('2', { spoiler: true, senderId: 'ada', author: card('ada') })], ctx({ revealed: new Set(revealed) }))
    expect(items([]).map((i) => i.veiled)).toEqual([true, false])
    expect(items(['1']).map((i) => i.veiled)).toEqual([false, false])
  })

  it('carries the audience, the server’s quote and who removed it next to the base’s item', () => {
    const [a, b, c] = noteItems(
      [
        bubble('1', { visibility: 'public', effectiveVisibility: 'friends' }),
        bubble('2', { quote: { kind: 'hidden' } }),
        bubble('3', { deletedAt: '2026-11-13T11:00:00Z', moderated: true, body: '' }),
      ],
      ctx(),
    )
    expect(a).toMatchObject({ visibility: 'public', effectiveVisibility: 'friends', moderated: false })
    expect(b!.quote).toEqual({ kind: 'hidden' })
    expect(c).toMatchObject({ kind: 'system', removed: true, moderated: true, body: '', reactions: [] })
  })

  it('words a refusal with the app’s sentence and marks one that no second try can change as permanent', () => {
    const failed = (error: NoteBubble['error']): NoteBubble => ({ ...bubble('3', { senderId: 'ada', author: card('ada') }), state: 'failed', error })
    expect(noteItems([failed('offline')], ctx())[0]).toMatchObject({ delivery: 'failed', error: 'word:offline', permanent: false })
    expect(noteItems([failed('note_wider_than_parent')], ctx())[0]).toMatchObject({ error: 'word:note_wider_than_parent', permanent: true })
  })

  it('keeps one run per author: two other members in a row are two runs', () => {
    const [a, b, c] = noteItems([bubble('1'), bubble('2', { senderId: 'jo', author: card('jo') }), bubble('3', { senderId: 'jo', author: card('jo') })], ctx())
    expect(sameAuthorRun(a!, b!)).toBe(false)
    expect(sameAuthorRun(b!, c!)).toBe(true)
  })
})

describe('a quote', () => {
  const words = { deleted: 'Message deleted', spoiler: 'Spoiler', someone: 'A reader', you: 'You', hidden: 'A note you can’t see' }
  const items = noteItems([bubble('1', { body: 'First words' })], ctx())

  it('says "A note you can’t see" for a note she may not read, with no name and no jump, and "removed" for a tombstone', () => {
    expect(noteQuoteOf({ quote: { kind: 'hidden' }, replyTo: null }, items, 'ada', words)).toEqual({ id: null, mine: false, name: '', preview: 'A note you can’t see' })
    expect(noteQuoteOf({ quote: { kind: 'removed' }, replyTo: null }, items, 'ada', words)).toEqual({ id: null, mine: false, name: '', preview: 'Message deleted' })
  })

  it('quotes the author and the first words of a note she may read, a spoiler gives none away, her own is "You"', () => {
    const quote = (over: object) => ({ kind: 'note' as const, id: '1', author: card('ben', 'Ben'), excerpt: 'First words', spoiler: false, ...over })
    expect(noteQuoteOf({ quote: quote({}), replyTo: '1' }, items, 'ada', words)).toEqual({ id: '1', mine: false, name: 'Ben', preview: 'First words' })
    expect(noteQuoteOf({ quote: quote({ spoiler: true }), replyTo: '1' }, items, 'ada', words)!.preview).toBe('Spoiler')
    expect(noteQuoteOf({ quote: quote({ author: card('ada') }), replyTo: '1' }, items, 'ada', words)).toMatchObject({ mine: true, name: 'You' })
    // The original is not in the chapter's loaded page: no jump.
    expect(noteQuoteOf({ quote: quote({ id: 'far' }), replyTo: 'far' }, items, 'ada', words)!.id).toBeNull()
  })

  it('has none for a note that answers nothing, and finds a pending reply’s original among the items', () => {
    expect(noteQuoteOf({ quote: null, replyTo: null }, items, 'ada', words)).toBeNull()
    expect(noteQuoteOf({ quote: null, replyTo: '1' }, items, 'ada', words)).toMatchObject({ id: '1', name: 'Ben', preview: 'First words' })
    expect(noteQuoteOf({ quote: null, replyTo: 'gone' }, items, 'ada', words)!.preview).toBe('A note you can’t see')
  })
})

describe('what is on its way', () => {
  const job = noteJob({ roomId: 'room', sectionId: 'ch5', clientId: 'cid', body: 'Hello', replyTo: null, spoiler: false, createdAt: '2026-11-13T10:00:00Z' }, 'private')

  it('shows a note at once at the level she chose, and carries the level in the job’s payload', () => {
    expect(job.payload).toEqual({ visibility: 'private' })
    expect(visibilityOfJob(job)).toBe('private')
    const pending = pendingNote(job, 'ada', 'Ada')
    expect(pending).toMatchObject({ id: 'local:cid', clientId: 'cid', state: 'sending', visibility: 'private', effectiveVisibility: 'private', senderId: 'ada' })
  })

  it('sends a job that is not shaped like one at Friends: never wider than she can have meant', () => {
    expect(visibilityOfJob({ ...job, payload: { visibility: 'everybody' } })).toBe('friends')
    expect(visibilityOfJob({ ...job, payload: undefined })).toBe('friends')
  })

  it('lets the stored row replace the bubble by its client id and orders stored rows before what is waiting', () => {
    const list: NoteBubble[] = []
    mergeNote(list, bubble('1'))
    mergeNote(list, pendingNote(job, 'ada', 'Ada'))
    expect(list.map((b) => b.state)).toEqual(['sent', 'sending'])
    expect(mergeNote(list, bubble('2', { clientId: 'cid', senderId: 'ada', author: card('ada') }))).toBe(true)
    expect(list.map((b) => [b.id, b.state])).toEqual([['1', 'sent'], ['2', 'sent']])
    // The same row again is not new.
    expect(mergeNote(list, bubble('2', { clientId: 'cid', senderId: 'ada', author: card('ada') }))).toBe(false)
  })

  it('makes a tombstone with no words and no reactions that keeps its level', () => {
    const gone = tombstoneNote(bubble('1', { visibility: 'public', reactions: [{ emoji: '❤️', count: 1, mine: true }] }), '2026-11-13T12:00:00Z')
    expect(gone).toMatchObject({ body: '', reactions: [], visibility: 'public', deletedAt: '2026-11-13T12:00:00Z' })
  })

  it('puts her reaction on at once, replaces it with another and takes it back', () => {
    const one = reactedNote([], '❤️')
    expect(one).toEqual([{ emoji: '❤️', count: 1, mine: true }])
    expect(reactedNote(one, '🔥')).toEqual([{ emoji: '🔥', count: 1, mine: true }])
    expect(reactedNote(one, '❤️')).toEqual([])
    expect(reactedNote([{ emoji: '❤️', count: 3, mine: false }], '❤️')).toEqual([{ emoji: '❤️', count: 4, mine: true }])
  })
})

describe('the chapter list', () => {
  const chapter = (position: number, over: Partial<NotesChapter> = {}): NotesChapter => ({ id: `c${position}`, position, kind: 'part', count: position, unread: 1, open: position <= 2, faces: [card('ben')], ...over })
  const room: NotesRoom = {
    id: 'room',
    chapterCount: 3,
    me: { chapter: 2, finished: false, hand: false, auto: { chapter: 2, finished: false } },
    chapters: [chapter(3), chapter(1), chapter(2), chapter(4, { kind: 'end', open: false })],
  }

  it('orders the rows, the whole book last, and veils what is not open to her: number and count, no faces, no dot', () => {
    const rows = chapterRows(room, new Set())
    expect(rows.map((r) => [r.segment, r.veiled])).toEqual([['1', false], ['2', false], ['3', true], ['whole', true]])
    expect(rows[2]).toMatchObject({ count: 3, unread: 0, faces: [] })
    expect(rows[0]).toMatchObject({ unread: 1, faces: [card('ben')] })
  })

  it('opens a veiled row she opened anyway on this device', () => {
    expect(chapterRows(room, new Set(['c3'])).find((r) => r.segment === '3')).toMatchObject({ veiled: false, faces: [card('ben')] })
  })

  it('finds a chapter by its address, and has none for a number that is not in the list', () => {
    expect(chapterOfSegment(room, '2')?.id).toBe('c2')
    expect(chapterOfSegment(room, 'whole')?.id).toBe('c4')
    expect(chapterOfSegment(room, '9')).toBeNull()
    expect(chapterOfSegment(null, '1')).toBeNull()
    expect(isChapterSegment('0')).toBe(false)
    expect(isChapterSegment('12')).toBe(true)
    expect(isChapterSegment('abc')).toBe(false)
    expect(chapterPath('b', { kind: 'part', position: 5 })).toBe('/notes/b/5')
    expect(chapterPath('b', { kind: 'end', position: 44 })).toBe('/notes/b/whole')
  })

  it('offers Automatic, every chapter and “I’ve finished”, and says which is hers', () => {
    expect(chapterChoices(3).map((c) => c.key)).toEqual(['auto', 'c1', 'c2', 'c3', 'finished'])
    expect(currentChapterChoice(room.me)).toBe('auto')
    expect(currentChapterChoice({ ...room.me, hand: true, chapter: 5 })).toBe('c5')
    expect(currentChapterChoice({ ...room.me, hand: true, finished: true })).toBe('finished')
  })
})

describe('the Book page’s lines', () => {
  it('has a row only for a count above 0, and none at all for nothing', () => {
    const summary = { friends: { count: 0, authors: [], authorCount: 0, firstChapter: null, lastChapter: null }, public: { count: 0, authorCount: 0 } }
    expect(summaryRows(null)).toEqual({ friends: null, public: null })
    expect(summaryRows(summary)).toEqual({ friends: null, public: null })
    const rows = summaryRows({ friends: { count: 14, authors: [card('ben')], authorCount: 2, firstChapter: 1, lastChapter: 9 }, public: { count: 6, authorCount: 3 } })
    expect(rows.friends).toMatchObject({ count: 14, authorCount: 2, first: 1, last: 9 })
    expect(rows.public).toEqual({ count: 6, authorCount: 3 })
  })
})
