<script setup lang="ts">
// The reading history on the book page (D's book-finished timeline; issue
// #11): every read of the Book as a thin thread, newest first. A node for each
// (lit for the one being read), its name — "First read", "Second read", or
// "Reading now" — the outcome (Finished, Not finished), the Rating as stars,
// the days it ran and how many (counted inclusively, as everywhere: "day 13"
// for the read in progress, "13 days" for a finished one, "1 day" for a read
// that began and ended on one day, which also shows one date), then its review (or the reason it was put
// down) in the serif. Edit opens the Edit sheet for that read. The block
// reads the history itself and again whenever the entry changes (a finish,
// an abandon, a read again, an edit elsewhere on the page).
import type { LibraryEntry, ReadingSession } from '~/data/library'
import { useHistoryStore } from '~/stores/history'

const props = defineProps<{ entry: LibraryEntry }>()

const { t } = useI18n()
const { formatDay, dayOfRead } = useDays()
const history = useHistoryStore()

watch(() => props.entry, (entry) => void history.load(entry.id), { immediate: true })

const reads = computed(() => history.sessions.get(props.entry.id) ?? null)

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'] as const

function name(read: ReadingSession, index: number): string {
  if (!read.outcome) return t('history.readingNow')
  const total = reads.value?.length ?? 0
  if (total < 2) return t('history.thisRead')
  const n = total - index
  const ordinal = ORDINALS[n - 1]
  return ordinal ? t(`history.ordinal.${ordinal}`) : t('history.nth', { n })
}

/** "3 Oct – 10 Oct", "3 Oct" for a read begun and ended on one day, "Since 3 Oct" for an open read, whichever day a logged-later read has. */
function dates(read: ReadingSession): string {
  const { startedOn, endedOn } = read
  if (!read.outcome) return startedOn ? t('history.since', { date: formatDay(startedOn) }) : ''
  if (startedOn && endedOn) {
    if (startedOn === endedOn) return formatDay(endedOn)
    const sameYear = startedOn.slice(0, 4) === endedOn.slice(0, 4)
    return t('history.range', { from: formatDay(startedOn, { year: !sameYear }), to: formatDay(endedOn) })
  }
  if (endedOn) return t('history.endedOn', { date: formatDay(endedOn) })
  if (startedOn) return t('history.startedOn', { date: formatDay(startedOn) })
  return t('history.undated')
}

/** How long the read ran, both ends counted: "day 13" while it is open (as the status line says), "13 days" once closed. Unknown when a day is missing. */
function days(read: ReadingSession): string {
  if (!read.startedOn || (read.outcome && !read.endedOn)) return ''
  if (!read.outcome) return t('history.day', { day: dayOfRead(read.startedOn) })
  const count = daysSpanned(read.startedOn, read.endedOn!)
  return t('history.days', { count }, count)
}

function outcome(read: ReadingSession): string {
  return read.outcome === 'abandoned' ? t('status.notFinished') : read.outcome === 'finished' ? t('status.finished') : ''
}
</script>

<template>
  <section v-if="reads?.length" class="relative px-ml pt-xl" data-testid="history">
    <div class="mb-ms flex items-center justify-between">
      <h2 class="eyebrow" data-testid="history.title">{{ t('history.title') }}</h2>
      <span class="eyebrow text-ink-faint" data-testid="history.count">{{ t('history.count', { count: reads.length }, reads.length) }}</span>
    </div>
    <ol class="timeline flex flex-col gap-ml" data-testid="history.list">
      <li
        v-for="(read, index) in reads"
        :key="read.id"
        class="session relative pl-ml"
        :class="!read.outcome && 'open'"
        data-testid="history.session"
      >
        <span class="node absolute" aria-hidden="true" />
        <div class="flex items-center justify-between gap-ms">
          <p class="flex min-w-0 items-baseline gap-sm">
            <span class="truncate text-body font-medium" data-testid="history.name">{{ name(read, index) }}</span>
            <span v-if="read.outcome" class="flex shrink-0 items-center gap-xs text-meta text-ink-faint" data-testid="history.outcome">
              <UiIcon v-if="read.outcome === 'abandoned'" name="slash" :size="12" />{{ outcome(read) }}
            </span>
          </p>
          <UiStars v-if="read.rating" :quarters="read.rating" size="sm" data-testid="history.rating" />
        </div>
        <div class="flex items-center justify-between gap-ms">
          <p class="figures text-meta text-ink-faint" data-testid="history.dates">
            {{ dates(read) }}<template v-if="days(read)"> · <span data-testid="history.days">{{ days(read) }}</span></template>
          </p>
          <button
            type="button"
            class="edit -my-sm -mr-sm flex min-h-(--size-touch) min-w-(--size-touch) items-center justify-end px-sm text-subhead text-ink-muted"
            :aria-label="t('history.editLabel', { name: name(read, index) })"
            data-testid="history.edit"
            @click="history.openEdit(entry, read)"
          >
            {{ t('history.edit') }}
          </button>
        </div>
        <p v-if="read.review" class="note mt-xs font-serif text-callout text-ink-muted italic" data-testid="history.review">{{ read.review }}</p>
        <p v-else-if="read.abandonReason" class="note mt-xs font-serif text-callout text-ink-muted italic" data-testid="history.reason">
          {{ read.abandonReason }}
        </p>
      </li>
    </ol>
  </section>
  <p v-else-if="history.loadError && !reads" class="relative px-ml pt-xl text-caption text-ink-faint" data-testid="history.error">
    {{ t('history.loadError') }}
  </p>
</template>

<style scoped>
/* The thread through the reads. */
.session::before {
  position: absolute;
  top: var(--spacing-ms);
  bottom: calc(var(--spacing-ml) * -1);
  left: calc(var(--spacing-xs) - var(--stroke-hairline));
  width: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

.session:last-child::before {
  display: none;
}

.node {
  top: var(--spacing-xs);
  left: 0;
  width: var(--spacing-sm);
  height: var(--spacing-sm);
  border-radius: var(--radius-pill);
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-ink-faint);
}

/* D's reading lamp: the lit node of the read in progress. */
.open .node {
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-ms) var(--spacing-xxs) color-mix(in srgb, var(--color-accent) 50%, transparent);
}

.note {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
</style>
