<script setup lang="ts">
// Pick my next book (PROTOTYPE, #259), in the tabs layout: switches the prototype on (`?pick=1`
// for this tab's session, or a build with LIBELLUS_PICKER=1) and the variant (`?variant=a|b|c`,
// `?deal=2d`), and holds the pick's two layers: the animation while a round is dealt (Stage) and
// the Accept / Decline bar on the result's Book page (Bar). Both load only when the pick runs.
// Leaving the result's page by Back, a tab or a link ends the pick (nothing was written).
import { variantFromParam } from '~/data/pick'
import { usePickStore } from '~/stores/pick'

const pick = usePickStore()
const route = useRoute()
const config = useAppConfig()

const FLAG = 'libellus.pick'
onMounted(() => {
  if (config.picker || sessionStorage.getItem(FLAG)) pick.enabled = true
  const variant = variantFromParam(sessionStorage.getItem(`${FLAG}.variant`))
  if (variant) pick.variant = variant
})
watch(
  () => route.query,
  (query) => {
    if (!import.meta.client) return
    if (query.pick === '1') {
      pick.enabled = true
      sessionStorage.setItem(FLAG, '1')
    } else if (query.pick === '0') {
      pick.enabled = Boolean(config.picker)
      sessionStorage.removeItem(FLAG)
    }
    const variant = variantFromParam(query.variant)
    if (variant) {
      pick.variant = variant
      sessionStorage.setItem(`${FLAG}.variant`, variant)
    }
    if (query.deal === '2d') pick.force2d = true
    else if (query.deal === '3d') pick.force2d = false
  },
  { immediate: true },
)

/** The deal on screen: from the moment it starts until its cover has taken off (Stage's `gone`). */
const staged = ref<number | null>(null)
watch(
  () => [pick.phase, pick.deal] as const,
  ([phase, deal]) => {
    if (phase === 'dealing') staged.value = deal
    else if (phase === 'choosing') staged.value = null
  },
)

const BAR_PHASES = new Set(['shown', 'empty', 'accepting', 'accepted'])
const barShown = computed(() => BAR_PHASES.has(pick.phase) && route.path === pick.pagePath)

// Away from the result's page (Back to the list, a tab, a link), or anywhere while a round is
// still being dealt: the pick is over. The deal's own way to its result sets the page first.
watch(
  () => route.path,
  (path) => {
    if (pick.phase !== 'choosing' && path !== pick.pagePath) pick.leave()
  },
)
</script>

<template>
  <LazyPickStage v-if="staged !== null" :key="staged" @gone="staged = null" />
  <LazyPickBar v-if="barShown" />
</template>
