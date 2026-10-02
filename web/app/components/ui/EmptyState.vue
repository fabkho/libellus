<script setup lang="ts">
// D's empty state: the reading lamp over an empty shelf in its pool of light,
// a serif line, a sentence, and (slot) the one way forward. `screen` names the
// test IDs: `<screen>.emptyTitle`, `<screen>.empty`.
defineProps<{ screen: string; title: string; text: string }>()

const cone = useId()
</script>

<template>
  <section class="flex flex-col items-center text-center">
    <div class="relative flex h-(--size-empty-art) w-full items-end justify-center" aria-hidden="true">
      <span class="pool" />
      <svg viewBox="0 0 240 250" fill="none" class="relative h-full text-ink-faint">
        <!-- A reading lamp over a shelf: cord, shade, the cone of light, two books and the outline of the next one. -->
        <path d="M120 0v52" stroke="currentColor" stroke-width="1" />
        <path d="M104 52h32l12 26H92z" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
        <path d="M92 78 52 214h136L148 78" :fill="`url(#${cone})`" />
        <rect x="80" y="132" width="22" height="82" rx="2" stroke="currentColor" stroke-width="1" />
        <rect x="106" y="146" width="18" height="68" rx="2" stroke="currentColor" stroke-width="1" />
        <rect
          x="132"
          y="140"
          width="20"
          height="74"
          rx="2"
          stroke="currentColor"
          stroke-width="1"
          stroke-dasharray="3 4"
          transform="rotate(12 142 214)"
        />
        <path d="M36 214.5h168" stroke="currentColor" stroke-width="1" />
        <defs>
          <linearGradient :id="cone" x1="120" y1="78" x2="120" y2="214" gradientUnits="userSpaceOnUse">
            <stop class="cone-start" />
            <stop offset="1" class="cone-end" />
          </linearGradient>
        </defs>
      </svg>
    </div>

    <h2 class="book-title mt-lg px-xl text-headline" :data-testid="`${screen}.emptyTitle`">{{ title }}</h2>
    <p class="mt-sm max-w-(--size-menu) text-subhead text-ink-muted" :data-testid="`${screen}.empty`">{{ text }}</p>
    <div class="mt-xl flex w-full flex-col items-stretch px-xs">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.pool {
  position: absolute;
  inset: var(--spacing-xl) var(--spacing-ml) calc(-1 * var(--spacing-xl));
  background: radial-gradient(50% 50% at 50% 60%, var(--color-lamp-light), transparent 72%);
}

/* The cone: lamp light at the shade, nothing at the shelf. */
.cone-start {
  stop-color: var(--color-lamp-cone);
}
.cone-end {
  stop-color: var(--color-lamp-cone);
  stop-opacity: 0;
}
</style>
