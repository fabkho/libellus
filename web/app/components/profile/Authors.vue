<script setup lang="ts">
// The authors read more than once (issue #78): a fan of up to three of their
// covers, the name, a tally mark per read (every fifth followed by a gap, as
// Home's tally), the count large and the average Rating in mono. While the
// reading record loads (`figures` null), `limit` rows of placeholders in the
// loading wave (docs/MOTION.md, Loading).
import type { YearFigures } from '~/data/stats'

const props = withDefaults(defineProps<{ figures: YearFigures | null; limit?: number }>(), { limit: 4 })
const { t } = useI18n()
const { count, stars } = useFigures()
const arriving = useArrival(() => !props.figures)
</script>

<template>
  <section v-if="!figures || figures.authors.length" id="authors" class="flex flex-col gap-xs" data-testid="profile.authors">
    <h2 class="eyebrow mb-xs">{{ t('profile.authors.title') }}</h2>
    <template v-if="!figures">
      <ProfileRowPlaceholder v-for="i in limit" :key="i" :wave="(i - 1) * 0.15" fan />
    </template>
    <div v-else role="list" class="flex flex-col gap-xs">
      <!-- A list for assistive tech, each author one item: the name, then how many and the rating in
           words ("9 books, 4.6 stars on average"); the figure and the ★ are drawn for the eye. -->
      <div
        v-for="author in figures?.authors.slice(0, limit) ?? []"
        :key="author.name"
        role="listitem"
        class="flex items-center gap-md py-xs"
        :class="{ arrive: arriving }"
        data-testid="profile.author"
      >
        <span class="fan relative flex shrink-0" aria-hidden="true">
          <UiCover
            v-for="(book, i) in author.books.slice(0, 3)"
            :key="book.id"
            :style="{ '--i': i }"
            :title="book.title"
            :authors="book.authors"
            :src="coverSrc(book.coverUrl, 'sm')"
            :thumbhash="book.coverThumbhash"
            :colors="book.coverColors"
            size="sm"
          />
        </span>
        <span class="flex min-w-0 flex-1 flex-col gap-xs">
          <span class="truncate text-body" data-testid="profile.authorName">{{ author.name }}</span>
          <span class="ticks" aria-hidden="true"><span v-for="i in author.count" :key="i" class="tick" :class="{ fifth: i % 5 === 0 }" /></span>
        </span>
        <span class="sr-only">
          {{ t('profile.authors.count', { count: count(author.count) }, author.count) }}<template v-if="author.rating !== null">{{ t('common.listSeparator') }}{{ t('profile.authors.rating', { rating: stars(author.rating) }) }}</template>
        </span>
        <span class="flex shrink-0 flex-col items-end gap-xxs" aria-hidden="true">
          <span class="text-title tabular-nums" data-testid="profile.authorCount">{{ count(author.count) }}</span>
          <span v-if="author.rating !== null" class="figures text-meta text-ink-faint">★ {{ stars(author.rating) }}</span>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.fan {
  width: calc(var(--size-cover-sm) + 2 * var(--spacing-ms));
}
.fan > * {
  position: relative;
  z-index: calc(3 - var(--i));
}
.fan > * + * {
  margin-left: calc(var(--spacing-ms) - var(--size-cover-sm));
}
.ticks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}
.tick {
  width: var(--stroke-rule);
  height: var(--spacing-ms);
  background: var(--color-ink-faint);
}
.tick.fifth {
  margin-right: var(--spacing-xs);
}
</style>
