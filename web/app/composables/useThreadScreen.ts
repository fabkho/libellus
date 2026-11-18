import type { BarAction } from '#layers/ui/app/components/ui/ReactionBar.vue'
import type { PreparedVoice } from '~/data/buddyVoice'
import type { ReportReason } from '~/data/buddyReads'
import type { VoicePressPlayer } from '~/composables/useVoicePress'
import type { QuoteSource, QuoteWords, ThreadItem } from '~/utils/roomThread'

/**
 * The thread screen two pages share: a buddy read's Section (pages/together/[id]/[section].vue) and a Book's chapter of Notes
 * (pages/notes/[book]/[chapter].vue). Both draw the base's `UiChatThread` over a store's messages and carry the same state machine —
 * open and load, earlier pages on scrolling up, send and retry and discard, react, answer, the action bar, the veil, the press on a
 * voice message — and differ only in what their store and their words are.
 *
 * This is that shared half. It never asks which page it is on: everything a page decides differently arrives in its **adapter** (the
 * store's calls, addressed by the page's own room and section) or in its **opts** (the words, the emoji, what the page allows, the
 * buttons only its bar has). What stays in a page is what only one of them has: the audience of a note and the level flow, the
 * microphone's gate, the edit flow, an archived read's read-only composer, the banners, the title and the address.
 *
 * A note's audience is never seen here: the notes page closes over its level inside its own `send`/`sendVoice`.
 */

/** A refusal, as a code: a note's (`NoteErrorCode`) or a buddy read's (`BuddyErrorCode`). The page words it (`adapter.errorWord`). */
export type ThreadError = string

/** What a send answered: the store's `{ ok, error }`, with the code kept and not worded. */
export type SendResult = { ok: boolean; error?: ThreadError }

/** What a thread says of its pages: the store's own (`more`, `loading`, `loaded`), and whether the page the thread hangs on is loaded. */
export type ThreadPaging = {
  /** There is a page before the oldest message. */
  more: boolean
  /** A page is on its way. */
  loading: boolean
  /** The thread's newest page is in: its items may be drawn. */
  loaded: boolean
  /** The read, or the Book's Notes page, is loaded. */
  room: boolean
}

/** What `itemsOf` needs of the screen: who she is, whether the thread is open to her, the words, and the device's own copies. */
export type ThreadItemsContext = {
  me: string | null
  /** The veil's answer (`utils/roomThread.ts` `RoomThreadContext.open`). */
  open: boolean
  nameOf: (memberId: string | null) => string | null
  previewOf: (clientId: string | null) => string | null
  errorWord: (code: ThreadError) => string
  retryable: (code: ThreadError) => boolean
}

/**
 * One page's store, as the thread screen calls it. Every call closes over the page's own addressing (`threadKey(read, section)`,
 * `store.messagesOf(room, chapter)`): the room and the Section are the page's, never the screen's.
 */
export type ThreadScreenAdapter<Bubble, Item extends ThreadItem> = {
  /** The signed-in member's id, or null. */
  me: () => string | null
  /** The thread is open to her (the veil's answer; a buddy read's room always is). */
  isOpen: () => boolean
  /** How far the store has read this thread. */
  paging: () => ThreadPaging
  /** A member's name among the thread's readers, or null. */
  nameOf: (memberId: string | null) => string | null
  /** The device's own copy of a recording she sent in this session, by client id. */
  previewOf: (clientId: string | null) => string | null
  /** The sentence a refusal is worded with (`notes.error.<code>`, `buddyRead.error.<code>`). */
  errorWord: (code: ThreadError) => string
  /** Whether a second try can change a refusal (`isRetryableNoteError`, `isRetryableBuddyError`). */
  retryable: (code: ThreadError) => boolean
  /** Where a message's quote comes from (`utils/notes.ts`'s `quoteSourceOf` for a note, the reply for a buddy read). */
  quoteSourceOf: (item: Item, me: string | null) => QuoteSource | null
  /** The store's bubbles of this thread, oldest first. */
  bubblesOf: () => readonly Bubble[]
  /** Those bubbles as the screen draws them (`roomItems`, `noteItems`), with the veil applied there. */
  itemsOf: (bubbles: readonly Bubble[], ctx: ThreadItemsContext) => Item[]
  /** The page (a Book's Notes) or the read: what the thread hangs on. */
  loadInitial: () => Promise<ThreadError | null>
  openThread: () => Promise<ThreadError | null>
  closeThread: () => void
  /** Asked again when the app comes back to the front (a Book's Notes: no Realtime). A buddy read's channel keeps itself in line. */
  refresh?: () => Promise<ThreadError | null>
  loadOlder: () => Promise<void>
  /** She opened a veiled Chapter or Section anyway ("Show anyway"), on this device: her marker does not move. */
  peek: () => void
  /** The live channel, kept while the screen shows (a buddy read only). Resolves the way to let it go. */
  retain?: () => Promise<() => void>
  /** Where Back goes when the history has none (the page's own list). */
  backTo: () => string
  send: (body: string, extra: { replyToId: string | null; quote: unknown }) => Promise<SendResult>
  sendVoice: (voice: PreparedVoice, extra: { replyToId: string | null; quote: unknown }) => Promise<SendResult>
  retry: (key: string) => Promise<void>
  discard: (key: string) => void
  react: (id: string, emoji: string) => Promise<ThreadError | null>
  deleteMessage: (id: string) => Promise<ThreadError | null>
  report: (id: string, reason: ReportReason, note: string | null) => Promise<ThreadError | null>
  voiceUrl: (path: string) => Promise<{ data: string; error: null } | { data: null; error: string }>
}

/** What a page says and allows; the screen never decides any of it. */
export type ThreadScreenOpts<Item extends ThreadItem> = {
  /** The thread's reactions, in the bar's order. */
  emojis: readonly string[]
  /** The first of them: what a double tap on a message puts on it. */
  likeEmoji: string
  /** A message of this thread may be liked at all (an archived buddy read may not; a note always may). */
  canLike: () => boolean
  /** The thread takes writing (an archived buddy read does not: its composer is a line, and no bar offers anything). */
  canWrite: () => boolean
  quoteWords: () => QuoteWords
  /** The base's two words of the bar ("Report", "Delete"), before the page's own. */
  barWords: () => { report: string; delete: string }
  /** What only this page's bar offers, after the base's Report and Delete. */
  extraActions: (item: Item) => BarAction[]
  /** One of `extraActions` was pressed: the page opens its own sheet. */
  onAction?: (id: string, item: Item) => void
  /** What a note sends with an answer (the server's own quote shape); a buddy read sends the id alone. */
  sendQuote?: (item: Item) => unknown
  /** "You are offline", in the app's words for this screen. */
  offlineWord: () => string
  /** "That recording will not play", in the app's words for this screen. */
  failedWord: () => string
  /** The screen's test id prefix (`notesThread`, `buddyThread`): the composer's field is `<prefix>.composer`. */
  composerTestid: string
  /** The base's one audio element (`useVoicePlayer`). */
  voicePlayer: VoicePressPlayer
}
