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
// Her own Books the query is about come first, as a small group "In your
// Library" next to the query (#131, `search.own`), at once and before any
// source answers; the results the sources found follow without them. Opened by
// Find book (`search.linking`), a tap picks a result for the ebook file
// instead of opening its page (`pick`). Opened by a Collection's + (`search.target`), the + of a row
// puts that Book on the Collection (one already on it shows a check) and the palette stays open for the
// next one; the lines that would hint at searching name the Collection, and say that a Book new to the
// Library goes onto Want to read.
import { parseIsbn } from '~/data/books'
import { useEbooksStore } from '~/stores/ebooks'
import { useLibraryStore } from '~/stores/library'
import { useCollectionsStore } from '~/stores/collections'
import { useManualStore } from '~/stores/manual'
import { useSearchStore, type SearchHit } from '~/stores/search'
import { SEARCH_DEBOUNCE_MS } from '~/data/search'
import { durationToken, easingToken, prefersReducedMotion } from '#layers/ui/app/utils/motion'

const coverHosts = useCoverHosts() // our stored copies and `/cover`, as this build has them (utils/coverRef.ts)

const { t } = useI18n()
const search = useSearchStore()
const library = useLibraryStore()
const manual = useManualStore()
const ebooks = useEbooksStore()
const collections = useCollectionsStore()
const online = useOnline()

/**
 * A tap on a row while linking (Find book, #131): one of her Books links the
 * file to it, another edition of one asks which edition the file is, a new
 * Book opens the Add sheet (and is linked once added).
 */
function pick(hit: SearchHit) {
  if (hit.entry) void ebooks.linkFound(hit.entry)
  else if (hit.otherEdition) ebooks.chooseEdition(hit.book, ownEntries())
  // Linked to the file once added: that needs the database's own entry id, so it is not waited out.
  else library.openAdd(hit.book)
}

/** Her entries as the group shows them (read when search opened). */
const ownEntries = () => search.own.map((hit) => hit.entry!)

// Aimed at a Collection (its + opened search): the Books already on it, and the adds on their way.
const targetName = computed(() => search.target?.name ?? null)
const onTargetIds = computed(() => {
  const target = search.target
  return new Set(target ? (collections.page(target.id)?.collection?.entries ?? []).map((entry) => entry.id) : [])
})
const onTarget = (hit: SearchHit) => Boolean(hit.entry && onTargetIds.value.has(hit.entry.id))
const adding = reactive(new Set<string>())
const addError = ref<string | null>(null)
watch(() => [search.query, search.target?.id], () => (addError.value = null))

/** The + of a result aimed at a Collection: one call puts the Book on it (and on Want to read first when it is new). */
async function addToTarget(hit: SearchHit) {
  const target = search.target
  if (!target || adding.has(hit.key)) return
  adding.add(hit.key)
  addError.value = null
  try {
    const result = await collections.addBook(target.id, hit.book, hit.key)
    // Already on it is where she wanted it to be.
    if (result.error && result.error !== 'already_in_collection') addError.value = result.error
  } finally {
    adding.delete(hit.key)
  }
}

/** The +: the Add sheet; while linking, another edition of one of her Books asks first (never a second entry unasked). */
function add(hit: SearchHit) {
  if (search.target) void addToTarget(hit)
  else addInLibrary(hit)
}

function addInLibrary(hit: SearchHit) {
  if (search.linking && hit.otherEdition) ebooks.chooseEdition(hit.book, ownEntries())
  // The + of a result: she sees the Book on her shelf at once, the outbox sends it (stores/library.ts, confirmAdd).
  else library.openAdd(hit.book, { optimistic: !search.linking })
}

/**
 * How many covers at the bottom of the list (the ones visible above the
 * keyboard) load at once, ahead of everything else. The rest load once they
 * come within a list height of the view (useNearView: the list's fade, a
 * mask, keeps the browser's own lazy loading from looking ahead; issue #63).
 */
const FIRST_COVERS = 6
const list = ref<HTMLElement | null>(null)
const nearby = useNearView(list)

// The palette's room (composables/usePaletteRoom.ts): this fills it and stands its content at its
// bottom, the list too (it scrolls once its rows reach the room's top). The palette draws how much
// of the room the content fills, and glides to it when asked (below).
const room = usePaletteRoom()

const stale = computed(() => search.outdated)
/** An ISBN found its edition already: no hint to search one. */
const isbnQuery = computed(() => parseIsbn(search.answered) !== null)
const state = computed(() => {
  if (search.phase === 'idle') return 'idle'
  if (search.hits.length || search.own.length) return 'results'
  if (search.phase === 'loading') return 'loading'
  if (search.phase === 'failed') return 'failed'
  return 'none'
})

// Between loading and results (or back) the palette changes height, and it
// grows from the query upwards: the room glides to its new height over
// `standard` instead of jumping, the loading state fading out where it stood
// and the first rows rising in over it (docs/MOTION.md, Search loading). With
// Reduce Motion the height just changes.
/**
 * How long a search waits before it shows a loading state at all: the typing
 * pause before a query goes out plus `quick`, so an answer that comes straight
 * back shows no loading, not a flash of it.
 */
const loadingWait = ref(SEARCH_DEBOUNCE_MS)
onMounted(() => (loadingWait.value = SEARCH_DEBOUNCE_MS + durationToken('quick')))
let cameFrom: string | null = null
const arriving = ref(false)
let arrivingTimer: ReturnType<typeof setTimeout> | undefined
watch(
  state,
  (_next, previous) => {
    cameFrom = previous ?? null
  },
  { flush: 'pre' },
)
watch(
  state,
  (next) => {
    if ((next !== 'loading' && cameFrom !== 'loading') || prefersReducedMotion()) return
    if (next === 'results') {
      arriving.value = true
      clearTimeout(arrivingTimer)
      arrivingTimer = setTimeout(() => (arriving.value = false), durationToken('standard') * 3)
    }
    // The loading state opens its room only once it shows itself (see loadingWait). The palette
    // measures the new content right after this (its mutation observer) and glides to it.
    room?.glide(next === 'loading' ? loadingWait.value : 0)
  },
  { flush: 'post' },
)
onBeforeUnmount(() => clearTimeout(arrivingTimer))

// The first covers are asked for as soon as the results land, before the rows
// render, so they are on their way while the list lays out.
watch(
  () => [...search.own, ...search.others],
  (hits) => {
    for (const hit of hits.slice(0, FIRST_COVERS)) preloadImage(coverImage(hit.book, 'sm', coverHosts).src)
  },
)
</script>

<template>
  <!-- Fills the palette's room, its content at the bottom (usePaletteRoom.ts): an answer never moves what is on screen. -->
  <div class="relative flex min-h-0 flex-1 flex-col justify-end" aria-live="polite" data-room>
    <p v-if="state === 'idle'" class="px-lg py-lg text-center text-caption text-ink-faint" data-testid="search.empty">
      {{ targetName ? t('search.emptyTarget', { name: targetName }) : t('search.empty') }}
    </p>

    <!-- Leaves over the results arriving where it stood (see .loading-leave-active). -->
    <Transition name="loading">
      <SearchLoading v-if="state === 'loading'" :style="{ '--loading-wait': `${loadingWait}ms` }" />
    </Transition>

    <ol
      v-if="state === 'results'"
      ref="list"
      class="list flex min-h-0 flex-1 flex-col-reverse overflow-y-auto overscroll-contain py-xs transition-opacity duration-(--duration-standard) ease-standard"
      :class="[stale && 'opacity-60', arriving && 'arriving']"
      data-room
      :aria-busy="stale"
      data-no-swipe
      data-testid="search.results"
    >
      <!--
        Her own Books first ("In your Library"), nearest the query: in a reversed list the group is
        the first item, its best match at its bottom and its label at its top, over the other results.
      -->
      <li v-if="search.own.length" class="own" data-testid="search.own">
        <div class="flex flex-col-reverse">
          <SearchResultRow
            v-for="(hit, index) in search.own"
            :key="hit.key"
            :hit="hit"
            :ref="nearby.observe"
            :data-near-key="hit.key"
            :linking="search.linking"
            :target="targetName"
            :on-target="onTarget(hit)"
            :adding="adding.has(hit.key)"
            :eager="index < FIRST_COVERS || nearby.has(hit.key)"
            :priority="index < FIRST_COVERS"
            data-testid="search.ownResult"
            @pick="pick(hit)"
            @add="add(hit)"
          />
          <h3 class="eyebrow px-md pt-ms pb-xxs" data-testid="search.ownLabel">{{ t('search.inLibrary') }}</h3>
        </div>
      </li>
      <li
        v-for="(hit, index) in search.others"
        :key="hit.key"
        :ref="nearby.observe"
        :data-near-key="hit.key"
        :style="index < 5 ? { '--n': index } : undefined"
      >
        <SearchResultRow
          :hit="hit"
          :linking="search.linking"
          :target="targetName"
          :on-target="onTarget(hit)"
          :adding="adding.has(hit.key)"
          :eager="index < FIRST_COVERS || nearby.has(hit.key)"
          :priority="index < FIRST_COVERS"
          @pick="pick(hit)"
          @add="add(hit)"
        />
      </li>
      <!--
        Last in a reversed list: at its far end, above the weakest match. The list fades out over its
        first `xxl` (see .list), so a line here starts below the fade, not under it.
      -->
      <li v-if="search.fromLibrary" class="px-md pt-xxl pb-xs text-center text-footnote text-ink-faint" data-testid="search.offline">
        {{ t('search.offlineNote') }}
      </li>
      <li v-else-if="targetName" class="px-md pt-xxl pb-xs text-center text-footnote text-ink-faint" data-testid="search.targetNote">
        {{ t('search.targetNote', { name: targetName }) }}
      </li>
      <li v-else-if="!isbnQuery" class="px-md pt-xxl pb-xs text-center text-footnote text-ink-faint" data-testid="search.hint">
        {{ t('search.hint') }}
      </li>
    </ol>
    <p v-if="addError" class="px-md py-xs text-center text-caption text-error" role="alert" data-testid="search.addError">
      {{ t(`collections.error.${addError}`) }}
    </p>

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

/* Her own group stands apart from the results above it by a hairline (in a reversed list, above is the end). */
.own + li[data-near-key] {
  border-bottom: var(--stroke-hairline) solid var(--color-hairline);
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
