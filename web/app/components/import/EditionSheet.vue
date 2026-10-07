<script setup lang="ts">
// Choose edition (issues #40, #111), opened from a book of the import's preview
// that needs a look (or from "Your choices"): the same sheet as the Book page's
// Change edition (BookEditionPicker), with this book's editions — the one the
// preview has now first, the book as the file has it, the editions the match
// found, best fit first, then what the same edition search the Book page uses
// finds (title and first author). The pick replaces the book's edition in the
// preview only; the import then writes it. Nothing is written by choosing, so
// it works offline too, with the editions the match found; the search needs
// the network and the sheet says so. "My edition isn't listed" leads on to
// finding her edition by its ISBN or making it herself (BookOwnEditionSheet);
// what she takes there becomes the row's edition, in the preview only.
import type { EditionChoice } from '~/data/bookImport'
import { useImportStore } from '~/stores/import'
import { useOwnEditionStore } from '~/stores/ownEdition'

const { t } = useI18n()
const store = useImportStore()
const own = useOwnEditionStore()
const online = useOnline()

const open = computed({
  get: () => store.choosing !== null,
  set: (value) => {
    if (!value) store.closeChoice()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const rows = ref<EditionChoice[]>(store.choosing?.rows ?? [])
watch(
  () => store.choosing?.rows,
  (value) => {
    if (value) rows.value = value
  },
)

/** The file's own row says what it is; the rest are editions. */
const shown = computed(() => rows.value.map((row) => ({ ...row, note: row.file ? t('import.edition.file') : undefined })))

/** "My edition isn't listed": this sheet makes way for the next step, about the same row. */
function missing() {
  const key = store.choosing?.key
  const book = store.choosingBook
  if (!key || !book) return
  store.closeChoice()
  own.open({ kind: 'import', key, book })
}

// The connection is back: the editions search runs after all.
watch(online, (now) => {
  if (now && store.choosing && !store.choosing.pending) store.retryChoice()
})
</script>

<template>
  <BookEditionPicker
    v-model:open="open"
    :rows="shown"
    :title="t('import.edition.title')"
    :hint="t('import.edition.hint')"
    :action="t('import.edition.action')"
    :action-disabled="!store.choice"
    :is-picked="store.isPicked"
    :current-label="t('import.edition.current')"
    :pending="Boolean(store.choosing?.pending)"
    :failed="Boolean(store.choosing?.failed)"
    :offline="online ? null : t('import.edition.offline')"
    :none="t('import.edition.none')"
    :missing="t('book.edition.missing')"
    @pick="store.pick"
    @action="store.confirmChoice()"
    @retry="store.retryChoice()"
    @missing="missing"
  />
  <BookOwnEditionSheet />
</template>
