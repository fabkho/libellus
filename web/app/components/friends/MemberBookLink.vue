<script setup lang="ts">
// A Book on a member's profile (social v1, U4): a link to its page with the cover flying into it, as
// everywhere in the app (UiPressLink). A Manual book is not in the Catalogue, so a follower cannot
// open it: it draws the same and opens nothing. Nor can it open an unverified Book.
import type { SocialBook } from '~/data/social'
import { useBookStore } from '~/stores/book'
import { bookPathOf } from '~/utils/memberProfile'

const props = defineProps<{ book: Pick<SocialBook, 'id' | 'manual'> & { unverified?: boolean } }>()
const books = useBookStore()
const to = computed(() => bookPathOf(props.book))
</script>

<template>
  <UiPressLink v-if="to" :to="to" @press="books.prefetch(book.id)"><slot /></UiPressLink>
  <span v-else><slot /></span>
</template>
