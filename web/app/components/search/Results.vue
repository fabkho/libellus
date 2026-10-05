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
import { SEARCH_DEBOUNCE_MS } from '~/data/search'
import { durationToken, easingToken, prefersReducedMotion } from '~/utils/motion'

const { t } = useI18n()
const search = useSearchStore()
const library = useLibraryStore()
const manual = useManualStore()
const online = useOnline()

/**
 * How many covers at the bottom of the list (the ones visible above the
 * keyboard) load at once, ahead of everything else. The rest load once they
 * come within a list height of the view (useNearView: the list's fade, a
 * mask, keeps the browser's own lazy loading from looking ahead; issue #63).
 */
const FIRST_COVERS = 6
const list = ref<HTMLElement | null>(null)
const nearby = useNearView(list)

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

// Dev only (design round): which loading idea shows. Outside dev it is always
// `o`, the single ghost row.
const devLoading = useSearchDev().loading

// Between loading and results (or back) the palette changes height, and it
// grows from the query upwards: the room glides to its new height over
// `standard` instead of jumping, the loading state fading out where it stood
// and the first rows rising in over it (docs/MOTION.md, Move only what
// changed). With Reduce Motion the height just changes.
/**
 * How long a search waits before it shows a loading state at all: the typing
 * pause before a query goes out plus `quick`, so an answer that comes straight
 * back shows no loading, not a flash of it.
 */
const loadingWait = ref(SEARCH_DEBOUNCE_MS)
onMounted(() => (loadingWait.value = SEARCH_DEBOUNCE_MS + durationToken('quick')))
const root = useTemplateRef<HTMLElement>('root')
let heightBefore = 0
let cameFrom: string | null = null
let gliding: Animation | undefined
const arriving = ref(false)
let arrivingTimer: ReturnType<typeof setTimeout> | undefined
watch(
  state,
  (_next, previous) => {
    heightBefore = root.value?.offsetHeight ?? 0
    cameFrom = previous ?? null
  },
  { flush: 'pre' },
)
watch(
  state,
  (next) => {
    const el = root.value
    if (!el || (next !== 'loading' && cameFrom !== 'loading') || prefersReducedMotion()) return
    if (next === 'results') {
      arriving.value = true
      clearTimeout(arrivingTimer)
      arrivingTimer = setTimeout(() => (arriving.value = false), durationToken('standard') * 3)
    }
    const heightAfter = el.offsetHeight
    gliding?.cancel()
    if (!heightBefore || heightBefore === heightAfter) return
    // The loading state opens its room only once it shows itself (see loadingWait).
    gliding = el.animate(
      [
        { height: `${heightBefore}px`, overflow: 'hidden' },
        { height: `${heightAfter}px`, overflow: 'hidden' },
      ],
      {
        duration: durationToken('standard'),
        easing: easingToken('standard'),
        delay: next === 'loading' ? loadingWait.value : 0,
        fill: 'backwards',
      },
    )
  },
  { flush: 'post' },
)
onBeforeUnmount(() => clearTimeout(arrivingTimer))

// The first covers are asked for as soon as the results land, before the rows
// render, so they are on their way while the list lays out.
watch(
  () => search.hits,
  (hits) => {
    for (const hit of hits.slice(0, FIRST_COVERS)) preloadImage(coverSrc(hit.book.coverUrl, 'sm'))
  },
)
</script>

<template>
  <div ref="root" class="relative flex min-h-0 flex-col" aria-live="polite">
    <p v-if="state === 'idle'" class="px-lg py-lg text-center text-caption text-ink-faint" data-testid="search.empty">
      {{ t('search.empty') }}
    </p>

    <!-- Leaves over the results arriving where it stood (see .loading-leave-active). -->
    <Transition name="loading">
      <SearchLoading v-if="state === 'loading'" :variant="devLoading" :query="search.query.trim()" :style="{ '--loading-wait': `${loadingWait}ms` }" />
    </Transition>

    <ol
      v-if="state === 'results'"
      ref="list"
      class="list flex flex-col-reverse overflow-y-auto overscroll-contain py-xs transition-opacity duration-(--duration-standard) ease-standard"
      :class="[stale && 'opacity-60', arriving && 'arriving']"
      :style="listStyle"
      :aria-busy="stale"
      data-no-swipe
      data-testid="search.results"
    >
      <li
        v-for="(hit, index) in search.hits"
        :key="hit.key"
        :ref="nearby.observe"
        :data-near-key="hit.key"
        :style="index < 5 ? { '--n': index } : undefined"
      >
        <SearchResultRow
          :hit="hit"
          :eager="index < FIRST_COVERS || nearby.has(hit.key)"
          :priority="index < FIRST_COVERS"
          @add="library.openAdd(hit.book)"
        />
      </li>
      <!--
        Last in a reversed list: at its far end, above the weakest match. The list fades out over its
        first `xxl` (see .list), so a line here starts below the fade, not under it.
      -->
      <li v-if="search.fromLibrary" class="px-md pt-xxl pb-xs text-center text-footnote text-ink-faint" data-testid="search.offline">
        {{ t('search.offlineNote') }}
      </li>
      <li v-else-if="!isbnQuery" class="px-md pt-xxl pb-xs text-center text-footnote text-ink-faint" data-testid="search.hint">
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

    <div v-else-if="state === 'failed'" class="px-ml pt-ml pb-md" data-testid="search.failed">
      <p class="text-callout font-medium">{{ t('search.failedTitle') }}</p>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('search.failed') }}</p>
    </div>
  </div>
</template>

<style scoped>
/* The far end of the list (the top, the weakest matches) fades out, over `xxl`: the note at that end is padded by as much. */
.list {
  touch-action: pan-y;
  -webkit-mask-image: linear-gradient(to bottom, transparent, black var(--spacing-xxl));
  mask-image: linear-gradient(to bottom, transparent, black var(--spacing-xxl));
}

/* The loading state leaves over the room the results arrive in, fading, so the first rows rise in where it stood. */
.loading-leave-active {
  position: absolute;
  inset: auto 0 0;
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.loading-leave-to {
  opacity: 0;
}

/* The best matches (the bottom rows) land one after the other; the weaker ones are simply there. */
.arriving > li[style] {
  animation: row-arrive var(--duration-standard) var(--ease-standard) calc(var(--n) * var(--duration-instant) * 0.5) both;
}
@keyframes row-arrive {
  from {
    opacity: 0;
    translate: 0 var(--spacing-sm);
  }
}
</style>
