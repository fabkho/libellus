<script setup lang="ts">
// The way into Collections from the Library tab (D's library): a quiet
// rounded row with a small fan of the Collections' first covers, the word
// Collections, how many there are, and a chevron. It loads the list itself, so
// the Library page only places it.
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
      <span v-if="!fan.length" class="empty absolute bottom-0 left-0 w-(--size-cover-xs) rounded-cover-sm" />
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

.empty {
  aspect-ratio: 2 / 3;
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong);
}
</style>
