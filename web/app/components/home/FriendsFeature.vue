<script setup lang="ts">
// The card of Home's Your friends (social v1, U8; the "Lit feature" mock): the week's one finished Book,
// in a raised, rounded panel lit by the Book's own cover (UiLitCard, shared with Your reviews on the Profile; a
// Book on the Placeholder is lit by its cloth, as the book page is). The cover at the left; at the right her avatar and name ("Anna finished"), the title
// in the serif, her stars when she shows them, and her review in the serif italic folded at three
// lines, `More` unfolding it, as the feed's rows do. The cover and the title open the Book, the cover
// flying there as everywhere else (UiPressLink); a Manual book opens nothing, a follower cannot read
// it. Her avatar and name open her page (`/friends/<member>`). The title is written beside the cover,
// so the cover is decorative. Drawing only: utils/friendsView.ts picks the card.
//
// Props: `card` (FriendsCard), `eager` (the cover loads now). Test ids: `home.friendsFeature` (the panel),
// `home.friendsFeature.member`, `.cover`, `.title`, `.review`, `.more`, `.wantToRead`, `.like` (the heart, under Want to read in the
// icon column at the card's right edge, centred on the cover; `.like.error` when a like was refused), `.folded` (a review flagged as spoilers, folded behind *Show anyway*).
import type { FriendsCard } from '~/utils/friendsView'
import { useBookStore } from '~/stores/book'
import { likeable } from '~/utils/likes'

const props = defineProps<{ card: FriendsCard; eager?: boolean }>()

const { t } = useI18n()
const books = useBookStore()

const name = computed(() => props.card.member.name?.trim() || t('member.someone'))
const verb = computed(() => t(`feed.${props.card.verb}`))
const book = computed(() => shownBook(props.card.book, t('book.outsideCatalogue')))
const bookPath = computed(() => `/book/${book.value.id}`)
const showHeart = computed(() => likeable(props.card))
// Want to read: not on a Manual book (the control says nothing for one).
const showWant = computed(() => !book.value.manual)

// The review: three lines, and `More` only when there is more than three lines of it.
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
  <UiLitCard v-slot="{ onFallback }" :colors="book.coverColors" :title="book.title" class="flex items-start gap-ml p-inset" data-testid="home.friendsFeature">

    <UiPressLink
      v-if="!book.manual && !book.unverified"
      :to="bookPath"
      class="relative shrink-0"
      tabindex="-1"
      aria-hidden="true"
      data-testid="home.friendsFeature.cover"
      @press="books.prefetch(book.id)"
    >
      <UiCover decorative :title="book.title" :authors="book.authors" :src="coverSrc(book.coverUrl, 'lg')" :thumbhash="book.coverThumbhash" :colors="book.coverColors" size="lg" glow :eager="eager" @fallback="onFallback" />
    </UiPressLink>
    <span v-else class="relative shrink-0">
      <UiCover decorative :title="book.title" :authors="book.authors" :src="coverSrc(book.coverUrl, 'lg')" :thumbhash="book.coverThumbhash" :colors="book.coverColors" size="lg" glow :eager="eager" @fallback="onFallback" />
    </span>

    <div class="relative flex min-w-0 flex-1 flex-col items-start gap-xs">
      <div class="flex min-w-0 flex-wrap items-center gap-x-sm gap-y-xxs text-subhead">
        <NuxtLink :to="`/friends/${card.member.id}`" class="reach flex min-w-0 items-center gap-sm" data-testid="home.friendsFeature.member">
          <FriendsAvatar :card="card.member" />
          <span class="truncate font-medium">{{ name }}</span>
        </NuxtLink>
        <span class="min-w-0 text-ink-muted">{{ verb }}</span>
      </div>

      <UiPressLink
        v-if="!book.manual && !book.unverified"
        :to="bookPath"
        class="reach book-title text-callout"
        data-testid="home.friendsFeature.title"
        @press="books.prefetch(book.id)"
      >{{ book.title }}</UiPressLink>
      <span v-else class="book-title text-callout" data-testid="home.friendsFeature.title">{{ book.title }}</span>

      <UiStars v-if="card.rating" :quarters="card.rating" data-testid="home.friendsFeature.stars" />

      <FriendsLikeError v-if="showHeart" :row="card" testid="home.friendsFeature.like" />

      <FriendsReviewFold v-if="card.review" :folded="card.folded" :name="name" testid="home.friendsFeature.folded">
        <p ref="review" tabindex="-1" class="book-title text-subhead text-ink-muted italic" :class="!expanded && 'line-clamp-3'" data-testid="home.friendsFeature.review">{{ card.review }}</p>
        <button
          v-if="clamped && !expanded"
          type="button"
          class="-mt-xs -mb-sm min-h-(--size-touch) text-caption text-ink-faint hover:text-ink-muted"
          data-testid="home.friendsFeature.more"
          @click="unfold"
        >{{ t('feed.more') }}</button>
      </FriendsReviewFold>
    </div>

    <!-- At the card's right edge, centred on its cover (the same column as the rows': Want to read on top, the heart under it). -->
    <FriendsRowActions
      class="relative"
      cover="lg"
      :book="showWant ? book : null"
      :like="showHeart ? card : null"
      :name="name"
      :owner="card.member.id"
      :title="book.title"
      want-testid="home.friendsFeature.wantToRead"
      like-testid="home.friendsFeature.like"
    />
  </UiLitCard>
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
