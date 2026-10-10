<script setup lang="ts">
// One of her reviews on the own Profile, in the section and in its *See all* sheet (social v2a): the shape of a
// member's Recently finished row (FriendsMemberFinishedRow) — small cover, serif title, author, her stars and the
// day she finished it — and her review in the serif italic folded at four lines with More (FriendsMemberReview).
// It is hers, so it is never folded for spoilers; one she flagged carries a small quiet "Spoilers" tag. The cover and
// the title open the Book from the touch-down, the cover flying into its page (the title's link is the one for the
// keyboard and screen readers; the cover's is hidden from both). Test ids: `<testid>` on the row's root (default
// `profile.reviews.row`), `.cover`, `.book` (the links), `.title`, `.spoilers`.
import type { ProfileReview } from '~/utils/profileReviews'

const props = withDefaults(defineProps<{ item: ProfileReview; testid?: string }>(), { testid: 'profile.reviews.row' })

const { t } = useI18n()
const { formatDay } = useDays()
const book = computed(() => props.item.entry.book)
const link = computed(() => ({ id: book.value.id, manual: false }))
</script>

<template>
  <div class="flex items-start gap-inset py-sm" :data-testid="testid">
    <FriendsMemberBookLink :book="link" class="shrink-0" tabindex="-1" aria-hidden="true" :data-testid="`${testid}.cover`">
      <UiCover
        decorative
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'sm')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        size="sm"
      />
    </FriendsMemberBookLink>
    <div class="flex min-w-0 flex-1 flex-col gap-xxs">
      <FriendsMemberBookLink :book="link" class="flex flex-col gap-xxs" :data-testid="`${testid}.book`">
        <span class="book-title title-wrap text-callout" :data-testid="`${testid}.title`">{{ book.title }}</span>
        <span class="truncate text-caption text-ink-muted">{{ formatAuthors(book.authors, t('common.etAl')) }}</span>
      </FriendsMemberBookLink>
      <div class="mt-xxs flex items-center justify-between gap-md">
        <span class="figures flex min-w-0 items-center gap-sm overflow-hidden text-meta whitespace-nowrap text-ink-faint">
          <UiStars v-if="item.rating" :quarters="item.rating" />
          <span v-if="item.rating && item.endedOn" class="dot" aria-hidden="true" />
          <span v-if="item.endedOn">{{ formatDay(item.endedOn) }}</span>
        </span>
        <span v-if="item.spoilers" class="shrink-0 text-meta text-ink-faint" :data-testid="`${testid}.spoilers`">{{ t('profile.reviews.spoilers') }}</span>
      </div>
      <FriendsMemberReview :text="item.review" />
    </div>
  </div>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>
