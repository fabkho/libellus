<script setup lang="ts">
// Change edition (issue #41), opened from the book page's options: the editions
// the entry can change to (BookEditionPicker draws them), the entry's own
// edition first, marked and picked. A tap picks another; the sheet's action
// changes to it, and a refusal shows on the picked row. The list grows while
// the sources answer. `changed` fires with the entry once it points at the new
// Book, so the page can move to its address.
//
// Over the list, the picked edition's format (hardcover, paperback, ebook,
// audiobook): what its source said, or her own word on her edition. It is not
// a filter: it is her word on what her copy is, and a line under its label
// says so, then says what she said will be saved. A tap says it is another:
// the picked row's facts take it at once; with another edition picked, the
// action says it goes along ("Change & save"); with her own edition
// picked, the action saves just that.
// Under the list, "My edition isn't listed" closes the sheet for the next
// step (BookOwnEditionSheet: find it by its ISBN, or make it herself).
//
// The same sheet opens for a Book that is not in her Library (`edition.browse`):
// the same list, but picking one only changes what the page shows. There is no
// copy to say the format of and no edition of hers to add, so those two go; the
// hint and the action say that nothing is saved ("Show").
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
  get: () => edition.active,
  set: (value) => {
    if (!value) edition.close()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const rows = ref<EditionCandidate[]>(edition.candidates)
watch(
  () => edition.candidates,
  (value) => {
    if (edition.active) rows.value = value
  },
)

// Whether it is for a Book to look at; kept while the sheet slides away, like the rows.
const browsing = ref(edition.browsing !== null)
watch(
  () => edition.browsing,
  (value) => {
    if (edition.active) browsing.value = value !== null
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
  if (browsing.value) return t('book.edition.show')
  if (!online.value) return t('common.offline')
  if (edition.busy) return edition.choice ? t('book.edition.busy') : t('book.edition.saving')
  if (edition.choice) {
    return edition.formatSaid ? t('book.edition.changeAndSave') : t('book.edition.action')
  }
  return edition.formatChanged ? t('book.edition.save') : t('book.edition.action')
})

/** What the format row does: said before she touches it, and what she said after. */
const formatHelp = computed(() => (edition.format ? t('book.edition.formatSaid', { format: t(`book.formatFact.${edition.format}`) }) : undefined))

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
    :hint="t(browsing ? 'book.edition.browseHint' : 'book.edition.hint')"
    :action="action"
    :action-disabled="browsing ? !edition.choice : !online || edition.busy || !(edition.choice || edition.formatChanged)"
    :is-picked="edition.isPicked"
    :current-label="t(browsing ? 'book.edition.shown' : 'book.edition.current')"
    :pending="edition.pending"
    :failed="edition.failed"
    :busy="edition.busy"
    :error="edition.error"
    :missing="browsing ? undefined : t('book.edition.missing')"
    @pick="edition.pick"
    @action="change"
    @retry="edition.look()"
    @missing="missing"
  >
    <template #top>
      <BookFormatChoice
        v-if="!browsing"
        class="mb-ml"
        :value="edition.shownFormat"
        :label="t('book.edition.copyFormat')"
        :help="formatHelp"
        testid="edition.format"
        :disabled="edition.busy"
        @choose="edition.chooseFormat"
      />
    </template>
  </BookEditionPicker>
  <BookOwnEditionSheet @changed="emit('changed', $event)" />
</template>
