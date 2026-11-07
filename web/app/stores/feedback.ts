import { defineStore } from 'pinia'
import {
  createFeedback,
  feedbackProblem,
  FEEDBACK_PAGE,
  type Feedback,
  type FeedbackContext,
  type FeedbackItem,
  type ContactKind,
  type FeedbackOwnerError,
  type FeedbackSendError,
} from '~/data/feedback'
import { isShelfOwner } from '~/utils/shelfOwner'
import { useSessionStore } from '~/stores/session'

/**
 * Contact (data/feedback.ts, supabase/migrations/20261024010000_feedback.sql), both sides.
 *
 * Hers: the Profile's Contact sheet. The draft (a kind, the text) lives here, so a message that could not be
 * sent is still in the sheet when she tries again, and when she closes the sheet and opens it again; it is
 * emptied once a message went through, and when another member signs in. `send` takes the context the
 * device attached (composables/useFeedbackContext.ts) and answers whether it went through; the reason it
 * did not is `sendError`. Nothing of what she sent is read back.
 *
 * The owner's: the Profile's Feedback row and page read the inbox, newest first, a page at a time, and mark
 * a message handled. The owner is the member the build names (`NUXT_PUBLIC_SHELF_OWNER_ID`, as for the
 * Waitlist and Errors), the database checks again and refuses anyone else (`not_owner`), so for a member
 * who is not the owner `isOwner` is false, nothing is asked and nothing is shown. A load that fails keeps
 * the messages already on screen; signing out (or another member signing in) forgets them all.
 */
export const useFeedbackStore = defineStore('feedback', () => {
  const session = useSessionStore()
  const backend = useBackend()
  const config = useRuntimeConfig().public

  const isOwner = computed(() => isShelfOwner(session.member?.id, config.shelfOwnerId))

  let repository: Feedback | null = null
  function repo(): Feedback | null {
    if (!backend) return null
    repository ??= createFeedback(backend, { online: isOnline })
    return repository
  }

  // ------------------------------------------------------------------ her side

  const kind = ref<ContactKind>('bug')
  const text = ref('')
  const sending = ref(false)
  const sendError = ref<FeedbackSendError | null>(null)
  /** A message went through and the sheet still shows its thanks. */
  const sent = ref(false)

  /** Why the text cannot be sent yet, or null. */
  const problem = computed(() => feedbackProblem(text.value))
  const canSend = computed(() => !sending.value && problem.value === null)

  /** The sheet opens: a draft that was kept stays, a message that went through starts a new one. */
  function begin() {
    if (sent.value) {
      text.value = ''
      kind.value = 'bug'
      sent.value = false
    }
    sendError.value = null
  }

  async function send(context: FeedbackContext): Promise<boolean> {
    const r = repo()
    if (!r || sending.value || problem.value !== null) return false
    const member = session.member?.id
    sending.value = true
    sendError.value = null
    const result = await r.send(kind.value, text.value, context)
    sending.value = false
    if (member !== session.member?.id) return false
    if (result.error) {
      sendError.value = result.error
      return false
    }
    sent.value = true
    return true
  }

  // ------------------------------------------------------------- the owner's side

  /** Newest first; null until the first load has answered. */
  const items = ref<FeedbackItem[] | null>(null)
  const loadError = ref<FeedbackOwnerError | null>(null)
  const loading = ref(false)
  const more = ref(false)
  const loadingMore = ref(false)
  const writeError = ref<FeedbackOwnerError | null>(null)
  /** How many of the messages loaded wait for the owner: the Profile row's value. */
  const openCount = computed(() => (items.value ? items.value.filter((item) => !item.handledAt).length : null))

  let pending: Promise<void> | null = null

  function load(): Promise<void> {
    if (!isOwner.value) return Promise.resolve()
    pending ??= (async () => {
      const r = repo()
      if (!r) return
      const member = session.member?.id
      loading.value = true
      const result = await r.list({ limit: FEEDBACK_PAGE })
      loading.value = false
      if (member !== session.member?.id) return
      if (result.error) {
        loadError.value = result.error
        return
      }
      loadError.value = null
      items.value = result.data
      more.value = result.data.length === FEEDBACK_PAGE
    })().finally(() => (pending = null))
    return pending
  }

  /** The next page, older than the last message on screen. */
  async function loadMore(): Promise<void> {
    const r = repo()
    const last = items.value?.at(-1)
    if (!isOwner.value || !r || !last || loadingMore.value || !more.value) return
    const member = session.member?.id
    loadingMore.value = true
    const result = await r.list({ limit: FEEDBACK_PAGE, before: last.cursor })
    loadingMore.value = false
    if (member !== session.member?.id) return
    if (result.error) {
      loadError.value = result.error
      return
    }
    loadError.value = null
    const known = new Set((items.value ?? []).map((item) => item.id))
    items.value = [...(items.value ?? []), ...result.data.filter((item) => !known.has(item.id))]
    more.value = result.data.length === FEEDBACK_PAGE
  }

  /** Marks a message handled (or open again); shown on the list once the database says so. */
  async function markHandled(id: string, handled: boolean): Promise<boolean> {
    const r = repo()
    if (!isOwner.value || !r || !items.value) return false
    const member = session.member?.id
    writeError.value = null
    const result = await r.markHandled(id, handled)
    if (member !== session.member?.id) return false
    if (result.error) {
      writeError.value = result.error
      return false
    }
    const now = new Date()
    items.value = (items.value ?? []).map((item) => (item.id === id ? { ...item, handledAt: handled ? (item.handledAt ?? now) : null } : item))
    return true
  }

  /** The notes the owner removed from this inbox this session: their report no longer offers the button. */
  const removedNotes = ref<Set<string>>(new Set())
  const removeError = ref<string | null>(null)

  /**
   * A report of a note (`context.note`): the owner removes the note (`owner_remove_note`: "Removed by the moderator" for everyone, its words kept in the database's moderation
   * log for 12 months) with a reason, and the report is handled with it. The notes repository is loaded here, the first time, not with the page. Resolves whether it was removed;
   * `removeError` holds the refusal's code otherwise.
   */
  async function removeNote(feedbackId: string, noteId: string, reason: string): Promise<boolean> {
    if (!isOwner.value || !backend) return false
    const member = session.member?.id
    removeError.value = null
    const { createNotes } = await import('~/data/notes')
    const result = await createNotes(backend, { online: isOnline }).ownerRemove(noteId, reason)
    if (member !== session.member?.id) return false
    if (result.error) {
      removeError.value = result.error
      return false
    }
    removedNotes.value = new Set([...removedNotes.value, noteId])
    await markHandled(feedbackId, true)
    return true
  }

  function reset() {
    removedNotes.value = new Set()
    removeError.value = null
    kind.value = 'bug'
    text.value = ''
    sent.value = false
    sendError.value = null
    items.value = null
    more.value = false
    loadError.value = null
    writeError.value = null
  }

  watch(
    () => session.member?.id,
    (next, before) => next !== before && reset(),
  )

  return {
    isOwner,
    kind,
    text,
    sending,
    sendError,
    sent,
    problem,
    canSend,
    begin,
    send,
    items,
    loadError,
    loading,
    more,
    loadingMore,
    writeError,
    openCount,
    load,
    loadMore,
    markHandled,
    removedNotes,
    removeError,
    removeNote,
    reset,
  }
})
