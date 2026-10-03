<script setup lang="ts">
// "Read in <year>: N" (D's tally): the year's label over tally marks — one
// stroke per finished read, every fifth followed by a gap — and the count large
// on the right. Counts finished sessions with an end date in the year, re-reads
// included (data/library.ts, `readInYear`). A new mark (a Finish) lights up
// in the lamp colour and settles into the row (docs/MOTION.md).
const props = defineProps<{ year: number; count: number | null }>()

const { t } = useI18n()
// Only a mark added to a count already shown lights up; the first count to
// arrive just appears.
const motion = ref<'tick' | 'none'>('none')
watch(
  () => props.count,
  (_, before) => (motion.value = before === null ? 'none' : 'tick'),
  { flush: 'pre' },
)
</script>

<template>
  <section
    class="flex items-center justify-between gap-md border-y-(length:--stroke-hairline) border-hairline-strong py-ms"
    :aria-label="count === null ? t('home.readIn', { year }) : t('home.readInLabel', { year, count })"
    data-testid="home.tally"
  >
    <div class="flex min-w-0 flex-col gap-ms">
      <span class="text-body text-ink-muted" data-testid="home.tallyLabel">{{ t('home.readIn', { year }) }}</span>
      <TransitionGroup v-show="count" :name="motion" tag="span" class="ticks" aria-hidden="true" data-testid="home.ticks">
        <span v-for="n in count ?? 0" :key="n" class="tick" :class="{ fifth: n % 5 === 0 }" />
      </TransitionGroup>
    </div>
    <span class="text-figure text-ink tabular-nums" data-testid="home.tallyCount">{{ count ?? '–' }}</span>
  </section>
</template>

<style scoped>
.ticks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
  row-gap: var(--spacing-sm);
}

.tick {
  width: var(--stroke-rule);
  height: var(--spacing-md);
  background: var(--color-accent);
  opacity: 0.85;
}

/* A new mark: fades in full lamp with its glow, then settles to the others. */
.tick-enter-active {
  animation: tick-light calc(2 * var(--duration-sheet)) var(--ease-standard) both;
}

@keyframes tick-light {
  from {
    opacity: 0;
    box-shadow: 0 0 var(--spacing-sm) var(--color-accent-soft);
  }
  40% {
    opacity: 1;
    box-shadow: 0 0 var(--spacing-sm) var(--color-accent);
  }
  to {
    opacity: 0.85;
    box-shadow: 0 0 0 var(--color-accent);
  }
}

.tick.fifth {
  margin-right: var(--spacing-xs);
}
</style>
