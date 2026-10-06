<script setup lang="ts">
// Reader style, as the Profile's row opens it (a stand-in here: the real row
// goes into Profile → Account, which phase 1 is changing right now). Two
// choices, each with a small drawing of its page: Printed (the default: the
// chapter over the text, the page number under it, the capsule) and Classic
// (a bar at the top and one at the bottom). The reader's Aa sheet switches the
// same setting.
const open = defineModel<boolean>('open', { required: true })
const style = defineModel<'printed' | 'classic'>('style', { required: true })

const CHOICES = [
  { key: 'printed', name: 'Printed', text: 'Like a book: the chapter above the text, the page number below it. Tap the middle for a small capsule.' },
  { key: 'classic', name: 'Classic mode', text: 'A bar at the top and one at the bottom when you tap the middle: title, progress, the slider.' },
] as const
</script>

<template>
  <UiSheet v-model:open="open" title="Reader style" testid="readerStyle">
    <div class="grid grid-cols-2 gap-ms" role="radiogroup" aria-label="Reader style">
      <button
        v-for="c in CHOICES"
        :key="c.key"
        type="button"
        role="radio"
        :aria-checked="style === c.key"
        class="choice flex flex-col items-center gap-sm rounded-md p-ms text-left"
        :class="style === c.key && 'on'"
        :data-testid="`readerStyle.${c.key}`"
        @click="style = c.key"
      >
        <!-- A small page in the reader's room. -->
        <span class="page relative flex w-full flex-col rounded-sm bg-surface edge-faint" aria-hidden="true">
          <template v-if="c.key === 'printed'">
            <span class="head mx-auto" />
            <span v-for="n in 7" :key="n" class="line" />
            <span class="folio mx-auto" />
            <span class="capsule mx-auto" />
          </template>
          <template v-else>
            <span class="bar top" />
            <span v-for="n in 7" :key="n" class="line" />
            <span class="bar bottom"><span class="slider" /></span>
          </template>
        </span>
        <span class="w-full">
          <span class="flex items-center gap-xs text-body font-medium" :class="c.key === 'printed' && 'book-title italic'">
            {{ c.name }}<span v-if="c.key === 'printed'" class="text-meta not-italic text-ink-faint" style="font-family: var(--font-sans)">default</span>
          </span>
          <span class="mt-xxs block text-caption text-ink-muted">{{ c.text }}</span>
        </span>
      </button>
    </div>
    <p class="mt-md mb-xs px-xs text-caption text-ink-faint">Also in the reader: Aa → Classic mode.</p>
  </UiSheet>
</template>

<style scoped>
.choice {
  background: var(--color-fill);
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline);
}
.choice.on {
  background: var(--color-accent-soft);
  box-shadow: inset 0 0 0 var(--stroke-focus) var(--color-accent);
}
.page {
  aspect-ratio: 3 / 4;
  gap: var(--spacing-xs);
  padding: var(--spacing-ms) var(--spacing-ms);
  overflow: hidden;
}
.line {
  height: var(--stroke-focus);
  border-radius: var(--radius-pill);
  background: var(--color-ink-ghost);
}
.line:nth-child(4n) {
  width: 70%;
}
.head {
  width: 45%;
  height: var(--stroke-focus);
  margin-bottom: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: var(--color-ink-faint);
}
.folio {
  width: var(--spacing-sm);
  height: var(--stroke-focus);
  margin-top: var(--spacing-xxs);
  border-radius: var(--radius-pill);
  background: var(--color-ink-faint);
}
.capsule {
  width: 70%;
  height: var(--spacing-ms);
  margin-top: auto;
  border-radius: var(--radius-pill);
  background: var(--color-glass);
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong);
}
.bar {
  position: absolute;
  left: 0;
  right: 0;
  height: var(--spacing-ms);
  background: var(--color-glass);
  box-shadow: inset 0 0 0 var(--stroke-hairline) var(--color-hairline-strong);
}
.bar.top {
  top: 0;
}
.bar.bottom {
  bottom: 0;
}
.bar.top + .line {
  margin-top: var(--spacing-ms);
}
.slider {
  position: absolute;
  top: 50%;
  left: 15%;
  width: 35%;
  height: var(--stroke-rule);
  background: var(--color-accent);
}
</style>
