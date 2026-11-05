import type { SupabaseClient } from '@supabase/supabase-js'
import type { BuddyChapter, BuddyReadData, ChatRecord } from '#layers/chat/app/types/adapter'
import { isNoAnswer } from './network'
import { voiceFromJson, VOICE_BUCKET, VOICE_URL_SECONDS, type VoiceInfo, type VoiceJobMedia, type VoiceMime } from './buddyVoice'
import { voiceExtension } from '@fabkho/ui/pure/voice'
import { cardFromJson, socialBookFromJson, type MemberCard, type SocialBook } from './socialShapes'

/**
 * Buddy reads, the data layer (docs/plans/buddy-read-shared.md part 4.3; the database: supabase/migrations/20261113*, the
 * current definition of every function in supabase/schema-snapshot/functions/public.*buddy*.sql). One Book read together by 2 to 12
 * Members in a room, divided into Sections; every read and write is one RPC that first proves the caller is a joined member.
 * Framework-free like every repository here (no Vue, no Nuxt, no auto-imports): it takes the Supabase client and a connection
 * word, so Vitest drives it in plain Node against the stack and a native port copies it 1:1.
 *
 * It maps the database's JSON onto the chat layer's types (`@fabkho/chat`, `app/types/adapter.ts`): a message is a `ChatRecord`
 * (the room is the conversation, a Section its thread: `conversationId` is the buddy read's id, `threadId` the Section's, null in
 * the room), a read is a `BuddyReadData` (a Section is a `BuddyChapter`: `part` is `chapter`, `end` the whole book), and a refusal
 * is a code (`BuddyErrorCode`) the app words in the message file (`buddyRead.error.<code>`, utils/buddyRead.ts).
 *
 * Where the plan and the build differ, the build wins (the plan's part 4.6): `create_buddy_read` and `set_buddy_sections` take
 * `p_from` and `p_page_count`, `set_buddy_hand` an integer, `buddy_read_exists` carries the existing read in `details`, and
 * `buddy_read_messages` answers newest first (this module hands them over oldest first, as the layer's thread keeps them).
 */

// ------------------------------------------------------------------ refusals

/** What the buddy read functions raise, by the message the database gives (the migrations' headers list them), plus the client's own. */
export const BUDDY_ERROR_CODES = [
  'not_signed_in',
  'not_found',
  'not_host',
  'rate_limited',
  'buddy_read_limit',
  'buddy_read_exists',
  'buddy_read_full',
  'buddy_read_ended',
  'buddy_read_archived',
  'buddy_sections_locked',
  'client_id_required',
  'buddy_book_invalid',
  'buddy_sections_invalid',
  'buddy_entry_invalid',
  'buddy_position_invalid',
  'buddy_starts_invalid',
  'buddy_remove_self',
  'buddy_answer_invalid',
  'buddy_section_invalid',
  'message_client_id_required',
  'message_client_id_reused',
  'message_rate_limited',
  'message_unavailable',
  'message_not_yours',
  'message_kind_invalid',
  'message_body_invalid',
  'message_gif_invalid',
  'message_voice_invalid',
  'message_voice_missing',
  'message_voice_too_large',
  'message_spoiler_unavailable',
  'message_reply_unavailable',
  'message_emoji_invalid',
  'report_reason_invalid',
  'report_note_too_long',
  'report_self',
] as const

/**
 * What a refusal can be: the database's (`BUDDY_ERROR_CODES`) and the client's own: no connection, busy, unknown, and the three a recording
 * is refused for before it is sent (`voice_short`: a slip of the finger, `voice_large`: over 3 MB, `voice_type`: a type the bucket does not take).
 */
export type BuddyErrorCode = (typeof BUDDY_ERROR_CODES)[number] | 'offline' | 'busy' | 'unknown' | 'voice_short' | 'voice_large' | 'voice_type'

/** A call's answer. `existing`: the read she already has, on `buddy_read_exists`. */
export type BuddyResult<T> = { data: T; error: null } | { data: null; error: BuddyErrorCode; existing?: string }

/** The failures a retry may cure: no connection, a deadlock or serialisation failure the database asks to be tried again, a failure nobody explained. */
export const RETRYABLE_ERRORS: readonly BuddyErrorCode[] = ['offline', 'busy', 'unknown', 'message_rate_limited']

export const isRetryableBuddyError = (code: BuddyErrorCode): boolean => RETRYABLE_ERRORS.includes(code)

type StorageFailure = { message?: string; statusCode?: string | number; status?: number; name?: string }

/**
 * A refusal of the Storage API for a recording, as a code: no answer (a request that never came back has no status) is offline; 401 and 403 (the
 * bucket's policy: she is not in the read, it is archived, or her hour of uploads is spent) a read she cannot write in; 413 and the bucket's type check
 * the recording's own.
 */
export function mapVoiceStorageError(failure: StorageFailure): BuddyErrorCode {
  const message = failure.message ?? ''
  const status = Number(failure.statusCode ?? failure.status ?? 0)
  if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(message)) return 'not_found'
  if (status === 413 || /payload too large|exceeded the maximum/i.test(message)) return 'message_voice_too_large'
  if (/mime type|not supported/i.test(message)) return 'message_voice_invalid'
  if (status === 409 || /already exists|duplicate/i.test(message)) return 'unknown'
  if (!status || failure.name === 'StorageUnknownError') return 'offline'
  return 'unknown'
}

/** A refusal as the database worded it, as a code. An id that is no id (22P02) finds nothing. */
export function mapBuddyError(failure: { message?: string; code?: string }): BuddyErrorCode {
  const message = failure.message ?? ''
  const raised = BUDDY_ERROR_CODES.find((code) => message === code)
  if (raised) return raised
  if (failure.code === '22P02') return 'not_found'
  // Deadlock detected, serialisation failure, lock not available: the same call works a moment later.
  if (failure.code === '40P01' || failure.code === '40001' || failure.code === '55P03') return 'busy'
  return 'unknown'
}

// ------------------------------------------------------------------ shapes

/** Where a member is, as the other members see it: a Section (k, from 1), the end (every part read) or not set. Never a page or a figure. */
export type BuddyWhere = { kind: 'section'; section: number } | { kind: 'end' } | { kind: 'not_set' }

/** A member of a read: her card, her role and where she is (null across a block, both ways). */
export type BuddyMember = MemberCard & { role: 'host' | 'member'; where: BuddyWhere | null }

/** Hers alone: the linked entry, the Section worked out from her reading (`auto`), her own say (`hand`), the Sections she has read through. */
export type BuddyMe = { entryId: string | null; auto: number | null; hand: number | null; readThrough: number; where: BuddyWhere }

/** The room's own thread ("Before we start"; no Section) in numbers. */
export type BuddyCount = { count: number; unread: number }

/**
 * A buddy read as its screen is drawn (`buddy_read`), the layer's `BuddyReadData` and what the app adds to it. Layer fields: a Section
 * is a `chapters` row (position from 1, `end` last), the others' markers are `marks` (`readThrough` = the Sections she has read
 * through, so a member reading Section k stands at k - 1: `where` says it as the database does), `createdAt` is the day it starts
 * (the database does not give the creation time).
 */
export type BuddyRead = BuddyReadData & {
  /** The Book as the app draws a cover (`book` is the layer's plain title, author and cover). */
  bookCard: SocialBook
  startsOn: string
  finishedAt: string | null
  archivedAt: string | null
  pageCount: number | null
  sectionsFrom: 'count' | 'pages' | 'list'
  role: 'host' | 'member'
  room: BuddyCount
  members: BuddyMember[]
  me: BuddyMe
  /** The host's link, null when it is off and for everybody else. */
  linkToken: string | null
  /** Waiting invitations, the host only. */
  invited: MemberCard[]
}

/** One row of "Reading together" (`my_buddy_reads().reads`). `sections`: how many parts (without the end). */
export type BuddyCard = {
  id: string
  book: SocialBook
  status: 'active' | 'finished' | 'archived'
  startsOn: string
  role: 'host' | 'member'
  memberCount: number
  sections: number
  where: BuddyWhere
  unread: number
}

/** An invitation she has not answered (`my_buddy_reads().invitations`). */
export type BuddyInvitation = {
  id: string
  book: SocialBook
  startsOn: string
  host: MemberCard | null
  invitedBy: MemberCard | null
  memberCount: number
  sections: number
}

export type MyBuddyReads = { reads: BuddyCard[]; invitations: BuddyInvitation[] }

/** The join card (`buddy_read_target`): null for a bad, off, renewed, ended, full or blocked link, one answer for all. */
export type BuddyTarget = {
  id: string
  book: SocialBook
  host: MemberCard | null
  members: MemberCard[]
  memberCount: number
  sections: number
  startsOn: string
  state: 'none' | 'invited' | 'member'
}

export type BuddyReaction = { emoji: string; count: number; mine: boolean }

/**
 * A message of a read: the layer's `ChatRecord` and what the app adds. A tombstone has `deletedAt`, an empty body and no reactions. A voice message
 * (`kind: 'voice'`) has `voice` (its type, length and waveform, and the name of its object; the sound is fetched through a signed URL when she
 * presses play, never carried here) and no words.
 */
export type BuddyMessage = ChatRecord & {
  voice: VoiceInfo | null
  /** Null from a live event (it does not carry the name): the app finds it among the members. */
  authorName: string | null
  deletedAt: string | null
  reactions: BuddyReaction[]
}

/** One Section to write (`create_buddy_read`, `set_buddy_sections`): the last one is the `end`, `toFraction` 1. */
export type BuddySectionInput = { kind: 'part' | 'end'; label: string; startPage?: number | null; endPage?: number | null; toFraction: number }

export const SECTIONS_FROM = ['count', 'pages', 'list'] as const
export type SectionsFrom = (typeof SECTIONS_FROM)[number]

export type CreateBuddyRead = {
  /** A Catalogue Book of her Library. */
  bookId: string
  /** The call's own id: the same one again answers the read it made. */
  clientId: string
  sections: BuddySectionInput[]
  from?: SectionsFrom
  pageCount?: number | null
  invite?: string[]
  link?: boolean
  startsOn?: string | null
}

export type CreatedBuddyRead = { id: string; linkToken: string | null; invited: string[]; skipped: string[] }

/** A recording that is stored (`uploadVoice`) and is to be posted (`sendVoice`): the same client id names both the object and the message. */
export type SendBuddyVoice = {
  readId: string
  /** Null: the room. */
  sectionId: string | null
  clientId: string
  media: VoiceJobMedia
  replyTo?: string | null
  spoiler?: boolean
}

export type PostBuddyMessage = {
  readId: string
  /** Null: the room. */
  sectionId: string | null
  /** The sending device's id for it: a retry answers the row it made. */
  clientId: string
  body: string
  replyTo?: string | null
  spoiler?: boolean
}

export type MessagePage = { items: BuddyMessage[]; /** The page came back full: older ones may be there. */ more: boolean }

/** `buddy_read_messages` hands over at most this many, 50 when no limit is asked. */
export const MESSAGES_PAGE = 50
export const MESSAGES_MAX = 100

/** The six reactions the database takes. */
export const BUDDY_EMOJI = ['❤️', '😂', '😮', '😢', '🔥', '📚'] as const

export const REPORT_REASONS = ['harassment', 'spam', 'inappropriate', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

// ------------------------------------------------------------------ JSON → shapes

type CardJson = Parameters<typeof cardFromJson>[0]
type BookJson = Parameters<typeof socialBookFromJson>[0]
type WhereJson = { kind: 'section'; section: number } | { kind: 'end' } | { kind: 'not_set' }

export function whereFromJson(json: WhereJson | null | undefined): BuddyWhere | null {
  if (!json) return null
  if (json.kind === 'section') return { kind: 'section', section: Number(json.section) }
  return json.kind === 'end' ? { kind: 'end' } : { kind: 'not_set' }
}

type MemberJson = CardJson & { role: 'host' | 'member'; where: WhereJson | null }
const memberFromJson = (json: MemberJson): BuddyMember => ({ ...cardFromJson(json), role: json.role, where: whereFromJson(json.where) })

type MeJson = { entry_id: string | null; auto: number | null; hand: number | null; read_through: number; where: WhereJson }
const meFromJson = (json: MeJson): BuddyMe => ({
  entryId: json.entry_id ?? null,
  auto: json.auto ?? null,
  hand: json.hand ?? null,
  readThrough: Number(json.read_through),
  where: whereFromJson(json.where) ?? { kind: 'not_set' },
})

type SectionJson = {
  id: string
  position: number
  kind: 'part' | 'end'
  label: string
  start_page: number | null
  end_page: number | null
  count: number
  unread: number
}

/** A Section as the layer's chapter: `part` is a `chapter`, the `end` the whole book (a title the app words, so its label is kept as it is). */
export const chapterFromJson = (json: SectionJson): BuddyChapter => ({
  id: json.id,
  position: Number(json.position),
  kind: json.kind === 'end' ? 'end' : 'chapter',
  title: json.label,
  pages: json.start_page != null && json.end_page != null ? [json.start_page, json.end_page] : null,
  count: Number(json.count ?? 0),
  unread: Number(json.unread ?? 0),
})

/** The markers the layer wants, from where each member stands: reading Section k is read through k - 1, the end all `parts`; not set has none. */
export function marksOf(members: readonly BuddyMember[], parts: number, me: { id: string | null; readThrough: number }): BuddyReadData['marks'] {
  const marks: BuddyReadData['marks'] = []
  for (const member of members) {
    if (member.id === me.id) marks.push({ memberId: member.id, readThrough: me.readThrough })
    else if (member.where?.kind === 'section') marks.push({ memberId: member.id, readThrough: member.where.section - 1 })
    else if (member.where?.kind === 'end') marks.push({ memberId: member.id, readThrough: parts })
  }
  return marks
}

type ReadJson = {
  id: string
  book: BookJson
  status: 'active' | 'finished' | 'archived'
  starts_on: string
  finished_at: string | null
  archived_at: string | null
  sections_from: SectionsFrom
  page_count: number | null
  role: 'host' | 'member'
  can_manage: boolean
  room: BuddyCount
  sections: SectionJson[]
  members: MemberJson[]
  me: MeJson
  link_token: string | null
  invited: CardJson[] | null
}

const authorsLine = (book: SocialBook): string | null => (book.authors.length > 0 ? book.authors.join(', ') : null)

/** `buddy_read` (and the answer of `set_buddy_sections`) as the screen's shape. `self`: who is asking, for her own marker. */
export function readFromJson(json: ReadJson, self: string | null = null): BuddyRead {
  const bookCard = socialBookFromJson(json.book)
  const members = (json.members ?? []).map(memberFromJson)
  const me = meFromJson(json.me)
  const chapters = (json.sections ?? []).map(chapterFromJson)
  const parts = chapters.filter((c) => c.kind === 'chapter').length
  return {
    id: json.id,
    conversationId: json.id,
    book: { title: bookCard.title, author: authorsLine(bookCard), cover: bookCard.coverUrl },
    status: json.status,
    sourceId: null,
    chaptersFrom: json.sections_from === 'list' ? null : json.sections_from,
    createdAt: json.starts_on,
    chapters,
    marks: marksOf(members, parts, { id: self, readThrough: me.readThrough }),
    readThrough: me.readThrough,
    canManage: Boolean(json.can_manage),
    bookCard,
    startsOn: json.starts_on,
    finishedAt: json.finished_at ?? null,
    archivedAt: json.archived_at ?? null,
    pageCount: json.page_count ?? null,
    sectionsFrom: json.sections_from,
    role: json.role,
    room: { count: Number(json.room?.count ?? 0), unread: Number(json.room?.unread ?? 0) },
    members,
    me,
    linkToken: json.link_token ?? null,
    invited: (json.invited ?? []).map(cardFromJson),
  }
}

type CardRowJson = {
  id: string
  book: BookJson
  status: 'active' | 'finished' | 'archived'
  starts_on: string
  role: 'host' | 'member'
  member_count: number
  sections: number
  where: WhereJson
  unread: number
}
type InvitationJson = {
  id: string
  book: BookJson
  starts_on: string
  host: CardJson | null
  invited_by: CardJson | null
  member_count: number
  sections: number
}

export function myReadsFromJson(json: { reads?: CardRowJson[] | null; invitations?: InvitationJson[] | null }): MyBuddyReads {
  return {
    reads: (json.reads ?? []).map((r) => ({
      id: r.id,
      book: socialBookFromJson(r.book),
      status: r.status,
      startsOn: r.starts_on,
      role: r.role,
      memberCount: Number(r.member_count),
      sections: Number(r.sections),
      where: whereFromJson(r.where) ?? { kind: 'not_set' },
      unread: Number(r.unread ?? 0),
    })),
    invitations: (json.invitations ?? []).map((i) => ({
      id: i.id,
      book: socialBookFromJson(i.book),
      startsOn: i.starts_on,
      host: i.host ? cardFromJson(i.host) : null,
      invitedBy: i.invited_by ? cardFromJson(i.invited_by) : null,
      memberCount: Number(i.member_count),
      sections: Number(i.sections),
    })),
  }
}

type TargetJson = {
  id: string
  book: BookJson
  host: CardJson | null
  members: CardJson[]
  member_count: number
  sections: number
  starts_on: string
  state: 'none' | 'invited' | 'member'
}

export const targetFromJson = (json: TargetJson): BuddyTarget => ({
  id: json.id,
  book: socialBookFromJson(json.book),
  host: json.host ? cardFromJson(json.host) : null,
  members: (json.members ?? []).map(cardFromJson),
  memberCount: Number(json.member_count),
  sections: Number(json.sections),
  startsOn: json.starts_on,
  state: json.state,
})

type MessageJson = {
  id: string
  section_id: string | null
  author: { id: string | null; name: string | null }
  client_id: string | null
  kind: string
  body: string | null
  media_url: string | null
  media_width: number | null
  media_height: number | null
  voice?: { path?: string | null; mime?: string | null; duration_ms?: number | null; peaks?: number[] | null } | null
  reply_to: string | null
  spoiler: boolean
  created_at: string
  deleted_at: string | null
  reactions: BuddyReaction[] | null
}

function mediaOf(url: string | null, width: number | null, height: number | null, kind: string): BuddyMessage['media'] {
  return kind === 'gif' && url ? { kind: 'gif', path: null, url, width: Number(width ?? 0), height: Number(height ?? 0) } : null
}

/** A message from `buddy_read_messages` or `post_buddy_message`. `readId`: the buddy read it was asked in (the answer does not repeat it). */
export function messageFromJson(readId: string, json: MessageJson): BuddyMessage {
  return {
    id: json.id,
    conversationId: readId,
    threadId: json.section_id ?? null,
    senderId: json.author?.id ?? null,
    clientId: json.client_id ?? null,
    kind: json.kind,
    body: json.body ?? '',
    createdAt: json.created_at,
    replyTo: json.reply_to ?? null,
    spoiler: Boolean(json.spoiler),
    media: mediaOf(json.media_url, json.media_width, json.media_height, json.kind),
    voice: json.kind === 'voice' ? voiceFromJson(json.voice, { readId, authorId: json.author?.id ?? null, clientId: json.client_id ?? null }) : null,
    authorName: json.author?.name ?? null,
    deletedAt: json.deleted_at ?? null,
    reactions: (json.reactions ?? []).map((r) => ({ emoji: r.emoji, count: Number(r.count), mine: Boolean(r.mine) })),
  }
}

// ------------------------------------------------------------------ the repository

/** The calls of every screen of a buddy read; one per database function. */
export type BuddyReads = ReturnType<typeof createBuddyReads>

export type BuddyReadsOptions = {
  /** Whether the device can reach the backend (`isOnline`): a call refused for want of it never leaves. */
  online?: () => boolean
  /** Who is asking (her marker among the others' in `read`). */
  self?: () => string | null
}

const sectionsJson = (sections: readonly BuddySectionInput[]) =>
  sections.map((s) => ({ kind: s.kind, label: s.label, start_page: s.startPage ?? null, end_page: s.endPage ?? null, to_fraction: s.toFraction }))

export function createBuddyReads(client: SupabaseClient, { online = () => true, self = () => null }: BuddyReadsOptions = {}) {
  /** One call to a database function: refused offline first, a refusal mapped, the answer read by `read`. */
  async function call<J, T>(fn: string, args: Record<string, unknown>, read: (json: J) => T): Promise<BuddyResult<T>> {
    if (!online()) return { data: null, error: 'offline' }
    // A request that throws (a navigation cancelled it) got no answer: the same as offline, never a rejection for a caller that did not expect one.
    const answer = await Promise.resolve(client.rpc(fn, args)).catch(() => null)
    if (!answer) return { data: null, error: 'offline' }
    if (isNoAnswer(answer)) return { data: null, error: 'offline' }
    if (answer.error) {
      const code = mapBuddyError(answer.error)
      const existing = code === 'buddy_read_exists' ? (answer.error as { details?: string }).details : undefined
      return existing ? { data: null, error: code, existing } : { data: null, error: code }
    }
    return { data: read(answer.data as J), error: null }
  }

  const nothing = () => undefined
  const clampPage = (limit: number | undefined) => Math.min(MESSAGES_MAX, Math.max(1, limit ?? MESSAGES_PAGE))

  return {
    // ---- the rooms
    /** Starts a read of a Book of hers (she is its Host). Idempotent on `clientId`. */
    create: (input: CreateBuddyRead) =>
      call<{ id: string; link_token: string | null; invited: string[]; skipped: string[] }, CreatedBuddyRead>(
        'create_buddy_read',
        {
          p_book: input.bookId,
          p_client_id: input.clientId,
          p_sections: sectionsJson(input.sections),
          p_invite: input.invite ?? [],
          p_link: input.link ?? false,
          p_starts: input.startsOn ?? null,
          p_from: input.from ?? 'count',
          p_page_count: input.pageCount ?? null,
        },
        (j) => ({ id: j.id, linkToken: j.link_token ?? null, invited: j.invited ?? [], skipped: j.skipped ?? [] }),
      ),
    /** Her reads and the invitations waiting for her: the Home card's one query. */
    mine: () => call('my_buddy_reads', {}, myReadsFromJson),
    /** One read as its screen draws it. */
    read: (id: string) => call<ReadJson, BuddyRead>('buddy_read', { p_id: id }, (j) => readFromJson(j, self())),
    /** Host: invite people she follows. `invited`: everyone of the list who is in the read now; `skipped`: the rest. */
    invite: (id: string, members: string[]) =>
      call<{ invited: string[]; skipped: string[] }, { invited: string[]; skipped: string[] }>('invite_to_buddy_read', { p_id: id, p_members: members }, (j) => ({
        invited: j.invited ?? [],
        skipped: j.skipped ?? [],
      })),
    /** Host: the link on or off, `renew` makes a new one (the old dies). The token, null when off. */
    link: (id: string, on: boolean, renew = false) => call<string | null, string | null>('buddy_read_link', { p_id: id, p_on: on, p_renew: renew }, (j) => j ?? null),
    /** The join card of a link; null (not an error) when the link does not work. */
    target: (token: string) => call<TargetJson | null, BuddyTarget | null>('buddy_read_target', { p_token: token }, (j) => (j ? targetFromJson(j) : null)),
    /** Joins by a link; idempotent. The read's id. */
    join: (token: string) => call<{ id: string }, string>('join_buddy_read', { p_token: token }, (j) => j.id),
    answer: (id: string, join: boolean) => call('answer_buddy_invite', { p_id: id, p_join: join }, nothing),
    /** Her Library entry for the read (null unlinks); refreshes her Section. */
    linkEntry: (id: string, entry: string | null) => call<MeJson, BuddyMe>('link_buddy_entry', { p_id: id, p_entry: entry }, meFromJson),
    /** The hand override: the Sections she has read through (0 to the number of parts), null for "automatic". */
    setHand: (id: string, through: number | null) => call<MeJson, BuddyMe>('set_buddy_hand', { p_id: id, p_through: through }, meFromJson),
    leave: (id: string, deleteMessages = false) => call('leave_buddy_read', { p_id: id, p_delete_messages: deleteMessages }, nothing),
    remove: (id: string, member: string) => call('remove_from_buddy_read', { p_id: id, p_member: member }, nothing),
    finish: (id: string) => call('finish_buddy_read', { p_id: id }, nothing),
    archive: (id: string) => call('archive_buddy_read', { p_id: id }, nothing),
    /** Host: rename always, replace the division only while no Section has a message (`buddy_sections_locked`). Answers the read. */
    setSections: (id: string, sections: BuddySectionInput[], from: SectionsFrom = 'count', pageCount: number | null = null) =>
      call<ReadJson, BuddyRead>('set_buddy_sections', { p_id: id, p_sections: sectionsJson(sections), p_from: from, p_page_count: pageCount }, (j) => readFromJson(j, self())),

    // ---- the talking
    /** Writes a message into the room or a Section; the one she sent before under `clientId` answers again. */
    post: (input: PostBuddyMessage) =>
      call<MessageJson, BuddyMessage>(
        'post_buddy_message',
        {
          p_read: input.readId,
          p_section: input.sectionId,
          p_client_id: input.clientId,
          p_kind: 'text',
          p_body: input.body,
          p_reply_to: input.replyTo ?? null,
          p_spoiler: input.spoiler ?? false,
          p_gif: null,
        },
        (j) => messageFromJson(input.readId, j),
      ),
    /**
     * Stores a recording in the private bucket, in her own folder of the read, under the name its message will have (`<read>/<her id>/<client id>.<ext>`).
     * Not the message: `sendVoice` posts it (through the send queue). The same client id again finds the object there and is answered as stored, so a retry
     * after a lost answer does not fail on "already exists". Refused offline before anything leaves.
     */
    async uploadVoice(readId: string, authorId: string, clientId: string, blob: Blob, mime: VoiceMime): Promise<BuddyResult<string>> {
      if (!online()) return { data: null, error: 'offline' }
      const path = `${readId}/${authorId}/${clientId}.${voiceExtension(mime)}`
      const { error } = await Promise.resolve(
        client.storage.from(VOICE_BUCKET).upload(path, blob, { contentType: mime, upsert: false, cacheControl: '3600' }),
      ).catch(() => ({ error: { name: 'StorageUnknownError', message: 'fetch failed' } as StorageFailure }))
      if (!error) return { data: path, error: null }
      const code = mapVoiceStorageError(error as StorageFailure)
      // The object of this very send is already there (the answer of a first try was lost): as good as stored.
      if (/already exists|duplicate/i.test((error as StorageFailure).message ?? '') || Number((error as StorageFailure).statusCode) === 409) return { data: path, error: null }
      return { data: null, error: code }
    },
    /** Posts a stored recording into the room or a Section; the one she sent before under `clientId` answers again. */
    sendVoice: (input: SendBuddyVoice) =>
      call<MessageJson, BuddyMessage>(
        'send_buddy_voice',
        {
          p_read: input.readId,
          p_section: input.sectionId,
          p_client_id: input.clientId,
          p_mime: input.media.mime,
          p_duration_ms: Math.round(input.media.durationMs),
          p_peaks: input.media.peaks.length > 0 ? input.media.peaks : null,
          p_reply_to: input.replyTo ?? null,
          p_spoiler: input.spoiler ?? false,
        },
        (j) => messageFromJson(input.readId, j),
      ),
    /**
     * A short-lived URL (`VOICE_URL_SECONDS`) for one recording, signed by Storage when it checks the bucket's policy for her: a member of the read who may
     * hear that author, a live message. Asked for when she presses play, never when a thread loads. null when it is not hers to hear (or gone).
     */
    async voiceUrl(path: string): Promise<BuddyResult<string>> {
      if (!online()) return { data: null, error: 'offline' }
      const answer = await Promise.resolve(client.storage.from(VOICE_BUCKET).createSignedUrl(path, VOICE_URL_SECONDS)).catch(() => null)
      if (!answer) return { data: null, error: 'offline' }
      if (answer.error || !answer.data?.signedUrl) return { data: null, error: answer.error ? mapVoiceStorageError(answer.error as StorageFailure) : 'not_found' }
      return { data: answer.data.signedUrl, error: null }
    },
    /** A page of a thread, oldest first: the newest ones, or those older than `before`, or newer than `after` (the server's `created_at`, as it gave it). */
    messages: (readId: string, sectionId: string | null, { before, after, limit }: { before?: string | null; after?: string | null; limit?: number } = {}) => {
      const asked = clampPage(limit)
      return call<MessageJson[], MessagePage>(
        'buddy_read_messages',
        { p_read: readId, p_section: sectionId, p_before: before ?? null, p_after: after ?? null, p_limit: asked },
        (rows) => ({ items: rows.map((j) => messageFromJson(readId, j)).reverse(), more: rows.length >= asked }),
      )
    },
    /** One reaction: an emoji of the six, or null to take hers back. */
    react: (messageId: string, emoji: string | null) => call('react_to_buddy_message', { p_message: messageId, p_emoji: emoji }, nothing),
    /** Her own message, or any of her room as the host: it stays as a tombstone. */
    deleteMessage: (messageId: string) => call('delete_buddy_message', { p_message: messageId }, nothing),
    /** Her read cursor of a thread (null section: the room) moves forward to `through`, to the newest when null. */
    mark: (readId: string, sectionId: string | null, through: string | null) => call('mark_buddy_read', { p_read: readId, p_section: sectionId, p_through: through }, nothing),
    /** A report goes to the instance owner's inbox (feedback, kind report). */
    report: (messageId: string, reason: ReportReason, note: string | null = null) => call('report_buddy_message', { p_message: messageId, p_reason: reason, p_note: note }, nothing),
  }
}

/** The `before` that makes a page of one message of the page that holds `createdAt` (a millisecond past it: the server's times carry microseconds). */
export function justAfter(createdAt: string): string {
  const ms = Date.parse(createdAt.replace(/(\.\d{3})\d*/, '$1'))
  return new Date(ms + 1).toISOString()
}
