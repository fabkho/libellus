<script setup lang="ts">
// Five stars filled to a quarter-star Rating (quarters 1–20), with the number
// next to them so 3.75 never has to be guessed from a sliver of gold.
import { computed } from 'vue'
import { formatRating } from '../../../data'

const props = withDefaults(
  defineProps<{ rating: number | null; size?: number; number?: boolean; gap?: number; tone?: 'gold' | 'ink' }>(),
  { size: 13, number: true, gap: 1.5, tone: 'gold' },
)

/** Fill of each star, 0–1. */
const fills = computed(() =>
  [0, 1, 2, 3, 4].map((i) => Math.min(1, Math.max(0, ((props.rating ?? 0) - i * 4) / 4))),
)
const label = computed(() => {
  const value = formatRating(props.rating)
  return value.includes('.') ? value : `${value}.0`
})
</script>

<template>
  <span class="stars" :class="`tone-${tone}`" :aria-label="`${formatRating(rating)} of 5 stars`">
    <span class="row" :style="{ gap: `${gap}px` }">
      <span v-for="(fill, i) in fills" :key="i" class="star" :style="{ width: `${size}px`, height: `${size}px` }">
        <svg :width="size" :height="size" viewBox="0 0 24 24" class="empty">
          <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.1l-5.7 3.2 1.2-6.4-4.7-4.4 6.4-.8z" />
        </svg>
        <span class="clip" :style="{ width: `${fill * 100}%` }">
          <svg :width="size" :height="size" viewBox="0 0 24 24" class="full">
            <path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.1l-5.7 3.2 1.2-6.4-4.7-4.4 6.4-.8z" />
          </svg>
        </span>
      </span>
    </span>
    <span v-if="number && rating" class="value ad-num" :style="{ fontSize: `${Math.max(11, size * 0.95)}px` }">{{
      label
    }}</span>
  </span>
</template>

<style scoped>
.stars {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.row {
  display: inline-flex;
}

.star {
  position: relative;
  display: inline-block;
  line-height: 0;
}

.clip {
  position: absolute;
  inset: 0 auto 0 0;
  overflow: hidden;
}

svg path {
  stroke-linejoin: round;
  stroke-width: 1.4;
}

.empty path {
  fill: var(--ad-star-empty);
}

.tone-gold .full path {
  fill: var(--ad-star);
  stroke: var(--ad-star);
}

.tone-ink .full path {
  fill: var(--ad-ink);
  stroke: var(--ad-ink);
}

.empty path {
  stroke: transparent;
}

.value {
  font-weight: 600;
  color: var(--ad-ink-2);
  line-height: 1;
}
</style>
