<script setup lang="ts">
// The book page (D's book-new / book-reading / book-finished): the cover
// lights the room. Under it the title, the author, the facts in small mono,
// then the Book's state and the one action it asks for — Add to Library for a
// Book that is not in the Library, Start reading on Want to read, Update
// progress while it is being read (under its progress; Finish and DNF live in
// that sheet, not here), Read again on a finished Book and Start again on an
// abandoned one — and what the Book is about. Opened from search (a Catalogue
// Book by id, or a result that is not in the Catalogue yet by its source id)
// and from the Library. Where a Book came from is never shown. Under the
// action, when the member has linked an ebook file on this device (#131), one
// quiet line says so (BookEbook); with the copy there, Read now is the lit
// action on Want to read and Reading (Start reading or Update progress steps
// back under it) and opens the built-in reader over the page, its cover flying
// from this one (components/reader/Reader.vue). How she read it (Read as, #169)
// is set in the options sheet.
import { formatOf, sourceKeys } from '~/data/books'
import { isNotFinished, type LibraryEntry } from '~/data/library'
import { useBookStore } from '~/stores/book'
import { useEditionStore } from '~/stores/edition'
import { useEbooksStore } from '~/stores/ebooks'
import { useLibraryStore } from '~/stores/library'
import { useSearchStore } from '~/stores/search'
import { useReaderStore } from '~/stores/reader'
import { useReadingStore } from '~/stores/reading'
import { bookPageKey, followEdition } from '~/utils/bookPageKey'
import { onIdle } from '~/utils/idle'
import { previewOf } from '~/utils/bookPreview'
import { afterMotion } from '#layers/ui/app/utils/motion'
import { loadReader, prefetchReader } from '~/utils/readerChunks'

// Direct, as this screen asked before own covers: only the Library's row and the reel go through `/cover` (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

// One page through a change of edition, though the address changes (utils/bookPageKey.ts).
definePageMeta({ layout: 'tabs', screen: 'book', pushed: true, key: bookPageKey })

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const books = useBookStore()
const library = useLibraryStore()
const search = useSearchStore()
const reading = useReadingStore()
// Starting, finishing, DNF and reading again work offline too: they wait to
// sync (#93). Adding does for a Book from the Catalogue; a search result (its
// Cover still to resolve) or a Manual book says "Offline" instead (#15).
const online = useOnline()
const addOffline = computed(() => !online.value && !(book.value && 'id' in book.value && book.value.source !== 'manual'))
const { formatDay, dayOfRead } = useDays()

const edition = useEditionStore()

const routeKey = computed(() => String(route.params.key))
// The entry changed to another edition here (#41): the page follows it in the
// same render as the Library learns it (never a frame of the old Book shown
// as not in the Library), until its address catches up (`editionChanged`).
const followed = ref<string | null>(null)
const key = computed(() => followed.value ?? routeKey.value)
watch(routeKey, () => (followed.value = null))
const page = computed(() => books.page(key.value))
// A Book that is not in her Library can show another of its editions (Change edition, read only):
// the page's own Book is what `viewed` stands in for, here and nowhere else (stores/edition.ts, `viewing`).
const viewed = computed(() => edition.viewOf(routeKey.value))
const book = computed(() => viewed.value ?? page.value?.book ?? null)
const entry = computed(() => page.value?.entry ?? null)

// A book opens at once (docs/MOTION.md, "A book opens at once"): while the Book is still being read (a work of a
// series, an author's page, a friend's shelf: a Book this device has not got), the hero shows what the link that
// opened the page already knew of it, handed over on the touch-down (utils/bookPreview.ts). Read once, here, in the
// page's setup, so the first frame has it; the page's own Book replaces it in place (the cover keeps its identity) and
// everything else waits behind skeletons the size of what comes.
const preview = book.value ? null : previewOf(routeKey.value)
/** The hero's title, authors and cover: the Book's, or until it is there the preview's. */
const heroBook = computed(() => book.value ?? (page.value?.phase === 'missing' ? null : preview))
/** The Book is still being read (and nothing says otherwise): its page is a skeleton wherever the preview has not filled it. */
const loading = computed(() => !book.value && page.value?.phase !== 'missing' && page.value?.phase !== 'error')
/** A Placeholder cover's identity stays the preview's through the swap to the Book, so the cover is not started afresh (a flicker). */
const identityOf = (b: NonNullable<typeof book.value>) => b.isbn13 ?? ('id' in b ? b.id : b.title)
const previewIdentity = preview ? (preview.identity ?? preview.title) : null
const identityAlias = shallowRef<{ from: string; to: string } | null>(null)
watch(
  book,
  (now) => {
    if (now && previewIdentity && !identityAlias.value) identityAlias.value = { from: identityOf(now), to: previewIdentity }
  },
  { immediate: true, flush: 'sync' },
)
const heroIdentity = computed(() => {
  const b = book.value
  if (!b) return previewIdentity ?? undefined
  const own = identityOf(b)
  return identityAlias.value?.from === own ? identityAlias.value.to : own
})

watch(key, (value) => books.load(value), { immediate: true })

// What she looked at is gone with the page, or with the Book it was a view of.
watch(routeKey, () => edition.stopViewing())
onBeforeUnmount(() => edition.stopViewing())
// The edition she looks at is in her Library by now (she added it here, or already had it): the page
// is that entry's, and takes its address as after a change of edition (`editionChanged`).
watch(
  () => {
    const shown = viewed.value
    if (!shown) return null
    for (const bookKey of 'id' in shown ? [shown.id] : sourceKeys(shown)) {
      const held = library.entryForBook(bookKey)
      if (held) return held
    }
    return null
  },
  (held) => {
    if (!held) return
    edition.stopViewing()
    editionChanged(held)
  },
)

// Change edition animates (docs/MOTION.md, Change edition): the old hero is
// copied before the page draws the new Book, then turns into it.
const pageEl = useTemplateRef<HTMLElement>('pageEl')
const heroEl = useTemplateRef<HTMLElement>('heroEl')
const heroWas = useTemplateRef<HTMLElement>('heroWas')
const pageWas = useTemplateRef<HTMLElement>('pageWas')
const editionChange = useEditionChange({ page: pageEl, hero: heroEl, heroWas, pageWas })
watch(
  () => edition.moved,
  (move) => {
    const shown = page.value?.book
    if (!move || !shown || !('id' in shown) || shown.id !== move.from) return
    editionChange.capture()
    followed.value = move.to.book.id
    void nextTick(editionChange.play)
  },
  { flush: 'pre' },
)

// The edition she looks at (a Book that is not in her Library) changes the page the same way.
watch(
  () => edition.viewing,
  (now, before) => {
    if (!now || now === before || !page.value?.book) return
    editionChange.capture()
    void nextTick(editionChange.play)
  },
  { flush: 'pre' },
)

useHead({ title: () => (heroBook.value ? `${heroBook.value.title} · ${t('app.name')}` : t('app.name')) })

/** The Book's id in the Catalogue (none yet for a search result): what its authors and series are asked by. */
const catalogueId = computed(() => (book.value && 'id' in book.value ? book.value.id : null))
const facts = computed(() => {
  const b = book.value
  // Until the Book is there, only the one fact a list may have carried of this very edition (its page count).
  if (!b) return preview?.pageCount ? [t('book.pages', { count: preview.pageCount })] : []
  // The format that counts: her own word on her edition, else what its source said.
  const format = formatOf(b, entry.value?.formatOverride)
  return [
    b.year ? String(b.year) : null,
    b.pageCount ? t('book.pages', { count: b.pageCount }) : null,
    format ? t(`book.formatFact.${format}`) : null,
    b.publisher,
  ].filter((fact): fact is string => Boolean(fact))
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
/**
 * What the Book is about. A Book from the Library comes from a list, which carries none: the
 * device's copy has it (stores/library.ts, `descriptionOf`). A Catalogue Book's description is the
 * server's to write — only the check reads one at its source (social v2a contract §5) — so until it
 * has, the page shows what the source already told *this* device: the search result it was opened
 * from (stores/search.ts, `seenBook`). Shown, not stored: nothing here writes it anywhere, and a
 * reload without the result asks the source again (stores/book.ts, `resolve`).
 */
const description = computed(() => {
  const shown = book.value
  if (!shown) return ''
  return library.descriptionOf(shown) ?? search.seenBook(key.value)?.description ?? ''
})
// Long enough to be cut at five lines: then "More" shows the rest.
const long = computed(() => description.value.length > 320 || description.value.split('\n').length > 5)
const expanded = ref(false)
watch(key, () => (expanded.value = false))

// The title is cut at three lines so the actions stay in view; a tap on it
// shows all of it (and again folds it). The full title is also its `title`
// and is in the page for assistive technology, the clamp being only visual.
const titleEl = ref<HTMLElement | null>(null)
const titleOpen = ref(false)
const titleCut = ref(false)
function measureTitle() {
  const el = titleEl.value
  if (el && !titleOpen.value) titleCut.value = el.scrollHeight > el.clientHeight + 1
}
/** A tap on a cut title shows all of it, or folds it again. Bound only then, so an uncut title is no control. */
function toggleTitle() {
  titleOpen.value = !titleOpen.value
  void nextTick(measureTitle)
}
// Measured once the cover has landed (`afterMotion`): it lays out the whole page, which in the tap's
// task held up the flight's start. Being cut only makes the title a control, so nothing moves meanwhile.
const measureTitleLater = () => void afterMotion().then(measureTitle)
watch([key, () => heroBook.value?.title], () => {
  titleOpen.value = false
  void nextTick(measureTitleLater)
})
onMounted(() => {
  measureTitleLater()
  void document.fonts?.ready.then(measureTitleLater)
})

// Whether the cover shows the Placeholder: then the page's light is its cloth's.
const coverFallback = ref(false)
const clothColor = computed(() => (heroBook.value ? `var(--color-cloth${clothOf(heroBook.value.title)})` : null))

const optionsOpen = ref(false)

// Read now (#131 phase 2): the linked copy, when it is on this device.
const ebooks = useEbooksStore()
const reader = useReaderStore()
const ebook = computed(() => {
  const record = ebooks.linkFor(entry.value)
  return record && !ebooks.missing.has(record.id) ? record : null
})
// With its ebook here, the reader's code is fetched ahead (data/reader/prefetch.ts), so Read now opens it from memory.
watch(ebook, (record) => record && onIdle(prefetchReader, { timeout: 1500 }), { immediate: true })
/**
 * Read now: the reader's code first (a no-op once it is in; a tap before it arrived, or after a failed fetch, loads
 * it), then the reader. The code that cannot come in (offline with nothing cached, or a build left behind by a
 * release) is said out loud: the tap used to do nothing at all, the reader's component being the very code that
 * could not load. A later tap tries again.
 */
const readFailed = ref(false)
async function read(target: LibraryEntry) {
  try {
    await loadReader()
  } catch {
    readFailed.value = true
    return
  }
  readFailed.value = false
  reader.open(target)
}
const readerOpen = computed(() => Boolean(entry.value && ebook.value && reader.openEntryId === entry.value.id))

/** The entry now has another Book (#41): the page, showing it already, takes its address in place of the old one. */
function editionChanged(changed: LibraryEntry) {
  followEdition(routeKey.value, changed.book.id)
  void router.replace(`/book/${changed.book.id}`)
}

function back() {
  // Back to where the member came from, with its scroll; a page opened from a
  // link has nowhere to go back to, so it goes to the Library.
  if (window.history.state?.back) router.back()
  else void navigateTo('/library')
}
</script>

<template>
  <div ref="pageEl" class="relative min-h-dvh" :aria-busy="loading || undefined">
    <UiAmbient :colors="heroBook?.coverColors ?? null" :cloth="coverFallback ? clothColor : null" />
    <!-- What comes after the first frame is said once, politely: the Book is on its way. -->
    <p class="sr-only" role="status" data-testid="book.loadingStatus">{{ loading ? t('book.loading') : '' }}</p>
    <!-- What the old edition was about, over the new text while a change of edition plays. -->
    <div ref="pageWas" class="pointer-events-none absolute inset-0" aria-hidden="true" inert />
    <UiTopBar :back-label="t('book.back')" back-testid="book.back" @back="back">
      <template v-if="book" #trailing>
        <UiRoundButton icon="more" :label="t('book.options')" data-testid="book.options" @click="optionsOpen = true" />
      </template>
    </UiTopBar>

    <section v-if="heroBook" ref="heroEl" class="relative flex flex-col items-center px-xl pt-sm text-center" data-flight="hero" data-testid="book.hero">
      <UiCover
        decorative
        :title="heroBook.title"
        :authors="heroBook.authors"
        v-bind="coverImage(heroBook, 'xl', coverHosts)"
        :identity="heroIdentity"
        :thumbhash="heroBook.coverThumbhash"
        :colors="heroBook.coverColors"
        size="xl"
        glow
        eager
        priority
        tilt
        @fallback="coverFallback = $event"
      />
      <h1
        ref="titleEl"
        class="book-title mt-ml max-w-full text-headline text-balance wrap-anywhere"
        :class="[!titleOpen && 'line-clamp-3', (titleCut || titleOpen) && 'cursor-pointer']"
        :title="heroBook.title"
        data-testid="book.title"
        v-on="titleCut || titleOpen ? { click: toggleTitle } : {}"
      >
        {{ heroBook.title }}
      </h1>
      <!-- The author line, each linked author a link to her page, and the series line under it (#167). A preview that did
           not carry the authors (a work of a series) holds the line's place in a placeholder until the Book comes. -->
      <AuthorLine
        v-if="heroBook.authors.length || !loading"
        class="mt-xs max-w-full"
        :names="heroBook.authors"
        :book-id="catalogueId"
        :work-key="book?.openLibraryWorkKey"
        :author-keys="book?.authorKeys"
      />
      <span v-else class="line body-line mt-xs w-1/2" aria-hidden="true" data-testid="book.authorsLoading"><span class="skeleton wave w-full" :style="{ '--wave': 0.1 }" /></span>
      <SeriesLine :book-id="catalogueId" :entry="entry" :preview="preview?.series ?? null" />
      <p v-if="facts.length" class="eyebrow mt-sm flex items-center gap-sm" data-testid="book.facts">
        <!-- Drawn with dots between them; assistive tech reads them as one phrase with commas, or they run
             together ("2012240 pages") or, split up, make TalkBack stop on every piece. -->
        <span class="sr-only">{{ facts.join(t('common.listSeparator')) }}</span>
        <template v-for="(fact, i) in facts" :key="fact">
          <span v-if="i" class="dot" aria-hidden="true" /><span aria-hidden="true">{{ fact }}</span>
        </template>
      </p>
      <span v-else-if="loading" class="line eyebrow-line mt-sm w-1/3" aria-hidden="true" data-testid="book.factsLoading"><span class="skeleton wave w-full" :style="{ '--wave': 0.2 }" /></span>
      <template v-if="book">
        <!-- Its genres, up to three, and the way to set them (#168). -->
        <BookGenres :book="book" :entry="entry" />
        <!-- Goodreads' rating, once known (#69). -->
        <BookGoodreads :book="book" />
        <!-- Book links, the instance's and the member's own (#116). -->
        <BookLinks :book="book" />
      </template>
      <!-- The old edition, over the new one while a change of edition plays. -->
      <div ref="heroWas" class="pointer-events-none absolute inset-0" data-edition-was aria-hidden="true" inert />
    </section>

    <!-- Nothing known of the Book yet (a link, a reload, a work no list described): the hero's shape in placeholders. The
         box at the cover's place is where a cover flying in lands and waits for the hero (composables/useBookFlight.ts). -->
    <div v-else-if="loading" class="relative flex flex-col items-center px-xl pt-sm text-center" data-testid="book.loading">
      <span class="placeholder relative rounded-cover-lg bg-fill" aria-hidden="true" data-flight-stand-in />
      <!-- The page's one heading while the title is not known: the title's place, read as what is happening. -->
      <h1 class="line headline-line relative mt-ml w-2/3" data-testid="book.loadingTitle">
        <span class="sr-only">{{ t('book.loading') }}</span>
        <span class="skeleton wave w-full" aria-hidden="true" :style="{ '--wave': 0.1 }" />
      </h1>
      <span class="line body-line mt-xs w-1/2" aria-hidden="true"><span class="skeleton wave w-full" :style="{ '--wave': 0.2 }" /></span>
      <span class="line eyebrow-line mt-sm w-1/3" aria-hidden="true"><span class="skeleton wave w-full" :style="{ '--wave': 0.3 }" /></span>
    </div>

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
      <BookProgress v-if="entry?.status === 'reading'" :entry="entry" />

      <UiButton v-if="!entry" block :offline="addOffline" data-testid="book.add" @click="library.openAdd(book)">
        <UiIcon name="plus" :size="18" bold />{{ t('book.add') }}
      </UiButton>
      <!-- With the ebook here, reading it is the action; Start reading or Update progress steps back under it. -->
      <template v-else-if="ebook && (entry.status === 'want_to_read' || entry.status === 'reading')">
        <UiButton block data-testid="book.read" @click="read(entry)">
          <UiIcon name="read" :size="18" />{{ t('book.read') }}
        </UiButton>
        <UiButton v-if="entry.status === 'want_to_read'" class="mt-sm" tone="quiet" block data-testid="book.start" @click="reading.openStart(entry)">
          <UiIcon name="arrow" :size="18" />{{ t('book.start') }}
        </UiButton>
        <UiButton v-else class="mt-sm" tone="quiet" block data-testid="book.updateProgress" @click="reading.openProgress(entry)">
          <UiIcon name="bookmark" :size="18" />{{ t('book.progress.update') }}
        </UiButton>
      </template>
      <UiButton v-else-if="entry.status === 'want_to_read'" block data-testid="book.start" @click="reading.openStart(entry)">
        <UiIcon name="arrow" :size="18" bold />{{ t('book.start') }}
      </UiButton>
      <!-- Being read: moving the bookmark is the action. Finish and DNF wait in its sheet. -->
      <UiButton v-else-if="entry.status === 'reading'" block data-testid="book.updateProgress" @click="reading.openProgress(entry)">
        <UiIcon name="bookmark" :size="18" bold />{{ t('book.progress.update') }}
      </UiButton>
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
      <!-- Read together (buddy reads): on every Book page, in her Library or not, in the action area, right under the Book's one action. -->
      <TogetherBookRow :book="book" :entry="entry" />
      <!-- Its ebook on this device, when one is linked (#131); a finished or abandoned Book opens in the reader from here. -->
      <BookEbook v-if="entry" :entry="entry" :read="Boolean(ebook) && entry.status !== 'want_to_read' && entry.status !== 'reading'" @read="read(entry)" />
      <!-- The reader's code could not be brought in (docs/perf/bundle.md F6): say so, where a tap used to do nothing. -->
      <p v-if="readFailed" class="mt-sm text-center text-caption text-error" role="alert" data-testid="book.readFailed">{{ t('book.readFailed') }}</p>
    </div>
    <!-- Her state and the one action it asks for come with the Book: in the shape of the commonest (a Book not in her Library:
         its line and a full-width button), so the page under them does not move when they do. -->
    <div v-else-if="loading" class="relative px-ml" aria-hidden="true" data-testid="book.actionsLoading">
      <span class="line caption-line mt-ms mb-md mx-auto w-1/3"><span class="skeleton wave w-full" :style="{ '--wave': 0.4 }" /></span>
      <span class="skeleton wave block h-(--size-button) w-full rounded-pill" :style="{ '--wave': 0.5 }" />
    </div>

    <BookProgressLog v-if="entry?.status === 'reading'" :entry="entry" />
    <CollectionsBookRow v-if="book" :book="book" :entry="entry" :book-key="key" />

    <BookHistory v-if="entry" :entry="entry" />
    <BookEditSessionSheet />
    <BookOptionsSheet v-if="book" v-model:open="optionsOpen" :entry="entry" :shown="book" :page="routeKey" @removed="back" />
    <BookEditionSheet @changed="editionChanged" />
    <!-- The reader, loaded on its first opening (the engine is its own chunk). -->
    <LazyReader v-if="readerOpen && entry && ebook" :entry="entry" :record="ebook" :hero="heroEl" @closed="reader.close()" />

    <section v-if="description" class="relative px-ml pt-xl" data-testid="book.about">
      <h2 class="eyebrow mb-ms">{{ t('book.about') }}</h2>
      <p class="text-subhead whitespace-pre-line text-ink-muted wrap-anywhere" :class="long && !expanded && 'clamped'" data-testid="book.description">
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
    <section v-else-if="loading" class="relative px-ml pt-xl" aria-hidden="true" data-testid="book.aboutLoading">
      <span class="line eyebrow-line mb-ms w-1/4"><span class="skeleton wave w-full" :style="{ '--wave': 0.6 }" /></span>
      <span v-for="i in 4" :key="i" class="line subhead-line" :class="i === 4 ? 'w-2/3' : 'w-full'"><span class="skeleton wave w-full" :style="{ '--wave': 0.6 + i * 0.1 }" /></span>
    </section>

    <!-- In your friends (social v2a, §1.5): the people she follows who have this Book, under its description and right above More from the author. -->
    <BookReaders v-if="book" :book="book" />

    <BookMoreFromAuthor v-if="book" :book="book" :book-key="key" />

    <div v-if="!book && !loading" class="relative px-ml pt-xxl text-center" data-testid="book.missing">
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

/* A placeholder line at the height of the text it stands for (as the author page's). */
.line {
  display: flex;
  align-items: center;
}
.line > * {
  height: 62%;
}
.headline-line {
  height: var(--text-headline--line-height);
}
.body-line {
  height: var(--text-body--line-height);
}
.subhead-line {
  height: var(--text-subhead--line-height);
}
.caption-line {
  height: var(--text-caption--line-height);
}
.eyebrow-line {
  height: var(--text-eyebrow--line-height);
}
</style>
