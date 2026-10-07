<script setup lang="ts">
// What's new (composables/useWhatsNew.ts): the notes of the release this build is,
// in sections (Changed, New, Faster, Fixed) of plain sentences. Opened once by
// itself after an update, and from Profile → Version · What's new. Done or any
// other way out of a sheet closes it; nothing in it writes.
const { t } = useI18n()
const { notes, minor, open } = useWhatsNew()
</script>

<template>
  <UiSheet v-model:open="open" :title="t('whatsNew.title', { version: minor })" :action="t('whatsNew.done')" testid="whatsNew" @action="open = false">
    <div class="pb-lg">
      <p class="figures px-xs text-caption text-ink-faint" data-testid="whatsNew.version">{{ t('whatsNew.version', { version: notes.version }) }}</p>
      <section v-for="section in notes.sections" :key="section.kind" class="mt-ml" :data-testid="`whatsNew.section.${section.kind}`">
        <h3 class="eyebrow mb-sm px-xs">{{ t(`whatsNew.section.${section.kind}`) }}</h3>
        <ul class="flex flex-col gap-sm px-xs">
          <li v-for="item in section.items" :key="item" class="item relative pl-ml text-subhead text-ink" data-testid="whatsNew.item">{{ item }}</li>
        </ul>
      </section>
      <p v-if="!notes.sections.length" class="mt-ml px-xs text-subhead text-ink-muted" data-testid="whatsNew.none">{{ t('whatsNew.none') }}</p>
    </div>
  </UiSheet>
</template>

<style scoped>
/* A small dot in the lamp colour, on the first line of the sentence. */
.item::before {
  position: absolute;
  top: calc(0.5lh - var(--spacing-xxs));
  left: var(--spacing-xs);
  width: calc(var(--spacing-xxs) * 2);
  height: calc(var(--spacing-xxs) * 2);
  content: '';
  background: var(--color-accent);
  border-radius: 50%;
}
</style>
