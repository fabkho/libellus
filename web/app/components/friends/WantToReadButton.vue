<script setup lang="ts">
// The *Want to read* button on a friend's Book (social v2a, contract §3): in the feed, on Home's card and on
// a member's Recently finished rows. Only there to add: a Book that is not in her Library gets the button, which
// adds it as Want to read at once (stores/library.ts, `addWantToRead`: the existing add, so offline it waits in
// the outbox, once the Book is known to the device). A Book she has, in any list, shows nothing (the feed does
// not repeat what her Library says), and nor does a Manual book. After an add it says *Added* for a moment (and says "Added to Want to read" to a screen reader), then
// goes; the live region that says it (`role=status`) is mounted from the start, so screen readers announce it, and
// `added` is emitted so the row can move focus off the button that is going (to the heart, else the title). The friend is not told. `canWantToRead` (utils/wantToRead.ts) decides; the Library store's lists make it
// go by themselves when the Book arrives, wherever it was added.
//
// Drawn as small clickable text, not a pill (the `tiny-action` utility), so it sits on a row's line without making it
// taller. Busy and Offline are `aria-disabled`, not `disabled`: focus stays. A refusal is a `role=alert` beside the
// button, not inside it (the button's name would hide it). Props: `book` (SocialBook), `testid`. Emits `added`.
// Test ids: `<testid>` (the button), `<testid>.added`, `<testid>.error`.
import type { SocialBook } from '~/data/socialShapes'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { canWantToRead } from '~/utils/wantToRead'

const props = defineProps<{ book: SocialBook; testid: string }>()
const emit = defineEmits<{ added: [] }>()

const { t } = useI18n()
const library = useLibraryStore()
const books = useBookStore()
const online = useOnline()

const show = computed(() => canWantToRead(props.book, library.entryForBook(props.book.id)))
const busy = ref(false)
const failed = ref(false)
// *Added to Want to read*, for a moment after the add landed (the button itself is gone by then: the Book is in her Library).
const added = ref(false)
let hide: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(hide))
// Offline, an add can wait only for a Book the device already holds (a page it has opened).
const known = () => {
  const held = books.page(props.book.id)?.book
  return held && 'id' in held ? held : null
}
const offline = computed(() => !online.value && !known())

async function add() {
  if (busy.value || offline.value) return
  busy.value = true
  failed.value = false
  const result = await library.addWantToRead(props.book.id, known())
  busy.value = false
  failed.value = 'error' in result && result.error !== 'already_in_library'
  if ('entry' in result) {
    added.value = true
    clearTimeout(hide)
    hide = setTimeout(() => (added.value = false), 2200)
    emit('added')
  }
}
</script>

<template>
  <button
    v-if="show"
    type="button"
    class="tiny-action"
    :class="offline ? 'text-ink-faint' : 'text-accent-ink'"
    :aria-disabled="busy || offline"
    :aria-busy="busy"
    :aria-label="t('social.wantToRead.label', { title: book.title })"
    :data-testid="testid"
    @click="add"
  >
    <UiIcon :name="offline ? 'offline' : 'plus'" :size="12" />{{ offline ? t('common.offline') : t('social.wantToRead.add') }}
  </button>
  <span v-else-if="added" class="tiny-action text-ink-faint" aria-hidden="true" :data-testid="`${testid}.added`"><UiIcon name="check" :size="12" />{{ t('social.wantToRead.addedShort') }}</span>
  <span v-if="failed && show" class="text-caption text-error" role="alert" :data-testid="`${testid}.error`">{{ t('social.wantToRead.error') }}</span>
  <!-- Mounted from the start, so a screen reader announces what lands in it (a region that arrives with its text is skipped). -->
  <span class="sr-only" role="status" aria-live="polite">{{ added ? t('social.wantToRead.added') : '' }}</span>
</template>
