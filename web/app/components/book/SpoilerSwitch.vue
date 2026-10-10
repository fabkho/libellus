<script setup lang="ts">
// "Contains spoilers" (social v2a, contract §1.1 and §3): the footer of the review box in the finish and
// edit-read sheets (UiTextArea's `footer` slot, which opens once there is text). On, the review is folded for
// a follower who has not finished the Book herself, which the line under the switch says. `v-model` is the
// sheet's flag, off by default; the stores reset it when the review is emptied. `disabled` while the sheet
// saves. The whole line is the switch (`role=switch`, 44 px high). Test id: `testid`
// (`finish.spoilers`, `editSession.spoilers`).
const spoilers = defineModel<boolean>({ required: true })
withDefaults(defineProps<{ disabled?: boolean; testid?: string }>(), { disabled: false, testid: 'review.spoilers' })

const { t } = useI18n()
const hint = useId()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="spoilers"
    :aria-describedby="hint"
    :disabled="disabled"
    class="flex min-h-(--size-touch) w-full items-center justify-between gap-md text-footnote text-ink-muted disabled:opacity-50"
    :data-testid="testid"
    @click.prevent="spoilers = !spoilers"
  >
    {{ t('review.spoilers') }}
    <UiSwitch :on="spoilers" />
  </button>
  <p :id="hint" class="-mt-xs pb-xs text-caption text-ink-faint">{{ t('review.spoilersHint') }}</p>
</template>
