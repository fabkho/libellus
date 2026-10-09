<script setup lang="ts">
// One read in the Profile (issue #78): Library's row — small cover, serif
// title, author — opening the book page from the touch-down (on a member's page, `foreign`, a Manual book opens nothing). Either with a
// mono line of its stars, its day and how long it took (the month and rating
// sheets, a second read marked), or with a `label` over the title (a record)
// and a `figure` at the right.
import type { StatsRead } from '~/data/stats'
import { linkOf } from '~/utils/memberProfile'

const props = withDefaults(defineProps<{ read: StatsRead; label?: string; figure?: string; withYear?: boolean; foreign?: boolean }>(), {
  label: undefined,
  figure: undefined,
  withYear: false,
  foreign: false,
})
const link = computed(() => linkOf(props.read.book, props.foreign))

const { t } = useI18n()
const { formatDay } = useDays()
const { readIn } = useFigures()
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const
/** "Second read", as the reading history names it. */
const nthRead = (n: number) => (ORDINALS[n - 1] ? t(`history.ordinal.${ORDINALS[n - 1]}`) : t('history.nth', { n }))
</script>

<template>
  <FriendsMemberBookLink :book="link" class="row flex items-center gap-inset py-sm">
    <UiCover
      decorative
      :title="read.book.title"
      :authors="read.book.authors"
      :src="coverSrc(read.book.coverUrl, 'sm')"
      :thumbhash="read.book.coverThumbhash"
      :colors="read.book.coverColors"
      size="sm"
    />
    <span class="flex min-w-0 flex-1 flex-col gap-xxs">
      <span v-if="label" class="eyebrow">{{ label }}</span>
      <span class="book-title title-wrap text-callout" data-testid="profile.readTitle">{{ read.book.title }}</span>
      <template v-if="!label">
        <span class="flex min-w-0 items-center gap-sm text-caption text-ink-muted">
          <span class="truncate">{{ formatAuthors(read.book.authors, t('common.etAl')) }}</span>
          <span v-if="read.nth > 1" class="figures flex shrink-0 items-center gap-xxs text-meta text-ink-faint" data-testid="profile.readAgain">
            <UiIcon name="repeat" :size="11" />{{ nthRead(read.nth) }}
          </span>
        </span>
        <span class="figures mt-xxs flex items-center gap-sm overflow-hidden text-meta whitespace-nowrap text-ink-faint">
          <UiStars v-if="read.rating" :quarters="read.rating" />
          <span v-else class="text-ink-faint">{{ t('rating.none') }}</span>
          <template v-if="read.endedOn"><span class="dot" aria-hidden="true" />{{ formatDay(read.endedOn, { year: withYear }) }}</template>
          <template v-if="read.days !== null"><span class="dot" aria-hidden="true" />{{ readIn(read) }}</template>
        </span>
      </template>
    </span>
    <span v-if="figure" class="figures shrink-0 text-caption text-ink-muted">{{ figure }}</span>
  </FriendsMemberBookLink>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
/* Pressed (and hovered with a mouse): a fill a little wider than the row, as Library's rows. */
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
