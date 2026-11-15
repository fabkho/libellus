<script setup lang="ts">
// The books behind a column or a star row of the Profile (issue #78): a
// month's books in the order they ended, or the books rated so, best first.
// A sheet over the Profile; a row opens its book page (which closes the sheet).
// Home's "Read in 2026" opens the same sheet for a whole year (HomeTallySheet),
// with its own test IDs (`testid`) and two slots around the list: `top`, above
// the rows (the owner's row of that year's Books), and `foot`, under them.
// A Book opened from it and Back from there: the sheet is open again, as it was
// left, which `restore` says (`UiSheet`).
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
//
// `quickRate` (issue #14, her own unrated sheet only, never a member's): every row carries the quick rating
// under its text (components/profile/RateRow.vue) and leaves the list once it is rated — its room closes over
// `standard` while it fades (UiListMotion, docs/MOTION.md "Move only what changed"; with Reduce Motion the list
// simply changes), and the figures behind the sheet follow at once (`stats.rated`). The Rating is written through
// the Book page's own path (`history.rateSession` → `update_session`, offline into the outbox like every Rating).
// Right after one, a pill at the foot offers Undo for 5 s, as Home's card offers it (ReadingCard.vue); rated the
// last of them away and the sheet says so (`profile.sheet.emptyRated`).
//
// `quickTotal` (issue #60, her own pagesMissing sheet only, never a member's): every row carries a small
// number field holding the page count that read has, and what she types there is her own count for it —
// the override only (`library_entries.page_count_override`, never the edition's `books.page_count` and
// never recorded progress), through `stats.setTotal` and the same outbox as every other write. The read
// leaves the list and the "N without a count" line behind the sheet decrements at once; an emptied field
// clears the override back to the edition's count.
import type { StatsRead } from '~/data/stats'
import type { SheetRestore } from '#layers/ui/app/utils/sheetRestore'
import { moreRows, nextPage, openingRows } from '~/utils/pageRows'
import { useHistoryStore } from '~/stores/history'
import { useStatsStore } from '~/stores/stats'

const open = defineModel<boolean>('open', { required: true })
const props = withDefaults(
  defineProps<{
    title: string
    reads: readonly StatsRead[]
    withYear?: boolean
    foreign?: boolean
    quickRate?: boolean
    quickTotal?: boolean
    testid?: string
    restore?: SheetRestore | null
    loading?: boolean
    empty?: string
  }>(),
  { withYear: false, foreign: false, quickRate: false, quickTotal: false, testid: 'profileReads', restore: null, loading: false, empty: undefined },
)

const { t } = useI18n()
const { count } = useFigures()
const history = useHistoryStore()
const stats = useStatsStore()

/** How many rows are drawn: a page, or what the sheet was left with when it comes back from a Book. */
const shown = ref(openingRows(props.restore?.shown))
watch(open, (isOpen) => {
  if (isOpen) {
    shown.value = openingRows(props.restore?.shown)
    return
  }
  clearTimeout(undoTimer)
  undo.value = null
})
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
    const row = list.value?.querySelectorAll<HTMLElement>(`[data-testid="${props.testid}.row"]`)[before]
    row?.querySelector<HTMLElement>('a, button')?.focus({ preventScroll: true })
  })
}
useMoreWhenNear(end, () => shown.value, showMore)

// ------------------------------------------------------------- quick rating

/** The quick rating on her own unrated sheet (`quickRate`); a member's sheet never carries it. */
const rateable = computed(() => props.quickRate && !props.foreign)

/** The reads whose Rating is on its way, by session: their stars wait for it (never two taps in one row). */
const writing = reactive(new Set<string>())

/** The Rating just made, and the read it was made to: Undo is on offer for a moment (5 s, as Home's card). */
const undo = ref<{ read: StatsRead; stars: number } | null>(null)
let undoTimer: ReturnType<typeof setTimeout> | undefined
const UNDO_MS = 5000

async function rate(read: StatsRead, stars: number | null) {
  if (writing.has(read.sessionId)) return
  writing.add(read.sessionId)
  const quarters = stars === null ? null : stars * 4
  const ok = await history.rateSession(read.entryId, read.sessionId, quarters)
  writing.delete(read.sessionId)
  if (!ok) return
  // The read leaves the unrated list and the figures follow at once; the database is the authority when the write lands.
  stats.rated(read.sessionId, quarters)
  clearTimeout(undoTimer)
  undo.value = stars ? { read, stars } : null
  if (stars) undoTimer = setTimeout(() => (undo.value = null), UNDO_MS)
}

/** The last Rating goes back to none: the row comes back into the list, where it was. */
function undoIt() {
  const last = undo.value
  clearTimeout(undoTimer)
  undo.value = null
  if (last) void rate(last.read, null)
}
onBeforeUnmount(() => clearTimeout(undoTimer))

// --------------------------------------------------------------- her own total

/**
 * Her own page count on a read of the pagesMissing sheet (issue #60): a small number field under the row,
 * holding the count the read has (its edition's, or the one she set before), empty for the edition's again.
 * Her own sheet only, never a member's.
 */
const totalsEditable = computed(() => props.quickTotal && !props.foreign)

/** The reads whose total is on its way, by session: the field waits for it (never two writes in one row). */
const totalling = reactive(new Set<string>())

/**
 * What she has typed in a row's field and not sent yet, by session: the field's own model, so a record landing
 * under it (the sheet re-rendering) never throws her typing away.
 */
const drafts = reactive(new Map<string, string>())

/** What the field holds: what she typed, else the count the read has (nothing when it has none). */
const totalOf = (read: StatsRead) => drafts.get(read.sessionId) ?? (read.pages === null ? '' : String(read.pages))

/** A keystroke in a row's field: kept, and sent when she confirms it. */
function typed(read: StatsRead, event: Event) {
  drafts.set(read.sessionId, (event.target as HTMLInputElement).value)
}

/**
 * A total set in the field, or the field emptied (`null`: the edition's count again). The override is written
 * (`library_entries.page_count_override` only, never the edition's count) and the list and figures behind the
 * sheet follow at once; a number the database would refuse is not sent, the field goes back to what it had.
 */
async function setTotal(read: StatsRead) {
  const text = (drafts.get(read.sessionId) ?? totalOf(read)).trim()
  if (totalling.has(read.sessionId)) return
  const pageCount = text === '' ? null : Number(text)
  if (pageCount !== null && (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 99999)) {
    drafts.delete(read.sessionId)
    return
  }
  if (String(pageCount ?? '') === String(read.pages ?? '')) {
    drafts.delete(read.sessionId)
    return
  }
  totalling.add(read.sessionId)
  const ok = await stats.setTotal(read.sessionId, read.entryId, pageCount)
  totalling.delete(read.sessionId)
  // Either way the row says what the record says now: hers written, or the record unmoved by a refusal.
  drafts.delete(read.sessionId)
  // A refusal (`progress_invalid`, `entry_not_found`, offline with nowhere to queue it) is the store's to keep:
  // the record stays as it was, and the field shows it, so nothing claims a total the database does not have.
  void ok
}

/** Enter is the field's done, and so is leaving it: both send what is in it, once. */
function entered(read: StatsRead, event: Event) {
  const field = event.target as HTMLInputElement
  void setTotal(read).then(() => field.blur())
}

/** What a list with no Books says: `empty`, or, rated the last of them away, that everything is rated. */
const emptyText = computed(() => props.empty ?? (rateable.value ? t('profile.sheet.emptyRated') : undefined))
</script>

<template>
  <UiSheet v-model:open="open" :title="title" :testid="testid" :restore="restore">
    <slot name="top" />
    <div ref="list" class="flex flex-col" :data-testid="`${testid}.list`" :aria-busy="loading || undefined">
      <template v-if="loading && !reads.length">
        <ProfileRowPlaceholder v-for="i in 6" :key="i" :wave="i * 0.06" :data-testid="`${testid}.placeholder`" />
      </template>
      <!-- Rows come and go whole (a rated one leaves, an undone one comes back): the change moves in place. -->
      <UiListMotion still class="flex flex-col">
        <div v-for="read in rows" :key="read.sessionId" class="flex flex-col" :data-testid="`${testid}.row`">
          <ProfileReadRow :read="read" :with-year="withYear" :foreign="foreign" :data-testid="`${testid}.read`" />
          <ProfileRateRow
            v-if="rateable"
            :read="read"
            :busy="writing.has(read.sessionId)"
            :testid="`${testid}.rate`"
            @rate="(stars) => rate(read, stars)"
          />
          <!-- Her own page count on this read (the pagesMissing sheet, issue #60): empty is the edition's count. -->
          <div v-if="totalsEditable" class="total flex items-center">
            <input
              type="number"
              inputmode="numeric"
              min="1"
              max="99999"
              class="figures w-18 rounded-sm border-hairline bg-transparent px-xs py-xxs text-callout text-ink tabular-nums"
              :value="totalOf(read)"
              :aria-label="t('profile.figures.pagesMissingYourTotal', { title: read.book.title })"
              :disabled="totalling.has(read.sessionId)"
              :data-testid="`${testid}.total`"
              @input="typed(read, $event)"
              @change="setTotal(read)"
              @keydown.enter.prevent="entered(read, $event)"
            >
          </div>
        </div>
      </UiListMotion>
    </div>
    <p v-if="emptyText && !loading && !reads.length" class="py-xl text-center text-subhead text-ink-muted" :data-testid="`${testid}.empty`">{{ emptyText }}</p>
    <div v-if="next" ref="end" class="flex justify-center py-sm">
      <UiButton tone="plain" size="md" :data-testid="`${testid}.more`" @click="showMore">{{ t('profile.sheet.showMore', { count: count(next) }) }}</UiButton>
    </div>
    <slot name="foot" />
    <!-- Room for the Undo pill (below), held whether it is showing or not: nothing moves under the stars, and no row is ever under it. -->
    <div v-if="rateable" class="h-(--size-touch)" aria-hidden="true" />
    <!-- The Rating just made and its Undo (5 s): a pill over the foot of the sheet, as the reader's toast. -->
    <div v-if="rateable" class="toast pointer-events-none fixed inset-x-0 z-40 flex justify-center px-ml">
      <Transition name="toast">
        <div v-if="undo" class="flex items-center gap-sm rounded-pill bg-ink px-md py-xs shadow-float">
          <p class="figures text-meta text-on-ink" role="status" :data-testid="`${testid}.rated`">
            {{ t('profile.sheet.rated', { count: undo.stars }, undo.stars) }}
          </p>
          <button type="button" class="pointer-events-auto text-meta font-medium text-on-ink underline" :data-testid="`${testid}.undo`" @click="undoIt">
            {{ t('profile.sheet.undo') }}
          </button>
        </div>
      </Transition>
    </div>
  </UiSheet>
</template>

<style scoped>
/* The pill over the sheet's foot: the reader's toast (components/reader/Reader.vue). */
.toast {
  bottom: calc(var(--safe-area-bottom) + var(--spacing-md) - var(--viewport-pan, 0px));
}
.toast-enter-active {
  transition: opacity var(--duration-quick) var(--ease-standard);
}
.toast-leave-active {
  transition: opacity var(--duration-exit) var(--ease-exit);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}

/* The total's field: under the row's own text column, as the stars (RateRow.vue). */
.total {
  padding-bottom: var(--spacing-sm);
  padding-left: calc(var(--size-cover-sm) + var(--spacing-inset));
}
</style>
