<script setup lang="ts">
// The search palette at rest, for empty states: a raised field with a lamp
// halo that opens the search overlay. Not an input — tapping it opens the real
// one, so there is only ever one search field.
import { useSearchStore } from '~/stores/search'

defineProps<{ testid: string }>()
const { t } = useI18n()
const search = useSearchStore()
</script>

<template>
  <button
    type="button"
    class="prompt flex h-(--size-tab-bar) items-center gap-ms rounded-field bg-surface-raised px-md text-left text-body-large text-ink-faint"
    :data-testid="testid"
    @click="search.open()"
  >
    <UiIcon name="search" :size="19" />
    <span class="truncate">{{ t('search.placeholder') }}</span>
  </button>
</template>

<style scoped>
.prompt {
  box-shadow:
    inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong),
    0 0 0 var(--spacing-xs) var(--color-accent-soft),
    var(--shadow-palette);
}
</style>
