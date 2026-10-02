<script setup lang="ts">
// One input, not six. Six boxes break iOS autofill and paste: the keyboard's
// code suggestion fills a single field with autocomplete="one-time-code", and
// the cells below are only a drawing of it (docs/parity.md, Verify).
//
// The input stays a real, visible field — transparent, not hidden — because a
// hidden one gets no code suggestion.
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{ id: string; length?: number; invalid?: boolean }>(), {
  length: 6,
})

const value = defineModel<string>({ required: true })

const input = useTemplateRef<HTMLInputElement>('input')
const focused = ref(false)

const digits = computed(() => value.value.slice(0, props.length))

// Only the cell the next digit lands in is marked, and only while the field
// actually has the keyboard.
const active = (index: number) => focused.value && index === digits.value.length

defineExpose({ focus: () => input.value?.focus() })
</script>

<template>
  <div class="relative">
    <div class="flex gap-sm" aria-hidden="true">
      <span
        v-for="cell in length"
        :key="cell"
        class="flex min-h-(--size-touch) flex-1 items-center justify-center rounded-md border bg-surface-raised text-title tabular-nums text-ink"
        :class="invalid ? 'border-error' : active(cell - 1) ? 'border-accent' : 'border-outline'"
      >
        {{ digits[cell - 1] }}
      </span>
    </div>

    <input
      :id="id"
      ref="input"
      v-model="value"
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      enterkeyhint="go"
      :maxlength="length"
      :aria-invalid="invalid ? true : undefined"
      v-bind="$attrs"
      class="absolute inset-0 h-full w-full bg-transparent text-center text-title text-transparent caret-transparent outline-none"
      @focus="focused = true"
      @blur="focused = false"
    />
  </div>
</template>
