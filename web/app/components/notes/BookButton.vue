<script setup lang="ts">
// The plain *Notes* row of a Book's page (docs/parity.md, *Notes, the Book page section*; V4, docs/plans/book-actions.md): one row of the pair under the Book's
// About text, drawn when the Notes rows have nothing of her friends' or the public's to count (components/notes/BookSection.vue, which places this when
// `notes_summary(book)` is empty) — the way in to the Notes page, always there. A Manual book is her own record that nobody else can open: the row is off, and
// one line under it says why (as *Read together* does). A search result that is not in the Catalogue yet has no Notes page: no row at all.
// It is no longer a half-width button beside *Read together*: the action area holds the reading actions and nothing else.
// Test ids: `book.notes` (the row), `book.notes.unavailable` (the line).
import type { Book, BookSnapshot } from '~/data/books'
import { notesPath } from '~/utils/notesRoute'

const props = defineProps<{ book: Book | BookSnapshot }>()
const { t } = useI18n()

const manual = computed(() => props.book.source === 'manual')
const id = computed(() => ('id' in props.book ? props.book.id : null))
</script>

<template>
  <!-- One row of the pair's box (components/book/ActionPair.vue), which owns the fill, the radius and the hairline edge; the why line sits
       under the row, inside that box, in the row's own inset so it reads as the row's second line rather than as a new one. -->
  <section v-if="manual || id">
    <button
      v-if="manual"
      type="button"
      class="flex min-h-(--size-row) w-full items-center gap-ms px-inset py-xs text-left"
      disabled
      aria-describedby="book-notes-why"
      data-testid="book.notes"
    >
      <span class="flex w-(--size-avatar) shrink-0 justify-center text-ink-faint" aria-hidden="true"><UiIcon name="doc" :size="22" /></span>
      <span class="min-w-0 flex-1 text-body text-ink-faint">{{ t('notes.title') }}</span>
    </button>
    <NuxtLink
      v-else-if="id"
      :to="notesPath(id)"
      class="flex min-h-(--size-row) w-full items-center gap-ms px-inset py-xs text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent active:bg-fill-strong"
      data-testid="book.notes"
    >
      <span class="flex w-(--size-avatar) shrink-0 justify-center text-ink-faint" aria-hidden="true"><UiIcon name="doc" :size="22" /></span>
      <span class="min-w-0 flex-1 text-body">{{ t('notes.title') }}</span>
      <UiIcon name="chevron" :size="15" bold class="text-ink-ghost" />
    </NuxtLink>
    <p v-if="manual" id="book-notes-why" class="px-inset pb-sm text-caption text-ink-muted" data-testid="book.notes.unavailable">{{ t('notes.unavailable') }}</p>
  </section>
</template>
