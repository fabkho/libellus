<script setup lang="ts">
// The book page's options (D's ⋯ in the top bar; issue #11), for a Book that
// is in the Library: Change edition (issue #41, opens its sheet) and Remove
// from Library. Remove does not act at
// once: the confirmation says what goes with it (the Book's reads and its
// places on collections; the collections stay), and only its button removes.
// `removed` fires once the entry is gone, so the page can leave the Book. The
// page keeps this mounted when the entry is gone (`entry` is null then), or the
// event would be lost with the component.
import type { LibraryEntry } from '~/data/library'
import { useEditionStore } from '~/stores/edition'
import { useHistoryStore } from '~/stores/history'

const props = defineProps<{ entry: LibraryEntry | null }>()
const emit = defineEmits<{ removed: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const history = useHistoryStore()
const edition = useEditionStore()
// Removing writes: offline the row and the confirmation say so instead (#15).
const online = useOnline()

const confirming = computed({
  get: () => history.removing !== null,
  set: (value) => {
    if (!value) history.cancelRemove()
  },
})

// Kept while the sheet and the question slide away, so the book line and the
// question's title do not empty mid-exit.
const book = ref(props.entry?.book ?? null)
watch(
  () => props.entry,
  (entry) => {
    if (entry) book.value = entry.book
  },
  { immediate: true },
)
const title = computed(() => book.value?.title ?? '')

function changeEdition() {
  if (!props.entry) return
  open.value = false
  edition.open(props.entry)
}

function ask() {
  if (!props.entry) return
  open.value = false
  history.askRemove(props.entry)
}

async function remove() {
  if (await history.confirmRemove()) emit('removed')
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('bookOptions.title')" testid="bookOptions">
    <div class="pt-xs pb-sm">
      <UiBookLine
        v-if="book"
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'xs')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
      />
      <UiRowGroup>
        <UiRow
          as="button"
          icon="stack"
          :label="t('book.edition.open')"
          :value="online ? undefined : t('common.offline')"
          :disabled="!online"
          class="disabled:opacity-50"
          data-testid="bookOptions.changeEdition"
          @click="changeEdition"
        />
        <UiRow
          as="button"
          icon="close"
          tone="danger"
          :label="t('bookOptions.remove')"
          :value="online ? undefined : t('common.offline')"
          :disabled="!online"
          class="disabled:opacity-50"
          data-testid="bookOptions.remove"
          @click="ask"
        />
      </UiRowGroup>
    </div>
  </UiSheet>

  <UiConfirm
    v-model:open="confirming"
    :title="t('removeEntry.title', { title })"
    :text="t('removeEntry.text')"
    :action="history.removeBusy ? t('removeEntry.busy') : t('removeEntry.action')"
    :busy="history.removeBusy"
    :offline="!online"
    :error="history.removeError ? t(`library.error.${history.removeError}`) : null"
    testid="removeEntry"
    @confirm="remove"
  />
</template>
