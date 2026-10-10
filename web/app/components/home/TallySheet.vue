<script setup lang="ts">
// Home's "Read in 2026", opened: the year's Books in a sheet (ProfileReadsSheet,
// the Profile's own, with its own test IDs). For the shelf owner alone, the
// year's Books as Regal's row come first, in a card of the Profile's size
// (ShelfRowCard, the same lazy `regal` chunk as the Profile's, warmed from
// Home on idle for the owner: useShelfPreload; nobody else renders it, so
// nobody else fetches it). A Book tapped there breaks out above
// the sheet (`--shelf-row-z`: the sheet is z 50) and the system's Back puts it
// back before it closes the sheet. Under the row, for everyone, the year's
// finished reads, newest first, each opening its book page; at the end a quiet
// way on to the year in review. The owner's sheet is the row and that link and
// nothing else, the card bare so the row sits in the sheet (the list is for
// whoever has no row, and for the owner while her row is not there: the file
// has none of that year's Books, or could not be read).
import { finishedIn } from '~/data/stats'
import type { SheetRestore } from '~/composables/useSheetRestore'
import { useShelfStore } from '~/stores/shelf'
import { useStatsStore } from '~/stores/stats'

const open = defineModel<boolean>('open', { required: true })
// Back from a Book opened from it: open again as it was left (components/ui/Sheet.vue).
const props = withDefaults(defineProps<{ year: number; restore?: SheetRestore | null }>(), { restore: null })

const { t } = useI18n()
const stats = useStatsStore()
const shelf = useShelfStore()

const reads = computed(() => finishedIn(stats.record?.reads ?? [], props.year))
const shelfBooks = computed(() => (shelf.isOwner ? shelf.readIn(props.year) : []))
// The owner's file is on its way: neither the row nor the list yet.
const rowPending = computed(() => shelf.isOwner && !shelf.shelf && !shelf.loadError)
const showList = computed(() => !shelf.isOwner || (!rowPending.value && !shelfBooks.value.length))

// The record is read afresh each time the sheet opens (a Finish since the
// Profile was last open); what is there shows meanwhile. The shelf's file is a
// no-op for anyone but the owner.
watch(
  open,
  (isOpen) => {
    if (!isOpen) return
    void stats.load({ ifStale: true })
    void shelf.load()
  },
  { immediate: true },
)
</script>

<template>
  <ProfileReadsSheet v-model:open="open" :title="t('home.readIn', { year })" :reads="showList ? reads : []" :restore="restore" testid="homeTally">
    <template #top>
      <!-- A drag that starts on the row is the row's (and the page's), never the sheet's swipe down. -->
      <div v-if="shelfBooks.length" class="shelf-slot mb-md" data-no-swipe>
        <ShelfRowCard bare :year="year" :label="t('shelf.year.rowLabel', { year })" data-testid="homeTally.shelfRow" />
      </div>
    </template>

    <template #foot>
      <div v-if="showList && !stats.record && stats.loadError" class="flex flex-col items-center gap-md py-lg text-center" data-testid="homeTally.loadError">
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
