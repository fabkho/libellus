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

const counts = computed<Record<EntryStatus, number>>(() => ({
  want_to_read: library.wantToRead.length,
  reading: library.reading.length,
  finished: library.finished.length,
}))

const filterCounts = computed(() => ({ all: library.finished.length, notFinished: library.notFinished.length }))
/** What Finished shows: everything, or only the Books that were not finished. */
const shown = computed(() => (filter.value === 'notFinished' ? library.notFinished : library.finished))

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
const empty = computed(() => library.loaded && Object.values(counts.value).every((count) => count === 0))

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
  <UiEmptyState v-if="empty" screen="library" :title="t('library.emptyTitle')" :text="t('library.empty')" class="pt-xl">
    <UiSearchPrompt testid="library.search" />
  </UiEmptyState>

  <div v-else-if="library.loaded">
    <CollectionsLibraryLink class="mb-md" />
    <div role="tablist" :aria-label="t('library.segmentsLabel')" class="flex gap-ml border-b-(length:--stroke-hairline) border-hairline-strong">
      <button
        v-for="status in SEGMENTS"
        :key="status"
        type="button"
        role="tab"
        :aria-selected="segment === status"
        class="segment relative flex h-(--size-touch) items-center gap-xs text-body"
        :class="segment === status ? 'on text-ink' : 'text-ink-faint'"
        :data-testid="`library.segment.${status}`"
        @click="segment = status"
      >
        {{ t(`library.segment.${status}`) }}
        <span class="figures text-caption" :class="segment === status ? 'text-ink-muted' : 'text-ink-ghost'">{{ counts[status] }}</span>
      </button>
    </div>

    <div v-if="segment === 'want_to_read' && library.wantToRead.length" class="flex flex-col pt-xs" data-testid="library.wantToRead">
      <LibraryEntryRow v-for="(entry, index) in library.wantToRead" :key="entry.id" :entry="entry" :eager="index < 8" />
    </div>

    <div v-else-if="segment === 'reading' && library.reading.length" class="flex flex-col gap-ms pt-md" data-testid="library.reading">
      <LibraryReadingCard v-for="(entry, index) in library.reading" :key="entry.id" :entry="entry" :eager="index < 4" />
    </div>

    <div v-else-if="segment === 'finished' && library.finished.length" class="flex flex-col" data-testid="library.finished">
      <div role="group" :aria-label="t('library.filtersLabel')" class="flex gap-sm pt-md">
        <button
          v-for="name in FILTERS"
          :key="name"
          type="button"
          :aria-pressed="filter === name"
          class="filter inline-flex h-(--size-button-sm) items-center gap-xs rounded-pill px-md text-subhead"
          :class="filter === name ? 'on bg-ink text-on-ink' : 'edge text-ink-muted'"
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
        <h2 class="flex items-center justify-between pt-md pb-xs">
          <span class="eyebrow" data-testid="library.yearTitle">{{ group.year || t('library.undated') }}</span>
          <span class="eyebrow text-ink-ghost">{{ group.entries.length }}</span>
        </h2>
        <LibraryEntryRow v-for="(entry, index) in group.entries" :key="entry.id" :entry="entry" :eager="g === 0 && index < 8" />
      </section>
    </div>

    <div v-else class="px-lg pt-xxl text-center" :data-testid="`library.segmentEmpty.${segment}`">
      <p class="book-title text-callout">{{ t(`library.segmentEmpty.${segment}.title`) }}</p>
      <p class="mt-xs text-subhead text-ink-muted">{{ t(`library.segmentEmpty.${segment}.text`) }}</p>
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
