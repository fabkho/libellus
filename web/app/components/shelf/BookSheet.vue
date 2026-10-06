<script setup lang="ts">
// What the shelf's row shows of a Book broken out (#23): the content of
// Regal's detail panel (its `#detail` slot, ShelfRow), built as a quieter
// cousin of the app's own sheets (UiSheet, as EditionSheet uses it): a title
// row with a plain Done at the left (it puts the Book back; Regal's round Back
// is off) and the one action at the right in the lamp colour (turn the Book
// over), then the Book's title, one line of facts, its blurb and a trailing
// Goodreads link. No pills. Regal keeps the container (position, corners,
// surface, shadow, bottom inset), its grabber (the phone's sheet: it stands
// above this, UiSheet's size and colour, and drags the Book back), the fade,
// and the Book's own gestures (regal-themed.css).
import { goodreadsUrl } from '~/utils/goodreads'

const props = defineProps<{
  /** The picked Book, as Regal's library file normalizes it. */
  book: {
    id: string
    title: string
    author: string | null
    isbn13: string | null
    pages: number | null
    status: string
    dateRead: string | null
    description?: string | null
  }
  /** Which side of the Book is showing. */
  face: 'front' | 'back'
  /** The phone's sheet (Regal's grabber stands above the title row); wider screens get the same content in a card. */
  sheet: boolean
}>()
const emit = defineEmits<{
  /** Put the Book back. */
  close: []
  /** Turn it over. */
  flip: []
}>()

const { t, locale } = useI18n()

/** Author · day finished (or "Reading now") · pages, whichever the Book has. */
const facts = computed(() => {
  const { author, dateRead, status, pages } = props.book
  const read = dateRead
    ? new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric' }).format(parseDay(dateRead))
    : status === 'currently-reading'
      ? t('shelf.detail.reading')
      : null
  return [author, read, pages ? t('book.pages', { count: pages }) : null].filter((fact): fact is string => Boolean(fact))
})
</script>

<template>
  <div class="relative" data-testid="shelfRow.sheet">
    <!-- UiSheet's title row: 44 pt, Done and the action as wide as each other's copy needs. -->
    <header
      class="relative box-content grid h-(--size-touch) grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-sm px-ml"
      :class="sheet ? 'pt-0' : 'pt-md'"
    >
      <div class="grid justify-items-start">
        <button type="button" class="-ml-sm min-h-(--size-touch) px-sm text-body text-ink-muted hover:text-ink" data-testid="shelfRow.putBack" @click="emit('close')">
          {{ t('shelf.detail.done') }}
        </button>
      </div>
      <span />
      <div class="grid justify-items-end">
        <button type="button" class="-mr-sm min-h-(--size-touch) px-sm text-body font-semibold text-accent-ink" data-testid="shelfRow.flip" @click="emit('flip')">
          {{ face === 'front' ? t('shelf.detail.backCover') : t('shelf.detail.frontCover') }}
        </button>
      </div>
    </header>
    <div class="flex flex-col gap-ms px-ml pt-md pb-md">
      <h2 class="book-title text-headline text-balance" data-testid="shelfRow.title">{{ book.title }}</h2>
      <p v-if="facts.length" class="figures flex flex-wrap items-center gap-x-xs text-meta text-ink-faint" data-testid="shelfRow.detailMeta">
        <template v-for="(fact, i) in facts" :key="i">
          <span v-if="i" class="size-(--spacing-xxs) shrink-0 rounded-pill bg-current" aria-hidden="true" />
          <span>{{ fact }}</span>
        </template>
      </p>
      <p v-if="book.description" class="line-clamp-4 text-callout text-ink-muted" data-testid="shelfRow.about">{{ book.description }}</p>
      <a
        :href="goodreadsUrl(book)"
        target="_blank"
        rel="noopener"
        class="self-end text-footnote text-accent-ink"
        data-testid="shelfRow.goodreads"
      >
        {{ t('shelf.detail.goodreads') }}
      </a>
    </div>
  </div>
</template>
