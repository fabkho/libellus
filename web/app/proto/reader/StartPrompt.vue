<script setup lang="ts">
// Start reading? Opening the reader on a Want to read Book asks once (the
// owner's decision on #131): the Start sheet in the reader's room, with one
// line saying what starting does here — the reader keeps the progress from now
// on. Cancel keeps it Want to read and nothing is written; it does not ask
// again until the reader is opened another day.
import type { CoverColors } from '~/utils/cover'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ book: { title: string; authors: string[]; cover: string | null; colors: CoverColors | null; thumbhash: string | null } }>()
defineEmits<{ start: [] }>()

const startedOn = ref(isoDay())
</script>

<template>
  <UiSheet v-model:open="open" title="Start reading?" testid="readerStart">
    <UiBookLine :title="book.title" :authors="book.authors" :src="book.cover" :thumbhash="book.thumbhash" :colors="book.colors" />
    <p class="mb-md text-subhead text-ink-muted">It's on your Want to read shelf. Start it now and the reader keeps your progress as you turn the pages.</p>
    <UiRowGroup>
      <UiDateRow v-model="startedOn" :label="$t('start.startedOn')" :max="isoDay()" testid="readerStart.date" />
    </UiRowGroup>
    <div class="mt-lg mb-sm">
      <UiButton block data-testid="readerStart.submit" @click="$emit('start')">
        <UiIcon name="arrow" :size="18" bold />{{ $t('start.action') }}
      </UiButton>
    </div>
  </UiSheet>
</template>
