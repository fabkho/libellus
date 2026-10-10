<script setup lang="ts">
// "More from the author", the first section under the Book page's About (it
// follows the BookSection pattern, components/book/Section.vue): the books of
// the Book's first linked author (the one the author line names first; the
// others are one tap away on that line) and nothing else about her — no
// portrait, no intro, no credits (those are her page's). Her name, a link to
// her page; up to three of her other works as on her page (the Book itself
// left out; her status of each; a tap opens the Book with its cover flying);
// and "Show all <n>" to her page.
//
// Her page is the one `authors.load` fetches and the device keeps (a dozen of
// them, the same copy her own page opens from), so what has been seen shows
// offline. A Book with no linked author (not in the Catalogue, or nobody has
// enriched it), an author with no other works known, or a page that has not
// come (offline, an error): no section, never an error state.
import type { Book, BookSnapshot } from '~/data/books'
import { useAuthorsStore } from '~/stores/authors'

const props = defineProps<{ book: Book | BookSnapshot; bookKey: string }>()

const { t } = useI18n()
const authors = useAuthorsStore()

/** The Book's id in the Catalogue (a search result has none yet, and no linked authors). */
const catalogueId = computed(() => ('id' in props.book ? props.book.id : null))
/** The first linked author in credit order; the author line (asked when the page opens) is what fills it. */
const authorKey = computed(() => rowAuthorKey(catalogueId.value ? authors.ofBook(catalogueId.value) : undefined))

const near = ref(false)
watch(
  [near, authorKey],
  ([isNear, key]) => {
    if (isNear && key) void authors.load(key)
  },
  { immediate: true },
)

const more = computed(() => {
  const key = authorKey.value
  if (!key) return null
  return moreFromAuthor(authors.page(key)?.page, {
    bookId: catalogueId.value,
    key: props.bookKey,
    isbn13: props.book.isbn13,
    title: props.book.title,
  })
})

// Her works' covers are asked for as soon as her page arrives, not when their rows scroll into view:
// OpenLibrary answers in ~575 ms (p90 1.1 s, docs/covers.md), so a cover asked for only then pops in a
// second late. At most the section's own rows (`MORE_FROM_AUTHOR`), each once, at the size the row
// asks for; the rows are `eager` for the same reason (a lazy image in a section that is still opening waits).
const prefetched = new Set<string>()
watch(
  more,
  (shown) => {
    if (!shown || typeof Image === 'undefined') return
    for (const url of coversToPrefetch(shown.works, 'sm', MORE_FROM_AUTHOR)) {
      if (prefetched.has(url)) continue
      prefetched.add(url)
      new Image().src = url
    }
  },
  { immediate: true },
)
</script>

<template>
  <BookSection v-model:near="near" :show="Boolean(more)" :title="t('book.authorMore')" testid="book.authorMore">
    <template v-if="more">
      <NuxtLink
        :to="`/author/${more.author.key}`"
        class="-ml-sm -mt-xs mb-xs flex min-h-(--size-touch) items-center gap-xxs px-sm text-body-large font-medium text-ink"
        data-testid="book.authorMoreLink"
      >
        <span class="min-w-0 wrap-anywhere" data-testid="book.authorMoreName">{{ more.author.name }}</span>
        <UiIcon name="chevron" :size="12" class="shrink-0 text-ink-faint" />
      </NuxtLink>

      <ul :aria-label="t('book.authorMoreWorks', { name: more.author.name })">
        <AuthorWorkRow v-for="(work, index) in more.works" :key="work.workId ?? work.entry?.entryId ?? `${work.title}-${index}`" :work="work" testid="book.authorMoreWork" :author="more.author.name" eager />
      </ul>
      <NuxtLink
        v-if="more.more"
        :to="`/author/${more.author.key}`"
        class="figures -ml-sm flex min-h-(--size-touch) items-center gap-xxs px-sm text-footnote text-ink-muted"
        data-testid="book.authorMoreAll"
      >
        {{ t('author.showAll', { count: more.total }) }}
        <UiIcon name="chevron" :size="12" />
      </NuxtLink>
    </template>
  </BookSection>
</template>
