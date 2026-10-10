<script setup lang="ts">
// One finished Book on a member's profile (social v1, U4b), in the section and in its *See all* sheet: the
// cover, title, author, her stars and the day, and her review folded at four lines with More. The stars and
// the review are there only where her switches let them through (the database sends them null otherwise).
// A cover or title opens the Book, flying into its page; a Manual book opens nothing. The title's link is the
// Book's one link for the keyboard and screen readers (the cover's is hidden from both, as the feed's rows have it).
// Social v2a: at the right of the stars' line (under it, at the right, where they do not fit beside the stars and the day), Want to read first and the heart last (the order of the feed and
// Home's card; FriendsLikes: `member.finishedLike`, `name` is hers, for the screen reader); a review flagged as
// spoilers that the reader may not read yet is folded behind *Show anyway* (`member.finishedFolded`).
import type { MemberFinished } from '~/data/social'
import { focusAfterWant } from '~/utils/focusAfterWant'
import { likeable } from '~/utils/likes'

const props = defineProps<{ item: MemberFinished; name?: string; memberId?: string }>()

const { t } = useI18n()
const shown = computed(() => shownBook(props.item.book, t('book.outsideCatalogue')))
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
      <!-- The stars and the day are never clipped: where the actions do not fit beside them they take a line of their own under, at the right (one row, one more line only when it must). -->
      <div class="mt-xxs flex flex-wrap items-center gap-x-md gap-y-xs">
        <span class="figures flex min-w-0 items-center gap-sm text-meta text-ink-faint">
          <UiStars v-if="item.rating" :quarters="item.rating" />
          <span v-if="item.rating && item.endedOn" class="dot shrink-0" aria-hidden="true" />
          <span v-if="item.endedOn" class="whitespace-nowrap">{{ formatDay(item.endedOn) }}</span>
        </span>
        <span class="ml-auto flex shrink-0 items-center gap-md" :class="item.review ? '[--tiny-action-down:var(--spacing-xxs)]' : '[--tiny-action-down:var(--spacing-ms)]'">
          <FriendsWantToReadButton :book="item.book" testid="member.finishedWantToRead" @added="wanted" />
          <FriendsLikes v-if="likeable(item)" :row="item" :name="name || t('member.someone')" :owner="memberId" :title="shown.title" testid="member.finishedLike" />
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
