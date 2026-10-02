<script setup lang="ts">
// The light a cover throws into the room: two soft pools from the cover's own
// colours, fading into the room colour, with a whisper of grain so the
// gradient never bands. Absolutely positioned.
import type { CoverColors } from '../../../data'
import { glowStyle } from './night'

withDefaults(defineProps<{ colors: CoverColors | null; shape?: 'page' | 'card' }>(), { shape: 'page' })
</script>

<template>
  <div class="d-ambient ambient" :class="`shape-${shape}`" :style="glowStyle(colors)" aria-hidden="true">
    <span class="grain" />
  </div>
</template>

<style scoped>
.ambient {
  position: absolute;
  pointer-events: none;
  opacity: var(--d-glow-k);
}

.shape-page {
  inset: 0 0 auto;
  height: 600px;
  background:
    radial-gradient(70% 46% at 50% 26%, rgb(var(--glow-a) / 0.5), transparent 72%),
    radial-gradient(60% 34% at 92% 4%, rgb(var(--glow-b) / 0.28), transparent 70%),
    radial-gradient(55% 30% at 6% 10%, rgb(var(--glow-a) / 0.22), transparent 70%),
    linear-gradient(to bottom, rgb(var(--glow-a) / 0.16), transparent 82%);
}

.shape-card {
  inset: 0;
  background:
    radial-gradient(60% 95% at 12% 55%, rgb(var(--glow-a) / 0.6), transparent 72%),
    radial-gradient(55% 90% at 100% 0%, rgb(var(--glow-b) / 0.22), transparent 72%),
    linear-gradient(100deg, rgb(var(--glow-a) / 0.22), rgb(var(--glow-a) / 0.04) 80%);
}

.grain {
  position: absolute;
  inset: 0;
  opacity: 0.07;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
</style>
