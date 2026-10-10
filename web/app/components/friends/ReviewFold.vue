<script setup lang="ts">
// A review its author flagged as spoilers, for a reader who has not finished the Book (social v2a, contract §1.1
// and §3): in its place "Contains spoilers · Show anyway". *Show anyway* shows that one review (no state is
// kept: a new view of the row folds it again). Not folded: the slot, as it was. The stars and the rest around
// it stay as they are. Props: `folded`; `testid` (the placeholder's, default `review.folded`). The button is
// `review.showAnyway`.
const props = withDefaults(defineProps<{ folded?: boolean; testid?: string }>(), { folded: false, testid: 'review.folded' })

const { t } = useI18n()
const shown = ref(false)
// A read that is another row's now (a list that moved) folds again.
watch(
  () => props.folded,
  () => (shown.value = false),
)
</script>

<template>
  <slot v-if="!folded || shown" />
  <p v-else class="mt-xs text-subhead text-ink-muted" :data-testid="testid">
    {{ t('review.folded') }}<span aria-hidden="true"> · </span>
    <button type="button" class="show text-accent-ink font-medium" data-testid="review.showAnyway" @click="shown = true">{{ t('review.showAnyway') }}</button>
  </p>
</template>

<style scoped>
/* A 44 px target around a small word, as every text button. */
.show {
  position: relative;
}
.show::after {
  position: absolute;
  inset: 50% calc(-1 * var(--spacing-xs)) auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
