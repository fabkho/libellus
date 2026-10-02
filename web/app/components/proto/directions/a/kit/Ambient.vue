<script setup lang="ts">
// The soft colour field behind a hero cover: the cover's precomputed dominant
// and secondary colours (never extracted at runtime), blurred into the paper.
import { computed } from 'vue'
import type { CoverColors } from '../../../data'

const props = withDefaults(defineProps<{ colors: CoverColors | null; height?: number }>(), { height: 420 })

const fallback: CoverColors = { dominant: '#d8c8ad', secondary: '#9fb0a4', isDark: false }
const c = computed(() => props.colors ?? fallback)
</script>

<template>
  <div class="ambient" :style="{ height: `${height}px`, '--d': c.dominant, '--s': c.secondary }" aria-hidden="true">
    <span class="blob one" />
    <span class="blob two" />
    <span class="blob three" />
    <span class="fade" />
  </div>
</template>

<style scoped>
.ambient {
  position: absolute;
  inset: 0 0 auto;
  z-index: 0;
  overflow: hidden;
  background: color-mix(in oklab, var(--d) 35%, var(--a-paper));
}

.blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(46px);
  opacity: 0.85;
}

.one {
  top: -90px;
  left: -70px;
  width: 340px;
  height: 340px;
  background: color-mix(in oklab, var(--d) 80%, var(--a-paper));
}

.two {
  top: 30px;
  right: -110px;
  width: 320px;
  height: 300px;
  background: color-mix(in oklab, var(--s) 70%, var(--a-paper));
}

.three {
  top: 190px;
  left: 60px;
  width: 280px;
  height: 200px;
  background: color-mix(in oklab, var(--d) 45%, var(--a-paper));
}

.fade {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgb(246 243 238 / 0) 40%, var(--a-paper) 96%);
}
</style>
