<script setup lang="ts">
// Change edition (issue #41), opened from the book page's options: the editions
// the entry can change to (BookEditionPicker draws them), the entry's own
// edition first, marked and picked. A tap picks another; the sheet's action
// changes to it, and a refusal shows on the picked row. The list grows while
// the sources answer. `changed` fires with the entry once it points at the new
// Book, so the page can move to its address.
import type { EditionCandidate } from '~/data/editions'
import type { LibraryEntry } from '~/data/library'
import { useEditionStore } from '~/stores/edition'

const emit = defineEmits<{ changed: [entry: LibraryEntry] }>()

const { t } = useI18n()
const edition = useEditionStore()
// Changing writes: offline the action says so instead (#15).
const online = useOnline()

const open = computed({
  get: () => edition.changing !== null,
  set: (value) => {
    if (!value) edition.close()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const rows = ref<EditionCandidate[]>(edition.candidates)
watch(
  () => edition.candidates,
  (value) => {
    if (edition.changing) rows.value = value
  },
)

const action = computed(() => {
  if (!online.value) return t('common.offline')
  return edition.busy ? t('book.edition.busy') : t('book.edition.action')
})

async function change() {
  const changed = await edition.confirm()
  if (changed) emit('changed', changed)
}
</script>

<template>
  <BookEditionPicker
    v-model:open="open"
    :rows="rows"
    :title="t('book.edition.title')"
    :hint="t('book.edition.hint')"
    :action="action"
    :action-disabled="!online || edition.busy || !edition.choice"
    :is-picked="edition.isPicked"
    :current-label="t('book.edition.current')"
    :pending="edition.pending"
    :failed="edition.failed"
    :busy="edition.busy"
    :error="edition.error"
    @pick="edition.pick"
    @action="change"
    @retry="edition.look()"
  />
</template>
