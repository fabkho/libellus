<script setup lang="ts">
// The book page (D's book-new / book-reading / book-finished): the cover
// lights the room. Under it the title, the author, the facts in small mono,
// then the Book's state and the one action it asks for — Add to Library for a
// Book that is not in the Library, Start reading on Want to read, Finish while
// it is being read (with Abandon beside it), Read again on a finished Book and
// Start again on an abandoned one — and what the Book is about. Opened from search (a Catalogue Book by id, or a result that is not
// in the Catalogue yet by its source id) and from the Library. Where a Book
// came from is never shown.
import { isNotFinished } from '~/data/library'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { useReadingStore } from '~/stores/reading'

definePageMeta({ layout: 'tabs', screen: 'book', pushed: true })

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const books = useBookStore()
const library = useLibraryStore()
const reading = useReadingStore()
const { formatDay, dayOfRead } = useDays()

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
const latest = computed(() => entry.value?.latestSession ?? null)
/** Finished because the read was given up, not because the book was done. */
const notFinished = computed(() => (entry.value ? isNotFinished(entry.value) : false))
/** When the state began: added, started (and which day of the read today is), finished. */
const since = computed(() => {
  const e = entry.value
  if (!e) return ''
  if (e.status === 'reading' && latest.value?.startedOn)
    return t('book.since', { date: formatDay(latest.value.startedOn), day: dayOfRead(latest.value.startedOn) })
  if (e.status === 'finished' && latest.value?.endedOn) return formatDay(latest.value.endedOn)
  return t('book.addedOn', { date: t('common.dayMonth', dateParts(new Date(e.addedAt), locale.value)) })
})
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

    <div v-if="book" class="relative px-ml" data-testid="book.actions">
      <!-- The Book's state (D's status line), then the one action it asks for. -->
      <p
        v-if="entry"
        class="mt-ms mb-md flex min-h-(--size-star) flex-wrap items-center justify-center gap-sm text-caption"
        data-testid="book.state"
      >
        <span v-if="entry.status === 'reading'" class="lamp" aria-hidden="true" />
        <UiStars v-if="entry.status === 'finished' && latest?.rating" :quarters="latest.rating" size="md" data-testid="book.rating" />
        <UiIcon v-if="notFinished" name="slash" :size="14" class="text-ink-faint" />
        <span data-testid="book.status">{{ notFinished ? t('status.notFinished') : t(`status.${entry.status}`) }}</span>
        <span class="dot text-ink-ghost" aria-hidden="true" />
        <span class="figures text-meta text-ink-faint" data-testid="book.since">{{ since }}</span>
      </p>
      <p v-else class="mt-ms mb-md text-center text-caption text-ink-faint" data-testid="book.notInLibrary">
        {{ t('book.notInLibrary') }}
      </p>

      <UiButton v-if="!entry" block data-testid="book.add" @click="library.openAdd(book)">
        <UiIcon name="plus" :size="18" bold />{{ t('book.add') }}
      </UiButton>
      <UiButton v-else-if="entry.status === 'want_to_read'" block data-testid="book.start" @click="reading.openStart(entry)">
        <UiIcon name="arrow" :size="18" bold />{{ t('book.start') }}
      </UiButton>
      <div v-else-if="entry.status === 'reading'" class="flex gap-ms">
        <UiButton class="flex-1" data-testid="book.finish" @click="reading.openFinish(entry)">
          <UiIcon name="check" :size="18" bold />{{ t('book.finish') }}
        </UiButton>
        <UiButton tone="secondary" data-testid="book.abandon" @click="reading.openAbandon(entry)">
          {{ t('book.abandon') }}
        </UiButton>
      </div>
      <!-- Closed: the next read starts a new session; the earlier ones stay. -->
      <UiButton
        v-else
        tone="quiet"
        block
        :data-testid="notFinished ? 'book.startAgain' : 'book.readAgain'"
        @click="reading.openStart(entry)"
      >
        <UiIcon name="repeat" :size="18" />{{ notFinished ? t('book.startAgain') : t('book.readAgain') }}
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

/* D's reading lamp: the lit dot of a Book that is being read. */
.lamp {
  width: var(--spacing-sm);
  height: var(--spacing-sm);
  border-radius: var(--radius-pill);
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-ms) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 50%, transparent);
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
