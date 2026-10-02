<script setup lang="ts">
// Five soft rounded stars filled to a quarter-star Rating (quarters 1–20),
// with the number beside them so 3.75 never has to be guessed from a sliver.
// `dragging` turns it into the finish sheet's control mid-drag: a ruler of
// quarter ticks under the stars, the thumb under the finger, a value tag.
import { computed, useId } from 'vue'
import { formatRating } from '../../../data'

const props = withDefaults(
  defineProps<{ rating: number | null; size?: number; gap?: number; value?: boolean; dragging?: boolean }>(),
  { size: 14, gap: 2, value: true, dragging: false },
)

const uid = `c-star-${useId()}`
const fills = computed(() => [0, 1, 2, 3, 4].map((i) => Math.min(1, Math.max(0, ((props.rating ?? 0) - i * 4) / 4))))
const total = computed(() => props.size * 5 + props.gap * 4)
/** x of the rating on the row of stars, gaps skipped. */
const at = computed(() => {
  const stars = (props.rating ?? 0) / 4
  const whole = Math.floor(stars)
  const part = stars - whole
  return whole * (props.size + props.gap) + part * props.size - (part === 0 && whole > 0 ? props.gap : 0)
})
const ticks = computed(() =>
  Array.from({ length: 21 }, (_, q) => {
    const whole = Math.floor(q / 4)
    const part = (q % 4) / 4
    const x = whole * (props.size + props.gap) + part * props.size - (part === 0 && whole > 0 ? props.gap / 2 : 0)
    return { q, x, major: q % 4 === 0 }
  }),
)
const star =
  'M12 3.2c.4 0 .8.2 1 .6l2.2 4.6 5 .7c.9.1 1.3 1.2.6 1.9l-3.6 3.5.9 5c.2.9-.8 1.6-1.6 1.2L12 18.3l-4.5 2.4c-.8.4-1.8-.3-1.6-1.2l.9-5-3.6-3.5c-.7-.7-.3-1.8.6-1.9l5-.7L11 3.8c.2-.4.6-.6 1-.6z'
</script>

<template>
  <span class="stars" :class="{ dragging }" :aria-label="`${formatRating(rating)} stars`">
    <span class="row" :style="{ gap: `${gap}px` }">
      <svg v-for="(fill, i) in fills" :key="i" :width="size" :height="size" viewBox="0 0 24 24" class="star">
        <defs>
          <clipPath :id="`${uid}-${i}`"><rect x="0" y="0" :width="24 * fill" height="24" /></clipPath>
        </defs>
        <path :d="star" class="empty" />
        <path :d="star" class="full" :clip-path="`url(#${uid}-${i})`" />
      </svg>
    </span>
    <span v-if="value && !dragging && rating" class="value" :style="{ fontSize: `${Math.max(11, size * 0.86)}px` }">{{
      formatRating(rating)
    }}</span>

    <template v-if="dragging">
      <span class="ruler" :style="{ width: `${total}px` }">
        <span
          v-for="tick in ticks"
          :key="tick.q"
          class="tick"
          :class="{ major: tick.major, on: tick.q <= (rating ?? 0) }"
          :style="{ left: `${tick.x}px` }"
        />
      </span>
      <span class="thumb" :style="{ left: `${at}px` }" />
      <span class="tag" :style="{ left: `${at}px` }">
        <svg width="13" height="13" viewBox="0 0 24 24"><path :d="star" fill="currentColor" /></svg>
        {{ formatRating(rating) }}
      </span>
    </template>
  </span>
</template>

<style scoped>
.stars {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.row {
  display: inline-flex;
}

.star {
  display: block;
  overflow: visible;
}

.empty {
  fill: var(--c1-line-strong);
}

.full {
  fill: var(--c1-mustard);
}

.value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  color: var(--c1-ink);
}

/* --- Mid-drag -------------------------------------------------------- */

.dragging {
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
}



.ruler {
  position: relative;
  display: block;
  height: 14px;
  margin-top: 10px;
  border-top: 2px solid var(--c1-line-strong);
}

.tick {
  position: absolute;
  top: 0;
  width: 2px;
  height: 5px;
  margin-left: -1px;
  border-radius: 0 0 1px 1px;
  background: var(--c1-line-strong);
}

.tick.major {
  height: 10px;
}

.tick.on {
  background: var(--c1-ink-soft);
}

.thumb {
  position: absolute;
  bottom: -4px;
  width: 26px;
  height: 26px;
  margin-left: -13px;
  border-radius: 50%;
  background: var(--c1-card);
  border: 3px solid var(--c1-ink);
  box-shadow: 0 6px 12px -2px rgb(var(--c1-shadow) / 0.35);
}

.tag {
  position: absolute;
  top: -42px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 30px;
  padding: 0 10px 0 8px;
  border-radius: 10px;
  background: var(--c1-ink);
  color: var(--c1-paper);
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  transform: translateX(-50%) rotate(-3deg);
  box-shadow: 0 6px 14px -4px rgb(var(--c1-shadow) / 0.45);
}

.tag svg {
  color: var(--c1-mustard);
}

.tag::after {
  content: '';
  position: absolute;
  bottom: -5px;
  left: 50%;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border-radius: 2px;
  background: var(--c1-ink);
  transform: rotate(45deg);
  z-index: -1;
}
</style>
