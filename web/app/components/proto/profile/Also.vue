<script setup lang="ts">
// Design round #78: A's three small figures — read again, not finished, want
// to read — between hairlines.
import { wantToRead, type Stats } from './model'

withDefaults(defineProps<{ stats: Stats; want?: boolean }>(), { want: true })
</script>

<template>
  <section class="grid border-y-(length:--stroke-hairline) border-hairline-strong py-md" data-testid="proto.also" :class="want ? 'grid-cols-3' : 'grid-cols-2'">
    <div class="flex flex-col gap-xs">
      <span class="text-title tabular-nums">{{ stats.rereads.length }}</span><span class="eyebrow">Read again</span>
    </div>
    <div class="flex flex-col gap-xs">
      <span class="text-title tabular-nums">{{ stats.abandoned.length }}</span><span class="eyebrow">Not finished</span>
    </div>
    <div v-if="want" class="flex flex-col gap-xs">
      <span class="text-title tabular-nums">{{ wantToRead.length }}</span><span class="eyebrow">Want to read</span>
    </div>
  </section>
</template>
