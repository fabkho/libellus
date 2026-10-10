<script setup lang="ts">
// A review its author flagged as spoilers, for a reader who has not finished the Book (social v2a, contract §1.1
// and §3): in its place "Contains spoilers · Show anyway". *Show anyway* shows that one review (no state is
// kept: a new view of the row folds it again) and moves focus to it (the first `tabindex="-1"` element of the
// slot: the review's own line), as the button it pressed is gone. Not folded: the slot, as it was. The stars and
// the rest around it stay as they are. The button's name is the same words plus whose review ("Show anyway,
// Ida’s review"): there are several on a page. Props: `folded`, `name` (the author's), `testid` (the placeholder's,
// default `review.folded`). The button is `review.showAnyway`. The wrapper is `display: contents`: no box of its own.
const props = withDefaults(defineProps<{ folded?: boolean; name?: string; testid?: string }>(), { folded: false, name: '', testid: 'review.folded' })

const { t } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const shown = ref(false)
// A read that is another row's now (a list that moved) folds again.
watch(
  () => props.folded,
  () => (shown.value = false),
)

async function show() {
  shown.value = true
  await nextTick()
  root.value?.querySelector<HTMLElement>('[tabindex="-1"]')?.focus()
}
</script>

<template>
  <div ref="root" class="contents">
    <slot v-if="!folded || shown" />
    <p v-else class="mt-xs text-subhead text-ink-muted" :data-testid="testid">
      {{ t('review.folded') }}<span aria-hidden="true"> · </span>
      <button type="button" class="show text-accent-ink font-medium" :aria-label="t('review.showAnywayLabel', { name: name || t('member.someone') })" data-testid="review.showAnyway" @click="show">{{ t('review.showAnyway') }}</button>
    </p>
  </div>
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
