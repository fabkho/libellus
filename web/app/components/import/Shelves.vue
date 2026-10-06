<script setup lang="ts">
// Her other Goodreads shelves (favourites, sci-fi, a custom one like
// wishlist) or her Hardcover lists (`kind`), offered as Collections before the
// import (#111): one row each,
// with how many of the file's books are on it and D's check, as the Collection
// picker draws it. All are kept until she unticks one; the import then makes
// the Collections she has not got yet and puts the books on them.
import type { OfferedShelf } from '~/stores/import'

const props = withDefaults(defineProps<{ shelves: readonly OfferedShelf[]; disabled?: boolean; kind?: 'shelves' | 'lists' }>(), { kind: 'shelves' })
const emit = defineEmits<{ toggle: [name: string] }>()

const { t } = useI18n()
const title = computed(() => t(props.kind === 'lists' ? 'import.listsTitle' : 'import.shelvesTitle'))
const text = computed(() => t(props.kind === 'lists' ? 'import.listsText' : 'import.shelvesText'))
</script>

<template>
  <section data-testid="import.shelves">
    <h2 class="eyebrow">{{ title }}</h2>
    <p class="mt-xs text-footnote text-ink-muted">{{ text }}</p>
    <UiRowGroup class="mt-sm" role="group" :aria-label="title">
      <button
        v-for="shelf in shelves"
        :key="shelf.name"
        type="button"
        role="checkbox"
        :aria-checked="shelf.chosen"
        :disabled="disabled"
        class="option relative flex h-(--size-row) w-full items-center gap-ms px-inset text-left enabled:hover:bg-fill active:bg-fill-strong disabled:opacity-50"
        data-testid="import.shelf"
        @click="emit('toggle', shelf.name)"
      >
        <span class="min-w-0 flex-1 truncate text-body text-ink" data-testid="import.shelfName">{{ shelf.name }}</span>
        <span class="figures text-caption text-ink-faint">{{ t('import.shelfCount', { count: shelf.count }, shelf.count) }}</span>
        <span class="check flex size-(--size-star-lg) shrink-0 items-center justify-center rounded-pill" :class="shelf.chosen && 'on'" aria-hidden="true">
          <UiIcon v-if="shelf.chosen" name="check" :size="14" bold />
        </span>
      </button>
    </UiRowGroup>
  </section>
</template>

<style scoped>
.option + .option::before {
  position: absolute;
  top: 0;
  right: 0;
  left: var(--spacing-inset);
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

/* D's check: a hairline ring; on, a lamp-lit disc with the tick in it. */
.check {
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-ink-faint);
  color: var(--color-on-ink);
  transition:
    background-color var(--duration-quick) var(--ease-standard),
    box-shadow var(--duration-quick) var(--ease-standard);
}

.check.on {
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-ms) var(--color-accent-soft);
}
</style>
