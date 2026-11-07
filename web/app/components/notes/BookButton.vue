<script setup lang="ts">
// The *Notes* action on a Book's page (docs/parity.md, *Notes, the Book page section*): a quiet half-width button beside *Read together* (`TogetherBookRow`'s slot), under the Book's
// one action, on every Book page of the Catalogue, in her Library or not (a member may read what her friends wrote without the Book). It opens the Notes page. A Manual book is her own
// record that nobody else can open: the button is off, and one line says why (as *Read together* does). A search result that is not in the Catalogue yet has no Notes to open: no button.
// Test ids: `book.notes` (the button), `book.notes.unavailable` (the line).
import type { Book, BookSnapshot } from '~/data/books'
import { notesPath } from '~/utils/notesRoute'

const props = defineProps<{ book: Book | BookSnapshot; line?: boolean }>()
const { t } = useI18n()

const manual = computed(() => props.book.source === 'manual')
const id = computed(() => ('id' in props.book ? props.book.id : null))
</script>

<template>
  <template v-if="!line">
    <UiButton v-if="manual" tone="quiet" block disabled aria-describedby="book-notes-why" data-testid="book.notes">
      <UiIcon name="doc" :size="18" />{{ t('notes.title') }}
    </UiButton>
    <UiButton v-else-if="id" :to="notesPath(id)" tone="quiet" block data-testid="book.notes">
      <UiIcon name="doc" :size="18" />{{ t('notes.title') }}
    </UiButton>
  </template>
  <p v-else-if="manual" id="book-notes-why" class="mt-xs text-center text-caption text-ink-muted" data-testid="book.notes.unavailable">{{ t('notes.unavailable') }}</p>
</template>
