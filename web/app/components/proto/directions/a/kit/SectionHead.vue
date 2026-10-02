<script setup lang="ts">
// A section heading: serif, with an optional quiet trailing action.
defineProps<{ title: string; action?: string; chevron?: boolean }>()
</script>

<template>
  <div class="head">
    <h2 class="a-serif">
      {{ title }}<svg v-if="chevron" width="15" height="15" viewBox="0 0 24 24" class="chev"><path d="m9.5 5.8 6.2 6.2-6.2 6.2" /></svg>
    </h2>
    <slot name="trailing">
      <span v-if="action" class="action">{{ action }}</span>
    </slot>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin: 0;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}

.chev {
  fill: none;
  stroke: var(--a-ink-3);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-linejoin: round;
  transform: translateY(1px);
}

.action {
  color: var(--a-accent);
  font-size: 15px;
  font-weight: 500;
}
</style>
