<script setup lang="ts">
// Home's "Read in 2026", opened: the year's Books in a sheet (ProfileReadsSheet,
// the Profile's own, with its own test IDs). For the shelf owner alone, the
// year's Books as Regal's row come first, in a card of the Profile's size
// (ShelfRowCard, the same lazy `regal` chunk as the Profile's; nobody else
// renders it, so nobody else fetches it). A Book tapped there breaks out above
// the sheet (`--shelf-row-z`: the sheet is z 50) and the system's Back puts it
// back before it closes the sheet. Under the row, for everyone, the year's
// finished reads, newest first, each opening its book page; at the end a quiet
// way on to the year in review.
import { finishedIn } from '~/data/stats'
import { useShelfStore } from '~/stores/shelf'
import { useStatsStore } from '~/stores/stats'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ year: number }>()

const { t } = useI18n()
const stats = useStatsStore()
const shelf = useShelfStore()

const reads = computed(() => finishedIn(stats.record?.reads ?? [], props.year))
const shelfBooks = computed(() => (shelf.isOwner ? shelf.readIn(props.year) : []))

// The record is read afresh each time the sheet opens (a Finish since the
// Profile was last open); what is there shows meanwhile. The shelf's file is a
// no-op for anyone but the owner.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    void stats.load()
    void shelf.load()
  },
  { immediate: true },
)
</script>

<template>
  <ProfileReadsSheet v-model:open="open" :title="t('home.readIn', { year })" :reads="reads" testid="homeTally">
    <template #top>
      <!-- A drag that starts on the row is the row's (and the page's), never the sheet's swipe down. -->
      <div v-if="shelfBooks.length" class="shelf-slot mb-md" data-no-swipe>
        <ShelfRowCard :books="shelfBooks" :year="year" :label="t('shelf.year.rowLabel', { year })" data-testid="homeTally.shelfRow" />
      </div>
    </template>

    <template #foot>
      <div v-if="!stats.record && stats.loadError" class="flex flex-col items-center gap-md py-lg text-center" data-testid="homeTally.loadError">
        <p class="text-subhead text-ink-muted">{{ stats.loadError === 'offline' ? t('profile.offline') : t('profile.loadError') }}</p>
        <UiButton v-if="stats.loadError !== 'offline'" tone="secondary" size="md" data-testid="homeTally.retry" @click="stats.load()">{{ t('profile.retry') }}</UiButton>
      </div>
      <div class="flex justify-end pt-xs">
        <UiButton tone="plain" size="sm" class="-mr-sm" :to="`/profile/${year}`" data-testid="homeTally.yearInReview">
          {{ t('home.yearInReview') }}<UiIcon name="chevron" :size="15" />
        </UiButton>
      </div>
    </template>
  </ProfileReadsSheet>
</template>

<style scoped>
/* The sheet is z 50: a Book broken out of the row above it (shelf/Row.vue) must
   be over it, and still under a dialog (60). */
.shelf-slot {
  --shelf-row-z: 55;
}
</style>
