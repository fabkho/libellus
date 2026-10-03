<script setup lang="ts">
// "Read in <year>: N" (D's tally): the year's label over tally marks — one
// stroke per finished read, every fifth followed by a gap — and the count large
// on the right. Counts finished sessions with an end date in the year, re-reads
// included (data/library.ts, `readInYear`).
defineProps<{ year: number; count: number | null }>()

const { t } = useI18n()
</script>

<template>
  <section
    class="flex items-center justify-between gap-md border-y-(length:--stroke-hairline) border-hairline-strong py-ms"
    :aria-label="count === null ? t('home.readIn', { year }) : t('home.readInLabel', { year, count })"
    data-testid="home.tally"
  >
    <div class="flex min-w-0 flex-col gap-ms">
      <span class="text-body text-ink-muted" data-testid="home.tallyLabel">{{ t('home.readIn', { year }) }}</span>
      <span v-if="count" class="ticks" aria-hidden="true" data-testid="home.ticks">
        <span v-for="n in count" :key="n" class="tick" :class="{ fifth: n % 5 === 0 }" />
      </span>
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

.tick.fifth {
  margin-right: var(--spacing-xs);
}
</style>
