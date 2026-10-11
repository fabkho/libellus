<script setup lang="ts">
// Every series she has started and not finished, in a sheet (Home's "See more", when
// there are more than the five the section lists, or when she muted one): the same rows,
// the latest activity first, the sheet's body scrolling when they are many. Modelled
// on Home's tally sheet (HomeTallySheet): a plain `UiSheet` with its own test
// IDs. A row opens its Book's page, which closes the sheet; "+ Want to read" opens
// the Add sheet over this one, and her status takes the button's place when it
// has fallen away. The "..." of a row opens its menu over this sheet (`more`).
//
// At the bottom, only when she muted a series, "Muted (n)": a row that opens the list
// of them, each with Unmute (online only: offline it says "Offline"). Muting and
// unmuting move a series between the lists with the list's motion while the sheet is
// open, so what she pressed is seen to happen; Home behind it follows once the sheet
// is gone. The muted list always opens closed.
import type { StartedSeries } from '~/data/enrich'
import { useSeriesStore } from '~/stores/series'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ items: readonly StartedSeries[]; muted: readonly StartedSeries[] }>()
const emit = defineEmits<{ more: [item: StartedSeries] }>()

const { t } = useI18n()
const series = useSeriesStore()
const online = useOnline()

const mutedOpen = ref(false)
const failure = ref<string | null>(null)
watch(open, (isOpen) => {
  if (!isOpen) return
  mutedOpen.value = false
  failure.value = null
})

async function unmute(item: StartedSeries) {
  if (!online.value || series.muting) return
  failure.value = null
  const failed = await series.unmute(item.series.id)
  if (failed) failure.value = t(`series.error.${failed}`)
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('series.started')" testid="homeSeries">
    <UiListMotion tag="ul" still :aria-label="t('series.started')" data-testid="homeSeries.list">
      <HomeNextRow
        v-for="item in items"
        :key="`${item.series.id}:${item.next.workId ?? item.next.title}`"
        :item="item"
        testid="homeSeries.row"
        @more="emit('more', $event)"
      />
    </UiListMotion>
    <section v-if="muted.length" class="pt-md" data-testid="homeSeries.muted">
      <UiRowGroup>
        <UiRow
          as="button"
          :label="t('series.muted', { count: muted.length })"
          :aria-expanded="mutedOpen"
          aria-controls="home-series-muted"
          data-testid="homeSeries.mutedToggle"
          @click="mutedOpen = !mutedOpen"
        >
          <template #trailing>
            <UiIcon name="down" :size="15" bold class="muted-chevron -mr-xs text-ink-ghost" :class="mutedOpen && 'open'" />
          </template>
        </UiRow>
      </UiRowGroup>
      <UiListMotion v-if="mutedOpen" id="home-series-muted" tag="ul" still class="pt-xs" :aria-label="t('series.mutedList')" data-testid="homeSeries.mutedList">
        <li v-for="item in muted" :key="item.series.id" class="muted-row flex items-center gap-sm" data-testid="homeSeries.mutedRow">
          <span class="book-title title-wrap min-w-0 flex-1 py-sm text-body-large" data-testid="homeSeries.mutedName">{{ item.series.name }}</span>
          <button
            type="button"
            class="unmute relative inline-flex h-(--size-button-sm) shrink-0 items-center gap-xxs rounded-pill px-ms text-footnote text-ink-muted edge disabled:opacity-50"
            :disabled="!online || Boolean(series.muting)"
            :aria-label="online ? t('series.unmuteLabel', { name: item.series.name }) : t('common.offline')"
            data-testid="homeSeries.unmute"
            @click="unmute(item)"
          >
            <template v-if="online">{{ t('series.unmute') }}</template>
            <template v-else><UiIcon name="offline" :size="14" />{{ t('common.offline') }}</template>
          </button>
        </li>
      </UiListMotion>
      <p v-if="failure" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="homeSeries.error">{{ failure }}</p>
    </section>
  </UiSheet>
</template>

<style scoped>
.muted-row + .muted-row {
  border-top: var(--stroke-hairline) solid var(--color-hairline);
}

.muted-chevron {
  transition: transform var(--duration-quick) var(--ease-standard);
}
.muted-chevron.open {
  transform: rotate(180deg);
}

/* The drawn pill is 32 px; the touch target stays 44. */
.unmute::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}

@media (prefers-reduced-motion: reduce) {
  .muted-chevron {
    transition: none;
  }
}
</style>
