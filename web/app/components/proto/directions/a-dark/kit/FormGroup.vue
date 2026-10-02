<script setup lang="ts">
// An inset grouped list for forms and settings: matte white, hairline rows.
defineProps<{ footer?: string }>()
</script>

<template>
  <div class="group-wrap">
    <div class="group ad-squircle"><slot /></div>
    <p v-if="footer" class="footer">{{ footer }}</p>
  </div>
</template>

<style scoped>
.group {
  overflow: hidden;
  border-radius: 22px;
  background: var(--ad-card);
  box-shadow: var(--ad-card-shadow);
}

.group > :deep(* + *) {
  border-top: 0.5px solid var(--ad-hair);
}

.footer {
  margin: 7px 16px 0;
  color: var(--ad-ink-2);
  font-size: 13px;
  line-height: 1.35;
}
</style>
