<script setup lang="ts">
// A form field as a ruled line on paper: small-caps label, the value in the
// text face, one hairline under it (ink and heavier when focused, with an
// accent caret at the end of the value).
withDefaults(
  defineProps<{
    label: string
    value?: string
    placeholder?: string
    focus?: boolean
    multiline?: boolean
    hint?: string
    italic?: boolean
  }>(),
  {},
)
</script>

<template>
  <label class="field" :class="{ focus, multiline }">
    <span class="top">
      <span class="b-label">{{ label }}</span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </span>
    <span class="line">
      <span class="value" :class="{ empty: !value, slanted: italic }"
        >{{ value || placeholder }}<span v-if="focus" class="caret" /></span>
      <slot name="trailing" />
    </span>
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
}

.top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: var(--b-ink-2);
}

.hint {
  font-size: 12px;
  font-style: italic;
  line-height: 16px;
  color: var(--b-ink-3);
}

.line {
  display: flex;
  min-height: 44px;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--b-rule-strong);
  color: var(--b-ink);
}

.focus .line {
  border-bottom: 1.5px solid var(--b-ink);
}

.multiline .line {
  align-items: flex-start;
  padding: 6px 0 10px;
}

.value {
  flex: 1;
  font-size: 18px;
  line-height: 24px;
  font-variant-numeric: lining-nums;
}

.value.slanted {
  font-style: italic;
}

.value.empty {
  color: var(--b-ink-3);
  font-style: italic;
}

.multiline .value {
  font-size: 17px;
}

.caret {
  display: inline-block;
  width: 2px;
  height: 21px;
  margin-left: 1px;
  background: var(--b-accent);
  vertical-align: -4px;
}
</style>
