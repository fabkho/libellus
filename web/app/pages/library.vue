<script setup lang="ts">
// Library (D's library-want / library-reading / library-finished): the three
// Status segments with their counts, then the entries of the chosen one.
// *Want to read* lists the Books added, newest first; *Currently reading*
// gives each Book a card with its cover's light, since when it is being read
// and Finish right there, newest start first; *Finished* groups the Books by
// the year they were finished, newest end first, each with its Rating, and a
// filter: All, or *Not finished* (#10), the Books whose latest read was given
// up, dimmed among the others. (#14 adds Collections.) An empty Library shows the
// lamp over the empty shelf and the way to search. Kept alive: coming back
// finds the segment and the scroll position as they were, and the lists
// refresh quietly in the background.
import type { EntryStatus, LibraryEntry } from '~/data/library'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

definePageMeta({ layout: 'tabs', screen: 'library', keepalive: true })

const { t } = useI18n()
const library = useLibraryStore()

const SEGMENTS: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']
const segment = ref<EntryStatus>('want_to_read')
/** Finished's filter; kept when the member looks at another segment and comes back. */
const FILTERS = ['all', 'notFinished'] as const
const filter = ref<(typeof FILTERS)[number]>('all')

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
  notFinished: library.notFinished,
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

const filterCounts = computed(() => ({ all: lists.value.finished.length, notFinished: lists.value.notFinished.length }))
/** What Finished shows: everything, or only the Books that were not finished. */
const shown = computed(() => (filter.value === 'notFinished' ? lists.value.notFinished : lists.value.finished))

/** What Finished shows, by the year of the end date (the list is newest first already). */
const years = computed(() => {
  const groups: { year: string; entries: LibraryEntry[] }[] = []
  for (const entry of shown.value) {
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

onActivated(() => void library.load())
// Kept alive, so a member change (the list reset) while it is not showing has
// to bring it back by itself.
const session = useSessionStore()
watch(
  () => session.member?.id,
  (member) => member && void library.load(),
)
</script>

<template>
  <div>
  <CollectionsLibraryLink v-if="library.loaded" :only-if-any="empty" class="mb-md" />
  <UiEmptyState v-if="empty" screen="library" :title="t('library.emptyTitle')" :text="t('library.empty')" class="pt-xl">
    <UiSearchPrompt testid="library.search" />
  </UiEmptyState>

  <div v-else-if="library.loaded">
    <div ref="tabs" role="tablist" :aria-label="t('library.segmentsLabel')" class="flex gap-ml border-b-(length:--stroke-hairline) border-hairline-strong">
      <button
        v-for="status in SEGMENTS"
        :key="status"
        type="button"
        role="tab"
        :id="tabId(status)"
        :aria-selected="segment === status"
        :aria-controls="panelId"
        :tabindex="segment === status ? 0 : -1"
        class="segment relative flex h-(--size-touch) items-center gap-xs text-body"
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
    <UiListMotion v-if="segment === 'want_to_read' && lists.want_to_read.length" class="flex flex-col pt-xs" data-testid="library.wantToRead">
      <LibraryEntryRow v-for="(entry, index) in lists.want_to_read" :key="entry.id" :entry="entry" :eager="index < 8" />
    </UiListMotion>

    <UiListMotion v-else-if="segment === 'reading' && lists.reading.length" class="flex flex-col gap-ms pt-md" data-testid="library.reading">
      <LibraryReadingCard v-for="(entry, index) in lists.reading" :key="entry.id" :entry="entry" :eager="index < 4" />
    </UiListMotion>

    <div v-else-if="segment === 'finished' && lists.finished.length" class="flex flex-col" data-testid="library.finished">
      <div role="group" :aria-label="t('library.filtersLabel')" class="flex gap-sm pt-md">
        <button
          v-for="name in FILTERS"
          :key="name"
          type="button"
          :aria-pressed="filter === name"
          class="filter relative inline-flex h-(--size-button-sm) items-center gap-xs rounded-pill px-md text-subhead"
          :class="filter === name ? 'on bg-ink text-on-ink' : 'edge text-ink-muted hover:bg-fill'"
          :data-testid="`library.filter.${name}`"
          @click="filter = name"
        >
          <UiIcon v-if="name === 'notFinished'" name="slash" :size="13" />
          {{ t(`library.filter.${name}`) }}
          <span class="count figures text-caption" :class="filter !== name && 'text-ink-faint'">{{ filterCounts[name] }}</span>
        </button>
      </div>

      <div v-if="!shown.length" class="px-lg pt-xxl text-center" data-testid="library.filterEmpty">
        <p class="book-title text-callout">{{ t('library.notFinishedEmpty.title') }}</p>
        <p class="mt-xs text-subhead text-ink-muted">{{ t('library.notFinishedEmpty.text') }}</p>
      </div>
      <section v-for="(group, g) in years" :key="group.year" class="flex flex-col" data-testid="library.year">
        <!-- Pinned while its year scrolls by, as iOS lists pin their section headers. -->
        <!-- Named as one phrase: the year and its count side by side read as one number ("202615"). -->
        <h2
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
/* The drawn pill is 32 px; the touch target stays 44. */
.filter::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}

/* A pinned year sits under the status bar, not behind it. */
.year {
  top: env(safe-area-inset-top);
}

/* The chosen filter's count is quieter than its name, as in D. */
.filter.on .count {
  opacity: 0.55;
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
