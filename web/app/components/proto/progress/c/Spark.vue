<script setup lang="ts">
// Direction C's history at a glance: one bar per day, oldest left, today at
// the right in the lamp colour; a day without reading is a dot on the line.
// Small on Home's card, with the day letters under it on the book page.
import { dayIndex, daysAgo, type ProtoRead } from '../model'

const props = withDefaults(defineProps<{ read: ProtoRead; days?: number; size?: 'sm' | 'lg'; pending?: number }>(), {
  days: 14,
  size: 'sm',
  pending: 0,
})

const LETTER = new Intl.DateTimeFormat('en', { weekday: 'narrow' })
const bars = computed(() => {
  const amounts = Array.from({ length: props.days }, (_, i) => {
    const ago = props.days - 1 - i
    const day = props.read.log.find((d) => dayIndex(d.day) === ago)
    const [y, m, dd] = daysAgo(ago).split('-').map(Number)
    return { ago, amount: day ? day.to - day.from : 0, letter: LETTER.format(new Date(y!, m! - 1, dd!)) }
  })
  const today = amounts.at(-1)!
  today.amount += props.pending
  const top = Math.max(...amounts.map((a) => a.amount), 1)
  return amounts.map((a) => ({ ...a, height: a.amount / top }))
})
</script>

<template>
  <div class="spark" :class="size" aria-hidden="true">
    <span v-for="bar in bars" :key="bar.ago" class="col">
      <span class="bar" :class="{ today: bar.ago === 0, none: !bar.amount, pending: bar.ago === 0 && pending }" :style="{ '--h': bar.height }" />
      <span v-if="size === 'lg'" class="letter figures" :class="bar.ago === 0 ? 'text-accent' : 'text-ink-ghost'">{{ bar.letter }}</span>
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
  gap: var(--spacing-xs);
}
.sm .col {
  flex: 0 0 var(--spacing-xs);
}
.bar {
  width: 100%;
  height: calc(var(--h) * var(--spark-h));
  min-height: var(--stroke-focus);
  border-radius: var(--radius-pill);
  background: var(--color-ink-ghost);
  transition: height var(--duration-standard) var(--ease-standard);
}
.sm {
  --spark-h: var(--spacing-ml);
}
.lg {
  --spark-h: var(--spacing-xxl);
}
.lg .bar {
  border-radius: var(--radius-cover-sm);
}
.lg .col {
  max-width: var(--spacing-ml);
}
.bar.none {
  width: var(--stroke-focus);
  height: var(--stroke-focus);
  background: var(--color-ink-ghost);
}
.bar.today {
  background: var(--color-accent);
}
.bar.today.pending {
  background: color-mix(in srgb, var(--color-accent) 55%, transparent);
}
.letter {
  font-size: var(--text-eyebrow);
  line-height: var(--text-eyebrow--line-height);
}
</style>
