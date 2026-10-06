<script setup lang="ts">
// Change edition (issue #41), opened from the book page's options. The
// editions the entry can change to, one row each — cover, title in the serif,
// author, then language, year, pages, ebook and publisher in small mono — the entry's own
// edition first, marked and picked. A tap picks another (the lamp check moves
// to it); the sheet's action changes to it, and a refusal shows on the picked
// row. The list grows while the sources
// answer, new rows only ever added at the end; where an edition came from is
// never shown (an Apple edition says "ebook", which is what it is). `changed` fires with the
// entry once it points at the new Book, so the page can move to its address.
import type { EditionCandidate } from '~/data/editions'
import { editionFacts } from '~/data/editions'
import type { LibraryEntry } from '~/data/library'
import { useEditionStore } from '~/stores/edition'

const emit = defineEmits<{ changed: [entry: LibraryEntry] }>()

const { t, locale } = useI18n()
const edition = useEditionStore()
// Changing writes: offline the action says so instead (#15).
const online = useOnline()

const open = computed({
  get: () => edition.changing !== null,
  set: (value) => {
    if (!value) edition.close()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const rows = ref<EditionCandidate[]>(edition.candidates)
watch(
  () => edition.candidates,
  (value) => {
    if (edition.changing) rows.value = value
  },
)

const action = computed(() => {
  if (!online.value) return t('common.offline')
  return edition.busy ? t('book.edition.busy') : t('book.edition.action')
})

/** Language · year · pages · ebook (Apple's editions) · publisher, whichever the edition has (Apple's have no language). */
function facts(candidate: EditionCandidate): string[] {
  return editionFacts(candidate.book, {
    locale: locale.value,
    pages: (count) => t('book.pages', { count }),
    ebook: t('book.edition.ebook'),
  })
}

/** The rows the sheet opens on: their covers load at once and first; the rest lazily, ahead of the scroll. */
const FIRST_COVERS = 6

const others = computed(() => rows.value.filter((candidate) => !candidate.current).length)

async function change() {
  const changed = await edition.confirm()
  if (changed) emit('changed', changed)
}
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('book.edition.title')"
    testid="edition"
    :action="action"
    :action-disabled="!online || edition.busy || !edition.choice"
    @action="change"
  >
    <p class="mx-xs mb-ms text-caption text-ink-faint">{{ t('book.edition.hint') }}</p>

    <UiRowGroup role="radiogroup" :aria-label="t('book.edition.listLabel')">
      <button
        v-for="(candidate, index) in rows"
        :key="index"
        type="button"
        role="radio"
        :aria-checked="edition.isPicked(candidate.book)"
        :disabled="edition.busy"
        class="option relative flex w-full items-center gap-ms px-inset py-sm text-left active:bg-fill-strong disabled:opacity-50"
        data-testid="edition.candidate"
        @click="edition.pick(candidate)"
      >
        <UiCover
          decorative
          :title="candidate.book.title"
          :authors="candidate.book.authors"
          :src="coverSrc(candidate.book.coverUrl, 'sm')"
          :fallbacks="coverFallbacks(candidate.book, 'sm')"
          :thumbhash="candidate.book.coverThumbhash"
          :colors="candidate.book.coverColors"
          size="sm"
          :eager="index < FIRST_COVERS"
          :priority="index < FIRST_COVERS"
        />
        <span class="flex min-w-0 flex-1 flex-col gap-xxs">
          <span class="book-title title-wrap text-callout text-ink" data-testid="edition.candidateTitle">{{ candidate.book.title }}</span>
          <span class="truncate text-caption text-ink-faint">{{ formatAuthors(candidate.book.authors, t('common.etAl')) }}</span>
          <!-- The last fact (the publisher, mostly) is the one that gives way when the row is narrow. -->
          <span v-if="facts(candidate).length" class="figures flex min-w-0 items-center gap-xs text-meta text-ink-faint" data-testid="edition.candidateFacts">
            <template v-for="(fact, i) in facts(candidate)" :key="i">
              <span v-if="i" class="size-(--spacing-xxs) shrink-0 rounded-pill bg-current" aria-hidden="true" />
              <span :class="i === facts(candidate).length - 1 ? 'min-w-0 truncate' : 'shrink-0 whitespace-nowrap'">{{ fact }}</span>
            </template>
          </span>
          <span v-if="candidate.current" class="text-footnote text-ink-muted" data-testid="edition.current">{{ t('book.edition.current') }}</span>
          <!-- A refusal shows on the edition it is about, where the member is looking. -->
          <span
            v-if="edition.error && edition.isPicked(candidate.book)"
            class="text-footnote whitespace-normal text-error"
            role="alert"
            data-testid="edition.error"
          >
            {{ t(`library.error.${edition.error}`) }}
          </span>
        </span>
        <span class="check flex size-(--size-star-lg) shrink-0 items-center justify-center rounded-pill" :class="edition.isPicked(candidate.book) && 'on'" aria-hidden="true">
          <UiIcon v-if="edition.isPicked(candidate.book)" name="check" :size="14" bold />
        </span>
      </button>
    </UiRowGroup>

    <p v-if="edition.pending" class="mt-ms px-xs text-caption text-ink-faint" role="status" data-testid="edition.loading">
      {{ t('book.edition.loading') }}
    </p>
    <div v-else-if="edition.failed" class="mt-ms flex items-center justify-between gap-sm px-xs" data-testid="edition.failed">
      <p class="text-caption text-ink-faint">{{ t('book.edition.failed') }}</p>
      <UiButton tone="secondary" size="sm" data-testid="edition.retry" @click="edition.look()">{{ t('book.edition.retry') }}</UiButton>
    </div>
    <p v-else-if="!others" class="mt-ms px-xs text-caption text-ink-faint" data-testid="edition.none">
      {{ t('book.edition.none') }}
    </p>

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
