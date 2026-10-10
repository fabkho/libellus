<script setup lang="ts">
// The pick's deal in 3D (PROTOTYPE, #259): Regal's RegalBooksDeal (the layer, prototype/pick-next)
// in Libellus' room. Like ShelfStage, only ever loaded by an async import (components/pick/Stage.vue)
// and only in a build with Regal (LIBELLUS_REGAL=1), so it, Regal, three.js and TresJS stay in the
// `regal` chunk (regal.config.ts), never precached; without Regal it is the empty stand-in and the
// stage deals in 2D (Deal2d.vue). It brings Regal's fonts with it (the Spines are typeset with them).
import '#build/nuxt-fonts-global.css'
import '~/assets/css/regal-themed.css'
import type { DealBook, DealPicked } from '~/utils/pickDeal'
import type { PickVariant } from '~/data/pick'

const props = defineProps<{
  books: DealBook[]
  winner: number
  variant: PickVariant
  duration: number
  reducedMotion: boolean
  label: string
}>()
const emit = defineEmits<{ ready: []; picked: [picked: DealPicked] }>()

const deal = useTemplateRef<{ skip: () => void }>('deal')
defineExpose({ skip: () => deal.value?.skip() })
</script>

<template>
  <RegalBooksDeal
    ref="deal"
    class="pick-deal regal-themed"
    theme="auto"
    :books="props.books"
    :winner="props.winner"
    :variant="props.variant"
    :duration="props.duration"
    :reduced-motion="props.reducedMotion"
    :label="props.label"
    @ready="emit('ready')"
    @picked="emit('picked', $event)"
  />
</template>

<style scoped>
.pick-deal.pick-deal {
  position: absolute;
  inset: 0;
  min-height: 0;
}
</style>
