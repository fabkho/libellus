<script setup lang="ts">
// The end of the book (#131 phase 2): one more page after the last, in the reader's room.
// The cover with its light, "The end", the Book, its pages in one mono line
// (when the Book has a count); Finish as the one lit action (it opens the Finish sheet over this
// page); a plain way back to the last page. Turning back (a tap on the left,
// a swipe, Back) returns there too. Once finished it says so and offers to
// close the book. Reached by turning past the last page of the text (the
// licence and other back matter after it are not part of "the end").
import type { CoverColors } from '~/utils/cover'

defineProps<{
  shown: boolean
  finished: boolean
  book: { title: string; authors: string[]; cover: string | null; colors: CoverColors | null; thumbhash: string | null; pages: number | null }
}>()
defineEmits<{ finish: []; back: []; close: [] }>()

const { t } = useI18n()
</script>

<template>
  <Transition name="end">
    <section v-if="shown" class="end absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden bg-surface px-xl text-center" data-testid="reader.end">
      <UiAmbient :colors="book.colors" />
      <div class="relative flex flex-col items-center">
        <UiCover :title="book.title" :authors="book.authors" :src="book.cover" :thumbhash="book.thumbhash" :colors="book.colors" size="lg" glow />
        <p class="eyebrow mt-xl">{{ t('reader.end.eyebrow') }}</p>
        <h2 class="book-title mt-sm text-headline text-balance">{{ book.title }}</h2>
        <p class="mt-xs text-body text-ink-muted">{{ book.authors.join(', ') }}</p>
        <p v-if="book.pages" class="figures mt-ms text-meta text-ink-faint">{{ t('reader.end.pages', { count: book.pages }) }}</p>
      </div>
      <div class="relative mt-xxl flex w-full max-w-(--size-menu) flex-col gap-sm">
        <template v-if="finished">
          <p class="mb-sm flex items-center justify-center gap-xs text-caption text-success" data-testid="reader.endFinished">
            <UiIcon name="check" :size="16" bold />{{ t('reader.end.finished') }}
          </p>
          <UiButton block tone="secondary" data-testid="reader.endClose" @click="$emit('close')">{{ t('reader.end.close') }}</UiButton>
        </template>
        <template v-else>
          <UiButton block data-testid="reader.endFinish" @click="$emit('finish')">
            <UiIcon name="check" :size="18" bold />{{ t('reader.end.finish') }}
          </UiButton>
          <UiButton block tone="plain" data-testid="reader.endBack" @click="$emit('back')">{{ t('reader.end.back') }}</UiButton>
        </template>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.end {
  padding-top: var(--bar-top);
  padding-bottom: calc(var(--safe-area-bottom) + var(--spacing-xl));
}
.end-enter-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}
.end-enter-active > div {
  transition: transform var(--duration-sheet) var(--ease-standard);
}
.end-leave-active {
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.end-enter-from,
.end-leave-to {
  opacity: 0;
}
.end-enter-from > div {
  transform: translateY(var(--spacing-md));
}
</style>
