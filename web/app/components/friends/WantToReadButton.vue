<script setup lang="ts">
// The *Want to read* button on a friend's Book (social v2a, contract §3): in the feed, on Home's card and on
// a member's Recently finished rows. Only there to add: a Book that is not in her Library gets the button, which
// adds it as Want to read at once (stores/library.ts, `addWantToRead`: the existing add, so offline it waits in
// the outbox, once the Book is known to the device). A Book she has, in any list, shows nothing (the feed does
// not repeat what her Library says), and nor does a Manual book. After an add it says *Added* for a moment, then
// goes. The friend is not told. `canWantToRead` (utils/wantToRead.ts) decides; the Library store's lists make it
// go by themselves when the Book arrives, wherever it was added.
//
// Drawn as small clickable text, not a pill, so it sits at the right of a row without making it taller. Props: `book`
// (SocialBook), `testid`. Test ids: `<testid>` (the button), `<testid>.added`, `<testid>.error`.
import type { SocialBook } from '~/data/socialShapes'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { canWantToRead } from '~/utils/wantToRead'

const props = defineProps<{ book: SocialBook; testid: string }>()

const { t } = useI18n()
const library = useLibraryStore()
const books = useBookStore()
const online = useOnline()

const show = computed(() => canWantToRead(props.book, library.entryForBook(props.book.id)))
const busy = ref(false)
const failed = ref(false)
// *Added*, for a moment after the add landed (the button itself is gone by then: the Book is in her Library).
const added = ref(false)
// Offline, an add can wait only for a Book the device already holds (a page it has opened).
const known = () => {
  const held = books.page(props.book.id)?.book
  return held && 'id' in held ? held : null
}
const offline = computed(() => !online.value && !known())

async function add() {
  if (busy.value) return
  busy.value = true
  failed.value = false
  const result = await library.addWantToRead(props.book.id, known())
  busy.value = false
  failed.value = 'error' in result && result.error !== 'already_in_library'
  if ('entry' in result) {
    added.value = true
    setTimeout(() => (added.value = false), 2200)
  }
}
</script>

<template>
  <span v-if="show || added" class="inline-flex shrink-0 items-center" :data-testid="`${testid}.wrap`">
    <button v-if="show && offline" type="button" class="tiny text-ink-faint" disabled :data-testid="testid" data-offline>
      <UiIcon name="offline" :size="12" />{{ t('common.offline') }}
    </button>
    <button
      v-else-if="show"
      type="button"
      class="tiny"
      :class="failed ? 'text-error' : 'text-accent-ink'"
      :disabled="busy"
      :aria-busy="busy"
      :aria-label="t('social.wantToRead.label', { title: book.title })"
      :data-testid="testid"
      @click="add"
    >
      <template v-if="failed"><span role="alert" :data-testid="`${testid}.error`">{{ t('social.wantToRead.error') }}</span></template>
      <template v-else><UiIcon name="plus" :size="12" />{{ t('social.wantToRead.add') }}</template>
    </button>
    <span v-else class="tiny text-ink-faint" role="status" :data-testid="`${testid}.added`"><UiIcon name="check" :size="12" />{{ t('social.wantToRead.added') }}</span>
  </span>
</template>

<style scoped>
/* Clickable text, no pill: it never makes its row taller. The 44 px target is an invisible box centred on it. */
.tiny {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-xs);
  font-size: var(--text-caption, 0.8125rem);
  line-height: 1;
  white-space: nowrap;
  /* 24 px by 24 px at least (WCAG 2.2 target size), pulled back into the row by the margin so the row does not grow. */
  min-width: 24px;
  min-height: 24px;
  margin-block: -6px;
  justify-content: center;
}
.tiny::after {
  position: absolute;
  inset: 50% calc(-1 * var(--spacing-sm)) auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
.tiny:disabled {
  opacity: 0.6;
}
</style>
