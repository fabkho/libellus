<script setup lang="ts">
// The quarter-star Rating control, shown mid-drag: the value set large as a
// figure with its fraction ("3¾") and in words, five stars filling under the
// finger, and a measuring rule beneath with a tick for every quarter. The
// thumb rides the rule; a hairline carries its position up through the stars.
import { computed } from 'vue'
import Stars from './Stars.vue'
import { fractionRating, ratingWords } from './type'

const props = withDefaults(defineProps<{ rating: number; dragging?: boolean; size?: number; gap?: number }>(), {
  size: 40,
  gap: 12,
})

const width = computed(() => 5 * props.size + 4 * props.gap)
// The star path spans 2.2–21.8 of its 24-unit box: map quarters onto that span.
const inset = computed(() => (2.2 / 24) * props.size)
const span = computed(() => (19.6 / 24) * props.size)
const at = (quarters: number) => {
  const whole = Math.min(4, Math.floor(quarters / 4))
  const part = quarters - whole * 4
  return whole * (props.size + props.gap) + inset.value + (part / 4) * span.value
}
const ticks = computed(() =>
  Array.from({ length: 5 }, (_, star) =>
    [0, 1, 2, 3, 4].map((q) => ({ x: at(star * 4 + q), major: q === 0 || q === 4, key: `${star}-${q}` })),
  ).flat(),
)
const thumb = computed(() => at(props.rating))
</script>

<template>
  <div class="control">
    <div class="readout">
      <span class="figure b-display">{{ fractionRating(rating) }}</span>
      <span class="words b-italic">{{ ratingWords(rating) }} stars</span>
    </div>

    <div class="track" :style="{ width: `${width}px` }">
      <Stars :rating="rating" :size="size" :gap="gap" />
      <svg class="rule" :width="width" height="16" :viewBox="`0 0 ${width} 16`" aria-hidden="true">
        <line :x1="inset" y1="0.5" :x2="at(20)" y2="0.5" />
        <line
          v-for="tick in ticks"
          :key="tick.key"
          :x1="tick.x"
          :x2="tick.x"
          y1="0.5"
          :y2="tick.major ? 9 : 5"
          :class="{ major: tick.major }"
        />
      </svg>
      <template v-if="dragging">
        <span class="needle" :style="{ left: `${thumb}px` }" />
        <span class="thumb" :style="{ left: `${thumb}px` }" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.control {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.readout {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 12px;
}

.figure {
  --size: 64;
  color: var(--b-accent);
  line-height: 0.9;
}

.words {
  margin-top: 2px;
  font-size: 14px;
  line-height: 20px;
  color: var(--b-ink-2);
}

.track {
  position: relative;
  padding-bottom: 4px;
}

.rule {
  display: block;
  margin-top: 8px;
  overflow: visible;
}

.rule line {
  stroke: var(--b-ink-3);
  stroke-width: 1;
}

.rule line.major {
  stroke: var(--b-ink);
}

.needle {
  position: absolute;
  top: -6px;
  bottom: 14px;
  width: 0;
  border-left: 1px solid var(--b-accent);
}

.thumb {
  position: absolute;
  top: calc(100% - 22px);
  width: 24px;
  height: 24px;
  border: 1.5px solid var(--b-ink);
  border-radius: 50%;
  background: var(--b-paper);
  transform: translateX(-50%);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
}

.thumb::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--b-accent);
  transform: translate(-50%, -50%);
}
</style>
