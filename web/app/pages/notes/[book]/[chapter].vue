<script setup lang="ts">
// A chapter of a Book's Notes (docs/plans/book-notes.md parts 2.3, 2.5, 5; docs/parity.md, *Notes, a chapter*, *Notes, visibility*): the buddy read's thread screen, built from the same
// base components (`UiChatThread`, `UiBubble`, `UiComposer`, one reaction bar a bubble), filled with the notes of one chapter that she may see (stores/notes.ts): optimistic sends that wait
// in the queue, day separators, runs by author, earlier pages on scrolling up, a quote and a swipe to answer. What a note adds to a buddy read's message is its **audience**:
// - **marks**: a globe and "Everyone" in the bubble's sender line of a public note (others' and hers), a lock and "Only me" under her private one, nothing for Friends. While the owner's switch for
//   Everyone is off a public note counts as a friends' note: no globe, and her own says "Everyone · paused" in its action bar.
// - **the three-way control** beside the *Spoiler* chip: Only me · Friends · Everyone (components/notes/LevelPicker.vue; two segments without the switch). A new note starts at the level the device
//   remembers (Only me or Friends); Everyone is for one note, the control returns to the remembered level after it is sent, and the one quiet line "Visible to all members of BetterReads, with your
//   name and photo. Just this note." stands under it while it is on Everyone. A reply starts at the narrower of its parent's level and the remembered one and cannot be wider than the note it answers.
// - **the action bar**: the six reactions, Reply, Copy; on her note **Who can see this** and **Delete**; on another's **Report** (the sheet of the buddy read, to the owner) and **Block {name}**.
// - **quotes**: the server's word: the author and first words, "A note you can't see" for a note she may not read, "Note removed" for a tombstone, "Voice message" for a voice note.
// - **voice notes** (docs/parity.md, *Notes, a chapter*): the microphone is offered **only at Only me** (`voiceMaxMs`, gated by the audience: at Friends or Everyone it is gone, and the audience row is not
//   there while the microphone is live, so it cannot be changed under a recording; a recording that reaches `sendVoice` at another audience is never posted, it is dropped with a word). A recording is a
//   private note of its own, stored in the private bucket first and posted after (the same line, the same offline behaviour as a buddy read's voice message, stores/notes.ts); it is drawn by the base's
//   `UiVoiceBubble` with the lock and "Only me" like her other private notes. **Nothing is signed or fetched when the thread loads**: the play button's press is taken here first (`voicePress`, capture
//   phase) and asks the store for a URL of five minutes the first time; one voice at a time (the base's player); leaving the thread silences it. Nobody else can see a voice note, so this is only ever hers.
// **The veil** (the app's, as in a buddy read): a chapter that is not open to her (her chapter has not reached it and she has not opened it anyway) is not read at all: this page shows the quiet
// "hidden" screen with "Show anyway", and only her yes (a peek, kept on this device; her chapter does not move) asks the database for it. A note marked Spoiler is veiled until tapped.
// Read when it opens, when the app comes back to the front and on Refresh: no Realtime (tests/notes-entry.test.ts).
import type { BarAction } from '#layers/ui/app/components/ui/ReactionBar.vue'
import { threadKey } from '#layers/chat/app/utils/thread'
import { mayLoadMedia } from '#layers/chat/app/utils/veil'
import { isRetryableNoteError, NOTE_EMOJI, type NoteErrorCode, type NoteQuote } from '~/data/notes'
import type { ReportReason } from '~/data/buddyReads'
import { isBookId, isChapterSegment } from '~/utils/notesRoute'
import { chapterOfSegment, noteErrorKey, noteItems, noteQuoteOf, replyChipOf, notesPath, type NoteItem } from '~/utils/notes'
import { sameAuthorRun, VOICE_UNSIGNED } from '~/utils/roomThread'
import { VOICE_MAX_MS, type PreparedVoice } from '~/data/buddyVoice'
import { clampToOffer, settleLevel, startLevel, type NoteLevel } from '~/utils/noteVisibility'
import { useBookStore } from '~/stores/book'
import { useNotesStore } from '~/stores/notes'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'

definePageMeta({
  layout: 'tabs',
  screen: 'notes',
  pushed: true,
  // The tab bar steps away while the chat fills the screen (components/shell/TabBar.vue).
  immersive: true,
  // One page per thread: going from one chapter to another starts its own state (what she tapped, what she was writing).
  key: (route) => route.fullPath,
  validate: (route) => isBookId(route.params.book) && isChapterSegment(route.params.chapter),
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useNotesStore()
const books = useBookStore()
const session = useSessionStore()
const social = useSocialStore()
const online = useOnline()

const bookId = computed(() => String(route.params.book))
const me = computed(() => session.member?.id ?? null)
const book = computed(() => books.page(bookId.value)?.book ?? null)
const room = computed(() => store.roomOf(bookId.value))
const chapter = computed(() => chapterOfSegment(room.value, route.params.chapter))
/** The veil's answer for this thread; null while the page is not loaded or the chapter is not part of it. */
const view = computed(() => (room.value && chapter.value ? store.view(room.value.id, chapter.value.id) : null))
const publicEnabled = computed(() => store.publicEnabled)

// ------------------------------------------------------------------ loading

const error = ref<NoteErrorCode | null>(null)
let opened = false

async function load() {
  error.value = await store.loadPage(bookId.value)
}
async function openThread() {
  if (opened || !room.value || !chapter.value) return
  opened = true
  const failed = await store.openThread(room.value.id, chapter.value.id)
  if (failed) {
    opened = false
    if (room.value && chapter.value) store.closeThread(room.value.id, chapter.value.id)
    error.value = failed
  }
}
async function refresh() {
  if (!chapter.value) return
  error.value = await store.refresh(bookId.value, chapter.value.id)
}
function onVisible() {
  if (document.visibilityState === 'visible' && online.value && opened) void refresh()
}

onMounted(async () => {
  void books.load(bookId.value)
  void store.loadConfig()
  document.addEventListener('visibilitychange', onVisible)
  if (!room.value) await load()
})
// Nothing of a chapter is read until it is open to her: the server says so (`open`), or she said "Show anyway".
watch(() => view.value?.open === true, (open) => open && void openThread(), { immediate: true })
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  if (opened && room.value && chapter.value) store.closeThread(room.value.id, chapter.value.id)
})
// Back online after a failure: asked again.
watch(online, (now) => {
  if (!now) return
  if (!room.value) void load()
  else if (error.value && view.value?.open) {
    error.value = null
    opened = false
    void openThread()
  }
})

const thread = computed(() => (room.value && chapter.value ? (store.threads[threadKey(room.value.id, chapter.value.id)] ?? null) : null))
const missing = computed(() => (!room.value && (error.value === 'not_found' || error.value === 'notes_unavailable')) || (!!room.value && !chapter.value))
const status = computed(() => {
  if (error.value && !thread.value?.loaded) return 'error'
  if (!room.value) return 'loading'
  return thread.value?.loaded ? 'ready' : 'loading'
})
useFocusHeading(() => missing.value || status.value === 'ready' || view.value?.veiled === true)

// ------------------------------------------------------------------ the notes

const revealed = ref<ReadonlySet<string>>(new Set())
const items = computed<NoteItem[]>(() =>
  room.value && chapter.value
    ? noteItems(store.messagesOf(room.value.id, chapter.value.id), {
        me: me.value,
        open: view.value?.open === true,
        revealed: revealed.value,
        nameOf: () => null,
        previewOf: store.previewOf,
        errorWord: (code) => t(noteErrorKey(code)),
        retryable: isRetryableNoteError,
      })
    : [],
)
const byKey = computed(() => new Map(items.value.map((i) => [i.key, i])))
const noteOf = (item: { key: string }): NoteItem => byKey.value.get(item.key)!

/** The notes that came after the thread was shown: they play the arrival animation once. */
const fresh = ref<ReadonlySet<string>>(new Set())
const known = new Set<string>()
let settled = false
watch(
  () => [status.value, items.value.map((i) => i.key)] as const,
  ([now, keys]) => {
    if (now !== 'ready') return
    const added = keys.filter((k) => !known.has(k))
    for (const k of keys) known.add(k)
    if (settled && added.length) fresh.value = new Set([...fresh.value, ...added])
    settled = true
  },
  { immediate: true },
)

const hasMore = computed(() => thread.value?.more === true)
const olderStatus = computed(() => (thread.value?.loading && thread.value.loaded ? 'loading' : 'idle'))
async function loadOlder(): Promise<boolean> {
  if (!room.value || !chapter.value) return false
  const before = items.value.length
  await store.loadOlder(room.value.id, chapter.value.id)
  return items.value.length > before
}

const quoteWords = computed(() => ({
  deleted: t('uiText.chat.reply.deleted'),
  spoiler: t('uiText.chat.veiled.label'),
  someone: t('member.someone'),
  you: t('uiText.chat.reply.you'),
  hidden: t('notes.thread.hiddenQuote'),
  voice: t('notes.thread.voiceQuote'),
}))
const quoteFor = (item: NoteItem) => noteQuoteOf(item, items.value, me.value, quoteWords.value)

// ------------------------------------------------------------------ title

const isEnd = computed(() => chapter.value?.kind === 'end')
const title = computed(() => (!chapter.value ? '' : isEnd.value ? t('notes.wholeBook') : t('notes.chapter', { n: chapter.value.position })))
useHead({ title: () => `${title.value || t('notes.title')} · ${t('app.name')}` })

// ------------------------------------------------------------------ writing

const text = ref('')
const spoiler = ref(false)
const replyTo = ref<NoteItem | null>(null)
const notice = ref<string | null>(null)
const chat = useTemplateRef<{ jumpTo: (id: string) => Promise<void>; toNewest: () => void }>('chat')

/** The audience of the note she is writing. */
const level = ref<NoteLevel>(clampToOffer(store.remembered, store.publicEnabled))
/** What a reply may not be wider than: the note it answers, as it shows to her. */
const parentLevel = computed<NoteLevel | null>(() => (replyTo.value ? replyTo.value.effectiveVisibility : null))
const heldBack = computed(() => parentLevel.value !== null && parentLevel.value !== 'public')

function startAgain() {
  level.value = settleLevel(startLevel(store.remembered, parentLevel.value), store.publicEnabled, parentLevel.value)
}
watch(replyTo, startAgain)
// The owner's switch changed while she was writing: Everyone is gone from the control, and from her choice.
watch(publicEnabled, () => (level.value = settleLevel(level.value, store.publicEnabled, parentLevel.value)))
function chooseLevel(next: NoteLevel) {
  level.value = settleLevel(next, store.publicEnabled, parentLevel.value)
  // The device remembers a choice for the next note, except Everyone: that is one note's.
  store.remember(level.value)
}

const replyChip = computed(() => (replyTo.value ? replyChipOf(replyTo.value, quoteWords.value) : null))

function quoteOfReply(item: NoteItem | null): NoteQuote | null {
  if (!item || !item.id) return null
  return {
    kind: 'note',
    id: item.id,
    author: { id: item.authorId ?? '', name: item.author, photo: null },
    excerpt: item.veiled || item.voice ? '' : item.body.replace(/\s+/g, ' ').trim().slice(0, 140),
    spoiler: item.spoiler,
    voice: item.voice,
  }
}

async function send() {
  const body = text.value
  if (!body.trim() || !room.value || !chapter.value) return
  notice.value = null
  const sent = await store.send(room.value.id, chapter.value.id, body, level.value, { replyTo: replyTo.value?.id ?? null, spoiler: spoiler.value, quote: quoteOfReply(replyTo.value) })
  if (!sent.ok) {
    notice.value = t(noteErrorKey(sent.error))
    return
  }
  text.value = ''
  replyTo.value = null
  spoiler.value = false
  // Everyone was for this note: the control is back on what the device remembers.
  level.value = clampToOffer(store.remembered, store.publicEnabled)
  chat.value?.toNewest()
}

/** What a recording may answer: nothing, or her own private note (the database takes no other). */
const voiceMaxMs = computed(() => (level.value === 'private' && (!replyTo.value || (replyTo.value.mine && replyTo.value.visibility === 'private')) ? VOICE_MAX_MS : undefined))

/** A finished recording from the composer: a private voice note, a bubble at once (`store.sendVoice`). A refusal (too short, too big) is said above the thread. */
async function sendVoice(voice: PreparedVoice) {
  if (!room.value || !chapter.value) return
  // Only me is the one audience of a recording: the microphone is not offered anywhere else, and one that arrives anyway is not posted.
  if (level.value !== 'private') {
    notice.value = t(noteErrorKey('voice_private_only'))
    return
  }
  notice.value = null
  const sent = await store.sendVoice(room.value.id, chapter.value.id, voice, { replyTo: replyTo.value?.id ?? null, quote: quoteOfReply(replyTo.value) })
  if (!sent.ok) {
    notice.value = t(noteErrorKey(sent.error))
    return
  }
  replyTo.value = null
  chat.value?.toNewest()
}

async function retry(key: string) {
  const item = byKey.value.get(key)
  if (item && !item.permanent && room.value && chapter.value) await store.retry(room.value.id, chapter.value.id, key)
}
/** A note that was refused (or still waits) is given up: the bubble goes, and the refusal the device kept with it. */
function discard(key: string) {
  if (room.value && chapter.value) store.discard(room.value.id, chapter.value.id, key)
}
async function react(noteId: string, emoji: string) {
  if (!room.value || !chapter.value) return
  const failed = await store.react(room.value.id, chapter.value.id, noteId, emoji)
  notice.value = failed ? t(noteErrorKey(failed)) : null
}
function reveal(key: string) {
  revealed.value = new Set([...revealed.value, key])
}
function answer(key: string) {
  const item = byKey.value.get(key)
  if (item?.id && !item.removed) replyTo.value = item
}

// ------------------------------------------------------------------ the action bar

function actionsOf(item: NoteItem): BarAction[] {
  if (item.removed || !item.id) return []
  const list: BarAction[] = []
  if (item.mine) {
    // While the owner's switch is off her public note counts as a friends' one: the bar says so where she would change it.
    list.push({ id: 'visibility', label: item.visibility === 'public' && !publicEnabled.value ? t('notes.level.paused') : t('notes.visibilitySheet.title'), icon: item.visibility === 'public' ? 'globe' : item.visibility === 'private' ? 'lock' : 'people' })
    list.push({ id: 'delete', label: t('notes.thread.delete'), icon: 'trash' })
  } else {
    list.push({ id: 'report', label: t('notes.thread.report'), icon: 'flag' })
    list.push({ id: 'block', label: t('notes.thread.block', { name: item.author?.trim() || t('member.someone') }), icon: 'ban' })
  }
  return list
}

const deleting = ref<NoteItem | null>(null)
const deleteOpen = ref(false)
const deleteBusy = ref(false)
const deleteError = ref<NoteErrorCode | null>(null)
const reportId = ref<string | null>(null)
const reportOpen = ref(false)
const levelNote = ref<NoteItem | null>(null)
const levelOpen = ref(false)
const blocking = ref<NoteItem | null>(null)
const blockOpen = ref(false)
const blockBusy = ref(false)
const blockError = ref<string | null>(null)

function action(actionId: string, key: string) {
  const item = byKey.value.get(key)
  if (!item?.id) return
  if (actionId === 'delete') {
    deleting.value = item
    deleteError.value = null
    deleteOpen.value = true
  } else if (actionId === 'report') {
    reportId.value = item.id
    reportOpen.value = true
  } else if (actionId === 'visibility') {
    levelNote.value = item
    levelOpen.value = true
  } else if (actionId === 'block') {
    blocking.value = item
    blockError.value = null
    blockOpen.value = true
  }
}
async function confirmDelete() {
  const item = deleting.value
  if (!item?.id || deleteBusy.value || !room.value || !chapter.value) return
  deleteBusy.value = true
  deleteError.value = null
  const failed = await store.deleteNote(room.value.id, chapter.value.id, item.id)
  deleteBusy.value = false
  if (failed) deleteError.value = failed
  else deleteOpen.value = false
}
const reportNote = async (noteId: string, reason: ReportReason, note: string | null) => store.report(noteId, reason, note)

/** Blocks the author of a note: silent, both ways, everywhere (the People screens' own call); what was hers on this page is gone when it is read again. */
async function confirmBlock() {
  const item = blocking.value
  if (!item?.authorId || blockBusy.value) return
  blockBusy.value = true
  blockError.value = null
  const result = await social.block(item.authorId)
  if (result.error) {
    blockBusy.value = false
    blockError.value = result.error === 'offline' ? t('common.offline') : t('people.error')
    return
  }
  await refresh()
  blockBusy.value = false
  blockOpen.value = false
}

// ------------------------------------------------------------------ playing a voice note

const voicePlayer = useVoicePlayer()
// Leaving the thread silences the voice that is playing.
onBeforeUnmount(() => voicePlayer.stop())

/** The base's double-tap window (`UiBubble`): a second press inside it likes. */
const DOUBLE_TAP_MS = 300
type Press = { at: number; started: boolean; liked: boolean }
const lastPress = new Map<string, Press>()

/**
 * The press on the play button of a **stored voice note**, taken before the base's own (the capture phase of the thread's root: the base would play the
 * placeholder it was given, `VOICE_UNSIGNED`, because nothing was signed when the thread loaded). Here the first press asks for the URL (`store.voiceUrl`,
 * five minutes, kept for four) and plays it; a second press inside the double-tap window likes the note, as on any bubble (and stops the sound the first one
 * started). A press with the keyboard (no `detail`) only plays or pauses. A note still on its way, or refused, plays from the device's own copy: the base's.
 */
function voicePress(event: MouseEvent) {
  const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-testid$=".voicePlay"]')
  if (!button) return
  const key = button.closest<HTMLElement>('[data-key]')?.dataset.key
  const item = key ? items.value.find((i) => i.key === key) : undefined
  if (!item?.voice || item.delivery !== 'sent' || !item.media?.path || store.previewOf(item.key)) return
  event.stopPropagation()
  event.preventDefault()
  if (!mayLoadMedia(item, view.value?.open === true, revealed.value.has(item.key))) return
  const now = Date.now()
  const before = lastPress.get(item.key)
  const canLike = !!item.id && event.detail > 0
  if (canLike && before && now - before.at <= DOUBLE_TAP_MS) {
    lastPress.delete(item.key)
    // The first press may still be waiting for its URL: it is told not to play when it comes.
    before.liked = true
    if (before.started) voicePlayer.stop()
    void react(item.id!, NOTE_EMOJI[0]!)
    return
  }
  const press: Press = { at: now, started: false, liked: false }
  lastPress.set(item.key, press)
  void playVoice(item, press)
}

async function playVoice(item: NoteItem, press: Press) {
  notice.value = null
  const path = item.media!.path!
  // Her press again on the one that is playing (or paused): the base's player pauses or resumes it, with no new URL.
  if (voicePlayer.current.key === item.key && !voicePlayer.current.failed) {
    const playing = voicePlayer.current.playing
    voicePlayer.toggle(item.key, VOICE_UNSIGNED)
    press.started = !playing
    return
  }
  const answer = await store.voiceUrl(path)
  if (answer.error) {
    notice.value = answer.error === 'offline' ? t(noteErrorKey('offline')) : t('notes.thread.voicePlayFailed')
    return
  }
  // A second press came while the URL was on its way: that was a double tap, which likes and does not play.
  if (press.liked) return
  voicePlayer.toggle(item.key, answer.data)
  press.started = true
}

// ------------------------------------------------------------------ the veil

const showOpen = ref(false)
/** She said "Show anyway": once the thread is up, focus goes to the composer (the quiet screen she tapped on is gone). */
let focusComposerWhenReady = false
function focusComposer() {
  if (!focusComposerWhenReady || status.value !== 'ready') return
  const field = document.querySelector<HTMLElement>('[data-testid="notesThread.composer"] textarea, [data-testid="notesThread.composer"] input')
  if (!field) return
  focusComposerWhenReady = false
  field.focus()
}
watch(status, () => void nextTick(focusComposer))
async function showAnyway() {
  if (!room.value || !chapter.value) return
  focusComposerWhenReady = true
  store.peek(room.value.id, chapter.value.id)
  await nextTick()
  await nextTick()
  focusComposer()
}

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo(notesPath(bookId.value))
}

</script>

<template>
  <!-- Not a chapter of this Book's notes (any more): one quiet answer. -->
  <div v-if="missing" class="relative min-h-dvh" data-testid="notes.thread.missing">
    <UiTopBar :back-label="t('notes.thread.back')" back-testid="notes.thread.back" @back="back" />
    <FriendsNote heading :title="t('notes.missingTitle')" :text="t('notes.missingText')">
      <UiButton tone="secondary" size="md" :to="notesPath(bookId)" data-testid="notes.thread.missingBook">{{ t('notes.toNotes') }}</UiButton>
    </FriendsNote>
  </div>

  <!-- A veiled chapter: nothing of it is read. The number, why, and the one way in. -->
  <div v-else-if="view?.veiled" class="relative min-h-dvh" data-testid="notes.thread.veiled">
    <UiTopBar :back-label="t('notes.thread.back')" back-testid="notes.thread.back" @back="back" />
    <FriendsNote heading :title="isEnd ? t('notes.thread.veiledEnd') : t('notes.thread.veiledTitle', { n: chapter?.position ?? '' })" :text="t('notes.thread.veiledText')">
      <UiButton tone="secondary" size="md" data-testid="notes.thread.showAnyway" @click="showOpen = true">{{ t('notes.showAnyway.action') }}</UiButton>
    </FriendsNote>
    <RoomShowAnyway v-model:open="showOpen" prefix="notes.showAnyway" :number="chapter?.position ?? ''" :end="isEnd" @show="showAnyway" />
  </div>

  <UiChatThread
    v-else
    ref="chat"
    :items="items"
    :status="status"
    :label="t('notes.thread.label', { title })"
    :offline="!online"
    :error="notice"
    :has-more="hasMore"
    :older-status="olderStatus"
    :load-older="loadOlder"
    :conversation-key="`${bookId}:${chapter?.id ?? ''}`"
    :head-shown="items.length === 0"
    :same-run="sameAuthorRun"
    class="notes-thread"
    testid="notesThread"
    landmark
    @click.capture="voicePress"
  >
    <template #top>
      <UiRoundButton class="pointer-events-auto" icon="back" :label="t('notes.thread.back')" data-testid="notes.thread.back" @click="back" />
      <h1
        class="absolute left-1/2 w-max -translate-x-1/2 text-center text-body font-medium wrap-anywhere"
        style="max-width: calc(100% - 2 * (var(--spacing-inset) + var(--size-touch) + var(--spacing-sm)))"
        data-testid="notes.thread.title"
      >
        {{ title }}<span v-if="book" class="figures block text-caption font-normal text-ink-muted" data-testid="notes.thread.book">{{ book.title }}</span>
      </h1>
      <UiRoundButton class="pointer-events-auto" icon="repeat" :label="t('notes.thread.refresh')" :disabled="!online" data-testid="notes.thread.refresh" @click="refresh" />
    </template>

    <template #head>
      <p class="mx-auto max-w-prose px-xl py-xl text-center text-subhead text-ink-muted" data-testid="notes.thread.empty">
        {{ isEnd ? t('notes.thread.emptyEnd') : t('notes.thread.empty', { n: chapter?.position ?? '' }) }}
      </p>
    </template>

    <template #message="{ item, signed, endsRun, reacting, placement, highlight, openReactions, closeReactions }">
      <p v-if="item.kind === 'system'" class="px-md py-xs text-center text-caption text-ink-faint italic" data-testid="notesThread.removed">
        {{ noteOf(item).moderated ? t('notes.thread.moderated') : t('notes.thread.removed') }}
      </p>
      <UiBubble
        v-else
        :item="item"
        :read="false"
        :fresh="fresh.has(item.key)"
        :signed="signed && !item.mine"
        :sender="noteOf(item).author"
        :author="noteOf(item).author"
        :ends-run="endsRun"
        :can-react="true"
        :emojis="NOTE_EMOJI"
        :quote="quoteFor(noteOf(item))"
        :highlight="highlight"
        :actions="actionsOf(noteOf(item))"
        :reacting="reacting"
        :placement="placement"
        :veiled="noteOf(item).veiled"
        testid="notesThread"
        @react-open="openReactions"
        @react-close="closeReactions"
        @react="react"
        @action="action"
        @reply="answer"
        @retry="retry"
        @reveal="reveal"
        @quote-tap="(id: string) => chat?.jumpTo(id)"
      >
        <!-- Who wrote it, and a public note's globe: "Mira K. 🌐 Everyone" (hers: the mark alone, at her side). -->
        <template #sender="{ signed: named, sender }">
          <p
            v-if="(named && sender) || noteOf(item).effectiveVisibility === 'public'"
            class="flex items-center gap-xs px-xs pb-xs text-caption text-ink-faint"
            :class="item.mine && 'justify-end'"
            data-testid="notesThread.sender"
          >
            <span v-if="named && sender" data-testid="notesThread.name">{{ sender }}</span>
            <span v-if="noteOf(item).effectiveVisibility === 'public'" class="inline-flex items-center gap-xxs" data-testid="notesThread.public">
              <UiIcon name="globe" :size="14" /><span>{{ t('notes.level.public') }}</span>
            </span>
          </p>
        </template>
        <!-- A quote with an id is the base's. One without says what it is in the app's words: "A note you can't see" (no name, no jump), or the tombstone's. -->
        <template #quote="{ quote, mine, tap }">
          <UiQuote v-if="quote?.id" class="mb-xs not-italic" :quote="quote" :mine="mine" testid="notesThread" @tap="tap" />
          <span
            v-else-if="quote"
            class="quote mb-xs flex w-full min-w-0 items-center gap-sm rounded-sm px-sm py-xs"
            :class="mine ? 'bg-on-ink/10' : 'bg-fill'"
            data-deleted="true"
            data-testid="notesThread.quote"
          >
            <span class="w-(--stroke-focus) shrink-0 self-stretch rounded-pill bg-accent" aria-hidden="true" />
            <span class="text-caption italic" :class="mine ? 'text-on-ink opacity-70' : 'text-ink-muted'" data-testid="notesThread.quotePreview">{{ quote.preview }}</span>
          </span>
        </template>
        <template #face>
          <FriendsAvatar :card="{ id: item.authorId ?? '', name: noteOf(item).author, photo: noteOf(item).authorPhoto }" />
        </template>
        <!-- Her private note says so under the bubble; a note that was refused says why: "Try again" unless nothing can change it, and "Delete" for good. -->
        <template v-if="item.delivery === 'failed' || (item.mine && noteOf(item).visibility === 'private')" #meta="{ time, showTime }">
          <time :datetime="item.createdAt" class="px-xs pt-xs text-caption text-ink-faint tabular-nums" :class="showTime ? '' : 'sr-only'">{{ time }}</time>
          <p v-if="item.mine && noteOf(item).visibility === 'private'" class="flex items-center justify-end gap-xxs px-xs pt-xs text-caption text-ink-faint" data-testid="notesThread.private">
            <UiIcon name="lock" :size="14" /><span>{{ t('notes.level.private') }}</span>
          </p>
          <template v-if="item.delivery === 'failed'">
            <p class="max-w-[78%] px-xs pt-xs text-right text-caption text-error" role="status" data-testid="notesThread.failed">
              {{ item.error }} {{ item.permanent ? t('notes.thread.notSentFinal') : t('uiText.chat.retryHint') }}
            </p>
            <div class="flex justify-end gap-xs">
              <button
                v-if="!item.permanent"
                type="button"
                class="min-h-(--size-touch) px-xs text-caption text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"
                data-testid="notesThread.retry"
                @click="retry(item.key)"
              >
                {{ t('notes.thread.retry') }}
              </button>
              <button
                type="button"
                class="min-h-(--size-touch) px-xs text-caption text-error focus-visible:outline-2 focus-visible:outline-accent"
                :aria-label="t('notes.thread.discardLabel')"
                data-testid="notesThread.discard"
                @click="discard(item.key)"
              >
                {{ t('notes.thread.discard') }}
              </button>
            </div>
          </template>
        </template>
      </UiBubble>
    </template>

    <template #composer>
      <!-- The line under the control while it is on Everyone: it describes the state, it does not nag (no sheet, no dialog). -->
      <p v-if="level === 'public'" class="mx-auto max-w-prose px-xl pb-xs text-center text-footnote text-ink-muted" role="status" data-testid="notes.level.notice">{{ t('notes.level.publicNotice') }}</p>
      <UiComposer
        v-model="text"
        :placeholder="isEnd ? t('notes.thread.placeholderEnd') : t('notes.thread.placeholder', { n: chapter?.position ?? '' })"
        :label="t('notes.thread.composerLabel')"
        :max="2000"
        :quote="replyChip"
        :voice-max-ms="voiceMaxMs"
        testid="notesThread"
        @send="send"
        @voice="sendVoice"
        @voice-error="notice = $event"
        @cancel-quote="replyTo = null"
      >
        <template #actions>
          <UiComposerChip :aria-pressed="spoiler" :icon="spoiler ? 'check' : 'eyeOff'" data-testid="notesThread.spoiler" @click="spoiler = !spoiler">
            {{ t('notes.thread.spoiler') }}
          </UiComposerChip>
          <NotesLevelPicker class="min-w-0 flex-1" :model-value="level" :public-enabled="publicEnabled" :parent="parentLevel" testid="notesThread.level" @update:model-value="chooseLevel" />
          <p v-if="heldBack" class="basis-full text-footnote text-ink-faint" data-testid="notesThread.levelHeld">{{ t('notes.level.heldBack') }}</p>
        </template>
      </UiComposer>
    </template>

    <UiConfirm
      v-model:open="deleteOpen"
      :title="t('notes.thread.deleteTitle')"
      :text="t('notes.thread.deleteText')"
      :action="deleteBusy ? t('notes.thread.deleting') : t('notes.thread.delete')"
      :busy="deleteBusy"
      :error="deleteError ? t(noteErrorKey(deleteError)) : null"
      :offline="!online"
      testid="notes.thread.delete"
      @confirm="confirmDelete"
    />
    <UiConfirm
      v-model:open="blockOpen"
      :title="t('people.blockTitle', { name: blocking?.author?.trim() || t('member.someone') })"
      :text="t('people.blockText')"
      :action="t('people.blockConfirm')"
      :busy="blockBusy"
      :error="blockError"
      :offline="!online"
      testid="notes.thread.block"
      @confirm="confirmBlock"
    />
    <RoomReportSheet v-model:open="reportOpen" prefix="notes.report" :message-id="reportId" :send="reportNote" :error-key="(code) => noteErrorKey(code as NoteErrorCode)" />
    <NotesVisibilitySheet
      v-if="room && chapter"
      v-model:open="levelOpen"
      :room-id="room.id"
      :section-id="chapter.id"
      :note-id="levelNote?.id ?? null"
      :visibility="levelNote?.visibility ?? 'friends'"
      :voice="levelNote?.voice ?? false"
    />
  </UiChatThread>
</template>

<style scoped>
/* The bar (reactions, Reply, Copy, then Who can see this or Report and Block) is wider than a 360 px phone beside a face: it stops at the screen's edge and scrolls,
   its arrow keys and its focus bring a button into view, instead of running off the screen. */
.quote {
  min-height: calc(var(--text-caption--line-height) * 2);
}
.notes-thread :deep([data-testid$='.reactionBar']) {
  max-width: calc(100vw - var(--spacing-xxl) - var(--spacing-lg));
  overflow-x: auto;
  scrollbar-width: none;
}
</style>
