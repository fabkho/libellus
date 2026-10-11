<script setup lang="ts">
// One search result: cover, title in the serif, author, year. Tapping it opens
// the book page (and the route change closes the search); the + opens the Add
// sheet. A Book already in the Library shows its status instead of the +; one
// the member has in another edition says so under the author, and keeps its +.
// The title takes two lines before it is cut, so a long one stays readable next
// to the status; the row presses to the stronger fill, and a pointer that can
// hover gets the lighter one across the whole row (Tailwind's `hover:` is `@media (hover: hover)`).
// `linking` (search opened by Find book, #131): the row is a button that picks
// the result for the ebook file (`pick`) instead of a link to its page: one of
// her Books links the file to it, another edition of one asks which edition,
// a new one opens the Add sheet. Its name says so ("Link the ebook to …").
// `target` (search opened by a Collection's +): the + puts the Book on that Collection ("Add … to
// {name}"), also one already in the Library; one that is on it says so instead of the + (`onTarget`).
// `adding` holds the + while its call is on its way. Offline only a Book in the Library can be added.
import { useBookStore } from '~/stores/book'
import type { SearchHit } from '~/stores/search'

const props = defineProps<{ hit: SearchHit; eager?: boolean; priority?: boolean; linking?: boolean; target?: string | null; onTarget?: boolean; adding?: boolean }>()
defineEmits<{ add: []; pick: [] }>()

const { t } = useI18n()
const book = useBookStore()
const authorLine = computed(() => formatAuthors(props.hit.book.authors, t('common.etAl')))
// Adding writes: offline the + stays, disabled, and says why (#15).
const online = useOnline()
const PressLink = resolveComponent('UiPressLink')
/** What a tap on the row does while linking, as its accessible name. */
const pickLabel = computed(() => {
  const title = props.hit.book.title
  if (props.hit.entry) return t('search.linkTo', { title })
  if (props.hit.otherEdition) return t('search.linkOtherEdition', { title })
  return t('search.addAndLink', { title })
})

/** The +: held while offline (a Book in the Library can still go onto a Collection, #93) or while its add is on its way. */
const addDisabled = computed(() => Boolean(props.adding) || (!online.value && !(props.target && props.hit.entry)))
const addLabel = computed(() => {
  const title = props.hit.book.title
  if (!online.value && !(props.target && props.hit.entry)) return t('common.offline')
  if (props.target) return t('search.addTo', { title, name: props.target })
  return props.linking && props.hit.otherEdition ? pickLabel.value : t('search.add', { title })
})
</script>

<template>
  <div class="flex min-h-(--size-row) items-center pr-xs hover:bg-fill">
    <component
      :is="linking ? 'button' : PressLink"
      v-bind="linking ? { type: 'button', 'aria-label': pickLabel } : { to: `/book/${hit.key}` }"
      class="flex min-w-0 flex-1 items-center gap-ms py-xs pl-md text-left active:bg-fill-strong"
      data-testid="search.result"
      @press="book.prefetch(hit.key)"
      @click="linking && $emit('pick')"
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
    </component>

    <span
      v-if="target ? onTarget : hit.entry"
      class="flex shrink-0 items-center gap-xs px-sm text-footnote text-ink-faint"
      data-testid="search.resultStatus"
    >
      <UiIcon name="check" :size="13" bold />{{ target ? t('search.onCollection') : t(`status.${hit.entry!.status}`) }}
    </span>
    <button
      v-else
      type="button"
      class="flex size-(--size-touch) shrink-0 items-center justify-center text-ink disabled:opacity-50"
      :disabled="addDisabled"
      :aria-label="addLabel"
      data-testid="search.add"
      @click="$emit('add')"
    >
      <span class="flex size-(--size-button-sm) items-center justify-center rounded-pill edge">
        <UiIcon name="plus" :size="17" />
      </span>
    </button>
  </div>
</template>
