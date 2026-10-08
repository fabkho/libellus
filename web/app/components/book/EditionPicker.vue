<script setup lang="ts">
// The Change edition sheet (issue #41), as a part that only draws what it is
// given: the editions one row each — cover, title in the serif, author, then
// language, year, pages, ebook and publisher in small mono — the current
// edition first, marked; a tap picks one (the lamp check moves to it) and the
// sheet's action takes it. Where the editions come from and what the action
// does is its host's: the Book page's Change edition (BookEditionSheet: the
// entry changes to the edition) and the import's Choose edition
// (ImportEditionSheet: the preview's row takes it). The list grows while the
// sources answer, new rows only ever added at the end, each opening its room
// and fading in while the ones after it (the status line, "My edition isn't
// listed") glide down (UiListMotion, docs/MOTION.md, "Change edition's list";
// `still`, since rows are only added and the sheet may still be rising);
// where an edition came from is never shown (an Apple edition says "ebook",
// which is what it is).
// Over the list the host may put more (`top`: the Book page's format of the
// picked edition); under it, "My edition isn't listed" (`missing`) leads on
// to finding her edition by its ISBN, or making it herself.
import { formatOf, type Book, type BookFormat, type BookSnapshot } from '~/data/books'
import { editionFacts } from '~/data/editions'
import type { LibraryErrorCode } from '~/data/library'

export type EditionRow = {
  book: Book | BookSnapshot
  /** The edition the host has now: marked, and the one picked until another is. */
  current: boolean
  /** A line under the facts that says what the row is (the import's "As in the file"). */
  note?: string
  /** The format the row says, when the host knows better than the source (her own word on it). */
  format?: BookFormat | null
}

const props = defineProps<{
  rows: readonly EditionRow[]
  title: string
  hint: string
  /** The action's words (it says "Offline" or "Changing…" itself when it cannot go). */
  action: string
  actionDisabled: boolean
  isPicked: (book: Book | BookSnapshot) => boolean
  /** What the current row says; the Book page's is "Your edition". */
  currentLabel: string
  /** Some source has not answered yet. */
  pending: boolean
  /** Every source failed: only what is shown is known. */
  failed: boolean
  /** Rows cannot be picked while the host is busy with its change. */
  busy?: boolean
  /** A refusal, shown on the picked row. */
  error?: LibraryErrorCode | null
  /** The search cannot run offline; says so in place of "Looking for…" and "failed". */
  offline?: string | null
  /** What an empty list says (no other edition). */
  none?: string
  /** "My edition isn't listed": shown under the list when the host has the step that follows. */
  missing?: string
}>()
const emit = defineEmits<{ pick: [row: EditionRow]; action: []; retry: []; missing: [] }>()
const open = defineModel<boolean>('open', { required: true })

const { t, locale } = useI18n()

/** Language · year · pages · format · publisher, whichever the edition has (Apple's have no language). */
function facts(row: EditionRow): string[] {
  const words = { locale: locale.value, pages: (count: number) => t('book.pages', { count }), format: (format: BookFormat) => t(`book.formatFact.${format}`) }
  return editionFacts(row.book, words, row.format !== undefined ? row.format : formatOf(row.book))
}

/** The rows the sheet opens on: their covers load at once and first; the rest lazily, ahead of the scroll. */
const FIRST_COVERS = 6

const others = computed(() => props.rows.filter((row) => !row.current).length)

/**
 * The one line under the list, if any: what the search is doing or has found. It opens and
 * closes its room (UiReveal) so what sits under it glides instead of jumping, and keeps its
 * words while it closes.
 */
const status = computed<'offline' | 'loading' | 'failed' | 'none' | null>(() => {
  if (props.offline) return 'offline'
  if (props.pending) return 'loading'
  if (props.failed) return 'failed'
  return others.value ? null : 'none'
})
const said = ref(status.value)
watch(status, (now) => {
  if (now) said.value = now
})

/**
 * A sheet that opens again starts its list afresh: the rows it kept while sliding away are
 * not animated out, and the ones it opens on are there from the first frame, only what arrives
 * afterwards moves in.
 */
const opened = ref(0)
watch(open, (now) => {
  if (now) opened.value += 1
})

/** What a row is, under its facts: the current edition's label, and the host's note. */
function says(row: EditionRow): string {
  return [row.current ? props.currentLabel : '', row.note ?? ''].filter(Boolean).join(' · ')
}
</script>

<template>
  <UiSheet v-model:open="open" :title="title" testid="edition" :action="action" :action-disabled="actionDisabled" @action="emit('action')">
    <p class="mx-xs mb-ms text-caption text-ink-faint" data-testid="edition.hint">{{ hint }}</p>
    <slot name="top" />

    <UiRowGroup>
      <UiListMotion :key="opened" still role="radiogroup" :aria-label="t('book.edition.listLabel')">
        <button
          v-for="(row, index) in rows"
          :key="index"
          type="button"
          role="radio"
          :aria-checked="isPicked(row.book)"
          :disabled="busy"
          class="option relative flex w-full items-center gap-ms px-inset py-sm text-left active:bg-fill-strong disabled:opacity-50"
          data-testid="edition.candidate"
          @click="emit('pick', row)"
        >
          <UiCover
            decorative
            :title="row.book.title"
            :authors="row.book.authors"
            :src="coverSrc(row.book.coverUrl, 'sm')"
            :fallbacks="coverFallbacks(row.book, 'sm')"
            :thumbhash="row.book.coverThumbhash"
            :colors="row.book.coverColors"
            size="sm"
            :eager="index < FIRST_COVERS"
            :priority="index < FIRST_COVERS"
          />
          <span class="flex min-w-0 flex-1 flex-col gap-xxs">
            <span class="book-title title-wrap text-callout text-ink" data-testid="edition.candidateTitle">{{ row.book.title }}</span>
            <span class="truncate text-caption text-ink-faint">{{ formatAuthors(row.book.authors, t('common.etAl')) }}</span>
            <!-- The last fact (the publisher, mostly) is the one that gives way when the row is narrow. -->
            <span v-if="facts(row).length" class="figures flex min-w-0 items-center gap-xs text-meta text-ink-faint" data-testid="edition.candidateFacts">
              <template v-for="(fact, i) in facts(row)" :key="i">
                <span v-if="i" class="size-(--spacing-xxs) shrink-0 rounded-pill bg-current" aria-hidden="true" />
                <span :class="i === facts(row).length - 1 ? 'min-w-0 truncate' : 'shrink-0 whitespace-nowrap'">{{ fact }}</span>
              </template>
            </span>
            <span v-if="says(row)" class="text-footnote text-ink-muted" data-testid="edition.current">{{ says(row) }}</span>
            <!-- A refusal shows on the edition it is about, where the member is looking. -->
            <span
              v-if="error && isPicked(row.book)"
              class="text-footnote whitespace-normal text-error"
              role="alert"
              data-testid="edition.error"
            >
              {{ t(`library.error.${error}`) }}
            </span>
          </span>
          <span class="check flex size-(--size-star-lg) shrink-0 items-center justify-center rounded-pill" :class="isPicked(row.book) && 'on'" aria-hidden="true">
            <UiIcon v-if="isPicked(row.book)" name="check" :size="14" bold />
          </span>
        </button>
      </UiListMotion>
    </UiRowGroup>

    <UiReveal :show="status !== null">
      <p v-if="said === 'offline'" class="mt-ms px-xs text-caption text-ink-faint" role="status" data-testid="edition.offline">{{ offline }}</p>
      <p v-else-if="said === 'loading'" class="mt-ms px-xs text-caption text-ink-faint" role="status" data-testid="edition.loading">
        {{ t('book.edition.loading') }}
      </p>
      <div v-else-if="said === 'failed'" class="mt-ms flex items-center justify-between gap-sm px-xs" data-testid="edition.failed">
        <p class="text-caption text-ink-faint">{{ t('book.edition.failed') }}</p>
        <UiButton tone="secondary" size="sm" data-testid="edition.retry" @click="emit('retry')">{{ t('book.edition.retry') }}</UiButton>
      </div>
      <p v-else class="mt-ms px-xs text-caption text-ink-faint" data-testid="edition.none">
        {{ none ?? t('book.edition.none') }}
      </p>
    </UiReveal>

    <UiButton v-if="missing" class="mt-ml" tone="secondary" block :disabled="busy" data-testid="edition.missing" @click="emit('missing')">
      <UiIcon name="search" :size="18" />{{ missing }}
    </UiButton>

    <div class="h-(--spacing-lg)" />
  </UiSheet>
</template>

<style scoped>
.option + .option::before {
  position: absolute;
  top: 0;
  right: 0;
  left: calc(var(--spacing-inset) + var(--size-cover-sm) + var(--spacing-ms));
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

/* D's check, as in the collection picker: a hairline ring; picked, a lamp-lit disc with the tick in it. */
.check {
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-ink-faint);
  color: var(--color-on-ink);
  transition:
    background-color var(--duration-quick) var(--ease-standard),
    box-shadow var(--duration-quick) var(--ease-standard);
}

.check.on {
  background: var(--color-accent);
  box-shadow: 0 0 var(--spacing-ms) var(--color-accent-soft);
}
</style>
