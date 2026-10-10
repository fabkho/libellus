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

// The grain's filter and pattern are referenced by id: one pair per instance.
const grain = useId()

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
    <!-- The grain is an inline SVG, not a background image: Chrome reports a background image as a
         Largest Contentful Paint candidate, and this one (a decorative 160 px tile at 7 %) was the
         page's LCP element, so the number said when the grain painted, not when the content did.
         The same filter, drawn as a repeating pattern, looks the same. -->
    <svg class="grain" focusable="false">
      <defs>
        <filter :id="`${grain}-noise`">
          <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch" />
        </filter>
        <pattern :id="`${grain}-tile`" width="160" height="160" patternUnits="userSpaceOnUse">
          <rect width="160" height="160" :filter="`url(#${grain}-noise)`" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" :fill="`url(#${grain}-tile)`" />
    </svg>
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
  width: 100%;
  height: 100%;
  opacity: 0.07;
  mix-blend-mode: overlay;
}
</style>
