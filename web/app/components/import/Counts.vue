<script setup lang="ts">
// How the file's books divide over the three Statuses, as the Home tally
// writes a count: light large figures between two hairlines, the Status under
// each. Test IDs `import.count.<status>`.
import type { EntryStatus } from '~/data/library'

defineProps<{ counts: Record<EntryStatus, number> }>()

const { t } = useI18n()
const STATUSES: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']
</script>

<template>
  <dl
    class="grid grid-cols-3 border-y-(length:--stroke-hairline) border-hairline-strong py-ms"
    :aria-label="t('import.statusLabel')"
    data-testid="import.counts"
  >
    <div v-for="status in STATUSES" :key="status" class="cell flex min-w-0 flex-col gap-xs px-ms first:pl-0">
      <dd class="order-1 text-figure text-ink tabular-nums" :data-testid="`import.count.${status}`">{{ counts[status] }}</dd>
      <dt class="order-2 text-caption text-ink-muted">{{ t(`status.${status}`) }}</dt>
    </div>
  </dl>
</template>

<style scoped>
.cell + .cell {
  border-left: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
