<script setup lang="ts">
// A few lines of the member's own words (D's review box in the finish sheet):
// a quiet filled box with the label and its hint on top, the text in the
// serif italic, a lamp ring while it has the focus. It grows with the text up
// to a few lines, then scrolls. Attributes (maxlength, data-testid, …) go to
// the <textarea>.
defineOptions({ inheritAttrs: false })

defineProps<{ id: string; label: string; hint?: string }>()
const model = defineModel<string>({ required: true })

const focused = ref(false)
const area = useTemplateRef<HTMLTextAreaElement>('area')

// Grows with the text (`field-sizing` where the browser has it, this elsewhere).
function fit() {
  const el = area.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
watch(model, () => nextTick(fit))
onMounted(fit)
</script>

<template>
  <label
    :for="id"
    class="box flex flex-col gap-sm rounded-md bg-fill px-inset pt-ms pb-inset"
    :class="focused ? 'focused' : 'edge-faint'"
  >
    <span class="text-footnote text-ink-muted">
      {{ label }}<template v-if="hint"><span class="text-ink-faint"> · {{ hint }}</span></template>
    </span>
    <textarea
      :id="id"
      ref="area"
      v-model="model"
      v-bind="$attrs"
      rows="2"
      class="area w-full resize-none bg-transparent font-serif text-callout text-ink italic caret-accent outline-none placeholder:text-ink-ghost"
      @focus="focused = true"
      @blur="focused = false"
    />
  </label>
</template>

<style scoped>
.box {
  transition: box-shadow var(--duration-quick) var(--ease-standard);
}

.box.focused {
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-accent);
}

.area {
  max-height: calc(6 * var(--text-callout--line-height));
  field-sizing: content;
}
</style>
