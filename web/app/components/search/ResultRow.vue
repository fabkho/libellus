<script setup lang="ts">
// One search result: cover, title in the serif, author, year. Tapping it opens
// the book page (and the route change closes the search); the + opens the Add
// sheet. A Book already in the Library shows its status instead of the +; one
// the member has in another edition says so under the author, and keeps its +.
// The title takes two lines before it is cut, so a long one stays readable next
// to the status; the row presses to the stronger fill, and a pointer that can
// hover gets the lighter one across the whole row (Tailwind's `hover:` is `@media (hover: hover)`).
import { useBookStore } from '~/stores/book'
import type { SearchHit } from '~/stores/search'

const props = defineProps<{ hit: SearchHit; eager?: boolean; priority?: boolean }>()
defineEmits<{ add: [] }>()

const { t } = useI18n()
const book = useBookStore()
const authorLine = computed(() => formatAuthors(props.hit.book.authors, t('common.etAl')))
// Adding writes: offline the + stays, disabled, and says why (#15).
const online = useOnline()
</script>

<template>
  <div class="flex min-h-(--size-row) items-center pr-xs hover:bg-fill">
    <UiPressLink
      :to="`/book/${hit.key}`"
      class="flex min-w-0 flex-1 items-center gap-ms py-xs pl-md active:bg-fill-strong"
      data-testid="search.result"
      @press="book.prefetch(hit.key)"
    >
      <UiCover
        decorative
        :title="hit.book.title"
        :authors="hit.book.authors"
        :src="coverSrc(hit.book.coverUrl, 'sm')"
        :fallbacks="coverFallbacks(hit.book, 'sm')"
        :thumbhash="hit.book.coverThumbhash"
        :colors="hit.book.coverColors"
        size="sm"
        :eager="eager"
        :priority="priority"
      />
      <span class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="book-title line-clamp-2 text-body" data-testid="search.resultTitle">{{ hit.book.title }}</span>
        <span class="truncate text-caption text-ink-faint">{{ authorLine }}</span>
        <span v-if="hit.book.year || hit.otherEdition" class="flex min-w-0 items-center gap-xs text-ink-faint">
          <span v-if="hit.book.year" class="figures shrink-0 text-meta">{{ hit.book.year }}</span>
          <span v-if="hit.book.year && hit.otherEdition" class="size-(--spacing-xxs) shrink-0 rounded-pill bg-current" aria-hidden="true" />
          <span
            v-if="hit.otherEdition"
            class="flex min-w-0 items-center gap-xxs text-footnote text-ink-muted"
            data-testid="search.resultOtherEdition"
          >
            <UiIcon name="stack" :size="12" class="shrink-0" />
            <span class="truncate">{{ t('search.otherEdition') }}</span>
          </span>
        </span>
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
      class="flex size-(--size-touch) shrink-0 items-center justify-center text-ink disabled:opacity-50"
      :disabled="!online"
      :aria-label="online ? t('search.add', { title: hit.book.title }) : t('common.offline')"
      data-testid="search.add"
      @click="$emit('add')"
    >
      <span class="flex size-(--size-button-sm) items-center justify-center rounded-pill edge">
        <UiIcon name="plus" :size="17" />
      </span>
    </button>
  </div>
</template>

