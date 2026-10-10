<script setup lang="ts">
// *Want to read* on a friend's Book (social v2a, contract §3; the owner's layout B): an icon in the column at the
// row's right edge (FriendsRowActions), above the heart. Three things it can be (`wantState`, utils/wantToRead.ts):
//  - a Book that is not in her Library: a bookmark with a plus, which adds it as Want to read at once
//    (stores/library.ts, `addWantToRead`: the existing add, so offline it waits in the outbox, once the Book is
//    known to the device). Offline, with a Book the device does not hold: the same icon, faint, `aria-disabled`
//    (the name says "Offline");
//  - a Book she has, in any list: a filled bookmark, quiet, which opens the Book (a link), named with where it
//    stands: "On your Want to read", "Reading", "Read", "Not finished" (the existing strings);
//  - nothing for a Manual book, or one the check could not confirm.
// After an add the control becomes the filled bookmark (the Library store's lists have the Book) and focus goes to it;
// a live region (`role=status`, mounted from the start so it is announced) says "Added to Want to read". The friend is
// not told. A refusal turns the icon to the error colour and is said as a `role=alert` (the icon is the whole control
// here; tapping again tries again). Busy and Offline are `aria-disabled`, not `disabled`: focus stays.
// Props: `book` (SocialBook), `testid`. Test ids: `<testid>` (the button, or the link when she has the Book),
// `<testid>.error`.
import type { SocialBook } from '~/data/socialShapes'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { wantState } from '~/utils/wantToRead'

const props = defineProps<{ book: SocialBook; testid: string }>()

const { t } = useI18n()
const library = useLibraryStore()
const books = useBookStore()
const online = useOnline()

const state = computed(() => wantState(props.book, library.entryForBook(props.book.id)))
const busy = ref(false)
const failed = ref(false)
// *Added to Want to read*, said once to a screen reader after the add landed.
const said = ref(false)
let hide: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(hide))
// The control: the button, or (a component) the link, whose element is `$el`.
const control = ref<HTMLElement | { $el: HTMLElement } | null>(null)
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
    said.value = true
    clearTimeout(hide)
    hide = setTimeout(() => (said.value = false), 2200)
    // The button is a link now: focus goes with it.
    await nextTick()
    const c = control.value
    ;(c && '$el' in c ? c.$el : c)?.focus()
  }
}
</script>

<template>
  <button
    v-if="state?.kind === 'add'"
    ref="control"
    type="button"
    class="icon-action"
    :class="failed ? 'text-error' : offline ? 'text-ink-faint' : 'text-accent-ink'"
    :aria-disabled="busy || offline"
    :aria-busy="busy"
    :data-testid="testid"
    @click="add"
  >
    <UiIcon name="bookmarkPlus" :size="18" />
    <span class="sr-only">{{ t('social.wantToRead.label', { title: book.title }) }}<template v-if="offline">. {{ t('common.offline') }}</template></span>
  </button>
  <UiPressLink
    v-else-if="state?.kind === 'have'"
    ref="control"
    :to="`/book/${book.id}`"
    class="icon-action text-ink-faint"
    :data-testid="testid"
    @press="books.prefetch(book.id)"
  >
    <UiIcon name="bookmark" :size="18" class="fill-current" />
    <span class="sr-only">{{ t('social.wantToRead.inLabel', { title: book.title, where: t(`social.state.${state.where}`) }) }}</span>
  </UiPressLink>
  <span v-if="failed && state?.kind === 'add'" class="sr-only" role="alert" :data-testid="`${testid}.error`">{{ t('social.wantToRead.error') }}</span>
  <!-- Mounted from the start, so a screen reader announces what lands in it (a region that arrives with its text is skipped). -->
  <span class="sr-only" role="status" aria-live="polite">{{ said ? t('social.wantToRead.added') : '' }}</span>
</template>
