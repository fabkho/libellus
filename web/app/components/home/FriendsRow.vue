<script setup lang="ts">
// One member's row in Home's Your friends (social v1, U8; the "By friend" mock): her avatar and name
// with the day of her newest event at the line's end ("Yesterday"), under it in muted ink one sentence
// of what she did lately ("started *Piranesi* · added 3 to Want to read", Book titles in the serif
// italic), and at the right a small fan of the covers the sentence names. A tap on the row does what a tap on the
// feed's batch row does (social v2a): it opens the sheet of the reads the sentence names (`open`, Friends.vue holds
// the sheet); when the sentence tells of one read it opens that Book instead, the cover flying there. Her
// avatar and her name are their own targets and open her page (`/friends/<member>`, the avatar flying into her
// page's, plugins/author-transition.client.ts). The fan is decoration, so the covers are `decorative` and the titles
// are in the sentence. Drawing only: utils/friendsView.ts decides the phrases, the Books and the day.
//
// The row's tap is the sentence's own button (or link), stretched over the row (`stretched`, main.css), with her
// avatar and name above it: nothing is nested in a link or a button.
//
// Props: `friend` (FriendsRow), `dayLabel` (the feed's word for the day, `useFeedDay`), `eager`
// (the first covers on screen load now). Emits `open` (the sheet). Test ids: `home.friendsRow` (the row),
// `.open` (the row's button or link), `.member` (her name), `.avatar`.
import type { FriendsRow } from '~/utils/friendsView'
import type { SocialBook } from '~/data/socialShapes'
import { useBookStore } from '~/stores/book'

const coverHosts = useCoverHosts() // our stored copies and `/cover`, as this build has them (utils/coverRef.ts)

const props = defineProps<{ friend: FriendsRow; dayLabel: string; eager?: boolean }>()
defineEmits<{ open: [] }>()

const { t } = useI18n()
const books = useBookStore()
const shown = (book: SocialBook) => shownBook(book, t('book.outsideCatalogue'))
const name = computed(() => props.friend.member.name?.trim() || t('member.someone'))
const memberPath = computed(() => `/friends/${props.friend.member.id}`)
// One read, and a Book a follower can open (not a Manual or unverified one): the row is that Book's link.
const single = computed(() => {
  const [only, more] = props.friend.entries
  if (!only || more) return null
  const book = shown(only.book)
  return !book.manual && !book.unverified ? book : null
})
const PressLink = resolveComponent('UiPressLink')
</script>

<template>
  <li class="relative" data-testid="home.friendsRow">
    <div class="flex items-start gap-ms py-ms">
      <NuxtLink :to="memberPath" class="reach relative z-1 shrink-0" tabindex="-1" aria-hidden="true" data-testid="home.friendsRow.avatar">
        <FriendsAvatar :card="friend.member" />
      </NuxtLink>
      <div class="flex min-w-0 flex-1 flex-col gap-xxs">
        <div class="flex items-baseline justify-between gap-sm">
          <NuxtLink :to="memberPath" class="reach relative z-1 min-w-0 truncate text-subhead font-medium" data-testid="home.friendsRow.member">{{ name }}</NuxtLink>
          <span class="eyebrow shrink-0" aria-hidden="true">{{ dayLabel }}</span>
        </div>
        <!-- The row's tap: the sheet of her reads, or the Book of the one read; stretched over the whole row. -->
        <component
          :is="single ? PressLink : 'button'"
          v-bind="single ? { to: `/book/${single.id}` } : { type: 'button', 'aria-haspopup': 'dialog' }"
          v-on="flightOf(single ? `/book/${single.id}` : null)"
          class="stretched flex items-center justify-between gap-sm text-left"
          data-testid="home.friendsRow.open"
          @press="single && books.prefetch(single.id)"
          @click="!single && $emit('open')"
        >
          <span class="sr-only">{{ name }}: </span>
          <span class="line-clamp-2 min-w-0 text-caption text-ink-muted">
            <template v-for="(phrase, index) in friend.phrases" :key="index">
              <template v-if="index > 0">
                <span aria-hidden="true">{{ t('friends.join') }}</span>
                <span class="sr-only">, </span>
              </template>
              <template v-if="phrase.type === 'batch'">{{ t(`feed.${phrase.key}`, { count: phrase.count }) }}</template>
              <i18n-t v-else-if="phrase.verb === 'want'" keypath="friends.want" tag="span" scope="global">
                <template #title>
                  <template v-for="(book, at) in phrase.books" :key="book.id">
                    <template v-if="at > 0">{{ t('friends.and') }}</template><i class="book-title italic">{{ shown(book).title }}</i>
                  </template>
                </template>
              </i18n-t>
              <template v-else>
                {{ t(`feed.${phrase.verb}`) }}
                <template v-for="(book, at) in phrase.books" :key="book.id">
                  <template v-if="at > 0">{{ t('friends.and') }}</template><i class="book-title italic">{{ shown(book).title }}</i>
                </template>
              </template>
            </template>
            <!-- The day is drawn at the top right; read, it follows the sentence. -->
            <span class="sr-only">, {{ dayLabel }}</span>
          </span>
          <span class="flex shrink-0" aria-hidden="true">
            <UiCover
              v-for="book in friend.books"
              :key="book.id"
              decorative
              :title="shown(book).title"
              :authors="shown(book).authors"
              v-bind="coverImage(shown(book), 'sm', coverHosts)"
              :thumbhash="shown(book).coverThumbhash"
              :colors="shown(book).coverColors"
              size="xs"
              :eager="eager"
              class="cover"
            />
          </span>
        </component>
      </div>
    </div>
  </li>
</template>

<style scoped>
/* A link drawn smaller than a finger: its 44 px target is an invisible box centred on it (above the row's stretched tap). */
.reach {
  position: relative;
}
.reach::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
/* The fan: each cover a little over the one before it. */
.cover + .cover {
  margin-left: calc(-0.7 * var(--size-cover-xs));
}
</style>
