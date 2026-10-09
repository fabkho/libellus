<script setup lang="ts">
// "Your circle" on Home (social v1, U8, the combined mock): the newest follow request as one raised
// row (Accept, ✕), then the week's one finished Book as a lit card with her stars and review
// (HomeCircleFeature), then one row per member, newest first, at most three (HomeCircleFriend: her
// name, the day, one sentence of what she did lately, a fan of the covers it names), and "Show more"
// to the feed's page. utils/circleView.ts decides what the card is and what each row says, from the
// feed store's loaded entries. The last section of Home, so its coming (the copy at once, the
// refreshed feed a moment after) moves nothing above it. Hidden altogether while there is no
// request, no card and no row: Home does not nudge anyone to be social. A change plays like a list's
// (`UiListMotion`, once the sheet that caused it has gone) and the section, when it has something
// for the first time, opens its room (`UiReveal`).
//
// Test ids: `home.circle`, `home.circleRequest|circleAccept|circleDecline` (the request row),
// `home.circleFeature` (+ `.member`, `.cover`, `.title`, `.stars`, `.review`, `.more`),
// `home.circleFriend`, `home.circleTitle` (the title, a link to the feed), `home.circleMore`.
import { circleView } from '~/utils/circleView'
import { useFeedStore } from '~/stores/feed'
import { useSocialStore } from '~/stores/social'

const { t } = useI18n()
const feed = useFeedStore()
const { label } = useFeedDay()
const social = useSocialStore()
const online = useOnline()

// The newest request that waits (People has them all), above the rest: the section shows for it
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
/** An answer the database refused (not one the offline label already says): the row stays, so say why. */
const answerFailed = ref(false)
async function answer(accept: boolean) {
  const asking = request.value
  if (!asking) return
  answering.value = true
  answerFailed.value = false
  // The store reads her settings and People again: the row leaves, the header's dot with it.
  const result = await social.answer(asking.id, accept)
  answerFailed.value = !!result.error && result.error !== 'offline'
  answering.value = false
}

/** The card and the rows, from what the feed has loaded. */
const view = useSettled(() => circleView(feed.entries, { now: new Date(), dayOf: (at) => isoDay(new Date(at)) }))
const card = computed(() => view.value.card)
const friends = computed(() => view.value.friends)
const cardKey = computed(() => (card.value ? `${card.value.member.id}:${card.value.book.id}:${card.value.at}` : ''))

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
</script>

<template>
  <UiReveal :show="friends.length > 0 || !!card || !!request">
    <section data-testid="home.circle">
      <div class="flex h-(--size-touch) items-center">
        <h2>
          <NuxtLink to="/friends" class="eyebrow flex h-(--size-touch) items-center gap-xs" data-testid="home.circleTitle">
            {{ t('circle.title') }}
            <UiIcon name="chevron" :size="12" class="shrink-0" />
          </NuxtLink>
        </h2>
      </div>
      <FriendsRequestRow
        v-if="request"
        :request="request"
        compact
        class="mb-xs"
        :offline="!online"
        :busy="answering"
        @accept="answer(true)"
        @decline="answer(false)"
      />
      <p v-if="request && answerFailed" class="mb-xs px-xs text-footnote text-error" role="alert" data-testid="home.circleError">{{ t('people.error') }}</p>
      <UiListMotion tag="div">
        <div v-if="card" :key="cardKey" class="py-xs">
          <HomeCircleFeature :card="card" eager />
        </div>
      </UiListMotion>
      <UiListMotion tag="ul" class="flex flex-col divide-y divide-hairline" :aria-label="t('circle.title')">
        <HomeCircleFriend
          v-for="(friend, index) in friends"
          :key="friend.member.id"
          :friend="friend"
          :day-label="label(friend.day)"
          :eager="index < 3"
        />
      </UiListMotion>
      <UiButton v-if="friends.length > 0 || card" tone="quiet" size="md" block to="/friends" class="mt-sm" data-testid="home.circleMore">{{ t('circle.more') }}</UiButton>
    </section>
  </UiReveal>
</template>
