<script setup lang="ts">
// The prototype's dev switch (#259): which of the three animations deals the pick, each with one
// line about it. Also `?variant=a|b|c` in the address (components/pick/Layer.vue).
import { PICK_VARIANTS, type PickVariant } from '~/data/pick'
import { usePickStore } from '~/stores/pick'

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const pick = usePickStore()

function choose(variant: PickVariant) {
  pick.variant = variant
  sessionStorage.setItem('libellus.pick.variant', variant)
  open.value = false
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('pick.variantTitle')" testid="pick.variants">
    <div role="radiogroup" :aria-label="t('pick.variantTitle')" class="flex flex-col gap-xs pb-sm">
      <button
        v-for="variant in PICK_VARIANTS"
        :key="variant"
        type="button"
        role="radio"
        :aria-checked="pick.variant === variant"
        class="flex items-start gap-ms rounded-md px-ms py-ms text-left"
        :class="pick.variant === variant ? 'bg-fill-strong' : 'active:bg-fill'"
        :data-testid="`pick.variant.${variant}`"
        @click="choose(variant)"
      >
        <span class="flex min-w-0 flex-1 flex-col gap-xxs">
          <span class="text-body text-ink">{{ t(`pick.variants.${variant}.name`) }}</span>
          <span class="text-caption text-ink-muted">{{ t(`pick.variants.${variant}.line`) }}</span>
        </span>
        <UiIcon v-if="pick.variant === variant" name="check" :size="18" class="mt-xxs text-accent-ink" />
      </button>
    </div>
  </UiSheet>
</template>
