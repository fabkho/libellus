<script setup lang="ts">
// One finished Book on a member's profile (social v1, U4b), in the section and in its *See all* sheet: the
// cover, title, author, her stars and the day, and her review folded at four lines with More. The stars and
// the review are there only where her switches let them through (the database sends them null otherwise).
// A cover or title opens the Book, flying into its page; a Manual book opens nothing. The title's link is the
// Book's one link for the keyboard and screen readers (the cover's is hidden from both, as the feed's rows have it).
// Social v2a: at the row's right edge, a narrow column centred on the cover with Want to read on top and the heart under it
// (FriendsRowActions: `member.finishedWantToRead`, `member.finishedLike`, `name` is hers, for the screen reader); a review flagged as
// spoilers that the reader may not read yet is folded behind *Show anyway* (`member.finishedFolded`).
import type { MemberFinished } from '~/data/social'
import { likeable } from '~/utils/likes'

const props = defineProps<{ item: MemberFinished; name?: string; memberId?: string }>()

const { t } = useI18n()
const shown = computed(() => shownBook(props.item.book, t('book.outsideCatalogue')))
const { formatDay } = useDays()
</script>

<template>
  <div class="flex items-start gap-inset py-sm">
    <FriendsMemberBookLink :book="item.book" class="shrink-0" tabindex="-1" aria-hidden="true" data-testid="member.finishedCover">
      <UiCover
        decorative
        :title="shown.title"
        :authors="shown.authors"
        :src="coverSrc(shown.coverUrl, 'sm')"
        :thumbhash="shown.coverThumbhash"
        :colors="shown.coverColors"
        size="sm"
      />
    </FriendsMemberBookLink>
    <div class="flex min-w-0 flex-1 flex-col gap-xxs">
      <FriendsMemberBookLink :book="item.book" class="flex flex-col gap-xxs" data-testid="member.finishedBook">
        <span class="book-title title-wrap text-callout" data-testid="member.finishedTitle">{{ shown.title }}</span>
        <span v-if="shown.authors.length" class="truncate text-caption text-ink-muted">{{ formatAuthors(shown.authors, t('common.etAl')) }}</span>
      </FriendsMemberBookLink>
      <span class="figures mt-xxs flex min-w-0 items-center gap-sm text-meta whitespace-nowrap text-ink-faint">
        <UiStars v-if="item.rating" :quarters="item.rating" />
        <span v-if="item.rating && item.endedOn" class="dot shrink-0" aria-hidden="true" />
        <span v-if="item.endedOn">{{ formatDay(item.endedOn) }}</span>
      </span>
      <FriendsLikeError v-if="likeable(item)" :row="item" testid="member.finishedLike" />
      <FriendsReviewFold v-if="item.review" :folded="item.folded" :name="name" testid="member.finishedFolded">
        <FriendsMemberReview :text="item.review" />
      </FriendsReviewFold>
    </div>
    <FriendsRowActions
      cover="sm"
      :book="item.book"
      :like="likeable(item) ? item : null"
      :name="name || t('member.someone')"
      :owner="memberId"
      :title="shown.title"
      want-testid="member.finishedWantToRead"
      like-testid="member.finishedLike"
    />
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
