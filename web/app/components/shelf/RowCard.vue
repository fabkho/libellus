<script setup lang="ts">
// A member's Books as Regal's row in a card (#23): the Profile's Your shelf
// (the newest, up to a cap) and a year in review (that year's, from January),
// her own Library built on the device (stores/shelf.ts `document`), the
// owner's published file; `published` always the file (a reading page shows
// the owner's shelf, whoever looks at it), or a document handed in (another
// member's profile: her finished reads, built there). A card like the
// Profile's others (`bare`, in a sheet: none of that, it sits on the sheet); the row fills it edge to edge, scrolls sideways under the
// finger and lets the page scroll on; a Book tapped breaks out to the whole
// screen (ShelfRow).
//
// The card keeps its size (18rem) whatever is in it, so nothing shifts when
// the row arrives. The row appears with its intro and no loading step of
// ours: the owner's screens have already warmed Regal's chunk, the library file
// and the first Spines (useShelfPreload); anyone's card warms its own when it
// mounts. While nothing is drawn the card is its plain surface: no slabs, no
// spinner. Without Regal's chunk (offline, never fetched) it says so quietly.
//
// The row mounts with its screen, even below the fold: it draws its Spines
// off screen, and Regal holds its intro until the card is first seen
// (`intro="visible"`, fabkho/regal#80), so the Books are there the moment she
// scrolls to them and the intro plays where it is seen.
import { warmShelfRow } from '~/composables/useShelfPreload'
import { describeError, isChunkError } from '~/data/errorLog'
import type { RegalLibraryFile } from '~/data/export/regalLibraryFile'
import { useShelfStore } from '~/stores/shelf'

const props = defineProps<{
  /** Only this year's Books, the row starting at January. */
  year?: number | null
  /** Only the newest this many Books. */
  limit?: number | null
  /** What the row is, for assistive technology. */
  label: string
  /** No surface, border or shadow: the row sits on what it stands on (inside a sheet). */
  bare?: boolean
  /** The owner's published file, never the signed-in member's own Library (a reading page). */
  published?: boolean
  /**
   * A document built on the device for this row (her profile's finished reads, `data/memberShelf.ts`
   * `memberShelfFromFinished`): the third source, handed over rather than read and never fetched here. Given, it is the
   * row's — a null one draws nothing rather than fall back to the signed-in member's own Library or the published file.
   */
  library?: RegalLibraryFile | null
}>()

const { t } = useI18n()
const shelf = useShelfStore()
/** The document Regal is handed: the one given, else her own Library (`stores/shelf.ts`); `published` is the file, whoever looks. */
const file = computed(() => {
  if (props.published) return null
  return props.library !== undefined ? props.library : shelf.document
})
// A member's row waits for her own document (`stores/shelf.ts`): without one, Regal would read the
// published file in its place. The owner's (and the reading page's) is that file; a document handed
// in (her profile's) is waited for where it is built, and a null one draws nothing.
const rowReady = computed(() => {
  if (props.published) return true
  if (props.library !== undefined) return !!props.library
  return shelf.source === 'published' || !!shelf.document
})

// A head start for a visit that came straight here (shared with the shell's warm-up when that has run).
onMounted(() => {
  watch(
    rowReady,
    (now, before) => {
      if (now && !before) warmShelfRow(props.year ?? null, file.value)
    },
    { immediate: true },
  )
})

// Regal's chunk could not be had (offline before it was ever fetched): a quiet word, not a crash.
const noChunk = ref(false)
onErrorCaptured((error) => {
  if (!isChunkError(describeError(error).message)) return true
  noChunk.value = true
  return false
})
</script>

<template>
  <div class="card relative overflow-hidden rounded-lg" :class="!bare && 'bg-surface-raised shadow-raised edge-faint'">
    <p v-if="noChunk" class="flex h-full items-center justify-center px-xl text-center text-subhead text-ink-muted" data-testid="shelf.noChunk">
      {{ t('shelf.noChunk') }}
    </p>
    <LazyShelfRow v-else-if="rowReady" :year="year" :limit="limit" :label="label" :library="file" />
  </div>
</template>

<style scoped>
.card {
  height: 18rem;
}
</style>
