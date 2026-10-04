<script setup lang="ts">
// Home for a new member (D's home-empty): the lamp over an empty shelf, a
// serif line, a sentence, and the search palette at rest — the way to the
// first book. Tapping it opens the search overlay.
const { t } = useI18n()
// The install hint takes room above the lamp; while it shows the lamp gives some back.
const hint = useInstallHint()
</script>

<template>
  <div class="flex flex-col gap-xl">
    <HomeInstallHint />
    <UiEmptyState screen="home" :title="t('home.emptyTitle')" :text="t('home.empty')" :compact="hint.visible.value" class="pt-md">
      <UiSearchPrompt testid="home.search" />
    </UiEmptyState>
  </div>
</template>
