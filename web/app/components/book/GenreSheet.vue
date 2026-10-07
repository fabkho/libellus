<script setup lang="ts">
// Set or correct a Book's genres (issue #168): the canonical list as pills, up to three (the
// rest step back once there are three), saved with the sheet's action. They are hers for this
// entry; "Back to suggested" takes her choice back and the computed genres return. Both
// need the connection: offline the action says Offline (docs/ACCESSIBILITY.md, a polite status
// says how many are chosen). A failure stays in the sheet and Save tries again.
import type { LibraryEntry } from '~/data/library'
import { GENRES, MAX_GENRES, type GenreId } from '~/data/enrich/genres'
import { useGenresStore } from '~/stores/genres'

const props = defineProps<{ entry: LibraryEntry }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const genres = useGenresStore()
const online = useOnline()

const draft = ref<GenreId[]>([])
const busy = ref<'save' | 'reset' | null>(null)
const failed = ref(false)
const hers = computed(() => genres.overridden(props.entry.book.id))

// Opened: starts from the genres the Book has now.
watch(open, (isOpen) => {
  if (!isOpen) return
  draft.value = [...(genres.lookup(props.entry.book.id) ?? [])]
  failed.value = false
})

const full = computed(() => draft.value.length >= MAX_GENRES)
function toggle(id: GenreId) {
  failed.value = false
  draft.value = draft.value.includes(id) ? draft.value.filter((g) => g !== id) : full.value ? draft.value : [...draft.value, id]
}

async function finish(run: () => Promise<string | null>, kind: 'save' | 'reset') {
  if (busy.value) return
  busy.value = kind
  failed.value = false
  try {
    if ((await run()) === null) open.value = false
    else failed.value = true
  } finally {
    busy.value = null
  }
}
const save = () => finish(() => genres.set({ id: props.entry.id, bookId: props.entry.book.id }, draft.value), 'save')
const reset = () => finish(() => genres.reset({ id: props.entry.id, bookId: props.entry.book.id }), 'reset')

const action = computed(() => (!online.value ? t('common.offline') : busy.value === 'save' ? t('genre.sheet.saving') : failed.value ? t('genre.sheet.retry') : t('genre.sheet.save')))
const groupId = useId()
</script>

<template>
  <UiSheet v-model:open="open" :title="t('genre.sheet.title')" :action="action" :action-disabled="!online || busy !== null" testid="genreSheet" @action="save">
    <div class="flex flex-col gap-md pb-sm">
      <div class="flex min-h-(--size-button-sm) items-baseline justify-between gap-md">
        <p :id="groupId" class="text-caption text-ink-muted">{{ t('genre.sheet.hint') }}</p>
        <p class="figures shrink-0 text-caption text-ink-muted" role="status" data-testid="genreSheet.count">
          {{ t('genre.sheet.chosen', { count: draft.length, max: MAX_GENRES }) }}
        </p>
      </div>

      <div role="group" :aria-labelledby="groupId" class="flex flex-wrap gap-sm">
        <UiPill
          v-for="genre in GENRES"
          :key="genre.id"
          :pressed="draft.includes(genre.id)"
          :disabled="full && !draft.includes(genre.id)"
          class="disabled:opacity-50"
          :data-testid="`genreSheet.genre.${genre.id}`"
          @click="toggle(genre.id)"
        >
          {{ t(`genre.${genre.id}`) }}
        </UiPill>
      </div>

      <p v-if="failed" class="text-subhead text-error" role="alert" data-testid="genreSheet.error">{{ t('genre.sheet.error') }}</p>

      <!-- Always there, so the sheet does not change height; only usable while the choice is hers. -->
      <div class="flex h-(--size-button-md) items-center" :class="!hers && 'invisible'" :inert="!hers">
        <UiButton tone="plain" size="md" :disabled="!online || busy !== null" data-testid="genreSheet.reset" @click="reset">
          {{ busy === 'reset' ? t('genre.sheet.resetting') : t('genre.sheet.reset') }}
        </UiButton>
      </div>
    </div>
  </UiSheet>
</template>
