<script setup lang="ts">
// "New version available" (stores/appUpdate.ts, plugins/app-update.client.ts): a calm bottom sheet with one
// line, "Update now" (the new worker takes over, the page reloads) and "Later" (until the app is opened the
// next time). Any other way out of a sheet — Cancel, a tap on the scrim, Escape, a swipe down, the system
// Back, a change of page — is "Later" too. One for the whole app (layouts/tabs.vue).
import { useAppUpdateStore } from '~/stores/appUpdate'

const { t } = useI18n()
const update = useAppUpdateStore()

const open = computed({
  get: () => update.sheetOpen,
  set: (next: boolean) => {
    if (!next && !update.applying) update.dismiss()
  },
})
</script>

<template>
  <UiSheet v-model:open="open" :title="t('update.title')" testid="update">
    <div class="flex flex-col gap-md px-xs pt-xs pb-lg">
      <p class="text-subhead text-ink-muted" data-testid="update.text">{{ t('update.text') }}</p>
      <div class="flex flex-col gap-sm">
        <UiButton
          block
          :disabled="update.applying"
          :aria-busy="update.applying || undefined"
          data-testid="update.apply"
          @click="update.apply()"
        >
          {{ update.applying ? t('update.busy') : t('update.action') }}
        </UiButton>
        <UiButton tone="quiet" block :disabled="update.applying" data-testid="update.later" @click="update.dismiss()">
          {{ t('update.later') }}
        </UiButton>
      </div>
    </div>
  </UiSheet>
</template>
