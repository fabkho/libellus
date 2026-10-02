<script setup lang="ts">
// A quarter-star Rating, display only: five stars filled to the quarter in
// the star colour, with the exact value beside them in mono figures ("3.75"),
// so a quarter never has to be guessed from a sliver of star. Unrated shows
// five empty stars and no value. `quarters` is the stored 1–20.
const props = withDefaults(
  defineProps<{ quarters: number | null; size?: 'sm' | 'md' | 'lg'; showValue?: boolean }>(),
  { size: 'sm', showValue: true },
)

const { t } = useI18n()

const SIZES = { sm: 'size-(--size-star-sm)', md: 'size-(--size-star)', lg: 'size-(--size-star-lg)' } as const
const GAPS = { sm: 'gap-xxs', md: 'gap-xxs', lg: 'gap-xs' } as const
const VALUES = { sm: 'text-meta', md: 'text-caption', lg: 'text-body' } as const

const fills = computed(() => starFills(props.quarters))
const value = computed(() => ratingText(props.quarters))
const label = computed(() => (value.value ? t('rating.label', { value: value.value }) : t('rating.none')))

const STAR = 'M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.4-4.1 6-.7z'
</script>

<template>
  <span class="inline-flex items-center gap-sm leading-none" role="img" :aria-label="label">
    <span class="inline-flex" :class="GAPS[size]" aria-hidden="true">
      <span v-for="(fill, i) in fills" :key="i" class="relative inline-block" :class="SIZES[size]">
        <svg viewBox="0 0 24 24" class="block size-full text-star-track"><path :d="STAR" fill="currentColor" /></svg>
        <span class="absolute inset-y-0 left-0 overflow-hidden text-star" :style="{ width: `${fill * 100}%` }">
          <svg viewBox="0 0 24 24" class="block h-full" :class="SIZES[size]"><path :d="STAR" fill="currentColor" /></svg>
        </span>
      </span>
    </span>
    <span v-if="showValue && value" class="figures font-medium text-ink-muted" :class="VALUES[size]" aria-hidden="true">
      {{ value }}
    </span>
  </span>
</template>
