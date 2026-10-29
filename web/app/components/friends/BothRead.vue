<script setup lang="ts">
// "You both read" on a member's profile and on her year page (social v2a, contract §1.3 and §3): the Books both
// finished (`both_read`), under her stars. Props only: the screen asks `both_read(member, year?)` and hands the answer in.
//  - `items`  the answer (BothRead[], newest of hers first).
//  - `name`   her name, for the screen reader's labels.
//  - `member` her card (her avatar in the pills); only with `reel`.
//  - `pending` her answer is on its way (profile only): the section holds its final box, heading and card, as empty
//             paper (the reel's own stage is too until its covers are in), and nothing moves when it comes; it closes if there turns out to be nothing.
//  - `reel`   the profile's slideshow (docs/plans/shared-books-slideshow.md): Regal's reel; without `reel` (her year
//             page) the row of covers it always was.
// The slideshow is Regal's alone (`LazyFriendsBothReadReel`, the only file that imports Regal), and it is in place from
// its first frame: the reel draws its own (the Books at the places the canvas will draw them, our pills and caption in
// its `#tooltip`), the canvas takes over in the same pixels, then the intro plays. This file draws nothing over or
// under it while it loads and waits for nothing (`ready` only means the canvas took over). Where the live reel is not
// mounted (no WebGL, Reduce Motion, Save-Data, one Book, an error) the same component draws Regal's still, the reel's
// first frame without the canvas. Only a build without Regal, or a chunk that cannot be had, has no picture: the list
// is then open. Also here: the shared figures line, and the text list (`FriendsBothReadList`), always there for a
// screen reader, shown to everyone by "Show as a list". The pause button (WCAG 2.2.2), the dots, the manual takeover (a
// swipe, a tap or a key: only Play resumes), the Book taken out with the Stack's details and the system Back are
// Regal's (its reel plays one round once per visit, then rests). The chunk is fetched as the page opens
// (`prefetchBothReadReel`, in the page), the first covers as soon as the answer is known (`preloadCovers`), and the
// card is the height it will have from the first paint (`--both-read-reel-height`, main.css).
// Not drawn without Books.
// Test ids: `member.bothRead` (the section), `member.bothRead.reel` / `.still`, `member.bothRead.book`,
// `member.bothRead.hers`, `member.bothRead.figures`, `member.bothRead.disagree`, `member.bothRead.listToggle`.
import { BOTH_READ_REEL_LIMIT, bothReadReelDocument, reelItems, sameReelBooks } from '~/data/bothReadReel'
import type { BothRead, MemberCard } from '~/data/socialShapes'
import { sharedFiguresOf } from '~/utils/sharedFigures'
import { isChunkError, describeError } from '~/data/errorLog'
import { hasWebgl, reelWanted, saveDataOn } from '~/utils/bothReadReel'
import { preloadReelCovers } from '~/utils/regalReelPreload'
import { prefersReducedMotion } from '#layers/ui/app/utils/motion'

const props = defineProps<{ items: readonly BothRead[]; name: string; member?: MemberCard | null; reel?: boolean; pending?: boolean }>()
const { t } = useI18n()
// A Book the check could not confirm is the one string, on the Placeholder, and opens nothing (utils/unverifiedBook.ts).
const shown = (book: BothRead['book']) => shownBook(book, t('book.outsideCatalogue'))

// ------------------------------------------------------------------ the slideshow
/** The Books the reel shows: the newest of hers; the list below has them all. */
const slides = computed(() => reelItems(props.items, BOTH_READ_REEL_LIMIT))

const appConfig = useAppConfig()
// Regal is in this build (LIBELLUS_REGAL=1, regal.config.ts); without it the section is the figures and the list.
const built = appConfig.regal === true

// What the browser can and wants, read once before the first frame (the app is client-rendered: no server HTML to differ
// from), so the reel or the still is the right one from the start and never swaps for the other.
const gate = reactive({
  webgl: import.meta.client && props.reel && built ? hasWebgl() : false,
  saveData: import.meta.client ? saveDataOn() : false,
  reducedMotion: import.meta.client ? prefersReducedMotion() : true,
})
/** The reel (or the still) is on the page: its own height is the card's; until then the space it will take is held. */
const reelIn = ref(false)
/** The chunk could not be had (offline before it was ever fetched): nothing of Regal can be drawn. */
const chunkFailed = ref(false)
/** The live reel threw: the still takes its place. */
const reelErrored = ref(false)
onErrorCaptured((error) => {
  if (isChunkError(describeError(error).message)) {
    chunkFailed.value = true
    return false
  }
  // Reported as ever; the still takes the reel's place (an error in the still itself is not answered by itself).
  if (live.value) reelErrored.value = true
  return true
})
/** Regal's live reel: every loading rule holds. Otherwise its still. */
const live = computed(() => reelWanted({ built, count: slides.value.length, ...gate }) && !reelErrored.value)
/** Regal's component (reel or still) is drawn: the build has Regal, there is a Book, and the chunk is to come or here. */
const mountRegal = computed(() => Boolean(props.reel) && built && slides.value.length > 0 && !chunkFailed.value)
/** There is a picture; without one (no Regal in the build, no chunk) the list is open and has no toggle. */
const picture = computed(() => Boolean(props.reel) && built && !chunkFailed.value)
// The library document Regal's reel takes (ids, titles, authors, cover URLs, colours: data/bothReadReel.ts): ONE stable
// object, held here until the Books really change (a new object is another Library: the reel starts over), so the covers
// asked for below and the reel the card mounts are about the same Library.
const library = shallowRef(bothReadReelDocument(slides.value, { outside: t('book.outsideCatalogue') }))
watch(
  () => [slides.value, t('book.outsideCatalogue')] as const,
  ([list, outside]) => {
    const next = bothReadReelDocument(list, { outside })
    if (!sameReelBooks(library.value, next)) library.value = next
  },
)
onMounted(() => {
  if (!props.reel || !built) return
  // Reduce Motion switched on or off while the page is open: the reel gives way to the still and back.
  const media = window.matchMedia('(prefers-reduced-motion: reduce)')
  const onMotion = () => (gate.reducedMotion = prefersReducedMotion())
  media.addEventListener('change', onMotion)
  onBeforeUnmount(() => media.removeEventListener('change', onMotion))
})

// The round plays once per app session for each friend (docs/plans/shared-books-slideshow.md, H: "once per visit"): coming
// back to her page (Back from a Book, another tab and back) finds the reel resting, Play plays it. A round has begun
// when a Book first comes forward on its own, or the reader took over.
const played = useState<Record<string, true>>('both-read-played', () => ({}))
const playedKey = props.member?.id ?? ''
const autoplay = !played.value[playedKey]
const markPlayed = () => {
  if (!played.value[playedKey]) played.value = { ...played.value, [playedKey]: true }
}

// The covers of the reel's first frame, asked for as soon as her answer is in: before Regal's reel chunk has arrived
// (Regal's `preloadReelCovers`: light, no three.js), with the reel's own `autoplay` and `reduced-motion`, which decide
// which Books its first frame shows. The reel's canvas takes these bytes, its first frame finds them in the cache.
if (props.reel && built) {
  watch(
    [library, () => gate.reducedMotion],
    ([doc, reducedMotion]) => {
      if (doc.books.length) preloadReelCovers(doc, { autoplay, reducedMotion })
    },
    { immediate: true },
  )
}

// ------------------------------------------------------------------ the figures line (plan E 1-3)
const figures = computed(() => sharedFiguresOf(props.items))
/** "You agree on 7 of 9 · Lena read 8 of them first": the parts that have something to say. */
const figuresLine = computed(() => {
  const { agreement, firstCount } = figures.value
  return [
    agreement ? t('member.bothReadAgree', { agree: agreement.agree, of: agreement.of }) : null,
    firstCount ? t('member.bothReadFirst', { name: props.name, count: firstCount }) : null,
  ].filter((part): part is string => part !== null)
})
const disagree = computed(() => {
  const found = figures.value.disagreement
  if (!found) return null
  return {
    book: found.book,
    text: t('member.bothReadDisagree', {
      title: shown(found.book).title,
      name: props.name,
      hers: ratingText(found.hers),
      mine: ratingText(found.mine),
    }),
  }
})

// ------------------------------------------------------------------ the list
const listOpen = ref(false)
</script>

<template>
  <section v-if="items.length || (pending && reel && picture)" class="flex flex-col gap-sm" :aria-busy="!items.length || undefined" data-testid="member.bothRead">
    <h2 class="eyebrow">{{ reel && items.length ? t('member.bothReadEyebrow', { count: figures.count }) : t('member.bothRead') }}</h2>

    <!-- The slideshow is Regal's alone and in place from its first frame (its own, drawn from the same Books): nothing of ours under or over it, no wait for it. The card holds the height it will have (`--both-read-reel-height`, main.css) from the first paint, as empty paper (the reel's own stage is empty paper too until its covers are in, then its Books pop in: nothing of ours to take down, no cover before them) where the answer or Regal's chunk is not in yet; the reel's own height replaces it. -->
    <template v-if="reel">
      <div v-if="picture" class="min-w-0" :class="!reelIn && 'min-h-(--both-read-reel-height)'">
        <LazyFriendsBothReadReel
          v-if="items.length && mountRegal"
          :items="slides"
          :library="library"
          :name="name"
          :card="member ?? null"
          :autoplay="autoplay"
          :reduced-motion="gate.reducedMotion"
          :still="!live"
          @mounted="reelIn = true"
          @focus="markPlayed"
          @manual="markPlayed"
        />
      </div>

      <template v-if="items.length">
        <div v-if="figuresLine.length || disagree" class="flex flex-col items-center gap-xs text-center text-subhead text-ink-muted" data-testid="member.bothRead.figures">
          <p v-if="figuresLine.length">{{ figuresLine.join(' · ') }}</p>
          <FriendsMemberBookLink v-if="disagree" :book="disagree.book" class="text-footnote text-accent-ink" data-testid="member.bothRead.disagree">{{ disagree.text }}</FriendsMemberBookLink>
        </div>

        <div v-if="picture" class="flex justify-center">
          <UiButton tone="plain" size="sm" :aria-expanded="listOpen" data-testid="member.bothRead.listToggle" @click="listOpen = !listOpen">
            {{ listOpen ? t('member.bothReadListHide') : t('member.bothReadList') }}
          </UiButton>
        </div>
        <FriendsBothReadList :items="items" :name="name" :visible="listOpen || !picture" />
      </template>
      <!-- Where the figures line and the list button will stand: held with the card, so nothing under it moves. -->
      <template v-else>
        <div class="h-(--text-subhead--line-height)" aria-hidden="true" />
        <div class="h-(--size-button-sm)" aria-hidden="true" />
      </template>
    </template>

    <!-- Her year page: the row of covers, her stars under each. -->
    <ul v-else class="scrollbar-none -mx-screen flex snap-x scroll-px-screen gap-ms overflow-x-auto px-screen pt-xs pb-xxl -mb-xl">
      <li v-for="item in items" :key="item.book.id" class="flex w-(--size-cover-md) shrink-0 snap-start flex-col gap-xs">
        <FriendsMemberBookLink :book="item.book" class="cover-link block rounded-cover" :aria-label="shown(item.book).title" data-testid="member.bothRead.book">
          <UiCover
            :title="shown(item.book).title"
            :authors="shown(item.book).authors"
            :src="coverSrc(shown(item.book).coverUrl, 'md')"
            :thumbhash="shown(item.book).coverThumbhash"
            :colors="shown(item.book).coverColors"
            size="md"
          />
        </FriendsMemberBookLink>
        <!-- Her stars only where she shows them; the value stays out of the drawing, the width is the cover's. -->
        <span v-if="item.hers.rating" class="flex" role="img" :aria-label="t('member.bothReadHers', { name, rating: ratingText(item.hers.rating) })" data-testid="member.bothRead.hers">
          <UiStars aria-hidden="true" :quarters="item.hers.rating" size="sm" :show-value="false" />
        </span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cover-link:active {
  opacity: 0.8;
}
</style>
