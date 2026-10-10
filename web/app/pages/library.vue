<script setup lang="ts">
// Library (D's library-want / library-reading / library-finished): the three
// Status segments with their counts, then the entries of the chosen one.
// *Want to read* lists the Books added, newest first; *Currently reading*
// gives each Book a card with its cover's light, since when it is being read
// and Finish right there, newest start first; *Finished* groups the Books by
// the year they were finished, newest end first, each with its Rating; a Book
// whose latest read was given up (*Not finished*, #10) is dimmed among the others. (#14 adds
// Collections.) Under the segments, each list has its filters and sort (#169: Finished or
// Not finished, Read as, author, rating, year read, pages; date, rating, title, author, pages), quiet pills with the filters that are set as chips, the count
// and Clear; the last choice is remembered per member on the device. An empty Library shows the
// lamp over the empty shelf and the way to search. Kept alive: coming back
// finds the segment and the scroll position as they were, and the lists
// refresh quietly in the background.
import type { EntryStatus, LibraryEntry } from '~/data/library'
import { arrange, sortFor } from '~/data/libraryView'
import { useLibraryStore } from '~/stores/library'
import { useGenresStore } from '~/stores/genres'
import { useLibraryViewStore } from '~/stores/libraryView'
import { useSessionStore } from '~/stores/session'
import { useCircleBooksStore } from '~/stores/circleBooks'

definePageMeta({ layout: 'tabs', screen: 'library', keepalive: true })

const { t } = useI18n()
const library = useLibraryStore()
const libraryView = useLibraryViewStore()
// The genre filter's lookup (#168): provided to the view store by the genres store, which the device fills at once.
const bookGenres = useGenresStore()

// Followed members who want the same Books (circle_want), by her Book's id; asked when the Library shows.
const circle = useCircleBooksStore()
const circleWant = computed(() => circle.want)

const SEGMENTS: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']
const segment = ref<EntryStatus>('want_to_read')

/**
 * The lists as the screen shows them: held while a sheet is on screen (a
 * Finish's card stays while the sheet falls away, then collapses) and while
 * the Library is in the background (a Start on the book page arrives when she
 * is back), so the change moves where she sees it (`UiListMotion`).
 */
const lists = useSettled(() => ({
  want_to_read: library.wantToRead,
  reading: library.reading,
  finished: library.finished,
}))

const counts = computed<Record<EntryStatus, number>>(() => ({
  want_to_read: lists.value.want_to_read.length,
  reading: lists.value.reading.length,
  finished: lists.value.finished.length,
}))

/**
 * The segments are tabs (WAI-ARIA's tabs pattern): one stop for Tab, the arrows (and Home, End)
 * move between them and show the one they land on, and the list under them is its tab panel.
 */
const tabIds = useId()
const tabId = (status: EntryStatus) => `${tabIds}-${status}`
const panelId = `${tabIds}-panel`
const tabsEl = useTemplateRef<HTMLElement>('tabs')
function onTabsKeydown(event: KeyboardEvent) {
  const at = SEGMENTS.indexOf(segment.value)
  const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: SEGMENTS.length - 1 }[event.key]
  if (to === undefined) return
  event.preventDefault()
  segment.value = SEGMENTS[(to + SEGMENTS.length) % SEGMENTS.length]!
  void nextTick(() => tabsEl.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}

/**
 * Filters and sort (#169): each list's own, as the screen shows them (held while a sheet is on
 * screen, like the lists, so the change is seen where the member is looking).
 */
const views = useSettled(() => ({ ...libraryView.views }))
const view = computed(() => views.value[segment.value])
const genres = computed(() => libraryView.genres)
/** The entries of the chosen segment before the filters and the sort. */
const base = computed<readonly LibraryEntry[]>(() => lists.value[segment.value])
const arranged = computed(() => arrange(base.value, segment.value, view.value, { genres: genres.value }))
/** The list is empty because of the filters, not because there are no books. */
const noMatch = computed(() => base.value.length > 0 && arranged.value.length === 0)

/**
 * What Finished shows, by the year of the end date (the list is newest first already). Another
 * order than by the date read is one list without years.
 */
const years = computed(() => {
  if (!arranged.value.length) return []
  if (sortFor('finished', view.value.sort).key !== 'dateRead') return [{ year: null, entries: [...arranged.value] }]
  const groups: { year: string | null; entries: LibraryEntry[] }[] = []
  for (const entry of arranged.value) {
    const year = entry.latestSession?.endedOn?.slice(0, 4) ?? ''
    const group = groups.at(-1)
    if (group?.year === year) group.entries.push(entry)
    else groups.push({ year, entries: [entry] })
  }
  return groups
})
const empty = computed(
  () => library.loaded && !library.wantToRead.length && !library.reading.length && !library.finished.length,
)

onActivated(() => {
  // Not again while the lists are fresh (stores/library.ts, `FRESH_MS`).
  void library.load({ ifStale: true })
  // The store asks by itself when her lists arrive or change; coming back asks again once the answer is stale.
  void circle.load({ ifStale: true })
  void bookGenres.load({ ifStale: true })
  // Sent here to look at one list (the Profile's genres, #168): that segment, as filtered.
  if (libraryView.focus) {
    segment.value = libraryView.focus
    libraryView.focus = null
  }
})
// Kept alive, so a member change (the list reset) while it is not showing has
// to bring it back by itself.
const session = useSessionStore()
watch(
  () => session.member?.id,
  (member) => {
    if (!member) return
    void library.load()
    void bookGenres.load()
  },
)
</script>

<template>
  <div>
  <CollectionsLibraryLink v-if="library.loaded" :only-if-any="empty" class="mb-md" />
  <UiEmptyState v-if="empty" screen="library" :title="t('library.emptyTitle')" :text="t('library.empty')" class="pt-xl">
    <UiSearchPrompt testid="library.search" />
  </UiEmptyState>

  <div v-else-if="library.loaded">
    <div ref="tabs" role="tablist" :aria-label="t('library.segmentsLabel')" class="flex flex-wrap gap-x-ml border-b-(length:--stroke-hairline) border-hairline-strong">
      <button
        v-for="status in SEGMENTS"
        :key="status"
        type="button"
        role="tab"
        :id="tabId(status)"
        :aria-selected="segment === status"
        :aria-controls="panelId"
        :tabindex="segment === status ? 0 : -1"
        class="segment relative flex h-(--size-touch) items-center gap-xs text-body whitespace-nowrap"
        :class="segment === status ? 'on text-ink' : 'text-ink-faint'"
        :data-testid="`library.segment.${status}`"
        @click="segment = status"
        @keydown="onTabsKeydown"
      >
        {{ t(`library.segment.${status}`) }}
        <span class="figures text-caption" :class="segment === status ? 'text-ink-muted' : 'text-ink-faint'">{{ counts[status] }}</span>
      </button>
    </div>

    <div :id="panelId" role="tabpanel" :aria-labelledby="tabId(segment)">
    <!-- Filters and sort of the chosen list (#169), whatever there is to filter. -->
    <LibraryViewBar v-if="base.length" :status="segment" :view="view" :entries="base" :shown="arranged.length" :genres="genres" />

    <UiListMotion v-if="segment === 'want_to_read' && lists.want_to_read.length" class="flex flex-col pt-xs" data-testid="library.wantToRead">
      <LibraryEntryRow v-for="(entry, index) in arranged" :key="entry.id" :entry="entry" :eager="index < 8" :circle="circleWant[entry.book.id]" />
    </UiListMotion>

    <UiListMotion v-else-if="segment === 'reading' && lists.reading.length" class="flex flex-col gap-ms pt-md" data-testid="library.reading">
      <LibraryReadingCard v-for="(entry, index) in arranged" :key="entry.id" :entry="entry" :eager="index < 4" />
    </UiListMotion>

    <div v-else-if="segment === 'finished' && lists.finished.length" class="flex flex-col" data-testid="library.finished">
      <section v-for="(group, g) in years" :key="group.year ?? 'all'" class="flex flex-col" data-testid="library.year">
        <!-- Pinned while its year scrolls by, as iOS lists pin their section headers. -->
        <!-- Named as one phrase: the year and its count side by side read as one number ("202615"). -->
        <h2
          v-if="group.year !== null"
          class="year sticky z-10 -mx-screen flex items-center justify-between bg-surface px-screen pt-md pb-xs"
          :aria-label="t('library.yearHeading', { year: group.year || t('library.undated'), count: group.entries.length }, group.entries.length)"
        >
          <span class="eyebrow" data-testid="library.yearTitle">{{ group.year || t('library.undated') }}</span>
          <span class="eyebrow text-ink-faint">{{ group.entries.length }}</span>
        </h2>
        <UiListMotion class="flex flex-col">
          <LibraryEntryRow v-for="(entry, index) in group.entries" :key="entry.id" :entry="entry" :eager="g === 0 && index < 8" />
        </UiListMotion>
      </section>
    </div>

    <div v-else class="px-lg pt-xxl text-center" :data-testid="`library.segmentEmpty.${segment}`">
      <p class="book-title text-callout">{{ t(`library.segmentEmpty.${segment}.title`) }}</p>
      <p class="mt-xs text-subhead text-ink-muted">{{ t(`library.segmentEmpty.${segment}.text`) }}</p>
    </div>

    <!-- The filters leave nothing: not an empty list, a way out. -->
    <div v-if="noMatch" class="px-lg pt-xxl text-center" data-testid="library.viewEmpty">
      <p class="book-title text-callout">{{ t('library.view.empty.title') }}</p>
      <p class="mt-xs text-subhead text-ink-muted">{{ t('library.view.empty.text') }}</p>
      <UiButton tone="secondary" size="md" class="mt-md" data-testid="library.viewEmpty.clear" @click="libraryView.clear(segment)">
        {{ t('library.view.empty.clear') }}
      </UiButton>
    </div>
    </div>
  </div>

  <div v-else-if="library.loadError" class="px-lg pt-xxl text-center" data-testid="library.loadError">
    <p class="text-subhead text-ink-muted">{{ t('library.loadError') }}</p>
    <UiButton tone="secondary" size="md" class="mt-md" data-testid="library.retry" @click="library.load()">
      {{ t('library.retry') }}
    </UiButton>
  </div>
  </div>
</template>

<style scoped>
/* A pinned year sits under the status bar, not behind it. */
.year {
  top: env(safe-area-inset-top);
}

/* The lit segment: a lamp hairline under it, with a little of its glow. */
.segment.on::after {
  position: absolute;
  right: 0;
  bottom: calc(-1 * var(--stroke-hairline));
  left: 0;
  height: var(--stroke-focus);
  content: '';
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-sm) var(--color-accent-soft);
}
</style>
