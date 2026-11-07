<script setup lang="ts">
// "Add chapters" (docs/plans/book-notes.md part 2.2; docs/parity.md, *Notes page*): a wrong count is usually too low, and anyone with the Book may add chapters at the end (before *The whole book*);
// the chapters there keep their notes. A number (1…, up to 300 in all), then the call. Chapters are never removed from here. A refusal stays in the sheet, worded.
import { CHAPTERS_MAX, type NoteErrorCode } from '~/data/notes'
import { noteErrorKey } from '~/utils/notes'
import { useNotesStore } from '~/stores/notes'

const props = defineProps<{ bookId: string; chapterCount: number }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useNotesStore()
const online = useOnline()

const text = ref('')
const busy = ref(false)
const error = ref<NoteErrorCode | null>(null)
const room = computed(() => CHAPTERS_MAX - props.chapterCount)
const count = computed(() => {
  const digits = text.value.replace(/\D/g, '')
  const n = digits ? Number(digits) : 0
  return n >= 1 && n <= room.value ? n : null
})

watch(open, (now) => {
  if (!now) return
  text.value = ''
  error.value = null
  busy.value = false
})

async function add() {
  if (count.value === null || busy.value) return
  busy.value = true
  error.value = await store.addChapters(props.bookId, count.value)
  busy.value = false
  if (!error.value) open.value = false
}
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('notes.add.title')"
    :action="busy ? t('notes.add.adding') : t('notes.add.action')"
    :action-disabled="count === null || busy || !online"
    testid="notes.add"
    @action="add"
  >
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <p class="text-subhead text-ink-muted">{{ t('notes.add.intro') }}</p>
      <UiField
        id="notes-add-count"
        v-model="text"
        data-autofocus
        :label="t('notes.add.label')"
        :hint="t('notes.add.hint', { n: room })"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        data-testid="notes.add.count"
      />
      <p v-if="!online" class="text-footnote text-ink-faint" data-testid="notes.add.offline">{{ t('common.offline') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="notes.add.error">{{ t(noteErrorKey(error)) }}</p>
    </div>
  </UiSheet>
</template>
