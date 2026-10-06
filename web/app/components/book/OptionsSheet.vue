<script setup lang="ts">
// The book page's options (D's ⋯ in the top bar; issue #11), for a Book that
// is in the Library: Change edition (issue #41, opens its sheet) and Remove
// from Library. Remove does not act at
// once: the confirmation says what goes with it (the Book's reads and its
// places on collections; the collections stay), and only its button removes.
// `removed` fires once the entry is gone, so the page can leave the Book. The
// page keeps this mounted when the entry is gone (`entry` is null then), or the
// event would be lost with the component.
//
// The Book's ebook on this device (issue #131): Add ebook (the platform's file
// picker, an EPUB; it is linked to this Book, after a question when it is clearly
// another book: components/book/Ebook.vue), or, once one is linked, Replace ebook
// file and Unlink ebook (behind a Confirm: the copy on this device is deleted,
// the Book stays). The picker is a native file input laid over the row, so the
// tap itself opens it (as UiDateRow does with the date picker); the sheet closes
// once a file is chosen. Offered where the browser can keep files.
import type { LibraryEntry } from '~/data/library'
import { useEbooksStore } from '~/stores/ebooks'
import { useEditionStore } from '~/stores/edition'
import { useHistoryStore } from '~/stores/history'

const props = defineProps<{ entry: LibraryEntry | null }>()
const emit = defineEmits<{ removed: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const history = useHistoryStore()
const edition = useEditionStore()
// Changing the edition looks editions up: offline the row says so instead (#15).
// Removing works offline too: it waits to sync (#93).
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

const ebooks = useEbooksStore()
const ebook = computed(() => ebooks.linkFor(props.entry))
// Kept while the question slides away, like the book line above.
const ebookName = ref('')
const unlinking = ref(false)

function picked(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  // Emptied at once, so choosing the same file again is a change too.
  field.value = ''
  if (!file || !props.entry) return
  open.value = false
  void ebooks.addForBook(file, props.entry)
}

function askUnlink() {
  if (!ebook.value) return
  ebookName.value = ebook.value.name
  open.value = false
  unlinking.value = true
}

async function unlink() {
  if (ebook.value) await ebooks.unlink(ebook.value)
  unlinking.value = false
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
        <template v-if="ebooks.supported && entry">
          <UiRow
            icon="ebook"
            :label="ebook ? t('bookOptions.replaceEbook') : t('bookOptions.addEbook')"
            class="not-disabled:hover:bg-fill active:bg-fill-strong"
            data-testid="bookOptions.ebookRow"
          >
            <input
              type="file"
              accept=".epub,application/epub+zip"
              class="absolute inset-0 size-full cursor-pointer opacity-0"
              :aria-label="ebook ? t('bookOptions.replaceEbook') : t('bookOptions.addEbook')"
              :data-testid="ebook ? 'bookOptions.replaceEbook' : 'bookOptions.addEbook'"
              @change="picked"
            />
          </UiRow>
          <UiRow v-if="ebook" as="button" icon="close" :label="t('bookOptions.unlinkEbook')" data-testid="bookOptions.unlinkEbook" @click="askUnlink" />
        </template>
        <UiRow
          as="button"
          icon="close"
          tone="danger"
          :label="t('bookOptions.remove')"
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
    :error="history.removeError ? t(`library.error.${history.removeError}`) : null"
    testid="removeEntry"
    @confirm="remove"
  />

  <UiConfirm
    v-model:open="unlinking"
    :title="t('bookEbook.unlink.title')"
    :text="t('bookEbook.unlink.text', { name: ebookName })"
    :action="t('bookEbook.unlink.action')"
    testid="unlinkEbook"
    @confirm="unlink"
  />
</template>
