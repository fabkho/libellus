<script setup lang="ts">
// The book page's options (D's ⋯ in the top bar; issue #11), for a Book that
// is in the Library: today one row, Remove from Library. It does not act at
// once: the confirmation says what goes with it (the Book's reads and its
// places on collections; the collections stay), and only its button removes.
// `removed` fires once the entry is gone, so the page can leave the Book. The
// page keeps this mounted when the entry is gone (`entry` is null then), or the
// event would be lost with the component.
import type { LibraryEntry } from '~/data/library'
import { useHistoryStore } from '~/stores/history'

const props = defineProps<{ entry: LibraryEntry | null }>()
const emit = defineEmits<{ removed: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const history = useHistoryStore()
// Removing writes: offline the row and the confirmation say so instead (#15).
const online = useOnline()

const confirming = computed({
  get: () => history.removing !== null,
  set: (value) => {
    if (!value) history.cancelRemove()
  },
})

// Kept while the sheet and the question slide away, so their titles do not empty mid-exit.
const title = ref(props.entry?.book.title ?? '')
watch(
  () => props.entry,
  (entry) => {
    if (entry) title.value = entry.book.title
  },
  { immediate: true },
)

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
  <UiSheet v-model:open="open" :title="title" testid="bookOptions">
    <div class="pt-xs pb-sm">
      <UiRowGroup>
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
