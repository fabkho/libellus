<script setup lang="ts">
// The way into Collections from the Library tab (D's library): a quiet
// rounded row with a small fan of the Collections' first covers, the word
// Collections, how many there are, and a chevron. With no covers to fan (no
// Collections, Collections that are all empty, or the list still loading) the
// fan's place holds bookends, line art in the empty state's own hand; the count
// is blank until the list is in, then a figure, "0" included. It loads the list
// itself, so the Library page only places it.
import { useCollectionsStore } from '~/stores/collections'
import { useSessionStore } from '~/stores/session'

// `onlyIfAny`: an empty Library shows the way in only while there are Collections to go to.
const props = defineProps<{ onlyIfAny?: boolean }>()

const { t } = useI18n()
const collections = useCollectionsStore()
const shown = computed(() => !props.onlyIfAny || collections.list.length > 0)

/** The first cover of each of the first three Collections that have one. */
const fan = computed(() =>
  collections.list
    .map((summary) => summary.covers[0])
    .filter((book) => book !== undefined)
    .slice(0, 3),
)

// The Library page is kept alive: read the list when this row appears, and
// again whenever the page shows again, unless it is fresh (stores/collections.ts, `FRESH_MS`).
onMounted(() => void collections.loadList({ ifStale: true }))
onActivated(() => void collections.loadList({ ifStale: true }))
const session = useSessionStore()
watch(
  () => session.member?.id,
  (member) => member && void collections.loadList(),
)
</script>

<template>
  <NuxtLink
    v-if="shown"
    to="/collections"
    class="flex h-(--size-query) items-center gap-ms rounded-md bg-fill px-inset edge-faint active:bg-fill-strong"
    data-testid="library.collections"
  >
    <span class="fan relative shrink-0" aria-hidden="true">
      <!-- No covers to fan (none yet, still loading, or Collections that are all empty): bookends on a
           shelf, two spines leaning on a hairline upright, in the empty state's own line (A13 (b)). -->
      <svg
        class="bookends absolute inset-0 size-full text-ink-faint"
        :class="fan.length && 'out'"
        viewBox="0 0 50 45"
        fill="none"
        stroke="currentColor"
        stroke-width="1"
        stroke-linejoin="round"
      >
        <path d="M.5 44.5h44" />
        <path d="M3 44.5V10" stroke-width=".75" />
        <rect x="6.5" y="14" width="5" height="30.5" rx="1.2" transform="rotate(-5 6.5 44.5)" />
        <rect x="17" y="16.5" width="4.5" height="28" rx="1.2" transform="rotate(-16 17 44.5)" />
      </svg>
      <!-- Covers that arrive while the row is on screen fade in over the bookends; covers the row opens with are simply there. -->
      <Transition name="covers">
        <span v-if="fan.length" class="absolute inset-0">
          <span v-for="(book, i) in fan" :key="book.id" class="absolute bottom-0" :class="`fan-${i}`">
            <UiCover
              :title="book.title"
              :authors="book.authors"
              :src="coverSrc(book.coverUrl, 'xs')"
              :thumbhash="book.coverThumbhash"
              :colors="book.coverColors"
              size="xs"
            />
          </span>
        </span>
      </Transition>
    </span>
    <span class="flex-1 text-body-large">{{ t('collections.title') }}</span>
    <span class="figures text-caption text-ink-faint" data-testid="library.collectionsCount">{{ collections.loaded ? collections.list.length : '' }}</span>
    <UiIcon name="chevron" :size="15" bold class="-mr-xs text-ink-ghost" />
  </NuxtLink>
</template>

<style scoped>
/* Three covers fanned to the right, each further one smaller and fainter. */
.fan {
  width: calc(var(--size-cover-xs) + var(--spacing-ml));
  height: calc(var(--size-cover-xs) * 1.5);
}

.fan-0 {
  left: 0;
  z-index: 3;
}

.fan-1 {
  left: var(--spacing-ms);
  z-index: 2;
  opacity: 0.8;
  transform: scale(0.9);
  transform-origin: 100% 100%;
}

.fan-2 {
  left: var(--spacing-ml);
  z-index: 1;
  opacity: 0.6;
  transform: scale(0.8);
  transform-origin: 100% 100%;
}

/* The bookends give way to the covers, and come back if the last cover goes: a cross-fade in
   place over `standard` (docs/MOTION.md, Collections row); with Reduce Motion, at once. */
.bookends {
  transition: opacity var(--duration-standard) var(--ease-standard);
}

.bookends.out {
  opacity: 0;
}

.covers-enter-active,
.covers-leave-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}

.covers-enter-from,
.covers-leave-to {
  opacity: 0;
}
</style>
