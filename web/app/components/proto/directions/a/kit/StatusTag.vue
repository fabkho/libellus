<script setup lang="ts">
// A Library entry's Status as a small tinted capsule with its own mark.
import type { Status } from '../../../data'

defineProps<{ status: Status; abandoned?: boolean; short?: boolean }>()

const labels: Record<Status, string> = {
  want_to_read: 'Want to read',
  reading: 'Reading',
  finished: 'Finished',
}
</script>

<template>
  <span class="tag" :class="abandoned ? 'abandoned' : status">
    <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
      <path v-if="abandoned" d="M3 3l6 6M9 3 3 9" />
      <path v-else-if="status === 'finished'" d="m2.6 6.3 2.3 2.3 4.6-5" />
      <circle v-else-if="status === 'reading'" cx="6" cy="6" r="3" class="dot" />
      <path v-else d="M3.4 1.9h5.2v8.3L6 8.4l-2.6 1.8Z" />
    </svg>
    {{ abandoned ? 'Not finished' : short ? labels[status] : status === 'reading' ? 'Currently reading' : labels[status] }}
  </span>
</template>

<style scoped>
.tag {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px 0 7px;
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 600;
  white-space: nowrap;
}

svg path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.dot {
  fill: currentColor;
}

.want_to_read {
  background: rgb(52 40 20 / 0.07);
  color: var(--a-ink-2);
}

.reading {
  background: var(--a-accent-soft);
  color: var(--a-accent-ink);
}

.finished {
  background: rgb(63 116 81 / 0.12);
  color: #2f6142;
}

.abandoned {
  background: rgb(52 40 20 / 0.07);
  color: var(--a-ink-2);
}
</style>
