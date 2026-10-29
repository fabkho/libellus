<script setup lang="ts">
// The text alternative of "You both read": every Book both read, newest of hers first, as a list of links, each
// read out as "Title by Author. Lena: 4.50. You: 5.00." where the ratings are shown. It is what a screen reader
// gets in place of the canvas (always in the page, hidden from the eye), and what "Show as a list" shows to
// everyone else; it carries every Book where the reel keeps to the newest 24. A Manual book or an unverified one
// is a line that opens nothing (FriendsMemberBookLink).
//  - `items`   the whole answer.
//  - `name`    her name.
//  - `visible` drawn on the page; otherwise only for assistive technology.
// Test ids: `member.bothRead.list`, `member.bothRead.item`.
import type { BothRead } from '~/data/socialShapes'

const props = defineProps<{ items: readonly BothRead[]; name: string; visible?: boolean }>()
const { t } = useI18n()

function shown(item: BothRead) {
  return shownBook(item.book, t('book.outsideCatalogue'))
}
/** The sentence a screen reader gets for a Book: what it is, then each rating that is shown. */
function sentence(item: BothRead): string {
  const book = shown(item)
  const parts = [book.authors.length ? t('member.bothReadItem', { title: book.title, author: book.authors.join(', ') }) : book.title]
  if (item.hers.rating) parts.push(t('member.bothReadHers', { name: props.name, rating: ratingText(item.hers.rating) }))
  if (item.mine.rating) parts.push(t('member.bothReadMine', { rating: ratingText(item.mine.rating) }))
  return parts.join('. ')
}
</script>

<template>
  <ul :class="visible ? 'flex flex-col' : 'sr-only'" :aria-label="t('member.bothReadLabel', { name })" data-testid="member.bothRead.list">
    <li v-for="item in items" :key="item.book.id" data-testid="member.bothRead.item">
      <FriendsMemberBookLink :book="item.book" class="flex min-h-(--size-touch) items-center py-xs" :aria-label="sentence(item)" data-testid="member.bothRead.item.link">
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="book-title text-body">{{ shown(item).title }}</span>
          <span v-if="shown(item).authors.length" class="text-footnote text-ink-muted">{{ shown(item).authors.join(', ') }}</span>
          <span v-if="item.hers.rating || item.mine.rating" class="figures flex flex-wrap gap-x-md text-meta text-ink-faint">
            <span v-if="item.hers.rating">{{ t('member.bothReadHers', { name, rating: ratingText(item.hers.rating) }) }}</span>
            <span v-if="item.mine.rating">{{ t('member.bothReadMine', { rating: ratingText(item.mine.rating) }) }}</span>
          </span>
        </span>
      </FriendsMemberBookLink>
    </li>
  </ul>
</template>

<style scoped>
/* Up to 300 rows, always in the page (a screen reader's list): the browser skips laying out and painting the ones off
   screen and keeps them in the accessibility tree (`auto`), at the height of a row until they are drawn. */
li {
  content-visibility: auto;
  contain-intrinsic-size: auto var(--size-touch);
}
</style>
