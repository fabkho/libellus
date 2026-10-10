<script setup lang="ts">
// Your reviews, on the own Profile (social v2a, owner's request: "there's no place where I can see all my reviews"):
// her newest three reads that have a review (utils/profileReviews.ts: from her Library on the device, so it is
// there offline), each a row (ProfileReviewRow), and *See all {count}* at the right of the eyebrow, as a member's
// Recently finished has it, once she has more than three; it opens the sheet with all of them. No reviews: no
// section (it closes smoothly when the last one goes). Test ids: `profile.reviews` (the section),
// `profile.reviews.row`, `profile.reviews.all`; the sheet is `profileReviews`.
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
    <section class="flex flex-col pb-xl" data-testid="profile.reviews">
      <div class="mb-xs flex h-(--size-button-sm) items-center justify-between gap-md">
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
      <ul class="flex flex-col">
        <li v-for="item in shown" :key="item.id" class="row">
          <ProfileReviewRow :item="item" />
        </li>
      </ul>
      <ProfileReviewsSheet v-model:open="open" :items="reviews" />
    </section>
  </UiReveal>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
