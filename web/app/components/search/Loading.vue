<script setup lang="ts">
// What the palette shows between a first phrase and its first results: a little
// book riffling its pages, one quiet line under it, and a lamp-coloured hairline
// sweeping from left to right along the edge above the query. It says nothing
// for the typing pause and a `quick` more (Results sets `--loading-wait`, so a
// fast answer shows no loading at all), then fades in over `standard`.
//
// The motion is ambient and loops on `caret` (the one long duration there is),
// the pages staggered by multiples of `instant`. With Reduce Motion nothing
// moves: the book rests half fanned and the hairline is not drawn (the palette's own divider is there).
// The palette's results are a polite live region, so the line is read once, as
// the state appears; the state itself is aria-busy and the pictures are hidden
// from assistive technology (the visible line is the same words, so hidden too).
const { t } = useI18n()
</script>

<template>
  <div class="loading relative flex flex-col items-center gap-ms px-lg pt-lg pb-xl" aria-busy="true" data-testid="search.loading">
    <span class="book" aria-hidden="true">
      <span v-for="page in 5" :key="page" class="page" :style="{ '--n': page - 1 }" />
    </span>
    <p class="text-caption text-ink-faint" aria-hidden="true">{{ t('search.loadingShelves') }}</p>
    <span class="sweep" aria-hidden="true" />
    <span class="sr-only">{{ t('search.loadingShelves') }}</span>
  </div>
</template>

<style scoped>
/* Nothing for the typing pause and a `quick` (--loading-wait), then the state fades in. */
.loading {
  animation: loading-in var(--duration-standard) var(--ease-standard) var(--loading-wait, var(--duration-quick)) both;
}
@keyframes loading-in {
  from {
    opacity: 0;
  }
}

/* Five pages hinged at the spine flip over and back. */
.book {
  position: relative;
  display: block;
  width: var(--spacing-lg);
  height: var(--spacing-lg);
  perspective: calc(var(--spacing-xxl) * 2);
}
.page {
  position: absolute;
  inset: 0;
  border: var(--stroke-rule) solid var(--color-ink-faint);
  border-radius: var(--radius-cover-sm);
  background: var(--color-surface-raised);
  transform-origin: left center;
  /* At rest the pages are fanned a little, the still picture of a book mid-flip. */
  transform: rotateY(calc(var(--n) * -14deg));
  animation: flip calc(var(--duration-caret) * 1.4) var(--ease-standard) calc(var(--n) * var(--duration-instant) * 1.2) infinite alternate;
}
@keyframes flip {
  0%,
  15% {
    transform: rotateY(0deg);
  }
  85%,
  100% {
    transform: rotateY(-150deg);
  }
}

/* The hairline sits on the palette's divider, just above the query; a lamp-coloured stretch of it travels left to right. */
.sweep {
  position: absolute;
  inset: auto 0 0;
  height: var(--stroke-rule);
  overflow: hidden;
}
.sweep::after {
  content: '';
  position: absolute;
  inset: 0;
  width: 40%;
  background: linear-gradient(90deg, transparent, var(--color-accent), transparent);
  animation: sweep calc(var(--duration-caret) * 1.6) var(--ease-standard) infinite;
}
@keyframes sweep {
  from {
    translate: -100% 0;
  }
  to {
    translate: 250% 0;
  }
}

/* Reduce Motion: a still picture, with no movement at all. */
@media (prefers-reduced-motion: reduce) {
  .page,
  .sweep::after {
    animation: none;
  }
  .sweep {
    display: none;
  }
}
</style>
