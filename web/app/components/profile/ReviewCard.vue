<script setup lang="ts">
// One of her reviews as a lit card in Your reviews' sideways row (social v2a, owner's refinement): the raised panel
// lit by the Book's own cover (UiLitCard, as Home's circle card), the cover at the left (`md`, flying into the
// Book's page from the touch-down), at the right the title in the serif, her stars and the day, the quiet
// "Spoilers" tag when she flagged it, and her review in the serif italic folded at four lines. No avatar or name:
// it is hers, so never folded for spoilers. The cards of a row are as tall as the tallest, so *More* does not
// unfold in place (one card tall in a row of equals, and no vertical room in a sideways row): it asks for the sheet
// (`more`), which has every review whole. The cover and the title are the Book's links (the cover's is hidden from
// the keyboard and screen readers). Props: `item` (ProfileReview), `eager`. Emits `more`. Test ids: `<testid>` (the
// card, default `profile.reviews.card`), `.cover`, `.book`, `.title`, `.spoilers`, `.review`, `.more`.
import type { ProfileReview } from '~/utils/profileReviews'
import { useBookStore } from '~/stores/book'

const props = withDefaults(defineProps<{ item: ProfileReview; eager?: boolean; testid?: string }>(), { testid: 'profile.reviews.card' })
defineEmits<{ more: [] }>()

const { t } = useI18n()
const { formatDay } = useDays()
const books = useBookStore()
const book = computed(() => props.item.entry.book)
const path = computed(() => `/book/${book.value.id}`)

// Four lines, and *More* only when there is more of it.
const review = useTemplateRef<HTMLElement>('review')
const clamped = ref(false)
function measure() {
  const el = review.value
  if (el) clamped.value = el.scrollHeight > el.clientHeight + 1
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
</script>

<template>
  <UiLitCard v-slot="{ onFallback }" :colors="book.coverColors" :title="book.title" class="card flex items-start gap-ms p-inset" :data-testid="testid">
    <UiPressLink :to="path" class="relative shrink-0" tabindex="-1" aria-hidden="true" :data-testid="`${testid}.cover`" @press="books.prefetch(book.id)">
      <UiCover
        decorative
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'md')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        size="md"
        glow
        :eager="eager"
        @fallback="onFallback"
      />
    </UiPressLink>
    <div class="relative flex min-w-0 flex-1 flex-col items-start gap-xs">
      <UiPressLink :to="path" class="reach book-title line-clamp-2 min-w-0 text-callout break-words" :data-testid="`${testid}.book`" @press="books.prefetch(book.id)">
        <span :data-testid="`${testid}.title`">{{ book.title }}</span>
      </UiPressLink>
      <div class="figures flex flex-wrap items-center gap-x-sm gap-y-xxs text-meta whitespace-nowrap text-ink-faint">
        <UiStars v-if="item.rating" :quarters="item.rating" />
        <span v-if="item.endedOn">{{ formatDay(item.endedOn) }}</span>
        <span v-if="item.spoilers" :data-testid="`${testid}.spoilers`">{{ t('profile.reviews.spoilers') }}</span>
      </div>
      <p ref="review" class="book-title line-clamp-4 text-subhead whitespace-pre-line text-ink-muted italic" :data-testid="`${testid}.review`">{{ item.review }}</p>
      <button
        v-if="clamped"
        type="button"
        class="more -mt-xs text-caption font-medium text-accent-ink"
        :data-testid="`${testid}.more`"
        @click="$emit('more')"
      >{{ t('feed.more') }}</button>
    </div>
  </UiLitCard>
</template>

<style scoped>
/* The width of a card of the sideways row: a year card's rhythm, wider for the cover beside the words. */
.card {
  width: calc(var(--size-cover-xl) * 2.1);
  min-height: calc(var(--size-cover-xl) * 1.2);
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
.more {
  position: relative;
}
.more::after {
  position: absolute;
  inset: 50% calc(-1 * var(--spacing-sm)) auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
