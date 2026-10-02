<script setup lang="ts">
// The three tabs, set like a page footer: a hairline, three small-caps
// words with their marks, the current one in the accent with a short rule over
// it. Pinned above the home indicator; each tab is a full-height target.
import Icon from './Icon.vue'

defineProps<{ active: 'home' | 'library' | 'search' }>()

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'library', label: 'Library' },
  { key: 'search', label: 'Search' },
] as const
</script>

<template>
  <nav class="tabbar">
    <span v-for="tab in tabs" :key="tab.key" class="tab" :class="{ active: tab.key === active }">
      <Icon :name="tab.key" :size="24" :stroke="tab.key === active ? 1.6 : 1.3" />
      <span class="b-label">{{ tab.label }}</span>
    </span>
  </nav>
</template>

<style scoped>
.tabbar {
  position: absolute;
  inset: auto 0 0;
  z-index: 10;
  display: flex;
  padding: 0 calc(var(--b-margin) - 8px) var(--safe-bottom);
  border-top: 1px solid var(--b-rule-strong);
  background: var(--b-paper);
}

.tab {
  position: relative;
  display: flex;
  flex: 1;
  height: 52px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--b-ink-3);
}

.tab .b-label {
  font-size: 9.5px;
  line-height: 12px;
  letter-spacing: 0.16em;
}

.tab.active {
  color: var(--b-accent);
}

.tab.active::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 50%;
  width: 28px;
  border-top: 2px solid var(--b-accent);
  transform: translateX(-50%);
}
</style>
