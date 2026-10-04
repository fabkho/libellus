<script setup lang="ts">
// Design round #78, D: the books given one whole star count (a 4.75 is a
// four), in the year in view or all of them, best rated first, then newest.
import { dayMonth, finishedIn, readWords, type Year } from './model'

const props = defineProps<{ year: Year; star: number | null }>()
const emit = defineEmits<{ close: [] }>()

const reads = computed(() =>
  props.star === null
    ? []
    : finishedIn(props.year)
        .filter((r) => r.rating && Math.max(1, Math.floor(r.rating / 4)) === props.star)
        .sort((a, b) => b.rating! - a.rating! || b.ended!.localeCompare(a.ended!)),
)
const open = computed({ get: () => props.star !== null, set: (v: boolean) => !v && emit('close') })
const title = computed(() => (props.star === null ? '' : `${props.star} ${props.star === 1 ? 'star' : 'stars'} · ${props.year === 'all' ? 'All years' : props.year}`))
</script>

<template>
  <UiSheet v-model:open="open" :title="title" testid="rating">
    <div class="flex flex-col">
      <ProtoProfileBookRow v-for="r in reads" :key="r.id" :book="r.book" :again="r.nth">
        <UiStars :quarters="r.rating" />
        <span class="dot" aria-hidden="true" />{{ dayMonth(r.ended!) }}<template v-if="year === 'all'"> {{ r.ended!.slice(0, 4) }}</template>
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
