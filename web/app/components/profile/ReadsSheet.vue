<script setup lang="ts">
// The books behind a column or a star row of the Profile (issue #78): a
// month's books in the order they ended, or the books rated so, best first.
// A sheet over the Profile; a row opens its book page (which closes the sheet).
// Home's "Read in 2026" opens the same sheet for a whole year (HomeTallySheet),
// with its own test IDs (`testid`) and two slots around the list: `top`, above
// the rows (the owner's row of that year's Books), and `foot`, under them.
// A Book opened from it and Back from there: the sheet is open again, as it was
// left, which `restore` says (components/ui/Sheet.vue).
//
// The one sheet for a list of Books behind a figure (the Profile's, a year in review's, a member's and Home's
// tally): a header slot (`top`) and a footer (`foot`) around the rows, and the rows in pages. The first 30 are
// drawn; when the end of the list comes within a screen of the view the next 30 are (a button at the end, "Show
// 30 more", does the same for whoever the scroll does not reach: VoiceOver, a keyboard, a browser without
// IntersectionObserver), up to the whole list, so a few hundred reads are never a few hundred rows at once. The
// rows are all on the device, so there is nothing to wait for (utils/pageRows.ts). Back from a Book comes to the
// same rows (`restore.shown`) and the same scroll. A list of up to 30 rows is drawn whole, as it always was.
// `loading` stands in for the rows (never an empty card) while the list is on its way; `empty` says what a list
// with no Books is, where there is something to say (nothing, by default: Home's sheet may be only its slots).
import type { StatsRead } from '~/data/stats'
import type { SheetRestore } from '~/composables/useSheetRestore'
import { moreRows, nextPage, openingRows } from '~/utils/pageRows'

const open = defineModel<boolean>('open', { required: true })
const props = withDefaults(
  defineProps<{
    title: string
    reads: readonly StatsRead[]
    withYear?: boolean
    foreign?: boolean
    testid?: string
    restore?: SheetRestore | null
    loading?: boolean
    empty?: string
  }>(),
  { withYear: false, foreign: false, testid: 'profileReads', restore: null, loading: false, empty: undefined },
)

const { t } = useI18n()
const { count } = useFigures()

/** How many rows are drawn: a page, or what the sheet was left with when it comes back from a Book. */
const shown = ref(openingRows(props.restore?.shown))
watch(open, (isOpen) => isOpen && (shown.value = openingRows(props.restore?.shown)))
const rows = computed(() => props.reads.slice(0, shown.value))
const next = computed(() => nextPage(shown.value, props.reads.length))

const list = useTemplateRef<HTMLElement>('list')
const end = useTemplateRef<HTMLElement>('end')

/** The next page. A button that had focus is gone with the last one: focus goes to the first new row, not to nowhere. */
function showMore() {
  if (!next.value) return
  const before = rows.value.length
  const focused = end.value?.contains(document.activeElement) ?? false
  shown.value = moreRows(shown.value, props.reads.length)
  if (!focused) return
  void nextTick(() => {
    if (!end.value) return
    list.value?.children[before]?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true })
  })
}
useMoreWhenNear(end, () => shown.value, showMore)
</script>

<template>
  <UiSheet v-model:open="open" :title="title" :testid="testid" :restore="restore">
    <slot name="top" />
    <div ref="list" class="flex flex-col" :data-testid="`${testid}.list`" :aria-busy="loading || undefined">
      <template v-if="loading && !reads.length">
        <ProfileRowPlaceholder v-for="i in 6" :key="i" :wave="i * 0.06" :data-testid="`${testid}.placeholder`" />
      </template>
      <ProfileReadRow v-for="read in rows" :key="read.sessionId" :read="read" :with-year="withYear" :foreign="foreign" :data-testid="`${testid}.read`" />
    </div>
    <p v-if="empty && !loading && !reads.length" class="py-xl text-center text-subhead text-ink-muted" :data-testid="`${testid}.empty`">{{ empty }}</p>
    <div v-if="next" ref="end" class="flex justify-center py-sm">
      <UiButton tone="plain" size="md" :data-testid="`${testid}.more`" @click="showMore">{{ t('profile.sheet.showMore', { count: count(next) }) }}</UiButton>
    </div>
    <slot name="foot" />
  </UiSheet>
</template>
