<script setup lang="ts">
// The light a cover throws into the room: two soft pools in the cover's own
// precomputed colours, fading into the surface, with a whisper of grain so the
// gradient never bands. Absolutely positioned: put it first inside a card
// (`shape="card"`) or a page header (`shape="page"`) that is `relative`.
// Full strength in the dark, half on paper (`--opacity-glow`). A Book whose
// cover is the Placeholder has no colours worth lighting the room with: `cloth`
// (the cloth's colour, as CSS) lights it instead, so the page matches what shows.
import type { CoverColors } from '~/utils/cover'

const props = withDefaults(defineProps<{ colors: CoverColors | null; cloth?: string | null; shape?: 'page' | 'card' }>(), {
  cloth: null,
  shape: 'page',
})

// Two pool colours as whole colours, so a gradient can take them at any alpha.
const style = computed(() => {
  if (props.cloth) {
    // A cloth is dark: lifted towards white, keeping its hue, so it reads as light.
    const lit = `color-mix(in srgb, ${props.cloth} 55%, white)`
    return { '--pool-a': lit, '--pool-b': props.cloth }
  }
  const glow = glowOf(props.colors)
  return { '--pool-a': `rgb(${glow.a})`, '--pool-b': `rgb(${glow.b})` }
})
</script>

<template>
  <div class="ambient" :class="`shape-${shape}`" :style="style" aria-hidden="true">
    <span class="grain" />
  </div>
</template>

<style scoped>
.ambient {
  position: absolute;
  pointer-events: none;
  opacity: var(--opacity-glow);
}

.shape-page {
  inset: 0 0 auto;
  height: 600px;
  background:
    radial-gradient(70% 46% at 50% 26%, color-mix(in srgb, var(--pool-a) 50%, transparent), transparent 72%),
    radial-gradient(60% 34% at 92% 4%, color-mix(in srgb, var(--pool-b) 28%, transparent), transparent 70%),
    radial-gradient(55% 30% at 6% 10%, color-mix(in srgb, var(--pool-a) 22%, transparent), transparent 70%),
    linear-gradient(to bottom, color-mix(in srgb, var(--pool-a) 16%, transparent), transparent 82%);
}

.shape-card {
  inset: 0;
  background:
    radial-gradient(60% 95% at 12% 55%, color-mix(in srgb, var(--pool-a) 60%, transparent), transparent 72%),
    radial-gradient(55% 90% at 100% 0%, color-mix(in srgb, var(--pool-b) 22%, transparent), transparent 72%),
    linear-gradient(100deg, color-mix(in srgb, var(--pool-a) 22%, transparent), color-mix(in srgb, var(--pool-a) 4%, transparent) 80%);
}

.grain {
  position: absolute;
  inset: 0;
  opacity: 0.07;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
</style>
