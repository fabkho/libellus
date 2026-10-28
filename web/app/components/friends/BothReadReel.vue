<script setup lang="ts">
// "You both read" in 3D: Regal's reel (the layer's RegalBooksReel, docs/plans/shared-books-slideshow.md, D and H)
// in BetterReads' room. The only component of the section that touches Regal: always loaded through
// `LazyFriendsBothReadReel`, so it, Regal, three.js and TresJS are one chunk (`regal`, regal.config.ts) that the
// section fetches only when the loading rules hold (utils/bothReadReel.ts, `reelWanted`), never precached. In a
// build without Regal, or with a Regal that has no reel yet, `regal.config.ts` resolves this file to the empty
// stand-in (app/regal/Absent.vue) and the section never mounts it (`appConfig.regalReel`): the poster stays.
//
// What Regal gets is `bothReadReelDocument` (data/bothReadReel.ts): ids, titles, authors, covers, colours, and
// nothing of hers. The pills and the caption under the Book in front are ours (`#tooltip`: FriendsBothReadCaption,
// from our own `BothRead` by Book id); so is the sheet's content (`#detail-meta`, `#detail-actions`): the Stack's
// on Your shelf, adapted: author · her stars · your stars; Show back / Put back / Open book. No blurb (`both_read`
// has none). A Book tapped breaks out over the page like the row's (inspect="viewport"); the system Back puts it
// back first and never leaves the profile (`useBackDismiss`, as Your shelf's row and the Stack's page).
//
// The Regal side is written against what section H specifies of `RegalBooksReel`, which W3 builds (fabkho/regal):
// events `ready`, `focus`, `manual` (a swipe, a tap or a key took the reel over), `open` (a Book taken out, or
// null when it is put back); slots `#tooltip`, `#detail-meta`, `#detail-actions`; `putAway()` exposed. Every
// place that rests on that is marked `W3:`: check each against the merged component.
//  - `items`    the Books of the reel (reelItems), newest of hers first.
//  - `name`     her name; `card` her member card (her avatar in the pills).
//  - `playing`  the reel plays its one round; false: it rests (the pause button, or after a takeover).
//  - `index`    (v-model) the Book in front.
// Emits `ready` (the first frame is drawn with the covers in view: the poster fades out) and `manual`.
import '#build/nuxt-fonts-global.css'
import '~/assets/css/regal-themed.css'
import { bothReadReelDocument } from '~/data/bothReadReel'
import type { BothRead, MemberCard } from '~/data/socialShapes'
import { bookPathOf } from '~/utils/memberProfile'

const props = defineProps<{ items: readonly BothRead[]; name: string; card: MemberCard | null; playing: boolean }>()
const index = defineModel<number>('index', { default: 0 })
const emit = defineEmits<{ ready: []; manual: [] }>()

const { t } = useI18n()
const library = computed(() => bothReadReelDocument(props.items, { outside: t('book.outsideCatalogue') }))
const byId = computed(() => new Map(props.items.map((item) => [item.book.id, item])))

// W3: `open` says which Book is out (null: put back). The Back below closes it through the reel's own `putAway`.
const picked = ref<string | null>(null)
const reel = ref<{ putAway?: () => void } | null>(null)
useBackDismiss(
  () => picked.value !== null,
  () => reel.value?.putAway?.(),
)
// A Book out is a takeover (a tap is one too): stays manual after the detail closes.
function onOpen(book: { id: string } | null) {
  picked.value = book?.id ?? null
  if (book) emit('manual')
}
// Leaving the page (KeepAlive) puts a Book away; the reel itself rests when it is off screen (Regal).
onDeactivated(() => reel.value?.putAway?.())

/** Open book: the Book goes back at once and its page is pushed with the cross-fade (no cover flight in v1). */
function openBook(item: BothRead, close: () => void) {
  const to = bookPathOf(item.book)
  close()
  if (to) void navigateTo(to)
}
</script>

<template>
  <!-- W3: props as the plan's sketch and H: the document, the Book in front, one round of auto-play (hold 2.4 s, move 0.8 s). -->
  <RegalBooksReel
    ref="reel"
    v-model:index="index"
    class="both-read-reel regal-themed"
    theme="auto"
    inspect="viewport"
    intro="none"
    :library="library"
    :autoplay="{ hold: 2400, move: 800 }"
    :paused="!playing"
    :rounds="1"
    :label="t('member.bothReadLabel', { name })"
    :accessible-list="false"
    :back-button="false"
    @ready="emit('ready')"
    @manual="emit('manual')"
    @open="onOpen"
  >
    <template #tooltip="{ book }">
      <FriendsBothReadCaption v-if="byId.get(book.id)" :item="byId.get(book.id)!" :card="card" :name="name" />
    </template>
    <template #detail-meta="{ book }">
      <p v-if="byId.get(book.id)" class="eyebrow flex flex-wrap items-center gap-x-sm gap-y-xs" data-testid="member.bothRead.detailMeta">
        <span v-if="book.authors.length">{{ book.authors.join(', ') }}</span>
        <span
          v-if="byId.get(book.id)!.hers.rating"
          class="flex items-center gap-xs"
          role="img"
          :aria-label="t('member.bothReadHers', { name, rating: ratingText(byId.get(book.id)!.hers.rating) })"
        >
          <span aria-hidden="true">{{ name }}</span>
          <UiStars aria-hidden="true" :quarters="byId.get(book.id)!.hers.rating" size="sm" :show-value="false" />
        </span>
        <span
          v-if="byId.get(book.id)!.mine.rating"
          class="flex items-center gap-xs"
          role="img"
          :aria-label="t('member.bothReadMine', { rating: ratingText(byId.get(book.id)!.mine.rating) })"
        >
          <span aria-hidden="true">{{ t('member.bothReadYou') }}</span>
          <UiStars aria-hidden="true" :quarters="byId.get(book.id)!.mine.rating" size="sm" :show-value="false" />
        </span>
      </p>
    </template>
    <template #detail-actions="{ book, close, flip, face }">
      <UiButton tone="secondary" size="sm" data-testid="member.bothRead.flip" @click="flip">
        {{ face === 'front' ? t('shelf.detail.showBack') : t('shelf.detail.showFront') }}
      </UiButton>
      <UiButton tone="secondary" size="sm" data-testid="member.bothRead.putBack" @click="close">{{ t('shelf.detail.putBack') }}</UiButton>
      <UiButton
        v-if="byId.get(book.id) && bookPathOf(byId.get(book.id)!.book)"
        tone="plain"
        size="sm"
        class="ml-auto"
        data-testid="member.bothRead.openBook"
        @click="openBook(byId.get(book.id)!, close)"
      >
        {{ t('member.bothReadOpen') }}
      </UiButton>
    </template>
  </RegalBooksReel>
</template>

<style scoped>
/* It fills the box the section gives it. Doubled class: Regal's own rule for its root (a minimum height) is as
   specific and may load later. A Book broken out is drawn over the whole screen, above the header and the tab bar
   (z 20), the search and a cover's flight, under the barcode scanner (80): as Your shelf's row. */
.both-read-reel.both-read-reel {
  position: absolute;
  inset: 0;
  min-height: 0;
  --regal-row-z-index: var(--shelf-row-z, 50);
}
</style>
