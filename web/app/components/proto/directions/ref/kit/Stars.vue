<script setup lang="ts">
// Five stars filled to a quarter-star Rating (quarters 1–20). `dragging` draws
// the thumb and value bubble of the rating control mid-drag.
import { computed } from 'vue'
import { formatRating } from '../../../data'

const props = defineProps<{ rating: number | null; size?: number; dragging?: boolean }>()

const size = computed(() => props.size ?? 14)
/** Fill of each star, 0–1. */
const fills = computed(() =>
  [0, 1, 2, 3, 4].map((i) => Math.min(1, Math.max(0, ((props.rating ?? 0) - i * 4) / 4))),
)
const star = 'M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z'
</script>

<template>
  <span class="relative inline-flex items-center gap-[2px]" :aria-label="`${formatRating(rating)} stars`">
    <svg v-for="(fill, i) in fills" :key="i" :width="size" :height="size" viewBox="0 0 24 24">
      <defs>
        <clipPath :id="`ref-star-${i}-${fill}`"><rect x="0" y="0" :width="24 * fill" height="24" /></clipPath>
      </defs>
      <path :d="star" fill="none" stroke="#a3a3a3" stroke-width="1.5" stroke-linejoin="round" />
      <path :d="star" fill="#525252" :clip-path="`url(#ref-star-${i}-${fill})`" />
    </svg>
    <template v-if="dragging">
      <!-- The finger's position on the track and the value it lands on. -->
      <span
        class="absolute top-1/2 size-[22px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-neutral-700 bg-white shadow"
        :style="{ left: `${((rating ?? 0) / 20) * 100}%` }"
      />
      <span
        class="absolute -top-8 -translate-x-1/2 rounded bg-neutral-800 px-2 py-[2px] text-[12px] font-semibold text-white"
        :style="{ left: `${((rating ?? 0) / 20) * 100}%` }"
        >{{ formatRating(rating) }}</span
      >
    </template>
  </span>
</template>
