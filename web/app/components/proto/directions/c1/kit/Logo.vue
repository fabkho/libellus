<script setup lang="ts">
// Libellus' mark in this direction: three spines on a tile, the last one
// leaning, with a bookmark sticking out — the shelf in one glyph.
withDefaults(defineProps<{ size?: number }>(), { size: 56 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 56 56" class="logo" aria-label="Libellus">
    <rect x="0" y="0" width="56" height="56" rx="17" class="tile" />
    <rect x="12" y="13" width="9" height="30" rx="2.5" class="s1" />
    <rect x="23" y="17" width="8" height="26" rx="2.5" class="s2" />
    <path d="M26.5 17v-5" class="mark" />
    <rect x="34" y="15" width="8" height="28" rx="2.5" transform="rotate(-14 34 43)" class="s3" />
    <rect x="9" y="43" width="38" height="4" rx="2" class="plank" />
  </svg>
</template>

<style scoped>
.logo {
  filter: drop-shadow(0 6px 10px rgb(var(--c1-shadow) / 0.25));
}

.tile {
  fill: var(--c1-mustard);
}

.s1 {
  fill: var(--c1-ink);
}

.s2 {
  fill: var(--c1-teal);
}

.s3 {
  fill: var(--c1-accent);
}

[data-theme='dark'] .s1 {
  fill: var(--c1-paper);
}

.mark {
  stroke: var(--c1-accent);
  stroke-width: 3;
  stroke-linecap: round;
}

.plank {
  fill: var(--c1-wood-dark);
}
</style>
