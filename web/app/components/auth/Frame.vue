<script lang="ts">
// Outlives the component: sign in → sign up → verify are three mounts of the same wall, and the second
// one finds the covers in the HTTP cache, so it mounts them at once.
let wallWarm = false
</script>

<script setup lang="ts">
// The way in (sign in, sign up, verify): a shelf in the dark with a lamp over
// it, the wordmark, then the screen's form (default slot) and its way out to
// the other screen (slot `footer`). The shelf is a wall of real covers (see
// wall.ts), tilted and veiled; each stands on a cloth-coloured board that
// shows from the first frame, until its image arrives, or instead of it when the image fails.
//
// The covers are decoration (aria-hidden), and on a phone they were the screen's largest contentful
// paint, 5.6 s against 2.2 s without them (docs/perf/final-round.md, finding 1): twenty requests, a
// megabyte, in front of the form. So they are not part of the first paint: the boards are, and the
// covers are mounted once the form has been painted and the browser is idle (`afterPaint`), asked for
// at low priority, and fade in over their board when they arrive (WallCover.vue, which draws each on a
// canvas so a cover is never the LCP element; docs/MOTION.md, Sign-in wall).
// They are asked for at the size they are drawn (`lg`, 240 × 360 for an 82 px slot), not the 600 × 900
// the data holds. Only three rows: the fourth lies under a veil that is opaque from 48 % down
// (it showed 0–2 % of a cover on a phone, ≤ 6 % on the tallest desktop; docs/covers.md).
import { WALL_COVERS } from './wall'

defineProps<{ screen: string }>()
const { t } = useI18n()

// Five columns, four rows of boards (the cloth is picked in a fixed order so the wall never repeats a
// colour next to itself); the covers go on the first three.
const WALL = WALL_COVERS.slice(0, 20).map((book, i) => ({
  ...book,
  cloth: ((i * 2 + Math.floor(i / 5)) % 6) + 1,
}))
const WALL_COVER_COUNT = 15

// The covers are mounted after the form is painted.
const covers = ref(wallWarm)
const failed = ref(new Set<number>())
let cancel = () => {}
onMounted(() => {
  if (covers.value) return
  cancel = afterPaint(() => {
    covers.value = true
    wallWarm = true
  })
})
onBeforeUnmount(() => cancel())

/**
 * Runs `run` once the frame that shows the form has been painted and the main thread is idle (at the latest
 * 1.5 s later). A timeout stands in where `requestIdleCallback` does not exist (Safari).
 */
function afterPaint(run: () => void): () => void {
  let raf = 0
  let timer = 0
  let idle = 0
  // The first frame is the one that paints the form (this runs on mount); the second callback is after it was committed.
  raf = requestAnimationFrame(() => {
    raf = requestAnimationFrame(() => {
      if ('requestIdleCallback' in window) idle = window.requestIdleCallback(run, { timeout: 1500 })
      else timer = window.setTimeout(run, 300)
    })
  })
  return () => {
    cancelAnimationFrame(raf)
    clearTimeout(timer)
    if (idle) window.cancelIdleCallback(idle)
  }
}
</script>

<template>
  <main class="relative flex min-h-dvh flex-col overflow-hidden">
    <div class="wall" aria-hidden="true">
      <span v-for="(book, i) in WALL" :key="book.cover" class="spine" :style="{ background: `var(--color-cloth${book.cloth})` }">
        <span class="rule" />
        <AuthWallCover
          v-if="covers && i < WALL_COVER_COUNT && !failed.has(i)"
          :src="coverSrc(book.cover, 'lg')"
          @failed="failed = new Set(failed).add(i)"
        />
      </span>
    </div>
    <div class="veil" aria-hidden="true" />

    <div class="screen-inset relative flex flex-1 flex-col">
      <div class="mx-auto flex w-full max-w-(--size-max-content) flex-1 flex-col px-sm">
        <div class="lead" />
        <div class="text-center">
          <p class="font-serif text-wordmark font-regular lowercase italic" :data-testid="`${screen}.brand`">
            {{ t('app.name') }}
          </p>
          <p class="mt-ms text-body text-ink-muted">{{ t('app.tagline') }}</p>
        </div>

        <div class="mt-xxl flex flex-col gap-md">
          <slot />
        </div>

        <div class="tail" />
        <div class="pt-lg text-center text-subhead text-ink-faint">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped>
/* The wall: card-sized covers, tilted, half dimmed, running off the top left
   (on a wide screen, centred over the column). */
.wall {
  position: absolute;
  top: calc(-1 * var(--spacing-xl));
  left: max(calc(-1 * var(--size-cover-lg)), calc(50% - 3.25 * var(--size-cover-lg)));
  display: grid;
  grid-template-columns: repeat(5, var(--size-cover-lg));
  gap: var(--spacing-inset);
  opacity: 0.5;
  transform: rotate(-9deg);
  transform-origin: 0 0;
}

.spine {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-cover);
  box-shadow: var(--shadow-cover);
}

.rule {
  position: absolute;
  inset: var(--spacing-xs);
  border: var(--stroke-hairline) solid color-mix(in srgb, var(--color-cloth-ink) 30%, transparent);
  border-radius: 1px;
}

/* The lamp's glow behind the wordmark, and the room closing in below it. */
.veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(60% 34% at 50% 34%, var(--color-lamp-glow), transparent 70%),
    linear-gradient(
      to bottom,
      color-mix(in srgb, var(--color-surface) 72%, transparent) 0%,
      color-mix(in srgb, var(--color-surface) 25%, transparent) 11%,
      color-mix(in srgb, var(--color-surface) 75%, transparent) 26%,
      color-mix(in srgb, var(--color-surface) 94%, transparent) 38%,
      var(--color-surface) 48%
    );
}

/* The wordmark sits about two fifths down a phone screen, under the wall; the
   form follows it and the footer goes to the bottom. On a short screen (or
   with the keyboard up) the spacers give way first. */
.lead {
  flex: 6 1 0;
  min-height: var(--spacing-xxl);
}

.tail {
  flex: 3 1 0;
  min-height: var(--spacing-lg);
}
</style>
