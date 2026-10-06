<script setup lang="ts">
// How to get the file out of each supported app (#111), under the pick
// state's one line: a row per app (Goodreads, Hardcover, in the order
// data/import/detect.ts reads them), each opening its one-line steps in place
// (UiReveal) and closing again. The file itself is told apart by its header,
// so nothing here chooses a source: it only helps her find the export.
import type { ImportSource } from '~/data/import/rows'

defineProps<{ sources: readonly ImportSource[] }>()

const { t } = useI18n()
const open = ref<ImportSource | null>(null)
const ids = useId()

function toggle(source: ImportSource) {
  open.value = open.value === source ? null : source
}
</script>

<template>
  <section class="w-full text-left" data-testid="import.howTo">
    <h2 class="eyebrow">{{ t('import.howToTitle') }}</h2>
    <UiRowGroup class="mt-xs">
      <div v-for="source in sources" :key="source" class="app relative">
        <button
          type="button"
          class="flex h-(--size-row) w-full items-center gap-ms px-inset text-left hover:bg-fill active:bg-fill-strong"
          :aria-expanded="open === source"
          :aria-controls="open === source ? `${ids}-${source}` : undefined"
          :data-testid="`import.howTo.${source}`"
          @click="toggle(source)"
        >
          <span class="min-w-0 flex-1 truncate text-body text-ink">{{ t(`import.app.${source}`) }}</span>
          <UiIcon name="chevron" :size="16" class="turn text-ink-faint" :class="open === source && 'on'" />
        </button>
        <UiReveal :show="open === source">
          <p :id="`${ids}-${source}`" class="px-inset pb-ms text-footnote text-ink-muted" :data-testid="`import.howTo.${source}.text`">
            {{ t(`import.howTo.${source}`) }}
          </p>
        </UiReveal>
      </div>
    </UiRowGroup>
  </section>
</template>

<style scoped>
.app + .app::before {
  position: absolute;
  top: 0;
  right: 0;
  left: var(--spacing-inset);
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

/* The chevron points right when closed and down when open. */
.turn {
  transition: transform var(--duration-quick) var(--ease-standard);
}

.turn.on {
  transform: rotate(90deg);
}
</style>
