<script setup lang="ts">
// How a read went day by day (issue #68, direction D, from C's chart): one bar a
// day, oldest at the left, today at the right in the lamp colour; a day without
// reading is a dot on the line. Small on Home's card (two weeks, beside the
// pace); large on the book page (three weeks) with the day letters under it.
// The bars are scaled to the read's best day in view. Decorative on the card
// (the pace beside it says it in words); on the book page an image with `label`.
import type { DayAmount } from '~/data/progressDays'
import { parseDay } from '~/utils/dates'

const props = withDefaults(defineProps<{ amounts: readonly DayAmount[]; size?: 'sm' | 'lg'; label?: string }>(), {
  size: 'sm',
  label: undefined,
})

const { locale } = useI18n()

const bars = computed(() => {
  const top = Math.max(...props.amounts.map((a) => a.amount), 1)
  const letter = new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' })
  return props.amounts.map((a, i) => ({
    ...a,
    today: i === props.amounts.length - 1,
    height: a.amount / top,
    letter: letter.format(parseDay(a.day)),
  }))
})
</script>

<template>
  <div
    class="spark"
    :class="size"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  >
    <span v-for="bar in bars" :key="bar.day" class="col" :data-amount="bar.amount">
      <span class="bar" :class="{ today: bar.today, none: !bar.amount }" :style="{ '--h': bar.height }" />
      <span v-if="size === 'lg'" class="letter figures" :class="bar.today ? 'text-accent' : 'text-ink-ghost'" aria-hidden="true">{{ bar.letter }}</span>
    </span>
  </div>
</template>

<style scoped>
.spark {
  display: flex;
  align-items: flex-end;
  gap: var(--spacing-xxs);
}
.col {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-xs);
}
.sm {
  --spark-h: var(--spacing-ml);
}
.sm .col {
  flex: 0 0 var(--spacing-xs);
}
.lg {
  --spark-h: var(--spacing-xxl);
}
.lg .col {
  max-width: var(--spacing-ml);
}
.bar {
  width: 100%;
  height: calc(var(--h) * var(--spark-h));
  min-height: var(--stroke-focus);
  border-radius: var(--radius-pill);
  background: var(--color-ink-ghost);
  transition: height var(--duration-standard) var(--ease-standard);
}
.lg .bar {
  border-radius: var(--radius-cover-sm);
}
.bar.none {
  width: var(--stroke-focus);
  height: var(--stroke-focus);
}
/* Today, read or not yet, is the lit one. */
.bar.today {
  background: var(--color-accent);
}
.letter {
  font-size: var(--text-eyebrow);
  line-height: var(--text-eyebrow--line-height);
}
</style>
