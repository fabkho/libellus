<script setup lang="ts">
// A Library entry's Status as a little coloured tag with its own icon:
// bookmark (Want to read), open book (Currently reading), stamp (Finished).
import type { Status } from '../../../data'
import Icon from './Icon.vue'

defineProps<{ status: Status; abandoned?: boolean; short?: boolean }>()

const labels: Record<Status, string> = {
  want_to_read: 'Want to read',
  reading: 'Currently reading',
  finished: 'Finished',
}
const shortLabels: Record<Status, string> = { want_to_read: 'Want', reading: 'Reading', finished: 'Finished' }
const icons = { want_to_read: 'bookmark', reading: 'open-book', finished: 'stamp' } as const
</script>

<template>
  <span class="tag" :class="abandoned ? 'abandoned' : status">
    <Icon :name="abandoned ? 'flag' : icons[status]" :size="13" />
    {{ abandoned ? 'Not finished' : short ? shortLabels[status] : labels[status] }}
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

.want_to_read {
  background: var(--c-mustard-soft);
  color: color-mix(in srgb, var(--c-ink) 80%, var(--c-mustard));
}

.reading {
  background: var(--c-teal-soft);
  color: var(--c-teal);
}

.finished {
  background: color-mix(in srgb, var(--c-accent) 16%, var(--c-card));
  color: var(--c-accent-deep);
}

.abandoned {
  background: var(--c-paper-deep);
  color: var(--c-ink-soft);
}

[data-palette='ink'] .want_to_read {
  color: var(--c-mustard);
}

[data-palette='ink'] .finished {
  color: var(--c-accent);
}
</style>
