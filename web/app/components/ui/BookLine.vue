<script setup lang="ts">
// The book a sheet is about: a small cover, the title in the serif, the
// author — so a sheet keeps its context while it covers the page.
import type { CoverColors } from '~/utils/cover'

const props = withDefaults(
  defineProps<{
    title: string
    authors: readonly string[]
    src?: string | null
    /** The sizes `src` is offered at, with `sizes`: what `coverImage` hands a sheet's Book (utils/coverRef.ts). Default: none. */
    srcset?: string | null
    /** What width the cover renders at (`xs`, the size below), for `srcset`. Default: the app's. */
    sizes?: string
    /** The images to try after `src` fails (`coverImage`'s chain). Default: the app's. */
    fallbacks?: readonly string[]
    thumbhash?: string | null
    colors?: CoverColors | null
    /** An ebook file's own cover: shown whole whatever its shape (UiCover's `whole`). */
    whole?: boolean
  }>(),
  { src: null, srcset: null, sizes: undefined, fallbacks: () => [], thumbhash: null, colors: null, whole: false },
)

const { t } = useI18n()
const authorLine = computed(() => formatAuthors(props.authors, t('common.etAl')))
</script>

<template>
  <div class="flex items-center gap-ms pb-inset">
    <UiCover decorative :title="title" :authors="authors" :src="src" :srcset="srcset" :sizes="sizes" :fallbacks="fallbacks" :thumbhash="thumbhash" :colors="colors" size="xs" :whole="whole" />
    <div class="flex min-w-0 flex-col gap-xxs">
      <span class="book-title title-wrap text-callout">{{ title }}</span>
      <span class="truncate text-caption text-ink-faint">{{ authorLine }}</span>
    </div>
  </div>
</template>
