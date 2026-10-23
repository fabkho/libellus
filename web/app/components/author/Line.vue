<script setup lang="ts">
// The Book page's author line (#167): the names the edition credits, as
// before ("Terry Pratchett & Neil Gaiman", "Ann Leckie et al."), each one that
// can be linked a link to her page. Always, whether or not the Book is in the
// Catalogue: the Catalogue's linked authors come first (asked when the page
// opens, kept on the device); a Book it has none for (a search result, a work
// opened from an author's page, one nobody has enriched) asks by what the page
// knows instead: the Open Library author ids the search gave, the Book's work,
// the credited names (stores/authors.ts `loadForCredits`). Only a name no
// source can place stays plain text. Translators and introducers are never
// linked by the Catalogue's rows; a name asked for by itself links to an author
// of that name.
import { useAuthorsStore } from '~/stores/authors'

const props = defineProps<{
  names: readonly string[]
  bookId: string | null
  /** The Book's Open Library work key, if it has one. */
  workKey?: string | null
  /** Open Library author ids by credited name, as the search gave them. */
  authorKeys?: Readonly<Record<string, string>>
}>()

const { t } = useI18n()
const authors = useAuthorsStore()

const credits = computed(() => ({ workKey: props.workKey ?? null, names: props.names, keys: props.authorKeys ?? {} }))
// The Catalogue's own links, then (when it has none) the credits asked for by what the page knows.
watch(
  () => [props.bookId, JSON.stringify(credits.value)],
  async () => {
    const { bookId } = props
    if (bookId) await authors.loadForBook(bookId)
    if (bookId !== props.bookId) return
    if (!(bookId && authors.ofBook(bookId)?.length)) void authors.loadForCredits(credits.value)
  },
  { immediate: true },
)
const linked = computed(() => {
  const own = props.bookId ? authors.ofBook(props.bookId) : undefined
  return own?.length ? own : (authors.ofCredits(credits.value) ?? [])
})
const parts = computed(() => authorParts(props.names, linked.value, t('common.etAl')))
</script>

<template>
  <p class="text-body text-ink-muted wrap-anywhere" data-testid="book.authors">
    <template v-for="(part, i) in parts" :key="i">
      <NuxtLink
        v-if="part.key"
        :to="`/author/${part.key}`"
        class="author -my-xs inline-block py-xs text-ink underline decoration-hairline-strong underline-offset-4 hover:decoration-current"
        data-testid="book.author"
      >{{ part.text }}</NuxtLink><template v-else>{{ part.text }}</template>
    </template>
  </p>
</template>

<style scoped>
/* A name is one line of text; its box is padded past the 24 px a target must be (the margins take the
   padding back, so the line does not move) and its touch target reaches the 44 px a tap needs. */
.author {
  position: relative;
}
.author::after {
  position: absolute;
  inset: calc((var(--text-body--line-height) + 2 * var(--spacing-xs) - var(--size-touch)) / 2) calc(-1 * var(--spacing-xs));
  content: '';
}
</style>
