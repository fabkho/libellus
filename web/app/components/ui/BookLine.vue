<script setup lang="ts">
// The book a sheet is about: a small cover, the title in the serif, the
// author — so a sheet keeps its context while it covers the page.
import type { CoverColors } from '~/utils/cover'

const props = withDefaults(
  defineProps<{
    title: string
    authors: readonly string[]
    src?: string | null
    thumbhash?: string | null
    colors?: CoverColors | null
  }>(),
  { src: null, thumbhash: null, colors: null },
)

const { t } = useI18n()
const authorLine = computed(() => formatAuthors(props.authors, t('common.etAl')))
</script>

<template>
  <div class="flex items-center gap-ms pb-inset">
    <UiCover decorative :title="title" :authors="authors" :src="src" :thumbhash="thumbhash" :colors="colors" size="xs" />
    <div class="flex min-w-0 flex-col gap-xxs">
      <span class="book-title truncate text-callout">{{ title }}</span>
      <span class="truncate text-caption text-ink-faint">{{ authorLine }}</span>
    </div>
  </div>
</template>
