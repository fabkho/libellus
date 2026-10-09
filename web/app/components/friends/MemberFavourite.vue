<script setup lang="ts">
// The favourite of a member's year in review (social v1, U4): the Book she rated best, as a card lit by its
// cover, the same card as on the Profile's own year page (pages/profile/[year].vue, which draws it inline
// and so cannot be reused from there). With `read` null, the placeholders hold its place in the loading
// wave (docs/MOTION.md, Loading). A Manual book is not opened.
import type { StatsRead } from '~/data/stats'

defineProps<{ read: StatsRead | null }>()
const { t } = useI18n()
</script>

<template>
  <FriendsMemberBookLink v-if="read" :book="{ id: read.book.id, manual: read.book.source === 'manual' }" class="card relative flex flex-col items-center gap-md overflow-hidden rounded-lg bg-surface-raised px-inset py-lg text-center shadow-raised edge-faint" data-testid="memberYear.favourite">
    <UiAmbient :colors="read.book.coverColors" shape="card" />
    <span class="eyebrow relative">{{ t('profile.year.favourite') }}</span>
    <UiCover
      decorative
      class="relative"
      :title="read.book.title"
      :authors="read.book.authors"
      :src="coverSrc(read.book.coverUrl, 'lg')"
      :thumbhash="read.book.coverThumbhash"
      :colors="read.book.coverColors"
      size="lg"
      glow
    />
    <span class="relative flex flex-col items-center gap-xs">
      <span class="book-title text-book-title" data-testid="memberYear.favouriteTitle">{{ read.book.title }}</span>
      <span class="text-body text-ink-muted">{{ formatAuthors(read.book.authors, t('common.etAl')) }}</span>
      <UiStars :quarters="read.rating" size="md" />
    </span>
  </FriendsMemberBookLink>
  <div v-else class="flex flex-col items-center gap-md rounded-lg bg-surface-raised px-inset py-lg shadow-raised edge-faint" aria-hidden="true">
    <span class="eyebrow">{{ t('profile.year.favourite') }}</span>
    <span class="favourite-cover skeleton wave" />
    <span class="flex w-full flex-col items-center gap-xs">
      <span class="line title-line"><span class="skeleton wave w-1/2" :style="{ '--wave': 0.05 }" /></span>
      <span class="line body-line"><span class="skeleton wave w-1/3" :style="{ '--wave': 0.1 }" /></span>
      <span class="line stars-line"><span class="skeleton wave w-1/4" :style="{ '--wave': 0.15 }" /></span>
    </span>
  </div>
</template>

<style scoped>
.favourite-cover {
  width: var(--size-cover-lg);
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover-lg);
}
.line {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: center;
}
.line > * {
  height: 62%;
}
.title-line {
  height: var(--text-book-title--line-height);
}
.body-line {
  height: var(--text-body--line-height);
}
.stars-line {
  height: var(--text-caption--line-height);
}
</style>
