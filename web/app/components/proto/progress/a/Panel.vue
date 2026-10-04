<script setup lang="ts">
// Direction A on the book page: the same scrubber at full width with its
// tenths always drawn, the page large over it (the lamp colour while it
// moves), − and + either side for a single page (hold to run), and under it
// how far, how much is left and — from the last two weeks — about how long.
// Pages or percent is only how the number reads; "of 608" opens the page
// count (#60), a book without one offers to add it.
import {
  daysLeftOf,
  daysWords,
  haptic,
  leftWords,
  maxOf,
  n,
  percentOf,
  positionOf,
  setPosition,
  totalOf,
  useHoldRepeat,
  usesPages,
  type ProtoRead,
} from '../model'

const props = defineProps<{ read: ProtoRead; demo?: number | null }>()
const emit = defineEmits<{ total: [] }>()

const live = ref<number | null>(null)
const mode = ref<'page' | 'percent'>('page')
const shown = computed(() => live.value ?? props.demo ?? positionOf(props.read))
const pages = computed(() => usesPages(props.read))
const showPercent = computed(() => !pages.value || mode.value === 'percent')
const big = computed(() => (showPercent.value ? String(percentOf(props.read, shown.value)) : n(shown.value)))
const atEnd = computed(() => shown.value >= maxOf(props.read))
const days = computed(() => daysLeftOf(props.read))
const moving = computed(() => live.value !== null || props.demo != null)
const gain = computed(() => (showPercent.value ? percentOf(props.read, shown.value) - percentOf(props.read) : shown.value - positionOf(props.read)))

function nudge(by: number) {
  const at = positionOf(props.read)
  // In percent, a step is a whole percent of the book.
  const unit = showPercent.value && pages.value ? maxOf(props.read) / 100 : 1
  const to = Math.min(Math.max(Math.round(at + by * unit), 0), maxOf(props.read))
  if (to === at) return haptic('edge', { fromClick: true })
  setPosition(props.read, to)
  haptic(to === maxOf(props.read) ? 'edge' : 'tick', { fromClick: true })
}
const minus = useHoldRepeat((times) => nudge(-times))
const plus = useHoldRepeat((times) => nudge(times))
</script>

<template>
  <div class="mb-ml" data-testid="a.panel">
    <div class="flex items-end justify-center gap-sm">
      <span class="figures text-figure transition-colors duration-(--duration-quick)" :class="moving || atEnd ? 'text-accent' : 'text-ink'" data-testid="a.big">
        {{ big }}<span v-if="showPercent" class="text-title"> %</span>
      </span>
      <button
        v-if="pages && !showPercent"
        type="button"
        class="total figures mb-xs text-subhead text-ink-faint"
        data-testid="a.total"
        @click="emit('total')"
      >
        of {{ n(totalOf(read)!) }}
      </button>
      <span v-if="moving && gain" class="figures mb-sm text-meta text-accent" data-testid="a.gain">{{ gain > 0 ? '+' : '−' }}{{ n(Math.abs(gain)) }}</span>
    </div>
    <div class="mt-xs flex justify-center">
      <button v-if="!pages" type="button" class="total text-caption text-ink-faint" data-testid="a.addTotal" @click="emit('total')">
        Add page count
      </button>
      <span v-else-if="read.total" class="eyebrow">your copy · {{ read.book.format === 'ebook' ? 'ebook' : 'own count' }}</span>
    </div>

    <div class="mt-sm flex items-center gap-xs">
      <button
        type="button"
        class="nudge"
        aria-label="One page back"
        data-testid="a.minus"
        @pointerdown="minus.start"
        @pointerup="minus.stop"
        @pointerleave="minus.stop"
        @pointercancel="minus.stop"
      >
        <span class="minus" aria-hidden="true" />
      </button>
      <ProtoProgressAScrub class="flex-1" :read="read" size="page" :demo="demo" @commit="(_, to) => setPosition(read, to)" @live="live = $event" />
      <button
        type="button"
        class="nudge"
        aria-label="One page on"
        data-testid="a.plus"
        @pointerdown="plus.start"
        @pointerup="plus.stop"
        @pointerleave="plus.stop"
        @pointercancel="plus.stop"
      >
        <UiIcon name="plus" :size="16" />
      </button>
    </div>

    <div class="mt-sm flex items-center justify-between gap-ms">
      <p class="figures text-meta text-ink-faint">
        <template v-if="atEnd"><span class="text-accent">The last page. Finished it?</span></template>
        <template v-else>
          {{ showPercent && pages ? `p. ${n(shown)}` : pages ? `${percentOf(read, shown)} %` : '' }}{{ pages ? ' · ' : '' }}{{ leftWords(read, shown) }}<template v-if="days"> · {{ daysWords(days) }}</template>
        </template>
      </p>
      <div v-if="pages" role="group" aria-label="Count by" class="flex shrink-0">
        <button
          v-for="m in (['page', 'percent'] as const)"
          :key="m"
          type="button"
          :aria-pressed="mode === m"
          class="seg figures text-meta"
          :class="mode === m ? 'text-ink' : 'text-ink-ghost'"
          :data-testid="`a.mode.${m}`"
          @click="mode = m"
        >
          {{ m === 'page' ? 'p.' : '%' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.total {
  min-height: var(--size-touch);
  margin-block: calc((var(--size-touch) - 1lh) / -2);
  text-decoration: underline dotted var(--color-ink-ghost);
  text-underline-offset: var(--spacing-xs);
}
.nudge {
  display: flex;
  width: var(--size-touch);
  height: var(--size-touch);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-pill);
  color: var(--color-ink-muted);
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}
.nudge:active {
  background: var(--color-fill);
}
.minus {
  width: var(--spacing-ms);
  height: var(--stroke-icon);
  border-radius: var(--radius-pill);
  background: currentColor;
}
.seg {
  min-width: var(--size-touch);
  min-height: var(--size-touch);
  margin-block: calc((var(--size-touch) - 1lh) / -2);
}
</style>
