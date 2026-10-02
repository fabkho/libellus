<script setup lang="ts">
// The book page (D's book-new): the cover lights the room. Under it the
// title, the author, the facts in small mono, then the one action the Book's
// state asks for — Add to Library for a Book that is not in the Library, its
// Status once it is (#7 turns that into Start reading) — and what the Book is
// about. Opened from search (a Catalogue Book by id, or a result that is not
// in the Catalogue yet by its source id) and from the Library. Where a Book
// came from is never shown.
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'

definePageMeta({ layout: 'tabs', screen: 'book', pushed: true })

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const books = useBookStore()
const library = useLibraryStore()

const key = computed(() => String(route.params.key))
const page = computed(() => books.page(key.value))
const book = computed(() => page.value?.book ?? null)
const entry = computed(() => page.value?.entry ?? null)

watch(key, (value) => books.load(value), { immediate: true })

useHead({ title: () => (book.value ? `${book.value.title} · ${t('app.name')}` : t('app.name')) })

const authorLine = computed(() => (book.value ? formatAuthors(book.value.authors, t('common.etAl')) : ''))
const facts = computed(() => {
  const b = book.value
  if (!b) return []
  return [b.year ? String(b.year) : null, b.pageCount ? t('book.pages', { count: b.pageCount }) : null, b.publisher].filter(
    (fact): fact is string => Boolean(fact),
  )
})
const addedOn = computed(() =>
  entry.value ? t('common.dayMonth', dateParts(new Date(entry.value.addedAt), locale.value)) : '',
)
const description = computed(() => book.value?.description ?? '')
// Long enough to be cut at five lines: then "More" shows the rest.
const long = computed(() => description.value.length > 320 || description.value.split('\n').length > 5)
const expanded = ref(false)
watch(key, () => (expanded.value = false))

function back() {
  // Back to where the member came from, with its scroll; a page opened from a
  // link has nowhere to go back to, so it goes to the Library.
  if (window.history.state?.back) router.back()
  else void navigateTo('/library')
}
</script>

<template>
  <div class="relative min-h-dvh">
    <UiAmbient :colors="book?.coverColors ?? null" />
    <UiTopBar :back-label="t('book.back')" back-testid="book.back" @back="back" />

    <section v-if="book" class="relative flex flex-col items-center px-xl pt-sm text-center" data-testid="book.hero">
      <UiCover
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'xl')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
        size="xl"
        glow
        eager
      />
      <h1 class="book-title mt-ml text-headline text-balance" data-testid="book.title">{{ book.title }}</h1>
      <p class="mt-xs text-body text-ink-muted" data-testid="book.authors">{{ authorLine }}</p>
      <p v-if="facts.length" class="eyebrow mt-sm flex items-center gap-sm" data-testid="book.facts">
        <template v-for="(fact, i) in facts" :key="fact">
          <span v-if="i" class="dot" aria-hidden="true" />{{ fact }}
        </template>
      </p>
    </section>

    <div v-if="book" class="relative px-ml">
      <!-- The Book's state, then the one action it asks for (D's status line and actions). -->
      <p
        v-if="entry"
        class="figures mt-ms mb-md text-center text-meta text-ink-faint"
        data-testid="book.added"
      >
        {{ t('book.addedOn', { date: addedOn }) }}
      </p>
      <p v-else class="mt-ms mb-md text-center text-caption text-ink-faint" data-testid="book.notInLibrary">
        {{ t('book.notInLibrary') }}
      </p>

      <div
        v-if="entry"
        class="flex h-(--size-button) items-center justify-center gap-sm rounded-pill bg-fill text-body-large font-medium edge-faint"
        data-testid="book.status"
      >
        <UiIcon name="check" :size="18" bold class="text-accent" />{{ t(`status.${entry.status}`) }}
      </div>
      <UiButton v-else block data-testid="book.add" @click="library.openAdd(book)">
        <UiIcon name="plus" :size="18" bold />{{ t('book.add') }}
      </UiButton>
    </div>

    <section v-if="description" class="relative px-ml pt-xl" data-testid="book.about">
      <h2 class="eyebrow mb-ms">{{ t('book.about') }}</h2>
      <p class="text-subhead whitespace-pre-line text-ink-muted" :class="long && !expanded && 'clamped'" data-testid="book.description">
        {{ description }}
      </p>
      <button
        v-if="long && !expanded"
        type="button"
        class="-ml-sm min-h-(--size-touch) px-sm text-subhead font-medium text-ink"
        data-testid="book.more"
        @click="expanded = true"
      >
        {{ t('book.more') }}
      </button>
    </section>

    <div v-if="!book && page?.phase !== 'missing' && page?.phase !== 'error'" class="relative flex flex-col items-center px-xl pt-sm" data-testid="book.loading">
      <span class="placeholder rounded-cover-lg bg-fill" aria-hidden="true" />
      <span class="sr-only">{{ t('book.loading') }}</span>
    </div>

    <div v-else-if="!book" class="relative px-ml pt-xxl text-center" data-testid="book.missing">
      <p class="book-title text-headline">{{ t(page?.phase === 'error' ? 'book.errorTitle' : 'book.missingTitle') }}</p>
      <p class="mt-sm text-subhead text-ink-muted">{{ t(page?.phase === 'error' ? 'book.error' : 'book.missing') }}</p>
      <div class="mt-lg flex justify-center">
        <UiButton v-if="page?.phase === 'error'" tone="secondary" size="md" data-testid="book.retry" @click="books.load(key)">
          {{ t('book.retry') }}
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}

.clamped {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 5;
}

.placeholder {
  width: var(--size-cover-xl);
  aspect-ratio: 2 / 3;
}
</style>
