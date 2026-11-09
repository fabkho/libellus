<script setup lang="ts">
// "Who can see this" (docs/plans/book-notes.md part 2.3.3; docs/parity.md, *Notes, visibility*): the audience of her own note, changed after she wrote it, from the note's action
// bar. A small sheet she opens herself with the three levels as a radio group (APG), the current one checked. **Narrowing applies at once** (the replies wider than the new level
// are narrowed with it, the thread is read again); **Everyone** shows the one quiet line ("Visible to all members of BetterReads, with your name and photo. Just this note.") and
// waits for **Make visible to everyone**. Everyone is offered only while the owner's switch is on. A refusal (a reply cannot be wider than the note it answers) stays in the sheet, worded.
// **A voice note** (`voice`) is only ever Only me (docs/parity.md, *Notes, a chapter*): the sheet shows that one level, checked, and one line why; there is nothing to widen to (the database refuses it too,
// `voice_private_only`).
import type { NoteErrorCode } from '~/data/notes'
import { offeredLevels, type NoteLevel } from '~/utils/noteVisibility'
import { noteErrorKey } from '~/utils/notes'
import { useNotesStore } from '~/stores/notes'

const props = defineProps<{ roomId: string; sectionId: string; noteId: string | null; visibility: NoteLevel; voice?: boolean }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useNotesStore()
const online = useOnline()

const levels = computed<NoteLevel[]>(() => (props.voice ? ['private'] : offeredLevels(store.publicEnabled)))
/** What she has picked and not confirmed: only Everyone waits for a second tap. */
const choosing = ref<NoteLevel | null>(null)
const busy = ref(false)
const error = ref<NoteErrorCode | null>(null)
const said = ref('')

watch(open, (now) => {
  if (!now) return
  choosing.value = null
  busy.value = false
  error.value = null
  said.value = ''
})

const shown = computed(() => choosing.value ?? props.visibility)

async function apply(level: NoteLevel) {
  if (!props.noteId || busy.value) return
  busy.value = true
  error.value = null
  const failed = await store.setVisibility(props.roomId, props.sectionId, props.noteId, level)
  busy.value = false
  if (failed) {
    error.value = failed
    return
  }
  choosing.value = null
  said.value = t('notes.visibilitySheet.saved', { level: t(`notes.level.${level}`) })
  open.value = false
}

function pick(level: NoteLevel) {
  if (busy.value || level === props.visibility) return
  error.value = null
  // Narrowing is immediate (so is widening to Friends); Everyone asks once more, under its line.
  if (level === 'public') choosing.value = level
  else void apply(level)
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('notes.visibilitySheet.title')" :cancel="false" :action="t('notes.done')" testid="notes.visibilitySheet" @action="open = false">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <UiRowGroup>
        <div role="radiogroup" :aria-label="t('notes.visibilitySheet.title')">
          <button
            v-for="level in levels"
            :key="level"
            type="button"
            role="radio"
            :aria-checked="level === shown"
            :disabled="busy || !online"
            class="flex min-h-(--size-row) w-full items-center gap-ms border-hairline px-inset text-left text-body not-first:border-t not-disabled:active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
            :data-testid="`notes.visibilitySheet.${level}`"
            @click="pick(level)"
          >
            <span class="min-w-0 flex-1">
              <span class="block">{{ t(`notes.level.${level}`) }}</span>
              <span class="block text-footnote text-ink-faint">{{ t(`notes.level.${level}Hint`) }}</span>
            </span>
            <UiIcon v-if="level === shown" name="check" :size="18" class="text-accent-ink" />
          </button>
        </div>
      </UiRowGroup>

      <p v-if="voice" class="text-footnote text-ink-muted" data-testid="notes.visibilitySheet.voiceOnly">{{ t('notes.visibilitySheet.voiceOnly') }}</p>

      <template v-if="choosing === 'public'">
        <p class="text-footnote text-ink-muted" data-testid="notes.visibilitySheet.notice">{{ t('notes.level.publicNotice') }}</p>
        <UiButton block :disabled="busy" :offline="!online" data-testid="notes.visibilitySheet.confirm" @click="apply('public')">{{ t('notes.visibilitySheet.makePublic') }}</UiButton>
      </template>

      <p v-if="!online" class="text-footnote text-ink-faint" data-testid="notes.visibilitySheet.offline">{{ t('common.offline') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="notes.visibilitySheet.error">{{ t(noteErrorKey(error)) }}</p>
      <p class="sr-only" role="status" data-testid="notes.visibilitySheet.status">{{ said }}</p>
    </div>
  </UiSheet>
</template>
