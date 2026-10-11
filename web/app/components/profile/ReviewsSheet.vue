<script setup lang="ts">
// All her reviews (social v2a; *See all* under Your reviews on the Profile): a sheet with the section's rows, newest
// first. A row's Book opens its page (which closes the sheet). Test ids: `profileReviews` (the sheet),
// `profileReviews.row`.
import type { ProfileReview } from '~/utils/profileReviews'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ items: readonly ProfileReview[] }>()

const { t } = useI18n()
</script>

<template>
  <UiSheet v-model:open="open" :title="t('profile.reviews.title')" testid="profileReviews">
    <ul class="flex flex-col pb-lg">
      <li v-for="item in items" :key="item.id" class="row">
        <ProfileReviewRow :item="item" testid="profileReviews.row" />
      </li>
    </ul>
  </UiSheet>
</template>

<style scoped>
.row + .row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}
</style>
