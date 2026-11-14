import { sameSide, type BubbleMessage, type BubbleQuote } from '#layers/ui/app/utils/chat/message'
import { REPORT_REASONS, type ReportReason } from '~/data/buddyReads'
import type { VoiceInfo } from '~/data/buddyVoice'

/**
 * A room's thread as its screen draws it, the parts a buddy read (pages/together/[id]/[section].vue, utils/buddyThread.ts) and a Book's notes
 * (pages/notes/[book]/[chapter].vue, utils/noteThread.ts) both use: the stored bubbles of a store turned into what the base's `UiChatThread` and `UiBubble` take (`BubbleMessage`), plus what only a buddy
 * read adds: who wrote it, the message it answers and the tombstone. Pure functions on plain data, so Vitest
 * drives them in Node.
 *
 * **The veil lives here**: a Section that is not open to her (her marker has not reached it and she has not opened it anyway:
 * the layer's `chapterView`) has no items at all, whatever the store holds, so nothing of what was said in it can be drawn,
 * measured or read by a screen reader. (There are no spoiler marks on single messages: a chapter is opened to be read.) The database gives
 * every member every message of the read (the veil is the app's, plan part 5.4): this is the one place the rule is applied.
 */

/** One message of a thread: the base's message and what the screen needs besides. */
export type ThreadItem = BubbleMessage & {
  /** The member who wrote it; null for one who has gone. */
  authorId: string | null
  /** Her name as the others know her; null from a live event the members do not name yet, or a member who has gone. */
  author: string | null
  /** The message it answers. */
  replyTo: string | null
  /** It was deleted: a tombstone (`kind: 'system'`, no words, no reactions), drawn as a quiet line, never as a bubble. */
  removed: boolean
  /** A voice message (its sound is the bubble's, drawn by `UiVoiceBubble`; its words are none: the quote says "Voice message"). */
  voice: boolean
  /** It was refused for a reason a second try cannot change (removed, blocked, archived, invalid): no "Try again", only "Delete". */
  permanent: boolean
}

/** What the thread needs of the screen: who she is, whether the Section is open to her, the words. */
export type RoomThreadContext = {
  me: string | null
  /** The Section is open to her (the store's `view(...).open`; the room always is). */
  open: boolean
  /** A member's name among the read's members, or null. */
  nameOf: (memberId: string | null) => string | null
  /** The sentence a refusal is worded with (`buddyRead.error.<code>`, `notes.error.<code>`). */
  errorWord: (code: string) => string
  /** Whether a second try can change a refusal (a lost connection can, a removed room cannot): the ones it cannot are `permanent`. */
  retryable: (code: string) => boolean
  /** The device's own copy of a recording she sent in this session (a `blob:` URL), by client id; null for every other message. */
  previewOf?: (clientId: string | null) => string | null
}

/**
 * What a voice bubble plays from before anything is signed: nothing (the thread never fetches a sound). The base's play button is off while a
 * message has no `url`, so an unsigned one carries this stand-in; the page asks for the real, short-lived URL when she presses play
 * (`pages/together/[id]/[section].vue`, the press gate) and the stand-in is never given to the player.
 */
export const VOICE_UNSIGNED = 'about:blank'

/** What a thread draws of a stored or pending message: a buddy read's `BuddyBubble` and a note's `NoteBubble` both are one. */
export type RoomBubble = {
  id: string
  senderId: string | null
  clientId: string | null
  kind: string
  body: string
  createdAt: string
  replyTo: string | null
  authorName: string | null
  deletedAt: string | null
  reactions: readonly { emoji: string; count: number; mine: boolean }[]
  voice: VoiceInfo | null
  state: 'sent' | 'sending' | 'failed'
  error: string | null
}

/** The key a message keeps from its bubble to its stored row: the client id (the same send), else the stored id. */
export const bubbleKey = (bubble: Pick<RoomBubble, 'clientId' | 'id'>): string => bubble.clientId ?? bubble.id

/**
 * The messages the screen draws, oldest first. A Section that is not open has none. A tombstone becomes a system line (the base
 * breaks a run at it and the screen draws "Message removed").
 */
export function roomItems(bubbles: readonly RoomBubble[], ctx: RoomThreadContext): ThreadItem[] {
  if (!ctx.open) return []
  return bubbles.map((bubble) => {
    const removed = bubble.deletedAt !== null
    const mine = ctx.me !== null && bubble.senderId === ctx.me
    const reaction = bubble.reactions.find((r) => r.mine)
    const voice = !removed && bubble.kind === 'voice' ? bubble.voice : null
    const playable = voice
    return {
      key: bubbleKey(bubble),
      // Null while it is on its way or refused: it cannot be reacted to or answered yet.
      id: bubble.state === 'sent' ? bubble.id : null,
      mine,
      kind: removed ? 'system' : playable ? 'media' : 'text',
      body: removed ? '' : voice ? '' : bubble.body,
      createdAt: bubble.createdAt,
      delivery: bubble.state,
      error: bubble.state === 'failed' && bubble.error ? ctx.errorWord(bubble.error) : null,
      media: playable
        ? {
            kind: 'voice',
            // Stored: the stand-in, until she presses play. On its way with no copy on this device (restored after a reload): no URL, the button is off.
            url: ctx.previewOf?.(bubble.clientId) ?? (bubble.state === 'sent' ? VOICE_UNSIGNED : null),
            path: voice.path,
            width: 1,
            height: 1,
            removed: false,
            durationMs: voice.durationMs,
            peaks: voice.peaks,
            mime: voice.mime,
          }
        : null,
      reactions: removed ? [] : bubble.reactions.map((r) => ({ emoji: r.emoji, count: r.count, mine: r.mine })),
      myReaction: removed ? null : (reaction?.emoji ?? null),
      authorId: bubble.senderId,
      author: bubble.authorName ?? ctx.nameOf(bubble.senderId),
      replyTo: bubble.replyTo,
      removed,
      voice: voice !== null,
      permanent: bubble.state === 'failed' && !!bubble.error && !ctx.retryable(bubble.error),
    }
  })
}

/**
 * Whether two messages in a row are one run (they sit closer, the first of it carries the name, the last the avatar and the tail): the
 * base's rule (`sameSide`: both hers or both somebody else's, neither a system line, so a tombstone breaks a run) **and the same author**.
 * The base's default knows only mine and not mine, which is right for a 1:1 chat and wrong in a room of three: two other members
 * posting one after the other would be one run under the first one's name with the last one's face. Day breaks are the base's own
 * (a separator row between two messages ends the run before this is asked). Pass it as `UiChatThread`'s `sameRun`.
 */
export function sameAuthorRun(before: Pick<ThreadItem, 'mine' | 'kind' | 'authorId'>, item: Pick<ThreadItem, 'mine' | 'kind' | 'authorId'>): boolean {
  return sameSide(before, item) && before.authorId === item.authorId
}

/** One row of reactions on a message: whose it is (`mine`), which it is, how many. */
export type ReactionRow = { emoji: string; count: number; mine: boolean }

/**
 * Her reaction at once, before the database says: `emoji` replaces the one she had (null takes it back; the same one again takes it back too,
 * as the database does). Counts decrement, rows at zero drop.
 */
export function toggledReaction<T extends ReactionRow>(reactions: readonly T[], emoji: string | null): T[] {
  const had = reactions.find((r) => r.mine)?.emoji ?? null
  const next = emoji === had ? null : emoji
  const out = reactions
    .map((r) => (r.emoji === had ? { ...r, count: r.count - 1, mine: false } : { ...r }))
    .filter((r) => r.count > 0)
  if (!next) return out
  const there = out.find((r) => r.emoji === next)
  if (there) {
    there.count += 1
    there.mine = true
  } else out.push({ emoji: next, count: 1, mine: true } as T)
  return out
}

/** The words a quote needs that are the app's. A buddy read's are the first four (it has no server quote, so no `hidden`); a Book's notes need `hidden` too, and both word a voice message because both threads send them. */
export type QuoteWords = { deleted: string; someone: string; you: string; voice?: string; hidden?: string }

/** The most of a message's words a quote shows (and what the database keeps of a quoted note's excerpt: `private.note_quote`). */
export const QUOTE_PREVIEW_MAX = 120

/**
 * Where the quote of a message comes from: the two threads agree on it here rather than each resolving its own.
 *
 * - `reply`: the message answers another one of the thread, found among the items (`replyTo`, both threads).
 * - `hidden`: the server holds the note it answers and says she may not read it: no id to jump to, no words to show.
 * - `removed`: the server says the note it answers is deleted: no id, and the words "removed".
 * - `note`: the server sent the note it answers as she may see it: `id` jumps to it when it is in the loaded page, `excerpt` is its words
 *   (already cut by the database), and `voice` says it is a voice note (no words at all).
 */
export type QuoteSource =
  | { kind: 'reply'; replyTo: string }
  | { kind: 'hidden' }
  | { kind: 'removed' }
  | { kind: 'note'; id: string; mine: boolean; author: string | null; excerpt: string; voice: boolean }

/** A message's first words, as a quote or the composer's chip shows them: one line, and no more than `QUOTE_PREVIEW_MAX` characters. */
export const quotePreview = (words: string): string => words.replace(/\s+/g, ' ').trim().slice(0, QUOTE_PREVIEW_MAX)

/** The quote a voice message is: "Voice message" when the app words it, nothing when it does not. */
const voiceQuote = (words: QuoteWords): string => words.voice ?? ''

/**
 * The quote of a message that answers nothing among the items: a note's is a note she may not see, which is said with `words.hidden` and no name at
 * all (its author is not hers to know); a buddy read's is a tombstone, so it says that and keeps the author it cannot vouch for ("A reader").
 */
const missingQuote = (words: QuoteWords): BubbleQuote =>
  words.hidden ? { id: null, mine: false, name: '', preview: words.hidden } : { id: null, mine: false, name: words.someone, preview: words.deleted }

/**
 * The quote of a message, as the base draws it over a bubble or in the composer: who wrote it and its first words, and the id to jump to when the
 * original is one she can reach. null when it answers nothing. A tombstone says it is gone, a voice message is "Voice message" (it has no words),
 * a note she may not read says so (`words.hidden`, both name and words withheld), and an original that is not among the items is a note she may not
 * read for the thread that has `hidden` to say it with, a tombstone for the one that does not.
 */
export function quoteOf(items: readonly ThreadItem[], source: QuoteSource | null, words: QuoteWords): BubbleQuote | null {
  if (!source) return null
  if (source.kind === 'hidden') return { id: null, mine: false, name: '', preview: words.hidden ?? '' }
  if (source.kind === 'removed') return { id: null, mine: false, name: '', preview: words.deleted }
  if (source.kind === 'note') {
    const present = items.some((item) => item.id === source.id)
    return {
      id: present ? source.id : null,
      mine: source.mine,
      name: source.mine ? words.you : (source.author?.trim() || words.someone),
      preview: source.voice ? voiceQuote(words) : source.excerpt,
    }
  }
  const original = items.find((item) => item.id === source.replyTo)
  if (!original) return missingQuote(words)
  const preview = original.removed ? words.deleted : original.voice ? voiceQuote(words) : quotePreview(original.body)
  return { id: original.removed ? null : original.id, mine: original.mine, name: original.mine ? words.you : (original.author ?? words.someone), preview }
}

/**
 * The quote the composer shows above the box while she answers `item`: who and the first words, never more than the base draws. Both threads'
 * composers use it, so the shape and the cut are decided once.
 */
export function replyChipOf(item: Pick<ThreadItem, 'mine' | 'author' | 'voice' | 'body'>, words: Pick<QuoteWords, 'someone' | 'you' | 'voice'>): { name: string; preview: string } {
  return { name: item.mine ? words.you : (item.author ?? words.someone), preview: item.voice ? voiceQuote(words) : quotePreview(item.body) }
}

// ------------------------------------------------------------------ report

/** The most of a note the database keeps (`report_note_too_long`). */
export const REPORT_NOTE_MAX = 1000

/**
 * What a report sends: the reason, and the note she added trimmed, cut to what the database takes and null when there is none.
 * The reason is the one she picked; null for anything the database would refuse (nothing is sent then). The message's words are
 * never part of it: the database copies a short excerpt itself (`feedback.context`, kind `report`), which is what the owner reads.
 */
export function reportInput(reason: string | null, note: string): { reason: ReportReason; note: string | null } | null {
  if (!reason || !(REPORT_REASONS as readonly string[]).includes(reason)) return null
  const cleaned = [...note.replace(/\r\n?/g, '\n').trim()].slice(0, REPORT_NOTE_MAX).join('')
  return { reason: reason as ReportReason, note: cleaned || null }
}
