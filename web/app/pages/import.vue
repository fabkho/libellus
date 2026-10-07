<script setup lang="ts">
// Import books (issues #40, #111): an export from Goodreads or Hardcover into
// the member's Library; which app wrote it is told by its header, she never
// picks one. Reached from the Profile's account rows (issue #78). One line names
// the apps it reads, with how to export from each; then the file is
// read on the device and every book's edition looked up (the count runs as
// they come in), a preview says what would happen (how many per Status, how
// many matched an edition, her other shelves offered as Collections, which
// books need a look — with the cover of the edition each will be), *Import N books* writes
// them with a running count, and a summary leads to the Library. Importing
// the same file again adds nothing. A book matched by its title or only from
// the file offers Choose edition: the Change edition sheet of the Book page, the
// pick replacing its edition in the preview only (stores/import.ts). A pushed screen in the tab layout.
import type { ImportNote } from '~/components/import/NoteList.vue'
import { SUPPORTED_SOURCES } from '~/data/import/detect'
import { editionFacts } from '~/data/editions'
import { languageCode } from '~/data/import/editions'
import { useImportStore, type Attention } from '~/stores/import'

definePageMeta({ layout: 'tabs', screen: 'import', pushed: true })

const { t, locale } = useI18n()
const router = useRouter()
const store = useImportStore()
// Choosing a file looks books up and importing writes: offline neither can (#15).
const online = useOnline()

useHead({ title: () => `${t('import.title')} · ${t('app.name')}` })

function back() {
  if (window.history.state?.back) router.back()
  else void navigateTo('/profile')
}

const input = useTemplateRef<HTMLInputElement>('input')
function pick() {
  input.value?.click()
}
function picked(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  // Emptied at once, so choosing the same file again is a change too.
  field.value = ''
  if (file) void store.choose(file)
}

const picking = computed(() => store.phase === 'pick' || store.phase === 'reading')
/** "From Hardcover · 312 books": the app the file was told to be from, and how many books it holds. */
const fileTitle = computed(() =>
  t('import.inFile', { count: store.books.length, app: store.source ? t(`import.app.${store.source}`) : '' }, store.books.length),
)
const fileErrorText = computed(() => {
  const detail = store.fileErrorDetail
  if (store.fileError !== 'missingColumns' || !detail) return store.fileError ? t(`import.fileError.${store.fileError}`) : ''
  const columns = detail.columns.map((name) => `“${name}”`).join(', ')
  return t('import.fileError.missingColumns', { app: t(`import.app.${detail.source}`), columns }, detail.columns.length)
})

/** `de` → "German", in the app's language; null when there is none to name. */
function languageName(code: string | null): string | null {
  const short = languageCode(code)
  if (!short) return null
  try {
    return new Intl.DisplayNames([locale.value], { type: 'language' }).of(short) ?? null
  } catch {
    return null
  }
}

function noteText(note: Attention['notes'][number]): string {
  switch (note.code) {
    case 'otherShelf':
      return t('import.note.otherShelf', { shelf: note.shelf })
    case 'extraReads':
      return t('import.note.extraReads', { count: note.count }, note.count)
    case 'earlierReads':
      return t('import.note.earlierReads', { count: note.count }, note.count)
    case 'byTitle': {
      const edition = [note.year, languageName(note.language)].filter(Boolean).join(', ')
      return edition ? t('import.note.byTitleEdition', { edition }) : t('import.note.byTitle')
    }
    default:
      return t(`import.note.${note.code}`)
  }
}

/** A book of the preview as a row: its cover, its notes, and, once every book is looked up, the button that opens Choose edition. */
function listed(items: readonly Attention[], action: string): ImportNote[] {
  return items.map((item) => {
    const title = item.title || t('import.untitled')
    return {
      key: item.key,
      title,
      authors: item.authors,
      cover: item.edition ? { url: item.edition.coverUrl, thumbhash: item.edition.coverThumbhash, colors: item.edition.coverColors } : null,
      notes: item.notes.map(noteText),
      ...(item.held
        ? { facts: editionFacts(item.held, { locale: locale.value, pages: (count) => t('book.pages', { count }), format: (format) => t(`book.formatFact.${format}`) }) }
        : {}),
      ...(item.choose && store.phase === 'preview' ? { action: { label: action, name: t('import.actionFor', { action, title }) } } : {}),
    }
  })
}
const attention = computed(() => listed(store.attention, t('import.chooseEdition')))
const choices = computed(() => listed(store.choices, t('import.changeEdition')))

const failures = computed<ImportNote[]>(() =>
  store.failed.map((failure) => ({
    key: failure.key,
    title: failure.book?.title ?? failure.key,
    authors: failure.book?.authors ?? [],
    notes: [t(`library.error.${failure.error === 'key_invalid' || !failure.error ? 'unknown' : failure.error}`)],
  })),
)
</script>

<template>
  <div class="relative min-h-dvh">
    <UiTopBar :back-label="t('import.back')" back-testid="import.back" @back="back" />

    <header class="px-screen pt-bar">
      <h1 class="text-large-title" data-testid="import.title">{{ t('import.title') }}</h1>
    </header>

    <input
      ref="input"
      type="file"
      accept=".csv,text/csv"
      class="hidden"
      data-testid="import.file"
      @change="picked"
    />

    <!-- Pick: where the file comes from, and the one way forward. -->
    <UiEmptyState v-if="picking" screen="import" :title="t('import.pickTitle')" :text="t('import.pickText')" class="px-screen pt-md">
      <UiButton
        block
        :offline="!online"
        :disabled="store.phase === 'reading'"
        data-testid="import.choose"
        @click="pick"
      >
        {{ store.phase === 'reading' ? t('import.reading') : t('import.choose') }}
      </UiButton>
      <p v-if="store.fileError" class="mt-ms text-center text-caption text-error" role="alert" data-testid="import.fileError">
        {{ fileErrorText }}
      </p>
      <ImportHowTo :sources="SUPPORTED_SOURCES" class="mt-xl" />
    </UiEmptyState>

    <!-- Looking up, preview, importing: the file and what is in it. -->
    <section v-else-if="store.phase !== 'done'" class="px-screen pt-lg pb-xl" data-testid="import.preview">
      <p class="eyebrow truncate" data-testid="import.fileName">{{ store.fileName }}</p>
      <p class="book-title mt-xs text-headline" data-testid="import.inFile" :data-source="store.source">{{ fileTitle }}</p>

      <ImportCounts :counts="store.byStatus" class="mt-md" />

      <ImportProgress
        v-if="store.phase === 'matching'"
        class="mt-lg"
        testid="import.matching"
        :label="t('import.matching', { done: store.progress.done, total: store.progress.total })"
        :hint="t('import.matchingHint')"
        :done="store.progress.done"
        :total="store.progress.total"
      />

      <template v-else>
        <UiRowGroup class="mt-lg">
          <UiRow :label="t('import.matched')" :value="String(store.matched)" mono data-testid="import.matched" />
          <UiRow :label="t('import.fromFile')" :value="String(store.fromFile)" mono data-testid="import.fromFile" />
          <UiRow :label="t('import.alreadyThere')" :value="String(store.alreadyThere)" mono data-testid="import.alreadyThere" />
        </UiRowGroup>

        <ImportProgress
          v-if="store.phase === 'importing'"
          class="mt-lg"
          testid="import.importing"
          :label="t('import.importing', { done: store.progress.done, total: store.progress.total })"
          :hint="t('import.importingHint')"
          :done="store.progress.done"
          :total="store.progress.total"
        />
        <div v-else class="mt-lg flex flex-col gap-xs">
          <UiButton
            v-if="store.toImport.length"
            block
            :offline="!online"
            data-testid="import.start"
            @click="store.start()"
          >
            {{ t('import.start', { count: store.toImport.length }, store.toImport.length) }}
          </UiButton>
          <p v-else class="text-subhead text-ink-muted" data-testid="import.nothing">{{ t('import.nothingToImport') }}</p>
          <UiButton block tone="plain" data-testid="import.another" @click="store.reset()">{{ t('import.stop') }}</UiButton>
        </div>

        <ImportShelves
          v-if="store.shelves.length && store.toImport.length"
          class="mt-xl"
          :shelves="store.shelves"
          :kind="store.source === 'hardcover' ? 'lists' : 'shelves'"
          :disabled="store.phase === 'importing'"
          @toggle="store.toggleShelf"
        />
      </template>

      <UiButton v-if="store.phase === 'matching'" block tone="plain" class="mt-md" data-testid="import.cancel" @click="store.reset()">
        {{ t('import.stop') }}
      </UiButton>

      <template v-if="attention.length">
        <h2 class="eyebrow mt-xl flex justify-between" data-testid="import.attention">
          <span>{{ t('import.attention') }}</span><span class="figures">{{ attention.length }}</span>
        </h2>
        <ImportNoteList :items="attention" testid="import.attentionList" class="mt-xs" @act="store.openChoice" />
      </template>

      <!-- Books whose edition she chose herself: the preview has her pick, and she can change it. -->
      <template v-if="choices.length">
        <h2 class="eyebrow mt-xl flex justify-between" data-testid="import.choices">
          <span>{{ t('import.choices') }}</span><span class="figures">{{ choices.length }}</span>
        </h2>
        <ImportNoteList :items="choices" testid="import.choicesList" class="mt-xs" @act="store.openChoice" />
      </template>

      <ImportEditionSheet />
    </section>

    <!-- Done: what was added, what was there already, what was not. -->
    <section v-else class="px-screen pt-lg pb-xl" data-testid="import.done">
      <div v-if="store.addedCovers.length" class="pile mb-lg flex" aria-hidden="true" data-testid="import.doneCovers">
        <UiCover
          v-for="book in store.addedCovers"
          :key="book.title + (book.isbn13 ?? '')"
          :title="book.title"
          :authors="book.authors"
          :src="coverSrc(book.coverUrl, 'md')"
          :thumbhash="book.coverThumbhash"
          :colors="book.coverColors"
          size="md"
          eager
        />
      </div>
      <p class="eyebrow truncate">{{ store.fileName }}</p>
      <p class="book-title mt-xs text-headline" data-testid="import.doneTitle">
        {{ t('import.doneTitle', { count: store.added }, store.added) }}
      </p>
      <p class="mt-sm text-subhead text-ink-muted">{{ store.added ? t('import.doneText') : t('import.doneNothing') }}</p>

      <UiRowGroup class="mt-lg">
        <UiRow :label="t('import.added')" :value="String(store.added)" mono data-testid="import.added" />
        <UiRow :label="t('import.kept')" :value="String(store.kept)" mono data-testid="import.kept" />
        <UiRow v-if="failures.length" :label="t('import.failed')" :value="String(failures.length)" mono data-testid="import.failedCount" />
        <UiRow v-if="store.notReached" :label="t('import.notReached')" :value="String(store.notReached)" mono data-testid="import.notReached" />
      </UiRowGroup>

      <p v-if="store.writeError" class="mt-ms text-caption text-error" role="alert" data-testid="import.stopped">
        {{ t('import.stopped', { reason: t(`library.error.${store.writeError}`) }) }}
      </p>

      <div class="mt-lg flex flex-col gap-xs">
        <UiButton block to="/library" data-testid="import.toLibrary">{{ t('import.toLibrary') }}</UiButton>
        <UiButton block tone="plain" data-testid="import.again" @click="store.reset()">{{ t('import.another') }}</UiButton>
      </div>

      <template v-if="failures.length">
        <h2 class="eyebrow mt-xl">{{ t('import.failed') }}</h2>
        <ImportNoteList :items="failures" testid="import.failedList" class="mt-xs" />
      </template>
    </section>
  </div>
</template>

<style scoped>
/* The first covers of what was just added, overlapping like a short pile on a table. */
.pile > * + * {
  margin-left: calc(-1 * var(--spacing-ms));
}
</style>
