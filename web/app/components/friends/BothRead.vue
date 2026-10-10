<script setup lang="ts">
// "You both read" on a member's profile and on her year page (social v2a, contract §1.3 and §3): the Books both
// finished, as a row of covers like her other rows (FriendsMemberCovers' sizes), and under each cover two star
// rows, yours and hers (hers absent when she shows no ratings: `rating` null). A cover opens its Book
// (FriendsMemberBookLink, a Manual book opens nothing). The section is not drawn without Books.
// Props only: the screen asks `both_read(member, year?)` and hands the answer in.
//  - `items`  the answer (BothRead[], newest of hers first).
//  - `name`   her name, for the screen reader's labels.
// Test ids: `member.bothRead` (the section), `member.bothRead.book`, `member.bothRead.mine`,
// `member.bothRead.hers`.
import type { BothRead } from '~/data/social'

defineProps<{ items: readonly BothRead[]; name: string }>()
const { t } = useI18n()
const said = (quarters: number | null) => (quarters ? ratingText(quarters) : t('member.bothReadNoRating'))
</script>

<template>
  <section v-if="items.length" class="flex flex-col gap-md" data-testid="member.bothRead">
    <div class="flex flex-col gap-xxs">
      <h2 class="eyebrow">{{ t('member.bothRead') }}</h2>
      <!-- Two star rows under a cover, so which is whose is said once, above them (only when hers show). -->
      <p v-if="items.some((item) => item.hers.rating)" class="text-footnote text-ink-faint" aria-hidden="true" data-testid="member.bothRead.legend">{{ t('member.bothReadLegend', { name }) }}</p>
    </div>
    <ul class="scrollbar-none -mx-screen flex snap-x scroll-px-screen gap-ms overflow-x-auto px-screen pt-xs pb-xxl -mb-xl">
      <li v-for="item in items" :key="item.book.id" class="flex w-(--size-cover-md) shrink-0 snap-start flex-col gap-xs">
        <FriendsMemberBookLink :book="item.book" class="cover-link block rounded-cover" :aria-label="item.book.title" data-testid="member.bothRead.book">
          <UiCover
            :title="item.book.title"
            :authors="item.book.authors"
            :src="coverSrc(item.book.coverUrl, 'md')"
            :thumbhash="item.book.coverThumbhash"
            :colors="item.book.coverColors"
            size="md"
          />
        </FriendsMemberBookLink>
        <!-- Her stars only where she shows them. Each row is one phrase for the screen reader ("You: 4.5"); the value stays out of the drawing, the width is the cover's. -->
        <div class="flex flex-col gap-xxs">
          <span class="flex" role="img" :aria-label="t('member.bothReadYours', { rating: said(item.mine.rating) })" data-testid="member.bothRead.mine">
            <UiStars aria-hidden="true" :quarters="item.mine.rating" size="sm" :show-value="false" />
          </span>
          <span v-if="item.hers.rating" class="flex" role="img" :aria-label="t('member.bothReadHers', { name, rating: said(item.hers.rating) })" data-testid="member.bothRead.hers">
            <UiStars aria-hidden="true" :quarters="item.hers.rating" size="sm" :show-value="false" />
          </span>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cover-link:active {
  opacity: 0.8;
}
</style>
