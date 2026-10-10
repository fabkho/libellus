<script setup lang="ts">
// The actions of a friend's Book in a row (social v2a, contract §3; the owner's choice of the three layouts he was
// shown, "B · icon column on the right"): a narrow column at the row's right edge, centred on the cover, with
// *Want to read* on top and the heart under it (its count under that). One component for every row that has them: a
// member's Recently finished row and its sheet, the feed row, Home's card. The text column keeps the rest of the
// width and nothing wraps. The Readers rows on the Book page take only the heart (`book` left out).
//  - `cover`   the size of the row's cover (`sm`, `md`, `lg`): the column is as tall as that cover and its icons sit in the middle.
//              `avatar`: for a row led by an avatar and no cover (the Readers rows): the column is as tall as the avatar
//              (at least one 44 px box) and the heart sits level with it, on the member's name and state lines.
//  - `book`    the Book, for Want to read (SocialBook); leave it out for a row that has only the heart.
//  - `like`    the row, for the heart (FriendsLikes: `sessionId`, `likes`, `liked`), with `name` (the member whose read it
//              is), `owner` (her id), `title`; leave `like` out for a row with no heart.
//  - `wantTestid`, `likeTestid`  the test ids of the two controls.
// Nothing is drawn (the column is gone, the text takes the width) where there is neither control. The error line of a
// refused like is the row's (FriendsLikeError), in its text column.
import type { SocialBook } from '~/data/socialShapes'
import { likeable } from '~/utils/likes'
import { wantState } from '~/utils/wantToRead'
import { useLibraryStore } from '~/stores/library'

const props = withDefaults(
  defineProps<{
    cover: 'sm' | 'md' | 'lg' | 'avatar'
    book?: SocialBook | null
    like?: { sessionId?: string | null; likes?: number; liked?: boolean } | null
    name?: string
    owner?: string
    title?: string
    wantTestid?: string
    likeTestid?: string
  }>(),
  { book: null, like: null, name: '', owner: undefined, title: '', wantTestid: 'feed.wantToRead', likeTestid: 'feed.like' },
)

const library = useLibraryStore()
const wants = computed(() => Boolean(props.book && wantState(props.book, library.entryForBook(props.book.id))))
const likes = computed(() => Boolean(props.like && likeable(props.like)))
const height = computed(() => ({ sm: 'h-[calc(var(--size-cover-sm)*1.5)]', md: 'h-[calc(var(--size-cover-md)*1.5)]', lg: 'h-[calc(var(--size-cover-lg)*1.5)]', avatar: 'h-[max(var(--size-avatar),var(--size-touch))]' })[props.cover])
</script>

<template>
  <!-- A column as tall as the cover, its icons in the middle; its icons (and their 44 px boxes) are 44 px apart, centre to centre. -->
  <div v-if="wants || likes" class="flex w-(--size-target) shrink-0 flex-col items-center justify-center gap-y-[calc(var(--size-touch)_-_var(--size-target))]" :class="height" data-testid="rowActions">
    <FriendsWantToReadButton v-if="book" :book="book" :testid="wantTestid" />
    <FriendsLikes v-if="like" :row="like" :name="name" :owner="owner" :title="title" :testid="likeTestid" />
  </div>
</template>
