<script setup lang="ts">
// One feed entry (social v1, §C 15 and 18): the member's avatar and name (a link to her page) and
// what she did ("finished", "started again", …), then the Book as the Library's rows draw it —
// the cover, the title in the serif, the authors, her stars when there are some — and her review
// folded at four lines, `More` unfolding it. The cover and the title open the Book's page, the cover
// flying there as everywhere else (UiPressLink); a Manual book opens nothing, a follower cannot
// read it (the row still shows its title and stars). The title is written beside the cover, so the
// cover is decorative.
//
// `compact` is Home's: no review. `bare` is the batch sheet's: the avatar line is not repeated, the
// member is in the sheet's title, and the cover is `size="sm"`. `dayLabel` is the word at the line's end Home puts the day in
// (the page has day eyebrows instead). `testid` is the row's; the parts add `Member`, `Book`,
// `Review`, `More`, `WantToRead` and `Like` to it. At the right of the author line, Want to read first and the
// heart last (the same order on Home's card and a member's rows): the Want to read button (FriendsWantToReadButton,
// on what a friend finished, reviewed or started, not on a Manual book) and the heart (FriendsLikes, on a finished read). A review flagged as spoilers that she may not read yet is folded behind
// *Show anyway* (FriendsReviewFold); the stars stay.
import type { FeedEntry } from '~/data/feed'
import { useBookStore } from '~/stores/book'
import { focusAfterWant } from '~/utils/focusAfterWant'
import { likeable } from '~/utils/likes'
import { carriesWantToRead } from '~/utils/wantToRead'

const props = withDefaults(defineProps<{
  entry: FeedEntry
  testid: string
  compact?: boolean
  bare?: boolean
  dayLabel?: string | null
  eager?: boolean
  /** The cover: `md` in the feed, `sm` in the batch sheet, where a row is a title and an author. */
  size?: 'sm' | 'md'
}>(), { size: 'md' })

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
const row = useTemplateRef<HTMLElement>('row')
/** The button is gone once the Book is added: focus goes to the heart, else the title. */
async function wanted() {
  await nextTick()
  focusAfterWant(row.value, `${props.testid}Like`, `${props.testid}Book`)
}

// The review: four lines, and `More` only when there is more than four lines of it.
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
  <li ref="row" class="flex items-start gap-ml py-ms" :data-testid="testid">
    <UiPressLink v-if="!book.manual && !book.unverified" :to="bookPath" class="shrink-0" tabindex="-1" aria-hidden="true" @press="books.prefetch(book.id)">
      <UiCover
        decorative
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, size)"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        :size="size"
        :eager="eager"
      />
    </UiPressLink>
    <span v-else class="shrink-0">
      <UiCover
        decorative
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, size)"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        :size="size"
        :eager="eager"
      />
    </span>

    <div class="flex min-w-0 flex-1 flex-col items-start gap-xxs">
      <div v-if="!bare" class="flex w-full min-w-0 items-start justify-between gap-sm">
        <div class="flex min-w-0 flex-wrap items-center gap-x-sm gap-y-xxs text-subhead">
          <NuxtLink :to="`/friends/${entry.member.id}`" class="reach flex min-w-0 items-center gap-sm" :data-testid="`${testid}Member`">
            <FriendsAvatar :card="entry.member" />
            <span class="truncate font-medium">{{ name }}</span>
          </NuxtLink>
          <span class="min-w-0 text-ink-muted">{{ verb }}</span>
        </div>
        <span v-if="dayLabel" class="eyebrow shrink-0 pt-xs" :data-testid="`${testid}Day`">{{ dayLabel }}</span>
      </div>

      <UiPressLink
        v-if="!book.manual && !book.unverified"
        :to="bookPath"
        class="reach book-title text-callout py-xxs"
        :data-testid="`${testid}Book`"
        @press="books.prefetch(book.id)"
      >{{ book.title }}</UiPressLink>
      <span v-else class="book-title text-callout py-xxs" :data-testid="`${testid}Book`">{{ book.title }}</span>

      <div v-if="authorLine || showWant || showHeart" class="flex w-full min-w-0 items-center justify-between gap-md py-xs">
        <p class="min-w-0 truncate text-caption text-ink-muted">{{ authorLine }}</p>
        <span v-if="showWant || showHeart" class="flex shrink-0 items-center gap-md">
          <FriendsWantToReadButton v-if="showWant" :book="book" :testid="`${testid}WantToRead`" @added="wanted" />
          <FriendsLikes v-if="showHeart" :row="entry" :name="name" :owner="entry.member.id" :title="book.title" :testid="`${testid}Like`" />
        </span>
      </div>
      <FriendsLikeError v-if="showHeart" :row="entry" :testid="`${testid}Like`" />
      <UiStars v-if="entry.rating" :quarters="entry.rating" :data-testid="`${testid}Stars`" />

      <FriendsReviewFold v-if="showReview" :folded="entry.folded" :name="name" :testid="`${testid}Folded`">
        <p
          ref="review"
          tabindex="-1"
          class="book-title mt-xs text-subhead text-ink-muted italic"
          :class="!expanded && 'line-clamp-4'"
          :data-testid="`${testid}Review`"
        >{{ entry.review }}</p>
        <button
          v-if="clamped && !expanded"
          type="button"
          class="-mt-xs -mb-sm min-h-(--size-touch) text-caption text-ink-faint hover:text-ink-muted"
          :data-testid="`${testid}More`"
          @click="unfold"
        >{{ t('feed.more') }}</button>
      </FriendsReviewFold>
    </div>
  </li>
</template>

<style scoped>
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
</style>
