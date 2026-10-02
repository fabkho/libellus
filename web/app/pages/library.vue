<script setup lang="ts">
definePageMeta({ layout: 'tabs' })
const { t } = useI18n()
</script>

<template>
  <section class="flex flex-col gap-md">
    <h1 class="text-title font-semibold text-ink" data-testid="library.title">{{ t('library.title') }}</h1>
    <p class="text-body text-ink-muted" data-testid="library.empty">{{ t('library.empty') }}</p>
  </section>
</template>
