import { threadKey } from '#layers/chat/app/utils/thread'
import type { ThreadError, ThreadPaging, ThreadScreenAdapter } from '~/composables/useThreadScreen'
import type { NoteBubble, NoteItem } from '~/utils/notes'
import { noteItems, quoteSourceOf } from '~/utils/notes'
import type { NoteLevel } from '~/utils/noteVisibility'
import type { NoteErrorCode, NoteQuote } from '~/data/notes'
import type { ReportReason } from '~/data/buddyReads'
import type { PreparedVoice } from '~/data/buddyVoice'

/**
 * A Book's chapter of Notes as the shared thread screen sees it (`composables/useThreadScreen.ts`): one factory, one page
 * (pages/notes/[book]/[chapter].vue), and the page's own addressing — the Notes room and the chapter — closed over here and nowhere
 * else. Everything the screen calls is a call of the notes store; what the page keeps is its audience (`level`), the microphone's
 * gate (`voiceAllowed`) and the quote of the note she answers, all handed in.
 *
 * It touches no Nuxt runtime and reads no word of its own, so `tests/thread-screen-adapters.test.ts` drives it over a fake store.
 */

/** The slice of the notes store this adapter calls (the store's threads, as the page reads them). */
export type NotesThreadStore = {
  messagesOf: (roomId: string, sectionId: string) => readonly NoteBubble[]
  threads: Record<string, { more: boolean; loading: boolean; loaded: boolean } | undefined>
  loadOlder: (roomId: string, sectionId: string) => Promise<NoteErrorCode | null>
  previewOf: (clientId: string | null) => string | null
  send: (roomId: string, sectionId: string, body: string, visibility: NoteLevel, extra: { replyTo: string | null; quote: NoteQuote | null }) => Promise<{ ok: boolean; error?: NoteErrorCode }>
  sendVoice: (roomId: string, sectionId: string, voice: PreparedVoice, extra: { replyTo: string | null; quote: NoteQuote | null }) => Promise<{ ok: boolean; error?: NoteErrorCode }>
  retry: (roomId: string, sectionId: string, clientId: string) => Promise<void>
  discard: (roomId: string, sectionId: string, clientId: string) => void
  react: (roomId: string, sectionId: string, noteId: string, emoji: string) => Promise<NoteErrorCode | null>
  deleteNote: (roomId: string, sectionId: string, noteId: string) => Promise<NoteErrorCode | null>
  report: (noteId: string, reason: ReportReason, note: string | null) => Promise<NoteErrorCode | null>
  voiceUrl: (path: string) => Promise<{ data: string; error: null } | { data: null; error: NoteErrorCode }>
}

export type NotesThreadDeps = {
  store: NotesThreadStore
  /** The Book whose Notes these are. */
  bookId: () => string
  /** The Notes room and the chapter, once the page has loaded them. */
  roomId: () => string
  chapterId: () => string
  /** The read is loaded: the thread hangs on it. */
  hasRoom: () => boolean
  me: () => string | null
  isOpen: () => boolean
  errorWord: (code: ThreadError) => string
  retryable: (code: ThreadError) => boolean
  /** The audience of the note she is writing: the page's own state, never the screen's. */
  level: () => NoteLevel
  /** The microphone's gate (`noteVoiceAllowed`): Only me, and no answer to anybody else's note. */
  voiceAllowed: () => boolean
}

export function notesThreadAdapter(deps: NotesThreadDeps): ThreadScreenAdapter<NoteBubble, NoteItem> {
  const { store } = deps
  const errorWord = (code: ThreadError) => deps.errorWord(code)

  const paging = (): ThreadPaging => {
    const thread = store.threads[threadKey(deps.roomId(), deps.chapterId())]
    return { more: thread?.more === true, loading: thread?.loading === true, loaded: thread?.loaded === true, room: deps.hasRoom() }
  }

  /** An answer carries the server's quote when she answers a stored note: the chat layer has no call to look one up later. */
  const quoteOfAnswer = (quote: unknown): NoteQuote | null => (quote as NoteQuote | null) ?? null

  return {
    me: deps.me,
    isOpen: deps.isOpen,
    paging,
    nameOf: () => null,
    previewOf: (clientId) => store.previewOf(clientId),
    errorWord,
    retryable: deps.retryable,
    quoteSourceOf: (item, me) => quoteSourceOf(item, me),
    bubblesOf: () => store.messagesOf(deps.roomId(), deps.chapterId()),
    itemsOf: (bubbles, ctx) => noteItems(bubbles, ctx),
      loadOlder: () => store.loadOlder(deps.roomId(), deps.chapterId()).then(() => {}),
    send: (body, extra) => store.send(deps.roomId(), deps.chapterId(), body, deps.level(), { replyTo: extra.replyToId, quote: quoteOfAnswer(extra.quote) }),
    /**
     * Only me is the one audience of a recording: the microphone is not offered anywhere else, and one that arrives anyway (the option
     * changed under a recording) is not posted. The database refuses it too (`voice_private_only`); she hears it before the call.
     */
    sendVoice: (voice, extra) =>
      deps.voiceAllowed()
        ? store.sendVoice(deps.roomId(), deps.chapterId(), voice, { replyTo: extra.replyToId, quote: quoteOfAnswer(extra.quote) })
        : Promise.resolve({ ok: false, error: 'voice_private_only' as const }),
    retry: (key) => store.retry(deps.roomId(), deps.chapterId(), key),
    discard: (key) => store.discard(deps.roomId(), deps.chapterId(), key),
    react: (id, emoji) => store.react(deps.roomId(), deps.chapterId(), id, emoji),
    deleteMessage: (id) => store.deleteNote(deps.roomId(), deps.chapterId(), id),
    report: (id, reason, note) => store.report(id, reason, note),
    voiceUrl: (path) => store.voiceUrl(path),
  }
}
