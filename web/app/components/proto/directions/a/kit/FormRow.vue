<script setup lang="ts">
// One row of a FormGroup: label at the left, value (or a placeholder, or a
// date capsule) at the right; `focus` puts the caret after the value.
defineProps<{
  label: string
  value?: string
  placeholder?: string
  focus?: boolean
  required?: boolean
  date?: boolean
  stacked?: boolean
}>()
</script>

<template>
  <div class="row" :class="{ stacked }">
    <span class="label">{{ label }}<span v-if="required" class="req">Required</span></span>
    <span v-if="date" class="date">{{ value }}</span>
    <span v-else class="value" :class="{ empty: !value }">
      {{ value || placeholder }}<span v-if="focus" class="caret" />
    </span>
    <slot />
  </div>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 50px;
  padding: 0 16px;
}

.stacked {
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  gap: 1px;
  min-height: 60px;
  padding: 9px 16px;
}

.label {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--a-ink);
  font-size: 16px;
  white-space: nowrap;
}

.stacked .label {
  color: var(--a-ink-2);
  font-size: 12.5px;
  font-weight: 500;
}

.req {
  color: var(--a-ink-3);
  font-size: 11.5px;
  font-weight: 500;
}

.value {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  color: var(--a-ink);
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.stacked .value {
  font-size: 17px;
}

.value.empty {
  color: var(--a-ink-3);
}

.caret {
  display: inline-block;
  width: 2px;
  height: 21px;
  margin-left: 1px;
  border-radius: 1px;
  background: var(--a-accent);
}

.date {
  padding: 6px 11px;
  border-radius: 9px;
  background: rgb(52 40 20 / 0.065);
  color: var(--a-accent-ink);
  font-size: 15.5px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
</style>
