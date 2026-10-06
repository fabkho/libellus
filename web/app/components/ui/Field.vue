<script setup lang="ts">
// A text field the way D draws one: a small label, what the member types in
// the input size, and one rule underneath that lights up in the lamp colour
// while the field has the keyboard (the error colour when it is wrong). The
// error line sits right under it. Attributes (type, autocomplete, inputmode,
// data-testid, …) go to the <input>.
defineOptions({ inheritAttrs: false })

const props = defineProps<{ id: string; label: string; error?: string | null; errorTestid?: string }>()
const value = defineModel<string>({ required: true })

const focused = ref(false)
const ruleClass = computed(() =>
  props.error ? 'border-error' : focused.value ? 'border-accent' : 'border-hairline-strong',
)
</script>

<template>
  <div class="flex flex-col gap-xs">
    <label :for="id" class="text-footnote text-ink-faint">{{ label }}</label>
    <input
      :id="id"
      v-model="value"
      v-bind="$attrs"
      :aria-invalid="error ? true : undefined"
      :aria-describedby="error ? `${id}-error` : undefined"
      class="min-h-(--size-touch) w-full border-b-(length:--stroke-rule) bg-transparent pb-xs text-input text-ink caret-accent outline-none transition-colors duration-(--duration-quick) ease-standard placeholder:text-ink-faint"
      :class="ruleClass"
      @focus="focused = true"
      @blur="focused = false"
    />
    <p v-if="error" :id="`${id}-error`" class="text-footnote text-error" :data-testid="errorTestid">{{ error }}</p>
  </div>
</template>
