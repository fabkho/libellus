<script setup lang="ts">
// "Your friends" on Home (social v1, U8, the combined mock): the newest follow request as one raised
// row (Accept, ✕), then the week's one finished Book as a lit card with her stars and review
// (HomeFriendsFeature), then one row per member, newest first, at most three (HomeFriendsRow: her
// name, the day, one sentence of what she did lately, a fan of the covers it names; a tap opens the
// sheet of those reads, as the feed's batch row does, or the Book when it is one read, her avatar and
// name opening her page), and "Show more" to the feed's page. utils/friendsView.ts decides what the card is and what each row says, from the
// feed store's loaded entries. The last section of Home, so its coming (the copy at once, the
// refreshed feed a moment after) moves nothing above it. Hidden altogether while there is no
// request, no card and no row: Home does not nudge anyone to be social. A change plays like a list's
// (`UiListMotion`, once the sheet that caused it has gone) and the section, when it has something
// for the first time, opens its room (`UiReveal`).
//
// Test ids: `home.friends`, `home.friendsRequest|friendsAccept|friendsDecline` (the request row),
// `home.friendsFeature` (+ `.member`, `.cover`, `.title`, `.stars`, `.review`, `.more`),
// `home.friendsRow`, `home.friendsTitle` (the title, a link to the feed), `home.friendsMore`.
import { friendsView, entriesKind } from '~/utils/friendsView'
import { useFeedStore } from '~/stores/feed'
import { useLikesStore } from '~/stores/likes'
import type { MemberCard, RecentLike } from '~/data/social'
import type { FeedBatchView } from '~/data/feed'
import type { FriendsRow } from '~/utils/friendsView'
import { useSocialStore } from '~/stores/social'

const { t } = useI18n()
const feed = useFeedStore()
const likes = useLikesStore()
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

// A row's sheet (social v2a): the reads her sentence names, as the feed's batch row opens them. Kept after it closes,
// so its rows stay while it slides away; Back from a Book opened from it opens it again as it was left.
const sheet = shallowRef<{ view: FeedBatchView; day: string } | null>(null)
const sheetOpen = ref(false)
function openRow(friend: FriendsRow) {
  sheet.value = { view: { member: friend.member, kind: entriesKind(friend.entries), entries: friend.entries }, day: label(friend.day) }
  sheetOpen.value = true
}
const { restore } = useSheetRestore({
  testid: 'friendsBatch',
  sheet: () => (sheetOpen.value && sheet.value ? sheet.value : null),
  reopen: (kept) => {
    sheet.value = kept
    sheetOpen.value = true
  },
})

/** The card and the rows, from what the feed has loaded. */
const view = useSettled(() => friendsView(feed.entries, { now: new Date(), dayOf: (at) => isoDay(new Date(at)) }))
const card = computed(() => view.value.card)
const friends = computed(() => view.value.friends)
const cardKey = computed(() => (card.value ? `${card.value.member.id}:${card.value.book.id}:${card.value.at}` : ''))

// Asked when it mounts (Home shows it once the Library is there) and each time Home is shown again.
let justMounted = false
onMounted(() => {
  justMounted = true
  void feed.refresh()
  void likes.loadRecent()
  void nextTick(() => (justMounted = false))
})
onActivated(() => {
  if (!justMounted) {
    void feed.refresh()
    void likes.loadRecent()
  }
})

// Who liked one of her reads: the sheet asks `session_likers` for the read tapped (online only: offline it says so).
const likersOpen = ref(false)
const likers = ref<readonly MemberCard[] | null>(null)
const likersFailed = ref(false)
let asked = ''
async function openLikers(item: RecentLike) {
  asked = item.session
  likers.value = null
  likersFailed.value = false
  likersOpen.value = true
  if (!online.value) return
  const result = await likes.likers(item.session)
  if (asked !== item.session) return
  if (result.error) likersFailed.value = result.error !== 'offline'
  else likers.value = result.data
}
</script>

<template>
  <UiReveal :show="friends.length > 0 || !!card || !!request || !!likes.recent?.length">
    <section data-testid="home.friends">
      <div class="flex h-(--size-touch) items-center">
        <h2>
          <NuxtLink to="/friends" class="eyebrow flex h-(--size-touch) items-center gap-xs" data-testid="home.friendsTitle">
            {{ t('friends.title') }}
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
      <p v-if="request && answerFailed" class="mb-xs px-xs text-footnote text-error" role="alert" data-testid="home.friendsError">{{ t('people.error') }}</p>
      <HomeFriendsLikes v-if="likes.recent?.length" :items="likes.recent" @open="openLikers" />
      <UiListMotion tag="div">
        <div v-if="card" :key="cardKey" class="py-xs">
          <HomeFriendsFeature :card="card" />
        </div>
      </UiListMotion>
      <UiListMotion tag="ul" class="flex flex-col divide-y divide-hairline" :aria-label="t('friends.title')">
        <HomeFriendsRow
          v-for="friend in friends"
          :key="friend.member.id"
          :friend="friend"
          :day-label="label(friend.day)"
          @open="openRow(friend)"
        />
      </UiListMotion>
      <UiButton v-if="friends.length > 0 || card" tone="quiet" size="md" block to="/friends" class="mt-sm" data-testid="home.friendsMore">{{ t('friends.more') }}</UiButton>
      <FriendsBatchSheet v-if="sheet" v-model:open="sheetOpen" :batch="sheet.view" :day-label="sheet.day" :restore="restore" />
      <FriendsLikersSheet v-model:open="likersOpen" :members="likers" :error="likersFailed" :offline="!online" />
    </section>
  </UiReveal>
</template>
