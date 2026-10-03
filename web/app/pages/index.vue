<script setup lang="ts">
// Home. Until #8 builds Currently reading, Up next and the year's count, the
// empty state: the lamp over an empty shelf, and the way to the first book.
definePageMeta({ layout: 'tabs', screen: 'home', titleSize: 'title', dated: true, keepalive: true })
const { t } = useI18n()
</script>

<template>
  <UiEmptyState screen="home" :title="t('home.emptyTitle')" :text="t('home.empty')" class="pt-xl">
    <UiSearchPrompt testid="home.search" />
  </UiEmptyState>
</template>
