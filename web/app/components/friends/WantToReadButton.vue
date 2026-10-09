<script setup lang="ts">
// The *Want to read* button on a friend's Book (social v2a, contract §3): in the feed, on Home's card and on
// a member's Recently finished rows. A Book that is not in her Library: the button adds it as Want to read
// at once (stores/library.ts, `addWantToRead`: the existing add, so offline it waits in the outbox, once the
// Book is known to the device). A Book she has: the button says where it is (Want to read, Reading, Read, Not
// finished) and opens the Book. Nothing on a Manual book. The friend is not told. The face is
// `wantToReadFace` (utils/wantToRead.ts); the Library store's lists say where the Book is, so the button
// flips by itself when the add lands, wherever else the Book changes.
//
// Props: `book` (SocialBook), `testid`. Test ids: `<testid>` (the button or link), `<testid>.error`.
import type { SocialBook } from '~/data/socialShapes'
import { useBookStore } from '~/stores/book'
import { useLibraryStore } from '~/stores/library'
import { wantToReadFace } from '~/utils/wantToRead'

const props = defineProps<{ book: SocialBook; testid: string }>()

const { t } = useI18n()
const library = useLibraryStore()
const books = useBookStore()
const online = useOnline()

const face = computed(() => wantToReadFace(props.book, library.entryForBook(props.book.id)))
const busy = ref(false)
const failed = ref(false)
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
}

const WHERE = { want_to_read: 'wantToRead', reading: 'reading', finished: 'read', not_finished: 'notFinished' } as const
const where = computed(() => (face.value?.kind === 'in' ? t(`social.state.${WHERE[face.value.where]}`) : ''))
</script>

<template>
  <span v-if="face" class="inline-flex items-center gap-sm">
    <UiButton
      v-if="face.kind === 'add'"
      tone="quiet"
      size="sm"
      :offline="offline"
      :disabled="busy"
      :aria-busy="busy"
      :aria-label="t('social.wantToRead.label', { title: book.title })"
      :data-testid="testid"
      @click="add"
    >
      <UiIcon name="plus" :size="14" />{{ t('social.wantToRead.add') }}
    </UiButton>
    <UiButton
      v-else
      tone="quiet"
      size="sm"
      :to="`/book/${book.id}`"
      :aria-label="t('social.wantToRead.inLabel', { title: book.title, where })"
      :data-testid="testid"
      @click="books.prefetch(book.id)"
    >
      <UiIcon name="check" :size="14" />{{ where }}
    </UiButton>
    <span v-if="failed" class="text-caption text-error" role="alert" :data-testid="`${testid}.error`">{{ t('social.wantToRead.error') }}</span>
  </span>
</template>
