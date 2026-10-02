<script setup lang="ts">
// The floating tab bar, iOS 26 style: a frosted capsule with Home and Library,
// and Search as its own frosted circle at the right. On the Search tab the
// capsule folds into one circle (back to the last tab) and the search field
// takes the rest of the row — pass it as the default slot.
import Icon from './Icon.vue'

defineProps<{ active: 'home' | 'library' | 'search' }>()

const tabs = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'library', label: 'Library', icon: 'library' },
] as const
</script>

<template>
  <nav class="tabbar" aria-label="Tabs">
    <template v-if="active !== 'search'">
      <div class="capsule ad-glass">
        <span
          v-for="tab in tabs"
          :key="tab.key"
          class="tab"
          :class="{ on: tab.key === active }"
          :aria-current="tab.key === active ? 'page' : undefined"
        >
          <Icon :name="tab.icon" :size="25" :filled="tab.key === active" :stroke="1.6" />
          <span class="label">{{ tab.label }}</span>
        </span>
      </div>
      <span class="circle ad-glass" aria-label="Search">
        <Icon name="search" :size="25" :stroke="1.9" />
      </span>
    </template>

    <template v-else>
      <span class="circle small ad-glass" aria-label="Library">
        <Icon name="library" :size="23" :stroke="1.6" />
      </span>
      <div class="field-slot"><slot /></div>
    </template>
  </nav>
</template>

<style scoped>
.tabbar {
  position: absolute;
  inset: auto 0 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 20px 22px;
  pointer-events: none;
}

.tabbar > * {
  pointer-events: auto;
}

/* iOS 26's scroll-edge effect: content softens towards the floating bar. */
.tabbar::before {
  content: '';
  position: absolute;
  inset: -36px 0 0;
  z-index: -1;
  background: linear-gradient(180deg, rgb(var(--ad-paper-rgb) / 0), rgb(var(--ad-paper-rgb) / 0.55) 60%, rgb(var(--ad-paper-rgb) / 0.8));
  pointer-events: none;
}

.capsule {
  display: flex;
  flex: 1;
  height: 62px;
  padding: 4px;
  border-radius: 999px;
}

.tab {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  border-radius: 999px;
  color: var(--ad-ink);
}

.tab.on {
  color: var(--ad-accent);
  background: rgb(var(--ad-tint) / 0.075);
}

.label {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.tab:not(.on) .label {
  font-weight: 500;
}

.circle {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 62px;
  height: 62px;
  border-radius: 999px;
  color: var(--ad-ink);
}

.circle :deep(svg),
.tab :deep(svg) {
  position: relative;
  z-index: 1;
}

.circle.small {
  width: 52px;
  height: 52px;
}

.field-slot {
  flex: 1;
  min-width: 0;
}
</style>
