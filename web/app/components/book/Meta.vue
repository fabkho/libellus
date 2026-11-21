<script setup lang="ts">
// The Book page's metadata block, under About (docs/plans/book-hero-metadata.md; the settled mock
// docs/prototypes/book-detail/m5.html, panels A/B/F/C): when the work was first published, which edition this
// is, its format and its page count, in a two-column grid of name over value — no box, no fill, no hairline,
// the grouping done by the grid alone — and the Book's links on a full-width row last, without a label and
// with dots between that wrap.
//
// It took the hero's facts row and the quiet "This edition:" line that used to stand outside About, and it
// shows when it has anything to say: a Book still without a description has an edition to name, and that is
// where the block stands alone (the mock's panel C). Nothing in it repeats the hero: the year here is the
// work's first publication, which the hero no longer says at all.
//
// Cell 2 is `editionLine`'s parts and nothing more — the label above already says "This edition", so the
// sentence's prefix is not said twice — and the parts are joined the way that sentence joined them. Where
// `editionLine` answers nothing (this copy's year is the one cell 1 gives: utils/publishedYear.ts, unchanged)
// the cell falls back to the publisher alone.
import { formatOf, type Book, type BookSnapshot } from '~/data/books'
import type { LibraryEntry } from '~/data/library'
import { useLinkTemplatesStore } from '~/stores/linkTemplates'
import { editionLine, firstPublishedYear } from '~/utils/publishedYear'

const props = defineProps<{ book: Book | BookSnapshot; entry?: LibraryEntry | null }>()

const { t } = useI18n()
const templates = useLinkTemplatesStore()
// After the page has rendered, so the block never holds the page up; the device's copy shows at once.
onMounted(() => void templates.load())

/** The work's first publication, not this copy's printing: the year the hero used to carry (utils/publishedYear.ts). */
const firstPublished = computed(() => firstPublishedYear(props.book))

/** This edition's publisher and/or year, in the parts `editionLine` keeps apart; the label is the cell's. */
const editionValue = computed(() => {
  const publisher = props.book.publisher?.trim() || null
  const parts = editionLine(props.book)
  // Its year is the one cell 1 gives, or it has none: the publisher alone is what this copy can still say.
  if (!parts) return publisher ?? ''
  return [parts.publisher, String(parts.year ?? '')].filter(Boolean).join(t('common.listSeparator'))
})

/** Her own word on her copy, else what its source said (data/books.ts, `formatOf`). */
const format = computed(() => formatOf(props.book, props.entry?.formatOverride))

type Cell = { testid: string; label: string; value: string; figures?: boolean }

const cells = computed<Cell[]>(() => {
  const year = firstPublished.value
  const pages = props.book.pageCount
  return [
    year ? { testid: 'book.firstPublished', label: t('book.firstPublished'), value: String(year), figures: true } : null,
    editionValue.value ? { testid: 'book.thisEditionCell', label: t('book.thisEditionLabel'), value: editionValue.value } : null,
    format.value ? { testid: 'book.format', label: t('book.formatLabel'), value: t(`book.formatFact.${format.value}`) } : null,
    pages ? { testid: 'book.pages', label: t('book.pagesLabel'), value: String(pages), figures: true } : null,
  ].filter((cell): cell is Cell => cell !== null)
})

/** The links are the block's last row; it exists only when there is one (the store's, this Book's, filled). */
const links = computed(() => templates.linksFor(props.book))
</script>

<template>
  <div v-if="cells.length || links.length" class="grid grid-cols-2 gap-x-md gap-y-ms" data-testid="book.thisEdition">
    <div v-for="cell in cells" :key="cell.testid" class="flex min-w-0 flex-col gap-px">
      <span class="eyebrow">{{ cell.label }}</span>
      <span class="text-caption text-ink-muted" :class="cell.figures && 'figures'" :data-testid="cell.testid">{{ cell.value }}</span>
    </div>
    <!-- The links hold both columns: two links beside a label do not fit in half a phone (the mock's wide cell). -->
    <div v-if="links.length" class="col-span-2 min-w-0">
      <BookLinks :book="book" />
    </div>
  </div>
</template>
