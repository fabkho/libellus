<script setup lang="ts">
// One member's row in Home's Your circle (social v1, U8; the "By friend" mock): her avatar and name
// with the day of her newest event at the line's end ("Yesterday"), under it in muted ink one sentence
// of what she did lately ("started *Piranesi* · added 3 to Want to read", Book titles in the serif
// italic), and at the right a small fan of the covers the sentence names. The whole row opens her page
// (`/friends/<member>`); the fan is decoration, so the covers are `decorative` and the titles are in
// the sentence. Drawing only: utils/circleView.ts decides the phrases, the Books and the day.
//
// Props: `friend` (CircleFriend), `dayLabel` (the feed's word for the day, `useFeedDay`), `eager`
// (the first covers on screen load now). Test id: `home.circleFriend` (on the link).
import type { CircleFriend } from '~/utils/circleView'

const props = defineProps<{ friend: CircleFriend; dayLabel: string; eager?: boolean }>()

const { t } = useI18n()
const name = computed(() => props.friend.member.name?.trim() || t('member.someone'))
</script>

<template>
  <li>
    <NuxtLink :to="`/friends/${friend.member.id}`" class="flex items-start gap-ms py-ms" data-testid="home.circleFriend">
      <FriendsAvatar :card="friend.member" />
      <span class="flex min-w-0 flex-1 flex-col gap-xxs">
        <span class="flex items-baseline justify-between gap-sm">
          <span class="truncate text-subhead font-medium">{{ name }}</span>
          <span class="eyebrow shrink-0">{{ dayLabel }}</span>
        </span>
        <span class="flex items-center justify-between gap-sm">
          <span class="line-clamp-2 min-w-0 text-caption text-ink-muted">
            <template v-for="(phrase, index) in friend.phrases" :key="index">
              <span v-if="index > 0" aria-hidden="true">{{ t('circle.join') }}</span>
              <template v-if="phrase.type === 'batch'">{{ t(`feed.${phrase.key}`, { count: phrase.count }) }}</template>
              <i18n-t v-else-if="phrase.verb === 'want'" keypath="circle.want" tag="span" scope="global">
                <template #title><i class="book-title italic">{{ phrase.book.title }}</i></template>
              </i18n-t>
              <template v-else>{{ t(`feed.${phrase.verb}`) }} <i class="book-title italic">{{ phrase.book.title }}</i></template>
            </template>
          </span>
          <span class="flex shrink-0" aria-hidden="true">
            <UiCover
              v-for="book in friend.books"
              :key="book.id"
              decorative
              :title="book.title"
              :authors="book.authors"
              :src="coverSrc(book.coverUrl, 'sm')"
              :thumbhash="book.coverThumbhash"
              :colors="book.coverColors"
              size="xs"
              :eager="eager"
              class="cover"
            />
          </span>
        </span>
      </span>
    </NuxtLink>
  </li>
</template>

<style scoped>
/* The fan: each cover a little over the one before it. */
.cover + .cover {
  margin-left: calc(-0.7 * var(--size-cover-xs));
}
</style>
