<script setup lang="ts">
// A quarter-star Rating: five stars filled to the quarter in lamp amber, with
// the exact value beside them in tabular figures ("3.75"), so a quarter never
// has to be guessed from a sliver of star.
import { computed } from 'vue'
import { ratingText } from './night'

const props = withDefaults(
  defineProps<{ rating: number | null; size?: number; gap?: number; value?: boolean; valueSize?: number }>(),
  { size: 12, gap: 2, value: true, valueSize: 0 },
)

/**
 * Width of each star's fill, in % of its box. Mapped onto the star's own
 * extent (x 3.4–20.6 of 24), so a quarter star shows a quarter of the shape.
 */
const fills = computed(() =>
  [0, 1, 2, 3, 4].map((i) => {
    const f = Math.min(1, Math.max(0, ((props.rating ?? 0) - i * 4) / 4))
    return f === 0 ? 0 : f === 1 ? 1 : (3.4 + 17.2 * f) / 24
  }),
)
const star = 'M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.4-4.1 6-.7z'
</script>

<template>
  <span class="k-stars" :aria-label="`${ratingText(rating)} of 5 stars`">
    <span class="row" :style="{ gap: `${gap}px` }">
      <span v-for="(fill, i) in fills" :key="i" class="star" :style="{ width: `${size}px`, height: `${size}px` }">
        <svg :width="size" :height="size" viewBox="0 0 24 24" class="empty">
          <path :d="star" fill="currentColor" />
        </svg>
        <span class="fill" :style="{ width: `${fill * 100}%` }">
          <svg :width="size" :height="size" viewBox="0 0 24 24">
            <path :d="star" fill="currentColor" />
          </svg>
        </span>
      </span>
    </span>
    <span v-if="value" class="value dl-mono" :style="valueSize ? { fontSize: `${valueSize}px` } : undefined">{{
      ratingText(rating)
    }}</span>
  </span>
</template>

<style scoped>
.k-stars {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  line-height: 1;
}

.row {
  display: inline-flex;
}

.star {
  position: relative;
  display: inline-block;
}

.empty {
  display: block;
  color: var(--dl-ink-4);
}

.fill {
  position: absolute;
  inset: 0 auto 0 0;
  overflow: hidden;
  color: var(--dl-lamp);
}

.fill svg {
  display: block;
}

.value {
  font-size: 11px;
  font-weight: 500;
  color: var(--dl-ink-2);
}
</style>
