<script setup lang="ts">
// Recently finished on a member's profile (social v1, U4): her last finished Books, each a row with its
// cover, title, author, her stars and the day, and her review folded at four lines with More. The stars
// and the review are there only where her switches let them through (the database sends them null
// otherwise). A cover or title opens the Book, flying into its page; a Manual book opens nothing.
import type { SocialBook } from '~/data/social'

defineProps<{ items: readonly { book: SocialBook; endedOn: string | null; rating: number | null; review: string | null }[] }>()

const { t } = useI18n()
const { formatDay } = useDays()
</script>

<template>
  <section class="flex flex-col" data-testid="member.finished">
    <h2 class="eyebrow mb-xs">{{ t('member.finished') }}</h2>
    <ul class="flex flex-col">
      <li v-for="item in items" :key="item.book.id" class="row flex items-start gap-inset py-sm">
        <FriendsMemberBookLink :book="item.book" class="shrink-0">
          <UiCover
            decorative
            :title="item.book.title"
            :authors="item.book.authors"
            :src="coverSrc(item.book.coverUrl, 'sm')"
            :thumbhash="item.book.coverThumbhash"
            :colors="item.book.coverColors"
            size="sm"
          />
        </FriendsMemberBookLink>
        <div class="flex min-w-0 flex-1 flex-col gap-xxs">
          <FriendsMemberBookLink :book="item.book" class="flex flex-col gap-xxs">
            <span class="book-title title-wrap text-callout" data-testid="member.finishedTitle">{{ item.book.title }}</span>
            <span class="truncate text-caption text-ink-muted">{{ formatAuthors(item.book.authors, t('common.etAl')) }}</span>
          </FriendsMemberBookLink>
          <span v-if="item.rating || item.endedOn" class="figures mt-xxs flex items-center gap-sm overflow-hidden text-meta whitespace-nowrap text-ink-faint">
            <UiStars v-if="item.rating" :quarters="item.rating" />
            <span v-if="item.rating && item.endedOn" class="dot" aria-hidden="true" />
            <span v-if="item.endedOn">{{ formatDay(item.endedOn) }}</span>
          </span>
          <FriendsMemberReview v-if="item.review" :text="item.review" />
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
