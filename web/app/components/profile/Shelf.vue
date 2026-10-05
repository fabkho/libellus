<script setup lang="ts">
// Your shelf on the Profile (#23): the owner's way into her 3D shelf, and only
// hers (the Profile renders it for the owner alone, stores/shelf.ts). A card
// like the years in review: a small window onto the night room with the top of
// the pile in its Spines' colours (ShelfPile), "Your shelf", and how many Books
// stand on it. Before the library file has come, or when it couldn't, the card
// is there without its count and the window holds quiet slabs.
import { useShelfStore } from '~/stores/shelf'

const { t } = useI18n()
const { count } = useFigures()
const shelf = useShelfStore()

const books = computed(() => shelf.shelf?.books ?? [])
const label = computed(() => (shelf.shelf ? t('shelf.card.label', { count: count(books.value.length) }, books.value.length) : t('shelf.card.title')))
</script>

<template>
  <NuxtLink
    to="/profile/shelf"
    class="relative flex items-center gap-md overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint active:opacity-80"
    :aria-label="label"
    data-testid="profile.shelf"
  >
    <span data-theme="dark" class="window flex shrink-0 items-end justify-center overflow-hidden rounded-md bg-surface px-ms pb-ms">
      <ShelfPile :books="books.slice(0, 7)" :settle="false" class="w-full" />
    </span>
    <span class="flex min-w-0 flex-1 flex-col gap-xs">
      <span class="eyebrow">{{ t('shelf.card.title') }}</span>
      <span v-if="shelf.shelf" class="text-figure tabular-nums" data-testid="profile.shelfCount">{{ count(books.length) }}</span>
      <span v-if="shelf.shelf" class="figures text-meta text-ink-muted">{{ t('shelf.card.books', books.length) }}</span>
    </span>
    <UiIcon name="chevron" :size="15" class="text-ink-ghost" />
  </NuxtLink>
</template>

<style scoped>
.window {
  width: var(--size-cover-md);
  height: calc(var(--size-cover-md) * 1.5);
}
</style>
