<script setup lang="ts">
// "Your circle" on Home (social v1, §C 13; the mocks' screen 1): the newest three rows of the feed
// (an entry, or a batch folded into a fan that opens its sheet), each with its day at the end, and
// "Show more" to the feed's page. The last section of Home, so its coming (the copy at once, the
// refreshed feed a moment after) moves nothing above it. Hidden altogether while the feed has
// nothing: Home does not nudge anyone to be social. A change plays like a list's (`UiListMotion`,
// once the sheet that caused it has gone) and the section, when it has something for the first time,
// opens its room (`UiReveal`).
import type { FeedRow } from '~/data/feed'
import { useFeedStore } from '~/stores/feed'
import { useSocialStore } from '~/stores/social'

/** How many rows Home shows: a glance, the feed's page has the rest. */
const SHOWN = 3

type Batch = Extract<FeedRow, { type: 'batch' }>

const { t } = useI18n()
const feed = useFeedStore()
const { label } = useFeedDay()
const social = useSocialStore()
const online = useOnline()

// The newest request that waits (People has them all), above the entries: the section shows for it
// alone too. Her settings carry the count (read by the shell's header); the list is asked for when
// there is one.
const request = computed(() => (social.requests > 0 ? (social.people?.requests[0] ?? null) : null))
watch(
  () => social.requests,
  (waiting) => {
    if (waiting > 0) void social.loadPeople(true)
  },
  { immediate: true },
)
const answering = ref(false)
async function answer(accept: boolean) {
  const asking = request.value
  if (!asking) return
  answering.value = true
  // The store reads her settings and People again: the row leaves, the header's dot with it.
  await social.answer(asking.id, accept)
  answering.value = false
}

/** The newest rows with the day each is from, across the days. */
const rows = useSettled(() => feed.days.flatMap((day) => day.rows.map((row) => ({ row, day: day.day }))).slice(0, SHOWN))

// Asked when it mounts (Home shows it once the Library is there) and each time Home is shown again.
let justMounted = false
onMounted(() => {
  justMounted = true
  void feed.refresh()
  void nextTick(() => (justMounted = false))
})
onActivated(() => {
  if (!justMounted) void feed.refresh()
})

function rowKey(row: FeedRow): string {
  return row.type === 'entry' ? row.entry.id : `${row.member.id}:${row.kind}:${row.day ?? ''}:${row.entries[0]?.id}`
}

// A batch's sheet, as the feed's page has it; kept after it closes so its rows stay while it slides away.
const batch = shallowRef<Batch | null>(null)
const batchDay = ref('')
const sheetOpen = ref(false)
function openBatch(row: Batch, day: string) {
  batch.value = row
  batchDay.value = label(day)
  sheetOpen.value = true
}
</script>

<template>
  <UiReveal :show="rows.length > 0 || !!request">
    <section data-testid="home.circle">
      <div class="flex h-(--size-touch) items-center">
        <h2 class="eyebrow">{{ t('circle.title') }}</h2>
      </div>
      <FriendsRequestRow
        v-if="request"
        :request="request"
        compact
        :offline="!online"
        :busy="answering"
        @accept="answer(true)"
        @decline="answer(false)"
      />
      <UiListMotion tag="ul" class="flex flex-col divide-y divide-hairline" :aria-label="t('circle.title')">
        <template v-for="({ row, day }, index) in rows" :key="rowKey(row)">
          <FriendsFeedRow
            v-if="row.type === 'entry'"
            :entry="row.entry"
            testid="home.circleEntry"
            compact
            :day-label="label(day)"
            :eager="index < 3"
          />
          <FriendsFeedBatch
            v-else
            :batch="row"
            testid="home.circleBatch"
            :day-label="label(day)"
            :eager="index < 3"
            @open="openBatch(row, day)"
          />
        </template>
      </UiListMotion>
      <UiButton v-if="rows.length > 0" tone="quiet" size="md" block to="/friends" class="mt-sm" data-testid="home.circleMore">{{ t('circle.more') }}</UiButton>
    </section>
    <FriendsBatchSheet v-if="batch" v-model:open="sheetOpen" :batch="batch" :day-label="batchDay" />
  </UiReveal>
</template>
