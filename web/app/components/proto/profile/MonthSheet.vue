<script setup lang="ts">
// Design round #78: A's month sheet — the books finished in one month, in
// order, each with its stars, its day and how long it took.
import { dayMonth, finishedIn, monthName, readWords } from './model'

const props = defineProps<{ year: number; month: number | null }>()
const emit = defineEmits<{ close: [] }>()

const reads = computed(() =>
  props.month === null
    ? []
    : finishedIn(props.year)
        .filter((r) => Number(r.ended!.slice(5, 7)) === props.month! + 1)
        .reverse(),
)
const open = computed({ get: () => props.month !== null, set: (v: boolean) => !v && emit('close') })
</script>

<template>
  <UiSheet v-model:open="open" :title="month === null ? '' : `${monthName(month)} ${year}`" testid="month">
    <div class="flex flex-col">
      <ProtoProfileBookRow v-for="r in reads" :key="r.id" :book="r.book">
        <UiStars v-if="r.rating" :quarters="r.rating" />
        <span v-else class="text-ink-ghost">Not rated</span>
        <span class="dot" aria-hidden="true" />{{ dayMonth(r.ended!) }}
        <template v-if="r.days"><span class="dot" aria-hidden="true" />{{ readWords(r) }}</template>
      </ProtoProfileBookRow>
    </div>
  </UiSheet>
</template>

<style scoped>
.dot {
  width: var(--spacing-xxs);
  height: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: currentColor;
}
</style>
