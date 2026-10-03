<script setup lang="ts">
// The book page's Collections (D's book detail): the Collections the Book is
// on as chips (each opens its Collection), then "Add to collection", which
// opens the picker. Shown for every Book, also one not in the Library yet:
// putting it on a Collection adds it to Want to read. Owns its sheet, so the
// book page only places this row.
import type { Book, BookSnapshot } from '~/data/books'
import type { LibraryEntry } from '~/data/library'
import { useCollectionsStore } from '~/stores/collections'

const props = defineProps<{ book: Book | BookSnapshot; entry: LibraryEntry | null; bookKey: string }>()

const { t } = useI18n()
const collections = useCollectionsStore()

const chips = computed(() => collections.collectionsOf(props.entry?.id))

watch(
  () => props.entry?.id,
  (entryId) => {
    if (!entryId) return
    void collections.loadMemberships(entryId)
    if (!collections.loaded) void collections.loadList()
  },
  { immediate: true },
)
</script>

<template>
  <section class="relative px-ml pt-xl" data-testid="book.collections">
    <h2 class="eyebrow mb-ms">{{ t('collections.title') }}</h2>
    <div class="flex flex-wrap gap-sm">
      <NuxtLink
        v-for="collection in chips"
        :key="collection.id"
        :to="`/collections/${collection.id}`"
        class="chip inline-flex h-(--size-button-sm) items-center rounded-pill bg-fill px-ms text-caption text-ink edge"
        data-testid="book.collection"
      >
        {{ collection.name }}
      </NuxtLink>
      <button
        type="button"
        class="chip inline-flex h-(--size-button-sm) items-center gap-xs rounded-pill px-ms text-caption text-ink-muted edge"
        data-testid="book.addToCollection"
        @click="collections.openPicker(book, entry, bookKey)"
      >
        <UiIcon name="plus" :size="14" bold />{{ t('collections.addTo') }}
      </button>
    </div>
    <CollectionsPickerSheet />
  </section>
</template>

<style scoped>
/* The drawn chip is 32 px; the touch target stays 44. */
.chip {
  position: relative;
}

.chip::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
