<script setup lang="ts">
// The floating tab bar from A and D: a frosted capsule with Home and Library,
// and Search as its own frosted circle on the right. The active tab sits in a
// soft pill with the solid icon in the accent.
import Icon from './Icon.vue'

defineProps<{ active: 'home' | 'library' | 'search' }>()

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'library', label: 'Library' },
] as const
</script>

<template>
  <nav class="tabbar" aria-label="Tabs">
    <div class="capsule c1-glass">
      <span
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ on: tab.key === active }"
        :aria-current="tab.key === active ? 'page' : undefined"
      >
        <Icon :name="tab.key" :size="24" :filled="tab.key === active" />
        <span class="label">{{ tab.label }}</span>
      </span>
    </div>
    <span class="circle c1-glass" :class="{ on: active === 'search' }" aria-label="Search">
      <Icon name="search" :size="24" />
    </span>
  </nav>
</template>

<style scoped>
.tabbar {
  position: absolute;
  inset: auto 0 0;
  z-index: 15;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px 22px;
  pointer-events: none;
}

.tabbar > * {
  pointer-events: auto;
}

/* Content softens towards the floating bar. */
.tabbar::before {
  content: '';
  position: absolute;
  inset: -40px 0 0;
  z-index: -1;
  background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--c1-paper) 80%, transparent) 65%);
  pointer-events: none;
}

.capsule {
  display: flex;
  flex: 1;
  height: 60px;
  padding: 4px;
  border-radius: 999px;
}

.tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-radius: 999px;
  color: var(--c1-ink);
}

.tab.on {
  background: color-mix(in srgb, var(--c1-ink) 7%, transparent);
  color: var(--c1-accent);
}

.label {
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.on .label {
  font-weight: 600;
}

.circle {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  width: 60px;
  height: 60px;
  border-radius: 999px;
  color: var(--c1-ink);
}

.circle.on {
  color: var(--c1-accent);
}
</style>
