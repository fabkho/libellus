<script setup lang="ts">
// "You're on chapter 5 · Change" (docs/plans/book-notes.md part 2.5; docs/parity.md, *Notes page*): the chapter she is on, which only she sees and which keeps later
// chapters closed for her. "Automatic" follows her reading in her Library; a choice below it is her own say, and wins in both directions until she picks Automatic again:
// Chapter 1…N, or "I've finished" (every chapter, *The whole book* too). A radio group (APG) in a sheet that scrolls, as the buddy read's "Where are you?"
// (components/together/MarkerSheet.vue): 44 px rows, the chosen one marked by a check and by `aria-checked`, never by colour alone. The write goes through the store
// (`setChapter`) and the page's rows follow at once; a refusal stays in the sheet, worded.
import type { NoteErrorCode, NotesRoom } from '~/data/notes'
import { chapterChoices, currentChapterChoice, noteErrorKey } from '~/utils/notes'
import { useNotesStore } from '~/stores/notes'

const props = defineProps<{ bookId: string; room: NotesRoom }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useNotesStore()
const online = useOnline()

const choices = computed(() => chapterChoices(props.room.chapterCount))
const chosen = computed(() => currentChapterChoice(props.room.me))

const busy = ref<string | null>(null)
const error = ref<NoteErrorCode | null>(null)
const said = ref('')

watch(open, (now) => {
  if (!now) return
  error.value = null
  said.value = ''
})

const label = (c: { kind: 'auto' | 'chapter' | 'finished'; chapter: number | null }) =>
  c.kind === 'auto' ? t('notes.chapterSheet.auto') : c.kind === 'finished' ? t('notes.chapterSheet.finished') : t('notes.chapter', { n: c.chapter })

async function pick(c: { key: string; kind: 'auto' | 'chapter' | 'finished'; chapter: number | null }) {
  if (busy.value || c.key === chosen.value) return
  busy.value = c.key
  error.value = null
  const answer = await store.setChapter(props.bookId, c.chapter, c.kind === 'finished')
  busy.value = null
  if (answer.error) {
    error.value = answer.error
    return
  }
  said.value = t('notes.chapterSheet.saved', { where: label(c) })
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('notes.chapterSheet.title')" :cancel="false" :action="t('notes.done')" testid="notes.chapterSheet" @action="open = false">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <p class="text-subhead text-ink-muted" data-testid="notes.chapterSheet.hint">{{ t('notes.chapterSheet.hint') }}</p>
      <p v-if="room.me.auto.chapter === 0 && !room.me.auto.finished" class="text-footnote text-ink-faint" data-testid="notes.chapterSheet.noAuto">{{ t('notes.chapterSheet.noAuto') }}</p>

      <UiRowGroup>
        <div role="radiogroup" :aria-label="t('notes.chapterSheet.title')">
          <button
            v-for="c in choices"
            :key="c.key"
            type="button"
            role="radio"
            :aria-checked="c.key === chosen"
            :disabled="busy !== null || !online"
            class="flex min-h-(--size-row) w-full items-center gap-ms border-hairline px-inset text-left text-body not-first:border-t not-disabled:active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            :data-testid="`notes.chapterSheet.${c.kind}`"
            :data-choice="c.key"
            @click="pick(c)"
          >
            <span class="min-w-0 flex-1">
              <span class="block">{{ label(c) }}</span>
              <span v-if="c.kind === 'auto'" class="block text-footnote text-ink-faint">{{ t('notes.chapterSheet.autoHint') }}</span>
            </span>
            <UiIcon v-if="c.key === chosen" name="check" :size="18" class="text-accent-ink" />
          </button>
        </div>
      </UiRowGroup>

      <p v-if="!online" class="text-footnote text-ink-faint" data-testid="notes.chapterSheet.offline">{{ t('common.offline') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="notes.chapterSheet.error">{{ t(noteErrorKey(error)) }}</p>
      <p class="sr-only" role="status" data-testid="notes.chapterSheet.status">{{ said }}</p>
    </div>
  </UiSheet>
</template>
