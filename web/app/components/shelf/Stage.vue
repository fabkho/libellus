<script setup lang="ts">
// Regal's 3D Stack (the layer's RegalBooksStage, #23) in Libellus' night room.
// The only component that touches Regal: always loaded through
// `LazyShelfStage`, so it, Regal, three.js and TresJS are one chunk (`regal`,
// regal.config.ts) that only the shelf's places ever fetch, and the service
// worker never precaches. It brings Regal's fonts with it: their @font-face
// rules are moved out of the app's entry stylesheet into this chunk's.
//
// `year` stacks only the Books finished that year, by date with a separator
// per month (Regal's Stack view, which keeps it in the address too); without
// one the whole Library, a separator per year. Regal's own copy and controls
// are its own (the card over a picked Book); its colours and type are mapped
// onto D's tokens (`regal-themed`, assets/css/regal-themed.css), so it wears the
// room it stands in. It fills the box
// it is put in (a positioned one).
import '#build/nuxt-fonts-global.css'
// Libellus' look for Regal's tooltip and Book detail panel: the `regal-themed` class
// (with `theme="auto"`), in a stylesheet of its own so it travels with the regal chunk.
import '~/assets/css/regal-themed.css'

const props = defineProps<{
  /** Only the Books finished in this year; null for all of them. */
  year?: number | null
}>()
const emit = defineEmits<{
  /** The Library is in and the Stack is drawing it (or Regal is showing why it can't). */
  ready: []
}>()

const { t } = useI18n()

/** The Book's Goodreads page (its Id is numeric), or a search for it: what Regal's own link does. */
function goodreadsUrl(book: { id: string; isbn13: string | null; title: string; author: string | null }) {
  if (/^\d+$/.test(book.id)) return `https://www.goodreads.com/book/show/${book.id}`
  const query = book.isbn13 ?? [book.title, book.author].filter(Boolean).join(' ')
  return `https://www.goodreads.com/search?q=${encodeURIComponent(query)}`
}

const { set } = useStackView()
const showYear = (year: number | null) => set({ sort: 'date', minRating: 0, year, group: year ? 'month' : 'year' })
showYear(props.year ?? null)
watch(
  () => props.year ?? null,
  (year) => showYear(year),
)

const { books, error } = useLibrary()
const { pickedId, putAway } = useBookPick()
let told = false
watch(
  [books, error],
  () => {
    if (told || (!books.value.length && !error.value)) return
    told = true
    // A frame for the canvas to take its size and draw the first Spines.
    requestAnimationFrame(() => emit('ready'))
  },
  { immediate: true, flush: 'post' },
)

defineExpose({
  /** Whether a Book is out of the Stack. */
  picked: computed(() => pickedId.value !== null),
  /** Puts the Book that is out back (the page's Back does that first). */
  putAway,
})
</script>

<template>
  <RegalBooksStage class="shelf-stage regal-themed" theme="auto">
    <!-- Regal's panel takes D's tokens (regal-themed.css); two parts of it are D's own components, which no
         token can make: the meta line in the eyebrow's mono, and the actions as D's pills. Regal keeps the
         frame, the sheet and the Book's own controls (a drag, a click, Escape). Regal main, without these
         slots, ignores them and shows its own. -->
    <template #detail-meta="{ meta }">
      <p class="eyebrow" data-testid="shelf.detailMeta">{{ meta.join(' · ') }}</p>
    </template>
    <template #detail-actions="{ book, close, flip, face }">
      <UiButton tone="secondary" size="sm" data-testid="shelf.flip" @click="flip">
        {{ face === 'front' ? t('shelf.detail.showBack') : t('shelf.detail.showFront') }}
      </UiButton>
      <UiButton tone="secondary" size="sm" data-testid="shelf.putBack" @click="close">{{ t('shelf.detail.putBack') }}</UiButton>
      <UiButton tone="plain" size="sm" class="ml-auto" :to="goodreadsUrl(book)" target="_blank" rel="noopener" data-testid="shelf.goodreads">
        {{ t('shelf.detail.goodreads') }}
      </UiButton>
    </template>
  </RegalBooksStage>
</template>

<style scoped>
/* It fills the box its page gives it. Doubled class: Regal's own rule for its
   root (position, a minimum height) is as specific and may load later. */
.shelf-stage.shelf-stage {
  position: absolute;
  inset: 0;
  min-height: 0;
}
</style>
