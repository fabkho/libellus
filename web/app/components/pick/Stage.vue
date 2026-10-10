<script setup lang="ts">
// The pick's animation (PROTOTYPE, #259): over the whole screen while a round is dealt. The winner
// is already drawn (stores/pick.ts); this is theatre. In a build with Regal (LIBELLUS_REGAL=1) the
// deal is Regal's 3D (Deal3d.vue, the lazy `regal` chunk, never precached); without it, offline
// before the chunk was ever fetched, or with `?deal=2d`, the Libellus-only 2D deal (Deal2d.vue).
// Until the deal is ready the chosen covers wait in a row (the same start every variant has).
// A tap anywhere skips to the result; Escape (or Back) leaves the pick without a trace. When the
// winner rests, its cover flies to its Book page like any cover (useBookFlight), and the bar there
// takes over (components/pick/Bar.vue). The animation is hidden from assistive tech; the result is
// announced by the bar.
import { coverSrc } from '~/utils/cover'
import { prefersReducedMotion } from '~/utils/motion'
import { dealBookOf, type DealPicked, type DealRect } from '~/utils/pickDeal'
import { usePickStore } from '~/stores/pick'

const emit = defineEmits<{ /** The cover has taken off and the room behind it has gone: unmount. */ gone: [] }>()

const { t } = useI18n()
const pick = usePickStore()
const config = useAppConfig()
const { launch } = useBookFlight()

const round = pick.round!
const books = round.candidates.map(dealBookOf)
const winner = round.candidates[round.winner]!
const reduced = prefersReducedMotion()
/** The first deal takes its time; a round after a Decline is shorter. */
const duration = round.number === 1 ? 3600 : 2200

type DealComponent = { skip: () => void }
const loadDeal2d = () => import('~/components/pick/Deal2d.vue')
const Deal = defineAsyncComponent(
  config.regal && !pick.force2d ? () => import('~/components/pick/Deal3d.vue').catch(loadDeal2d) : loadDeal2d,
)

const deal = useTemplateRef<DealComponent>('deal')
const ready = ref(false)
const landing = shallowRef<DealRect | null>(null)
const source = useTemplateRef<HTMLElement>('source')

// The deal's window, for the frame-cost measurement (perf/pick.ts).
function onReady() {
  ready.value = true
  performance.mark('pick:deal:start')
}

function skip() {
  deal.value?.skip()
}

/** The winner rests: its cover is laid where it is on screen, and flies from there to its page. */
async function picked(result: DealPicked) {
  if (landing.value || pick.phase !== 'dealing') return
  landing.value = result.rect
  performance.mark('pick:deal:end')
  await nextTick()
  const to = `/book/${winner.key}`
  pick.dealt(to)
  if (source.value) launch(source.value, to)
  setTimeout(() => emit('gone'), 320)
  await navigateTo(to, { replace: round.number > 1 })
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    pick.leave()
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    skip()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/** The flight's cover: UiCover's `xl`, scaled to the rect the deal ended on. */
const landingStyle = computed(() => {
  const rect = landing.value
  if (!rect) return { left: '0px', top: '0px' }
  return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }
})
</script>

<template>
  <div class="stage fixed inset-0 z-40 bg-surface" :class="landing && 'landed'" data-testid="pick.stage" @click="skip">
    <p class="eyebrow absolute inset-x-0 text-center text-ink-muted" :style="{ top: 'calc(var(--bar-top) + var(--spacing-md))' }">
      {{ t('pick.dealing', { count: books.length }) }}
    </p>

    <div class="deal absolute inset-x-0">
      <component
        :is="Deal"
        ref="deal"
        :books="books"
        :winner="round.winner"
        :variant="pick.variant"
        :duration="duration"
        :reduced-motion="reduced"
        :label="t('pick.stageLabel')"
        :class="landing && 'invisible'"
        @ready="onReady"
        @picked="picked"
      />
      <!-- The same start for every variant: the chosen covers in a row, until the deal is drawn. -->
      <div v-if="!ready" class="waiting absolute inset-0 flex items-center justify-center gap-sm px-screen" aria-hidden="true">
        <UiCover
          v-for="candidate in round.candidates"
          :key="candidate.key"
          decorative
          :title="candidate.book.title"
          :authors="candidate.book.authors"
          :src="coverSrc(candidate.book.coverUrl, 'sm')"
          :thumbhash="candidate.book.coverThumbhash"
          :colors="candidate.book.coverColors"
          size="md"
          eager
        />
      </div>
    </div>

    <p class="hint float-bottom absolute inset-x-0 text-center text-caption text-ink-faint" aria-hidden="true">{{ t('pick.skip') }}</p>

    <!-- Where the winner rests: the cover the flight takes off with. There from the start, unseen,
         so its image is decoded by the time it is laid over the deal's. -->
    <div ref="source" class="source fixed" :class="!landing && 'waiting-source'" :style="landingStyle" :data-testid="landing ? 'pick.landing' : undefined">
      <div class="scale" :style="{ transform: `scale(${(landing?.width ?? 140) / 140})` }">
        <UiCover
          decorative
          :title="winner.book.title"
          :authors="winner.book.authors"
          :src="coverSrc(winner.book.coverUrl, 'xl')"
          :thumbhash="winner.book.coverThumbhash"
          :colors="winner.book.coverColors"
          size="xl"
          eager
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.deal {
  top: calc(var(--bar-top) + var(--spacing-xxl));
  bottom: calc(var(--float-bottom) + var(--spacing-xxl));
}

.waiting-source {
  visibility: hidden;
}

.waiting {
  flex-wrap: wrap;
  align-content: center;
}

.scale {
  width: var(--size-cover-xl);
  transform-origin: 0 0;
}

/* The cover has taken off: the room behind it goes, quickly (docs/MOTION.md: exit). */
.stage.landed {
  background: transparent;
  pointer-events: none;
  transition: background-color var(--duration-exit) var(--ease-exit);
}
.stage.landed > :not(.source) {
  opacity: 0;
  transition: opacity var(--duration-exit) var(--ease-exit);
}
</style>
