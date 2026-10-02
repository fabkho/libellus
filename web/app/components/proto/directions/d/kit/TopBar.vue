<script setup lang="ts">
// The top of a pushed screen: round glass buttons (back, trailing actions)
// that float over the cover's light, and an optional small centred title.
import Icon from './Icon.vue'
import type { IconName } from './night'

defineProps<{ title?: string; trailing?: IconName[] }>()
</script>

<template>
  <header class="k-top">
    <span class="round" aria-label="Back"><Icon name="back" :size="20" /></span>
    <span v-if="title" class="title">{{ title }}</span>
    <span class="trail">
      <span v-for="name in trailing" :key="name" class="round"><Icon :name="name" :size="20" /></span>
    </span>
  </header>
</template>

<style scoped>
.k-top {
  position: relative;
  z-index: 5;
  display: flex;
  height: 44px;
  margin-top: var(--safe-top);
  padding: 0 14px;
  align-items: center;
  justify-content: space-between;
}

.round {
  display: flex;
  width: 38px;
  height: 38px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--d-glass);
  box-shadow: inset 0 0 0 0.5px var(--d-line-2);
  color: var(--d-ink);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.title {
  position: absolute;
  left: 50%;
  font-size: 15px;
  font-weight: 500;
  transform: translateX(-50%);
}

.trail {
  display: flex;
  gap: 8px;
}
</style>
