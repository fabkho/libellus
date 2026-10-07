<script setup lang="ts">
// Change edition (issue #41), opened from the book page's options: the editions
// the entry can change to (BookEditionPicker draws them), the entry's own
// edition first, marked and picked. A tap picks another; the sheet's action
// changes to it, and a refusal shows on the picked row. The list grows while
// the sources answer. `changed` fires with the entry once it points at the new
// Book, so the page can move to its address.
//
// Over the list, the picked edition's format (hardcover, paperback, ebook,
// audiobook): what its source said, or her own word on her edition. A tap
// says it is another; with her own edition picked, the action saves just that.
// Under the list, "My edition isn't listed" closes the sheet for the next
// step (BookOwnEditionSheet: find it by its ISBN, or make it herself).
import { formatOf } from '~/data/books'
import type { EditionCandidate } from '~/data/editions'
import type { LibraryEntry } from '~/data/library'
import { useEditionStore } from '~/stores/edition'
import { useOwnEditionStore } from '~/stores/ownEdition'

const emit = defineEmits<{ changed: [entry: LibraryEntry] }>()

const { t } = useI18n()
const edition = useEditionStore()
const own = useOwnEditionStore()
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

/** The picked row says the format she chose for it; her own edition, her word on it. */
const shown = computed(() =>
  rows.value.map((row) => {
    if (edition.isPicked(row.book)) return { ...row, format: edition.shownFormat }
    return row.current ? { ...row, format: formatOf(row.book, edition.changing?.formatOverride) } : row
  }),
)

const action = computed(() => {
  if (!online.value) return t('common.offline')
  if (edition.busy) return edition.choice ? t('book.edition.busy') : t('book.edition.saving')
  return edition.choice || !edition.formatChanged ? t('book.edition.action') : t('book.edition.save')
})

async function change() {
  const changed = await edition.confirm()
  if (changed) emit('changed', changed)
}

/** "My edition isn't listed": this sheet makes way for the next step, about the same entry. */
function missing() {
  const entry = edition.changing
  if (!entry || edition.busy) return
  edition.close()
  own.open({ kind: 'entry', entry })
}
</script>

<template>
  <BookEditionPicker
    v-model:open="open"
    :rows="shown"
    :title="t('book.edition.title')"
    :hint="t('book.edition.hint')"
    :action="action"
    :action-disabled="!online || edition.busy || !(edition.choice || edition.formatChanged)"
    :is-picked="edition.isPicked"
    :current-label="t('book.edition.current')"
    :pending="edition.pending"
    :failed="edition.failed"
    :busy="edition.busy"
    :error="edition.error"
    :missing="t('book.edition.missing')"
    @pick="edition.pick"
    @action="change"
    @retry="edition.look()"
    @missing="missing"
  >
    <template #top>
      <BookFormatChoice
        class="mb-ml"
        :value="edition.shownFormat"
        :label="t('book.edition.formatLabel')"
        testid="edition.format"
        :disabled="edition.busy"
        @choose="edition.chooseFormat"
      />
    </template>
  </BookEditionPicker>
  <BookOwnEditionSheet @changed="emit('changed', $event)" />
</template>
