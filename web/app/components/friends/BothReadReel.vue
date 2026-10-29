<script setup lang="ts">
// "You both read" through Regal: the layer's RegalBooksReel (docs/plans/shared-books-slideshow.md, D and H; Regal's
// docs/nuxt-layer.md, RegalBooksReel) in BetterReads' room, or, for the fallbacks, RegalBooksReelStill (the same first
// frame, no canvas). The only component of the section that touches Regal: always loaded through
// `LazyFriendsBothReadReel`, so it, Regal, three.js and TresJS are one chunk (`regal`, regal.config.ts) that the
// section fetches only when it is near the screen, never precached. In a build without Regal, `regal.config.ts`
// resolves this file to the empty stand-in (app/regal/Absent.vue) and the section never mounts it.
//
// NOTHING of ours is drawn over or under the reel while it loads. The reel draws its own first frame (the Books at the
// places, turns and sizes the canvas will draw, the pills and caption of the Book in front, from our `#tooltip`), then
// the canvas takes over in place and the intro plays: there is no poster, skeleton or other composition of ours to
// take down, and nothing here waits for `ready`. `still` is for the fallbacks where the live reel is not mounted
// (no WebGL, Reduce Motion, Save-Data, an error): the same first frame as a still, tappable through its caption.
//
// What Regal gets is `bothReadReelDocument` (data/bothReadReel.ts): ids, titles, authors, absolute cover URLs
// (`assets.front`, a small `pile.front`), the Book's colour as the tone under a cover that is not in yet, and
// nothing of hers. It must be a STABLE object (a new one is another Library: the reel starts over), so it is held
// by the section until the Books really change (`sameReelBooks`). The pills and the caption under the Book in front are ours
// (`#tooltip`: FriendsBothReadCaption, from our own `BothRead` by Book id); so is the sheet's content
// (`#detail-meta`, `#detail-actions`): the Stack's on Your shelf, adapted: her stars · your stars under Regal's title and author line; Show back /
// Put back / Open book. No blurb (`both_read` has none). Regal draws the pause button (WCAG 2.2.2), the dots and its
// own pick (a Book out here is not out on Your shelf), breaks a Book out over the page like the row's and owns Back
// while it is out: it pushes one history entry (`regalReelPick`) and the system Back puts the Book back and never
// leaves the profile. So there is NO `useBackDismiss` here: a second handler would close it twice.
// Open book: Regal puts the Book back at once and emits `open`, after its history entry is gone, so the push to the
// Book's page (the cross-fade, no cover flight from the canvas in v1) is safe in it.
//  - `items`          the Books of the reel (reelItems), newest of hers first (for the pills, by Book id).
//  - `library`        the document Regal draws, ONE stable object the section holds (`bothReadReelDocument`); the same
//                     object is what its covers were asked for with (`preloadReelCovers`).
//  - `name`           her name; `card` her member card (her avatar in the pills).
//  - `autoplay`       whether the round plays (once per visit; the section decides). The still follows it too.
//  - `reducedMotion`  the section's reading of Reduce Motion, handed to Regal explicitly.
//  - `still`          the fallback: RegalBooksReelStill instead of the live reel.
// Emits `mounted` (the chunk is in and this is on the page: the section's placeholder space goes), `focus` (the index of
// the Book in front) and `manual` (the reader took over); the still emits neither of the last two.
import '#build/nuxt-fonts-global.css'
import '~/assets/css/regal-themed.css'
import type { RegalLibraryFile } from '~/data/export/regalLibraryFile'
import type { BothRead, MemberCard } from '~/data/socialShapes'
import { bookPathOf } from '~/utils/memberProfile'

const props = defineProps<{ items: readonly BothRead[]; library: RegalLibraryFile; name: string; card: MemberCard | null; autoplay?: boolean; reducedMotion?: boolean; still?: boolean }>()
const emit = defineEmits<{ mounted: []; focus: [index: number]; manual: [] }>()
// The component is on the page (the chunk is in): the section stops holding the space for it. Nothing else waits for it.
onMounted(() => emit('mounted'))

const { t } = useI18n()
const byId = computed(() => new Map(props.items.map((item) => [item.book.id, item])))

// Regal's own words (the pause button, "Book {n} of {count}", the keys hint, the details' actions) in the app's language.
const labels = computed(() => ({
  pause: t('member.bothReadPause'),
  play: t('member.bothReadPlay'),
  // Regal fills `{n}` and `{count}` itself (fillLabel): vue-i18n would put an empty string for a placeholder given no value, so they are handed back as they are.
  slide: t('member.bothReadSlide', { n: '{n}', count: '{count}' }),
  keys: t('member.bothReadKeys'),
  // The ring on the reel's empty stage while its covers come (Regal's, role=status): the section draws no spinner of its own.
  loading: t('member.bothReadLoading'),
  open: t('member.bothReadOpen'),
  showBack: t('shelf.detail.showBack'),
  showFront: t('shelf.detail.showFront'),
  putBack: t('shelf.detail.putBack'),
}))

/** Open book: the Book is already back; push its page with the cross-fade. */
function onOpen(event: { id: string }) {
  const item = byId.value.get(event.id)
  const to = item ? bookPathOf(item.book) : null
  if (to) void navigateTo(to)
}
</script>

<template>
  <!-- The fallback: the reel's first frame as a still, the same pills and caption (the title opens the Book: the still has no events). -->
  <RegalBooksReelStill
    v-if="still"
    class="both-read-reel regal-themed"
    data-testid="member.bothRead.still"
    theme="auto"
    :library="props.library"
    :label="t('member.bothReadLabel', { name })"
    :labels="labels"
    :autoplay="autoplay ?? true"
    :reduced-motion="reducedMotion"
  >
    <template #tooltip="{ book }">
      <FriendsBothReadCaption v-if="byId.get(book.id)" :item="byId.get(book.id)!" :card="card" :name="name" link />
    </template>
  </RegalBooksReelStill>
  <RegalBooksReel
    v-else
    class="both-read-reel regal-themed"
    data-testid="member.bothRead.reel"
    theme="auto"
    rotate="turntable"
    :library="props.library"
    :label="t('member.bothReadLabel', { name })"
    :labels="labels"
    :accessible-list="false"
    :autoplay="autoplay ?? true"
    :reduced-motion="reducedMotion"
    @focus="(event) => emit('focus', event.index)"
    @manual="emit('manual')"
    @open="onOpen"
  >
    <template #tooltip="{ book }">
      <FriendsBothReadCaption v-if="byId.get(book.id)" :item="byId.get(book.id)!" :card="card" :name="name" />
    </template>
    <template #detail-meta="{ book }">
      <p v-if="byId.get(book.id)" class="eyebrow flex flex-wrap items-center gap-x-sm gap-y-xs" data-testid="member.bothRead.detailMeta">
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
    <template #detail-actions="{ book, close, flip, face, open }">
      <UiButton tone="secondary" size="sm" data-testid="member.bothRead.flip" @click="flip">
        {{ face === 'front' ? t('shelf.detail.showBack') : t('shelf.detail.showFront') }}
      </UiButton>
      <UiButton tone="secondary" size="sm" data-testid="member.bothRead.putBack" @click="close">{{ t('shelf.detail.putBack') }}</UiButton>
      <!-- A Manual book or an unverified one has no page to open (bookPathOf). -->
      <UiButton v-if="byId.get(book.id) && bookPathOf(byId.get(book.id)!.book)" tone="plain" size="sm" class="ml-auto" data-testid="member.bothRead.openBook" @click="open">
        {{ t('member.bothReadOpen') }}
      </UiButton>
    </template>
  </RegalBooksReel>
</template>

<style scoped>
/* The reel and the still are as tall as their own stage and slot (`--regal-reel-height`, `--regal-reel-overlap`): nothing
   here sets a height, so the card is the reel's and does not change at the handover. A Book broken out is drawn over the whole screen, above the header and the tab bar (z 20), the search and a
   cover's flight (45), under the barcode scanner (80): as Your shelf's row. The details sit one above. A row inside
   a sheet sets `--shelf-row-z`. */
.both-read-reel {
  --regal-reel-z-index: var(--shelf-row-z, 50);
}
</style>
