<script setup lang="ts">
// A Collection's face (D's collections): its first four covers, two by two,
// on a small raised card lit by the first cover's light. Empty places are
// hairline outlines of a cover, so an empty or short Collection still reads
// as a shelf. Decorative: the row around it names the Collection.
import type { Book } from '~/data/books'
import { MOSAIC_SIZE } from '~/data/collections'

defineProps<{ covers: readonly Book[]; eager?: boolean }>()
</script>

<template>
  <div class="mosaic relative grid shrink-0 grid-cols-2 gap-xs overflow-hidden rounded-md bg-surface-raised p-xs edge-faint" aria-hidden="true">
    <UiAmbient v-if="covers[0]" :colors="covers[0].coverColors" shape="card" />
    <template v-for="i in MOSAIC_SIZE" :key="i">
      <UiCover
        v-if="covers[i - 1]"
        :title="covers[i - 1]!.title"
        :authors="covers[i - 1]!.authors"
        :src="coverSrc(covers[i - 1]!.coverUrl, 'sm')"
        :thumbhash="covers[i - 1]!.coverThumbhash"
        :colors="covers[i - 1]!.coverColors"
        size="sm"
        :eager="eager"
      />
      <span v-else class="empty relative w-(--size-cover-sm) rounded-cover-sm" />
    </template>
  </div>
</template>

<style scoped>
.empty {
  aspect-ratio: 2 / 3;
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong);
}
</style>
