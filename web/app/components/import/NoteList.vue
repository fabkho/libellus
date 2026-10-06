<script setup lang="ts">
// The books of the file worth a second look (D's list rows): the Placeholder
// cover the book would wear, its serif title and author, and under them what
// happened to it in plain words — not found and added from the file, a custom
// shelf added as Want to read, a rating left out, a row skipped. A book that
// was matched to an edition wears that edition's cover, so she sees what she
// gets before importing.
import type { CoverColors } from '~/data/books'

export type ImportNote = {
  key: string
  title: string
  authors: readonly string[]
  /** The cover of the edition it will be added as, when there is one. */
  cover?: { url: string | null; thumbhash: string | null; colors: CoverColors | null } | null
  /** Copy, already in words. */
  notes: readonly string[]
}

defineProps<{ items: readonly ImportNote[]; testid: string }>()

const { t } = useI18n()
const authorLine = (authors: readonly string[]) => formatAuthors([...authors], t('common.etAl'))
</script>

<template>
  <ul class="flex flex-col" :data-testid="testid">
    <li v-for="item in items" :key="item.key" class="row flex items-start gap-inset py-sm" :data-testid="`${testid}.row`">
      <UiCover
        :title="item.title"
        :authors="item.authors"
        :src="coverSrc(item.cover?.url, 'xs')"
        :thumbhash="item.cover?.thumbhash"
        :colors="item.cover?.colors"
        size="xs"
        class="mt-xxs"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="book-title truncate text-callout" :data-testid="`${testid}.title`">{{ item.title }}</span>
        <span v-if="item.authors.length" class="truncate text-caption text-ink-faint">{{ authorLine(item.authors) }}</span>
        <span v-for="(note, index) in item.notes" :key="index" class="text-footnote text-ink-muted" :data-testid="`${testid}.note`">
          {{ note }}
        </span>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
