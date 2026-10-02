<script setup lang="ts">
// The top of a root tab: a large serif title, the account avatar at the right.
// No bar behind it: the title scrolls with the content (static header).
import Avatar from './Avatar.vue'

defineProps<{ title: string; eyebrow?: string; avatar?: boolean }>()
</script>

<template>
  <header class="large">
    <div class="text">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h1 class="title ad-serif">{{ title }}</h1>
    </div>
    <slot name="trailing"><Avatar v-if="avatar" /></slot>
  </header>
</template>

<style scoped>
.large {
  display: flex;
  flex-shrink: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding: calc(var(--safe-top) + 14px) 20px 0;
}

.eyebrow {
  margin: 0 0 2px;
  color: var(--ad-ink-3);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.title {
  margin: 0;
  font-size: 36px;
  font-weight: 600;
  line-height: 1.05;
}

.large > :last-child:not(.text) {
  margin-bottom: 3px;
}
</style>
