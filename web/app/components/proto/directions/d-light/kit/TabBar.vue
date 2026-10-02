<script setup lang="ts">
// The three tabs as a small floating capsule of icons over a fade to the room
// colour — the content runs on underneath. The active tab is full ink with a
// lamp-coloured dot; the others recede.
import Icon from './Icon.vue'

defineProps<{ active: 'home' | 'library' | 'search' }>()

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'library', label: 'Library' },
  { key: 'search', label: 'Search' },
] as const
</script>

<template>
  <div class="fade" aria-hidden="true" />
  <nav class="bar" aria-label="Tabs">
    <span
      v-for="tab in tabs"
      :key="tab.key"
      class="tab"
      :class="{ active: tab.key === active }"
      :aria-label="tab.label"
      :aria-current="tab.key === active ? 'page' : undefined"
    >
      <Icon :name="tab.key" :size="23" :stroke="tab.key === active ? 1.7 : 1.5" />
      <span class="dot" />
    </span>
  </nav>
</template>

<style scoped>
.fade {
  position: absolute;
  inset: auto 0 0;
  z-index: 9;
  height: 128px;
  background: linear-gradient(to bottom, transparent, var(--dl-bg) 62%);
  pointer-events: none;
}

.bar {
  position: absolute;
  bottom: calc(var(--safe-bottom) - 4px);
  left: 50%;
  z-index: 10;
  display: flex;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--dl-glass);
  box-shadow:
    inset 0 0 0 0.5px var(--dl-line-2),
    0 12px 30px rgb(0 0 0 / 0.35);
  transform: translateX(-50%);
  backdrop-filter: blur(22px) saturate(1.6);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
}

.tab {
  position: relative;
  display: flex;
  width: 62px;
  height: 52px;
  align-items: center;
  justify-content: center;
  color: var(--dl-ink-3);
}

.tab.active {
  color: var(--dl-ink);
}

.dot {
  position: absolute;
  bottom: 6px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--dl-lamp);
  opacity: 0;
}

.active .dot {
  opacity: 1;
}
</style>
