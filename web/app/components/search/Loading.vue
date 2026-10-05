<script setup lang="ts">
// What the palette shows between a first phrase and its first results (design
// round: five ideas, picked in dev with `?loading=a..e`; `o` is the single
// ghost row it had before). It is visible for a moment, often under a second,
// so it is quiet: it says nothing for the typing pause and a `quick` more (a
// fast answer shows no loading at all, `loadingWait` in Results.vue), then fades in. Every idea keeps its room next to the
// query, where the best match will be, and none of them names a source.
//
//  a  three result-shaped rows, a soft shimmer rolling down them
//  b  a little book riffling its pages, and one quiet line
//  c  five cover slabs rising in a wave
//  d  the phrase itself in the book-title serif, an ellipsis breathing after it
//  e  two ghost rows breathing, and a lamp-coloured hairline sweeping above the query
//
// Motion is ambient and loops on `caret` (the one long duration there is), its
// stagger a multiple of `instant`. With Reduce Motion nothing moves: each idea
// rests as the still picture of itself.
// The palette's results are a polite live region, so the sr-only line says
// "Searching…" once, as the state appears; the pictures are hidden from
// assistive technology, and the state itself is aria-busy.
import type { LoadingVariant } from '~/composables/useSearchDev'

defineProps<{ variant: LoadingVariant; query: string }>()
const { t } = useI18n()
</script>

<template>
  <div class="loading" :class="`loading-${variant}`" aria-busy="true" data-testid="search.loading">
    <!-- o: today's single ghost row -->
    <div v-if="variant === 'o'" class="flex items-center gap-ms py-xs pr-ms pl-md" aria-hidden="true">
      <span class="ghost-cover shrink-0 rounded-cover-sm bg-fill" />
      <span class="flex flex-1 flex-col gap-xs">
        <span class="ghost-line w-3/5 rounded-pill bg-fill" />
        <span class="ghost-line w-2/5 rounded-pill bg-fill" />
      </span>
    </div>

    <!-- a: three rows shaped like results -->
    <div v-else-if="variant === 'a'" class="flex flex-col py-xs" aria-hidden="true">
      <div
        v-for="(row, index) in [
          { title: 'w-3/5', author: 'w-2/5' },
          { title: 'w-1/2', author: 'w-1/3' },
          { title: 'w-2/3', author: 'w-2/5' },
        ]"
        :key="index"
        class="row flex min-h-(--size-row) items-center gap-ms py-xs pr-md pl-md"
        :style="{ '--n': 2 - index }"
      >
        <span class="ghost-cover shimmer shrink-0 rounded-cover-sm" />
        <span class="flex flex-1 flex-col gap-xs">
          <span class="ghost-line shimmer rounded-pill" :class="row.title" />
          <span class="ghost-line shimmer rounded-pill" :class="row.author" />
          <span class="ghost-line shimmer w-(--size-cover-xs) rounded-pill" />
        </span>
      </div>
    </div>

    <!-- b: pages riffling -->
    <div v-else-if="variant === 'b'" class="flex flex-col items-center gap-ms py-lg">
      <span class="book" aria-hidden="true">
        <span v-for="page in 5" :key="page" class="page" :style="{ '--n': page - 1 }" />
      </span>
      <p class="text-caption text-ink-faint" aria-hidden="true">{{ t('search.loadingShelves') }}</p>
    </div>

    <!-- c: slabs in a wave -->
    <div v-else-if="variant === 'c'" class="flex items-end justify-center gap-sm py-xl" aria-hidden="true">
      <span v-for="slab in 5" :key="slab" class="slab rounded-cover-sm" :style="{ '--n': slab - 1 }" />
    </div>

    <!-- d: the phrase, in the serif -->
    <div v-else-if="variant === 'd'" class="flex items-center justify-center gap-sm px-lg py-xl" aria-hidden="true">
      <span class="book-title min-w-0 truncate text-headline text-ink">{{ query }}</span>
      <span class="dots mt-xs flex shrink-0 gap-xs">
        <span v-for="dot in 3" :key="dot" class="size-(--spacing-xs) rounded-pill bg-ink-faint" :style="{ '--n': dot - 1 }" />
      </span>
    </div>

    <!-- e: ghost rows and a lamp hairline -->
    <div v-else class="relative flex flex-col pt-xs pb-sm" aria-hidden="true">
      <div
        v-for="(row, index) in [
          { title: 'w-1/2', author: 'w-1/3' },
          { title: 'w-3/5', author: 'w-2/5' },
        ]"
        :key="index"
        class="row breathe flex min-h-(--size-row) items-center gap-ms py-xs pr-md pl-md"
        :style="{ '--n': 1 - index }"
      >
        <span class="ghost-cover shrink-0 rounded-cover-sm bg-fill" />
        <span class="flex flex-1 flex-col gap-xs">
          <span class="ghost-line rounded-pill bg-fill" :class="row.title" />
          <span class="ghost-line rounded-pill bg-fill" :class="row.author" />
        </span>
      </div>
      <span class="sweep" />
    </div>

    <span class="sr-only">{{ variant === 'b' ? t('search.loadingShelves') : t('search.loading') }}</span>
  </div>
</template>

<style scoped>
/* Nothing for `loadingWait` in Results.vue (the typing pause and `quick`), then the state fades in: a fast answer shows no loading at all. */
.loading {
  animation: loading-in var(--duration-standard) var(--ease-standard) var(--loading-wait, var(--duration-quick)) both;
}
@keyframes loading-in {
  from {
    opacity: 0;
  }
}

.ghost-cover {
  width: var(--size-cover-sm);
  aspect-ratio: 2 / 3;
}
.ghost-line {
  display: block;
  height: var(--spacing-sm);
}
/* a's shapes at rest; the shimmer is a highlight over them. Each row has its own phase (--n), so it reads as one soft diagonal. */
.loading-a .ghost-cover,
.loading-a .ghost-line {
  background-color: var(--color-fill);
}

/* ---- a: a highlight rolls down the three rows, the best match (the bottom row) first ---- */
.loading-a .row {
  animation: row-in var(--duration-standard) var(--ease-standard) calc(var(--loading-wait, var(--duration-quick)) + var(--n) * var(--duration-instant) * 0.8) both;
}
@keyframes row-in {
  from {
    opacity: 0;
    translate: 0 var(--spacing-xs);
  }
}
.shimmer {
  background-image: linear-gradient(90deg, transparent 30%, var(--color-fill-strong) 50%, transparent 70%);
  background-size: 300% 100%;
  background-repeat: no-repeat;
  animation: shimmer calc(var(--duration-caret) * 1.5) linear calc(var(--n, 0) * var(--duration-instant) * -1.5) infinite;
}
@keyframes shimmer {
  from {
    background-position: 100% 0;
  }
  to {
    background-position: 0 0;
  }
}

/* ---- b: five pages hinged at the spine flip over and back ---- */
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

/* ---- c: five slabs, the wave travels left to right ---- */
.slab {
  display: block;
  width: var(--size-cover-xs);
  aspect-ratio: 2 / 3;
  background-color: var(--color-fill-strong);
  opacity: 0.6;
  animation: slab calc(var(--duration-caret) * 1.4) var(--ease-standard) calc(var(--n) * var(--duration-instant) * 1.4) infinite alternate;
}
@keyframes slab {
  from {
    translate: 0 0;
    opacity: 0.6;
  }
  to {
    translate: 0 calc(var(--spacing-sm) * -1);
    opacity: 1;
  }
}

/* ---- d: the ellipsis breathes, one dot after the other ---- */
.dots span {
  display: block;
  opacity: 0.3;
  animation: dot var(--duration-caret) var(--ease-standard) calc(var(--n) * var(--duration-instant) * 2) infinite alternate;
}
@keyframes dot {
  to {
    opacity: 1;
  }
}

/* ---- e: the rows breathe, a lamp-coloured hairline sweeps above the query ---- */
.breathe {
  animation: breathe calc(var(--duration-caret) * 1.4) ease-in-out calc(var(--n) * var(--duration-instant) * 2) infinite alternate;
}
@keyframes breathe {
  from {
    opacity: 0.5;
  }
}
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

/* Reduce Motion: every idea rests as a still picture, with no movement at all. */
@media (prefers-reduced-motion: reduce) {
  .shimmer,
  .page,
  .slab,
  .dots span,
  .breathe,
  .sweep::after {
    animation: none;
  }
  .slab {
    opacity: 1;
  }
  .dots span {
    opacity: 1;
  }
  .sweep::after {
    width: 100%;
    background: var(--color-hairline-strong);
  }
}
</style>
