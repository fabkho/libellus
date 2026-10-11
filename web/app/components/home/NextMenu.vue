<script setup lang="ts">
// The small menu of one series on Home's "Next in your series" (#167), opened by the
// "..." of its row: Mute series. It is the app's small-menu pattern, a plain `UiSheet`
// with a group of rows (as a Collection's options). Muting hides the whole series
// (never single books) and is online only, like her series corrections: offline the
// row is disabled and says "Offline"; a refusal stays here with its reason. It closes
// once the server has answered, and the row then leaves its list with the list's motion.
import type { StartedSeries } from '~/data/enrich'
import { useSeriesStore } from '~/stores/series'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ item: StartedSeries | null }>()

const { t } = useI18n()
const series = useSeriesStore()
const online = useOnline()

const failure = ref<string | null>(null)
watch(open, (isOpen) => isOpen && (failure.value = null))

async function mute() {
  if (!props.item || !online.value || series.muting) return
  failure.value = null
  const failed = await series.mute(props.item.series.id)
  if (failed) failure.value = t(`series.error.${failed}`)
  else open.value = false
}
</script>

<template>
  <UiSheet v-model:open="open" :title="item?.series.name ?? ''" testid="homeSeriesMenu">
    <div class="pt-xs pb-sm">
      <UiRowGroup>
        <UiRow
          as="button"
          icon="slash"
          :label="t('series.mute')"
          :value="online ? undefined : t('common.offline')"
          :disabled="!online || Boolean(series.muting)"
          data-testid="homeSeriesMenu.mute"
          @click="mute"
        />
      </UiRowGroup>
      <p class="mt-ms px-xs text-caption text-ink-faint">{{ t('series.muteHint') }}</p>
      <p v-if="failure" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="homeSeriesMenu.error">{{ failure }}</p>
    </div>
  </UiSheet>
</template>
