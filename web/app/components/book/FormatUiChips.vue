<script setup lang="ts">
// DESIGN ROUND, dev only: little chips to flip between the format looks while looking.
const { ui, chips, set, all } = useFormatUi()
</script>

<template>
  <div v-if="chips" class="mb-xs flex items-center justify-end gap-xxs text-meta" data-testid="formatUi.chips">
    <span class="mr-xxs text-ink-faint">look</span>
    <button
      v-for="option in all"
      :key="option"
      type="button"
      class="figures rounded-pill px-sm py-xxs"
      :class="ui === option ? 'bg-ink text-on-ink' : 'bg-fill text-ink-muted'"
      :data-testid="`formatUi.${option}`"
      @click="set(option)"
    >
      {{ option }}
    </button>
  </div>
</template>
