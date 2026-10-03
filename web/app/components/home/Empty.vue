<script setup lang="ts">
// Home for a new member (D's home-empty): the lamp over an empty shelf, a
// serif line, a sentence, and the search palette at rest — the way to the
// first book. Tapping it opens the search overlay.
const { t } = useI18n()
</script>

<template>
  <UiEmptyState screen="home" :title="t('home.emptyTitle')" :text="t('home.empty')" class="pt-xl">
    <UiSearchPrompt testid="home.search" />
  </UiEmptyState>
</template>
