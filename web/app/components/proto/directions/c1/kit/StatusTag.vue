<script setup lang="ts">
// A Library entry's Status as a little coloured tag with its own icon:
// bookmark (Want to read), open book (Currently reading), stamp (Finished).
import type { Status } from '../../../data'
import Icon from './Icon.vue'

defineProps<{ status: Status; abandoned?: boolean; short?: boolean; icon?: boolean }>()

const labels: Record<Status, string> = {
  want_to_read: 'Want to read',
  reading: 'Currently reading',
  finished: 'Finished',
}
const shortLabels: Record<Status, string> = { want_to_read: 'Want', reading: 'Reading', finished: 'Finished' }
const icons = { want_to_read: 'bookmark', reading: 'open-book', finished: 'stamp' } as const
</script>

<template>
  <span
    class="tag"
    :class="[abandoned ? 'abandoned' : status, { icon }]"
    :aria-label="abandoned ? 'Not finished' : labels[status]"
  >
    <Icon :name="abandoned ? 'flag' : icons[status]" :size="icon ? 15 : 13" />
    <template v-if="!icon">{{ abandoned ? 'Not finished' : short ? shortLabels[status] : labels[status] }}</template>
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
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 700;
  white-space: nowrap;
}

.icon {
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 10px;
}

.want_to_read {
  background: var(--c1-mustard-soft);
  color: color-mix(in srgb, var(--c1-ink) 80%, var(--c1-mustard));
}

.reading {
  background: var(--c1-teal-soft);
  color: var(--c1-teal);
}

.finished {
  background: color-mix(in srgb, var(--c1-accent) 16%, var(--c1-card));
  color: var(--c1-accent-deep);
}

.abandoned {
  background: var(--c1-paper-deep);
  color: var(--c1-ink-soft);
}

[data-theme='dark'] .icon {
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 10px;
}

.want_to_read {
  color: var(--c1-mustard);
}

[data-theme='dark'] .finished {
  color: var(--c1-accent);
}
</style>
