<script setup lang="ts">
// A row of covers on a member's profile (social v1, U4): Currently reading and Want to read. Covers
// only, no progress and no dates. It scrolls sideways under the finger and lets the page scroll on;
// each cover opens its Book, flying into its page (MemberBookLink; a Manual book opens nothing).
// Each cover carries its Book's title as its name.
import type { SocialBook } from '~/data/social'

const props = withDefaults(defineProps<{ books: readonly SocialBook[]; size?: 'sm' | 'md'; testid: string }>(), { size: 'md' })
const { t } = useI18n()
const shown = computed(() => props.books.map((b) => shownBook(b, t('book.outsideCatalogue'))))
const width = computed(() => (props.size === 'md' ? 'w-(--size-cover-md)' : 'w-(--size-cover-sm)'))
</script>

<template>
  <ul class="scrollbar-none -mx-screen flex snap-x scroll-px-screen gap-ms overflow-x-auto px-screen pt-xs pb-xxl -mb-xl" :data-testid="testid">
    <li v-for="(book, at) in shown" :key="book.id" class="shrink-0 snap-start" :class="width">
      <FriendsMemberBookLink :book="books[at]!" class="cover-link block rounded-cover" :aria-label="book.title" :data-testid="`${testid}.book`">
        <UiCover
          :title="book.title"
          :authors="book.authors"
          :src="coverSrc(book.coverUrl, props.size)"
          :thumbhash="book.coverThumbhash"
          :colors="book.coverColors"
          :size="props.size"
        />
      </FriendsMemberBookLink>
    </li>
  </ul>
</template>

<style scoped>
.cover-link:active {
  opacity: 0.8;
}
</style>
