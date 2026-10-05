<script setup lang="ts">
// The books behind a column or a star row of the Profile (issue #78): a
// month's books in the order they ended, or the books rated so, best first.
// A sheet over the Profile; a row opens its book page (which closes the sheet).
// Home's "Read in 2026" opens the same sheet for a whole year (HomeTallySheet),
// with its own test IDs (`testid`) and two slots around the list: `top`, above
// the rows (the owner's row of that year's Books), and `foot`, under them.
import type { StatsRead } from '~/data/stats'

const open = defineModel<boolean>('open', { required: true })
withDefaults(defineProps<{ title: string; reads: readonly StatsRead[]; withYear?: boolean; testid?: string }>(), {
  withYear: false,
  testid: 'profileReads',
})
</script>

<template>
  <UiSheet v-model:open="open" :title="title" :testid="testid">
    <slot name="top" />
    <div class="flex flex-col" :data-testid="`${testid}.list`">
      <ProfileReadRow v-for="read in reads" :key="read.sessionId" :read="read" :with-year="withYear" :data-testid="`${testid}.read`" />
    </div>
    <slot name="foot" />
  </UiSheet>
</template>
