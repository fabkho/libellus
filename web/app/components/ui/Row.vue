<script setup lang="ts">
// One row in a RowGroup: an optional icon, the label, the value on the right
// (or a placeholder), an optional chevron. 48 px tall, a hairline divider
// inset under the text from the second row on. `as` makes it a button or a
// link (`to`); interactive rows need a data-testid from the caller.
import type { RouteLocationRaw } from 'vue-router'
import type { IconName } from './Icon.vue'

const props = withDefaults(
  defineProps<{
    label: string
    value?: string
    placeholder?: string
    icon?: IconName
    chevron?: boolean
    mono?: boolean
    tone?: 'default' | 'danger'
    to?: RouteLocationRaw
    as?: 'div' | 'button'
  }>(),
  { value: undefined, placeholder: undefined, icon: undefined, chevron: false, mono: false, tone: 'default', to: undefined, as: 'div' },
)

const NuxtLink = resolveComponent('NuxtLink')
const tag = computed(() => (props.to ? NuxtLink : props.as))
</script>

<template>
  <component
    :is="tag"
    :to="to"
    :type="as === 'button' && !to ? 'button' : undefined"
    class="ui-row relative flex min-h-(--size-row) w-full items-center gap-ms px-inset text-left text-body"
    :class="[tone === 'danger' ? 'text-error' : 'text-ink', (as === 'button' || to) && 'not-disabled:hover:bg-fill active:bg-fill-strong']"
  >
    <UiIcon v-if="icon" :name="icon" :size="18" :class="tone === 'danger' ? '' : 'text-ink-faint'" />
    <span class="shrink-0" :class="value !== undefined || placeholder ? 'text-ink-muted' : ''">{{ label }}</span>
    <span class="flex min-w-0 flex-1 items-center justify-end-safe gap-sm truncate text-right" :class="mono && 'figures text-caption'">
      <slot>
        <template v-if="value">{{ value }}</template>
        <span v-else-if="placeholder" class="text-ink-faint">{{ placeholder }}</span>
      </slot>
    </span>
    <slot name="trailing" />
    <UiIcon v-if="chevron" name="chevron" :size="15" bold class="-mr-xs text-ink-ghost" />
  </component>
</template>

<style scoped>
.ui-row + .ui-row::before {
  position: absolute;
  top: 0;
  right: 0;
  left: var(--spacing-inset);
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}
</style>
