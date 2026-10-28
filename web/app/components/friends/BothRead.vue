<script setup lang="ts">
// "You both read" on a member's profile and on her year page (social v2a, contract §1.3 and §3): the Books both
// finished (`both_read`), under her stars. Props only: the screen asks `both_read(member, year?)` and hands the answer in.
//  - `items`  the answer (BothRead[], newest of hers first).
//  - `name`   her name, for the screen reader's labels.
//  - `member` her card (her avatar in the pills); only with `reel`.
//  - `reel`   the profile's slideshow (docs/plans/shared-books-slideshow.md): the poster, and over it Regal's 3D reel
//             where the loading rules hold; without `reel` (her year page) the row of covers it always was.
// The slideshow is the reel's pose drawn flat (`FriendsBothReadPoster`, shown at once and for good where the 3D never
// comes), the 3D (`LazyFriendsBothReadReel`, the only file that imports Regal) fading in over it when its first frame
// is drawn, a pause button (WCAG 2.2.2: anything that moves by itself longer than 5 s has one; in Manual it reads
// Play), and the text list (`FriendsBothReadList`): always there for a screen reader, shown to everyone by "Show as
// a list". The 3D mounts only when `reelWanted` says so (the build has the reel, two Books or more, no Reduce Motion,
// WebGL, no Save-Data, the section within a viewport of the screen, the browser idle). One round, then it rests; a
// swipe, a tap or a key takes it over (Manual): only Play resumes it. Not drawn without Books.
// Test ids: `member.bothRead` (the section), `member.bothRead.book`, `member.bothRead.hers`, `member.bothRead.toggle`
// (pause / play), `member.bothRead.listToggle`.
import { BOTH_READ_REEL_LIMIT, reelItems } from '~/data/bothReadReel'
import type { BothRead, MemberCard } from '~/data/socialShapes'
import { hasWebgl, reelWanted, saveDataOn } from '~/utils/bothReadReel'
import { onIdle } from '~/utils/idle'
import { prefersReducedMotion } from '#layers/ui/app/utils/motion'

const props = defineProps<{ items: readonly BothRead[]; name: string; member?: MemberCard | null; reel?: boolean }>()
const { t } = useI18n()
// A Book the check could not confirm is the one string, on the Placeholder, and opens nothing (utils/unverifiedBook.ts).
const shown = (book: BothRead['book']) => shownBook(book, t('book.outsideCatalogue'))

// ------------------------------------------------------------------ the slideshow
/** The Books the poster and the reel show: the newest of hers; the list below has them all. */
const slides = computed(() => reelItems(props.items, BOTH_READ_REEL_LIMIT))
const front = ref(0)
watch(
  () => slides.value.length,
  (count) => {
    if (front.value >= count) front.value = Math.max(0, count - 1)
  },
)

const appConfig = useAppConfig()
// Regal and its reel are in this build (regal.config.ts decides `regalReel` from the layer: no reel, no 3D).
const built = appConfig.regal === true && appConfig.regalReel === true

const root = ref<HTMLElement | null>(null)
const near = ref(false)
const idle = ref(false)
const gate = reactive({ webgl: false, saveData: false, reducedMotion: true })
onMounted(() => {
  if (!props.reel || !built) return
  gate.webgl = hasWebgl()
  gate.saveData = saveDataOn()
  gate.reducedMotion = prefersReducedMotion()
  const stopIdle = onIdle(() => (idle.value = true))
  const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => (near.value = entries.some((e) => e.isIntersecting)), { rootMargin: '100% 0px' })
  if (observer && root.value) observer.observe(root.value)
  else near.value = true
  onBeforeUnmount(() => {
    stopIdle()
    observer?.disconnect()
  })
})
const mountReel = computed(() =>
  Boolean(props.reel) && reelWanted({ built, count: slides.value.length, near: near.value, idle: idle.value, ...gate }),
)

const reelReady = ref(false)
watch(mountReel, (now) => {
  if (!now) reelReady.value = false
})
// Playing: the first round, once per visit. Manual (a swipe, a tap, a key: `manual`) and the pause button end it; only Play
// begins it again. A page kept alive off screen rests (Regal also rests off screen and in a hidden tab).
const playing = ref(true)
const active = ref(true)
onActivated(() => (active.value = true))
onDeactivated(() => (active.value = false))

// ------------------------------------------------------------------ the list
const listOpen = ref(false)
</script>

<template>
  <section v-if="items.length" ref="root" class="flex flex-col gap-md" data-testid="member.bothRead">
    <h2 class="eyebrow">{{ t('member.bothRead') }}</h2>

    <!-- The slideshow: the poster at once, the 3D over it when it has its first frame. -->
    <template v-if="reel">
      <div class="relative">
        <FriendsBothReadPoster
          v-model:index="front"
          :items="slides"
          :name="name"
          :card="member ?? null"
          class="transition-opacity duration-standard ease-standard motion-reduce:transition-none"
          :class="reelReady && 'opacity-0'"
          :inert="reelReady"
          :aria-hidden="reelReady ? 'true' : undefined"
        />
        <LazyFriendsBothReadReel
          v-if="mountReel"
          v-model:index="front"
          :items="slides"
          :name="name"
          :card="member ?? null"
          :playing="playing && active"
          @ready="reelReady = true"
          @manual="playing = false"
        />
        <UiRoundButton
          v-if="reelReady"
          :icon="playing ? 'pause' : 'play'"
          :label="playing ? t('member.bothReadPause') : t('member.bothReadPlay')"
          class="absolute top-0 right-0 z-10"
          data-testid="member.bothRead.toggle"
          @click="playing = !playing"
        />
      </div>

      <div class="flex justify-center">
        <UiButton tone="plain" size="sm" :aria-expanded="listOpen" data-testid="member.bothRead.listToggle" @click="listOpen = !listOpen">
          {{ listOpen ? t('member.bothReadListHide') : t('member.bothReadList') }}
        </UiButton>
      </div>
      <FriendsBothReadList :items="items" :name="name" :visible="listOpen" />
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
