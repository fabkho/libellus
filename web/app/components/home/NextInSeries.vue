<script setup lang="ts">
// "Next in your series" on Home (#167): the series she has started — a work of it
// she is reading or finished, Want to read alone does not start one — and has not
// finished, each as the next work still open in it ("Book 3 of 10 · Discworld")
// with her status of it or "+ Want to read", opening its Book's page. The latest
// activity first (the database's `started_series`); five at most, and when there
// are more (or she muted some) a pill, "See all n" with n the series she has open, opens all
// of them in a sheet (HomeNextSheet). Each row has
// a "..." (HomeNextMenu: Mute series, online only); a muted series leaves the list with
// its motion and is found again in the sheet, under "Muted (n)", where it is unmuted.
// The section stays while she has muted ones, with the same pill, so she can always get
// to them; it hides only when nothing is started and nothing muted. The last
// section of Home, so appearing after the lists moves nothing; kept on the device,
// so it is there at once (offline too) the next time. A change plays like a list's
// (`UiListMotion`, once the sheet that caused it has gone) and the section, when it
// has something to say for the first time, opens its room (`UiReveal`).
import type { StartedSeries } from '~/data/enrich'
import { useLibraryStore } from '~/stores/library'
import { useSeriesStore } from '~/stores/series'

const { t } = useI18n()
const series = useSeriesStore()
const library = useLibraryStore()

const started = useSettled(() => startedOnHome(series.started))
const shown = computed(() => started.value.shown)
/** How many she muted: the section keeps its eyebrow while there are some, so they can be unmuted. */
const hidden = useSettled(() => series.muted.length)
const more = ref(false)
/** The sheet's lists follow her at once: a mute or an unmute is seen to happen in it, Home follows once it is gone. */
const sheetItems = computed(() => startedOnHome(series.started).all)
const menu = ref<StartedSeries | null>(null)
const menuOpen = ref(false)
function openMenu(item: StartedSeries) {
  menu.value = item
  menuOpen.value = true
}

// Asked when it mounts (Home shows it once the Library is there) and each time Home is shown again.
let justMounted = false
onMounted(() => {
  justMounted = true
  void series.loadStarted()
  void nextTick(() => (justMounted = false))
})
onActivated(() => {
  if (!justMounted) void series.loadStarted()
})
// A Book finished (or started) elsewhere: what is open in a series changes.
watch(
  () => library.finished.length + library.reading.length,
  () => void series.loadStarted(),
)
// The sheet closes when it has nothing to list: not more than the section shows, and nothing muted.
watch(
  () => started.value.more || hidden.value > 0,
  (hasSheet) => !hasSheet && (more.value = false),
)
</script>

<template>
  <UiReveal :show="shown.length > 0 || hidden > 0">
    <section data-testid="home.nextInSeries">
      <div class="flex h-(--size-touch) items-center justify-between">
        <h2 class="eyebrow">{{ t('series.next') }}</h2>
        <button
          v-if="started.more || hidden > 0"
          type="button"
          class="more relative inline-flex h-(--size-button-sm) items-center gap-xxs rounded-pill pr-sm pl-md text-footnote text-ink-muted edge hover:bg-fill"
          aria-haspopup="dialog"
          :aria-label="t('series.seeMoreLabel', { count: started.all.length })"
          data-testid="home.nextMore"
          @click="more = true"
        >
          {{ t('series.seeAll', { count: started.all.length }) }}<UiIcon name="chevron" :size="13" />
        </button>
      </div>
      <UiListMotion tag="ul" :aria-label="t('series.next')">
        <HomeNextRow
          v-for="(item, index) in shown"
          :key="`${item.series.id}:${item.next.workId ?? item.next.title}`"
          :item="item"
          testid="home.next"
          :eager="index < 3"
          @more="openMenu"
        />
      </UiListMotion>
    </section>
    <HomeNextSheet v-model:open="more" :items="sheetItems" :muted="series.muted" @more="openMenu" />
    <HomeNextMenu v-model:open="menuOpen" :item="menu" />
  </UiReveal>
</template>

<style scoped>
/* The drawn pill is 32 px; the touch target stays 44. */
.more::after {
  position: absolute;
  inset: 50% 0 auto;
  height: var(--size-touch);
  content: '';
  transform: translateY(-50%);
}
</style>
