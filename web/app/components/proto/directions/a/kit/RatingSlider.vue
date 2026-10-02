<script setup lang="ts">
// The Rating control of the finish sheet, drawn mid-drag: five large stars
// filled to the finger, a thumb on the track, quarter ticks underneath, and the
// value large above, so 3.75 reads at a glance while the finger covers a star.
import { computed } from 'vue'
import { formatRating } from '../../../data'

const props = withDefaults(defineProps<{ rating: number; dragging?: boolean; size?: number; gap?: number }>(), {
  dragging: true,
  size: 46,
  gap: 8,
})

const fills = computed(() => [0, 1, 2, 3, 4].map((i) => Math.min(1, Math.max(0, (props.rating - i * 4) / 4))))
const width = computed(() => props.size * 5 + props.gap * 4)
/** The finger's x on the track: inside the star it is filling, not across gaps. */
const thumbX = computed(() => {
  const whole = Math.floor(props.rating / 4)
  const part = (props.rating % 4) / 4
  return whole * (props.size + props.gap) + part * props.size
})
const ticks = computed(() =>
  Array.from({ length: 21 }, (_, q) => {
    const whole = Math.floor(q / 4)
    const part = (q % 4) / 4
    const x = q === 20 ? width.value : whole * (props.size + props.gap) + part * props.size
    return { q, x, major: q % 4 === 0 }
  }),
)
const words: Record<number, string> = { 1: 'Poor', 2: 'Meh', 3: 'Good', 4: 'Great', 5: 'Loved it' }
const word = computed(() => words[Math.round(props.rating / 4)] ?? '')
const star = 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.1l-5.7 3.2 1.2-6.4-4.7-4.4 6.4-.8z'
</script>

<template>
  <div class="rating" :style="{ '--w': `${width}px` }">
    <div class="readout">
      <span class="value a-serif a-num">{{ formatRating(rating) }}</span>
      <span class="of">/ 5 · {{ word }}</span>
    </div>

    <div class="track" :style="{ width: `${width}px` }">
      <div class="stars" :style="{ gap: `${gap}px` }">
        <span v-for="(fill, i) in fills" :key="i" class="star" :style="{ width: `${size}px`, height: `${size}px` }">
          <svg :width="size" :height="size" viewBox="0 0 24 24" class="empty"><path :d="star" /></svg>
          <span class="clip" :style="{ width: `${fill * 100}%` }">
            <svg :width="size" :height="size" viewBox="0 0 24 24" class="full"><path :d="star" /></svg>
          </span>
        </span>
      </div>

      <svg class="ticks" :width="width" height="10" :viewBox="`0 0 ${width} 10`" aria-hidden="true">
        <line
          v-for="tick in ticks"
          :key="tick.q"
          :x1="tick.x"
          :x2="tick.x"
          y1="1"
          :y2="tick.major ? 9 : 5"
          :class="{ major: tick.major, passed: tick.q <= rating }"
        />
      </svg>

      <template v-if="dragging">
        <span class="thumb-line" :style="{ left: `${thumbX}px` }" />
        <span class="thumb" :style="{ left: `${thumbX}px` }" />
      </template>
    </div>
    <p class="hint">Slide across the stars · quarter steps · optional</p>
  </div>
</template>

<style scoped>
.rating {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.readout {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.value {
  font-size: 46px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: -0.02em;
}

.of {
  color: var(--a-ink-2);
  font-size: 15px;
  font-weight: 500;
}

.track {
  position: relative;
  margin-top: 14px;
}

.stars {
  display: flex;
}

.star {
  position: relative;
  line-height: 0;
}

.clip {
  position: absolute;
  inset: 0 auto 0 0;
  overflow: hidden;
}

.empty path {
  fill: var(--a-star-empty);
}

.full path {
  fill: var(--a-star);
  stroke: var(--a-star);
  stroke-width: 1.2;
  stroke-linejoin: round;
}

.ticks {
  display: block;
  margin-top: 8px;
  overflow: visible;
}

.ticks line {
  stroke: var(--a-ink-3);
  stroke-width: 1;
  stroke-linecap: round;
  opacity: 0.55;
}

.ticks line.major {
  stroke-width: 1.4;
  opacity: 0.9;
}

.ticks line.passed {
  stroke: var(--a-star);
  opacity: 1;
}

.thumb-line {
  position: absolute;
  top: -6px;
  bottom: 4px;
  width: 2px;
  margin-left: -1px;
  border-radius: 2px;
  background: var(--a-ink);
  opacity: 0.85;
}

.thumb {
  position: absolute;
  bottom: -8px;
  width: 26px;
  height: 26px;
  margin-left: -13px;
  border-radius: 999px;
  background: #fff;
  box-shadow:
    0 0 0 0.5px rgb(0 0 0 / 0.08),
    0 3px 10px rgb(40 30 15 / 0.25),
    0 1px 2px rgb(40 30 15 / 0.15);
}

.hint {
  margin: 18px 0 0;
  color: var(--a-ink-3);
  font-size: 12.5px;
}
</style>
