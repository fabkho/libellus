<script setup lang="ts">
// "You both read" on a member's profile and on her year page (social v2a, contract §1.3 and §3): the Books both
// finished, as a row of covers like her other rows (FriendsMemberCovers' sizes), and under each cover her stars
// (absent when she shows no ratings: `rating` null). Not the member's own: that is on the Book's page. A cover opens
// its Book (FriendsMemberBookLink, a Manual book opens nothing). The section is not drawn without Books.
// Props only: the screen asks `both_read(member, year?)` and hands the answer in.
//  - `items`  the answer (BothRead[], newest of hers first).
//  - `name`   her name, for the screen reader's label.
// Test ids: `member.bothRead` (the section), `member.bothRead.book`, `member.bothRead.hers`.
import type { BothRead } from '~/data/social'

defineProps<{ items: readonly BothRead[]; name: string }>()
const { t } = useI18n()
// A Book the check could not confirm is the one string, on the Placeholder, and opens nothing (utils/unverifiedBook.ts).
const shown = (book: BothRead['book']) => shownBook(book, t('book.outsideCatalogue'))
</script>

<template>
  <section v-if="items.length" class="flex flex-col gap-md" data-testid="member.bothRead">
    <h2 class="eyebrow">{{ t('member.bothRead') }}</h2>
    <ul class="scrollbar-none -mx-screen flex snap-x scroll-px-screen gap-ms overflow-x-auto px-screen pt-xs pb-xxl -mb-xl">
      <li v-for="item in items" :key="item.book.id" class="flex w-(--size-cover-md) shrink-0 snap-start flex-col gap-xs">
        <FriendsMemberBookLink :book="item.book" class="cover-link block rounded-cover" :aria-label="shown(item.book).title" data-testid="member.bothRead.book">
          <UiCover
            :title="shown(item.book).title"
            :authors="shown(item.book).authors"
            :src="coverSrc(shown(item.book).coverUrl, 'md')"
            :thumbhash="shown(item.book).coverThumbhash"
            :colors="shown(item.book).coverColors"
            size="md"
          />
        </FriendsMemberBookLink>
        <!-- Her stars only where she shows them; the value stays out of the drawing, the width is the cover's. -->
        <span v-if="item.hers.rating" class="flex" role="img" :aria-label="t('member.bothReadHers', { name, rating: ratingText(item.hers.rating) })" data-testid="member.bothRead.hers">
          <UiStars aria-hidden="true" :quarters="item.hers.rating" size="sm" :show-value="false" />
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cover-link:active {
  opacity: 0.8;
}
</style>
