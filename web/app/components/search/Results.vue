<script setup lang="ts">
// What the search palette shows above its query (the overlay's default slot):
// one list, best match at the bottom next to the query, the weaker ones
// climbing away from the thumb and fading out at the top. Where a result
// comes from is never shown (owner decision on #6): one field, one list that
// fills as the sources answer, and one quiet loading state until the first
// answer brings something.
//
// States: idle (nothing typed yet) · loading (no results yet) · results
// (dimmed while a newer query is on its way) · no results · failed (no source
// could answer). Offline the member's own Library answers instead (#15), and
// one quiet line says so where the hint would be.
import { parseIsbn } from '~/data/books'
import { useLibraryStore } from '~/stores/library'
import { useManualStore } from '~/stores/manual'
import { useSearchStore } from '~/stores/search'

const { t } = useI18n()
const search = useSearchStore()
const library = useLibraryStore()
const manual = useManualStore()
const online = useOnline()

/** How many covers at the bottom of the list (the visible ones) load at once. */
const EAGER_COVERS = 6

// The list may grow up to what the screen leaves above the query row; with the
// keyboard up, the visual viewport is the part above it.
const viewport = ref<number | null>(null)
function measure() {
  viewport.value = window.visualViewport?.height ?? window.innerHeight
}
onMounted(() => {
  measure()
  window.visualViewport?.addEventListener('resize', measure)
  window.addEventListener('resize', measure)
})
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', measure)
  window.removeEventListener('resize', measure)
})
const listStyle = computed(() =>
  viewport.value ? { maxHeight: `calc(${viewport.value}px - var(--size-query) - env(safe-area-inset-top) - var(--spacing-xxxl))` } : {},
)

const stale = computed(() => search.outdated)
/** An ISBN found its edition already: no hint to search one. */
const isbnQuery = computed(() => parseIsbn(search.answered) !== null)
const state = computed(() => {
  if (search.phase === 'idle') return 'idle'
  if (search.hits.length) return 'results'
  if (search.phase === 'loading') return 'loading'
  if (search.phase === 'failed') return 'failed'
  return 'none'
})

// The first covers are asked for as soon as the results land, before the rows
// render, so they are on their way while the list lays out.
watch(
  () => search.hits,
  (hits) => {
    for (const hit of hits.slice(0, EAGER_COVERS)) preloadImage(coverSrc(hit.book.coverUrl, 'sm'))
  },
)
</script>

<template>
  <div class="flex min-h-0 flex-col" aria-live="polite">
    <p v-if="state === 'idle'" class="px-lg py-lg text-center text-caption text-ink-faint" data-testid="search.empty">
      {{ t('search.empty') }}
    </p>

    <div v-else-if="state === 'loading'" class="flex items-center gap-ms py-xs pr-ms pl-md" data-testid="search.loading">
      <span class="ghost-cover shrink-0 rounded-cover-sm bg-fill" aria-hidden="true" />
      <span class="flex flex-1 flex-col gap-xs" aria-hidden="true">
        <span class="ghost-line w-3/5 rounded-pill bg-fill" />
        <span class="ghost-line w-2/5 rounded-pill bg-fill" />
      </span>
      <span class="sr-only">{{ t('search.loading') }}</span>
    </div>

    <ol
      v-else-if="state === 'results'"
      class="list flex flex-col-reverse overflow-y-auto overscroll-contain py-xs transition-opacity duration-(--duration-standard) ease-standard"
      :class="stale && 'opacity-60'"
      :style="listStyle"
      :aria-busy="stale"
      data-no-swipe
      data-testid="search.results"
    >
      <li v-for="(hit, index) in search.hits" :key="hit.key">
        <SearchResultRow :hit="hit" :eager="index < EAGER_COVERS" @add="library.openAdd(hit.book)" />
      </li>
      <!-- Last in a reversed list: at its far end, above the weakest match. -->
      <li v-if="search.fromLibrary" class="px-md pt-sm pb-xs text-center text-footnote text-ink-faint" data-testid="search.offline">
        {{ t('search.offlineNote') }}
      </li>
      <li v-else-if="!isbnQuery" class="px-md pt-sm pb-xs text-center text-footnote text-ink-faint" data-testid="search.hint">
        {{ t('search.hint') }}
      </li>
    </ol>

    <div v-else-if="state === 'none' && search.fromLibrary" class="px-ml pt-ml pb-md" data-testid="search.noResults">
      <p class="text-callout font-medium">{{ t('search.noResultsTitle') }}</p>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('search.offlineNoResults', { query: search.answered }) }}</p>
      <p class="mt-md text-footnote text-ink-faint" data-testid="search.offline">{{ t('search.offlineNote') }}</p>
    </div>

    <div v-else-if="state === 'none'" class="px-ml pt-ml pb-md" data-testid="search.noResults">
      <p class="text-callout font-medium">{{ t('search.noResultsTitle') }}</p>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('search.noResults', { query: search.answered }) }}</p>
      <p class="mt-md text-subhead text-ink-faint">{{ t('search.noResultsHint') }}</p>
      <UiButton tone="quiet" block class="mt-ml" :offline="!online" data-testid="search.addManually" @click="manual.open(search.answered)">
        <UiIcon name="pencil" :size="17" />{{ t('search.addManually') }}
      </UiButton>
    </div>

    <div v-else class="px-ml pt-ml pb-md" data-testid="search.failed">
      <p class="text-callout font-medium">{{ t('search.failedTitle') }}</p>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('search.failed') }}</p>
    </div>
  </div>
</template>

<style scoped>
/* The far end of the list (the top, the weakest matches) fades out. */
.list {
  touch-action: pan-y;
  -webkit-mask-image: linear-gradient(to bottom, transparent, black var(--spacing-xxl));
  mask-image: linear-gradient(to bottom, transparent, black var(--spacing-xxl));
}

.ghost-cover {
  width: var(--size-cover-sm);
  aspect-ratio: 2 / 3;
}

.ghost-line {
  display: block;
  height: var(--spacing-sm);
}
</style>
