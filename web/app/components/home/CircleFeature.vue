<script setup lang="ts">
// The card of Home's Your circle (social v1, U8; the "Lit feature" mock): the week's one finished Book,
// in a raised, rounded panel lit by the Book's own cover (`UiAmbient`, the light a year card has on
// the Profile; a Book on the Placeholder is lit by its cloth, as the book page is). The cover at the left; at the right her avatar and name ("Anna finished"), the title
// in the serif, her stars when she shows them, and her review in the serif italic folded at three
// lines, `More` unfolding it, as the feed's rows do. The cover and the title open the Book, the cover
// flying there as everywhere else (UiPressLink); a Manual book opens nothing, a follower cannot read
// it. Her avatar and name open her page (`/friends/<member>`). The title is written beside the cover,
// so the cover is decorative. Drawing only: utils/circleView.ts picks the card.
//
// Props: `card` (CircleCard), `eager` (the cover loads now). Test ids: `home.circleFeature` (the panel),
// `home.circleFeature.member`, `.cover`, `.title`, `.review`, `.more`.
import type { CircleCard } from '~/utils/circleView'
import { useBookStore } from '~/stores/book'

const props = defineProps<{ card: CircleCard; eager?: boolean }>()

const { t } = useI18n()
const books = useBookStore()

const name = computed(() => props.card.member.name?.trim() || t('member.someone'))
const verb = computed(() => t(`feed.${props.card.verb}`))
const book = computed(() => props.card.book)
const bookPath = computed(() => `/book/${book.value.id}`)
// A Book without a cover shows the Placeholder: the cloth's colour lights the card then (as the book page's hero is lit).
const coverFallback = ref(false)
const clothColor = computed(() => `var(--color-cloth${clothOf(book.value.title)})`)

// The review: three lines, and `More` only when there is more than three lines of it.
const review = useTemplateRef<HTMLElement>('review')
const expanded = ref(false)
const clamped = ref(false)
function measure() {
  const el = review.value
  if (el && !expanded.value) clamped.value = el.scrollHeight > el.clientHeight + 1
}
let observer: ResizeObserver | null = null
onMounted(() => {
  measure()
  if (review.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(review.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())

/** More goes away once it is pressed: focus moves to the review it opened, so it is not lost (a11y). */
async function unfold() {
  expanded.value = true
  await nextTick()
  review.value?.focus()
}
</script>

<template>
  <div class="relative flex items-start gap-ml overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" data-testid="home.circleFeature">
    <UiAmbient :colors="book.coverColors" :cloth="coverFallback ? clothColor : null" shape="card" />

    <UiPressLink
      v-if="!book.manual"
      :to="bookPath"
      class="relative shrink-0"
      tabindex="-1"
      aria-hidden="true"
      data-testid="home.circleFeature.cover"
      @press="books.prefetch(book.id)"
    >
      <UiCover decorative :title="book.title" :authors="book.authors" :src="coverSrc(book.coverUrl, 'lg')" :thumbhash="book.coverThumbhash" :colors="book.coverColors" size="lg" glow :eager="eager" @fallback="coverFallback = $event" />
    </UiPressLink>
    <span v-else class="relative shrink-0">
      <UiCover decorative :title="book.title" :authors="book.authors" :src="coverSrc(book.coverUrl, 'lg')" :thumbhash="book.coverThumbhash" :colors="book.coverColors" size="lg" glow :eager="eager" @fallback="coverFallback = $event" />
    </span>

    <div class="relative flex min-w-0 flex-1 flex-col items-start gap-xs">
      <div class="flex min-w-0 flex-wrap items-center gap-x-sm gap-y-xxs text-subhead">
        <NuxtLink :to="`/friends/${card.member.id}`" class="reach flex min-w-0 items-center gap-sm" data-testid="home.circleFeature.member">
          <FriendsAvatar :card="card.member" />
          <span class="truncate font-medium">{{ name }}</span>
        </NuxtLink>
        <span class="min-w-0 text-ink-muted">{{ verb }}</span>
      </div>

      <UiPressLink
        v-if="!book.manual"
        :to="bookPath"
        class="reach book-title text-callout"
        data-testid="home.circleFeature.title"
        @press="books.prefetch(book.id)"
      >{{ book.title }}</UiPressLink>
      <span v-else class="book-title text-callout" data-testid="home.circleFeature.title">{{ book.title }}</span>

      <UiStars v-if="card.rating" :quarters="card.rating" data-testid="home.circleFeature.stars" />

      <template v-if="card.review">
        <p ref="review" tabindex="-1" class="book-title text-subhead text-ink-muted italic" :class="!expanded && 'line-clamp-3'" data-testid="home.circleFeature.review">{{ card.review }}</p>
        <button
          v-if="clamped && !expanded"
          type="button"
          class="-mt-xs -mb-sm min-h-(--size-touch) text-caption text-ink-faint hover:text-ink-muted"
          data-testid="home.circleFeature.more"
          @click="unfold"
        >{{ t('feed.more') }}</button>
      </template>
    </div>
  </div>
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
