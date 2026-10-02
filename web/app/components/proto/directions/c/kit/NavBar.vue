<script setup lang="ts">
// Top of a screen. Root tabs: big serif title and the account avatar.
// Pushed screens: a round back button (44pt), an optional small title and
// trailing round buttons. `tone="float"` puts the buttons on paper discs so
// they read over a coloured hero.
import Avatar from './Avatar.vue'
import Icon from './Icon.vue'

withDefaults(
  defineProps<{ title?: string; back?: string; avatar?: boolean; tone?: 'plain' | 'float'; kicker?: string }>(),
  { tone: 'plain' },
)
</script>

<template>
  <header class="nav" :class="tone">
    <div v-if="back" class="bar">
      <span class="round back" :aria-label="back"><Icon name="back" :size="22" /></span>
      <span class="trailing"><slot name="trailing" /></span>
    </div>
    <div v-else class="root">
      <div class="titles">
        <span v-if="kicker" class="kicker">{{ kicker }}</span>
        <h1 class="title">{{ title }}</h1>
      </div>
      <slot name="trailing"><Avatar v-if="avatar" /></slot>
    </div>
    <h1 v-if="back && title" class="title pushed">{{ title }}</h1>
  </header>
</template>

<style scoped>
.nav {
  position: relative;
  z-index: 5;
  flex-shrink: 0;
  padding: var(--safe-top) 20px 0;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  margin: 0 -6px;
}

.trailing {
  display: flex;
  gap: 8px;
}

.round,
.trailing :deep(.round) {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  color: var(--c-ink);
}

.float .round,
.float .trailing :deep(.round) {
  background: color-mix(in srgb, var(--c-card) 82%, transparent);
  box-shadow: 0 2px 8px -2px rgb(var(--c-shadow) / 0.2);
  backdrop-filter: blur(8px);
}

.plain .round,
.plain .trailing :deep(.round) {
  background: var(--c-card);
  box-shadow: 0 0 0 1px var(--c-line);
}

.root {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 0 6px;
}

.titles {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.kicker {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--c-ink-soft);
}

.title {
  margin: 0;
  font-family: var(--c-serif);
  font-size: 34px;
  font-weight: 400;
  line-height: 1.1;
  letter-spacing: -0.01em;
}

.title.pushed {
  padding: 6px 0 4px;
  font-size: 32px;
}
</style>
