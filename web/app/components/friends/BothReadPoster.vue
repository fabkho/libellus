<script setup lang="ts">
// "You both read" at rest (docs/plans/shared-books-slideshow.md, B and H): the reel's pose drawn flat with the app's
// own covers: the Book in front, two each side a little smaller, her pill and yours, the title and the dots. It is
// what shows at once (the thumbhashes first), under the 3D until that has its first frame, and for good where the 3D
// never comes: Reduce Motion, no WebGL, Save-Data, offline before the chunk, a build without Regal, one Book.
// Nothing here moves on its own; a neighbour tapped comes to the front (a button, so the keyboard and a screen
// reader reach it), the Book in front opens its page like a cover in any row (a Manual book or an unverified one
// opens nothing). The text list below the section says the same in words; the covers here are the picture.
//  - `items`  the Books to show (the section's, newest of hers first, at most the reel's).
//  - `index`  (v-model) the Book in front.
//  - `name`   her name; `card` her member card, for her avatar.
// Test ids: `member.bothRead.poster`, `member.bothRead.book` (the front), `member.bothRead.neighbour`.
import type { BothRead, MemberCard } from '~/data/socialShapes'
import { posterSlot } from '~/utils/bothReadReel'

const props = defineProps<{ items: readonly BothRead[]; name: string; card: MemberCard | null }>()
const index = defineModel<number>('index', { default: 0 })
const { t } = useI18n()

/** The Books drawn: two each side of the one in front, with the slot each takes. */
const drawn = computed(() =>
  props.items.flatMap((item, i) => {
    const slot = posterSlot(i - index.value)
    return slot ? [{ item, i, slot, shown: shownBook(item.book, t('book.outsideCatalogue')) }] : []
  }),
)
const front = computed(() => props.items[index.value] ?? props.items[0]!)
</script>

<template>
  <div class="flex flex-col items-center gap-md" data-testid="member.bothRead.poster">
    <ul class="stage relative w-full" :aria-label="t('member.bothReadLabel', { name })">
      <li
        v-for="entry in drawn"
        :key="entry.item.book.id"
        class="slot absolute top-0 left-1/2"
        :style="{ '--x': entry.slot.x, '--s': entry.slot.scale, '--o': entry.slot.opacity, zIndex: 3 - Math.abs(entry.i - index) }"
      >
        <FriendsMemberBookLink
          v-if="entry.i === index"
          :book="entry.item.book"
          class="cover-link block rounded-cover"
          :aria-label="entry.shown.title"
          data-testid="member.bothRead.book"
        >
          <UiCover
            :title="entry.shown.title"
            :authors="entry.shown.authors"
            :src="coverSrc(entry.shown.coverUrl, 'xl')"
            :thumbhash="entry.shown.coverThumbhash"
            :colors="entry.shown.coverColors"
            size="xl"
            decorative
          />
        </FriendsMemberBookLink>
        <button
          v-else
          type="button"
          class="cover-link block rounded-cover"
          :aria-label="t('member.bothReadSlide', { n: entry.i + 1, count: items.length }) + ': ' + entry.shown.title"
          data-testid="member.bothRead.neighbour"
          @click="index = entry.i"
        >
          <UiCover
            :title="entry.shown.title"
            :authors="entry.shown.authors"
            :src="coverSrc(entry.shown.coverUrl, 'lg')"
            :thumbhash="entry.shown.coverThumbhash"
            :colors="entry.shown.coverColors"
            size="xl"
            decorative
          />
        </button>
      </li>
    </ul>

    <FriendsBothReadCaption :item="front" :card="card" :name="name" />

    <!-- Where in the row the front Book is; the words are the list's and the live line's. -->
    <div v-if="items.length > 1" class="flex items-center justify-center gap-xs" aria-hidden="true">
      <span v-for="(_, i) in items" :key="i" class="size-(--spacing-sm) rounded-pill" :class="i === index ? 'bg-ink' : 'bg-ink-ghost'" />
    </div>
    <p class="sr-only" aria-live="polite">{{ t('member.bothReadSlide', { n: index + 1, count: items.length }) }}</p>
  </div>
</template>

<style scoped>
/* The stage is as tall as the front cover (2:3) with room for its shadow; every slot is placed from the middle by
   `--x` (in front-cover widths), scaled by `--s`, dimmed by `--o`: the reel's pose at rest. */
.stage {
  height: calc(var(--size-cover-xl) * 1.5 + var(--spacing-md));
  padding-top: var(--spacing-xs);
}
.slot {
  transform: translateX(-50%) translateX(calc(var(--size-cover-xl) * var(--x))) scale(var(--s));
  opacity: var(--o);
  transition:
    transform var(--duration-standard) var(--ease-standard),
    opacity var(--duration-standard) var(--ease-standard);
}
.cover-link:active {
  opacity: 0.8;
}
@media (prefers-reduced-motion: reduce) {
  .slot {
    transition: none;
  }
}
</style>
