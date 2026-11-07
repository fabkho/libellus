<script setup lang="ts">
// Feedback, for the instance's owner: what members sent from Profile → Contact (a bug, a feature request,
// something else), newest first, thirty at a time (Show older). Reached from the Profile's Feedback row; only
// the owner's account has it (stores/feedback.ts), and for anyone else the address is a page that doesn't
// exist (`validate`, the same 404 as any unknown address) and nothing is asked of the server, which refuses
// them as well (`not_owner`).
//
// A pushed screen in the tab layout, built like the Waitlist: the round back and a Refresh button in the bar,
// the large title, how many are open and how many are handled, then one block a message: its kind as a
// badge, who wrote it (first name and address, or "A member") and when (relative), the text, Device details
// (collapsed: what the app attached) and Mark handled (or Handled, which opens it again). A message is TEXT,
// always: it is shown as plain text with its line breaks and never read as markup. Nothing yet: D's empty
// state. The list cannot be loaded: why, and Try again (a load that fails keeps the messages on screen).
// Writes are disabled and say Offline while the device is (#15).
import { relativeTime } from '~/utils/relativeTime'
import { isShelfOwner } from '~/utils/shelfOwner'
import { useFeedbackStore } from '~/stores/feedback'
import { useSessionStore } from '~/stores/session'
import type { FeedbackItem } from '~/data/feedback'

definePageMeta({
  layout: 'tabs',
  screen: 'feedback',
  pushed: true,
  // Runs in the app's entry, before this page's chunk loads: the session and the config only.
  validate: () => isShelfOwner(useSessionStore().member?.id, useRuntimeConfig().public.shelfOwnerId),
})

const { t, locale } = useI18n()
const router = useRouter()
const store = useFeedbackStore()
const online = useOnline()
const { count } = useFigures()

useHead({ title: () => `${t('feedback.title')} · ${t('app.name')}` })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/profile')
}

onMounted(() => void store.load())
// Back online with nothing to show: load without a tap.
watch(online, (now) => now && store.loadError === 'offline' && void store.load())

const items = computed(() => store.items ?? [])
const openItems = computed(() => items.value.filter((item) => !item.handledAt))
const empty = computed(() => store.items !== null && !items.value.length)
const failed = computed(() => store.loadError !== null && store.items === null)

const now = ref(Date.now())
watch(() => store.items, () => (now.value = Date.now()))

const who = (item: FeedbackItem) => [item.memberName, item.memberEmail].filter(Boolean).join(' · ') || t('feedback.anonymous')
const when = (item: FeedbackItem) => relativeTime(item.at, now.value, locale.value)

/** The context as lines of text ("route: /profile"): every value cut, nothing is read as markup. */
function details(item: FeedbackItem): string[] {
  return Object.entries(item.context).map(([key, value]) => `${key.slice(0, 40)}: ${String(typeof value === 'object' ? JSON.stringify(value) : value).slice(0, 300)}`)
}

/** A report of a note: its id, and the level the note had (the database put both in the report's context). */
const noteOf = (item: FeedbackItem): string | null => (item.kind === 'report' && typeof item.context.note === 'string' ? item.context.note : null)
const levelOf = (item: FeedbackItem): 'private' | 'friends' | 'public' | null => {
  const level = item.context.visibility
  return level === 'private' || level === 'friends' || level === 'public' ? level : null
}

const removing = ref<FeedbackItem | null>(null)
const removeOpen = ref(false)
const removeReason = ref('')
const removeBusy = ref(false)
const removeFailed = ref<string | null>(null)
const askRemove = (item: FeedbackItem) => {
  removing.value = item
  removeReason.value = ''
  removeFailed.value = null
  removeOpen.value = true
}
async function confirmRemove() {
  const item = removing.value
  const note = item ? noteOf(item) : null
  if (!item || !note || removeBusy.value) return
  removeBusy.value = true
  removeFailed.value = null
  const done = await store.removeNote(item.id, note, removeReason.value.trim())
  removeBusy.value = false
  if (done) removeOpen.value = false
  else removeFailed.value = store.removeError === 'offline' ? t('feedback.offline') : t('feedback.removeNote.error')
}

const busy = ref<string | null>(null)
async function toggle(item: FeedbackItem) {
  if (busy.value) return
  busy.value = item.id
  await store.markHandled(item.id, !item.handledAt)
  busy.value = null
}
</script>

<template>
  <div class="relative min-h-dvh pb-xl">
    <UiTopBar :back-label="t('feedback.back')" back-testid="feedback.back" @back="back">
      <template #trailing>
        <UiRoundButton
          icon="repeat"
          :label="store.loading ? t('feedback.refreshing') : t('feedback.refresh')"
          :disabled="store.loading || !online"
          :class="store.loading && 'spinning'"
          data-testid="feedback.refresh"
          @click="store.load()"
        />
      </template>
    </UiTopBar>

    <header class="px-screen pt-bar">
      <h1 class="text-large-title" data-testid="feedback.title">{{ t('feedback.title') }}</h1>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('feedback.intro') }}</p>
    </header>

    <div class="flex flex-col gap-lg px-screen pt-lg">
      <template v-if="items.length">
        <p class="figures text-subhead text-ink-muted" role="status" data-testid="feedback.summary">
          {{ t('feedback.summary', { open: count(openItems.length), handled: count(items.length - openItems.length) }) }}
        </p>

        <ul class="flex flex-col divide-y divide-hairline" data-testid="feedback.list">
          <li v-for="item in items" :key="item.id" class="flex flex-col gap-sm py-md" :data-handled="item.handledAt ? '' : undefined" data-testid="feedback.item">
            <div class="flex flex-wrap items-center gap-sm">
              <span class="figures rounded-pill bg-fill px-sm text-meta text-ink-muted" :data-kind="item.kind" data-testid="feedback.kind">{{ t(`contact.kind.${item.kind}`) }}</span>
              <span class="figures text-meta text-ink-faint" data-testid="feedback.when">{{ when(item) }}</span>
            </div>
            <p class="text-footnote wrap-anywhere text-ink-muted" data-testid="feedback.who">{{ who(item) }}</p>
            <p class="text-body wrap-anywhere whitespace-pre-wrap" :class="item.handledAt ? 'text-ink-muted' : 'text-ink'" data-testid="feedback.text">{{ item.text }}</p>
            <p v-if="noteOf(item) && levelOf(item)" class="text-footnote text-ink-muted" data-testid="feedback.noteLevel">{{ t('feedback.removeNote.level', { level: t(`notes.level.${levelOf(item)}`) }) }}</p>
            <details class="text-footnote text-ink-muted" data-testid="feedback.details">
              <summary class="min-h-(--size-touch) cursor-pointer py-sm" data-testid="feedback.detailsToggle">{{ t('feedback.details') }}</summary>
              <ul class="figures flex flex-col gap-xxs pb-sm text-meta wrap-anywhere text-ink-faint">
                <li v-for="line in details(item)" :key="line">{{ line }}</li>
              </ul>
            </details>
            <div class="flex flex-wrap gap-sm">
              <UiButton
                :tone="item.handledAt ? 'quiet' : 'secondary'"
                size="sm"
                :disabled="busy === item.id"
                :offline="!online"
                data-testid="feedback.handled"
                @click="toggle(item)"
              >
                <UiIcon v-if="item.handledAt" name="check" :size="14" />{{ item.handledAt ? t('feedback.handled') : t('feedback.markHandled') }}
              </UiButton>
              <UiButton v-if="noteOf(item) && !store.removedNotes.has(noteOf(item)!)" tone="secondary" size="sm" :offline="!online" data-testid="feedback.removeNote" @click="askRemove(item)">
                <UiIcon name="trash" :size="14" />{{ t('feedback.removeNote.action') }}
              </UiButton>
              <p v-else-if="noteOf(item)" class="self-center text-footnote text-ink-muted" role="status" data-testid="feedback.noteRemoved">{{ t('feedback.removeNote.done') }}</p>
            </div>
          </li>
        </ul>

        <UiButton v-if="store.more" tone="secondary" size="md" class="self-start" :disabled="store.loadingMore" :offline="!online" data-testid="feedback.more" @click="store.loadMore()">
          {{ store.loadingMore ? t('feedback.loadingMore') : t('feedback.more') }}
        </UiButton>
      </template>

      <p v-if="store.writeError" class="text-footnote text-error" role="alert" data-testid="feedback.writeError">
        {{ store.writeError === 'offline' ? t('feedback.offline') : t('feedback.writeError') }}
      </p>

      <UiEmptyState v-if="empty" screen="feedback" :title="t('feedback.empty.title')" :text="t('feedback.empty.text')" compact />

      <div v-else-if="failed" class="flex flex-col items-start gap-md" role="alert" data-testid="feedback.loadFailed">
        <p class="text-subhead text-ink-muted">{{ store.loadError === 'offline' ? t('feedback.offline') : t('feedback.loadError') }}</p>
        <UiButton tone="secondary" size="md" :offline="!online" data-testid="feedback.retry" @click="store.load()">{{ t('feedback.retry') }}</UiButton>
      </div>
    </div>

    <!-- The owner removes a reported note: "Removed by the moderator" for everyone, its words kept in the moderation log for 12 months (docs/plans/book-notes.md part 5.1). -->
    <UiConfirm
      v-model:open="removeOpen"
      :title="t('feedback.removeNote.title')"
      :text="t('feedback.removeNote.text')"
      :action="removeBusy ? t('feedback.removeNote.removing') : t('feedback.removeNote.action')"
      :busy="removeBusy"
      :error="removeFailed"
      :offline="!online"
      testid="feedback.removeNote.confirm"
      @confirm="confirmRemove"
    >
      <UiField id="feedback-remove-reason" v-model="removeReason" :label="t('feedback.removeNote.reason')" :hint="t('feedback.removeNote.reasonHint')" autocomplete="off" data-testid="feedback.removeNote.reason" />
    </UiConfirm>
  </div>
</template>

<style scoped>
.spinning :deep(svg) {
  animation: spin 900ms linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinning :deep(svg) {
    animation: none;
  }
}
</style>
