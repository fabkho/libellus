<script setup lang="ts">
// "Show it anyway?" (docs/plans/buddy-read-shared.md part 5.4): the question before a Section her marker has not reached opens.
// It says what the veil is for and that her own Section does not move; the answer is remembered on this device as a peek
// (stores/buddyRead.ts `peek`, the layer's `createPeeks`), so the row is open from then on. Not a way to the words: nothing of the
// Section is loaded until she has said yes. `number` is only a number; a veiled Section's own title is never spoken here.
// `prefix` names the message keys the words are under (`together.showAnyway`: a buddy read's Sections; `notes.showAnyway`: a Book's chapters), which is also the test id.
const props = withDefaults(defineProps<{ number: number | string; end?: boolean; prefix?: string }>(), { end: false, prefix: 'together.showAnyway' })
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ show: [] }>()

const { t } = useI18n()
// Kept while the dialog slides away, so its title does not change under her.
const shown = ref(props.number)
const isEnd = ref(Boolean(props.end))
watch(open, (now) => {
  if (!now) return
  shown.value = props.number
  isEnd.value = Boolean(props.end)
})

function confirm() {
  open.value = false
  emit('show')
}
</script>

<template>
  <UiConfirm
    v-model:open="open"
    tone="primary"
    :title="isEnd ? t(`${prefix}.titleEnd`) : t(`${prefix}.title`, { n: shown })"
    :text="t(`${prefix}.text`)"
    :action="t(`${prefix}.action`)"
    :cancel-label="t(`${prefix}.cancel`)"
    :testid="prefix"
    @confirm="confirm"
  />
</template>
