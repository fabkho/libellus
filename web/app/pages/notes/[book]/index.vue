<script setup lang="ts">
// The Notes page of a Book (docs/plans/book-notes.md parts 2.2, 2.5, 5; docs/parity.md, *Notes page*): the Book's chapters, shared by everyone who has the Book, and the notes in each,
// as the buddy read's room draws its Sections. From the top: the hero (the cover, "Notes", the Book, "Yours, your friends' and public · 43 chapters"), "You're on chapter 5 · Change"
// (her own chapter, which only she sees and which keeps later chapters closed for her), then one row a chapter (number, count, the faces of the authors she may see, a dot for what is new) and
// "The whole book" last. A chapter not open to her is **veiled**: number, count and "hidden", never faces or a dot, and opening it asks first ("Show it anyway?", kept on this device).
// While nobody has made the chapters, the page asks one question, "How many chapters does this book have?"; a member without the Book (`canWrite` false) only reads: "No chapters yet." and
// the Book's own *Add to Library*. The ⋯ holds *Add chapters*; chapters are never removed from here. A Book hidden from her followers says in one line that her friends see her notes anyway.
//
// The whole page is one call (`book_notes`), read when it opens, when the app comes back to the front and on Refresh. No Realtime: this route never loads the live client
// (tests/notes-entry.test.ts). Offline: what was read stays, writes say Offline.
import { isBookId } from '~/utils/notesRoute'
import { chapterPath, chapterRows, type ChapterRow } from '~/utils/notes'
import { titleSaysNumber } from '~/utils/buddyRoom'
import { noteErrorKey } from '~/utils/notes'
import type { NoteErrorCode } from '~/data/notes'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { useNotesStore } from '~/stores/notes'

definePageMeta({
  layout: 'tabs',
  screen: 'notes',
  pushed: true,
  // Runs in the app's entry, before this page's chunk loads: the address only.
  validate: (route) => isBookId(route.params.book),
})

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const store = useNotesStore()
const books = useBookStore()
const library = useLibraryStore()
const online = useOnline()
// Direct, as the other screens that draw a Book from a social answer (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

const bookId = computed(() => String(route.params.book))
const book = computed(() => books.page(bookId.value)?.book ?? null)
const page = computed(() => store.pageOf(bookId.value))
const room = computed(() => page.value?.room ?? null)
const state = computed(() => store.pages[bookId.value] ?? null)
const hidden = computed(() => library.entryForBook(bookId.value)?.hidden === true)

useHead({ title: () => `${t('notes.title')} · ${book.value?.title ?? ''} · ${t('app.name')}` })

// ------------------------------------------------------------------ loading

const error = ref<NoteErrorCode | null>(null)
const loading = ref(true)

async function load() {
  loading.value = true
  error.value = await store.refresh(bookId.value)
  loading.value = false
}

function onVisible() {
  if (document.visibilityState === 'visible' && online.value) void load()
}
onMounted(() => {
  void books.load(bookId.value)
  void store.loadConfig()
  void load()
  document.addEventListener('visibilitychange', onVisible)
})
onBeforeUnmount(() => document.removeEventListener('visibilitychange', onVisible))
watch(bookId, () => {
  void books.load(bookId.value)
  void load()
})
// Back online with nothing to show: asked again.
watch(online, (now) => now && !page.value && void load())

/** The Book has no Notes (a Manual book: nobody else can open it) or does not exist for her. */
const missing = computed(() => !page.value && (error.value === 'not_found' || error.value === 'notes_unavailable'))
const failed = computed(() => !page.value && !!error.value && !missing.value)
useFocusHeading(() => !!page.value || missing.value || failed.value)

// ------------------------------------------------------------------ the rows

const peeked = computed(() => (room.value ? store.peekedSet(room.value.id) : new Set<string>()))
const rows = computed(() => (room.value ? chapterRows(room.value, peeked.value) : []))
const chapterWord = (row: ChapterRow) => (row.kind === 'end' ? t('notes.wholeBook') : t('notes.chapter', { n: row.number }))
const rowTitle = chapterWord
/**
 * What the row's number is called aloud. The row's name must begin with what is drawn (WCAG 2.5.3, Label in Name), so a numbered row's label ends with its number:
 * "Chapter 9". A veiled one is only ever that (nothing else of it is spoken); an open one whose title already says its number ("Chapter 9") is named by the title alone.
 * "The whole book" has no number: its title names it, and a veiled one is named by it.
 */
function rowLabel(row: ChapterRow): string | undefined {
  if (row.kind === 'end') return row.veiled ? t('notes.wholeBook') : ''
  if (row.veiled) return t('notes.chapter', { n: row.number })
  return titleSaysNumber(rowTitle(row), row.number) ? undefined : t('notes.chapter', { n: row.number })
}
const faceName = (f: { name: string | null }) => f.name?.trim() || t('member.someone')
const faceOf = (face: ChapterRow['faces'][number]) => ({ initials: initialsOf('', faceName(face)), photo: null, label: faceName(face) })
const facesLabel = (row: ChapterRow) => (row.faces.length ? t('notes.hereNow', { names: row.faces.map(faceName).join(t('common.listSeparator')) }) : undefined)

const asking = ref<ChapterRow | null>(null)
const confirmOpen = ref(false)
function openRow(row: ChapterRow) {
  if (row.veiled) {
    asking.value = row
    confirmOpen.value = true
    return
  }
  void navigateTo(chapterPath(bookId.value, row))
}
function showAnyway() {
  const row = asking.value
  if (!row || !room.value) return
  store.peek(room.value.id, row.id)
  void navigateTo(chapterPath(bookId.value, row))
}

// ------------------------------------------------------------------ her chapter

const onChapter = computed(() => {
  const me = room.value?.me
  if (!me) return ''
  if (me.finished) return t('notes.page.finishedLine')
  return me.chapter >= 1 ? t('notes.page.youreOn', { n: me.chapter }) : t('notes.page.notStarted')
})

const chapterOpen = ref(false)
const menuOpen = ref(false)
const addOpen = ref(false)

/** The chapters are made (by her, or somebody was first and her page shows theirs). */
const making = (count: number) => store.setChapters(bookId.value, count)

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo(`/book/${bookId.value}`)
}

</script>

<template>
  <div class="relative min-h-dvh pb-xxl" data-testid="notes">
    <UiAmbient :colors="book?.coverColors ?? null" />
    <UiTopBar :back-label="t('notes.back')" back-testid="notes.back" @back="back">
      <template v-if="room && page?.canWrite" #trailing>
        <UiRoundButton icon="more" :label="t('notes.menu.label')" data-testid="notes.more" @click="menuOpen = true" />
      </template>
    </UiTopBar>

    <!-- No Notes for this Book (a Manual book is hers alone), or there is no such Book. -->
    <FriendsNote v-if="missing" heading :title="t('notes.missingTitle')" :text="t('notes.missingText')" data-testid="notes.missing">
      <UiButton tone="secondary" size="md" :to="`/book/${bookId}`" data-testid="notes.missingBook">{{ t('notes.toBook') }}</UiButton>
    </FriendsNote>

    <FriendsNote v-else-if="failed" heading :text="error === 'offline' ? t('notes.offline') : t(noteErrorKey(error!))" data-testid="notes.loadError">
      <UiButton v-if="error !== 'offline'" tone="secondary" size="md" data-testid="notes.retry" @click="load">{{ t('notes.retry') }}</UiButton>
    </FriendsNote>

    <!-- The first answer on its way: the hero's place is held, nothing moves when it comes. -->
    <section v-else-if="!page" class="relative flex items-center gap-ml px-screen pt-sm" aria-busy="true" aria-hidden="true">
      <span class="skeleton wave cover-hold shrink-0 rounded-cover" />
      <span class="flex flex-1 flex-col gap-sm"><span class="line w-1/3"><span class="skeleton wave w-full" /></span><span class="line w-2/3"><span class="skeleton wave w-full" /></span></span>
    </section>

    <template v-else>
      <section class="relative flex items-center gap-ml px-screen pt-sm" data-testid="notes.hero">
        <UiCover
          v-if="book"
          decorative
          :title="book.title"
          :authors="book.authors"
          v-bind="coverImage(book, 'md', coverHosts)"
          :thumbhash="book.coverThumbhash"
          :colors="book.coverColors"
          size="md"
          glow
          eager
          class="shrink-0"
        />
        <div class="min-w-0 flex-1">
          <p class="eyebrow">{{ t('notes.title') }}</p>
          <h1 class="book-title mt-xs text-headline text-balance wrap-anywhere" data-testid="notes.bookTitle">{{ book?.title }}</h1>
          <p v-if="book?.authors.length" class="mt-xs text-subhead text-ink-muted wrap-anywhere">{{ book.authors.join(t('common.listSeparator')) }}</p>
          <p v-if="room" class="mt-sm text-subhead text-ink-faint" data-testid="notes.sub">{{ t('notes.page.sub', { count: room.chapterCount }, room.chapterCount) }}</p>
        </div>
      </section>

      <!-- Nobody has made the chapters yet. -->
      <template v-if="!room">
        <NotesChapterCount v-if="page.canWrite" :submit="making" />
        <FriendsNote v-else :text="t('notes.page.noChapters')" data-testid="notes.noChapters">
          <UiButton tone="secondary" size="md" :to="`/book/${bookId}`" data-testid="notes.addToLibrary">{{ t('book.add') }}</UiButton>
        </FriendsNote>
      </template>

      <div v-else class="relative flex flex-col gap-md px-screen pt-lg">
        <p v-if="hidden" class="text-footnote text-ink-faint" data-testid="notes.hiddenLine">{{ t('notes.page.hidden') }}</p>

        <div v-if="page.canWrite" class="flex items-center justify-between gap-md px-inset">
          <p class="text-subhead text-ink-muted" data-testid="notes.youreOn">{{ onChapter }}</p>
          <button
            type="button"
            class="min-h-(--size-touch) px-sm text-subhead font-medium text-accent-ink focus-visible:outline-2 focus-visible:outline-accent"
            aria-haspopup="dialog"
            data-testid="notes.change"
            @click="chapterOpen = true"
          >
            {{ t('notes.page.change') }}
          </button>
        </div>

        <section aria-labelledby="notes-chapters">
          <h2 id="notes-chapters" class="sr-only">{{ t('notes.page.chapters') }}</h2>
          <UiRowGroup>
            <ul data-testid="notes.rows">
              <li v-for="row in rows" :key="row.id" class="border-hairline not-first:border-t">
                <UiThreadRow
                  :number="row.number"
                  :title="rowTitle(row)"
                  :label="rowLabel(row)"
                  :count="row.count"
                  :unread="row.unread"
                  :veiled="row.veiled"
                  :faces="row.faces.map(faceOf)"
                  :faces-label="facesLabel(row)"
                  testid="notes.chapter"
                  :data-segment="row.segment"
                  @open="openRow(row)"
                />
              </li>
            </ul>
          </UiRowGroup>
          <p class="mt-sm px-inset text-footnote text-ink-faint">{{ t('notes.page.veilHint') }}</p>
        </section>
      </div>

      <template v-if="room">
        <NotesChapterSheet v-model:open="chapterOpen" :book-id="bookId" :room="room" />
        <NotesAddChaptersSheet v-model:open="addOpen" :book-id="bookId" :chapter-count="room.chapterCount" />
        <UiSheet v-model:open="menuOpen" :title="t('notes.menu.title')" :cancel="false" :action="t('notes.done')" testid="notes.menu" @action="menuOpen = false">
          <div class="pt-xs pb-lg">
            <UiRowGroup>
              <UiRow as="button" icon="plus" :label="t('notes.menu.add')" chevron data-testid="notes.menu.add" @click="(menuOpen = false), (addOpen = true)" />
            </UiRowGroup>
          </div>
        </UiSheet>
      </template>
    </template>

    <RoomShowAnyway v-model:open="confirmOpen" prefix="notes.showAnyway" :number="asking?.number ?? ''" :end="asking?.kind === 'end'" @show="showAnyway" />
  </div>
</template>

<style scoped>
.cover-hold {
  width: var(--size-cover-md);
  aspect-ratio: 2 / 3;
}
.line {
  display: block;
  height: var(--spacing-ml);
}
</style>
