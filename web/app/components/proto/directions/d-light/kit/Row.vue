<script setup lang="ts">
// One row in a `.dl-group`: label left, value right (or a placeholder), with a
// lamp caret when focused. 48 px tall, hairline divider inset under the text.
import Icon from './Icon.vue'
import type { IconName } from './night'

defineProps<{
  label: string
  value?: string
  placeholder?: string
  focus?: boolean
  required?: boolean
  icon?: IconName
  chevron?: boolean
  mono?: boolean
}>()
</script>

<template>
  <div class="k-row" :class="{ focus }">
    <Icon v-if="icon" :name="icon" :size="18" class="icon" />
    <span class="label">{{ label }}<span v-if="required" class="req">*</span></span>
    <span class="value" :class="{ mono }">
      <template v-if="value">{{ value }}</template>
      <span v-else class="placeholder">{{ placeholder }}</span>
      <span v-if="focus" class="dl-caret" />
    </span>
    <Icon v-if="chevron" name="chevron" :size="15" :stroke="1.7" class="chev" />
  </div>
</template>

<style scoped>
.k-row {
  position: relative;
  display: flex;
  height: 48px;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  font-size: 15px;
}

.k-row + .k-row::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 14px;
  height: 0.5px;
  content: '';
  background: var(--dl-line-2);
}

.focus {
  background: var(--dl-lamp-soft);
}

.icon {
  color: var(--dl-ink-3);
}

.label {
  flex-shrink: 0;
  color: var(--dl-ink-2);
}

.req {
  margin-left: 2px;
  color: var(--dl-lamp);
}

.value {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  justify-content: flex-end;
  overflow: hidden;
  white-space: nowrap;
  text-align: right;
}

.value.mono {
  font-family: var(--dl-mono);
  font-size: 13.5px;
  font-variant-numeric: tabular-nums;
}

.placeholder {
  color: var(--dl-ink-4);
}

.chev {
  margin-right: -4px;
  color: var(--dl-ink-4);
}
</style>
