<script setup lang="ts">
// One work on an author page or in a series sheet (#167): small cover, serif
// title, a mono line with its place ("Book 3") and year, and her status beside
// it — ✓ with her Rating, Reading, Want to read — or, for a work she does not
// have, "+ Want to read", which opens the Add sheet on the edition in her
// language (Want to read chosen). The row opens the Book's page from the
// touch-down, its cover flying into the hero; a work with no edition to open
// is a plain row, and where it has no edition we could add, "Find" opens the
// search with its title (and author), as a scanned book nothing knows does, so
// she can add the edition search finds. `trailing` is a slot after the status (Home's series
// rows put their "..." menu there). Her status follows what this device
// knows of her Library, so a Start or an add elsewhere shows here at once.
import { isNotFinished } from '~/data/library'
import type { WorkCard } from '~/data/enrich'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'

const props = withDefaults(defineProps<{
  work: WorkCard
  /** Its place in the list it is in: "Book 3", or none. */
  place?: string | null
  /** The Book the list was opened from (the series sheet): marked as this one. */
  current?: boolean
  testid: string
  eager?: boolean
  /** Whether the mono line shows the year (Home's row says only where the Book stands). */
  year?: boolean
  /** The author's name, for the search "Find" opens. */
  author?: string | null
}>(), { place: null, year: true, author: null })

const { t } = useI18n()
const books = useBookStore()
const library = useLibraryStore()
const online = useOnline()
const PressLink = resolveComponent('UiPressLink')

const key = computed(() => workBookKey(props.work))
const cover = computed(() => workCover(props.work))
/** Her entry as this device knows it now, else as the page was read. */
const live = computed(() => {
  const bookId = props.work.entry?.bookId
  if (bookId) return library.entryForBook(bookId) ?? library.entryByKey.get(bookId) ?? null
  // A work she added from here or from its page: the Book's page (by the edition's key) knows her entry.
  return key.value ? (books.page(key.value)?.entry ?? library.entryByKey.get(key.value) ?? null) : null
})
const status = computed(() => live.value?.status ?? props.work.entry?.status ?? null)
const rating = computed(() => (live.value ? (live.value.latestSession?.rating ?? null) : (props.work.entry?.rating ?? null)))
const notFinished = computed(() => (live.value ? isNotFinished(live.value) : false))
const meta = computed(() => [props.place, props.year && props.work.year ? String(props.work.year) : null].filter(Boolean).join(' · '))

// "Find": no edition to add, so the search looks for one (the palette opens over the page).
const search = useSearchStore()
function find() {
  search.open()
  search.query = [props.work.title, props.author].filter(Boolean).join(' ')
}

// "+ Want to read": the edition's Book (the Catalogue's, else what a source says of it), then the Add sheet.
const opening = ref(false)
async function want() {
  const k = key.value
  if (!k || opening.value) return
  opening.value = true
  try {
    await books.load(k)
    const found = books.page(k)
    if (found?.book && !found.entry) library.openAdd(found.book)
    else if (found?.entry) return
    else await navigateTo(`/book/${k}`)
  } finally {
    opening.value = false
  }
}
</script>

<template>
  <li class="row flex items-center gap-sm" :data-testid="testid" :data-current="current ? '' : undefined">
    <component
      :is="key ? PressLink : 'div'"
      v-bind="key ? { to: `/book/${key}` } : {}"
      class="flex min-w-0 flex-1 items-center gap-inset py-sm"
      :data-testid="key ? `${testid}Link` : undefined"
      :aria-current="current ? 'page' : undefined"
      @press="key && books.prefetch(key)"
    >
      <UiCover decorative :title="work.title" :src="coverSrc(cover, 'sm')" size="sm" :eager="eager" :class="notFinished && 'dimmed'" />
      <span class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="book-title title-wrap text-body-large" :data-testid="`${testid}Title`">{{ work.title }}</span>
        <span v-if="meta || current" class="figures flex items-center gap-xs text-meta text-ink-faint">
          <span v-if="meta" :data-testid="`${testid}Meta`">{{ meta }}</span>
          <template v-if="current">
            <span v-if="meta" class="dot" aria-hidden="true" />
            <span class="text-accent-ink" :data-testid="`${testid}Current`">{{ t('series.thisBook') }}</span>
          </template>
        </span>
      </span>
    </component>

    <!-- Her status and the way to add the work share one cell, so neither moves the row; when one takes the
         other's place (a Want to read just added) the button fades away and the status arrives in its stead. -->
    <div class="state grid shrink-0 justify-items-end">
      <Transition name="state">
        <span v-if="status" key="status" class="status col-start-1 row-start-1 flex items-center gap-xs text-footnote text-ink-faint" :data-testid="`${testid}Status`">
          <template v-if="status === 'finished' && !notFinished">
            <UiIcon name="check" :size="13" bold class="text-ink-muted" />
            <span class="sr-only">{{ t('status.finished') }}</span>
            <UiStars v-if="rating" :quarters="rating" :show-value="false" />
          </template>
          <template v-else-if="notFinished">
            <UiIcon name="slash" :size="12" />{{ t('status.notFinished') }}
          </template>
          <template v-else-if="status === 'reading'">
            <span class="lamp" aria-hidden="true" />{{ t('author.reading') }}
          </template>
          <template v-else>{{ t('status.want_to_read') }}</template>
        </span>
        <button
          v-else-if="key"
          key="want"
          type="button"
          class="want col-start-1 row-start-1 relative inline-flex h-(--size-button-sm) shrink-0 items-center gap-xxs rounded-pill pr-ms pl-sm text-footnote text-ink-muted edge disabled:opacity-50"
          :disabled="!online || opening"
          :aria-label="online ? t('author.wantLabel', { title: work.title }) : t('common.offline')"
          :data-testid="`${testid}Want`"
          @click="want"
        >
          <template v-if="online"><UiIcon name="plus" :size="14" bold />{{ t('author.want') }}</template>
          <template v-else><UiIcon name="offline" :size="14" />{{ t('common.offline') }}</template>
        </button>
        <button
          v-else
          key="find"
          type="button"
          class="want col-start-1 row-start-1 relative inline-flex h-(--size-button-sm) shrink-0 items-center gap-xxs rounded-pill pr-ms pl-sm text-footnote text-ink-muted edge disabled:opacity-50"
          :disabled="!online"
          :aria-label="online ? t('author.findLabel', { title: work.title }) : t('common.offline')"
          :data-testid="`${testid}Find`"
          @click="find"
        >
          <template v-if="online"><UiIcon name="search" :size="14" bold />{{ t('author.find') }}</template>
          <template v-else><UiIcon name="offline" :size="14" />{{ t('common.offline') }}</template>
        </button>
      </Transition>
    </div>
    <slot name="trailing" />
  </li>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}

.dimmed {
  opacity: 0.45;
  filter: grayscale(0.6);
}

.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}

.lamp {
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-sm) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 50%, transparent);
}

/* The drawn pill is 32 px; the touch target stays 44. */
.want::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}

/* A Want to read just added (or a Start from another screen): the button fades away over `exit`, and her status
   arrives in its place once the Add sheet has fallen away (`sheet-exit`): it rises the last `xs` and lights in the
   accent, then settles to its quiet colour, as the tally's new mark does (docs/MOTION.md, "Want to read, added in a row"). */
.state-leave-active {
  pointer-events: none;
  transition:
    opacity var(--duration-exit) var(--ease-exit),
    transform var(--duration-exit) var(--ease-exit);
}
.state-leave-to {
  opacity: 0;
  transform: scale(0.97);
}
.state-enter-active {
  animation: state-arrive calc(2 * var(--duration-sheet)) var(--ease-standard) var(--duration-sheet-exit) both;
}

@keyframes state-arrive {
  from {
    opacity: 0;
    transform: translateY(var(--spacing-xs));
    color: var(--color-accent-ink);
  }
  35% {
    opacity: 1;
    transform: none;
    color: var(--color-accent-ink);
  }
}

@media (prefers-reduced-motion: reduce) {
  .state-enter-active {
    animation-delay: 0s;
  }
}
</style>
