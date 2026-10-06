<script setup lang="ts">
// Contents: the book's table of contents as a sheet (the reader stays where it
// is under it). At the top the Book (small cover, title) with where the reader
// is in it; then the chapters in the serif, each with the page it starts on in
// mono; the one being read lit with the lamp dot, the ones behind it muted.
// A tap goes there. The back matter (Project Gutenberg's licence) is left out.
import type { CoverColors } from '~/utils/cover'
import type { TocItem } from './engine'
import { minutesLeft, type ChromeInfo } from './types'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  toc: TocItem[]
  current: string | null
  info: ChromeInfo
  book: { title: string; authors: string[]; cover: string | null; colors: CoverColors | null; thumbhash: string | null }
}>()
defineEmits<{ go: [href: string] }>()

const currentIndex = computed(() => {
  const exact = props.toc.findIndex((item) => item.href === props.current)
  if (exact !== -1) return exact
  let index = -1
  props.toc.forEach((item, i) => {
    if (item.fraction !== null && item.fraction <= props.info.fraction + 1e-6) index = i
  })
  return index
})

const list = useTemplateRef<HTMLElement>('list')
watch(open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  list.value?.querySelector('[data-current]')?.scrollIntoView({ block: 'center' })
})
</script>

<template>
  <UiSheet v-model:open="open" title="Contents" testid="readerToc">
    <div class="mb-md flex items-center gap-ms">
      <UiCover :title="book.title" :authors="book.authors" :src="book.cover" :thumbhash="book.thumbhash" :colors="book.colors" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="book-title truncate text-callout">{{ book.title }}</p>
        <p class="figures mt-xxs text-meta text-ink-faint">p. {{ info.page }} of {{ info.pages }} · {{ Math.round(info.fraction * 100) }} % · {{ minutesLeft(info.minutesBook, 'book') }}</p>
        <UiProgress class="mt-sm" :fraction="info.fraction" label="Progress" :value-text="`p. ${info.page} of ${info.pages}`" />
      </div>
    </div>
    <ol ref="list" class="-mx-ml" data-testid="readerToc.list">
      <li v-for="(item, i) in toc" :key="`${item.href}-${i}`">
        <button
          type="button"
          class="relative flex min-h-(--size-row) w-full items-center gap-ms px-ml py-sm text-left not-disabled:hover:bg-fill active:bg-fill-strong"
          :style="{ paddingLeft: `calc(var(--spacing-ml) + ${item.depth} * var(--spacing-md))` }"
          :data-current="i === currentIndex || undefined"
          :data-testid="`readerToc.item.${i}`"
          @click="$emit('go', item.href)"
        >
          <span class="lamp shrink-0" :class="i === currentIndex ? 'on' : ''" aria-hidden="true" />
          <span class="book-title min-w-0 flex-1 text-callout" :class="i < currentIndex ? 'text-ink-muted' : 'text-ink'">{{ item.label }}</span>
          <span v-if="item.fraction !== null" class="figures shrink-0 text-meta text-ink-faint">{{ Math.max(1, Math.round(item.fraction * info.pages)) }}</span>
        </button>
      </li>
      <li v-if="!toc.length" class="px-ml py-md text-subhead text-ink-muted">This book has no contents.</li>
    </ol>
  </UiSheet>
</template>

<style scoped>
.lamp {
  width: var(--spacing-xs);
  height: var(--spacing-xs);
  border-radius: var(--radius-pill);
  background: transparent;
}
.lamp.on {
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-sm) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 45%, transparent);
}
</style>
