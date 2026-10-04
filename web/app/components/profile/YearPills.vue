<script setup lang="ts">
// The year the Profile shows (issue #78): All first, then each year with a
// finished read, newest first. One is lit (ink fill), as Library's filters.
// Scrolls sideways without a scroll bar when the years run past the edge.
import type { StatsYear } from '~/data/stats'

defineProps<{ years: readonly number[] }>()
const year = defineModel<StatsYear>({ required: true })
const { t } = useI18n()
</script>

<template>
  <div role="group" :aria-label="t('profile.yearsLabel')" class="no-bar -mx-screen flex gap-sm overflow-x-auto px-screen" data-testid="profile.years">
    <button
      v-for="y in ['all' as const, ...years]"
      :key="y"
      type="button"
      :aria-pressed="year === y"
      class="pill figures relative inline-flex h-(--size-button-sm) shrink-0 items-center rounded-pill px-md text-caption"
      :class="year === y ? 'bg-ink text-on-ink' : 'edge text-ink-muted hover:bg-fill'"
      :data-testid="`profile.year.${y}`"
      @click="year = y"
    >
      {{ y === 'all' ? t('profile.all') : y }}
    </button>
  </div>
</template>

<style scoped>
.no-bar {
  scrollbar-width: none;
}
.no-bar::-webkit-scrollbar {
  display: none;
}
/* The drawn pill is 32 px; the touch target stays 44. */
.pill::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
