<script setup lang="ts">
// Library (D's library-want): the three Status segments with their counts,
// then the entries of the chosen one. *Want to read* lists the Books added,
// newest first; Currently reading and Finished have their own empty states
// until reading sessions land (#7, #14 brings Collections and the rest). An
// empty Library shows the lamp over the empty shelf and the way to search.
// Kept alive: coming back finds the segment and the scroll position as they
// were, and the list refreshes quietly in the background.
import type { EntryStatus } from '~/data/library'
import { useLibraryStore } from '~/stores/library'
import { useSessionStore } from '~/stores/session'

definePageMeta({ layout: 'tabs', screen: 'library', keepalive: true })

const { t } = useI18n()
const library = useLibraryStore()

const SEGMENTS: readonly EntryStatus[] = ['want_to_read', 'reading', 'finished']
const segment = ref<EntryStatus>('want_to_read')

const counts = computed<Record<EntryStatus, number>>(() => ({
  want_to_read: library.wantToRead.length,
  reading: 0,
  finished: 0,
}))
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
