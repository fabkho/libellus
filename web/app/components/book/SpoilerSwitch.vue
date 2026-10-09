<script setup lang="ts">
// "Contains spoilers" (social v2a, contract §1.1 and §3): the switch under the review field in the finish and
// edit-read sheets. On, the review is folded for a follower who has not finished the Book herself. Drawing
// only: `v-model` is the sheet's flag, off by default; nothing here writes it anywhere. `disabled` while the
// sheet saves (the switch cannot be pressed then). Test id: `testid`
// (`review.spoilers` in the sheets), on the row.
const spoilers = defineModel<boolean>({ required: true })
withDefaults(defineProps<{ disabled?: boolean; testid?: string }>(), { disabled: false, testid: 'review.spoilers' })

const { t } = useI18n()
</script>

<template>
  <div :inert="disabled" :class="disabled && 'opacity-50'">
    <UiRowGroup>
      <UiSwitchRow v-model="spoilers" :label="t('review.spoilers')" :testid="testid" />
    </UiRowGroup>
    <p class="mt-sm px-xs text-caption text-ink-faint">{{ t('review.spoilersHint') }}</p>
  </div>
</template>
