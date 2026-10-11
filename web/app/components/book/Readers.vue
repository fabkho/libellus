<script setup lang="ts">
// In your circle, on a Book's page (social v2a, contract §1.5; the component and its ids are still `Readers`): the people she follows who
// have the same work (any edition: reading it, finished, put down or wanting it), each in her most relevant state and as far as her profile shows it, finished
// with a review first. The first `READERS_SHOWN` rows, then *See all {count}* at the right of the eyebrow, which
// opens the sheet with all of them (BookReadersSheet). Only people she follows: a strangers' part (reviews of
// members she does not follow) is a later version and goes under this section, not into it.
//
// Not there: for nobody (no section, no empty text), signed out, a Manual book, a Book that is not in the
// Catalogue yet (a search result), nobody followed. Loading: two quiet rows of the rows' height under the eyebrow
// (RowPlaceholder), only when she follows somebody, in a room that opens (UiReveal) and closes again when there
// is nobody. Offline: the list last loaded for this Book in the session, else nothing, never an error.
//
// Props: `book` (the page's Book). Test ids: `book.readers` (the section), `book.readers.row` (a row),
// `book.readers.all` (*See all*), `bookReaders` (the sheet).
import type { Book, BookSnapshot } from '~/data/books'
import { useBookReadersStore } from '~/stores/bookReaders'
import { useSessionStore } from '~/stores/session'
import { useSocialStore } from '~/stores/social'
import { READERS_SHOWN } from '~/utils/bookReaders'

const props = defineProps<{ book: Book | BookSnapshot }>()

const { t } = useI18n()
const { count } = useFigures()
const readers = useBookReadersStore()
const session = useSessionStore()
const social = useSocialStore()
const online = useOnline()

/** The Catalogue id of a Book that has one and is not a Manual book's (that one has no work and is its owner's alone). */
const bookId = computed(() => ('id' in props.book && props.book.source !== 'manual' ? props.book.id : null))
const signedIn = computed(() => Boolean(session.member))
/** Whom she follows: unknown until People has been read; nobody followed means no call and no placeholder. */
const followsAnyone = computed(() => (social.people ? social.people.followingIds.length > 0 : true))

const mine = computed(() => (bookId.value ? readers.of(bookId.value) : null))
const rows = computed(() => (mine.value ? mine.value.top.slice(0, READERS_SHOWN) : []))
const pending = computed(() => Boolean(bookId.value && signedIn.value && followsAnyone.value && readers.loading[bookId.value] && !mine.value?.loaded && rows.value.length === 0))
const show = computed(() => signedIn.value && Boolean(bookId.value) && (rows.value.length > 0 || pending.value))
const total = computed(() => mine.value?.total ?? 0)
const sheet = ref(false)
const headingId = useId()

async function ask() {
  const id = bookId.value
  if (!id || !signedIn.value) return
  await social.loadPeople()
  if (id !== bookId.value || !followsAnyone.value) return
  await readers.load(id)
}
// After the page has rendered (the line never holds it up); again for another Book, or back online.
onMounted(() => {
  watch([bookId, signedIn], () => void ask(), { immediate: true })
  watch(online, (now) => now && void ask())
})
</script>

<template>
  <UiReveal :show="show" data-testid="book.readers">
    <section class="flex flex-col px-ml pt-xl" :aria-labelledby="headingId" :aria-busy="pending || undefined">
      <div class="mb-xs flex h-(--size-button-sm) items-center justify-between gap-md">
        <h2 :id="headingId" class="eyebrow" data-testid="book.readersTitle">{{ t('book.readers.title') }}</h2>
        <UiSeeAll
          v-if="total > rows.length && rows.length > 0"
          dialog
          :aria-label="t('book.readers.allLabel', { count: count(total) })"
          data-testid="book.readers.all"
          @click="sheet = true"
        >
          {{ t('book.readers.all', { count: count(total) }) }}
        </UiSeeAll>
      </div>
      <div v-if="pending && rows.length === 0" class="flex flex-col" role="status" :aria-label="t('book.readers.loading')" data-testid="book.readers.loading">
        <FriendsRowPlaceholder kind="person" :wave="0" />
        <FriendsRowPlaceholder kind="person" :wave="0.1" />
      </div>
      <ul v-else class="flex flex-col">
        <li v-for="reader in rows" :key="reader.member.id" class="row">
          <BookReaderRow :reader="reader" :title="book.title" />
        </li>
      </ul>
    </section>
    <BookReadersSheet v-if="bookId" v-model:open="sheet" :book-id="bookId" :title="book.title" />
  </UiReveal>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
