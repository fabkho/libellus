<script setup lang="ts">
// The Book's ebook on this device (issue #131), on the book page under its
// action: one quiet line, "Ebook · on this device" with the ebook icon, or
// "Ebook · missing" when the browser evicted the copy (a share or a scan of the
// same file brings it back). Nothing when no file is linked: the options sheet
// offers Add ebook (components/book/OptionsSheet.vue). While a picked file is
// taken in the line says so; a file that is not an EPUB, or no room to keep
// it, is said here too. A picked file that is clearly another book (its ISBN
// or title differs) is asked about in a sheet: "Another book?", the file's
// title and author, Link links it anyway. Read now is the page's own action
// while the Book is wanted or being read; on a finished or abandoned Book this
// line is the way in (`read`: "Ebook · on this device · Read").
import type { LibraryEntry } from '~/data/library'
import { useEbooksStore } from '~/stores/ebooks'

const props = defineProps<{ entry: LibraryEntry; read?: boolean }>()
defineEmits<{ read: [] }>()

const { t } = useI18n()
const ebooks = useEbooksStore()

const record = computed(() => ebooks.linkFor(props.entry))
const missing = computed(() => Boolean(record.value && ebooks.missing.has(record.value.id)))
const mine = computed(() => ebooks.pickedFor === props.entry.id)
const adding = computed(() => mine.value && ebooks.busy?.source === 'picker')
const failed = computed(() => (mine.value && (ebooks.error === 'not_epub' || ebooks.error === 'storage') ? ebooks.error : null))

const asking = computed({
  get: () => ebooks.question?.entry.id === props.entry.id,
  set: (value) => {
    if (!value) ebooks.cancelPick()
  },
})
// Kept while the sheet slides away.
const asked = ref<{ title: string | null; authors: string[] } | null>(null)
watch(
  () => ebooks.question,
  (question) => {
    if (question?.entry.id === props.entry.id) asked.value = { title: question.title, authors: question.authors }
  },
)
</script>

<template>
  <p v-if="adding" class="mt-ms text-center text-caption text-ink-faint" role="status" data-testid="book.ebookAdding">
    {{ t('bookEbook.adding') }}
  </p>
  <p v-else-if="failed" class="mt-ms text-center text-caption text-error" role="alert" data-testid="book.ebookError">
    {{ t(`ebooks.error.${failed}`) }}
  </p>
  <template v-else-if="record">
    <p
      class="mt-ms flex items-center justify-center gap-xs text-caption"
      :class="missing ? 'text-error' : 'text-ink-faint'"
      data-testid="book.ebook"
      :data-missing="missing || undefined"
    >
      <UiIcon name="ebook" :size="14" />
      <span>{{ missing ? t('bookEbook.missing') : t('bookEbook.line') }}</span>
      <template v-if="read && !missing">
        <span class="text-ink-ghost" aria-hidden="true">·</span>
        <button type="button" class="relative font-medium text-accent after:absolute after:-inset-ms after:content-['']" data-testid="book.ebookRead" @click="$emit('read')">
          {{ t('book.read') }}
        </button>
      </template>
    </p>
    <p v-if="missing" class="mt-xxs text-center text-meta text-ink-faint" data-testid="book.ebookMissingHint">{{ t('bookEbook.missingHint') }}</p>
  </template>

  <UiSheet v-model:open="asking" :title="t('bookEbook.another.title')" :action="t('bookEbook.another.action')" testid="ebookAnother" @action="ebooks.confirmPick()">
    <div class="pt-xs pb-sm">
      <UiBookLine v-if="asked" :title="asked.title || t('ebooks.untitled')" :authors="asked.authors" />
      <p class="mt-sm text-subhead text-ink-muted" data-testid="ebookAnother.text">
        {{ t('bookEbook.another.text', { title: asked?.title || t('ebooks.untitled') }) }}
      </p>
    </div>
  </UiSheet>
</template>
