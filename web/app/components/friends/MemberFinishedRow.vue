<script setup lang="ts">
// One finished Book on a member's profile (social v1, U4b), in the section and in its *See all* sheet: the
// cover, title, author, her stars and the day, and her review folded at four lines with More. The stars and
// the review are there only where her switches let them through (the database sends them null otherwise).
// A cover or title opens the Book, flying into its page; a Manual book opens nothing. The title's link is the
// Book's one link for the keyboard and screen readers (the cover's is hidden from both, as the feed's rows have it).
// Social v2a: at the right of the stars' line, Want to read first and the heart last (the order of the feed and
// Home's card; FriendsLikes: `member.finishedLike`, `name` is hers, for the screen reader); a review flagged as
// spoilers that the reader may not read yet is folded behind *Show anyway* (`member.finishedFolded`).
import type { MemberFinished } from '~/data/social'
import { focusAfterWant } from '~/utils/focusAfterWant'
import { likeable } from '~/utils/likes'

defineProps<{ item: MemberFinished; name?: string; memberId?: string }>()

const { t } = useI18n()
const { formatDay } = useDays()
const row = useTemplateRef<HTMLElement>('row')
/** The button is gone once the Book is added: focus goes to the heart, else the title. */
async function wanted() {
  await nextTick()
  focusAfterWant(row.value, 'member.finishedLike', 'member.finishedBook')
}
</script>

<template>
  <div ref="row" class="flex items-start gap-inset py-sm">
    <FriendsMemberBookLink :book="item.book" class="shrink-0" tabindex="-1" aria-hidden="true" data-testid="member.finishedCover">
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
      <FriendsMemberBookLink :book="item.book" class="flex flex-col gap-xxs" data-testid="member.finishedBook">
        <span class="book-title title-wrap text-callout" data-testid="member.finishedTitle">{{ item.book.title }}</span>
        <span class="truncate text-caption text-ink-muted">{{ formatAuthors(item.book.authors, t('common.etAl')) }}</span>
      </FriendsMemberBookLink>
      <div class="mt-xxs flex items-center justify-between gap-md">
        <span class="figures flex min-w-0 items-center gap-sm overflow-hidden text-meta whitespace-nowrap text-ink-faint">
          <UiStars v-if="item.rating" :quarters="item.rating" />
          <span v-if="item.rating && item.endedOn" class="dot" aria-hidden="true" />
          <span v-if="item.endedOn">{{ formatDay(item.endedOn) }}</span>
        </span>
        <span class="flex shrink-0 items-center gap-md">
          <FriendsWantToReadButton :book="item.book" testid="member.finishedWantToRead" @added="wanted" />
          <FriendsLikes v-if="likeable(item)" :row="item" :name="name || t('member.someone')" :owner="memberId" :title="item.book.title" testid="member.finishedLike" />
        </span>
      </div>
      <FriendsLikeError v-if="likeable(item)" :row="item" testid="member.finishedLike" />
      <FriendsReviewFold v-if="item.review" :folded="item.folded" :name="name" testid="member.finishedFolded">
        <FriendsMemberReview :text="item.review" />
      </FriendsReviewFold>
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
