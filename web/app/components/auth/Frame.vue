<script setup lang="ts">
// The way in (sign in, sign up, verify): a shelf in the dark with a lamp over
// it, the wordmark, then the screen's form (default slot) and its way out to
// the other screen (slot `footer`). The shelf is a wall of real covers (see
// wall.ts), tilted and veiled; each stands on a cloth-coloured board that
// shows until its image arrives, or instead of it when the image fails. They are asked for at the
// size they are drawn (`lg`, 240 × 360 for an 82 px slot), not the 600 × 900 the data holds.
import { WALL_COVERS } from './wall'

defineProps<{ screen: string }>()
const { t } = useI18n()

// Five columns, four rows; the cloth is picked in a fixed order so the wall
// never repeats a colour next to itself.
const WALL = WALL_COVERS.slice(0, 20).map((book, i) => ({
  ...book,
  cloth: ((i * 2 + Math.floor(i / 5)) % 6) + 1,
}))
const failed = ref(new Set<number>())
// The first two rows are what the lamp shows; the other two sit under the veil (it is nearly opaque
// from 38 % down), so they load when the browser finds them near the view, not with the page.
const WALL_EAGER = 10
</script>

<template>
  <main class="relative flex min-h-dvh flex-col overflow-hidden">
    <div class="wall" aria-hidden="true">
      <span v-for="(book, i) in WALL" :key="book.cover" class="spine" :style="{ background: `var(--color-cloth${book.cloth})` }">
        <span class="rule" />
        <img
          v-if="!failed.has(i)"
          class="cover"
          :src="coverSrc(book.cover, 'lg')"
          alt=""
          width="240"
          height="360"
          :loading="i < WALL_EAGER ? 'eager' : 'lazy'"
          decoding="async"
          fetchpriority="low"
          @error="failed = new Set(failed).add(i)"
        >
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

/* The real cover over its board; the board shows while it loads or if it fails. */
.cover {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
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
