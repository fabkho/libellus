<script setup lang="ts">
// A setting that is on or off, as a row in a UiRowGroup: the label (and an
// icon), the switch at the right. The whole row is the control (`role=switch`,
// 48 px high), as the Profile's Dark mode row. `testid` goes on the row.
import type { IconName } from './Icon.vue'

const model = defineModel<boolean>({ required: true })
defineProps<{ label: string; icon?: IconName; testid?: string }>()
</script>

<template>
  <UiRow as="button" role="switch" :aria-checked="model" :icon="icon" :label="label" :data-testid="testid" @click="model = !model">
    <UiSwitch :on="model" />
  </UiRow>
</template>
