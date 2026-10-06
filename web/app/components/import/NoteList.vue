<script setup lang="ts">
// The books of the file worth a second look (D's list rows): the Placeholder
// cover the book would wear, its serif title and author, and under them what
// happened to it in plain words — not found and added from the file, a custom
// shelf added as Want to read, a rating left out, a row skipped. A book that
// was matched to an edition wears that edition's cover, so she sees what she
// gets before importing. A book whose edition is hers to choose carries a
// button for it (`action`), which opens the Choose edition sheet.
import type { CoverColors } from '~/data/books'

export type ImportNote = {
  key: string
  title: string
  authors: readonly string[]
  /** The cover of the edition it will be added as, when there is one. */
  cover?: { url: string | null; thumbhash: string | null; colors: CoverColors | null } | null
  /** Language, year, pages … of the edition she chose, as the Change edition sheet lists them. */
  facts?: readonly string[]
  /** Copy, already in words. */
  notes: readonly string[]
  /** A button under the notes ("Choose edition") and the name a screen reader gives it ("Choose edition: Piranesi"). */
  action?: { label: string; name: string }
}

defineProps<{ items: readonly ImportNote[]; testid: string }>()
const emit = defineEmits<{ act: [key: string] }>()

const { t } = useI18n()
const authorLine = (authors: readonly string[]) => formatAuthors([...authors], t('common.etAl'))
</script>

<template>
  <ul class="flex flex-col" :data-testid="testid">
    <li v-for="item in items" :key="item.key" class="row flex items-start gap-inset py-sm" :data-testid="`${testid}.row`">
      <UiCover
        decorative
        :title="item.title"
        :authors="item.authors"
        :src="coverSrc(item.cover?.url, 'xs')"
        :thumbhash="item.cover?.thumbhash"
        :colors="item.cover?.colors"
        size="xs"
        class="mt-xxs"
      />
      <div class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="book-title title-wrap text-callout" :data-testid="`${testid}.title`">{{ item.title }}</span>
        <span v-if="item.authors.length" class="truncate text-caption text-ink-faint">{{ authorLine(item.authors) }}</span>
        <span v-if="item.facts?.length" class="figures flex min-w-0 items-center gap-xs text-meta text-ink-faint" :data-testid="`${testid}.facts`">
          <template v-for="(fact, i) in item.facts" :key="i">
            <span v-if="i" class="size-(--spacing-xxs) shrink-0 rounded-pill bg-current" aria-hidden="true" />
            <span :class="i === item.facts.length - 1 ? 'min-w-0 truncate' : 'shrink-0 whitespace-nowrap'">{{ fact }}</span>
          </template>
        </span>
        <span v-for="(note, index) in item.notes" :key="index" class="text-footnote text-ink-muted" :data-testid="`${testid}.note`">
          {{ note }}
        </span>
        <UiButton
          v-if="item.action"
          tone="secondary"
          size="sm"
          class="mt-xs self-start"
          :aria-label="item.action.name"
          :data-testid="`${testid}.action`"
          @click="emit('act', item.key)"
        >
          {{ item.action.label }}
        </UiButton>
      </div>
    </li>
  </ul>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
