import type { SendJob } from '#layers/chat/app/types/adapter'
import type { BubbleQuote } from '#layers/ui/app/utils/chat/message'
import { byCreated, insertMessage, sameMessage } from '#layers/chat/app/utils/thread'
import { notePath, type VoiceJobMedia, type VoiceMime } from '~/data/noteVoice'
import type { NoteErrorCode, NoteMessage, NoteQuote, NoteReaction, NotesChapter, NotesRoom, NoteVisibility, NotesSummary } from '~/data/notes'
import { isNoteLevel } from '~/utils/noteVisibility'
import { isChapterSegment, notesPath, WHOLE_SEGMENT } from '~/utils/notesRoute'
import { roomItems, type RoomThreadContext, type ThreadItem } from '~/utils/roomThread'

/**
 * Notes on a Book, the glue between the repository (data/notes.ts), the chat layer (`@fabkho/chat`) and the store (stores/notes.ts): pure functions on
 * plain data, so Vitest drives them in Node. The store holds the state and the connection; the rules of a thread (where a note goes, how a bubble and its stored
 * row become one, what a quote says, what a chapter row shows) are here. No words: the components word the codes and the shapes.
 */

// ------------------------------------------------------------------ addresses and keys

export { isBookId, isChapterSegment, notesPath, WHOLE_SEGMENT } from '~/utils/notesRoute'

export const chapterSegment = (chapter: Pick<NotesChapter, 'kind' | 'position'>): string => (chapter.kind === 'end' ? WHOLE_SEGMENT : String(chapter.position))

export const chapterPath = (bookId: string, chapter: Pick<NotesChapter, 'kind' | 'position'>): string => `${notesPath(bookId)}/${chapterSegment(chapter)}`

/** The chapter an address names, or null when the list has none of that number. */
export function chapterOfSegment(room: Pick<NotesRoom, 'chapters'> | null | undefined, segment: unknown): NotesChapter | null {
  if (!room || !isChapterSegment(segment)) return null
  if (segment === WHOLE_SEGMENT) return room.chapters.find((c) => c.kind === 'end') ?? null
  return room.chapters.find((c) => c.kind === 'part' && c.position === Number(segment)) ?? null
}

export { notesPeekKey, notesQueueKey, NOTES_QUEUE_PREFIX, NOTES_STORAGE_PREFIX } from '~/utils/notesStorage'

/** The message-file key a refusal is worded under (en.json, `notes.error.<code>`): every code has one (tests/notes-errors.test.ts). */
export const noteErrorKey = (code: NoteErrorCode): string => `notes.error.${code}`

/** The queue's key of a send: one job per client id, so a retry of the same note replaces itself. */
export const noteSendKey = (clientId: string): string => `send:${clientId}`

// ------------------------------------------------------------------ bubbles

/** A note in a thread, with what only this device knows: it is on its way (`sending`), refused (`failed`, with the code) or stored (`sent`). */
export type NoteBubble = NoteMessage & { state: 'sent' | 'sending' | 'failed'; error: NoteErrorCode | null }

export const sentNote = (note: NoteMessage): NoteBubble => ({ ...note, state: 'sent', error: null })

/** What a queue job carries of a note: its audience rides in the job's `payload`. */
export const noteJob = (base: { roomId: string; sectionId: string; clientId: string; body: string; replyTo: string | null; spoiler: boolean; createdAt: string }, visibility: NoteVisibility): SendJob => ({
  conversationId: base.roomId,
  threadId: base.sectionId,
  clientId: base.clientId,
  kind: 'text',
  body: base.body,
  replyTo: base.replyTo,
  spoiler: base.spoiler,
  payload: { visibility },
  createdAt: base.createdAt,
})

/**
 * The send of a recording: a queue job of kind `voice` whose `media` is the recording's type, length and waveform (the sound is stored before the job is
 * made). Its audience is Only me, always: the job says so and the database has no other to give it.
 */
export function noteVoiceJob(base: { roomId: string; sectionId: string; clientId: string; replyTo: string | null; createdAt: string }, media: VoiceJobMedia): SendJob {
  return {
    conversationId: base.roomId,
    threadId: base.sectionId,
    clientId: base.clientId,
    kind: 'voice',
    body: '',
    replyTo: base.replyTo,
    spoiler: false,
    media,
    payload: { visibility: 'private' },
    createdAt: base.createdAt,
  }
}

/** What a queue job carries of a recording, or null for a text (and for a stored job that is not shaped like one: it is sent as nothing). */
export function noteVoiceOfJob(job: SendJob): VoiceJobMedia | null {
  const media = job.kind === 'voice' ? (job.media as Partial<VoiceJobMedia> | null | undefined) : null
  const mime = media?.mime
  if (!media || (mime !== 'audio/mp4' && mime !== 'audio/webm' && mime !== 'audio/ogg') || typeof media.durationMs !== 'number' || !Array.isArray(media.peaks)) return null
  return { mime: mime as VoiceMime, durationMs: media.durationMs, peaks: media.peaks }
}

/** The audience a stored job was made with (a job that is not shaped like one is sent at Friends: the safe middle, never wider). */
export function visibilityOfJob(job: SendJob): NoteVisibility {
  const level = (job.payload as { visibility?: unknown } | null | undefined)?.visibility
  return isNoteLevel(level) ? level : 'friends'
}

/** What she wrote, shown at once while the queue sends it: the id is the client id's, the time her device's, until the stored row replaces it. */
export function pendingNote(job: SendJob, me: string, name: string | null, quote: NoteQuote | null = null): NoteBubble {
  const media = noteVoiceOfJob(job)
  // A voice note is Only me, whatever else a stored job says.
  const visibility = media ? 'private' : visibilityOfJob(job)
  return {
    id: `local:${job.clientId}`,
    conversationId: job.conversationId,
    threadId: job.threadId,
    senderId: me,
    clientId: job.clientId,
    kind: media ? 'voice' : 'text',
    body: media ? '' : job.body,
    createdAt: job.createdAt,
    replyTo: job.replyTo,
    spoiler: job.spoiler,
    media: null,
    voice: media ? { path: notePath(me, job.conversationId, job.clientId, media.mime), mime: media.mime, durationMs: media.durationMs, peaks: media.peaks } : null,
    author: { id: me, name, photo: null },
    authorName: name,
    deletedAt: null,
    moderated: false,
    reactions: [],
    visibility,
    effectiveVisibility: visibility,
    quote,
    state: 'sending',
    error: null,
  }
}

/**
 * The database's order of a thread, oldest first: the instant, then the id (`order by created_at, id`). Notes that share an instant (an import of
 * second-resolution times does that) keep one order whatever order their pages arrived in, so the oldest stored note is the one the next page's cursor names.
 */
export const byInstantThenId = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number => byCreated(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The cursor of the page before a thread's oldest stored note: its `createdAt` and id, or null while nothing is stored. */
export function pageCursor(list: readonly NoteBubble[]): { before: string; beforeId: string } | null {
  const oldest = list.find((b) => b.state === 'sent')
  return oldest ? { before: oldest.createdAt, beforeId: oldest.id } : null
}

/** The thread in the order it is drawn: stored rows by the server's time, then what is still on its way, in the order it was sent. */
export function settleNotes(list: NoteBubble[]): void {
  const sent = list.filter((b) => b.state === 'sent').sort(byInstantThenId)
  const rest = list.filter((b) => b.state !== 'sent')
  list.splice(0, list.length, ...sent, ...rest)
}

/**
 * Puts a note into a thread, in place (the layer's `insertMessage`: the same row, or the same send of the same member by client id, is merged over
 * the old one, anything else goes where its time says). Resolves whether a *stored* row is new to the thread.
 */
export function mergeNote(list: NoteBubble[], incoming: NoteBubble): boolean {
  const seen = list.some((m) => m.state === 'sent' && sameMessage(m, incoming))
  insertMessage(list, incoming, (old, next) => ({ authorName: next.authorName ?? old.authorName }))
  settleNotes(list)
  return !seen
}

/** A note that became a tombstone: no body, no reactions; its level stays (the database keeps it). */
export const tombstoneNote = (bubble: NoteBubble, at: string): NoteBubble => ({ ...bubble, kind: 'text', body: '', voice: null, reactions: [], quote: bubble.quote, deletedAt: bubble.deletedAt ?? at })

/** Her reaction at once, before the database says (the same rule as a buddy read's: another emoji replaces hers, the same one takes it back). */
export function reactedNote(reactions: readonly NoteReaction[], emoji: string | null): NoteReaction[] {
  const had = reactions.find((r) => r.mine)?.emoji ?? null
  const next = emoji === had ? null : emoji
  const out = reactions.map((r) => (r.emoji === had ? { ...r, count: r.count - 1, mine: false } : { ...r })).filter((r) => r.count > 0)
  if (!next) return out
  const there = out.find((r) => r.emoji === next)
  if (there) {
    there.count += 1
    there.mine = true
  } else out.push({ emoji: next, count: 1, mine: true })
  return out
}

// ------------------------------------------------------------------ the thread as drawn

/** A note as the screen draws it: the base's item, and the audience, the quote and who removed it. */
export type NoteItem = ThreadItem & {
  visibility: NoteVisibility
  effectiveVisibility: NoteVisibility
  /** The server's quote (words for nobody who may not see it); null for a note that answers nothing. */
  quote: NoteQuote | null
  /** The owner removed it: "Removed by the moderator", not "Note removed". */
  moderated: boolean
  /** Her photo's path when the caller may see it (the card's), for the avatar. */
  authorPhoto: string | null
}

export type NoteThreadContext = Omit<RoomThreadContext, 'errorWord' | 'retryable'> & {
  errorWord: (code: NoteErrorCode) => string
  retryable: (code: NoteErrorCode) => boolean
}

/**
 * The notes the screen draws, oldest first. A chapter that is not open has none (`ctx.open`: the veil, applied here and nowhere else); a tombstone is a
 * system line; her own spoiler is never veiled from her.
 */
export function noteItems(bubbles: readonly NoteBubble[], ctx: NoteThreadContext): NoteItem[] {
  const items = roomItems(bubbles, { ...ctx, errorWord: (code) => ctx.errorWord(code as NoteErrorCode), retryable: (code) => ctx.retryable(code as NoteErrorCode) })
  if (!items.length) return []
  const byKey = new Map(bubbles.map((b) => [b.clientId ?? b.id, b]))
  return items.map((item) => {
    const bubble = byKey.get(item.key)!
    return { ...item, visibility: bubble.visibility, effectiveVisibility: bubble.effectiveVisibility, quote: bubble.quote, moderated: bubble.moderated, authorPhoto: bubble.author.photo }
  })
}

/** The words a quote needs that are the app's. */
export type NoteQuoteWords = { deleted: string; spoiler: string; someone: string; you: string; hidden: string; voice: string }

/**
 * The quote over a note, as the base draws it. A note she can read quotes its author and first words (a spoiler gives none away); the other two shapes
 * have no id, so the base does not offer a jump to them: `hidden` ("A note you can't see") and `removed`. Which of the three is the server's call;
 * a note still on its way has only the id it answers, found among the items.
 */
export function noteQuoteOf(item: Pick<NoteItem, 'quote' | 'replyTo'>, items: readonly NoteItem[], me: string | null, words: NoteQuoteWords): BubbleQuote | null {
  const quote = item.quote
  if (quote?.kind === 'hidden') return { id: null, mine: false, name: '', preview: words.hidden }
  if (quote?.kind === 'removed') return { id: null, mine: false, name: '', preview: words.deleted }
  if (quote?.kind === 'note') {
    const present = items.some((i) => i.id === quote.id)
    return { id: present ? quote.id : null, mine: quote.author.id === me, name: quote.author.id === me ? words.you : (quote.author.name?.trim() || words.someone), preview: quote.spoiler ? words.spoiler : quote.voice ? words.voice : quote.excerpt }
  }
  if (!item.replyTo) return null
  const original = items.find((i) => i.id === item.replyTo)
  if (!original) return { id: null, mine: false, name: '', preview: words.hidden }
  const preview = original.removed ? words.deleted : original.veiled ? words.spoiler : original.voice ? words.voice : original.body.replace(/\s+/g, ' ').trim().slice(0, 120)
  return { id: original.removed ? null : original.id, mine: original.mine, name: original.mine ? words.you : (original.author ?? words.someone), preview }
}

/** The quote shown in the composer while she answers `item`: who and the first words, never more than the base draws. */
export function replyChipOf(item: NoteItem, words: Pick<NoteQuoteWords, 'spoiler' | 'someone' | 'you' | 'voice'>): { name: string; preview: string } {
  return { name: item.mine ? words.you : (item.author ?? words.someone), preview: item.veiled ? words.spoiler : item.voice ? words.voice : item.body.replace(/\s+/g, ' ').trim().slice(0, 120) }
}

// ------------------------------------------------------------------ the chapter list

/** A row of the chapter list as it is drawn. */
export type ChapterRow = {
  id: string
  /** The address's segment: the chapter's number, or `whole`. */
  segment: string
  kind: 'part' | 'end'
  /** The number drawn in mono ("5"; the whole book has none, its row is worded). */
  number: string
  position: number
  count: number
  /** A number only on an open row: a veiled row's news is a spoiler too. */
  unread: number
  veiled: boolean
  faces: NotesChapter['faces']
}

/**
 * The rows, in the order of the screen: the chapters, "The whole book" last. A chapter the server says is not open to her is veiled unless she opened it
 * anyway on this device (`peeked`): it keeps its number and its count (a number says nothing of content), and loses its faces and its dot.
 */
export function chapterRows(room: Pick<NotesRoom, 'chapters'>, peeked: ReadonlySet<string>): ChapterRow[] {
  return [...room.chapters]
    .sort((a, b) => a.position - b.position)
    .map((chapter) => {
      const veiled = !chapter.open && !peeked.has(chapter.id)
      return {
        id: chapter.id,
        segment: chapterSegment(chapter),
        kind: chapter.kind,
        number: chapter.kind === 'end' ? '' : String(chapter.position),
        position: chapter.position,
        count: chapter.count,
        unread: veiled ? 0 : chapter.unread,
        veiled,
        faces: veiled ? [] : chapter.faces,
      }
    })
}

/** Whether a chapter is open to her: the server's flag, or she opened it anyway. */
export const chapterOpenFor = (chapter: Pick<NotesChapter, 'id' | 'open'>, peeked: ReadonlySet<string>): boolean => chapter.open || peeked.has(chapter.id)

/** The choices of "You're on chapter …": Automatic, chapters 1…N, I've finished. */
export type ChapterChoice = { key: string; kind: 'auto' | 'chapter' | 'finished'; chapter: number | null }

export function chapterChoices(chapterCount: number): ChapterChoice[] {
  return [
    { key: 'auto', kind: 'auto', chapter: null },
    ...Array.from({ length: chapterCount }, (_, i) => ({ key: `c${i + 1}`, kind: 'chapter' as const, chapter: i + 1 })),
    { key: 'finished', kind: 'finished', chapter: null },
  ]
}

/** Which choice her chapter is now: Automatic unless she set it by hand. */
export function currentChapterChoice(me: NotesRoom['me']): string {
  if (!me.hand) return 'auto'
  return me.finished ? 'finished' : `c${me.chapter}`
}

// ------------------------------------------------------------------ the Book page

export { summaryRows, type SummaryRows } from '~/utils/notesSummary'
