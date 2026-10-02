<script setup lang="ts">
// The search field: a frosted capsule floating at the bottom of the Search tab
// (iOS 26), right above the keyboard while typing. `focus` draws the caret.
import Icon from './Icon.vue'

defineProps<{ query?: string; focus?: boolean; placeholder?: string }>()
</script>

<template>
  <div class="field ad-glass" :class="{ focus }" role="searchbox">
    <Icon name="search" :size="19" :stroke="2" class="glass-icon" />
    <span class="text">
      <template v-if="query">{{ query }}</template>
      <span v-else class="placeholder">{{ placeholder ?? 'Title, author or ISBN' }}</span>
      <span v-if="focus" class="caret" />
    </span>
    <span v-if="query" class="clear"><Icon name="clear" :size="19" /></span>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 14px 0 17px;
  border-radius: 999px;
  color: var(--ad-ink);
}

.field > * {
  position: relative;
  z-index: 1;
}

.glass-icon {
  color: var(--ad-ink-2);
}

.text {
  display: flex;
  flex: 1;
  align-items: center;
  min-width: 0;
  font-size: 17px;
  white-space: nowrap;
}

.placeholder {
  color: var(--ad-ink-3);
}

.caret {
  display: inline-block;
  width: 2px;
  height: 22px;
  margin-left: 1px;
  border-radius: 1px;
  background: var(--ad-accent);
}

.clear {
  display: flex;
  color: rgb(var(--ad-tint) / 0.28);
}
</style>
