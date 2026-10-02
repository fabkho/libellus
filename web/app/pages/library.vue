<script setup lang="ts">
// Library. Until #14 builds the status segments and Collections, the empty
// state, with the same way to the first book as Home.
definePageMeta({ layout: 'tabs', screen: 'library' })
const { t } = useI18n()
</script>

<template>
  <UiEmptyState screen="library" :title="t('library.emptyTitle')" :text="t('library.empty')" class="pt-xl">
    <UiSearchPrompt testid="library.search" />
  </UiEmptyState>
</template>
