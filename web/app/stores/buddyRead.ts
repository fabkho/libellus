import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { SendJob } from '#layers/chat/app/types/adapter'
import type { VoiceMime as VoiceMimeType } from '~/data/buddyVoice'
import { claimQueue, createSaveQueue, parseStoredQueue, type JobOutcome, type Refusal, type SaveQueue, type TabQueue, UNEXPLAINED_ATTEMPTS } from '#layers/chat/app/utils/queue'
import { readPoint, threadKey } from '#layers/chat/app/utils/thread'
import { chapterView, createPeeks, type ChapterView } from '#layers/chat/app/utils/veil'
import {
  createBuddyReads,
  isRetryableBuddyError,
  MESSAGES_PAGE,
  justAfter,
  type BuddyErrorCode,
  type BuddyMe,
  type BuddyMessage,
  type BuddyRead,
  type BuddyReads,
  type BuddyResult,
  type CreateBuddyRead,
  type MyBuddyReads,
  type ReportReason,
} from '~/data/buddyReads'
import type { BuddyLive, BuddyLiveEvent, LiveRealtimeModule } from '~/data/buddyLive'
import { prepareVoice, VOICE_QUEUE_MAX_AGE_MS, VOICE_URL_REUSE_MS, type PreparedVoice } from '~/data/buddyVoice'
import { useSessionStore } from '~/stores/session'
import { parseAppConfig } from '~/utils/appConfig'
import { buddyPeekKey, buddyQueueKey, deviceHasBuddyLine } from '~/utils/buddyStorage'
import {
  bumpCounts,
  buddySendKey,
  clearUnread,
  countsOf,
  mergeBubble,
  pendingBubble,
  reactedBy,
  sentBubble,
  tombstoneOf,
  voiceJob,
  voiceOfJob,
  type BuddyBubble,
} from '~/utils/buddyRead'

/**
 * Buddy reads, her side (data/buddyReads.ts, docs/plans/buddy-read-shared.md): the reads she is in, the thread of the room and of every
 * Section, what she wrote that is still on its way, her Section and the Sections she opened anyway. The one store for every buddy
 * read screen; it is only imported by those screens (tests/buddy-read-entry.test.ts keeps it, and data/buddyLive.ts, out of the entry).
 *
 * - **Threads** are keyed by the layer's `threadKey(read, section)` (the room is the read's id alone). A thread is read when a screen
 *   opens it (the newest 50, older ones on `loadOlder`) and then follows the live channel and `resync`.
 * - **Sending is optimistic and queued.** A message shows at once as a bubble the queue sends in order (the layer's `createSaveQueue`:
 *   kept in `localStorage` across a reload, one tab owns a member's line, a retry with a growing pause). The stored row replaces the
 *   bubble by its client id; a refusal is handed back on the bubble (`failed`, with the code), for the screen to word and lead her back.
 * - **The veil** is drawn here, not by the database: `view(read, section)` says whether a Section is open to her (her marker, the whole
 *   book once she is through, a peek) and what a row may show; a veiled Section's unread is not counted in `unread(read)`.
 * - **Live** (data/buddyLive.ts) is started only while a screen has `retain`ed it and loaded lazily (the real Realtime client is a chunk
 *   of its own: no Realtime request until a screen asks). Home does not retain it: it reads `loadMine` on focus.
 *
 * - **A voice message** is a send too, in two steps (what Trappist's chat does for a photo and a recording): the recording is stored in the private
 *   bucket first (`sendVoice`: a bubble at once, playable from the device's own copy; no connection or a refusal makes it a failed bubble she can send
 *   again or delete: a recording is held in memory, not in the line, so a reload loses one that was not stored), then its post joins the same queue as
 *   a text (retried with a pause, kept across a reload, a refusal handed back on the bubble). Nothing is signed or fetched for a recording until she
 *   presses play (`voiceUrl`: a URL of five minutes, kept for four).
 *
 * Writes wait for a connection (the repository refuses them offline, the controls say Offline); a send does not: it waits in the
 * queue. Signing out, or another member signing in, forgets everything and closes the channel.
 */

type Thread = { messages: BuddyBubble[]; loaded: boolean; more: boolean; loading: boolean; marked: string | null }

/** The send's outcome for the screen: the client id its bubble goes by. */
export type BuddySend = { ok: true; clientId: string } | { ok: false; error: BuddyErrorCode }

const newId = () => globalThis.crypto.randomUUID()
const deviceStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export const useBuddyReadStore = defineStore('buddyRead', () => {
  const backend = useBackend()
  const config = parseAppConfig(useRuntimeConfig().public)
  const session = useSessionStore()

  /** The reads she opened, by id. */
  const reads = ref<Record<string, BuddyRead>>({})
  /**
   * The reads she was in that the database no longer lets her see (removed, left on another device, blocked, deleted): an answer of `not_found` forgot them
   * (`forget`). A screen that has the read open cannot tell "not read yet" from "gone" by `reads` alone, and a live refresh answers inside the store, not to
   * the screen: this is how it says so. Cleared when the read is read again.
   */
  const forgotten = ref<Record<string, true>>({})
  /** Her reads and invitations (Home, the invitation row); null until asked. */
  const mine = ref<MyBuddyReads | null>(null)
  const threads = ref<Record<string, Thread>>({})
  /** Sends still in line (on their way or waiting for a connection). */
  const waiting = ref(0)
  /** The live channel's word: `idle` until a screen retains it. */
  const liveStatus = ref<string>('idle')
  /** Raised when a peek is added, so rows that read `peeked` follow. */
  const peekVersion = ref(0)
  /** The channel has not been live for a while (the Free plan's connection limit says nothing else): the screens say so, and the store reads on its own. */
  const liveStuck = ref(false)
  /**
   * Bumped by `reset` (sign-out, another member): an answer that was asked before it belongs to the member who is gone and is dropped.
   * Every call that awaits the network keeps the number it started under and checks it after the await.
   */
  let epoch = 0
  const stale = (since: number) => since !== epoch

  const me = computed(() => session.member?.id ?? null)
  const online = useOnline()

  // ------------------------------------------------------------------ the repository

  let repository: BuddyReads | null = null
  function repo(): BuddyReads | null {
    if (!backend) return null
    repository ??= createBuddyReads(backend, { online: isOnline, self: () => me.value })
    return repository
  }
  const unavailable = <T>(): BuddyResult<T> => ({ data: null, error: 'offline' })

  // ------------------------------------------------------------------ threads

  const keyOf = (readId: string, sectionId: string | null) => threadKey(readId, sectionId)
  function thread(readId: string, sectionId: string | null): Thread {
    const key = keyOf(readId, sectionId)
    return (threads.value[key] ??= { messages: [], loaded: false, more: false, loading: false, marked: null })
  }
  /** The messages of a thread, oldest first, what is on its way last. */
  const messagesOf = (readId: string, sectionId: string | null): BuddyBubble[] => threads.value[keyOf(readId, sectionId)]?.messages ?? []

  /** How many screens look at a thread: a message that comes into one of them is read at once. */
  const viewing: Record<string, number> = {}
  const isViewing = (readId: string, sectionId: string | null) => (viewing[keyOf(readId, sectionId)] ?? 0) > 0

  function nameOf(readId: string, memberId: string | null): string | null {
    return reads.value[readId]?.members.find((m) => m.id === memberId)?.name ?? null
  }

  /** Puts a page into a thread (the stored rows are the truth: they replace the same rows, what is still on its way stays). */
  function takePage(readId: string, sectionId: string | null, items: BuddyMessage[]) {
    const t = thread(readId, sectionId)
    for (const item of items) {
      mergeBubble(t.messages, sentBubble({ ...item, authorName: item.authorName ?? nameOf(readId, item.senderId) }))
    }
  }

  /** Opens a thread: its newest page when it has none yet. The screen that shows it calls `closeThread` when it goes. */
  async function openThread(readId: string, sectionId: string | null): Promise<BuddyErrorCode | null> {
    const key = keyOf(readId, sectionId)
    viewing[key] = (viewing[key] ?? 0) + 1
    const since = epoch
    await ensureQueue()
    if (stale(since)) return 'not_signed_in'
    const t = thread(readId, sectionId)
    if (t.loaded) {
      void markThread(readId, sectionId)
      return null
    }
    return loadNewest(readId, sectionId)
  }
  function closeThread(readId: string, sectionId: string | null) {
    const key = keyOf(readId, sectionId)
    viewing[key] = Math.max(0, (viewing[key] ?? 0) - 1)
  }

  async function loadNewest(readId: string, sectionId: string | null): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const since = epoch
    const t = thread(readId, sectionId)
    t.loading = true
    const answer = await r.messages(readId, sectionId, { limit: MESSAGES_PAGE })
    if (stale(since)) return 'not_signed_in'
    t.loading = false
    if (answer.error) {
      // She is not in the read (any more): the same answer as `load` gets.
      if (answer.error === 'not_found') forget(readId)
      return answer.error
    }
    takePage(readId, sectionId, answer.data.items)
    // Only the first load decides whether there is more to ask for: a reload of a thread that grew keeps the answer it had.
    if (!t.loaded) t.more = answer.data.more
    t.loaded = true
    if (isViewing(readId, sectionId)) void markThread(readId, sectionId)
    return null
  }

  /** The page before the oldest stored message. */
  async function loadOlder(readId: string, sectionId: string | null): Promise<BuddyErrorCode | null> {
    const r = repo()
    const t = thread(readId, sectionId)
    const oldest = t.messages.find((m) => m.state === 'sent')
    if (!r || !oldest || t.loading || !t.more) return null
    const since = epoch
    t.loading = true
    const answer = await r.messages(readId, sectionId, { before: oldest.createdAt, limit: MESSAGES_PAGE })
    if (stale(since)) return 'not_signed_in'
    t.loading = false
    if (answer.error) return answer.error
    takePage(readId, sectionId, answer.data.items)
    t.more = answer.data.more
    return null
  }

  /** Her cursor in a thread moves to the newest message that is somebody else's (nothing to tell: no call). */
  async function markThread(readId: string, sectionId: string | null) {
    const r = repo()
    const read = reads.value[readId]
    if (read) clearUnread(read, sectionId)
    const t = thread(readId, sectionId)
    const point = readPoint(
      t.messages.filter((m) => m.state === 'sent'),
      t.marked,
      me.value,
    )
    if (!r || !point) return
    t.marked = point
    const since = epoch
    const answer = await r.mark(readId, sectionId, point)
    // Not moved after all: the next look asks again.
    if (!stale(since) && answer.error) t.marked = null
  }

  // ------------------------------------------------------------------ the send queue

  let queue: SaveQueue<SendJob> | null = null
  let queueFor: string | null = null
  let queueTab: TabQueue | null = null
  let opening: Promise<void> | null = null
  let openingFor: string | null = null

  /** Sends one queued message; the stored row (or the one a retry made before) replaces the bubble. */
  async function runSend(job: SendJob): Promise<JobOutcome> {
    const r = repo()
    if (!r) return { ok: false, retry: true, error: 'offline' }
    // The line is the member's whose it was made for: a send under another session would be posted as somebody else.
    const since = epoch
    if (!me.value || me.value !== queueFor) return { ok: false, retry: true, error: 'offline' }
    const voice = voiceOfJob(job)
    // A recording that waited too long is not sent: its object may be swept already (`VOICE_QUEUE_MAX_AGE_MS`); she records it again.
    if (voice && Date.now() - Date.parse(job.createdAt) > VOICE_QUEUE_MAX_AGE_MS) return { ok: false, retry: false, error: 'message_voice_missing', field: null }
    const answer = voice
      ? await r.sendVoice({ readId: job.conversationId, sectionId: job.threadId, clientId: job.clientId, media: voice, replyTo: job.replyTo })
      : await r.post({ readId: job.conversationId, sectionId: job.threadId, clientId: job.clientId, body: job.body, replyTo: job.replyTo })
    // She was gone in the meantime: nothing of the answer is shown to the next member (the line itself is stopped).
    if (stale(since)) return { ok: false, retry: true, error: 'offline' }
    if (answer.error) {
      if (isRetryableBuddyError(answer.error)) return { ok: false, retry: true, error: answer.error, giveUpAfter: answer.error === 'offline' ? undefined : UNEXPLAINED_ATTEMPTS }
      return { ok: false, retry: false, error: answer.error, field: null }
    }
    arrived(sentBubble({ ...answer.data, authorName: answer.data.authorName ?? nameOf(job.conversationId, me.value) }), false)
    return { ok: true }
  }

  /** A stored row came in (a send's answer, or a live event): into its thread, and the read's numbers follow. */
  function arrived(bubble: BuddyBubble, live: boolean) {
    const sectionId = bubble.threadId
    const t = thread(bubble.conversationId, sectionId)
    const fresh = mergeBubble(t.messages, bubble, { live })
    const read = reads.value[bubble.conversationId]
    if (!fresh || !read) return
    const mineAlready = bubble.senderId === me.value
    const open = isViewing(bubble.conversationId, sectionId)
    bumpCounts(read, sectionId, { count: 1, unread: mineAlready || open ? 0 : 1 })
    if (open && !mineAlready) void markThread(bubble.conversationId, sectionId)
  }

  function refused(refusal: Refusal<SendJob>) {
    const job = refusal.payload
    const bubble = thread(job.conversationId, job.threadId).messages.find((m) => m.clientId === job.clientId && m.state !== 'sent')
    if (bubble) {
      bubble.state = 'failed'
      bubble.error = refusal.error as BuddyErrorCode
    }
  }

  /**
   * The line of the signed-in member, restored from the device, sending. One tab owns it (Web Locks); without them the single key does.
   * If she is gone by the time the tab's lock is claimed (sign-out, another member), the lock is let go and no line is made.
   */
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
      const prefix = buddyQueueKey(member)
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
      // A newer opening (another member, after a reset) is not this one's to clear.
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
      const list = thread(job.conversationId, job.threadId).messages
      if (list.some((m) => m.clientId === job.clientId)) return
      mergeBubble(list, { ...pendingBubble(job, member, nameOf(job.conversationId, member)), state, error: error as BuddyErrorCode | null })
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
   * Writes a message: a bubble at once, the queue sends it. The room is `sectionId` null. A text with nothing to read is not sent
   * (the database would refuse it as `message_body_invalid`, and she should not wait to hear it). The screen words the codes.
   */
  async function send(readId: string, sectionId: string | null, body: string, { replyTo = null }: { replyTo?: string | null } = {}): Promise<BuddySend> {
    const member = me.value
    if (!member) return { ok: false, error: 'not_signed_in' }
    if (!/[^\s\u00a0\u200b\p{Cc}]/u.test(body) || body.length > 2000) return { ok: false, error: 'message_body_invalid' }
    const since = epoch
    await ensureQueue()
    if (stale(since) || !queue) return { ok: false, error: 'not_signed_in' }
    const job: SendJob = { conversationId: readId, threadId: sectionId, clientId: newId(), kind: 'text', body, replyTo, spoiler: false, createdAt: new Date().toISOString() }
    mergeBubble(thread(readId, sectionId).messages, pendingBubble(job, member, nameOf(readId, member)))
    queue!.enqueue(buddySendKey(job.clientId), job)
    return { ok: true, clientId: job.clientId }
  }

  // ---- voice

  /** A recording that is not stored yet: its bytes (in memory only) and the send it will become. */
  type VoiceUpload = { blob: Blob; mime: VoiceMimeType; job: SendJob }
  const uploads = new Map<string, VoiceUpload>()
  /** The device's own copy of a recording she sent, by client id (a `blob:` URL): she plays it from here, nothing is signed for it. */
  const previews = ref<Record<string, string>>({})
  const previewOf = (clientId: string | null): string | null => (clientId ? (previews.value[clientId] ?? null) : null)
  /** The URL a recording was signed for, by object name: reused while it lives (`VOICE_URL_REUSE_MS`). */
  const signed = new Map<string, { url: string; at: number }>()

  function dropPreview(clientId: string) {
    const url = previews.value[clientId]
    if (url) URL.revokeObjectURL(url)
    delete previews.value[clientId]
  }

  /**
   * Sends a finished recording (the composer's `voice`): refused here when it is too short, too big or of a type the bucket does not take; otherwise a bubble
   * at once, stored in the bucket, then posted through the line. The same Section and answer as a text. The screen words the codes.
   */
  async function sendVoice(
    readId: string,
    sectionId: string | null,
    voice: PreparedVoice,
    { replyTo = null }: { replyTo?: string | null } = {},
  ): Promise<BuddySend> {
    const member = me.value
    if (!member) return { ok: false, error: 'not_signed_in' }
    const prepared = prepareVoice(voice)
    if (!prepared.ok) return { ok: false, error: prepared.reason === 'short' ? 'voice_short' : prepared.reason === 'large' ? 'voice_large' : 'voice_type' }
    const since = epoch
    await ensureQueue()
    if (stale(since) || !queue) return { ok: false, error: 'not_signed_in' }
    const clientId = newId()
    const job = voiceJob(
      { conversationId: readId, threadId: sectionId, clientId, replyTo, createdAt: new Date().toISOString() },
      { mime: prepared.mime, durationMs: prepared.durationMs, peaks: prepared.peaks },
    )
    previews.value[clientId] = URL.createObjectURL(voice.blob)
    uploads.set(clientId, { blob: voice.blob, mime: prepared.mime, job })
    mergeBubble(thread(readId, sectionId).messages, pendingBubble(job, member, nameOf(readId, member)))
    void uploadVoice(clientId)
    return { ok: true, clientId }
  }

  /** Stores the recording; once it is there its post joins the line. A refusal (offline included) makes the bubble a failed one, for a tap to send again. */
  async function uploadVoice(clientId: string) {
    const entry = uploads.get(clientId)
    const member = me.value
    const r = repo()
    if (!entry || !member) return
    const { job } = entry
    const bubble = () => thread(job.conversationId, job.threadId).messages.find((m) => m.clientId === clientId && m.state !== 'sent')
    if (!r) {
      const b = bubble()
      if (b) Object.assign(b, { state: 'failed', error: 'offline' })
      return
    }
    const since = epoch
    const answer = await r.uploadVoice(job.conversationId, member, clientId, entry.blob, entry.mime)
    if (stale(since) || uploads.get(clientId) !== entry) return
    const b = bubble()
    if (answer.error) {
      if (b) Object.assign(b, { state: 'failed', error: answer.error })
      return
    }
    uploads.delete(clientId)
    await ensureQueue()
    if (stale(since) || !queue) return
    queue.enqueue(buddySendKey(clientId), job)
  }

  /**
   * The short-lived URL of a recording, signed when she presses play (never when a thread loads): the one signed a moment ago again, else a new one.
   * An error when it is not hers to hear (she left, a block, the message was deleted) or there is no connection.
   */
  async function voiceUrl(path: string): Promise<BuddyResult<string>> {
    const hit = signed.get(path)
    if (hit && Date.now() - hit.at < VOICE_URL_REUSE_MS) return { data: hit.url, error: null }
    const r = repo()
    if (!r) return unavailable()
    const since = epoch
    const answer = await r.voiceUrl(path)
    if (stale(since)) return { data: null, error: 'not_signed_in' }
    if (answer.error) signed.delete(path)
    else signed.set(path, { url: answer.data, at: Date.now() })
    return answer
  }

  /** Sends a refused message again (the refusal is forgotten, the bubble is on its way). */
  async function retry(readId: string, sectionId: string | null, clientId: string) {
    // A recording that was not stored: stored again from the copy in memory, then posted.
    const pending = uploads.get(clientId)
    if (pending) {
      const bubble = messagesOf(readId, sectionId).find((m) => m.clientId === clientId && m.state === 'failed')
      if (bubble && isRetryableBuddyError(bubble.error ?? 'unknown')) {
        bubble.state = 'sending'
        bubble.error = null
        void uploadVoice(clientId)
      }
      return
    }
    await ensureQueue()
    const refusal = queue?.snapshot().refusals.find((r) => r.payload.clientId === clientId)
    const bubble = messagesOf(readId, sectionId).find((m) => m.clientId === clientId)
    if (!queue || !refusal || !bubble) return
    // Refused for a reason a second try cannot change (removed, blocked, archived, invalid): only discarding is left.
    if (!isRetryableBuddyError(refusal.error as BuddyErrorCode)) return
    bubble.state = 'sending'
    bubble.error = null
    queue.enqueue(refusal.key, refusal.payload)
  }

  /**
   * Gives up on a message that was refused or is still waiting: the bubble goes and so does the refusal the line kept (it is stored on the
   * device, so a reload does not bring it back).
   */
  function discard(readId: string, sectionId: string | null, clientId: string) {
    uploads.delete(clientId)
    dropPreview(clientId)
    queue?.remove(buddySendKey(clientId))
    queue?.dismissRefusal(buddySendKey(clientId))
    const list = thread(readId, sectionId).messages
    const at = list.findIndex((m) => m.clientId === clientId && m.state !== 'sent')
    if (at >= 0) list.splice(at, 1)
  }

  /** Back online, or the page is visible again: the line goes at once instead of waiting out its pause. */
  function kick() {
    queue?.kick()
  }

  // ------------------------------------------------------------------ reads

  /** Her reads and invitations, for Home and the invitation row: one query, asked on focus (no live channel). */
  async function loadMine(): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const since = epoch
    const answer = await r.mine()
    if (stale(since)) return 'not_signed_in'
    if (answer.error) return answer.error
    mine.value = answer.data
    return null
  }

  /** One read as its screen draws it; its counts replace what the store counted itself. */
  async function load(readId: string): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const since = epoch
    const answer = await r.read(readId)
    if (stale(since)) return 'not_signed_in'
    if (answer.error) {
      // She is not in it (any more): nothing of it is kept.
      if (answer.error === 'not_found') forget(readId)
      return answer.error
    }
    reads.value[readId] = answer.data
    delete forgotten.value[readId]
    return null
  }

  function forget(readId: string) {
    // What the line still holds for the room (a message waiting, a refusal she never answered) goes with it: it could only be refused again, and the
    // refusal is stored on the device.
    if (queue) {
      const snapshot = queue.snapshot()
      for (const waitingJob of snapshot.jobs) if (waitingJob.payload.conversationId === readId) queue.remove(waitingJob.key)
      for (const refusal of snapshot.refusals) if (refusal.payload.conversationId === readId) queue.dismissRefusal(refusal.key)
    }
    for (const [clientId, upload] of uploads) {
      if (upload.job.conversationId !== readId) continue
      uploads.delete(clientId)
      dropPreview(clientId)
    }
    delete reads.value[readId]
    forgotten.value[readId] = true
    for (const key of Object.keys(threads.value)) if (key === readId || key.startsWith(`${readId}#`)) delete threads.value[key]
    if (mine.value) mine.value = { ...mine.value, reads: mine.value.reads.filter((x) => x.id !== readId) }
  }

  /** A write that changes a read: on success the read (and her list) are read again. */
  async function act<T>(readId: string | null, call: (r: BuddyReads) => Promise<BuddyResult<T>>, after: 'read' | 'forget' | 'mine' | 'none' = 'read'): Promise<BuddyResult<T>> {
    const r = repo()
    if (!r) return unavailable()
    const since = epoch
    const answer = await call(r)
    if (stale(since) || answer.error || !readId) return answer
    if (after === 'forget') forget(readId)
    else if (after === 'read') await load(readId)
    if (after === 'forget' || after === 'mine') void loadMine()
    return answer
  }

  const create = (input: CreateBuddyRead) => act(null, (r) => r.create(input))
  const invite = (readId: string, members: string[]) => act(readId, (r) => r.invite(readId, members))
  const setLink = (readId: string, on: boolean, renew = false) => act(readId, (r) => r.link(readId, on, renew))
  const target = (token: string) => (repo() ? repo()!.target(token) : Promise.resolve(unavailable<null>()))
  const join = async (token: string) => {
    const answer = await act(null, (r) => r.join(token))
    if (!answer.error) void loadMine()
    return answer
  }
  const answerInvite = (readId: string, accept: boolean) => act(readId, (r) => r.answer(readId, accept), 'mine')
  const leave = (readId: string, deleteMessages = false) => act(readId, (r) => r.leave(readId, deleteMessages), 'forget')
  const remove = (readId: string, member: string) => act(readId, (r) => r.remove(readId, member))
  const finish = (readId: string) => act(readId, (r) => r.finish(readId))
  const archive = (readId: string) => act(readId, (r) => r.archive(readId))
  const setSections = (readId: string, ...args: Parameters<BuddyReads['setSections']> extends [string, ...infer Rest] ? Rest : never) =>
    act(readId, (r) => r.setSections(readId, ...args))

  /** Her own `me` of a read changed (hand, entry): the Section and the marker follow at once. */
  async function changeMe(readId: string, call: (r: BuddyReads) => Promise<BuddyResult<BuddyMe>>): Promise<BuddyResult<BuddyMe>> {
    const r = repo()
    if (!r) return unavailable()
    const since = epoch
    const answer = await call(r)
    if (!stale(since) && !answer.error) {
      const read = reads.value[readId]
      if (read) {
        read.me = answer.data
        read.readThrough = answer.data.readThrough
        const self = read.members.find((m) => m.id === me.value)
        if (self) self.where = answer.data.where
        read.marks = read.marks.filter((m) => m.memberId !== me.value).concat({ memberId: me.value!, readThrough: answer.data.readThrough })
      }
    }
    return answer
  }
  /** "Where are you?": the Sections she has read through, null for "automatic" (from her reading). */
  const setHand = (readId: string, through: number | null) => changeMe(readId, (r) => r.setHand(readId, through))
  /** Which of her Library entries the read follows (null: none). */
  const linkEntry = (readId: string, entry: string | null) => changeMe(readId, (r) => r.linkEntry(readId, entry))

  // ------------------------------------------------------------------ talking

  /** Her reaction: at once on the message, the database's answer settles it (a refusal puts the old one back). */
  async function react(readId: string, sectionId: string | null, messageId: string, emoji: string | null): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const bubble = messagesOf(readId, sectionId).find((m) => m.id === messageId)
    const before = bubble?.reactions
    if (bubble) bubble.reactions = reactedBy(bubble.reactions, emoji)
    const answer = await r.react(messageId, emoji)
    if (answer.error && bubble && before) bubble.reactions = before
    return answer.error
  }

  /** Her own message, or any of the room as the host: it stays as a tombstone (the live event does the rest for the others). */
  async function deleteMessage(readId: string, sectionId: string | null, messageId: string): Promise<BuddyErrorCode | null> {
    const r = repo()
    if (!r) return 'offline'
    const answer = await r.deleteMessage(messageId)
    if (!answer.error) tombstone(readId, sectionId, messageId)
    return answer.error
  }

  function tombstone(readId: string, sectionId: string | null, messageId: string) {
    const list = messagesOf(readId, sectionId)
    const at = list.findIndex((m) => m.id === messageId)
    if (at < 0) {
      // A thread this device has not read: it does not know whether the message was counted, so the read's numbers are read again.
      if (!threads.value[keyOf(readId, sectionId)]?.loaded && reads.value[readId]) void load(readId)
      return
    }
    if (list[at]!.deletedAt) return
    const read = reads.value[readId]
    if (read) bumpCounts(read, sectionId, { count: -1 })
    list[at] = tombstoneOf(list[at]!, new Date().toISOString())
  }

  const report = async (messageId: string, reason: ReportReason, note: string | null = null) => (repo() ? repo()!.report(messageId, reason, note) : unavailable())

  // ------------------------------------------------------------------ the veil

  /** The device's set of her peeks (the key carries her id, so another member's are never hers). */
  function peeksOf() {
    const storage = deviceStorage()
    if (!me.value) return null
    return createPeeks({ get: (k) => storage?.getItem(k) ?? null, set: (k, v) => storage?.setItem(k, v) }, buddyPeekKey(me.value))
  }
  /** What the device said of each Section, kept until a peek is added or another member is here (every row asks on every draw). */
  let peekMemo: { member: string; version: number; seen: Map<string, boolean> } | null = null
  const peeked = (sectionId: string): boolean => {
    const version = peekVersion.value
    const member = me.value
    if (!member) return false
    if (!peekMemo || peekMemo.member !== member || peekMemo.version !== version) peekMemo = { member, version, seen: new Map() }
    let seen = peekMemo.seen.get(sectionId)
    if (seen === undefined) peekMemo.seen.set(sectionId, (seen = peeksOf()?.has(sectionId) ?? false))
    return seen
  }
  /** She opened a Section anyway ("Show anyway"): remembered on this device, her marker does not move. */
  function peek(sectionId: string) {
    peeksOf()?.add(sectionId)
    peekMemo = null
    peekVersion.value++
  }

  /** What a Section may show her (the room, null, is always open). */
  function view(readId: string, sectionId: string | null): (ChapterView & { peeked: boolean }) | null {
    const read = reads.value[readId]
    if (!read) return null
    if (sectionId === null) return { open: true, veiled: false, showTitle: true, showUnread: true, peeked: false }
    const chapter = read.chapters.find((c) => c.id === sectionId)
    if (!chapter) return null
    const last = read.chapters.filter((c) => c.kind === 'chapter').length
    const was = peeked(sectionId)
    return { ...chapterView(chapter, read.readThrough, last, was), peeked: was }
  }

  /** New comments over the threads she may see (the room, the open Sections): a veiled Section's news is a spoiler and is not counted. */
  function unread(readId: string): number {
    const read = reads.value[readId]
    if (!read) return 0
    return read.chapters.reduce((sum, c) => sum + (view(readId, c.id)?.showUnread ? c.unread : 0), read.room.unread)
  }

  // ------------------------------------------------------------------ live

  let live: BuddyLive | null = null
  let liveOpening: Promise<BuddyLive | null> | null = null
  const stops: Array<() => void> = []

  /**
   * The lazy door: the module and the real client load when a screen first retains the channel, not before. A failed import (a start
   * while offline: the Realtime chunk is not precached) is not kept: the next try imports again.
   */
  function liveOf(): Promise<BuddyLive | null> {
    if (live) return Promise.resolve(live)
    if (!backend || !config.ok || typeof window === 'undefined') return Promise.resolve(null)
    const app = config.config
    const since = epoch
    liveOpening ??= import('~/data/buddyLive')
      .then(({ browserLiveEnv, createBuddyLive }) => {
        // She was gone while the module came: nothing is made for the next member from her door.
        if (stale(since)) return null
        const made = createBuddyLive({
          url: app.supabaseUrl,
          anonKey: app.supabaseAnonKey,
          token: async () => (await backend.auth.getSession()).data.session?.access_token ?? null,
          load: () => import('#realtime-client') as unknown as Promise<LiveRealtimeModule>,
          env: browserLiveEnv(window),
          onChange: (state) => {
            liveStatus.value = state.status
            if (state.status === 'live') {
              liveStuck.value = false
              if (state.online) kick()
            }
          },
          onStuck: (stuck) => {
            liveStuck.value = stuck
          },
        })
        stops.push(
          made.on('message', (e) => arrived(sentBubble(withName(e.message)), true)),
          made.on('deleted', (e) => tombstone(e.readId, e.sectionId, e.messageId)),
          made.on('reaction', (e) => void reacted(e)),
          made.on('changed', (e) => void changedRead(e.readId)),
          made.on('invitation', () => void loadMine()),
          made.on('resync', () => void resync()),
        )
        live = made
        return made
      })
      .catch((error) => {
        liveOpening = null
        throw error
      })
    return liveOpening
  }

  const withName = (m: BuddyMessage): BuddyMessage => ({ ...m, authorName: m.authorName ?? nameOf(m.conversationId, m.senderId) })

  /** A reaction of somebody's: the aggregates carry no member, so the message is read again (one message, not the thread). */
  async function reacted(e: Extract<BuddyLiveEvent, { type: 'reaction' }>) {
    const r = repo()
    if (!r) return
    for (const key of Object.keys(threads.value)) {
      const bubble = threads.value[key]!.messages.find((m) => m.id === e.messageId)
      if (!bubble || bubble.conversationId !== e.readId) continue
      // Her own, already shown by her tap.
      if (e.memberId === me.value && (bubble.reactions.find((x) => x.mine)?.emoji ?? null) === e.emoji) return
      const since = epoch
      const answer = await r.messages(e.readId, bubble.threadId, { before: justAfter(bubble.createdAt), limit: 5 })
      if (stale(since)) return
      const fresh = answer.data?.items.find((m) => m.id === e.messageId)
      if (fresh) bubble.reactions = fresh.reactions
      return
    }
  }

  /** A member, a role, a Section or the status changed: the read is read again (only when a screen has it). */
  async function changedRead(readId: string) {
    if (reads.value[readId]) await load(readId)
  }

  /** The reads a screen has right now: retained by one (`retain(readId)`) or with a thread somebody looks at. */
  function readsInUse(): Set<string> {
    const used = new Set<string>()
    for (const hold of holds) if (hold.read) used.add(hold.read)
    for (const [key, count] of Object.entries(viewing)) if (count > 0) used.add(key.split('#')[0]!)
    // A read the database refused her (`forgotten`) is not asked for again by the channel: each resync would be one more 404 for a screen that already says
    // "not available". The screen asks itself when she comes back to it (`load` clears it).
    for (const id of used) if (forgotten.value[id]) used.delete(id)
    return used
  }

  /** At most one `resync` in this many ms: a rejoin and a return to the foreground come together, and a flapping channel rejoins often. */
  const RESYNC_GAP_MS = 10_000
  let resyncAt = 0
  let resyncTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * The channel was down or may have missed something: what a screen has open (its read, its open threads) and her list are read again, at
   * most once in `RESYNC_GAP_MS` (a call inside the gap runs once when it is over). A read nobody has open is not read: it is dropped and read
   * afresh when a screen opens it.
   */
  function resync(): Promise<void> | void {
    const wait = RESYNC_GAP_MS - (Date.now() - resyncAt)
    if (wait > 0) {
      resyncTimer ??= setTimeout(() => {
        resyncTimer = null
        void resync()
      }, wait)
      return
    }
    resyncAt = Date.now()
    return readAgain()
  }

  async function readAgain() {
    const since = epoch
    const used = readsInUse()
    for (const id of Object.keys(reads.value)) if (!used.has(id)) delete reads.value[id]
    await Promise.all([...used].map((id) => load(id)))
    if (stale(since)) return
    for (const [key, t] of Object.entries(threads.value)) {
      if (!t.loaded) continue
      const [readId, sectionId] = key.includes('#') ? (key.split('#') as [string, string]) : [key, null]
      if (!reads.value[readId]) {
        t.loaded = false
        continue
      }
      if ((viewing[key] ?? 0) > 0) await loadNewest(readId, sectionId)
      // A thread nobody looks at is read afresh when it is opened again, not kept stale.
      else t.loaded = false
      if (stale(since)) return
    }
    if (mine.value) await loadMine()
    if (!stale(since)) kick()
  }

  /** What a screen holds of the live channel: `release` is the door's, null while the channel could not be taken (the chunk was not there, offline). */
  type Hold = { release: (() => void) | null; released: boolean; read: string | null }
  const holds: Hold[] = []
  let pollTimer: ReturnType<typeof setInterval> | null = null
  /** While the channel is stuck a screen is open: the channel is asked for again, and what was missed is read, this often. */
  const POLL_MS = 25_000

  async function attach(hold: Hold) {
    const member = me.value
    if (!member || hold.release || hold.released) return
    const since = epoch
    try {
      const door = await liveOf()
      if (!door || stale(since) || hold.released) return
      hold.release = door.retain(member)
    } catch {
      // The Realtime chunk could not be fetched (an offline start): live updates are paused, and the poll asks for it again.
      if (!stale(since)) liveStuck.value = true
    }
  }

  function updatePoll() {
    const want = liveStuck.value && holds.length > 0
    if (want && !pollTimer) pollTimer = setInterval(() => void pollLive(), POLL_MS)
    else if (!want && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
  async function pollLive() {
    await Promise.all(holds.map(attach))
    if (online.value) void resync()
  }
  watch(liveStuck, updatePoll)

  /**
   * A buddy read screen (or the invitation row) needs the live channel; `readId` is the read it shows, so a `resync` reads that one. Returns
   * the function that lets it go: call it when the screen closes. It never throws: a channel that cannot be had (no chunk offline, the Free
   * plan's connection limit) is `liveStuck`, the screen says so and the store reads on its own until it is live. Nothing starts without a
   * signed-in member, and nothing loads before this is called. It also starts the line of unsent messages, if she has one.
   */
  async function retain(readId?: string): Promise<() => void> {
    if (!me.value) return () => {}
    const hold: Hold = { release: null, released: false, read: readId ?? null }
    holds.push(hold)
    void ensureQueue()
    await attach(hold)
    updatePoll()
    return () => {
      if (hold.released) return
      hold.released = true
      hold.release?.()
      const at = holds.indexOf(hold)
      if (at >= 0) holds.splice(at, 1)
      if (holds.length === 0) liveStuck.value = false
      updatePoll()
    }
  }

  // ------------------------------------------------------------------ sign-out

  /** Forgets everything of the member and closes what is open (sign-out, another member). */
  async function reset() {
    // Everything asked before this is the member's who is gone: its answers are dropped (`stale`).
    epoch++
    closeQueue()
    opening = null
    openingFor = null
    reads.value = {}
    forgotten.value = {}
    mine.value = null
    threads.value = {}
    waiting.value = 0
    uploads.clear()
    for (const clientId of Object.keys(previews.value)) dropPreview(clientId)
    signed.clear()
    peekMemo = null
    for (const key of Object.keys(viewing)) delete viewing[key]
    for (const hold of holds.splice(0)) hold.released = true
    liveStuck.value = false
    updatePoll()
    if (resyncTimer) clearTimeout(resyncTimer)
    resyncTimer = null
    resyncAt = 0
    for (const stop of stops.splice(0)) stop()
    const door = live
    live = null
    liveOpening = null
    liveStatus.value = 'idle'
    await door?.dispose()
  }

  /** What the device kept in line (a reload, a killed app) is sent without a screen having to open a thread. */
  function startLine(member: string) {
    const storage = deviceStorage()
    if (storage && deviceHasBuddyLine(storage, member)) void ensureQueue()
  }
  watch(
    me,
    (now, before) => {
      if (before && now !== before) void reset()
      if (now) startLine(now)
    },
    { immediate: true },
  )
  // The connection is back: the line goes at once instead of waiting out its pause.
  watch(online, (now) => {
    if (now) kick()
  })

  return {
    reads,
    forgotten,
    mine,
    threads,
    waiting,
    liveStatus,
    liveStuck,
    peekVersion,
    // threads
    messagesOf,
    openThread,
    closeThread,
    loadOlder,
    markThread,
    send,
    sendVoice,
    previewOf,
    voiceUrl,
    retry,
    discard,
    kick,
    react,
    deleteMessage,
    report,
    // reads
    loadMine,
    load,
    create,
    invite,
    setLink,
    target,
    join,
    answerInvite,
    leave,
    remove,
    finish,
    archive,
    setSections,
    setHand,
    linkEntry,
    // the veil
    peeked,
    peek,
    view,
    unread,
    // live
    retain,
    reset,
    countsOf: (readId: string, sectionId: string | null) => (reads.value[readId] ? countsOf(reads.value[readId]!, sectionId) : null),
  }
})
