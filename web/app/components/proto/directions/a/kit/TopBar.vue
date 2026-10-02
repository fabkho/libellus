<script setup lang="ts">
// A pushed screen's toolbar: only floating frosted circles over the content,
// no bar behind them. Back at the left, actions at the right (slot).
import RoundButton from './RoundButton.vue'

defineProps<{ noBack?: boolean }>()
</script>

<template>
  <div class="topbar">
    <RoundButton v-if="!noBack" icon="back" />
    <span v-else />
    <div class="actions"><slot /></div>
  </div>
</template>

<style scoped>
.topbar {
  position: absolute;
  inset: calc(var(--safe-top) + 2px) 0 auto;
  z-index: 25;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
}

.actions {
  display: flex;
  gap: 10px;
}
</style>
