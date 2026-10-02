<script setup lang="ts">
// The Add to Library sheet (D's add-sheet), opened from a search result's +
// or a book page's Add. The Book it is about, then the Status to add it with —
// only *Want to read* in this slice; #9 adds Currently reading and Finished
// (ADDABLE_STATUSES) with the dates each needs below the choice. As in D, the
// one action is the button at the bottom; an error stays in the sheet.
import { ADDABLE_STATUSES, useLibraryStore } from '~/stores/library'

const { t } = useI18n()
const library = useLibraryStore()

const open = computed({
  get: () => library.adding !== null,
  set: (value) => {
    if (!value) library.closeAdd()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const book = ref(library.adding)
watch(
  () => library.adding,
  (value) => {
    if (value) book.value = value
  },
)

async function add() {
  await library.confirmAdd()
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('add.title')" testid="add">
    <template v-if="book">
      <UiBookLine
        :title="book.title"
        :authors="book.authors"
        :src="coverSrc(book.coverUrl, 'xs')"
        :thumbhash="book.coverThumbhash"
        :colors="book.coverColors"
      />

      <p class="eyebrow mx-xs mt-sm mb-ms">{{ t('add.statusLabel') }}</p>
      <UiRowGroup role="radiogroup" :aria-label="t('add.statusLabel')">
        <button
          v-for="status in ADDABLE_STATUSES"
          :key="status"
          type="button"
          role="radio"
          :aria-checked="library.addStatus === status"
          class="option relative flex h-(--size-button) w-full items-center gap-ms px-inset text-left text-body"
          :class="library.addStatus === status ? 'text-ink' : 'text-ink-muted'"
          :data-testid="`add.status.${status}`"
          @click="library.addStatus = status"
        >
          <span class="radio" :class="library.addStatus === status && 'on'" aria-hidden="true" />
          <span class="flex-1">{{ t(`status.${status}`) }}</span>
          <span class="text-caption text-ink-faint">{{ t(`add.needs.${status}`) }}</span>
        </button>
      </UiRowGroup>

      <p v-if="library.addError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="add.error">
        {{ t(`library.error.${library.addError}`) }}
      </p>

      <div class="mt-lg mb-sm">
        <UiButton block :disabled="library.addBusy" data-testid="add.submit" @click="add">
          <UiIcon name="plus" :size="18" bold />{{ library.addBusy ? t('add.busy') : t('add.action') }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>

<style scoped>
.option + .option::before {
  position: absolute;
  top: 0;
  right: 0;
  left: calc(var(--spacing-inset) + var(--size-star) + var(--spacing-ms));
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

/* D's radio: a hairline ring; chosen, a lamp-lit dot in a lamp ring. */
.radio {
  width: var(--size-star);
  height: var(--size-star);
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-ink-faint);
  transition: box-shadow var(--duration-quick) var(--ease-standard);
}

.radio.on {
  background: radial-gradient(circle, var(--color-accent) 0 28%, transparent 32%);
  box-shadow:
    inset 0 0 0 var(--stroke-focus) var(--color-accent),
    0 0 var(--spacing-ms) var(--color-accent-soft);
}
</style>
