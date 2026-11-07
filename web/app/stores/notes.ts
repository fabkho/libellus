import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { SendJob } from '#layers/chat/app/types/adapter'
import { claimQueue, createSaveQueue, parseStoredQueue, type JobOutcome, type Refusal, type SaveQueue, type TabQueue, UNEXPLAINED_ATTEMPTS } from '#layers/chat/app/utils/queue'
import { readPoint, threadKey } from '#layers/chat/app/utils/thread'
import { createPeeks } from '#layers/chat/app/utils/veil'
import {
  createNotes,
  isRetryableNoteError,
  NOTES_PAGE,
  type NoteErrorCode,
  type NoteMe,
  type NoteMessage,
  type NoteResult,
  type NotesPage,
  type NotesRoom,
  type NoteVisibility,
  type Notes,
} from '~/data/notes'
import type { ReportReason } from '~/data/buddyReads'
import { useSessionStore } from '~/stores/session'
import { notesPeekKey, notesQueueKey } from '~/utils/notesStorage'
import { mergeNote, noteJob, noteSendKey, pendingNote, reactedNote, sentNote, tombstoneNote, type NoteBubble } from '~/utils/notes'
import { rememberedLevel, rememberLevel } from '~/utils/noteVisibility'

/**
 * Notes on a Book, her side (data/notes.ts, docs/plans/book-notes.md): the Notes page of a Book she opened, the thread of every chapter, what she wrote that is
 * still on its way, her chapter and the chapters she opened anyway. The one store for the Notes screens; it is only imported by those (tests/notes-entry.test.ts keeps
 * it out of the entry), and it **never loads the Realtime client**: notes are read when a screen opens, when the app comes back to the front and on a Refresh.
 *
 * - **The Notes page** is one call (`book_notes`): the chapters with counts, faces and her own chapter. A thread is read when a screen opens it (the newest 50, older
 *   ones on `loadOlder`).
 * - **The veil is the app's**: the server says which chapters are open to her (`open`), the device remembers the ones she opened anyway (`peek`); a chapter that is
 *   neither is **never asked for**: `openThread` refuses it before any call, so nothing of what was said in it reaches the device.
 * - **Sending is optimistic and queued** (the layer's `createSaveQueue`, as a buddy read's): a note shows at once as a bubble the queue sends in order, kept in
 *   `localStorage` across a reload; the stored row replaces the bubble by its client id; a refusal is handed back on the bubble for the screen to word.
 */

type Thread = { messages: NoteBubble[]; loaded: boolean; more: boolean; loading: boolean; marked: string | null }
type PageState = { page: NotesPage | null; error: NoteErrorCode | null; loading: boolean }

/** The send's outcome for the screen: the client id its bubble goes by. */
export type NoteSend = { ok: true; clientId: string } | { ok: false; error: NoteErrorCode }

const newId = () => globalThis.crypto.randomUUID()
const deviceStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export const useNotesStore = defineStore('notes', () => {
  const backend = useBackend()
  const session = useSessionStore()
  const online = useOnline()

  /** The Notes page of every Book she opened, by Book id. */
  const pages = ref<Record<string, PageState>>({})
  const threads = ref<Record<string, Thread>>({})
  /** Sends still in line (on their way or waiting for a connection). */
  const waiting = ref(0)
  /** Whether Everyone is on (`notes_config`); false until asked: the control never offers what the owner has not allowed. */
  const publicEnabled = ref(false)
  const configLoaded = ref(false)
  /** Raised when a peek is added, so rows that read `peeked` follow. */
  const peekVersion = ref(0)
  /** The level the device remembers (Only me or Friends). */
  const remembered = ref(rememberedLevel(deviceStorage()))

  /** Bumped by `reset` (sign-out, another member): an answer asked before it belongs to the member who is gone and is dropped. */
  let epoch = 0
  const stale = (since: number) => since !== epoch
  const me = computed(() => session.member?.id ?? null)

  // ------------------------------------------------------------------ the repository

  let repository: Notes | null = null
  function repo(): Notes | null {
    if (!backend) return null
    repository ??= createNotes(backend, { online: isOnline })
    return repository
  }
  const unavailable = <T>(): NoteResult<T> => ({ data: null, error: 'offline' })

  // ------------------------------------------------------------------ the switch

  /** `notes_config()`: asked once a session, and again when the app comes back to the front (`force`). */
  async function loadConfig({ force = false }: { force?: boolean } = {}): Promise<void> {
    if (configLoaded.value && !force) return
    const r = repo()
    if (!r) return
    const since = epoch
    const answer = await r.config()
    if (stale(since) || answer.error) return
    publicEnabled.value = answer.data.publicEnabled
    configLoaded.value = true
  }

  /** The level the device remembers for the next note; Everyone is never kept. */
  function remember(level: NoteVisibility) {
    if (level === 'public') return
    remembered.value = level
    rememberLevel(deviceStorage(), level)
  }

  // ------------------------------------------------------------------ the page

  const pageOf = (bookId: string): NotesPage | null => pages.value[bookId]?.page ?? null
  const roomOf = (bookId: string): NotesRoom | null => pageOf(bookId)?.room ?? null
  /** The page that holds this room, if she opened one. */
  function roomById(roomId: string): { bookId: string; room: NotesRoom } | null {
    for (const [bookId, state] of Object.entries(pages.value)) if (state.page?.room?.id === roomId) return { bookId, room: state.page.room }
    return null
  }

  /** The state of a Book's page, as the reactive proxy holds it (what `??=` hands back is the plain object, whose changes nothing would see). */
  function pageState(bookId: string): PageState {
    if (!pages.value[bookId]) pages.value[bookId] = { page: null, error: null, loading: false }
    return pages.value[bookId]!
  }

  /** The Notes page of a Book, in one call. */
  async function loadPage(bookId: string): Promise<NoteErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const since = epoch
    const state = pageState(bookId)
    state.loading = true
    const answer = await r.page(bookId)
    if (stale(since)) return 'not_signed_in'
    state.loading = false
    if (answer.error) {
      state.error = answer.error
      return answer.error
    }
    state.error = null
    state.page = answer.data
    return null
  }

  /**
   * Makes the Book's chapters. Somebody else was first (`chapters_already_set`): her page simply shows the list they made, her count is not used.
   * Resolves the refusal, or null when a list is there.
   */
  async function setChapters(bookId: string, count: number): Promise<NoteErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const since = epoch
    const answer = await r.setChapters(bookId, count)
    if (stale(since)) return 'not_signed_in'
    if (answer.error === 'chapters_already_set') return loadPage(bookId)
    if (answer.error) return answer.error
    const state = pageState(bookId)
    state.page = answer.data
    state.error = null
    return null
  }

  /** Adds chapters at the end; the page is read again (the ids of the ones there are kept). */
  async function addChapters(bookId: string, count: number): Promise<NoteErrorCode | null> {
    const room = roomOf(bookId)
    const r = repo()
    if (!r || !room) return 'offline'
    const since = epoch
    const answer = await r.addChapters(room.id, count)
    if (stale(since)) return 'not_signed_in'
    if (answer.error) return answer.error
    return loadPage(bookId)
  }

  /** Her own chapter: by hand (a number, or finished) or null for Automatic. The page's rows follow (what is open changes with it). */
  async function setChapter(bookId: string, chapter: number | null, finished = false): Promise<NoteResult<NoteMe>> {
    const room = roomOf(bookId)
    const r = repo()
    if (!r || !room) return unavailable()
    const since = epoch
    const answer = await r.setChapter(room.id, chapter, finished)
    if (stale(since) || answer.error) return answer
    // Which chapters are open, and the counts of new ones, depend on it: the page is read again.
    await loadPage(bookId)
    return answer
  }

  // ------------------------------------------------------------------ the veil

  let peekMemo: { key: string; peeks: ReturnType<typeof createPeeks> } | null = null
  /** The device's set of her peeks in a room (the key carries her id and the room's, so another member's are never hers). */
  function peeksOf(roomId: string) {
    if (!me.value) return null
    const key = notesPeekKey(me.value, roomId)
    if (peekMemo?.key === key) return peekMemo.peeks
    const storage = deviceStorage()
    peekMemo = { key, peeks: createPeeks({ get: (k) => storage?.getItem(k) ?? null, set: (k, v) => storage?.setItem(k, v) }, key) }
    return peekMemo.peeks
  }

  /** Whether she opened this chapter anyway on this device. */
  function peeked(roomId: string, sectionId: string): boolean {
    void peekVersion.value
    return peeksOf(roomId)?.has(sectionId) ?? false
  }
  /** The chapters of a room she opened anyway. */
  function peekedSet(roomId: string): ReadonlySet<string> {
    void peekVersion.value
    const room = roomById(roomId)?.room
    const peeks = peeksOf(roomId)
    return new Set(room && peeks ? room.chapters.filter((c) => peeks.has(c.id)).map((c) => c.id) : [])
  }
  /** "Show anyway": the chapter is open from now on, on this device. Her own chapter does not move. */
  function peek(roomId: string, sectionId: string) {
    peeksOf(roomId)?.add(sectionId)
    peekVersion.value++
  }

  /** What a chapter may show her: open by the server's word (`open`) or by her peek; null when the room or the chapter is not known. */
  function view(roomId: string, sectionId: string): { open: boolean; veiled: boolean; peeked: boolean } | null {
    const chapter = roomById(roomId)?.room.chapters.find((c) => c.id === sectionId)
    if (!chapter) return null
    const was = peeked(roomId, sectionId)
    const open = chapter.open || was
    return { open, veiled: !open, peeked: was }
  }

  // ------------------------------------------------------------------ threads

  const keyOf = (roomId: string, sectionId: string) => threadKey(roomId, sectionId)
  function thread(roomId: string, sectionId: string): Thread {
    const key = keyOf(roomId, sectionId)
    // Through the reactive proxy, not the plain object `??=` hands back: its changes would be invisible to the screens.
    if (!threads.value[key]) threads.value[key] = { messages: [], loaded: false, more: false, loading: false, marked: null }
    return threads.value[key]!
  }
  /** The notes of a chapter, oldest first, what is on its way last. A chapter that is not open has none, whatever the store holds. */
  const messagesOf = (roomId: string, sectionId: string): NoteBubble[] => (view(roomId, sectionId)?.open ? (threads.value[keyOf(roomId, sectionId)]?.messages ?? []) : [])

  /** How many screens look at a thread: a note that comes into one of them is read at once. */
  const viewing: Record<string, number> = {}
  const isViewing = (roomId: string, sectionId: string) => (viewing[keyOf(roomId, sectionId)] ?? 0) > 0

  function takePage(roomId: string, sectionId: string, items: NoteMessage[]) {
    const t = thread(roomId, sectionId)
    for (const item of items) mergeNote(t.messages, sentNote(item))
  }

  /**
   * Opens a thread: its newest page when it has none yet. **A chapter that is not open to her is not asked for** (`not_found` answers without a call): the
   * veil is the app's, and nothing of a closed chapter is read before "Show anyway". The screen that shows it calls `closeThread` when it goes.
   */
  async function openThread(roomId: string, sectionId: string): Promise<NoteErrorCode | null> {
    if (!view(roomId, sectionId)?.open) return 'not_found'
    const key = keyOf(roomId, sectionId)
    viewing[key] = (viewing[key] ?? 0) + 1
    const since = epoch
    await ensureQueue()
    if (stale(since)) return 'not_signed_in'
    const t = thread(roomId, sectionId)
    if (t.loaded) {
      void markThread(roomId, sectionId)
      return null
    }
    return loadNewest(roomId, sectionId)
  }
  function closeThread(roomId: string, sectionId: string) {
    const key = keyOf(roomId, sectionId)
    viewing[key] = Math.max(0, (viewing[key] ?? 0) - 1)
  }

  async function loadNewest(roomId: string, sectionId: string): Promise<NoteErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    if (!view(roomId, sectionId)?.open) return 'not_found'
    const since = epoch
    const t = thread(roomId, sectionId)
    t.loading = true
    const answer = await r.messages(roomId, sectionId, { limit: NOTES_PAGE })
    if (stale(since)) return 'not_signed_in'
    t.loading = false
    if (answer.error) return answer.error
    // What the database no longer shows her (narrowed, blocked, removed) goes: the stored rows newer than the page's oldest are the page's.
    const oldest = answer.data.items[0]?.createdAt
    const kept = new Set(answer.data.items.map((i) => i.id))
    // A page that came back short holds everything she may see: what it lacks is gone for her. A full one holds the newest 50: older rows she paged back to stay.
    if (t.loaded) t.messages = t.messages.filter((m) => m.state !== 'sent' || kept.has(m.id) || (answer.data.more && oldest !== undefined && m.createdAt < oldest))
    takePage(roomId, sectionId, answer.data.items)
    if (!t.loaded) t.more = answer.data.more
    t.loaded = true
    if (isViewing(roomId, sectionId)) void markThread(roomId, sectionId)
    return null
  }

  /** Read again, for a Refresh or the app coming back to the front: the page's numbers and the thread's newest notes. */
  async function refresh(bookId: string, sectionId: string | null = null): Promise<NoteErrorCode | null> {
    void loadConfig({ force: true })
    const failed = await loadPage(bookId)
    const room = roomOf(bookId)
    if (failed || !room || !sectionId) return failed
    return view(room.id, sectionId)?.open ? loadNewest(room.id, sectionId) : null
  }

  /** The page before the oldest stored note. */
  async function loadOlder(roomId: string, sectionId: string): Promise<NoteErrorCode | null> {
    const r = repo()
    const t = thread(roomId, sectionId)
    const oldest = t.messages.find((m) => m.state === 'sent')
    if (!r || !oldest || t.loading || !t.more || !view(roomId, sectionId)?.open) return null
    const since = epoch
    t.loading = true
    const answer = await r.messages(roomId, sectionId, { before: oldest.createdAt, limit: NOTES_PAGE })
    if (stale(since)) return 'not_signed_in'
    t.loading = false
    if (answer.error) return answer.error
    takePage(roomId, sectionId, answer.data.items)
    t.more = answer.data.more
    return null
  }

  /** Her cursor in a thread moves to the newest note that is somebody else's (nothing to tell: no call). */
  async function markThread(roomId: string, sectionId: string) {
    const r = repo()
    const t = thread(roomId, sectionId)
    const found = roomById(roomId)
    const chapter = found?.room.chapters.find((c) => c.id === sectionId)
    if (chapter) chapter.unread = 0
    const point = readPoint(
      t.messages.filter((m) => m.state === 'sent'),
      t.marked,
      me.value,
    )
    if (!r || !point) return
    t.marked = point
    const since = epoch
    const answer = await r.markRead(roomId, sectionId, point)
    // Not moved after all: the next look asks again.
    if (!stale(since) && answer.error) t.marked = null
  }

  // ------------------------------------------------------------------ the send queue

  let queue: SaveQueue<SendJob> | null = null
  let queueFor: string | null = null
  let queueTab: TabQueue | null = null
  let opening: Promise<void> | null = null
  let openingFor: string | null = null

  const nameOf = (): string | null => session.member?.name ?? null

  /** Sends one queued note; the stored row (or the one a retry made before) replaces the bubble. */
  async function runSend(job: SendJob): Promise<JobOutcome> {
    const r = repo()
    if (!r) return { ok: false, retry: true, error: 'offline' }
    const since = epoch
    // The line is the member's whose it was made for: a send under another session would be posted as somebody else.
    if (!me.value || me.value !== queueFor) return { ok: false, retry: true, error: 'offline' }
    const answer = await r.post({
      roomId: job.conversationId,
      sectionId: job.threadId!,
      clientId: job.clientId,
      body: job.body,
      visibility: (job.payload as { visibility?: NoteVisibility } | null)?.visibility ?? 'friends',
      replyTo: job.replyTo,
      spoiler: job.spoiler,
    })
    // She was gone in the meantime: nothing of the answer is shown to the next member (the line itself is stopped).
    if (stale(since)) return { ok: false, retry: true, error: 'offline' }
    if (answer.error) {
      if (isRetryableNoteError(answer.error)) return { ok: false, retry: true, error: answer.error, giveUpAfter: answer.error === 'offline' ? undefined : UNEXPLAINED_ATTEMPTS }
      return { ok: false, retry: false, error: answer.error, field: null }
    }
    arrived(sentNote(answer.data))
    return { ok: true }
  }

  /** A stored note came in (a send's answer): into its thread, and the chapter's count follows. */
  function arrived(bubble: NoteBubble) {
    const sectionId = bubble.threadId!
    const t = thread(bubble.conversationId, sectionId)
    const fresh = mergeNote(t.messages, bubble)
    const chapter = roomById(bubble.conversationId)?.room.chapters.find((c) => c.id === sectionId)
    if (fresh && chapter) chapter.count += 1
  }

  function refused(refusal: Refusal<SendJob>) {
    const job = refusal.payload
    const bubble = thread(job.conversationId, job.threadId!).messages.find((m) => m.clientId === job.clientId && m.state !== 'sent')
    if (bubble) {
      bubble.state = 'failed'
      bubble.error = refusal.error as NoteErrorCode
    }
  }

  /** The line of the signed-in member, restored from the device, sending. One tab owns it (Web Locks); without them the single key does. */
  function ensureQueue(): Promise<void> {
    const member = me.value
    if (!member) return Promise.resolve()
    if (queue && queueFor === member) return Promise.resolve()
    if (opening && openingFor === member) return opening
    const since = epoch
    const gone = () => stale(since) || me.value !== member
    const made: Promise<void> = (async () => {
      closeQueue()
      const storage = deviceStorage()
      const prefix = notesQueueKey(member)
      const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined
      let storageKey = prefix
      let tab: TabQueue | null = null
      if (storage && locks) {
        try {
          tab = await claimQueue({ storage, locks, tabStorage: typeof sessionStorage === 'undefined' ? null : sessionStorage, prefix })
          storageKey = tab.key
        } catch {
          tab = null
        }
      }
      if (gone()) {
        tab?.release()
        return
      }
      queueTab = tab
      const q = createSaveQueue<SendJob>({
        storage,
        storageKey,
        run: runSend,
        onChange: (snapshot) => {
          if (queue === q) waiting.value = snapshot.jobs.length
        },
        onRefused: refused,
      })
      queue = q
      queueFor = member
      showRestored(q, member)
      // What a closed tab left in line is ours now.
      if (queueTab) {
        await queueTab.adoptOrphans((raw) => {
          const orphan = parseStoredQueue<SendJob>(raw)
          q.adopt(orphan.jobs, orphan.refusals)
        })
        if (gone() || queue !== q) return
      }
      showRestored(q, member)
      q.start()
    })().finally(() => {
      if (opening === made) opening = null
    })
    opening = made
    openingFor = member
    return made
  }

  /** What the device kept in line shows as bubbles again (their threads are read when a screen opens them). */
  function showRestored(q: SaveQueue<SendJob>, member: string) {
    const snapshot = q.snapshot()
    waiting.value = snapshot.jobs.length
    const put = (job: SendJob, state: 'sending' | 'failed', error: string | null) => {
      const list = thread(job.conversationId, job.threadId!).messages
      if (list.some((m) => m.clientId === job.clientId)) return
      mergeNote(list, { ...pendingNote(job, member, nameOf()), state, error: error as NoteErrorCode | null })
    }
    for (const job of snapshot.jobs) put(job.payload, 'sending', null)
    for (const refusal of snapshot.refusals) put(refusal.payload, 'failed', refusal.error)
  }

  function closeQueue() {
    queue?.stop()
    queueTab?.release()
    queue = null
    queueTab = null
    queueFor = null
  }

  /**
   * Writes a note: a bubble at once, the queue sends it. A text with nothing to read is not sent (the database would refuse it as `body_empty`, and she should
   * not wait to hear it). Everyone is refused here while the owner's switch is off. The screen words the codes.
   */
  async function send(
    roomId: string,
    sectionId: string,
    body: string,
    visibility: NoteVisibility,
    { replyTo = null, spoiler = false, quote = null }: { replyTo?: string | null; spoiler?: boolean; quote?: NoteBubble['quote'] } = {},
  ): Promise<NoteSend> {
    const member = me.value
    if (!member) return { ok: false, error: 'not_signed_in' }
    if (!/[^\s\u00a0\u200b\p{Cc}]/u.test(body)) return { ok: false, error: 'body_empty' }
    if (body.length > 2000) return { ok: false, error: 'body_too_long' }
    if (visibility === 'public' && !publicEnabled.value) return { ok: false, error: 'notes_public_off' }
    const since = epoch
    await ensureQueue()
    if (stale(since) || !queue) return { ok: false, error: 'not_signed_in' }
    const job = noteJob({ roomId, sectionId, clientId: newId(), body, replyTo, spoiler, createdAt: new Date().toISOString() }, visibility)
    mergeNote(thread(roomId, sectionId).messages, pendingNote(job, member, nameOf(), quote))
    queue!.enqueue(noteSendKey(job.clientId), job)
    return { ok: true, clientId: job.clientId }
  }

  /** Sends a refused note again (the refusal is forgotten, the bubble is on its way). */
  async function retry(roomId: string, sectionId: string, clientId: string) {
    await ensureQueue()
    const refusal = queue?.snapshot().refusals.find((r) => r.payload.clientId === clientId)
    const bubble = messagesOf(roomId, sectionId).find((m) => m.clientId === clientId)
    if (!queue || !refusal || !bubble) return
    // Refused for a reason a second try cannot change (removed, blocked, too wide): only discarding is left.
    if (!isRetryableNoteError(refusal.error as NoteErrorCode)) return
    bubble.state = 'sending'
    bubble.error = null
    queue.enqueue(refusal.key, refusal.payload)
  }

  /** A note that was refused (or still waits) is given up: the bubble goes, and the refusal the device kept with it. */
  function discard(roomId: string, sectionId: string, clientId: string) {
    queue?.remove(noteSendKey(clientId))
    queue?.dismissRefusal(noteSendKey(clientId))
    const list = thread(roomId, sectionId).messages
    const at = list.findIndex((m) => m.clientId === clientId && m.state !== 'sent')
    if (at >= 0) list.splice(at, 1)
  }

  /** Back online, or the page is visible again: the line goes at once instead of waiting out its pause. */
  function kick() {
    queue?.kick()
  }

  // ------------------------------------------------------------------ talking

  /** Her reaction: at once on the note, the database's answer settles it (a refusal puts the old one back). */
  async function react(roomId: string, sectionId: string, noteId: string, emoji: string | null): Promise<NoteErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const bubble = messagesOf(roomId, sectionId).find((m) => m.id === noteId)
    const before = bubble?.reactions
    if (bubble) bubble.reactions = reactedNote(bubble.reactions, emoji)
    const answer = await r.react(noteId, emoji)
    if (answer.error && bubble && before) bubble.reactions = before
    return answer.error
  }

  /** Her own note: it stays as a tombstone, "Note removed". */
  async function deleteNote(roomId: string, sectionId: string, noteId: string): Promise<NoteErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const answer = await r.deleteNote(noteId)
    if (answer.error) return answer.error
    const list = thread(roomId, sectionId).messages
    const at = list.findIndex((m) => m.id === noteId)
    if (at >= 0 && !list[at]!.deletedAt) {
      list[at] = tombstoneNote(list[at]!, new Date().toISOString())
      const chapter = roomById(roomId)?.room.chapters.find((c) => c.id === sectionId)
      if (chapter) chapter.count = Math.max(0, chapter.count - 1)
    }
    return null
  }

  /** Her own note at another level. Narrowing is at once; the replies it narrows are hers or another's to lose, so the thread is read again. */
  async function setVisibility(roomId: string, sectionId: string, noteId: string, visibility: NoteVisibility): Promise<NoteErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const answer = await r.setVisibility(noteId, visibility)
    if (answer.error) return answer.error
    const bubble = thread(roomId, sectionId).messages.find((m) => m.id === noteId)
    if (bubble) {
      bubble.visibility = visibility
      bubble.effectiveVisibility = visibility === 'public' && !publicEnabled.value ? 'friends' : visibility
    }
    await loadNewest(roomId, sectionId)
    const found = roomById(roomId)
    if (found) void loadPage(found.bookId)
    return null
  }

  async function report(noteId: string, reason: ReportReason, text: string | null = null): Promise<NoteErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    return (await r.report(noteId, reason, text)).error
  }

  // ------------------------------------------------------------------ sign-out

  /** Forgets everything of the member and closes what is open (sign-out, another member). */
  function reset() {
    epoch++
    closeQueue()
    opening = null
    openingFor = null
    pages.value = {}
    threads.value = {}
    waiting.value = 0
    publicEnabled.value = false
    configLoaded.value = false
    peekMemo = null
    remembered.value = rememberedLevel(deviceStorage())
    for (const key of Object.keys(viewing)) delete viewing[key]
  }

  watch(
    me,
    (now, before) => {
      if (before && now !== before) reset()
    },
    { immediate: true },
  )
  // The connection is back: the line goes at once instead of waiting out its pause.
  watch(online, (now) => {
    if (now) kick()
  })

  return {
    pages,
    threads,
    waiting,
    publicEnabled,
    configLoaded,
    peekVersion,
    remembered,
    loadConfig,
    remember,
    // the page
    pageOf,
    roomOf,
    roomById,
    loadPage,
    setChapters,
    addChapters,
    setChapter,
    refresh,
    // the veil
    peeked,
    peekedSet,
    peek,
    view,
    // threads
    messagesOf,
    openThread,
    closeThread,
    loadOlder,
    markThread,
    send,
    retry,
    discard,
    kick,
    react,
    deleteNote,
    setVisibility,
    report,
    reset,
  }
})
