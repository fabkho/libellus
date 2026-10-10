<script setup lang="ts">
// The pick's deal without Regal (PROTOTYPE, #259): the Libellus-only fallback, in the app's own
// covers (UiCover: images, thumbhashes, Placeholder cloths) and CSS 3D, transform and opacity only
// (docs/MOTION.md). One motion for every variant: a ring of covers turns, slows, and stops with the
// winner in front (already drawn: `winner`), which steps forward to where the flight to its page
// starts. Same interface as Deal3d.vue (Regal's RegalBooksDeal): `ready`, `picked` with the rect,
// `skip()`. Reduce Motion: no ring, the winner fades in where it ends.
import type { PickVariant } from '~/data/pick'
import type { DealBook, DealPicked } from '~/utils/pickDeal'

const props = defineProps<{
  books: DealBook[]
  winner: number
  variant: PickVariant
  duration: number
  reducedMotion: boolean
  label: string
}>()
const emit = defineEmits<{ ready: []; picked: [picked: DealPicked] }>()

/** UiCover's `xl` width (tokens: size.cover.xl): the covers are drawn at it and scaled. */
const XL = 140

const root = useTemplateRef<HTMLElement>('root')
const ring = useTemplateRef<HTMLElement>('ring')
const end = useTemplateRef<HTMLElement>('end')
const cards = ref<HTMLElement[]>([])
const box = reactive({ width: 0, height: 0 })

/** Where everything is, from the box: the end cover (55 % of the height, never wider than 62 % of the width), the ring's cards and radius. */
const layout = computed(() => {
  const endHeight = Math.min(box.height * 0.55, box.width * 0.62 * 1.5)
  const endWidth = endHeight / 1.5
  const cardWidth = endWidth * 0.62
  const n = props.books.length
  const step = 360 / Math.max(n, 1)
  const radius = n < 2 ? 0 : Math.max((cardWidth * 1.18) / (2 * Math.sin(Math.PI / n)), cardWidth * 0.75)
  return { endWidth, endHeight, cardWidth, step, radius, cx: box.width / 2, cy: box.height * 0.44 }
})

const cardStyle = (index: number) => {
  const { cardWidth, step, radius } = layout.value
  return {
    width: `${cardWidth}px`,
    height: `${cardWidth * 1.5}px`,
    marginLeft: `${-cardWidth / 2}px`,
    marginTop: `${(-cardWidth * 1.5) / 2}px`,
    transform: `rotateY(${index * step}deg) translateZ(${radius}px)`,
  }
}
const scaleTo = (width: number) => ({ transform: `scale(${width / XL})` })

const ended = ref(false)
let spin: Animation | null = null
let settled = false
let skipped = false

function measure() {
  const rect = root.value?.getBoundingClientRect()
  if (!rect) return
  box.width = rect.width
  box.height = rect.height
}

/** The winner's cover where it rests, in the viewport. */
function rectOfEnd(): DealPicked['rect'] {
  const rect = end.value!.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

/** The ring is gone, the winner stands where it ends: `picked`. */
async function land(ms: number) {
  if (settled) return
  settled = true
  const { cardWidth, endWidth } = layout.value
  const fade = { duration: ms, easing: 'ease-out', fill: 'forwards' as const }
  // The winner's card hands over to the end cover, which grows from the card's size in front.
  ended.value = true
  await nextTick()
  if (!end.value) return
  const grow = end.value.animate(
    [
      { transform: `scale(${cardWidth / endWidth})`, opacity: props.reducedMotion ? 0 : 1 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: props.reducedMotion ? 200 : ms + 120, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' },
  )
  if (ring.value) ring.value.animate([{ opacity: 1 }, { opacity: 0 }], fade)
  await grow.finished.catch(() => undefined)
  // Held still a moment: the result reads before the cover flies.
  await new Promise((resolve) => setTimeout(resolve, skipped ? 60 : 260))
  if (!end.value) return
  emit('picked', { index: props.winner, id: props.books[props.winner]!.id, rect: rectOfEnd() })
}

async function play() {
  const { step } = layout.value
  if (props.reducedMotion || props.books.length < 2) {
    await land(200)
    return
  }
  // The cards come in (the start), then the ring turns: several turns and the winner's place,
  // fast at first, slowing over most of the time, a little settle at the end.
  const turns = props.duration >= 3000 ? 3 : 2
  const total = turns * 360 + props.winner * step
  for (const [index, card] of cards.value.entries()) {
    card.animate([{ opacity: 0, transform: `${cardStyle(index).transform} scale(0.6)` }, { opacity: 1, transform: cardStyle(index).transform }], {
      duration: 380,
      delay: index * 30,
      easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      fill: 'backwards',
    })
  }
  if (!ring.value) return
  spin = ring.value.animate(
    [
      { transform: `translateZ(${-layout.value.radius}px) rotateY(0deg)` },
      { transform: `translateZ(${-layout.value.radius}px) rotateY(${-total}deg)` },
    ],
    { duration: props.duration, delay: 300, easing: 'cubic-bezier(0.25, 0.1, 0.1, 1)', fill: 'forwards' },
  )
  await spin.finished.catch(() => undefined)
  await land(skipped ? 180 : 420)
}

/** A tap: the ring stops on the winner at once (the result was decided before it turned). */
function skip() {
  if (settled || skipped) return
  skipped = true
  if (spin) spin.finish()
  else void land(180)
}
defineExpose({ skip })

onMounted(async () => {
  measure()
  await nextTick()
  emit('ready')
  void play()
})
onBeforeUnmount(() => spin?.cancel())
</script>

<template>
  <div ref="root" class="deal" role="img" :aria-label="label">
    <div class="origin" :style="{ left: `${layout.cx}px`, top: `${layout.cy}px` }" aria-hidden="true">
      <div v-if="!reducedMotion && books.length > 1" ref="ring" class="ring" :style="{ transform: `translateZ(${-layout.radius}px)` }">
        <div
          v-for="(book, index) in books"
          :key="book.id"
          :ref="(el) => el && (cards[index] = el as HTMLElement)"
          class="card"
          :class="ended && index === winner && 'gone'"
          :style="cardStyle(index)"
        >
          <div class="scale" :style="scaleTo(layout.cardWidth)">
            <UiCover decorative :title="book.title" :authors="book.author ? [book.author] : []" :src="book.coverUrl" size="xl" eager />
          </div>
        </div>
      </div>
      <div
        v-if="ended"
        ref="end"
        class="end"
        :style="{ width: `${layout.endWidth}px`, height: `${layout.endHeight}px`, marginLeft: `${-layout.endWidth / 2}px`, marginTop: `${-layout.endHeight / 2}px` }"
        data-testid="pick.dealEnd"
      >
        <div class="scale" :style="scaleTo(layout.endWidth)">
          <UiCover decorative :title="books[winner]!.title" :authors="books[winner]!.author ? [books[winner]!.author!] : []" :src="books[winner]!.coverUrl" size="xl" eager />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.deal {
  position: absolute;
  inset: 0;
  overflow: hidden;
  perspective: calc(var(--size-cover-xl) * 7);
}

.origin {
  position: absolute;
  width: 0;
  height: 0;
  transform-style: preserve-3d;
}

.ring {
  position: absolute;
  transform-style: preserve-3d;
  will-change: transform;
}

.card,
.end {
  position: absolute;
  backface-visibility: hidden;
}

.card.gone {
  visibility: hidden;
}

.scale {
  width: var(--size-cover-xl);
  transform-origin: 0 0;
}
</style>
