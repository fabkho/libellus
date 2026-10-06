<script setup lang="ts">
// Home for a new member (D's home-empty): the lamp over an empty shelf, a
// serif line, a sentence, and the search palette at rest — the way to the
// first book. Tapping it opens the search overlay. Under it, a quiet card offers the
// import for a member coming from Goodreads or Hardcover (HomeImportOffer).
const { t } = useI18n()
// The install hint and the import card take room around the lamp; while they show it gives some back.
const hint = useInstallHint()
const importOffer = useImportOffer()
</script>

<template>
  <div class="flex flex-col gap-xl">
    <HomeInstallHint />
    <UiEmptyState screen="home" :title="t('home.emptyTitle')" :text="t('home.empty')" :compact="hint.visible.value || importOffer.offer.value === 'full'" class="pt-md">
      <UiSearchPrompt testid="home.search" />
    </UiEmptyState>
    <HomeImportOffer />
  </div>
</template>
