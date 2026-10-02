<script setup lang="ts">
// A section opener: an accent small-caps label, optionally numbered, running
// into a hairline; a trailing link or count on the right.
defineProps<{ label: string; number?: string; ink?: boolean }>()
</script>

<template>
  <div class="kicker">
    <span class="b-label" :class="ink ? '' : 'b-kicker'">
      <span v-if="number" class="number">{{ number }}</span>{{ label }}
    </span>
    <span class="line" />
    <span v-if="$slots.default" class="trailing"><slot /></span>
  </div>
</template>

<style scoped>
.kicker {
  display: flex;
  min-height: 24px;
  align-items: center;
  gap: 10px;
}

.number {
  margin-right: 8px;
  font-family: var(--b-display);
  font-size: 15px;
  font-style: italic;
  letter-spacing: 0;
  text-transform: none;
}

.line {
  flex: 1;
  border-top: 1px solid var(--b-rule);
}

.trailing {
  display: flex;
  align-items: center;
  font-size: 14px;
  font-style: italic;
  line-height: 20px;
  color: var(--b-ink-2);
}
</style>
