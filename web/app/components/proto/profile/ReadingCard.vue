<script setup lang="ts">
// Design round #78: Home's reading card as it is (#68: cover light, the
// sparkline and the pace, the bar, Update), on a stub read.
import { amountsFor, fractionOf, paceWords, positionWords, type CurrentRead } from './model'

defineProps<{ read: CurrentRead; eager?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <article
    class="relative flex gap-md overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint"
  >
    <UiAmbient :colors="read.book.colors" shape="card" />
    <UiCover
      class="relative"
      :title="read.book.title"
      :authors="read.book.authors"
      :src="coverSrc(read.book.cover, 'lg')"
      :thumbhash="read.book.thumbhash"
      :colors="read.book.colors"
      size="lg"
      glow
      :eager="eager"
    />
    <div class="relative flex min-w-0 flex-1 flex-col pt-xxs">
      <span class="book-title line-clamp-2 text-book-title">{{ read.book.title }}</span>
      <span class="mt-xs truncate text-body text-ink-muted">{{ formatAuthors(read.book.authors, t('common.etAl')) }}</span>
      <div class="mt-sm flex items-end gap-sm">
        <ProgressSpark :amounts="amountsFor(read.book.key, 14)" />
        <span class="figures truncate text-meta text-ink-faint">{{ paceWords(read) }}</span>
      </div>
      <div class="mt-auto pt-md">
        <UiProgress :fraction="fractionOf(read)" label="Reading progress" />
      </div>
      <div class="flex items-center justify-between gap-ms pt-xs">
        <span class="figures min-w-0 truncate text-meta text-ink-muted">{{ positionWords(read) }}</span>
        <UiButton tone="quiet" size="sm">{{ t('book.progress.updateShort') }}</UiButton>
      </div>
    </div>
  </article>
</template>
