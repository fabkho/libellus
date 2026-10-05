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
// onto D's tokens below, so it wears the room it stands in. It fills the box
// it is put in (a positioned one).
import '#build/nuxt-fonts-global.css'

const props = defineProps<{
  /** Only the Books finished in this year; null for all of them. */
  year?: number | null
}>()
const emit = defineEmits<{
  /** The Library is in and the Stack is drawing it (or Regal is showing why it can't). */
  ready: []
}>()

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
  <RegalBooksStage class="shelf-stage" />
</template>

<style scoped>
/* It fills the box its page gives it. Doubled class: Regal's own rule for its
   root (position, a minimum height) is as specific and may load later. */
.shelf-stage.shelf-stage {
  position: absolute;
  inset: 0;
  min-height: 0;
}

/* Regal's components read paper-ink token names with fallbacks (its README,
   Styling): the ones D also has (ink, its muted and faint, the accent, the mono
   and serif families) are D's already; the rest are mapped here. */
.shelf-stage {
  --color-bg: var(--color-surface);
  --color-line: var(--color-hairline);
  --color-ink-subtle: var(--color-ink-muted);
  --color-accent-tint: var(--color-accent-soft);
  --color-accent-light: var(--color-accent);
  --font-display: var(--font-serif);
  --text-2xs: var(--text-eyebrow);
  --text-xs: var(--text-meta);
  --text-sm: var(--text-footnote);
  --text-base: var(--text-caption);
  --text-md: var(--text-subhead);
  --text-xl: var(--text-callout);
}
</style>
