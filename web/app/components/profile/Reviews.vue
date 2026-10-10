<script setup lang="ts">
// Your reviews, on the own Profile (social v2a, owner's request: "there's no place where I can see all my reviews"),
// above the years in review: her reads that have a review (utils/profileReviews.ts: from her Library on the device,
// so it is there offline), newest first, as lit cards (ProfileReviewCard, the shape of Home's circle card) in a
// sideways row like the years' (no scroll bar, the next card peeking at the edge, snapping to the cards). The row
// holds the newest `REVIEWS_SHOWN` and, with more, ends on a *See all {count}* card: a row of every review would be
// as long as her history (and as many covers to draw), while a stop at the end of the row says that there is more
// and takes her to all of them. *See all {count}* is also a button at the right of the eyebrow, as a member's
// Recently finished has it, and *More* on a long review: all three open the sheet with every review as list rows.
// No reviews: no section (it closes smoothly when the last one goes). Test ids: `profile.reviews` (the section),
// `profile.reviews.row` (the sideways row), `profile.reviews.card`, `profile.reviews.all` (the button),
// `profile.reviews.allCard`; the sheet is `profileReviews`.
import { useLibraryStore } from '~/stores/library'
import { profileReviews, REVIEWS_SHOWN } from '~/utils/profileReviews'

const { t } = useI18n()
const { count } = useFigures()
const library = useLibraryStore()
const reviews = computed(() => profileReviews(library.finished))
const shown = computed(() => reviews.value.slice(0, REVIEWS_SHOWN))
const more = computed(() => reviews.value.length > REVIEWS_SHOWN)
const open = ref(false)
</script>

<template>
  <UiReveal :show="reviews.length > 0">
    <section class="flex flex-col gap-md pt-xl" data-testid="profile.reviews">
      <div class="flex h-(--size-button-sm) items-center justify-between gap-md">
        <h2 class="eyebrow">{{ t('profile.reviews.title') }}</h2>
        <UiButton
          v-if="more"
          tone="quiet"
          size="sm"
          :aria-label="t('profile.reviews.allLabel', { count: count(reviews.length) })"
          data-testid="profile.reviews.all"
          @click="open = true"
        >
          <span class="figures">{{ t('profile.reviews.all', { count: count(reviews.length) }) }}</span><UiIcon name="chevron" :size="13" />
        </UiButton>
      </div>
      <ul class="scrollbar-none -mx-screen flex snap-x snap-proximity scroll-px-screen gap-ms overflow-x-auto px-screen pb-md" data-testid="profile.reviews.row">
        <li v-for="(item, index) in shown" :key="item.id" class="flex snap-start">
          <ProfileReviewCard :item="item" :eager="index < 2" @more="open = true" />
        </li>
        <li v-if="more" class="flex snap-start">
          <button
            type="button"
            class="all flex flex-col items-start justify-end gap-xs rounded-lg bg-surface-raised p-inset text-left shadow-raised edge-faint active:opacity-80"
            :aria-label="t('profile.reviews.allLabel', { count: count(reviews.length) })"
            data-testid="profile.reviews.allCard"
            @click="open = true"
          >
            <span class="text-figure tabular-nums">{{ count(reviews.length) }}</span>
            <span class="flex items-center gap-xs text-subhead text-ink-muted">{{ t('profile.reviews.allCard') }}<UiIcon name="chevron" :size="13" /></span>
          </button>
        </li>
      </ul>
      <ProfileReviewsSheet v-model:open="open" :items="reviews" />
    </section>
  </UiReveal>
</template>

<style scoped>
/* The last card: as tall as the cards beside it, a year card's width. */
.all {
  width: var(--size-cover-xl);
}
</style>
