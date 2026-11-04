<script setup lang="ts">
// A thread of a buddy read (docs/plans/buddy-read-shared.md part B, 4 and parts 5.4, 7; docs/parity.md, "Buddy read: a thread"): the room's
// ("Before we start", `/together/<id>/room`), a Section's or "The whole book"'s (`/together/<id>/<section id>`). The base's chat screen
// (`UiChatThread`, `UiBubble`, `UiComposer`, one reaction bar a bubble) filled with the store's messages (stores/buddyRead.ts): optimistic
// sends that wait in the queue, live arrivals, day separators, earlier pages on scrolling up, a quote and a swipe to answer, and in the
// reaction bar Copy, Delete (her own, or any as the host) and Report (somebody else's: one reason, an optional note, to the owner).
//
// **The veil** (part 5.4): a Section her marker has not reached, and she has not opened anyway, is not read at all: this page shows the
// quiet "hidden" screen with "Show anyway", and only her yes (a peek, kept on this device; her Section does not move) loads it. An open
// Section she reads ahead of her marker carries a banner that says so. A comment marked Spoiler is veiled for everybody else until
// they tap it (`UiBubble` `veiled`); a deleted one reads "Message removed". Archived: read-only, said in the composer's place.
//
// Accessibility: the base's thread is a labelled list with a polite status for a message that arrives (not for the first load, not for
// her own), which stands in for `role="log"` (a log with a status says everything twice); every long press has the bubble's own React
// button; a reaction needs a tap; 44 px targets; the page reflows at 200 % text (the base's chat screen is fixed to the viewport).
import type { BarAction } from '#layers/ui/app/components/ui/ReactionBar.vue'
import { threadKey } from '#layers/chat/app/utils/thread'
import type { BuddyErrorCode } from '~/data/buddyReads'
import { isReadId, isSectionSegment, roomPath, sectionOfSegment } from '~/utils/buddyRoute'
import { buddyErrorKey } from '~/utils/buddyRead'
import { sectionTitle } from '~/utils/buddySectionTitle'
import { quoteOf, sameAuthorRun, threadItems, type ThreadItem } from '~/utils/buddyThread'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { useSessionStore } from '~/stores/session'

definePageMeta({
  layout: 'tabs',
  screen: 'together',
  pushed: true,
  // The chat fills the screen: the tab bar steps away while it shows (components/shell/TabBar.vue).
  immersive: true,
  // One page per thread: going from one Section to another starts its own state (what she tapped, what she was writing).
  key: (route) => route.fullPath,
  validate: (route) => useBuddyReadsFlag() && isReadId(route.params.id) && isSectionSegment(route.params.section),
  middleware: 'buddy-reads',
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useBuddyReadStore()
const session = useSessionStore()
const online = useOnline()

const readId = computed(() => String(route.params.id))
/** The Section's id, or null for the room. */
const sectionId = computed(() => sectionOfSegment(route.params.section) ?? null)
const me = computed(() => session.member?.id ?? null)
const read = computed(() => store.reads[readId.value] ?? null)
const chapter = computed(() => (sectionId.value ? (read.value?.chapters.find((c) => c.id === sectionId.value) ?? null) : null))
/** The veil's answer for this thread; null while the read is not loaded or the Section is not part of it. */
const view = computed(() => (read.value ? store.view(readId.value, sectionId.value) : null))
const isHost = computed(() => read.value?.canManage ?? false)
const archived = computed(() => read.value?.status === 'archived')
/** Live updates are paused: the channel has not been live for a while and the device is online (offline says its own). */
const paused = computed(() => store.liveStuck && online.value)

// ------------------------------------------------------------------ loading

const error = ref<BuddyErrorCode | null>(null)
let release: (() => void) | null = null
let gone = false
let opened = false

async function load() {
  error.value = await store.load(readId.value)
}
async function openThread() {
  if (opened) return
  opened = true
  const failed = await store.openThread(readId.value, sectionId.value)
  if (failed) {
    opened = false
    store.closeThread(readId.value, sectionId.value)
    error.value = failed
  }
}

onMounted(async () => {
  // Never throws: a channel that cannot be had is `store.liveStuck`, said above the thread, and asked for again by the store.
  const stop = await store.retain(readId.value)
  if (gone) stop()
  else release = stop
})
onMounted(async () => {
  if (!read.value) await load()
})
// Nothing of a Section is read until it is open to her: her marker reached it, or she said "Show anyway".
watch(() => view.value?.open === true, (open) => open && void openThread(), { immediate: true })
onBeforeUnmount(() => {
  gone = true
  release?.()
  if (opened) store.closeThread(readId.value, sectionId.value)
})
// Back online after a failure: asked again.
watch(online, (now) => {
  if (!now) return
  if (!read.value) void load()
  else if (error.value && view.value?.open) {
    error.value = null
    void openThread()
  }
})

const thread = computed(() => store.threads[threadKey(readId.value, sectionId.value)] ?? null)
// As the room's: the store forgetting the read (a live refresh, or the thread's own read) is as good as this page's own `not_found`.
const missing = computed(() => (!read.value && (error.value === 'not_found' || store.forgotten[readId.value] === true)) || (!!read.value && !view.value))
const status = computed(() => {
  if (error.value && !thread.value?.loaded) return 'error'
  if (!read.value) return 'loading'
  return thread.value?.loaded ? 'ready' : 'loading'
})

// Entered with the keyboard (Enter on a row of the room), the focus would stay on <body>: it goes to the heading once the thread is drawn.
useFocusHeading(() => missing.value || status.value === 'ready' || view.value?.veiled === true)

// ------------------------------------------------------------------ the messages

const revealed = ref<ReadonlySet<string>>(new Set())
const nameOf = (memberId: string | null) => read.value?.members.find((m) => m.id === memberId)?.name?.trim() || null
const items = computed<ThreadItem[]>(() =>
  threadItems(store.messagesOf(readId.value, sectionId.value), {
    me: me.value,
    open: view.value?.open === true,
    revealed: revealed.value,
    nameOf,
    errorWord: (code) => t(buddyErrorKey(code)),
  }),
)

/** The messages that came after the thread was shown: they play the arrival animation once. */
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
  const before = items.value.length
  await store.loadOlder(readId.value, sectionId.value)
  return items.value.length > before
}

const sectionWords = { whole: () => t('together.wholeBook'), label: (n: string) => t('together.sectionLabel', { n }) }
const quoteWords = computed(() => ({ deleted: t('uiText.chat.reply.deleted'), spoiler: t('uiText.chat.veiled.label'), someone: t('member.someone'), you: t('uiText.chat.reply.you') }))
const quoteFor = (item: ThreadItem) => quoteOf(items.value, item.replyTo, quoteWords.value)

// ------------------------------------------------------------------ title and banners

// A Section's name is the viewer's own words for what the host's tool wrote ("Section 3", "The whole book"): the host's language is not hers.
const title = computed(() => (sectionId.value === null ? t('together.room') : chapter.value ? sectionTitle(chapter.value, sectionWords) : ''))
const range = computed(() => (chapter.value?.pages ? t('together.pages', { from: chapter.value.pages[0], to: chapter.value.pages[1] }) : null))
useHead({ title: () => `${title.value || t('together.title')} · ${t('app.name')}` })

/** Her marker has reached this Section (her reading opened it, or she set it by hand): it is no longer "reading ahead". */
const reached = computed(() => {
  const r = read.value
  const c = chapter.value
  if (!r || !c) return true
  const parts = r.chapters.filter((x) => x.kind === 'chapter').length
  return c.kind === 'end' ? r.readThrough >= parts : c.position <= r.readThrough
})
/** She opened a Section her marker has not reached ("Show anyway"): said once above the thread; her own Section is where it was. */
const ahead = computed(() => view.value?.open === true && view.value.peeked && !reached.value)

// ------------------------------------------------------------------ writing

const text = ref('')
const spoiler = ref(false)
const replyTo = ref<ThreadItem | null>(null)
const notice = ref<string | null>(null)
const chat = useTemplateRef<{ jumpTo: (id: string) => Promise<void>; toNewest: () => void }>('chat')

const replyQuote = computed(() => {
  const q = replyTo.value ? quoteOf(items.value, replyTo.value.id, quoteWords.value) : null
  return q ? { name: q.name, preview: q.preview } : null
})

async function send() {
  const body = text.value
  if (!body.trim()) return
  notice.value = null
  const sent = await store.send(readId.value, sectionId.value, body, { replyTo: replyTo.value?.id ?? null, spoiler: sectionId.value !== null && spoiler.value })
  if (!sent.ok) {
    notice.value = t(buddyErrorKey(sent.error))
    return
  }
  text.value = ''
  replyTo.value = null
  spoiler.value = false
  chat.value?.toNewest()
}

async function retry(key: string) {
  const item = items.value.find((i) => i.key === key)
  // Refused for a reason a second try cannot change: the tap on the bubble leads nowhere, "Delete" is what is offered.
  if (item && !item.permanent) await store.retry(readId.value, sectionId.value, key)
}

/** A message that was refused (or still waits) is given up: the bubble goes, and the refusal the device kept with it. */
function discard(key: string) {
  store.discard(readId.value, sectionId.value, key)
}

async function react(messageId: string, emoji: string) {
  const failed = await store.react(readId.value, sectionId.value, messageId, emoji)
  notice.value = failed ? t(buddyErrorKey(failed)) : null
}

function reveal(key: string) {
  revealed.value = new Set([...revealed.value, key])
}

// Reaction bar: Delete (her own message, or any as the host) and Report (somebody else's).
// Three of the database's six (`react_to_buddy_message`: ❤️ 😂 😮 😢 🔥 📚): the base's bar is as wide as its buttons (44 px each) and opens
// from the bubble's own edge, beside the sender's face; with Reply, Copy and Report it is seven buttons, which is what a 360 px
// phone has room for. A reaction another client sets with one of the others still shows on the bubble.
const EMOJIS = ['❤️', '😂', '🔥'] as const
function actionsOf(item: ThreadItem): BarAction[] {
  if (item.removed || !item.id || archived.value) return []
  const list: BarAction[] = []
  if (!item.mine) list.push({ id: 'report', label: t('together.thread.report'), icon: 'flag' })
  if (item.mine || isHost.value) list.push({ id: 'delete', label: t('together.thread.delete'), icon: 'trash' })
  return list
}

const deleting = ref<ThreadItem | null>(null)
const deleteOpen = ref(false)
const deleteBusy = ref(false)
const deleteError = ref<BuddyErrorCode | null>(null)
const reportId = ref<string | null>(null)
const reportOpen = ref(false)

function action(actionId: string, key: string) {
  const item = items.value.find((i) => i.key === key)
  if (!item?.id) return
  if (actionId === 'delete') {
    deleting.value = item
    deleteError.value = null
    deleteOpen.value = true
  } else if (actionId === 'report') {
    reportId.value = item.id
    reportOpen.value = true
  }
}
async function confirmDelete() {
  const item = deleting.value
  if (!item?.id || deleteBusy.value) return
  deleteBusy.value = true
  deleteError.value = null
  const failed = await store.deleteMessage(readId.value, sectionId.value, item.id)
  deleteBusy.value = false
  if (failed) deleteError.value = failed
  else deleteOpen.value = false
}

function answer(key: string) {
  const item = items.value.find((i) => i.key === key)
  if (item?.id && !item.removed) replyTo.value = item
}

// ------------------------------------------------------------------ the veil

const showOpen = ref(false)
/** She said "Show anyway": once the thread is up, focus goes to the composer (the quiet screen she tapped on is gone; focus would be lost at the top of the page). */
let focusComposerWhenReady = false
function focusComposer() {
  if (!focusComposerWhenReady || status.value !== 'ready') return
  const field = document.querySelector<HTMLElement>('[data-testid="buddyThread.composer"] textarea, [data-testid="buddyThread.composer"] input')
  if (!field) return
  focusComposerWhenReady = false
  field.focus()
}
watch(status, () => void nextTick(focusComposer))
async function showAnyway() {
  if (!sectionId.value) return
  focusComposerWhenReady = true
  store.peek(sectionId.value)
  await nextTick()
  await nextTick()
  focusComposer()
}

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo(roomPath(readId.value))
}
</script>

<template>
  <!-- Not in it (any more), or not a Section of it: one quiet answer. -->
  <div v-if="missing" class="relative min-h-dvh" data-testid="together.thread.missing">
    <UiTopBar :back-label="t('together.thread.back')" back-testid="together.thread.back" @back="back" />
    <FriendsNote heading :title="t('together.missingTitle')" :text="t('together.missingText')">
      <UiButton tone="secondary" size="md" data-testid="together.thread.missingHome" @click="navigateTo('/')">{{ t('together.home') }}</UiButton>
    </FriendsNote>
  </div>

  <!-- A veiled Section: nothing of it is read. The number, why, and the one way in. -->
  <div v-else-if="view?.veiled" class="relative min-h-dvh" data-testid="together.thread.veiled">
    <UiTopBar :back-label="t('together.thread.back')" back-testid="together.thread.back" @back="back" />
    <FriendsNote heading :title="chapter?.kind === 'end' ? t('together.thread.veiledEnd') : t('together.thread.veiledTitle', { n: chapter?.position ?? '' })" :text="t('together.thread.veiledText')">
      <UiButton tone="secondary" size="md" data-testid="together.thread.showAnyway" @click="showOpen = true">{{ t('together.showAnyway.action') }}</UiButton>
    </FriendsNote>
    <TogetherShowAnyway v-model:open="showOpen" :number="chapter?.position ?? ''" :end="chapter?.kind === 'end'" @show="showAnyway" />
  </div>

  <UiChatThread
    v-else
    ref="chat"
    :items="items"
    :status="status"
    :label="t('together.thread.label', { title })"
    :offline="!online"
    :error="notice"
    :notice="archived ? t('together.thread.archived') : null"
    :has-more="hasMore"
    :older-status="olderStatus"
    :load-older="loadOlder"
    :conversation-key="`${readId}:${sectionId ?? 'room'}`"
    :head-shown="items.length === 0"
    :same-run="sameAuthorRun"
    class="together-thread"
    testid="buddyThread"
    landmark
  >
    <template #top>
      <UiRoundButton class="pointer-events-auto" icon="back" :label="t('together.thread.back')" data-testid="together.thread.back" @click="back" />
      <h1
        class="absolute left-1/2 w-max -translate-x-1/2 text-center text-body font-medium wrap-anywhere"
        style="max-width: calc(100% - 2 * (var(--spacing-inset) + var(--size-touch) + var(--spacing-sm)))"
        data-testid="together.thread.title"
      >
        {{ title }}<span v-if="range" class="figures block text-caption font-normal text-ink-muted" data-testid="together.thread.range">{{ range }}</span>
      </h1>
      <span />
    </template>

    <template v-if="ahead || paused" #banner>
      <p v-if="ahead" class="glass edge mx-auto w-fit max-w-full rounded-pill px-md py-xs text-center text-caption text-ink-muted" data-testid="together.thread.ahead">{{ t('together.thread.ahead') }}</p>
      <!-- The Free plan's connection limit says nothing: the channel just never goes live. Said quietly; the store reads what was missed every 25 s meanwhile. -->
      <p v-if="paused" class="glass edge mx-auto w-fit max-w-full rounded-pill px-md py-xs text-center text-caption text-ink-muted" role="status" data-testid="together.thread.paused">{{ t('together.thread.paused') }}</p>
    </template>

    <template #head>
      <p class="mx-auto max-w-prose px-xl py-xl text-center text-subhead text-ink-muted" data-testid="together.thread.empty">
        {{ sectionId === null ? t('together.thread.emptyRoom') : t('together.thread.empty') }}
      </p>
    </template>

    <template #message="{ item, signed, endsRun, reacting, placement, highlight, openReactions, closeReactions }">
      <p v-if="item.kind === 'system'" class="px-md py-xs text-center text-caption text-ink-faint italic" data-testid="buddyThread.removed">{{ t('together.thread.removed') }}</p>
      <UiBubble
        v-else
        :item="item"
        :read="false"
        :fresh="fresh.has(item.key)"
        :signed="signed && !item.mine"
        :sender="item.author"
        :author="item.author"
        :ends-run="endsRun"
        :can-react="!archived"
        :emojis="EMOJIS"
        :quote="quoteFor(item)"
        :highlight="highlight"
        :actions="actionsOf(item)"
        :reacting="reacting"
        :placement="placement"
        :veiled="item.veiled"
        testid="buddyThread"
        @react-open="openReactions"
        @react-close="closeReactions"
        @react="react"
        @action="action"
        @reply="answer"
        @retry="retry"
        @reveal="reveal"
        @quote-tap="(id: string) => chat?.jumpTo(id)"
      >
        <template #face>
          <FriendsAvatar :card="{ id: item.authorId ?? '', name: item.author, photo: read?.members.find((m) => m.id === item.authorId)?.photo ?? null }" />
        </template>
        <!-- A message that was refused: why, "Try again" unless nothing can change it (removed, blocked, archived, invalid), and "Delete" for good. -->
        <template v-if="item.delivery === 'failed'" #meta="{ time, showTime }">
          <time :datetime="item.createdAt" class="px-xs pt-xs text-caption text-ink-faint tabular-nums" :class="showTime ? '' : 'sr-only'">{{ time }}</time>
          <p class="max-w-[78%] px-xs pt-xs text-right text-caption text-error" role="status" data-testid="buddyThread.failed">
            {{ item.error }} {{ item.permanent ? t('together.thread.notSentFinal') : t('uiText.chat.retryHint') }}
          </p>
          <div class="flex justify-end gap-xs">
            <button
              v-if="!item.permanent"
              type="button"
              class="min-h-(--size-touch) px-xs text-caption text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"
              data-testid="buddyThread.retry"
              @click="retry(item.key)"
            >
              {{ t('together.retry') }}
            </button>
            <button
              type="button"
              class="min-h-(--size-touch) px-xs text-caption text-error focus-visible:outline-2 focus-visible:outline-accent"
              :aria-label="t('together.thread.discardLabel')"
              data-testid="buddyThread.discard"
              @click="discard(item.key)"
            >
              {{ t('together.thread.discard') }}
            </button>
          </div>
        </template>
      </UiBubble>
    </template>

    <template #composer>
      <UiComposer
        v-model="text"
        :placeholder="sectionId === null ? t('together.thread.placeholderRoom') : t('together.thread.placeholder')"
        :label="t('together.thread.composerLabel')"
        :max="2000"
        :quote="replyQuote"
        testid="buddyThread"
        @send="send"
        @cancel-quote="replyTo = null"
      >
        <template v-if="sectionId !== null" #actions>
          <UiComposerChip :aria-pressed="spoiler" :icon="spoiler ? 'check' : 'eyeOff'" data-testid="buddyThread.spoiler" @click="spoiler = !spoiler">
            {{ t('together.thread.spoiler') }}
          </UiComposerChip>
        </template>
      </UiComposer>
    </template>

    <UiConfirm
      v-model:open="deleteOpen"
      :title="t('together.thread.deleteTitle')"
      :text="deleting && !deleting.mine ? t('together.thread.deleteTextHost') : t('together.thread.deleteText')"
      :action="deleteBusy ? t('together.thread.deleting') : t('together.thread.delete')"
      :busy="deleteBusy"
      :error="deleteError ? t(buddyErrorKey(deleteError)) : null"
      :offline="!online"
      testid="together.thread.delete"
      @confirm="confirmDelete"
    />
    <TogetherReportSheet v-model:open="reportOpen" :message-id="reportId" />
  </UiChatThread>
</template>

<style scoped>
/* The host's bar (Reply, Copy, Report, Delete) is wider than a 360 px phone beside a face: it stops at the screen's edge and scrolls,
   its arrow keys and its focus bring a button into view, instead of running off the screen. */
.together-thread :deep([data-testid$='.reactionBar']) {
  max-width: calc(100vw - var(--spacing-xxl) - var(--spacing-lg));
  overflow-x: auto;
  scrollbar-width: none;
}
</style>
