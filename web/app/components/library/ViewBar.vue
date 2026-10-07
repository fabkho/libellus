<script setup lang="ts">
// The Library's filters and sort (issue #169), quiet, under the segments: a Filter and a Sort
// pill (Filter lit, with how many are set, while any is), the result count beside them, and under
// them the filters that are set as removable chips with Clear. Always one row high so nothing
// moves when a filter is set; the chips row exists only while a filter is set, and is set from
// the very first frame when the device remembers one (stores/libraryView.ts). The count is a
// polite status. The sheets (FilterSheet, SortSheet) hold the choices.
import type { EntryStatus, LibraryEntry } from '~/data/library'
import { activeFilters, isDefaultSort, sortFor, type ActiveFilter, type GenreLookup, type ListView } from '~/data/libraryView'
import { useLibraryViewStore } from '~/stores/libraryView'

const props = defineProps<{ status: EntryStatus; view: ListView; entries: readonly LibraryEntry[]; shown: number; genres: GenreLookup | null }>()

const { t, n } = useI18n()
const views = useLibraryViewStore()

const filterOpen = ref(false)
const sortOpen = ref(false)

const chips = computed(() => activeFilters(props.status, props.view, { genres: props.genres !== null }))
const sort = computed(() => sortFor(props.status, props.view.sort))
const sortName = computed(() => t(`library.view.sortKey.${sort.value.key === 'dateRead' && props.status === 'reading' ? 'dateStarted' : sort.value.key}`))
const sortChanged = computed(() => !isDefaultSort(props.status, props.view.sort))

const total = computed(() => props.entries.length)
const count = computed(() =>
  chips.value.length ? t('library.view.countOf', { shown: n(props.shown), total: n(total.value) }) : t('library.view.count', { count: n(total.value) }, total.value),
)

/** The words of a chip, which is also what removes it says. */
function chipLabel({ facet, value }: ActiveFilter): string {
  switch (facet) {
    case 'status':
      return t(`library.view.status.${value}`)
    case 'readAs':
      return t(`library.view.readAs.${value}`)
    case 'author':
      return value
    case 'rating':
      return value === 'unrated' ? t('library.view.rating.unrated') : Number(value) === 20 ? t('library.view.rating.top') : t('library.view.rating.min', { stars: Number(value) / 4 })
    case 'year':
      return value || t('library.undated')
    case 'pages': {
      const { min, max } = props.view.pages
      if (min !== null && max !== null) return t('library.view.pages.chip', { min: n(min), max: n(max) })
      return min !== null ? t('library.view.pages.chipMin', { min: n(min) }) : t('library.view.pages.chipMax', { max: n(max ?? 0) })
    }
    case 'genre':
      return t(`genre.${value}`)
  }
}
</script>

<template>
  <div class="pt-md" role="group" :aria-label="t('library.view.label')" data-testid="library.view">
    <div class="flex h-(--size-button-sm) items-center gap-sm">
      <UiPill :pressed="chips.length > 0" :count="chips.length || undefined" data-testid="library.view.filter" @click="filterOpen = true">
        {{ t('library.view.filter') }}
      </UiPill>
      <UiPill :pressed="sortChanged" data-testid="library.view.sort" @click="sortOpen = true">
        {{ t('library.view.sortBy', { sort: sortName }) }}
      </UiPill>
      <p class="figures ml-auto min-w-0 truncate text-caption text-ink-faint" role="status" data-testid="library.view.count">{{ count }}</p>
    </div>

    <div v-if="chips.length" class="mt-sm flex items-center gap-sm" data-testid="library.view.chips">
      <ul class="chips flex min-w-0 flex-1 gap-sm overflow-x-auto" :aria-label="t('library.view.chipsLabel')">
        <li v-for="chip in chips" :key="`${chip.facet}:${chip.value}`" class="shrink-0">
          <button
            type="button"
            class="chip relative inline-flex h-(--size-button-sm) items-center gap-xs rounded-pill bg-fill px-md text-caption text-ink"
            :aria-label="t('library.view.removeChip', { name: chipLabel(chip) })"
            data-testid="library.view.chip"
            @click="views.remove(status, chip)"
          >
            {{ chipLabel(chip) }}
            <UiIcon name="close" :size="11" class="text-ink-faint" />
          </button>
        </li>
      </ul>
      <UiButton tone="plain" size="sm" class="shrink-0" data-testid="library.view.clear" @click="views.clear(status)">{{ t('library.view.clear') }}</UiButton>
    </div>

    <LibraryFilterSheet v-model:open="filterOpen" :status="status" :entries="entries" :view="view" :genres="genres" @apply="views.set(status, $event)" />
    <LibrarySortSheet v-model:open="sortOpen" :status="status" :sort="view.sort" @choose="views.setSort(status, $event)" />
  </div>
</template>

<style scoped>
/* The chips scroll sideways on a narrow screen without a bar; their touch target is the pill's height plus. */
.chips {
  scrollbar-width: none;
}
.chip::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
