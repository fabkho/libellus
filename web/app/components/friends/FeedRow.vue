<script setup lang="ts">
// One feed entry (social v1, §C 15 and 18), drawn compact so a phone screen holds six or seven of them: the
// cover at `sm` (40 px wide, as in the batch sheet), then three lines beside it — her avatar (22 px) and name
// (a link to her page) with what she did ("finished", "started again", …); the Book's title in the serif (two
// lines at most); the authors with her stars at the line's end when there are some — and her review folded at two
// lines, `More` unfolding it. The cover and the title open the Book's page, the cover flying there as everywhere
// else (UiPressLink); a Manual book opens nothing, a follower cannot read it (the row still shows its title and
// stars). The title is written beside the cover, so the cover is decorative.
//
// A row is 14 px (`--spacing-inset`) above and below its content: the pair of icons at its right edge needs that
// much for each icon's 44 px touch box (`--row-pad`, read by FriendsRowActions). Its placeholder
// (FriendsRowPlaceholder, `feed`) draws the same three lines at the same height, so nothing moves when it is replaced.
//
// `compact` is Home's: no review. `bare` is the batch sheet's: the avatar line is not repeated, the member is in
// the sheet's title. `dayLabel` is the word at the line's end Home puts the day in (the page has day eyebrows
// instead). `testid` is the row's; the parts add `Member`, `Book`, `Review`, `More`, `WantToRead` and `Like` to it.
// At the row's right edge, a narrow column centred on the cover (FriendsRowActions, the same on Home's card and a
// member's rows): Want to read on top (on what a friend finished, reviewed or started, not on a Manual book), the
// heart under it (on a finished read). A review flagged as spoilers that she may not read yet is folded behind
// *Show anyway* (FriendsReviewFold); the stars stay.
import type { FeedEntry } from '~/data/feed'
import { useBookStore } from '~/stores/book'
import { likeable } from '~/utils/likes'
import { carriesWantToRead } from '~/utils/wantToRead'

const props = defineProps<{
  entry: FeedEntry
  testid: string
  compact?: boolean
  bare?: boolean
  dayLabel?: string | null
  eager?: boolean
}>()

const { t } = useI18n()
const books = useBookStore()

const name = computed(() => props.entry.member.name?.trim() || t('member.someone'))
const verb = computed(() => t(`feed.${feedVerbKey(props.entry.kind, props.entry.again)}`))
const book = computed(() => shownBook(props.entry.book, t('book.outsideCatalogue')))
const bookPath = computed(() => `/book/${book.value.id}`)
const authorLine = computed(() => formatAuthors(book.value.authors, t('common.etAl')))
const showReview = computed(() => Boolean(props.entry.review) && !props.compact)
// The Want to read button: on what a friend finished, reviewed or started (not on Home's compact rows).
const showWant = computed(() => carriesWantToRead(props.entry.kind) && !props.compact)
const showHeart = computed(() => likeable(props.entry) && !props.compact)

// The review: two lines, and `More` only when there is more than two lines of it.
const review = useTemplateRef<HTMLElement>('review')
const expanded = ref(false)
const clamped = ref(false)
function measure() {
  const el = review.value
  if (el && !expanded.value) clamped.value = el.scrollHeight > el.clientHeight + 1
}
let observer: ResizeObserver | null = null
// The review's line is there once it is drawn (a folded one is not, until *Show anyway*): measured and watched from then on.
watch(
  review,
  (el) => {
    observer?.disconnect()
    if (!el) return
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      observer ??= new ResizeObserver(measure)
      observer.observe(el)
    }
  },
  { flush: 'post', immediate: true },
)
onBeforeUnmount(() => observer?.disconnect())

/** More goes away once it is pressed: focus moves to the review it opened, so it is not lost (a11y). */
async function unfold() {
  expanded.value = true
  await nextTick()
  review.value?.focus()
}
</script>

<template>
  <li class="flex items-start gap-ms py-inset [--row-pad:var(--spacing-inset)]" :data-testid="testid">
    <UiPressLink v-if="!book.manual && !book.unverified" :to="bookPath" class="shrink-0" tabindex="-1" aria-hidden="true" @press="books.prefetch(book.id)">
      <UiCover
        decorative
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'sm')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        size="sm"
        :eager="eager"
      />
    </UiPressLink>
    <span v-else class="shrink-0">
      <UiCover
        decorative
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'sm')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        size="sm"
        :eager="eager"
      />
    </span>

    <div class="flex min-w-0 flex-1 flex-col items-start">
      <div v-if="!bare" class="who flex min-h-(--size-avatar) w-full min-w-0 items-start justify-between gap-sm">
        <div class="flex min-h-(--size-avatar) min-w-0 flex-wrap items-center gap-x-sm text-subhead">
          <NuxtLink :to="`/friends/${entry.member.id}`" class="reach reach-who flex min-w-0 items-center gap-sm" :data-testid="`${testid}Member`">
            <FriendsAvatar :card="entry.member" />
            <span class="truncate font-medium">{{ name }}</span>
          </NuxtLink>
          <span class="min-w-0 text-ink-muted">{{ verb }}</span>
        </div>
        <span v-if="dayLabel" class="eyebrow shrink-0 pt-xs" :data-testid="`${testid}Day`">{{ dayLabel }}</span>
      </div>

      <!-- The title may take two lines (a long one is still the Book); the link's 44 px box is its ::after, so the clamp is on the span inside. -->
      <UiPressLink
        v-if="!book.manual && !book.unverified"
        :to="bookPath"
        class="reach reach-title book-title min-w-(--size-touch) text-callout"
        :data-testid="`${testid}Book`"
        @press="books.prefetch(book.id)"
      ><span class="line-clamp-2">{{ book.title }}</span></UiPressLink>
      <span v-else class="book-title line-clamp-2 text-callout" :data-testid="`${testid}Book`">{{ book.title }}</span>

      <div v-if="authorLine || entry.rating" class="flex w-full min-w-0 items-center justify-between gap-sm">
        <p v-if="authorLine" class="min-w-0 truncate text-caption text-ink-muted">{{ authorLine }}</p>
        <UiStars v-if="entry.rating" :quarters="entry.rating" class="ml-auto shrink-0" :data-testid="`${testid}Stars`" />
      </div>
      <FriendsLikeError v-if="showHeart" :row="entry" :testid="`${testid}Like`" />

      <FriendsReviewFold v-if="showReview" :folded="entry.folded" :name="name" :testid="`${testid}Folded`">
        <p
          ref="review"
          tabindex="-1"
          class="book-title mt-xs text-subhead text-ink-muted italic"
          :class="!expanded && 'line-clamp-2'"
          :data-testid="`${testid}Review`"
        >{{ entry.review }}</p>
        <button
          v-if="clamped && !expanded"
          type="button"
          class="reach min-w-(--size-touch) text-left text-caption text-ink-faint hover:text-ink-muted"
          :data-testid="`${testid}More`"
          @click="unfold"
        >{{ t('feed.more') }}</button>
      </FriendsReviewFold>
    </div>

    <FriendsRowActions
      cover="sm"
      :book="showWant ? book : null"
      :like="showHeart ? entry : null"
      :name="name"
      :owner="entry.member.id"
      :title="book.title"
      :want-testid="`${testid}WantToRead`"
      :like-testid="`${testid}Like`"
    />
  </li>
</template>

<style scoped>
/* Her avatar is the small one: UiAvatar reads its size from --size-avatar, turned down here for the row's first line. */
.who {
  --size-avatar: var(--size-avatar-sm);
}
/* A link drawn smaller than a finger: its 44 px target is an invisible box centred on it, as UiButton's. */
.reach {
  position: relative;
}
.reach::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
.reach-who,
.reach-title {
  /* WCAG 2.2's 24 px target is the link's own box (axe does not count the ::after); the 2 px over its 22 px line are
     taken back by the negative margins, so the row keeps its compact height. */
  display: flex;
  min-height: 24px;
  align-items: center;
  margin-block: -1px;
}
/* Above the title's 44 px box, which reaches up under it by the 1 px: axe counts a target another one covers as obscured. */
.reach-who {
  z-index: 1;
}
/* Her name and the title are two lines, one under the other: two 44 px boxes cannot both be centred on them. The name's box
   reaches up into the row's padding and down 4 px past its line; the title's starts there and reaches down (over the authors
   line, which is not a target): each is 44 px tall and neither covers the other. */
.reach-who::after {
  inset: auto 0 auto;
  top: calc(var(--size-avatar-sm) + var(--spacing-xs) - var(--size-touch));
  transform: none;
}
.reach-title::after {
  inset: auto 0 auto;
  top: var(--spacing-xs);
  transform: none;
}
</style>
