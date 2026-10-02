<script setup lang="ts">
// A Rating set as type first: the figure with a vulgar fraction ("3¾") in the
// display face, then the stars small beside it. Unrated reads "Not rated".
import { formatRating } from '../../../data'
import Stars from './Stars.vue'
import { fractionRating } from './type'

withDefaults(
  defineProps<{
    rating: number | null
    /** Display size of the figure in px. */
    size?: number
    stars?: number
    /** Hide the stars, figure only (dense lists). */
    figureOnly?: boolean
  }>(),
  { size: 22, stars: 11 },
)
</script>

<template>
  <span v-if="rating" class="rating" :aria-label="`${formatRating(rating)} of 5 stars`">
    <span class="figure b-display" :style="{ '--size': size }">{{ fractionRating(rating) }}</span>
    <Stars v-if="!figureOnly" :rating="rating" :size="stars" :gap="1" />
  </span>
  <span v-else class="unrated">Not rated</span>
</template>

<style scoped>
.rating {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  white-space: nowrap;
}

.figure {
  color: var(--b-ink);
  line-height: 1;
}

.rating :deep(.stars) {
  transform: translateY(-1px);
}

.unrated {
  font-size: 14px;
  font-style: italic;
  line-height: 20px;
  color: var(--b-ink-3);
}
</style>
