<script lang="ts">
// Plays once per visit to the way in: sign in → sign up → verify are three mounts of the same wall,
// and the second one finds the lamp already up (as `wallWarm` in Frame.vue keeps the covers). Set in
// setup, so the mount that follows a navigation reads it as risen.
let risen = false
</script>

<script setup lang="ts">
// The mark (docs/plans/new-logo.md, C · The way in): the open book with the lamp rising behind it
// like the sun, above the wordmark. Inline rather than an `<img>` so it takes the room's colours from
// the tokens (the pages in `--color-ink`, the lamp in `--color-accent`, its halo in the existing
// `--color-lamp-glow`), and so an inline SVG never counts as the largest contentful paint
// (docs/perf/client-1-startup.md, F-12: the grain that became an inline `<svg>` for exactly that).
// Decoration: the wordmark is the name, so the whole mark is `aria-hidden`. The screen-reader-only
// motion, the geometry and the placement are in docs/MOTION.md ("The lamp rising") and docs/DESIGN.md.
const still = risen
risen = true
const id = useId()
</script>

<template>
  <svg
    class="mark text-wordmark"
    :class="{ 'is-still': still }"
    viewBox="6 22 88 72"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <radialGradient :id="`${id}-halo`" cx="50" cy="50" r="46" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="var(--color-lamp-glow)" />
        <stop offset="0.45" stop-color="var(--color-lamp-glow)" stop-opacity="0.3" />
        <stop offset="1" stop-color="var(--color-lamp-glow)" stop-opacity="0" />
      </radialGradient>
      <!-- The lamp rises from behind the pages: the sky is everything above their edge. -->
      <clipPath :id="`${id}-sky`">
        <path d="M0 0H100V58H90C74 52 58 54 50 66C42 54 26 52 10 58H0Z" />
      </clipPath>
    </defs>
    <rect class="halo" x="6" y="22" width="88" height="72" :fill="`url(#${id}-halo)`" />
    <g :clip-path="`url(#${id}-sky)`">
      <path class="lamp" fill="var(--color-accent)" d="M50 36.5A18.5 18.5 0 1 1 50 73.5A18.5 18.5 0 1 1 50 36.5Z" />
    </g>
    <path
      class="pages"
      fill="var(--color-ink)"
      d="M48.4 70C42 58 26 56 10 62V78C26 72 42 74 48.4 86ZM51.6 70C58 58 74 56 90 62V78C74 72 58 74 51.6 86Z"
    />
  </svg>
</template>

<style scoped>
/* Twice the wordmark's cap height: the box is `2em` of the wordmark's own type token, and the drawn
   mark fills about 0.69 of it (49.5 of the viewBox's 72 units), which is the cap height × 2. */
.mark {
  display: block;
  height: 2em;
  width: auto;
  margin-inline: auto;
}

/* The three parts of one movement (docs/plans/new-logo.md, C; the source is
   design/logo-options/6-lamp-over-page/motion/mark-animated-dark.svg). Tokens only: `gentle` and
   `wave` for the durations, `standard` and `wave` for the curves, `quick` for the two delays the
   source writes as 150 ms and, twice over, 300 ms. */
.pages {
  animation: mark-pages var(--duration-gentle) var(--ease-standard) both;
}

.lamp {
  animation: mark-lamp var(--duration-wave) var(--ease-standard) var(--duration-quick) both;
}

.halo {
  animation: mark-halo var(--duration-wave) var(--ease-wave) calc(2 * var(--duration-quick)) both;
}

/* The distances are the source SVG's own user units (6 and 34 of the 88 × 72 viewBox), not spacing. */
@keyframes mark-pages {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

@keyframes mark-lamp {
  from {
    transform: translateY(34px);
  }
}

@keyframes mark-halo {
  from {
    opacity: 0;
  }
}

/* Risen already (a second visit to the way in): the last frame, with no animation to run. */
.mark.is-still .pages,
.mark.is-still .lamp,
.mark.is-still .halo {
  animation: none;
}

/* Reduce Motion: the mark is there at once, at rest (docs/MOTION.md, "State before motion"). */
@media (prefers-reduced-motion: reduce) {
  .pages,
  .lamp,
  .halo {
    animation: none;
  }
}
</style>
