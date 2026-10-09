<script setup lang="ts">
// "More from the author", the first section under the Book page's About (it
// follows the BookSection pattern, components/book/Section.vue): the Book's
// first linked author (the one the author line names first; the others are one
// tap away on that line) with her portrait, name (a link to her page), life
// dates, a two-line cut of her Wikipedia intro, up to three of her other works
// as on her page (the Book itself left out; her status of each; a tap opens
// the Book with its cover flying), and "Show all <n>" to her page.
//
// The credits the licences ask for sit with what they cover, here as on her
// page (AuthorCredits): "From Wikipedia" beside the intro, the portrait's
// author and licence. Her page is the one `authors.load` fetches and the device
// keeps (a dozen of them, the same copy her own page opens from), so what has
// been seen shows offline; a Book with no linked author (not in the Catalogue,
// or nobody has enriched it), an author the Catalogue has nothing on, or a
// page that has not come (offline, an error): no section, never an error state.
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
const dates = useLifeDates(() => more.value?.author)
</script>

<template>
  <BookSection v-model:near="near" :show="Boolean(more)" :title="t('book.authorMore')" testid="book.authorMore">
    <template v-if="more">
      <NuxtLink :to="`/author/${more.author.key}`" class="-mx-xs flex items-center gap-md px-xs py-xs" data-testid="book.authorMoreLink">
        <AuthorPortrait :author="more.author" testid="book.authorMore" />
        <span class="flex min-w-0 flex-col gap-xs">
          <span class="text-headline text-balance wrap-anywhere" data-testid="book.authorMoreName">{{ more.author.name }}</span>
          <span v-if="dates" class="eyebrow" data-testid="book.authorMoreDates">{{ dates }}</span>
        </span>
      </NuxtLink>

      <p v-if="more.author.summary" class="mt-ms line-clamp-2 text-subhead text-ink-muted" :lang="more.author.summary.language" data-testid="book.authorMoreSummary">
        {{ more.author.summary.text }}
      </p>
      <AuthorCredits :author="more.author" testid="book.authorMore" class="mt-xs" />

      <ul v-if="more.works.length" class="mt-sm" :aria-label="t('book.authorMoreWorks', { name: more.author.name })">
        <AuthorWorkRow v-for="(work, index) in more.works" :key="work.workId ?? work.entry?.entryId ?? `${work.title}-${index}`" :work="work" testid="book.authorMoreWork" :author="more.author.name" />
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
