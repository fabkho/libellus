<script setup lang="ts">
// A labelled input, drawn in one state. `focus` shows the caret after the value.
defineProps<{
  label?: string
  value?: string
  placeholder?: string
  hint?: string
  focus?: boolean
  multiline?: boolean
}>()
</script>

<template>
  <label class="flex flex-col gap-1">
    <span v-if="label" class="text-[13px] font-medium text-neutral-600">{{ label }}</span>
    <span
      class="flex rounded-lg border bg-white px-3 text-[16px]"
      :class="[
        focus ? 'border-neutral-800 ring-2 ring-neutral-300' : 'border-neutral-300',
        multiline ? 'min-h-[104px] items-start py-3 leading-snug' : 'h-12 items-center',
      ]"
    >
      <span v-if="value" class="text-neutral-900"
        >{{ value }}<span v-if="focus" class="ml-[1px] inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-neutral-900"
      /></span>
      <span v-else class="text-neutral-400">{{ placeholder }}</span>
      <slot name="trailing" />
    </span>
    <span v-if="hint" class="text-[12px] text-neutral-500">{{ hint }}</span>
  </label>
</template>
