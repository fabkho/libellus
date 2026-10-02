<script setup lang="ts">
// The Status of a Library entry as a small label.
import type { Status } from '../../../data'

defineProps<{ status: Status; abandoned?: boolean }>()

const labels: Record<Status, string> = {
  want_to_read: 'Want to read',
  reading: 'Currently reading',
  finished: 'Finished',
}
</script>

<template>
  <span
    class="inline-flex h-6 items-center rounded-full border border-neutral-300 bg-neutral-100 px-2 text-[12px] font-medium text-neutral-700"
    >{{ abandoned ? 'Not finished' : labels[status] }}</span
  >
</template>
