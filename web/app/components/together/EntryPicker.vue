<script setup lang="ts">
// "Which copy are you reading?" (W3): the step after joining (and what a member does later from the room): which of her Library entries her
// Section follows. A buddy read is of a Book; her copy may be another edition of it, a paperback, an ebook, and it is that entry's progress
// that moves her Section (the database works it out; the other members see the Section only). The choices are her entries of the very Book,
// then those whose title is the same (the database decides whether it is the same work and says `buddy_entry_invalid` if not), then "I'm not
// tracking it here": her Section is set by hand in the room. A Book that is not in her Library at all says so and offers its page.
//
// A radio group of native radios (APG: arrows move, one Tab stop; a row is its label, 44 px). Nothing is saved until Save; Skip leaves the Section
// unset. Props: `readId`, `book` (the read's Book, as the link card carries it). Emits `done` once an answer is in (saved, or skipped). Test ids:
// `buddyCopy` (+ `.option.<entry id>`, `.none`, `.save`, `.skip`, `.error`, `.book`).
import type { BuddyErrorCode } from '~/data/buddyReads'
import type { SocialBook } from '~/data/socialShapes'
import { normaliseTitle } from '~/data/titleMatch'
import { formatOf } from '~/data/books'
import { pageCountOf } from '~/data/progress'
import { useBuddyReadStore } from '~/stores/buddyRead'
import { useLibraryStore } from '~/stores/library'
import { buddyErrorKey } from '~/utils/buddyRead'
import { entryChoices } from '~/utils/buddySetup'
import { bookPathOf } from '~/utils/memberProfile'

const props = defineProps<{ readId: string; book: SocialBook }>()
const emit = defineEmits<{ done: [] }>()

const { t } = useI18n()
const store = useBuddyReadStore()
const library = useLibraryStore()
const online = useOnline()

// The Library is read when she has not opened it yet (she may come straight from a link): the choices wait for it.
onMounted(() => void library.load({ ifStale: true }))

const entries = computed(() => [...library.lists.reading, ...library.lists.want_to_read, ...library.lists.finished])
const choices = computed(() =>
  entryChoices(
    entries.value.map((e) => ({ id: e.id, bookId: e.book.id, title: e.book.title, authors: e.book.authors, entry: e })),
    props.book,
    (a, b) => normaliseTitle(a) === normaliseTitle(b),
  ),
)
const options = computed(() => [...choices.value.exact, ...choices.value.similar].map((c) => c.entry))
const bookPath = computed(() => bookPathOf(props.book))

/** The entry chosen, or 'none': the one entry she has of the Book is chosen already. */
const chosen = ref<string>('')
watch(
  options,
  (list) => {
    if (chosen.value) return
    // Nothing to choose from is only known once the Library has been read.
    if (!list.length && !library.loaded) return
    const exact = choices.value.exact
    chosen.value = exact.length === 1 ? exact[0]!.id : list.length === 0 ? 'none' : ''
  },
  { immediate: true },
)
watch(
  () => library.loaded,
  () => (options.value.length || chosen.value ? null : (chosen.value = 'none')),
)

const busy = ref(false)
const error = ref<BuddyErrorCode | null>(null)

async function save() {
  if (busy.value || !chosen.value) return
  if (chosen.value === 'none') return emit('done')
  busy.value = true
  error.value = null
  const answer = await store.linkEntry(props.readId, chosen.value)
  busy.value = false
  if (answer.error) {
    error.value = answer.error
    return
  }
  emit('done')
}

function describe(entry: (typeof options.value)[number]): string {
  const format = formatOf(entry.book, entry.formatOverride)
  const pages = pageCountOf(entry)
  return [t(`status.${entry.status}`), format ? t(`book.format.${format}`) : null, pages ? t('together.copy.pages', { count: pages }, pages) : null].filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="flex flex-col gap-md" data-testid="buddyCopy">
    <fieldset class="flex flex-col gap-xs">
      <legend class="book-title text-title">{{ t('together.copy.title') }}</legend>
      <p class="pt-xs pb-sm text-subhead text-ink-muted">{{ options.length ? t('together.copy.text') : t('together.copy.noneInLibrary') }}</p>

      <label
        v-for="entry in options"
        :key="entry.id"
        class="relative flex min-h-(--size-row) cursor-pointer items-center gap-ms rounded-md px-ms py-xs edge-faint has-checked:bg-fill has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-ink"
      >
        <input v-model="chosen" type="radio" name="buddy-copy" :value="entry.id" class="peer size-(--size-checkbox) shrink-0 accent-accent" :data-testid="`buddyCopy.option.${entry.id}`" />
        <span class="flex min-w-0 flex-col">
          <span class="book-title title-wrap text-callout">{{ entry.book.title }}</span>
          <span class="text-caption text-ink-muted">{{ describe(entry) }}</span>
        </span>
      </label>

      <label class="relative flex min-h-(--size-row) cursor-pointer items-center gap-ms rounded-md px-ms py-xs edge-faint has-checked:bg-fill has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent-ink">
        <input v-model="chosen" type="radio" name="buddy-copy" value="none" class="peer size-(--size-checkbox) shrink-0 accent-accent" data-testid="buddyCopy.none" />
        <span class="flex min-w-0 flex-col">
          <span class="text-body">{{ t('together.copy.none') }}</span>
          <span class="text-caption text-ink-muted">{{ t('together.copy.noneText') }}</span>
        </span>
      </label>
    </fieldset>

    <UiButton v-if="!options.length && bookPath" tone="secondary" size="md" :to="bookPath" data-testid="buddyCopy.book">{{ t('together.copy.openBook') }}</UiButton>
    <p v-if="error" class="text-caption text-error" role="alert" data-testid="buddyCopy.error">{{ t(buddyErrorKey(error)) }}</p>
    <UiButton block :disabled="busy || !chosen" :offline="!online && chosen !== 'none'" :aria-busy="busy" data-testid="buddyCopy.save" @click="save">{{ t('together.copy.save') }}</UiButton>
    <UiButton v-if="options.length" tone="plain" block :disabled="busy" data-testid="buddyCopy.skip" @click="emit('done')">{{ t('together.copy.skip') }}</UiButton>
  </div>
</template>
