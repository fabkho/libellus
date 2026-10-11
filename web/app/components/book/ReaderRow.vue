<script setup lang="ts">
// One reader on a Book's page (social v2a, contract §1.5): the member she follows who holds this work, in her
// most relevant state. Her avatar and name (both open her profile, `/friends/<id>`), her state and its day
// ("Finished · 3 Oct", "Reading · 2 Oct", "Put down · 30 Sep", "Wants to read · 1 Oct") with her stars when she
// shows them, and her review in the serif italic folded at four lines (FriendsMemberReview), or behind *Show
// anyway* when she flagged spoilers and the caller has not finished this work (FriendsReviewFold, as the feed). A
// finished read with a review carries the heart, alone in the shared icon column at the row's right edge
// (FriendsRowActions `cover="avatar"`, the column as tall as the avatar, so the heart is level with it, on her name and
// state lines; a row without one has no column and keeps its width). No *Want to read*: she is on the Book's page, which has its own add.
//
// Props: `reader` (BookReader), `title` (the Book's, for the heart's label), `testid`. The row is `<testid>`; the
// heart is `<testid>.like`.
import type { BookReader } from '~/data/social'
import { likeable } from '~/utils/likes'
import { readerStateKey } from '~/utils/bookReaders'

const props = withDefaults(defineProps<{ reader: BookReader; title: string; testid?: string }>(), { testid: 'book.readers.row' })

const { t } = useI18n()
const { formatDay } = useDays()
const name = computed(() => props.reader.member.name?.trim() || t('member.someone'))
const state = computed(() => t(readerStateKey(props.reader.state)))
const day = computed(() => (props.reader.day ? formatDay(props.reader.day) : null))
const heart = computed(() => props.reader.state === 'finished' && Boolean(props.reader.review) && likeable(props.reader))
</script>

<template>
  <div class="flex items-start gap-ms py-ms" :data-testid="testid">
    <NuxtLink :to="`/friends/${reader.member.id}`" class="reach shrink-0" tabindex="-1" aria-hidden="true">
      <FriendsAvatar :card="reader.member" />
    </NuxtLink>
    <div class="flex min-w-0 flex-1 flex-col gap-xxs">
      <NuxtLink :to="`/friends/${reader.member.id}`" class="reach min-w-0 truncate text-callout font-medium" :data-testid="`${testid}.member`">{{ name }}</NuxtLink>
      <span class="figures flex min-w-0 items-center gap-sm overflow-hidden text-meta whitespace-nowrap text-ink-faint">
        <span :data-testid="`${testid}.state`">{{ state }}</span>
        <template v-if="day"><span class="dot" aria-hidden="true" /><span>{{ day }}</span></template>
        <UiStars v-if="reader.rating" :quarters="reader.rating" />
      </span>
      <FriendsReviewFold v-if="reader.review" :folded="reader.folded" :name="name" :testid="`${testid}.folded`">
        <FriendsMemberReview :text="reader.review" />
      </FriendsReviewFold>
      <FriendsLikeError v-if="heart" :row="reader" :testid="`${testid}.like`" />
    </div>
    <!-- The heart alone (she is on the Book's page: no Want to read), in the shared icon column, level with the avatar. -->
    <FriendsRowActions cover="avatar" :like="heart ? reader : null" :name="name" :owner="reader.member.id" :title="title" :like-testid="`${testid}.like`" />
  </div>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>
