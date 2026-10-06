<script setup lang="ts">
// Contents (#131 phase 2): the book's table of contents as a sheet; the page
// stays where it is under it. At the top the Book (small cover, title), where
// the reader is in it, and the progress line as a slider (drag, let go: the
// book is there). Then the chapters in the serif with the place each starts
// at, in mono; the one being read lit with the lamp dot, the ones behind it
// muted. A tap goes there. Back matter (a licence) is left out. Under the
// chapters, when there are any, *Highlights from another copy*: the member's
// highlights made in a different file of this book (their CFIs mean nothing in
// this one), listed with their words and colour, never placed on the page.
import type { HighlightColor } from '~/data/reader/device'
import type { CoverColors } from '~/utils/cover'
import type { TocItem } from '~/reader/engine'
import Scrub from './Scrub.vue'
import { timeLeft, type ChromeInfo } from '~/utils/readerChrome'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  toc: TocItem[]
  current: string | null
  info: ChromeInfo
  /** Highlights made in another copy of the book. */
  otherCopy?: readonly { id: string; color: HighlightColor; text: string }[]
  book: { title: string; authors: string[]; cover: string | null; colors: CoverColors | null; thumbhash: string | null }
}>()
defineEmits<{ go: [href: string]; scrub: [fraction: number]; removeHighlight: [id: string] }>()

const { t } = useI18n()

const currentIndex = computed(() => {
  const exact = props.toc.findIndex((item) => item.href === props.current)
  if (exact !== -1) return exact
  let index = -1
  props.toc.forEach((item, i) => {
    if (item.fraction !== null && item.fraction <= props.info.fraction + 1e-6) index = i
  })
  return index
})
/** Where a chapter starts: the Book's page, or the percent without a page count. */
function startOf(item: TocItem): string | null {
  if (item.fraction === null) return null
  return props.info.pages ? String(Math.max(1, Math.round(item.fraction * props.info.pages))) : t('reader.percent', { percent: Math.round(item.fraction * 100) })
}
const where = computed(() => {
  const place =
    props.info.page !== null ? t('reader.page', { page: props.info.page, count: props.info.pages }) : t('reader.percent', { percent: Math.round(props.info.fraction * 100) })
  return `${place} · ${timeLeft(t, props.info.minutesBook, 'book')}`
})

const otherCopyTitleId = useId()
/** A highlight's words as one line of a list: the first 120 characters. */
function excerpt(text: string): string {
  const words = Array.from(text.replace(/\s+/g, ' ').trim())
  return words.length > 120 ? `${words.slice(0, 120).join('')}…` : words.join('')
}

const list = useTemplateRef<HTMLElement>('list')
watch(open, async (isOpen) => {
  if (!isOpen) return
  await nextTick()
  list.value?.querySelector('[data-current]')?.scrollIntoView({ block: 'center' })
})
</script>

<template>
  <UiSheet v-model:open="open" :title="t('reader.contentsSheet.title')" testid="readerContents">
    <div class="mb-sm flex items-center gap-ms">
      <UiCover :title="book.title" :authors="book.authors" :src="book.cover" :thumbhash="book.thumbhash" :colors="book.colors" size="sm" />
      <div class="min-w-0 flex-1">
        <p class="book-title title-wrap text-callout">{{ book.title }}</p>
        <p class="figures mt-xxs truncate text-meta text-ink-faint">{{ where }}</p>
        <!-- The progress line is a slider here too. -->
        <Scrub class="-my-xs" :fraction="info.fraction" :pages="info.pages" :saved="null" data-no-swipe @scrub="$emit('scrub', $event)" />
      </div>
    </div>
    <ol ref="list" class="-mx-ml" data-testid="readerContents.list">
      <li v-for="(item, i) in toc" :key="`${item.href}-${i}`">
        <button
          type="button"
          class="relative flex min-h-(--size-row) w-full items-center gap-ms px-ml py-sm text-left not-disabled:hover:bg-fill active:bg-fill-strong"
          :style="{ paddingLeft: `calc(var(--spacing-ml) + ${item.depth} * var(--spacing-md))` }"
          :data-current="i === currentIndex || undefined"
          :data-testid="`readerContents.item.${i}`"
          @click="$emit('go', item.href)"
        >
          <span class="lamp shrink-0" :class="i === currentIndex && 'on'" aria-hidden="true" />
          <span class="book-title min-w-0 flex-1 text-callout" :class="i < currentIndex ? 'text-ink-muted' : 'text-ink'">{{ item.label }}</span>
          <span v-if="startOf(item)" class="figures shrink-0 text-meta text-ink-faint">{{ startOf(item) }}</span>
        </button>
      </li>
      <li v-if="!toc.length" class="px-ml py-md text-subhead text-ink-muted">{{ t('reader.contentsSheet.none') }}</li>
    </ol>
    <section v-if="otherCopy?.length" class="mt-md" data-testid="readerContents.otherCopy" :aria-labelledby="otherCopyTitleId">
      <h3 :id="otherCopyTitleId" class="text-subhead font-semibold text-ink">{{ t('reader.contentsSheet.otherCopy.title') }}</h3>
      <p class="mt-xxs text-footnote text-ink-muted">{{ t('reader.contentsSheet.otherCopy.note') }}</p>
      <ul class="mt-xs">
        <li v-for="h in otherCopy" :key="h.id" class="flex items-center gap-ms" data-testid="readerContents.otherCopy.item">
          <span class="swatch shrink-0" :style="{ background: `var(--color-highlight-${h.color})` }" role="img" :aria-label="t('reader.contentsSheet.otherCopy.color', { color: t(`reader.menu.colors.${h.color}`) })" />
          <span class="book-title min-w-0 flex-1 py-sm text-callout text-ink">{{ excerpt(h.text) }}</span>
          <button
            type="button"
            class="flex size-(--size-touch) shrink-0 items-center justify-center text-ink-muted"
            :aria-label="t('reader.contentsSheet.otherCopy.remove', { text: excerpt(h.text) })"
            data-testid="readerContents.otherCopy.remove"
            @click="$emit('removeHighlight', h.id)"
          >
            <UiIcon name="close" :size="18" />
          </button>
        </li>
      </ul>
    </section>
  </UiSheet>
</template>

<style scoped>
.swatch {
  width: var(--size-star-lg);
  height: var(--size-star-lg);
  border-radius: var(--radius-pill);
  box-shadow: inset 0 0 0 var(--stroke-hairline) color-mix(in srgb, var(--color-ink) 20%, transparent);
}
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
