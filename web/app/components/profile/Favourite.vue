<script setup lang="ts">
// The favourite of a year in review: the Book rated best, as a card lit by its cover. One card for the
// Profile's own year page and for a member's (social v1, U4): `foreign` is the member's, where a Manual
// book is hers alone and opens nothing (as in MonthBooks); `testid` names the card, its title is `<testid>Title`. With `read` null, the placeholders hold its
// place in the loading wave (docs/MOTION.md, Loading). Attributes (`id`, `class`) land on the card, not
// on the placeholders.
import type { StatsRead } from '~/data/stats'

defineOptions({ inheritAttrs: false })
withDefaults(defineProps<{ read: StatsRead | null; foreign?: boolean; testid?: string }>(), { foreign: false, testid: 'yearInReview.favourite' })
const { t } = useI18n()
</script>

<template>
  <FriendsMemberBookLink
    v-if="read"
    v-bind="$attrs"
    :book="linkOf(read.book, foreign)"
    class="relative flex flex-col items-center gap-md overflow-hidden rounded-lg bg-surface-raised px-inset py-lg text-center shadow-raised edge-faint"
    :data-testid="testid"
  >
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
      <span class="book-title text-book-title" :data-testid="`${testid}Title`">{{ read.book.title }}</span>
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
