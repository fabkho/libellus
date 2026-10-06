<script setup lang="ts">
// A small column chart (issue #78): books per month of a year, or per year.
// One column per value, its count over it, its label under it; the `lit`
// column (this month, this year) in the lamp colour, the others ink, quiet.
// A column with books is a button (a month opens its books, a year its
// review); an empty one is a dot on the line. The chart is always the same
// height, whatever the counts: switching years only moves the bars, never
// what is under the chart.
//
// While the reading record loads (`columns` null) the chart stands at its
// height with `placeholders` quiet bars in the loading wave, each rising and
// falling a little after the one before it, and the labels' line kept empty
// (only the bars stand in); when the counts come, every bar grows from where
// the wave left it to its own height (docs/MOTION.md, Loading), and the
// counts and labels arrive over them.
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'

const props = withDefaults(
  defineProps<{
    columns: readonly { key: number; count: number; label: string; name: string }[] | null
    lit?: number | null
    testid: string
    /** How many bars the loading wave has: the guess at how many columns will come. */
    placeholders?: number
  }>(),
  { lit: null, placeholders: 12 },
)
defineEmits<{ pick: [key: number] }>()
const { t } = useI18n()
const { count } = useFigures()
const top = computed(() => Math.max(...(props.columns ?? []).map((c) => c.count), 1))
const loading = computed(() => props.columns === null)
const arriving = useArrival(() => loading.value)

const root = useTemplateRef<HTMLElement>('root')
const bars = () => [...(root.value?.querySelectorAll<HTMLElement>('.bar') ?? [])]
// The wave's bars as they stand the moment the counts come (before they are replaced)…
let waveHeights: number[] = []
watch(
  loading,
  (now, before) => {
    if (before && !now) waveHeights = bars().map((bar) => bar.getBoundingClientRect().height)
  },
  { flush: 'pre' },
)
// …and the real bars growing from there, one for one (a bar the wave did not have grows from the line).
watch(
  loading,
  (now, before) => {
    if (!before || now || prefersReducedMotion()) return
    const timing = { duration: durationToken('standard'), easing: easingToken('standard') }
    bars().forEach((bar, i) => {
      if (bar.classList.contains('none')) return
      const height = bar.getBoundingClientRect().height
      bar.animate([{ height: `${waveHeights[i] ?? 0}px` }, { height: `${height}px` }], timing)
    })
  },
  { flush: 'post' },
)
</script>

<template>
  <div ref="root" class="flex items-stretch gap-xs" :data-testid="testid">
    <template v-if="!columns">
      <span v-for="i in placeholders" :key="i" class="flex min-w-0 flex-1 flex-col items-center gap-xs py-xxs" aria-hidden="true">
        <span class="track flex w-full flex-col items-center justify-end gap-xs">
          <span />
          <span class="bar waving" :style="{ '--wave': ((i - 1) / placeholders) * 0.8 }" />
        </span>
        <span class="label" />
      </span>
    </template>
    <template v-else>
      <button
        v-for="column in columns"
        :key="column.key"
        type="button"
        class="column flex min-w-0 flex-1 flex-col items-center gap-xs rounded-sm py-xxs"
        :disabled="!column.count"
        :aria-label="t('profile.columnLabel', { label: column.name, count: count(column.count) })"
        :data-testid="`${testid}.${column.key}`"
        @click="$emit('pick', column.key)"
      >
        <!-- A fixed track: the count rides on top of its bar inside it. -->
        <span class="track flex w-full flex-col items-center justify-end gap-xs">
          <span class="figures text-meta" :class="[column.key === lit ? 'text-accent-ink' : 'text-ink-muted', { arrive: arriving }]">{{ column.count ? count(column.count) : '' }}</span>
          <span class="bar" :class="{ lit: column.key === lit, none: !column.count }" :style="{ '--h': column.count / top }" />
        </span>
        <span class="figures text-meta" :class="[column.key === lit ? 'text-accent-ink' : 'text-ink-faint', { arrive: arriving }]" aria-hidden="true">{{ column.label }}</span>
      </button>
    </template>
  </div>
</template>

<style scoped>
.track {
  --columns-h: calc(var(--spacing-xxxl) + var(--spacing-md));
  height: calc(var(--columns-h) + var(--text-meta--line-height) + var(--spacing-xs));
}
.track > :first-child {
  min-height: var(--text-meta--line-height);
}
.column:not(:disabled):active {
  background: var(--color-fill);
}
.bar {
  flex-shrink: 0;
  width: 100%;
  max-width: var(--spacing-ml);
  height: calc(var(--h) * var(--columns-h));
  min-height: var(--stroke-focus);
  border-radius: var(--radius-cover-sm);
  background: var(--color-ink-faint);
  transition: height var(--duration-standard) var(--ease-standard);
}
/* A bar of the loading wave: the quiet fill, swelling from a fifth of the chart to two thirds and back. */
.bar.waving {
  height: calc(var(--columns-h) * 2 / 3);
  background: var(--color-fill-strong);
  transform-origin: bottom;
  animation: column-wave var(--duration-wave) var(--ease-wave) calc((var(--wave, 0) - 1) * var(--duration-wave)) infinite;
}
@keyframes column-wave {
  0%,
  100% {
    transform: scaleY(0.3);
  }
  50% {
    transform: scaleY(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .bar.waving {
    animation-name: none !important;
    transform: scaleY(0.5);
  }
}
/* Where a label will be: its line kept, empty (only the bars stand in while loading). */
.label {
  height: var(--text-meta--line-height);
}
.bar.none {
  width: var(--stroke-focus);
  height: var(--stroke-focus);
  border-radius: var(--radius-pill);
  background: var(--color-ink-ghost);
}
.bar.lit {
  background: var(--color-accent);
}
</style>
