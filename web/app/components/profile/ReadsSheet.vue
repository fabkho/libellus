<script setup lang="ts">
// The books behind a column or a star row of the Profile (issue #78): a
// month's books in the order they ended, or the books rated so, best first.
// A sheet over the Profile; a row opens its book page (which closes the sheet).
import type { StatsRead } from '~/data/stats'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ title: string; reads: readonly StatsRead[]; withYear?: boolean }>()
</script>

<template>
  <UiSheet v-model:open="open" :title="title" testid="profileReads">
    <div class="flex flex-col" data-testid="profileReads.list">
      <ProfileReadRow v-for="read in reads" :key="read.sessionId" :read="read" :with-year="withYear" data-testid="profileReads.read" />
    </div>
  </UiSheet>
</template>
