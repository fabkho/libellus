<script setup lang="ts">
// The top of a page, like a magazine's running head: a back link (or the
// leading slot) in small caps on the left, a centred folio, actions on the
// right. 44 pt tall, under the status bar.
import Icon from './Icon.vue'

defineProps<{ back?: string; folio?: string }>()
</script>

<template>
  <header class="head">
    <span class="side lead">
      <slot name="leading">
        <span v-if="back" class="back">
          <Icon name="back" :size="20" :stroke="1.6" />
          <span class="b-label">{{ back }}</span>
        </span>
      </slot>
    </span>
    <span v-if="folio" class="folio b-label">{{ folio }}</span>
    <span class="side trail"><slot name="trailing" /></span>
  </header>
</template>

<style scoped>
.head {
  position: relative;
  display: flex;
  height: 44px;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  margin-top: var(--safe-top);
  padding: 0 calc(var(--b-margin) - 10px);
}

.side {
  display: flex;
  min-width: 44px;
  height: 44px;
  align-items: center;
  gap: 4px;
}

.trail {
  justify-content: flex-end;
}

.back {
  display: flex;
  height: 44px;
  align-items: center;
  gap: 2px;
  padding-right: 8px;
  color: var(--b-ink);
}

.back .b-label {
  font-size: 11px;
  letter-spacing: 0.14em;
}

.folio {
  position: absolute;
  left: 50%;
  color: var(--b-ink-3);
  transform: translateX(-50%);
}
</style>
