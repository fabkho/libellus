<script setup lang="ts">
// Dev only (the route is dropped from every build: nuxt.config.ts, `$production`): the app-update sheet
// (components/shell/UpdateSheet.vue) over an empty room, for screenshots — `nuxt dev` has no service
// worker and no newer build, so "a new version is available" has to be made up here
// (`stores/appUpdate.ts`, `markWaiting`). `/prototype/update-sheet`.
import { useAppUpdateStore } from '~/stores/appUpdate'

definePageMeta({ layout: false })

const update = useAppUpdateStore()
update.markWaiting()
update.open()
</script>

<template>
  <div class="min-h-dvh p-lg">
    <UiButton tone="secondary" size="md" data-testid="proto.open" @click="update.reopen()">Open the sheet</UiButton>
    <ShellUpdateSheet />
  </div>
</template>
