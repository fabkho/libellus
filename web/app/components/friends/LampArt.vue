<script setup lang="ts">
// The reading lamp of the Friends empty state: the base's EmptyState drawing (a lamp over a shelf, the
// cone of light, a pool on the shelf) with its light alive. The pool and the cone breathe slowly and
// flicker a little, each on its own beat (4.3 s and 5.7 s), so the two never line up twice running and
// the loop reads as a flame, not a pulse. Only opacity and transform, on layers of their own: no layout,
// no paint of the page. Reduce Motion: a still glow. The drawing is EmptyState's (fabkho/ui), put in its
// `art` slot.
const cone = useId()
</script>

<template>
  <div class="lamp relative flex w-full items-end justify-center" aria-hidden="true" data-testid="friends.lamp">
    <span class="pool" />
    <svg viewBox="0 0 240 250" fill="none" class="relative h-full text-ink-faint">
      <path d="M120 0v52" stroke="currentColor" stroke-width="1" />
      <path d="M104 52h32l12 26H92z" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
      <path class="cone" d="M92 78 52 214h136L148 78" :fill="`url(#${cone})`" />
      <rect x="80" y="132" width="22" height="82" rx="2" stroke="currentColor" stroke-width="1" />
      <rect x="106" y="146" width="18" height="68" rx="2" stroke="currentColor" stroke-width="1" />
      <rect x="132" y="140" width="20" height="74" rx="2" stroke="currentColor" stroke-width="1" stroke-dasharray="3 4" transform="rotate(12 142 214)" />
      <path d="M36 214.5h168" stroke="currentColor" stroke-width="1" />
      <defs>
        <linearGradient :id="cone" x1="120" y1="78" x2="120" y2="214" gradientUnits="userSpaceOnUse">
          <stop class="cone-start" />
          <stop offset="1" class="cone-end" />
        </linearGradient>
      </defs>
    </svg>
  </div>
</template>

<style scoped>
/* The base's height on a tall phone; on a short one (360 x 640, an installed app with its insets) it gives up
   what the header, the words, the button and the tab bar leave over, down to a floor, so the page never scrolls. */
.lamp {
  height: min(var(--size-empty-art), max(120px, calc(100dvh - 520px - var(--safe-area-top) - var(--safe-area-bottom))));
}
.pool {
  position: absolute;
  inset: var(--spacing-xl) var(--spacing-ml) calc(-1 * var(--spacing-xl));
  background: radial-gradient(50% 50% at 50% 60%, var(--color-lamp-light), transparent 72%);
  transform-origin: 50% 60%;
  animation: pool-breathe 5.7s ease-in-out infinite;
  will-change: opacity, transform;
}
.cone {
  transform-origin: 120px 78px;
  transform-box: view-box;
  animation: cone-flicker 4.3s ease-in-out infinite;
}
.cone-start {
  stop-color: var(--color-lamp-cone);
}
.cone-end {
  stop-color: var(--color-lamp-cone);
  stop-opacity: 0;
}

/* Uneven steps on purpose: a slow swell, a small stumble, a longer rest. */
@keyframes pool-breathe {
  0%, 100% { opacity: 0.82; transform: scale(0.97); }
  22% { opacity: 1; transform: scale(1.03); }
  41% { opacity: 0.9; transform: scale(1); }
  47% { opacity: 0.96; transform: scale(1.015); }
  74% { opacity: 0.78; transform: scale(0.965); }
}
@keyframes cone-flicker {
  0%, 100% { opacity: 0.86; }
  18% { opacity: 1; }
  27% { opacity: 0.92; }
  33% { opacity: 1; }
  62% { opacity: 0.8; }
  81% { opacity: 0.94; }
}

@media (prefers-reduced-motion: reduce) {
  .pool,
  .cone {
    animation: none;
    will-change: auto;
  }
}
</style>
