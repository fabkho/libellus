<script setup lang="ts">
// The top of a pushed screen (book detail, a collection): round glass buttons
// that float over the cover's light — back on the left, actions on the right
// (slot `trailing`, use UiRoundButton) — and an optional small centred title.
defineProps<{ title?: string; backLabel: string; backTestid: string }>()
defineEmits<{ back: [] }>()
</script>

<template>
  <header class="safe-top relative z-10">
    <div class="relative flex h-(--size-touch) items-center justify-between px-inset">
      <UiRoundButton icon="back" :label="backLabel" :data-testid="backTestid" @click="$emit('back')" />
      <span v-if="title" class="absolute left-1/2 -translate-x-1/2 truncate text-body font-medium">{{ title }}</span>
      <span class="flex gap-sm"><slot name="trailing" /></span>
    </div>
  </header>
</template>
