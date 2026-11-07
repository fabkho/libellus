<script setup lang="ts">
// "How many chapters does this book have?" (docs/plans/book-notes.md part 2.2, 5; docs/parity.md, *Notes page*): the one question the Notes page asks while nobody has made the Book's
// chapters. A number field with − and + (1–300, empty at first, the numeric keyboard), **Make N chapters**, and the footnote that the list is shared and can grow. `submit`
// is the page's: it answers a refusal's code or null. Somebody else was first (`chapters_already_set`): the page simply shows their list, so this is gone and no word is said.
// Nothing is sent offline (the button says Offline).
import { CHAPTERS_MAX, type NoteErrorCode } from '~/data/notes'
import { noteErrorKey } from '~/utils/notes'

const props = defineProps<{ submit: (count: number) => Promise<NoteErrorCode | null> }>()

const { t } = useI18n()
const online = useOnline()

const text = ref('')
const busy = ref(false)
const error = ref<NoteErrorCode | null>(null)

/** The number typed, or null while it is empty or not a number in range. */
const count = computed(() => {
  const digits = text.value.replace(/\D/g, '')
  if (!digits) return null
  const n = Number(digits)
  return n >= 1 && n <= CHAPTERS_MAX ? n : null
})
const tooMany = computed(() => /^\d+$/.test(text.value.trim()) && Number(text.value) > CHAPTERS_MAX)

function step(by: number) {
  const next = Math.min(CHAPTERS_MAX, Math.max(1, (count.value ?? 0) + by))
  text.value = String(next)
}

async function make() {
  if (count.value === null || busy.value || !online.value) return
  busy.value = true
  error.value = null
  error.value = await props.submit(count.value)
  busy.value = false
}
</script>

<template>
  <form class="flex flex-col gap-md px-xl pt-lg" novalidate data-testid="notes.count" @submit.prevent="make">
    <h1 class="book-title text-center text-headline text-balance" data-testid="notes.count.title">{{ t('notes.count.title') }}</h1>

    <div class="flex items-end gap-sm">
      <UiRoundButton icon="minus" :label="t('notes.count.less')" :disabled="(count ?? 0) <= 1" data-testid="notes.count.less" @click="step(-1)" />
      <div class="min-w-0 flex-1">
        <UiField
          id="notes-count"
          v-model="text"
          :label="t('notes.count.label')"
          :error="tooMany ? t('notes.error.invalid_count') : null"
          inputmode="numeric"
          pattern="[0-9]*"
          autocomplete="off"
          class="figures"
          data-testid="notes.count.field"
        />
      </div>
      <UiRoundButton icon="plus" :label="t('notes.count.more')" :disabled="(count ?? 0) >= CHAPTERS_MAX" data-testid="notes.count.more" @click="step(1)" />
    </div>

    <UiButton type="submit" block :disabled="count === null || busy" :offline="!online" data-testid="notes.count.make">
      {{ count === null ? t('notes.count.makeNone') : t('notes.count.make', { n: count }, count) }}
    </UiButton>
    <p class="text-center text-footnote text-ink-muted" data-testid="notes.count.shared">{{ t('notes.count.shared') }}</p>
    <p class="text-center text-footnote text-ink-faint" data-testid="notes.count.prologue">{{ t('notes.count.prologue') }}</p>
    <p v-if="error" class="text-center text-footnote text-error" role="alert" data-testid="notes.count.error">{{ t(noteErrorKey(error)) }}</p>
  </form>
</template>
