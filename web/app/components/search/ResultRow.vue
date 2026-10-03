<script setup lang="ts">
// One search result: cover, title in the serif, author, year. Tapping it opens
// the book page (and the route change closes the search); the + opens the Add
// sheet. A Book already in the Library shows its status instead of the +.
import { useBookStore } from '~/stores/book'
import type { SearchHit } from '~/stores/search'

const props = defineProps<{ hit: SearchHit; eager?: boolean }>()
defineEmits<{ add: [] }>()

const { t } = useI18n()
const book = useBookStore()
const authorLine = computed(() => formatAuthors(props.hit.book.authors, t('common.etAl')))
</script>

<template>
  <div class="flex min-h-(--size-row) items-center pr-xs">
    <UiPressLink
      :to="`/book/${hit.key}`"
      class="flex min-w-0 flex-1 items-center gap-ms py-xs pl-md active:bg-fill"
      data-testid="search.result"
      @press="book.prefetch(hit.key)"
    >
      <UiCover
        :title="hit.book.title"
        :authors="hit.book.authors"
        :src="coverSrc(hit.book.coverUrl, 'sm')"
        :thumbhash="hit.book.coverThumbhash"
        :colors="hit.book.coverColors"
        size="sm"
        :eager="eager"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="book-title truncate text-body" data-testid="search.resultTitle">{{ hit.book.title }}</span>
        <span class="truncate text-caption text-ink-faint">{{ authorLine }}</span>
        <span v-if="hit.book.year" class="figures text-meta text-ink-faint">{{ hit.book.year }}</span>
      </span>
    </UiPressLink>

    <span
      v-if="hit.entry"
      class="flex shrink-0 items-center gap-xs px-sm text-footnote text-ink-faint"
      data-testid="search.resultStatus"
    >
      <UiIcon name="check" :size="13" bold />{{ t(`status.${hit.entry.status}`) }}
    </span>
    <button
      v-else
      type="button"
      class="flex size-(--size-touch) shrink-0 items-center justify-center text-ink"
      :aria-label="t('search.add', { title: hit.book.title })"
      data-testid="search.add"
      @click="$emit('add')"
    >
      <span class="flex size-(--size-button-sm) items-center justify-center rounded-pill edge">
        <UiIcon name="plus" :size="17" />
      </span>
    </button>
  </div>
</template>
