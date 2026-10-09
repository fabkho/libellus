<script setup lang="ts">
// The feed (social v1, §C 14–20; the mocks' screens 2–4): what the people she follows did, newest
// first, under day eyebrows (Today, Yesterday, Monday, 3 Oct), thirty at a time and more as she
// scrolls near the end. Each entry is a FeedRow, three or more of one kind by one member and day a
// FeedBatch that opens its sheet. The People button at the top right opens People. Pushed from
// Home's "Your circle" (Show more), in the tab layout, so Home stays alive under it.
//
// The device's copy shows at once and the load refreshes it; offline there is only the copy, under
// a line that says when it is from. Pull to refresh is the browser's own. Empty: following nobody
// (the follow link, Profile for now), or following people with nothing yet (quiet). A load that
// fails with nothing to show says so, with Try again.
import type { FeedRow } from '~/data/feed'
import { useFeedStore } from '~/stores/feed'

definePageMeta({ layout: 'tabs', screen: 'friends', pushed: true })

type Batch = Extract<FeedRow, { type: 'batch' }>

const { t, locale } = useI18n()
const router = useRouter()
const feed = useFeedStore()
const online = useOnline()
const { label } = useFeedDay()

useHead({ title: () => `${t('feed.title')} · ${t('app.name')}` })

onMounted(() => void feed.refresh())

// Home is where the feed is reached from: back always leads there, by history when it came from it.
function back() {
  if (window.history.state?.back === '/') router.back()
  else void navigateTo('/')
}

const offline = computed(() => (feed.offlineSince ? t('feed.offline', { time: copyTimeLabel(feed.offlineSince, new Date(), locale.value) }) : null))

function rowKey(row: FeedRow): string {
  return row.type === 'entry' ? row.entry.id : `${row.member.id}:${row.kind}:${row.day ?? ''}:${row.entries[0]?.id}`
}

// ------------------------------------------------------------------ a batch's sheet
// Kept after it closes, so the sheet's rows stay while it slides away; Back from a Book opened
// from it opens it again as it was left (composables/useSheetRestore.ts).
const batch = shallowRef<Batch | null>(null)
const batchDay = ref('')
const sheetOpen = ref(false)
function openBatch(row: Batch, day: string) {
  batch.value = row
  batchDay.value = label(day)
  sheetOpen.value = true
}
const { restore } = useSheetRestore({
  testid: 'friendsBatch',
  sheet: () => (sheetOpen.value && batch.value ? { row: batch.value, day: batchDay.value } : null),
  reopen: (kept) => {
    batch.value = kept.row
    batchDay.value = kept.day
    sheetOpen.value = true
  },
})

// ------------------------------------------------------------------ more, near the end
// A mark after the last row; once it is within a screen of the view, the next page is asked for.
const end = useTemplateRef<HTMLElement>('end')
let observer: IntersectionObserver | null = null
function watchEnd() {
  observer?.disconnect()
  if (!end.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && void feed.loadMore(), { rootMargin: '100% 0px' })
  observer.observe(end.value)
}
onMounted(watchEnd)
onBeforeUnmount(() => observer?.disconnect())
// A page of rows that still leaves the mark in view must ask for the next one: observe it afresh.
watch(
  () => [feed.entries.length, feed.ended, feed.loadingMore] as const,
  async () => {
    await nextTick()
    watchEnd()
  },
)
</script>

<template>
  <div class="relative min-h-dvh" data-testid="friends">
    <UiTopBar :back-label="t('member.back')" back-testid="friends.back" @back="back">
      <template #trailing>
        <UiRoundButton :label="t('feed.peopleLabel')" data-testid="friends.people" @click="navigateTo('/friends/people')">
          <!-- Two readers, in the icon set's hairline stroke: the set has no people glyph yet. -->
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            :style="{ strokeWidth: 'var(--stroke-icon)' }"
          >
            <circle cx="9.5" cy="8.5" r="3" />
            <path d="M4 19c.4-3.2 2.5-5 5.5-5s5.1 1.8 5.5 5" />
            <path d="M15.5 5.7a3 3 0 0 1 0 5.6M17.5 14.3c1.4.6 2.3 2.1 2.5 4.2" />
          </svg>
        </UiRoundButton>
      </template>
    </UiTopBar>

    <header class="px-screen pt-bar">
      <h1 class="text-large-title" data-testid="friends.title">{{ t('feed.title') }}</h1>
    </header>

    <!-- The copy this device holds, when it cannot ask for a newer one. -->
    <div role="status">
      <p v-if="offline" class="eyebrow px-screen pt-sm" data-testid="friends.offline">{{ offline }}</p>
    </div>

    <div v-if="feed.days.length" class="px-screen pt-sm" data-testid="friends.list">
      <section v-for="(day, dayIndex) in feed.days" :key="day.day" class="pt-md">
        <h2 class="eyebrow" data-testid="friends.day">{{ label(day.day) }}</h2>
        <UiListMotion tag="ul" class="flex flex-col divide-y divide-hairline" :aria-label="label(day.day)">
          <template v-for="(row, index) in day.rows" :key="rowKey(row)">
            <FriendsFeedRow v-if="row.type === 'entry'" :entry="row.entry" testid="friends.entry" :eager="dayIndex === 0 && index < 4" />
            <FriendsFeedBatch
              v-else
              :batch="row"
              testid="friends.batch"
              :eager="dayIndex === 0 && index < 4"
              @open="openBatch(row, day.day)"
            />
          </template>
        </UiListMotion>
      </section>
      <div ref="end" class="h-px" aria-hidden="true" />
    </div>

    <div v-else-if="!feed.loaded && feed.loading" class="px-screen pt-md" aria-hidden="true">
      <ProfileRowPlaceholder v-for="i in 4" :key="i" :wave="i * 0.08" label />
    </div>

    <div v-else-if="feed.emptyState === 'nobody'" class="px-screen pt-lg" data-testid="friends.empty">
      <UiEmptyState screen="friendsEmpty" :title="t('feed.emptyTitle')" :text="t('feed.empty')">
        <UiButton to="/profile" class="self-center" data-testid="friends.emptyShare">{{ t('feed.emptyShare') }}</UiButton>
      </UiEmptyState>
    </div>

    <div v-else-if="feed.emptyState === 'quiet'" class="px-screen pt-lg" data-testid="friends.quiet">
      <UiEmptyState screen="friendsQuiet" :title="t('feed.quietTitle')" :text="t('feed.quiet')" />
    </div>

    <div v-else-if="feed.loadError" class="px-lg pt-xxl text-center" data-testid="friends.loadError">
      <p class="text-subhead text-ink-muted">{{ t('feed.loadError') }}</p>
      <UiButton tone="secondary" size="md" class="mt-md" :disabled="!online" data-testid="friends.retry" @click="feed.refresh()">
        {{ t('feed.retry') }}
      </UiButton>
    </div>

    <FriendsBatchSheet v-if="batch" v-model:open="sheetOpen" :batch="batch" :day-label="batchDay" :restore="restore" />
  </div>
</template>
