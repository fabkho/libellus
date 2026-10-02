<script setup lang="ts">
// The three tabs on a floating, chunky paper bar. The active tab sits in a
// soft pill with the solid icon; the bar casts a lifted shadow.
import Icon from './Icon.vue'

defineProps<{ active: 'home' | 'library' | 'search' }>()

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'library', label: 'Library' },
  { key: 'search', label: 'Search' },
] as const
</script>

<template>
  <div class="tabbar-wrap">
    <nav class="tabbar">
      <span v-for="tab in tabs" :key="tab.key" class="tab" :class="{ active: tab.key === active }">
        <Icon :name="tab.key" :size="24" :filled="tab.key === active" />
        <span class="label">{{ tab.label }}</span>
      </span>
    </nav>
  </div>
</template>

<style scoped>
.tabbar-wrap {
  position: absolute;
  inset: auto 0 0;
  z-index: 15;
  padding: 18px 16px calc(var(--safe-bottom) - 6px);
  background: linear-gradient(180deg, transparent, var(--c-paper) 42%);
  pointer-events: none;
}

.tabbar {
  display: flex;
  gap: 4px;
  height: 64px;
  padding: 6px;
  border-radius: 26px;
  background: var(--c-card);
  box-shadow:
    0 0 0 1px var(--c-line),
    0 10px 24px -8px rgb(var(--c-shadow) / 0.28),
    0 2px 4px rgb(var(--c-shadow) / 0.06);
  pointer-events: auto;
}

.tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 20px;
  color: var(--c-muted);
}

.label {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.active {
  background: var(--c-mustard-soft);
  color: var(--c-ink);
}

.active .label {
  font-weight: 800;
}

[data-palette='ink'] .active {
  background: rgb(245 193 88 / 0.16);
  color: var(--c-mustard);
}
</style>
