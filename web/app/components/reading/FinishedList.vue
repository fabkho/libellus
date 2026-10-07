<script setup lang="ts">
// Recently finished on a reading page (issue #171): Library's row (small
// cover, serif title, author), her Rating and the day she finished, and her
// review under it where she shared it. Each row opens the Book's card, its cover flying there (UiPressLink).
import { bookCardPath, type PublicReadingPage } from '~/data/readingPage'

defineProps<{ items: NonNullable<PublicReadingPage['finished']>; token: string }>()

const { t } = useI18n()
const { formatDay } = useDays()
</script>

<template>
  <ul class="flex flex-col" data-testid="readingPage.finished">
    <li v-for="item in items" :key="item.book.id">
      <UiPressLink :to="bookCardPath(token, item.book.id)" class="row flex items-start gap-inset py-sm" data-testid="readingPage.finishedBook">
        <UiCover
          decorative
          :title="item.book.title"
          :authors="item.book.authors"
          :src="coverSrc(item.book.coverUrl, 'sm')"
          :thumbhash="item.book.coverThumbhash"
          :colors="item.book.coverColors"
          size="sm"
        />
        <span class="flex min-w-0 flex-1 flex-col gap-xxs">
          <span class="book-title title-wrap text-callout">{{ item.book.title }}</span>
          <span class="truncate text-caption text-ink-muted">{{ formatAuthors(item.book.authors, t('common.etAl')) }}</span>
          <span class="figures mt-xxs flex items-center gap-sm text-meta whitespace-nowrap text-ink-faint">
            <UiStars v-if="item.rating" :quarters="item.rating" />
            <template v-if="item.endedOn"><span v-if="item.rating" class="dot" aria-hidden="true" />{{ formatDay(item.endedOn) }}</template>
          </span>
          <span v-if="item.review" class="mt-xs line-clamp-4 text-subhead text-ink-muted" data-testid="readingPage.review">{{ item.review }}</span>
        </span>
      </UiPressLink>
    </li>
  </ul>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
.row {
  position: relative;
  isolation: isolate;
}
.row::after {
  position: absolute;
  inset: 0 calc(-1 * var(--spacing-sm));
  z-index: -1;
  content: '';
  border-radius: var(--radius-md);
}
.row:active::after {
  background: var(--color-fill);
}
@media (hover: hover) {
  .row:hover::after {
    background: var(--color-fill);
  }
}
</style>
