<script setup lang="ts">
// Five slender stars filled to a quarter-star Rating (quarters 1–20): accent
// ink for the filled part, a hairline outline for the rest.
import { computed, useId } from 'vue'

const props = withDefaults(defineProps<{ rating: number | null; size?: number; gap?: number }>(), { size: 13, gap: 2 })

const id = useId()
const fills = computed(() => [0, 1, 2, 3, 4].map((i) => Math.min(1, Math.max(0, ((props.rating ?? 0) - i * 4) / 4))))
// A narrower, sharper star than the usual rounded one: engraved, not cartoon.
const star = 'M12 2.2l2.55 6.95 7.25.3-5.7 4.55 1.98 7.1L12 17.05 5.92 21.1l1.98-7.1-5.7-4.55 7.25-.3z'
</script>

<template>
  <span class="stars" :style="{ gap: `${gap}px` }" aria-hidden="true">
    <svg v-for="(fill, i) in fills" :key="i" :width="size" :height="size" viewBox="0 0 24 24">
      <defs>
        <clipPath :id="`${id}-${i}`"><rect x="0" y="0" :width="2.2 + 19.6 * fill" height="24" /></clipPath>
      </defs>
      <path :d="star" class="empty" />
      <path v-if="fill > 0" :d="star" class="full" :clip-path="`url(#${id}-${i})`" />
    </svg>
  </span>
</template>

<style scoped>
.stars {
  display: inline-flex;
  align-items: center;
}

svg {
  display: block;
  overflow: visible;
}

.empty {
  fill: none;
  stroke: var(--b-ink-3);
  stroke-width: 1.1;
  stroke-linejoin: miter;
}

.full {
  fill: var(--b-accent);
  stroke: var(--b-accent);
  stroke-width: 1.1;
  stroke-linejoin: miter;
}
</style>
