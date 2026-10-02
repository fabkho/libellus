<script setup lang="ts">
// A 44 pt square target holding one icon (nav actions, quick add).
import type { IconName } from './type'
import Icon from './Icon.vue'

withDefaults(defineProps<{ name: IconName; size?: number; ring?: boolean }>(), { size: 22 })
</script>

<template>
  <span class="icon-button" :class="{ ringed: ring }">
    <span class="mark"><Icon :name="name" :size="ring ? 16 : size" :stroke="ring ? 1.5 : 1.4" /></span>
  </span>
</template>

<style scoped>
.icon-button {
  display: inline-flex;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: var(--b-ink);
}

.mark {
  display: flex;
  align-items: center;
  justify-content: center;
}

.ringed .mark {
  width: 32px;
  height: 32px;
  border: 1px solid var(--b-rule-strong);
  border-radius: 50%;
}
</style>
