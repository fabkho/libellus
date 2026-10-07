<script setup lang="ts">
// The Book page's author line (#167): the names the edition credits, as
// before ("Terry Pratchett & Neil Gaiman", "Ann Leckie et al."), each one that
// is a linked author of the Book a link to her page. The links come from the
// Book's linked authors (asked when the page opens, kept on the device), so a
// Book nobody has enriched, or one not in the Catalogue yet, reads as plain
// text. Translators and introducers are never linked.
import { useAuthorsStore } from '~/stores/authors'

const props = defineProps<{ names: readonly string[]; bookId: string | null }>()

const { t } = useI18n()
const authors = useAuthorsStore()

watch(
  () => props.bookId,
  (id) => id && void authors.loadForBook(id),
  { immediate: true },
)
const parts = computed(() => authorParts(props.names, (props.bookId && authors.ofBook(props.bookId)) || [], t('common.etAl')))
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
