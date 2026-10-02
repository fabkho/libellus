<script setup lang="ts">
// Stands in for a screen key the direction has not built yet.
defineProps<{ screen: string }>()
</script>

<template>
  <div class="not-built">
    <p class="title">Not built</p>
    <p class="key">{{ screen }}</p>
  </div>
</template>

<style scoped>
.not-built {
  display: flex;
  height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  background: repeating-linear-gradient(-45deg, #f4f4f5 0 12px, #e9e9eb 12px 24px);
  color: #71717a;
  font: 500 15px/1.3 system-ui, sans-serif;
}

.key {
  font: 13px/1 ui-monospace, monospace;
}
</style>
