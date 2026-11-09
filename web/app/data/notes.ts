import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatRecord } from '#layers/chat/app/types/adapter'
import { isNoAnswer } from './network'
import { mapVoiceStorageError } from './buddyReads'
import { cardFromJson, type MemberCard } from './socialShapes'
import { NOTE_VOICE_BUCKET, notePath, type VoiceInfo, type VoiceJobMedia, type VoiceMime, voiceFromNoteJson, type NoteVoiceJson } from './noteVoice'
import { VOICE_URL_SECONDS } from './buddyVoice'

export { REPORT_REASONS, type ReportReason } from './buddyReads'

/**
 * Notes on a Book, the data layer (docs/plans/book-notes.md; the database: supabase/migrations/20261116010000_book_notes.sql, the current
 * definition of every function in supabase/schema-snapshot/functions/public.*note*.sql). One call per function of the contract (docs/plans/book-notes/briefs/N1-database.md,
 * "Public functions"): a Book's chapters are shared by everyone who has the Book, every note has its own audience (`private`, `friends`,
 * `public`), and the database decides who sees what. Framework-free like every repository here (no Vue, no Nuxt, no auto-imports): it takes the
 * Supabase client and a connection word, so Vitest drives it in plain Node against the stack and a native port copies it 1:1.
 *
 * It maps the database's JSON (camelCase, unlike the buddy reads') onto the chat layer's types: a note is a `ChatRecord` (the room is the
 * conversation, a chapter its thread: `conversationId` is the notes room's id, `threadId` the chapter's), and a refusal is a code
 * (`NoteErrorCode`) the app words in the message file (`notes.error.<code>`). Words never pass through it.
 */

// ------------------------------------------------------------------ refusals

/** What the notes functions raise, by the message the database gives (the migration's headers list them). */
export const NOTE_ERROR_CODES = [
  'not_signed_in',
  'not_found',
  'not_owner',
  'notes_unavailable',
  'notes_need_book',
  'notes_public_off',
  'chapters_already_set',
  'invalid_count',
  'invalid_chapter',
  'invalid_visibility',
  'invalid_reason',
  'invalid_emoji',
  'invalid_value',
  'note_wider_than_parent',
  'reply_not_visible',
  'body_empty',
  'body_too_long',
  'client_id_required',
  'client_id_reused',
  'report_self',
  'report_text_too_long',
  'rate_limited',
  'follow_self',
  // Voice notes (20261118010000_notes_private_voice.sql): the database's.
  'voice_invalid',
  'voice_missing',
  'voice_too_large',
  'voice_private_only',
] as const

/**
 * What a refusal can be: the database's and the client's own (no connection, busy, unknown, and the three a recording is refused for before it is sent:
 * `voice_short` a slip of the finger, `voice_large` over 3 MB, `voice_type` a type the bucket does not take).
 */
export type NoteErrorCode = (typeof NOTE_ERROR_CODES)[number] | 'offline' | 'busy' | 'unknown' | 'voice_short' | 'voice_large' | 'voice_type'

export type NoteResult<T> = { data: T; error: null } | { data: null; error: NoteErrorCode }

/** The failures a second try may cure: no connection, a deadlock the database asks to be tried again, a busy minute, a failure nobody explained. */
export const RETRYABLE_NOTE_ERRORS: readonly NoteErrorCode[] = ['offline', 'busy', 'unknown', 'rate_limited']

export const isRetryableNoteError = (code: NoteErrorCode): boolean => RETRYABLE_NOTE_ERRORS.includes(code)

/** A refusal as the database worded it, as a code. An id that is no id (22P02) finds nothing. */
export function mapNoteError(failure: { message?: string; code?: string }): NoteErrorCode {
  const message = failure.message ?? ''
  const raised = NOTE_ERROR_CODES.find((code) => message === code)
  if (raised) return raised
  if (failure.code === '22P02') return 'not_found'
  // Deadlock detected, serialisation failure, lock not available: the same call works a moment later.
  if (failure.code === '40P01' || failure.code === '40001' || failure.code === '55P03') return 'busy'
  return 'unknown'
}

// ------------------------------------------------------------------ shapes

/** The three audiences of a note: her notebook, the members she follows who follow her back, every signed-in member. */
export type NoteVisibility = 'private' | 'friends' | 'public'

/** Her chapter of a Book: where she is (`chapter`, 0 when not started; `finished` opens *The whole book*), whether it is her hand, and what her reading says. */
export type NoteMe = { chapter: number; finished: boolean; hand: boolean; auto: { chapter: number; finished: boolean } }

/** A row of the chapter list: `count` and `unread` as she may see them (nothing she may not), `faces` only on an open chapter. */
export type NotesChapter = { id: string; position: number; kind: 'part' | 'end'; count: number; unread: number; open: boolean; faces: MemberCard[] }

export type NotesRoom = { id: string; chapterCount: number; me: NoteMe; chapters: NotesChapter[] }

/** The Notes page of a Book: `room` is null while nobody has set the chapters; `canWrite`: she has the Book in her Library. */
export type NotesPage = { workKey: string; canWrite: boolean; room: NotesRoom | null }

/** The quote of the note a reply answers: its excerpt and author when she may see it, "hidden" when she may not, "removed" for a tombstone. Never words in the last two. */
export type NoteQuote = { kind: 'note'; id: string; author: MemberCard; excerpt: string; spoiler: boolean; /** The note is a voice note: no words, the app says "Voice message". */ voice: boolean } | { kind: 'hidden' } | { kind: 'removed' }

/** The Book page's lines: what her friends wrote (the members she follows who follow her back, at Friends or Everyone) and what strangers made public. Her own never counts. */
export type NotesSummary = {
  friends: { count: number; authors: MemberCard[]; authorCount: number; firstChapter: number | null; lastChapter: number | null }
  public: { count: number; authorCount: number }
}

export type NoteReaction = { emoji: string; count: number; mine: boolean }

/**
 * A note as the thread draws it: the layer's `ChatRecord` (always text: the room is the conversation, the chapter its thread) and what the
 * app adds. A tombstone has `deletedAt`, an empty body and no reactions (`removed`: she deleted it, `moderated`: the owner did).
 */
export type NoteMessage = ChatRecord & {
  /** A voice note's sound (kind `voice`: hers alone, always Only me); null for a text note. `path` is the object's name, never a URL. */
  voice: VoiceInfo | null
  authorName: string | null
  author: MemberCard
  deletedAt: string | null
  moderated: boolean
  reactions: NoteReaction[]
  visibility: NoteVisibility
  /** The level as readers see it: a public note counts as friends' while the owner's switch for Everyone is off. */
  effectiveVisibility: NoteVisibility
  quote: NoteQuote | null
}

export type PostNote = {
  roomId: string
  sectionId: string
  /** The sending device's id for it: a retry answers the row it made. */
  clientId: string
  body: string
  visibility: NoteVisibility
  replyTo?: string | null
  spoiler?: boolean
}

/** A recording that is stored (`uploadVoice`) and is to be posted (`sendVoice`): the same client id names both the object and the note. Always Only me. */
export type PostNoteVoice = {
  roomId: string
  sectionId: string
  clientId: string
  /** The object's name (what `uploadVoice` answered): the database checks it is hers, in this room, for this client id and type. */
  path: string
  media: VoiceJobMedia
  /** Her own private note of the chapter it answers. */
  replyTo?: string | null
}

export type NotesPageOfMessages = { items: NoteMessage[]; /** The page came back full: older ones may be there. */ more: boolean }

/** `note_messages` hands over at most this many, 50 when no limit is asked. */
export const NOTES_PAGE = 50
export const NOTES_PAGE_MAX = 100

/** The six reactions the database takes (the buddy reads' set). */
export { BUDDY_EMOJI as NOTE_EMOJI } from './buddyReads'

/** Chapters the database allows in one list (`invalid_count`). */
export const CHAPTERS_MAX = 300

// ------------------------------------------------------------------ JSON → shapes

type CardJson = Parameters<typeof cardFromJson>[0]
type MeJson = { chapter: number; finished: boolean; hand: boolean; auto: { chapter: number; finished: boolean } }
type ChapterJson = { id: string; position: number; kind: 'part' | 'end'; count: number; unread: number; open: boolean; faces: CardJson[] | null }
type PageJson = { workKey: string; canWrite: boolean; room: null | { id: string; chapterCount: number; me: MeJson; chapters: ChapterJson[] } }
type QuoteJson = { hidden: true } | { removed: true } | { id: string; author: CardJson; excerpt: string; spoiler: boolean; voice?: boolean }
type NoteJson = {
  id: string
  sectionId: string
  clientId: string | null
  author: CardJson
  mine: boolean
  body: string | null
  kind: 'note' | 'removed' | 'moderated'
  visibility: NoteVisibility
  effectiveVisibility: NoteVisibility
  spoiler: boolean
  createdAt: string
  quote: QuoteJson | null
  reactions: { emoji: string; count: number }[] | null
  myReaction: string | null
  /** Only on a live voice note, and only in its author's answer. */
  voice?: NoteVoiceJson | null
}

type SummaryJson = {
  friends: { count: number; authors: CardJson[] | null; authorCount: number; firstChapter: number | null; lastChapter: number | null }
  public: { count: number; authorCount: number }
}

export const summaryFromJson = (json: SummaryJson): NotesSummary => ({
  friends: {
    count: Number(json.friends?.count ?? 0),
    authors: (json.friends?.authors ?? []).map(cardFromJson),
    authorCount: Number(json.friends?.authorCount ?? 0),
    firstChapter: json.friends?.firstChapter == null ? null : Number(json.friends.firstChapter),
    lastChapter: json.friends?.lastChapter == null ? null : Number(json.friends.lastChapter),
  },
  public: { count: Number(json.public?.count ?? 0), authorCount: Number(json.public?.authorCount ?? 0) },
})

const meFromJson = (json: MeJson): NoteMe => ({
  chapter: Number(json.chapter),
  finished: Boolean(json.finished),
  hand: Boolean(json.hand),
  auto: { chapter: Number(json.auto?.chapter ?? 0), finished: Boolean(json.auto?.finished) },
})

export function pageFromJson(json: PageJson): NotesPage {
  const room = json.room
  return {
    workKey: json.workKey,
    canWrite: Boolean(json.canWrite),
    room: room
      ? {
          id: room.id,
          chapterCount: Number(room.chapterCount),
          me: meFromJson(room.me),
          chapters: [...room.chapters]
            .sort((a, b) => a.position - b.position)
            .map((c) => ({ id: c.id, position: Number(c.position), kind: c.kind, count: Number(c.count ?? 0), unread: Number(c.unread ?? 0), open: Boolean(c.open), faces: (c.faces ?? []).map(cardFromJson) })),
        }
      : null,
  }
}

function quoteFromJson(json: QuoteJson | null | undefined): NoteQuote | null {
  if (!json) return null
  if ('hidden' in json) return { kind: 'hidden' }
  if ('removed' in json) return { kind: 'removed' }
  return { kind: 'note', id: json.id, author: cardFromJson(json.author), excerpt: json.excerpt, spoiler: Boolean(json.spoiler), voice: Boolean(json.voice) }
}

/** A note of a room as the layer's record and what the app adds. `roomId` is the room's id: a note's answer does not carry it. */
export function noteFromJson(roomId: string, json: NoteJson): NoteMessage {
  const gone = json.kind !== 'note'
  const quote = quoteFromJson(json.quote)
  const voice = gone ? null : voiceFromNoteJson(json.voice)
  return {
    id: json.id,
    conversationId: roomId,
    threadId: json.sectionId,
    senderId: json.author?.id ?? null,
    clientId: json.clientId ?? null,
    kind: voice ? 'voice' : 'text',
    body: gone ? '' : (json.body ?? ''),
    createdAt: json.createdAt,
    replyTo: quote && quote.kind === 'note' ? quote.id : null,
    spoiler: Boolean(json.spoiler),
    media: null,
    voice,
    author: cardFromJson(json.author),
    authorName: json.author?.name ?? null,
    deletedAt: gone ? json.createdAt : null,
    moderated: json.kind === 'moderated',
    reactions: gone ? [] : (json.reactions ?? []).map((r) => ({ emoji: r.emoji, count: Number(r.count), mine: r.emoji === json.myReaction })),
    visibility: json.visibility,
    effectiveVisibility: json.effectiveVisibility ?? json.visibility,
    quote,
  }
}

// ------------------------------------------------------------------ the repository

export type NotesOptions = { online?: () => boolean }

type StorageFailure = { message?: string; statusCode?: string | number; status?: number; name?: string }

/** A refusal of the Storage API for a recording, as a code: the buddy reads' mapping, in the notes' words. */
export function mapNoteVoiceStorageError(failure: StorageFailure): NoteErrorCode {
  const code = mapVoiceStorageError(failure)
  return code === 'message_voice_too_large' ? 'voice_too_large' : code === 'message_voice_invalid' ? 'voice_invalid' : (code as NoteErrorCode)
}

/** The calls of every notes screen; one per database function. */
export function createNotes(client: SupabaseClient, { online = () => true }: NotesOptions = {}) {
  /** One call to a database function: refused offline first, a refusal mapped, the answer read by `read`. */
  async function call<J, T>(fn: string, args: Record<string, unknown>, read: (json: J) => T): Promise<NoteResult<T>> {
    if (!online()) return { data: null, error: 'offline' }
    // A request that throws (a navigation cancelled it) got no answer: the same as offline, never a rejection for a caller that did not expect one.
    const answer = await Promise.resolve(client.rpc(fn, args)).catch(() => null)
    if (!answer) return { data: null, error: 'offline' }
    if (isNoAnswer(answer)) return { data: null, error: 'offline' }
    if (answer.error) return { data: null, error: mapNoteError(answer.error) }
    return { data: read(answer.data as J), error: null }
  }

  const nothing = () => undefined
  const clampPage = (limit: number | undefined) => Math.min(NOTES_PAGE_MAX, Math.max(1, limit ?? NOTES_PAGE))

  return {
    /** The owner's switch for Everyone, read once a session. */
    config: () => call<{ publicEnabled: boolean }, { publicEnabled: boolean }>('notes_config', {}, (j) => ({ publicEnabled: Boolean(j.publicEnabled) })),
    /** The Notes page of a Book: one call draws it (the chapters with counts, faces and her own chapter). */
    page: (bookId: string) => call<PageJson, NotesPage>('book_notes', { p_book: bookId }, pageFromJson),
    /** The Book page's lines: what her friends and the public wrote, by the numbers. */
    summary: (bookId: string) => call<SummaryJson, NotesSummary>('notes_summary', { p_book: bookId }, summaryFromJson),
    /** Makes the Book's chapters, once (any member with the Book): `chapters_already_set` when somebody was first, then the page is asked again. */
    setChapters: (bookId: string, count: number) => call<PageJson, NotesPage>('set_book_chapters', { p_book: bookId, p_count: count }, pageFromJson),
    /** Adds chapters at the end (before *The whole book*); the ones there keep their ids and notes. */
    addChapters: (roomId: string, count: number) => call('add_book_chapters', { p_room: roomId, p_count: count }, nothing),
    /** Her chapter by hand (`chapter`), or *I've finished* (`finished`), or null for Automatic. */
    setChapter: (roomId: string, chapter: number | null, finished = false) =>
      call<MeJson, NoteMe>('set_note_chapter', { p_room: roomId, p_chapter: chapter, p_finished: finished }, meFromJson),
    /**
     * The notes of one chapter she may see, newest first on the wire and oldest first here. `before` and `beforeId` are the cursor of the page before: the
     * `createdAt` **and the id** of its oldest note, the keyset the thread is ordered by (notes that share an instant, as an import makes them, would otherwise
     * be lost at a page edge). `beforeId` is sent only with a cursor, so the first page asks for exactly what it always did.
     */
    messages: (roomId: string, sectionId: string, { before = null, beforeId = null, limit }: { before?: string | null; beforeId?: string | null; limit?: number } = {}) => {
      const size = clampPage(limit)
      const args: Record<string, unknown> = { p_room: roomId, p_section: sectionId, p_before: before, p_limit: size }
      if (before !== null && beforeId !== null) args.p_before_id = beforeId
      return call<NoteJson[], NotesPageOfMessages>('note_messages', args, (rows) => ({
        items: (rows ?? []).map((row) => noteFromJson(roomId, row)).reverse(),
        more: (rows ?? []).length >= size,
      }))
    },
    /** Writes a note at a level of her choice. Idempotent on `clientId`. */
    post: (input: PostNote) =>
      call<NoteJson, NoteMessage>(
        'post_note',
        {
          p_room: input.roomId,
          p_section: input.sectionId,
          p_client_id: input.clientId,
          p_body: input.body,
          p_visibility: input.visibility,
          p_reply_to: input.replyTo ?? null,
          p_spoiler: input.spoiler ?? false,
        },
        (row) => noteFromJson(input.roomId, row),
      ),
    /**
     * Stores a recording in the private bucket `note-voice`, in her own folder, under the name its note will have (`<her id>/<room>/<client id>.<ext>`).
     * Not the note: `sendVoice` posts it (through the send queue). The same client id again finds the object there and is answered as stored, so a retry
     * after a lost answer does not fail on "already exists". Refused offline before anything leaves.
     */
    async uploadVoice(roomId: string, authorId: string, clientId: string, blob: Blob, mime: VoiceMime): Promise<NoteResult<string>> {
      if (!online()) return { data: null, error: 'offline' }
      const path = notePath(authorId, roomId, clientId, mime)
      // Storage keeps the type of the Blob it is given (storage-js ignores `contentType` for a Blob), and a recorder's blob says "audio/webm;codecs=opus":
      // the sound is wrapped in a Blob of the bare type, which is what the database compares and what the bucket allows. `cacheControl` 0: a deleted
      // recording must not stay in a browser's cache (the signed URL is the only way to it, and it is short-lived).
      const audio = new Blob([blob], { type: mime })
      const { error } = await Promise.resolve(client.storage.from(NOTE_VOICE_BUCKET).upload(path, audio, { contentType: mime, upsert: false, cacheControl: '0' })).catch(
        () => ({ error: { name: 'StorageUnknownError', message: 'fetch failed' } as StorageFailure }),
      )
      if (!error) return { data: path, error: null }
      // The object of this very send is already there (the answer of a first try was lost): as good as stored.
      if (/already exists|duplicate/i.test((error as StorageFailure).message ?? '') || Number((error as StorageFailure).statusCode) === 409) return { data: path, error: null }
      return { data: null, error: mapNoteVoiceStorageError(error as StorageFailure) }
    },
    /** Posts a stored recording as a voice note: private, always (there is no level to give); the one she sent before under `clientId` answers again. */
    sendVoice: (input: PostNoteVoice) =>
      call<NoteJson, NoteMessage>(
        'post_note_voice',
        {
          p_room: input.roomId,
          p_section: input.sectionId,
          p_client_id: input.clientId,
          p_object: input.path,
          p_mime: input.media.mime,
          p_duration_ms: Math.round(input.media.durationMs),
          p_peaks: input.media.peaks.length > 0 ? input.media.peaks : null,
          p_reply_to: input.replyTo ?? null,
        },
        (row) => noteFromJson(input.roomId, row),
      ),
    /**
     * A short-lived URL (`VOICE_URL_SECONDS`) for one recording, signed by Storage when it checks the bucket's policy for her: it is hers, live and private.
     * Asked for when she presses play, never when a thread loads. An error when it is not hers to hear (or gone).
     */
    async voiceUrl(path: string): Promise<NoteResult<string>> {
      if (!online()) return { data: null, error: 'offline' }
      const answer = await Promise.resolve(client.storage.from(NOTE_VOICE_BUCKET).createSignedUrl(path, VOICE_URL_SECONDS)).catch(() => null)
      if (!answer) return { data: null, error: 'offline' }
      if (answer.error || !answer.data?.signedUrl) return { data: null, error: answer.error ? mapNoteVoiceStorageError(answer.error as StorageFailure) : 'not_found' }
      return { data: answer.data.signedUrl, error: null }
    },
    /** Changes the level of her own note: narrowing is at once (and narrows the wider replies), widening only up to its parent and to Everyone while it is on. */
    setVisibility: (noteId: string, visibility: NoteVisibility) => call('set_note_visibility', { p_note: noteId, p_visibility: visibility }, nothing),
    /** Her reaction (one a note); null, or the same one again, takes it back. */
    react: (noteId: string, emoji: string | null) => call('react_to_note', { p_note: noteId, p_emoji: emoji }, nothing),
    /** Her own note becomes "Note removed". */
    deleteNote: (noteId: string) => call('delete_note', { p_note: noteId }, nothing),
    /** To the owner's inbox: a reason and a few words. */
    report: (noteId: string, reason: string, text: string | null = null) => call('report_note', { p_note: noteId, p_reason: reason, p_text: text }, nothing),
    /** Her cursor in a chapter moves forward to `until`. */
    markRead: (roomId: string, sectionId: string, until: string) => call('mark_notes_read', { p_room: roomId, p_section: sectionId, p_until: until }, nothing),
    /** The owner: Everyone on or off. */
    ownerSetPublic: (enabled: boolean) => call('owner_set_notes_public', { p_enabled: enabled }, nothing),
    /** The owner: the note after a report becomes "Removed by the moderator"; its words go to the log. */
    ownerRemove: (noteId: string, reason: string) => call('owner_remove_note', { p_note: noteId, p_reason: reason }, nothing),
  }
}

export type Notes = ReturnType<typeof createNotes>
