<script setup lang="ts">
// **One card, two screens** (the owner's decision, `docs/proposals/home-card-mocks-2026-11-15.md`, state L): Home's
// Currently reading and the Library's reading tab carry this exact card — the same bar, the same pinned numbers, the
// same percent, the same action. Its V2 shape is `docs/prototypes/home-card/v2-hierarchy.html` (PR #569): cover with
// its glow, serif title, author; then the bar carrying the book's own two numbers — the page reached pinned over the
// tip of the fill, joined to it by a hairline tick, and the total flush with the bar's right end — as bare numerals,
// so every language says them the same and no phrase has a row to itself. Below the bar the whole percent stands
// alone at 20 px ink, with a quiet Update that opens the Update progress sheet (issue #68, design round #65
// direction D): nothing on the card edits by itself. Right after a save the percent is followed by what changed
// ("+24") and Update gives way to Undo for 5 s. At the last page the bar is full and the numbers go, since "The
// end." says it, and Finish (lit) opens the Finish sheet here.
// A read kept in percent, or a page of an edition with no page count, has no numbers on the bar: the percent (or,
// with neither, the place in words) stands alone instead.
// **The two screens differ in exactly one input**: the Library's `since` line, which takes the slot the removed pace
// line held above the bar (`null` on Home, where there is no such line). The Library also passes its own cover width
// (`md`, the Library's design constant — the card's `lg` is Home's) and its own test-id prefix. Nothing else branches
// on which screen it is on: the Library loses its one-tap Finish with this card, deliberately, since finishing has
// gone through the read's own action since #68 (the Finish sheet is one press in, in the progress sheet).
// The cover and the title open the book page from the touch-down. A quiet mark beside the author when its ebook is
// on this device (#131, EbooksMark).
import type { LibraryEntry } from '~/data/library'
import { pageCountOf, progressFraction, progressOf, progressReachedEnd } from '~/data/progress'
import { useBookStore } from '~/stores/book'
import { useReadingStore } from '~/stores/reading'
import type { FriendsGroup } from '~/utils/friendsNames'
import { canReadTogether } from '~/utils/buddyEntry'
// Direct, as this screen asked before own covers: only the Library's row and the reel go through `/cover` (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

const props = withDefaults(
  defineProps<{
    entry: LibraryEntry
    eager?: boolean
    /** The followed members reading the same Book now (social v2a, FriendsAlsoAvatars), on the cover's lower edge. Home only. */
    friends?: FriendsGroup | null
    /** The Library's own line above the bar ("Since 3 Nov · day 12"); `null` on Home, which has no such line. */
    since?: string | null
    /** The cover's width: the Library's design constant is `md`, Home's `lg`. */
    cover?: 'lg' | 'md'
    /** The test ids' prefix: `home` on Home, `library` in the Library. */
    scope?: 'home' | 'library'
    /** Whether this screen carries the card's Read together menu (Home's ⋯): the Library has no such menu, and the card
     *  still refuses it on a Manual book (`canReadTogether`), which has no Catalogue work to share. */
    readTogether?: boolean
  }>(),
  { friends: null, since: null, cover: 'lg', scope: 'home', readTogether: false },
)

const emit = defineEmits<{ together: [entry: LibraryEntry] }>()

const { t, n } = useI18n()
// Buddy reads: the "..." (Read together) is on a card of a Catalogue Book, on a screen that has the menu (Home);
// a Manual book cannot be read together.
const together = computed(() => props.readTogether && canReadTogether(props.entry.book))
const books = useBookStore()
const reading = useReadingStore()
// Updating and finishing work offline too: they wait to sync (#93).
const text = useProgressText()
const progress = computed(() => progressOf(props.entry.latestSession))
// The member's own total when she set one (#60), else the edition's.
const pageCount = computed(() => pageCountOf(props.entry))
const words = computed(() => text(progress.value, pageCount.value))
const atEnd = computed(() => progressReachedEnd(progress.value, pageCount.value))
const authorLine = computed(() => formatAuthors(props.entry.book.authors, t('common.etAl')))
// The bar carries the book's own two numbers while there is a point to pin them to: a page of an edition whose
// length the card knows. A read kept in percent, or a page of an edition without a page count, has neither a total
// to measure against nor a place on the bar to mark, so the bar is bare and the fact below says it; at the last
// page the bar is full and "The end." says it, so the numbers go (V2's two deliberate end states).
const marks = computed(() => {
  const now = progress.value
  return !!now && 'page' in now && !!pageCount.value && !atEnd.value
})
// The two bare numerals: the same figures the sentences use (the locale's grouping and its digits), so "1.234" in German
// reads as it does everywhere else on the card, without the "p." and the "of" that no longer fit.
const currentText = computed(() => (progress.value && 'page' in progress.value ? n(progress.value.page) : '0'))
const totalText = computed(() => (pageCount.value ? n(pageCount.value) : ''))
// Where the current page's label is pinned: over the tip of the fill, as a share of the bar. The CSS clamps it so it is
// never drawn off the card at 0 % nor over the total near the end (the tick below it stays on the tip either way).
const marksAt = computed(() => `${Math.round(progressFraction(progress.value, pageCount.value) * 100)}%`)
// A whole percent, from the same progress the card has: null when it cannot be known (a page without a page count) and when
// the place is already a percent — "45 %" says it once, and one fact below the bar is enough.
const percentText = computed(() =>
  words.value.percent === null || 'percent' in (progress.value ?? {}) ? null : t('book.progress.percent', { percent: words.value.percent }),
)
// The place, big, when it is the card's one fact: a read kept in percent ("45 %"). A page of an edition without a page
// count stays at the caption's size, as it reads today.
const bigWords = computed(() => !percentText.value && !!progress.value && 'percent' in progress.value)
// What the bar says to a screen reader: the percent first, then the place when it is a page. The bar's own numbers are
// bare, so this sentence is where the whole fact is said aloud, and it must not lose the place.
const barValue = computed(() => (percentText.value ? `${percentText.value} · ${words.value.value}` : words.value.value))

// This card's last save, while Undo is on offer.
const undo = computed(() => (reading.progressUndo?.entryId === props.entry.id ? reading.progressUndo : null))
const gain = computed(() => {
  const by = undo.value?.gain
  if (!by) return null
  const key = by.amount > 0 ? (by.unit === 'page' ? 'gainPages' : 'gainPercent') : by.unit === 'page' ? 'lossPages' : 'lossPercent'
  return t(`book.progress.${key}`, { count: n(Math.abs(by.amount)) })
})

/** What the card's one button does now: Finish at the last page, Undo right after a save, else Update. */
const action = computed(() => (atEnd.value ? 'finish' : undo.value ? 'undo' : 'update'))
function act() {
  if (action.value === 'finish') reading.openFinish(props.entry)
  else if (action.value === 'undo') void reading.undoProgress()
  else reading.openProgress(props.entry)
}
</script>

<template>
  <article
    class="relative flex gap-md overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint"
    :data-testid="`${scope}.readingCard`"
  >
    <UiAmbient :colors="entry.book.coverColors" shape="card" />
    <!-- The cover is centred in the card's height, not pinned to its top: the owner's requirement is the same space
         above and below it. The prototype pinned it (`align-self: flex-start`, card.css `.coverwrap`) because there its
         text column is shorter than the cover, so the two looked the same; here the column is usually taller (the
         since line, the bar, the percent, the action), and a pinned cover left all the slack at the bottom. -->
    <div class="relative shrink-0 self-center" :data-testid="`${scope}.readingCardCover`">
      <UiPressLink :to="`/book/${entry.book.id}`" v-on="flightOf(`/book/${entry.book.id}`)" class="relative block" tabindex="-1" aria-hidden="true" @press="books.prefetch(entry.book.id)">
        <UiCover
          :title="entry.book.title"
          :authors="entry.book.authors"
          v-bind="coverImage(entry.book, cover, coverHosts)"
          :thumbhash="entry.book.coverThumbhash"
          :colors="entry.book.coverColors"
          :size="cover"
          glow
          :eager="eager"
        />
      </UiPressLink>
      <!-- Beside the cover's link, not in it: a button inside a link is not a thing. -->
      <FriendsAlsoAvatars
        v-if="friends?.members.length"
        :members="friends.members"
        :more="friends.more"
        kind="reading"
        :testid="`${scope}.readingWith`"
        class="absolute bottom-xs left-1/2 z-10 flex -translate-x-1/2 [--friends-ring:var(--color-surface-raised)]"
      />
    </div>
    <div class="relative flex min-w-0 flex-1 flex-col pt-xxs">
      <!-- Buddy reads: the card's small menu (Read together). At the corner, a button of its own, beside the title's link, never inside it. -->
      <button
        v-if="together"
        type="button"
        class="absolute -top-xs -right-xs z-10 flex size-(--size-touch) items-center justify-center text-ink-faint hover:text-ink"
        aria-haspopup="dialog"
        :aria-label="t('together.entry.moreLabel', { title: entry.book.title })"
        :data-testid="`${scope}.together.more`"
        @click="emit('together', entry)"
      >
        <UiIcon name="more" :size="20" />
      </button>
      <UiPressLink :to="`/book/${entry.book.id}`" v-on="flightOf(`/book/${entry.book.id}`)" class="flex flex-col gap-xs" :class="together && 'pr-ml'" :data-testid="`${scope}.entry`" @press="books.prefetch(entry.book.id)">
        <!-- One line, cut with an ellipsis, so every card is the same height (the owner's requirement): a wrapped title
             grew the card, and the cover then sat centred in the taller one. `title-wrap` rather than `truncate` because
             it keeps the accessibility rule for large text — at 22rem or less (200 % text on a phone) a title may take a
             second line so it is not lost to "The Left Hand of …" (docs/ACCESSIBILITY.md, Text size: the Home card's
             lines wrap there). That growth belongs to the text setting, not to the usual case. The prototype allowed two
             lines unconditionally (card.css `.title`, `-webkit-line-clamp: 2`). -->
        <span class="book-title title-wrap text-book-title" :data-testid="`${scope}.entryTitle`">{{ entry.book.title }}</span>
        <span class="flex min-w-0 items-center gap-xs">
          <span class="truncate text-body text-ink-muted">{{ authorLine }}</span>
          <EbooksMark :entry="entry" :testid="`${scope}.ebookMark`" />
        </span>
      </UiPressLink>
      <!-- The Library's own line, in the slot the pace line held until V2 retired it (`null` on Home, which has none). -->
      <span v-if="since" class="figures mt-sm text-meta text-ink-faint wrap-anywhere" :data-testid="`${scope}.entrySince`">{{ since }}</span>
      <div class="mt-auto pt-md">
        <!-- The bar's own numbers (V2, docs/prototypes/home-card/v2-hierarchy.html): the page reached pinned over the tip
             of the fill, the book's total flush with the bar's right end, and a hairline tick joining the first to the bar.
             Bare numerals in mono, so every language says them the same and no phrase has a row to itself. -->
        <!-- The whole fact is said aloud by the bar itself (`aria-valuetext`: "42 % · p. 126 of 300"), so the bare
             numerals are for the eye only and are not read out a second time. -->
        <div v-if="marks" class="marks" aria-hidden="true" :style="{ '--at': marksAt, '--cur-w': `${currentText.length}ch`, '--total-w': `${totalText.length}ch` }">
          <span class="mark cur figures" :data-testid="`${scope}.progressValue`">{{ currentText }}</span>
          <span class="mark total figures" :data-testid="`${scope}.progressTotal`">{{ totalText }}</span>
          <span class="tick" />
        </div>
        <UiProgress
          :fraction="progressFraction(progress, pageCount)"
          :label="t('book.progress.label')"
          :value-text="barValue"
          :class="marks && 'mt-xs'"
          :data-testid="`${scope}.progressBar`"
        />
      </div>
      <div class="flex items-center justify-between gap-ms pt-xs">
        <p class="prog text-meta wrap-anywhere" :data-testid="`${scope}.progress`">
          <span v-if="atEnd" class="text-body text-ink" :data-testid="`${scope}.theEnd`">{{ t('book.progress.theEnd') }}</span>
          <template v-else>
            <!-- The percent alone under the bar, at 20 px ink: the bar's two numbers say the place, so this line says how
                 far, once. A read kept in percent has no numbers on the bar, so the percent itself is the card's one fact
                 and takes that size. "The end." stands in for it at the last page. -->
            <span v-if="percentText" class="pct figures" :data-testid="`${scope}.progressPercent`">{{ percentText }}</span>
            <span
              v-else
              class="figures"
              :class="bigWords ? 'pct' : progress ? 'text-ink-muted' : 'text-ink-faint'"
              :data-testid="`${scope}.progressValue`"
            >{{ words.value }}</span>
            <!-- What the save changed, in the lamp colour, an aside just after the fact. -->
            <span v-if="gain" class="figures text-accent-ink" :data-testid="`${scope}.progressGain`">{{ gain }}</span>
          </template>
        </p>
        <!-- One button that turns into the next (Update, Undo, Finish) rather than three that take
             turns: the sheet gives focus back to Update when it closes, and the same element, now
             Undo, keeps it instead of focus falling to the page. -->
        <UiButton
          :tone="action === 'finish' ? 'primary' : action === 'undo' ? 'plain' : 'quiet'"
          size="sm"
          :class="action === 'undo' && '-mr-sm'"
          :disabled="action === 'undo' && reading.undoBusy"
          :aria-label="action === 'undo' && gain ? t('book.progress.undoLabel', { change: gain }) : undefined"
          :data-testid="`${scope}.${action}`"
          @click="act"
        >
          <UiIcon v-if="action === 'finish'" name="check" :size="15" bold />
          {{ action === 'finish' ? t('book.finish') : action === 'undo' ? t('book.progress.undo') : t('book.progress.updateShort') }}
        </UiButton>
      </div>
      <!-- Said once a save lands, as a toast would show it: what changed, and that Undo is there. -->
      <span class="sr-only" role="status">{{ gain ? t('book.progress.saved', { change: gain }) : '' }}</span>
    </div>
  </article>
</template>

<style scoped>
/* V2's bar numbers (docs/prototypes/home-card/v2-hierarchy.html; docs/proposals/home-card-mocks-2026-11-15.md
   tells how it was measured). Mono tabular numerals at 10 px on a 13 px strip above the bar: the page reached
   centred over the tip of the fill, the book's total flush with the bar's right end, and a 0.5 px hairline tick
   joining the first to the bar's top edge. Both are `--color-ink-faint`, which the contrast table in
   docs/ACCESSIBILITY.md already holds in both rooms; the whole fact, with its "of", is the bar's aria-valuetext. */
.marks {
  position: relative;
  height: 13px;
  font-size: 10px;
  line-height: 13px;
}

.mark {
  position: absolute;
  bottom: 0;
  color: var(--color-ink-faint);
  white-space: nowrap;
}

/* Centred on the fill's tip, but never off the card at the start (clamped to half its own width) and never drawn
   over the total at the end (clamped to leave it its room and a gap). The widths are exact: both marks are mono
   tabular and the template gives each its length in `ch`, which is one digit's advance in that font. */
.mark.cur {
  left: clamp(calc(var(--cur-w) / 2), var(--at), calc(100% - var(--total-w) - var(--cur-w) / 2 - var(--spacing-xs)));
  transform: translateX(-50%);
}

.mark.total {
  right: 0;
}

/* The tick under the tip: 0.5 px, 4 px tall, ending exactly on the bar's top edge. It stays on the tip even when
   the label above it has been clamped away from the end. */
.tick {
  position: absolute;
  bottom: -4px;
  left: var(--at);
  width: 0.5px;
  height: 4px;
  background: var(--color-hairline-strong);
  transform: translateX(-50%);
}

/* The percent under the bar, alone: 20 px ink, the card's one large number (the prototype's `.pct`). */
.pct {
  font-size: 20px;
  line-height: 24px;
  letter-spacing: -0.02em;
  color: var(--color-ink);
  white-space: nowrap;
}

/* The fact and, after it, what the save changed: one baseline, a small gap (the prototype's `.prog`). */
.prog {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;
}
</style>
