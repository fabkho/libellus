<script setup lang="ts">
// A labelled input, drawn in one state. `focus` shows the caret after the
// value and a mustard focus ring; `lined` draws ruled paper under the text.
defineProps<{
  label?: string
  value?: string
  placeholder?: string
  hint?: string
  focus?: boolean
  multiline?: boolean
  required?: boolean
}>()
</script>

<template>
  <label class="field">
    <span v-if="label" class="label"
      >{{ label }}<span v-if="required" class="req" aria-label="required">*</span></span
    >
    <span class="box" :class="{ focus, multiline }">
      <slot name="leading" />
      <span v-if="value" class="value"
        >{{ value }}<span v-if="focus" class="caret"
      /></span>
      <span v-else class="placeholder"><span v-if="focus" class="caret" />{{ placeholder }}</span>
      <slot name="trailing" />
    </span>
    <span v-if="hint" class="hint">{{ hint }}</span>
  </label>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--c-ink-soft);
}

.req {
  margin-left: 2px;
  color: var(--c-accent);
}

.box {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 16px;
  border-radius: 16px;
  background: var(--c-field);
  box-shadow: inset 0 0 0 1.5px var(--c-line-strong);
  font-size: 17px;
}

.box.focus {
  box-shadow:
    inset 0 0 0 2px var(--c-ink),
    0 0 0 4px color-mix(in srgb, var(--c-mustard) 45%, transparent);
}

.box.multiline {
  align-items: flex-start;
  min-height: 96px;
  padding: 12px 16px;
  line-height: 1.4;
}

.value {
  flex: 1;
  min-width: 0;
  color: var(--c-ink);
}

.placeholder {
  flex: 1;
  color: var(--c-muted);
}

.caret {
  display: inline-block;
  width: 2px;
  height: 1.15em;
  margin-left: 1px;
  vertical-align: -0.2em;
  border-radius: 1px;
  background: var(--c-accent);
}

.hint {
  font-size: 13px;
  color: var(--c-ink-soft);
}
</style>
