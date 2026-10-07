<script setup lang="ts">
// Filter (issue #169): every facet the Status list can be filtered by, as quiet pills in one
// sheet: Read as, Author, Rating, Year read, Pages, and Genre once the Catalogue has genres
// (#168; no section until the store has a lookup). The sheet works on a copy of the list's
// view: the live count at the top and the action ("Apply") show what it would leave, Cancel
// leaves the Library as it was. A facet with nothing to choose from (no Read as set on any
// book here, no year read) is not offered.
import type { EntryStatus, LibraryEntry } from '~/data/library'
import {
  arrange,
  authorOptions,
  FACETS,
  genreOptions,
  readAsOptions,
  RATING_MINIMUMS,
  statusOptions,
  yearOptions,
  type Facet,
  type FinishedStatus,
  type GenreLookup,
  type ListView,
  type RatingChoice,
  type ReadAsChoice,
} from '~/data/libraryView'

const props = defineProps<{ status: EntryStatus; entries: readonly LibraryEntry[]; view: ListView; genres: GenreLookup | null }>()
const emit = defineEmits<{ apply: [view: ListView] }>()
const open = defineModel<boolean>('open', { required: true })

const { t, te, n } = useI18n()

/** The view as the sheet has it so far. */
const draft = ref<ListView>(clone(props.view))
const query = ref('')

function clone(view: ListView): ListView {
  return { ...view, readAs: [...view.readAs], authors: [...view.authors], years: [...view.years], pages: { ...view.pages }, genres: [...view.genres] }
}

watch(open, (now) => {
  if (!now) return
  draft.value = clone(props.view)
  query.value = ''
})

const left = computed(() => arrange(props.entries, props.status, draft.value, { genres: props.genres }).length)

/** The options of a facet: those the entries have, and any already chosen that none has (so it can be turned off). */
function withChosen(options: { value: string; count: number }[], chosen: readonly string[]) {
  return [...options, ...chosen.filter((c) => !options.some((o) => o.value === c)).map((value) => ({ value, count: 0 }))]
}

const facets = computed<Facet[]>(() => FACETS[props.status].filter((facet) => facet !== 'genre' || props.genres))
const statuses = computed(() => withChosen(statusOptions(props.entries), draft.value.status ? [draft.value.status] : []))
const readAs = computed(() => withChosen(readAsOptions(props.entries), draft.value.readAs))
const years = computed(() => withChosen(yearOptions(props.entries), draft.value.years))
const genreChoices = computed(() => withChosen(genreOptions(props.entries, props.genres), draft.value.genres))
const authors = computed(() => {
  const all = withChosen(authorOptions(props.entries), draft.value.authors)
  const needle = query.value.trim().toLocaleLowerCase()
  const found = needle ? all.filter((a) => a.value.toLocaleLowerCase().includes(needle)) : all
  // The chosen first, then the most read, as many as fit a phone's glance; typing narrows the rest.
  const chosen = found.filter((a) => draft.value.authors.includes(a.value))
  return { shown: [...chosen, ...found.filter((a) => !chosen.includes(a)).slice(0, Math.max(0, 12 - chosen.length))], total: all.length }
})
/** Whether a facet has anything to choose from. */
function offered(facet: Facet): boolean {
  if (facet === 'status') return statuses.value.some((o) => o.value === 'notFinished') || draft.value.status !== null
  if (facet === 'readAs') return readAs.value.some((o) => o.value !== 'unset') || draft.value.readAs.length > 0
  if (facet === 'author') return authors.value.total > 1 || draft.value.authors.length > 0
  if (facet === 'year') return years.value.length > 1 || draft.value.years.length > 0
  if (facet === 'genre') return genreChoices.value.length > 0
  return true
}

function toggle<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}
function chooseStatus(value: string) {
  draft.value = { ...draft.value, status: draft.value.status === value ? null : (value as FinishedStatus) }
}
function toggleReadAs(value: string) {
  draft.value = { ...draft.value, readAs: toggle(draft.value.readAs, value as ReadAsChoice) }
}
function toggleAuthor(value: string) {
  draft.value = { ...draft.value, authors: toggle(draft.value.authors, value) }
}
function toggleYear(value: string) {
  draft.value = { ...draft.value, years: toggle(draft.value.years, value) }
}
function toggleGenre(value: string) {
  draft.value = { ...draft.value, genres: toggle(draft.value.genres, value) }
}
function chooseRating(value: RatingChoice) {
  draft.value = { ...draft.value, rating: draft.value.rating === value ? null : value }
}
/** A page count the member typed: whole pages, or none. */
function pageNumber(raw: string): number | null {
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}
function setPages(edge: 'min' | 'max', raw: string) {
  draft.value = { ...draft.value, pages: { ...draft.value.pages, [edge]: pageNumber(raw) } }
}
const minId = useId()
const maxId = useId()
const minText = computed({ get: () => draft.value.pages.min?.toString() ?? '', set: (raw) => setPages('min', raw) })
const maxText = computed({ get: () => draft.value.pages.max?.toString() ?? '', set: (raw) => setPages('max', raw) })

const anySet = computed(
  () =>
    draft.value.status !== null ||
    draft.value.readAs.length > 0 ||
    draft.value.authors.length > 0 ||
    draft.value.rating !== null ||
    draft.value.years.length > 0 ||
    draft.value.pages.min !== null ||
    draft.value.pages.max !== null ||
    draft.value.genres.length > 0,
)
function clearAll() {
  draft.value = { ...draft.value, status: null, readAs: [], authors: [], rating: null, years: [], pages: { min: null, max: null }, genres: [] }
  query.value = ''
}

function apply() {
  emit('apply', clone(draft.value))
  open.value = false
}

const statusLabel = (value: string) => t(`library.view.status.${value}`)
const readAsLabel = (value: string) => t(`library.view.readAs.${value}`)
const yearLabel = (value: string) => value || t('library.undated')
const genreLabel = (value: string) => (te(`library.view.genres.${value}`) ? t(`library.view.genres.${value}`) : value)
const sectionIds = Object.fromEntries(['readAs', 'author', 'rating', 'year', 'pages', 'genre'].map((facet) => [facet, useId()]))
</script>

<template>
  <UiSheet v-model:open="open" :title="t('library.view.sheetTitle')" :action="t('library.view.apply')" testid="libraryFilter" @action="apply">
    <div class="flex flex-col gap-lg pb-sm">
      <!-- As tall as the button, which is always there: it fades in rather than pushing the sections down. -->
      <div class="flex h-(--size-button-md) items-center justify-between">
        <p class="figures text-caption text-ink-muted" role="status" data-testid="libraryFilter.count">{{ t('library.view.showCount', { count: n(left) }, left) }}</p>
        <!-- `inert` while there is nothing to clear: out of reach and out of the accessibility tree, not just invisible. -->
        <span class="transition-opacity duration-(--duration-quick) ease-standard" :class="!anySet && 'opacity-0'" :inert="!anySet">
          <UiButton tone="plain" size="md" data-testid="libraryFilter.clear" @click="clearAll">{{ t('library.view.clearAll') }}</UiButton>
        </span>
      </div>

      <template v-for="facet in facets" :key="facet">
        <section v-if="offered(facet)" :aria-labelledby="sectionIds[facet]" :data-testid="`libraryFilter.section.${facet}`">
          <h3 :id="sectionIds[facet]" class="eyebrow mb-sm text-ink-faint">{{ t(`library.view.facet.${facet}`) }}</h3>

          <div v-if="facet === 'status'" class="flex flex-wrap gap-sm">
            <UiPill
              v-for="option in statuses"
              :key="option.value"
              :pressed="draft.status === option.value"
              :count="option.count"
              :data-testid="`libraryFilter.status.${option.value}`"
              @click="chooseStatus(option.value)"
            >
              {{ statusLabel(option.value) }}
            </UiPill>
          </div>

          <div v-else-if="facet === 'readAs'" class="flex flex-wrap gap-sm">
            <UiPill
              v-for="option in readAs"
              :key="option.value"
              :pressed="draft.readAs.includes(option.value as ReadAsChoice)"
              :count="option.count"
              :data-testid="`libraryFilter.readAs.${option.value}`"
              @click="toggleReadAs(option.value)"
            >
              {{ readAsLabel(option.value) }}
            </UiPill>
          </div>

          <div v-else-if="facet === 'author'">
            <input
              v-if="authors.total > 12"
              v-model="query"
              type="search"
              enterkeyhint="search"
              autocomplete="off"
              autocapitalize="off"
              :aria-label="t('library.view.author.search')"
              :placeholder="t('library.view.author.search')"
              class="mb-sm min-h-(--size-touch) w-full border-b-(length:--stroke-rule) border-hairline-strong bg-transparent pb-xs text-input text-ink caret-accent outline-none placeholder:text-ink-faint focus:border-accent"
              data-testid="libraryFilter.authorSearch"
            />
            <div class="flex flex-wrap gap-sm">
              <UiPill
                v-for="option in authors.shown"
                :key="option.value"
                :pressed="draft.authors.includes(option.value)"
                :count="option.count"
                data-testid="libraryFilter.author"
                @click="toggleAuthor(option.value)"
              >
                {{ option.value }}
              </UiPill>
              <p v-if="!authors.shown.length" class="text-subhead text-ink-faint">{{ t('library.view.author.none') }}</p>
            </div>
          </div>

          <div v-else-if="facet === 'rating'" class="flex flex-wrap gap-sm">
            <UiPill
              v-for="minimum in RATING_MINIMUMS"
              :key="minimum"
              :pressed="draft.rating === minimum"
              :data-testid="`libraryFilter.rating.${minimum / 4}`"
              @click="chooseRating(minimum)"
            >
              {{ minimum === 20 ? t('library.view.rating.top') : t('library.view.rating.min', { stars: minimum / 4 }) }}
            </UiPill>
            <UiPill :pressed="draft.rating === 'unrated'" data-testid="libraryFilter.rating.unrated" @click="chooseRating('unrated')">
              {{ t('library.view.rating.unrated') }}
            </UiPill>
          </div>

          <div v-else-if="facet === 'year'" class="flex flex-wrap gap-sm">
            <UiPill
              v-for="option in years"
              :key="option.value"
              :pressed="draft.years.includes(option.value)"
              :count="option.count"
              data-testid="libraryFilter.year"
              @click="toggleYear(option.value)"
            >
              {{ yearLabel(option.value) }}
            </UiPill>
          </div>

          <div v-else-if="facet === 'pages'" class="grid grid-cols-2 gap-ml">
            <UiField
              :id="minId"
              v-model="minText"
              :label="t('library.view.pages.min')"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              :placeholder="t('library.view.pages.minPlaceholder')"
              data-testid="libraryFilter.pagesMin"
            />
            <UiField
              :id="maxId"
              v-model="maxText"
              :label="t('library.view.pages.max')"
              inputmode="numeric"
              pattern="[0-9]*"
              autocomplete="off"
              :placeholder="t('library.view.pages.maxPlaceholder')"
              data-testid="libraryFilter.pagesMax"
            />
          </div>

          <div v-else-if="facet === 'genre'" class="flex flex-wrap gap-sm">
            <UiPill
              v-for="option in genreChoices"
              :key="option.value"
              :pressed="draft.genres.includes(option.value)"
              :count="option.count"
              data-testid="libraryFilter.genre"
              @click="toggleGenre(option.value)"
            >
              {{ genreLabel(option.value) }}
            </UiPill>
          </div>
        </section>
      </template>
    </div>
  </UiSheet>
</template>
