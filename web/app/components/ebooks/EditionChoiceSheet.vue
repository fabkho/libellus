<script setup lang="ts">
// Which edition an ebook file is (issue #131): Find book found another edition
// of a Book in her Library ("Other edition in your Library"). The same sheet
// whichever book it is: the file (its own cover, title, author), then two
// radio rows like Change edition's — her edition (picked when it opens: *Link
// to your edition*) and the edition found (*Switch to this edition and link*:
// her entry changes edition, #41, one call, and the file goes with it). The
// sheet's action links. Never a second entry for the same book.
import { editionFacts } from '~/data/editions'
import { fileAuthors, fileTitle } from '~/data/ebooks/match'
import type { Book, BookSnapshot } from '~/data/books'
import { useEbooksStore } from '~/stores/ebooks'

const { t, locale } = useI18n()
const ebooks = useEbooksStore()
// Switching writes; linking to hers does not (it stays on the device).
const online = useOnline()

const open = computed({
  get: () => ebooks.editionChoice !== null,
  set: (value) => {
    if (!value && !ebooks.editionBusy) ebooks.editionChoice = null
  },
})
// Kept while the sheet slides away.
const asked = shallowRef(ebooks.editionChoice)
const answer = ref<'mine' | 'switch'>('mine')
watch(
  () => ebooks.editionChoice,
  (choice) => {
    if (choice) {
      asked.value = choice
      answer.value = 'mine'
    }
  },
)

function facts(book: Book | BookSnapshot): string[] {
  return editionFacts(book, { locale: locale.value, pages: (count) => t('book.pages', { count }), ebook: t('book.edition.ebook') })
}

const rows = computed(() => {
  const choice = asked.value
  if (!choice) return []
  return [
    { answer: 'mine' as const, book: choice.entry.book, label: t('ebooks.editionSheet.mine'), action: t('ebooks.editionSheet.mineAction') },
    { answer: 'switch' as const, book: choice.book, label: t('ebooks.editionSheet.found'), action: t('ebooks.editionSheet.foundAction') },
  ]
})

const action = computed(() => {
  if (answer.value === 'switch' && !online.value) return t('common.offline')
  return ebooks.editionBusy ? t('ebooks.editionSheet.busy') : t('ebooks.editionSheet.action')
})
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('ebooks.editionSheet.title')"
    testid="ebookEdition"
    :action="action"
    :action-disabled="ebooks.editionBusy || (answer === 'switch' && !online)"
    @action="ebooks.settleEdition(answer)"
  >
    <template v-if="asked">
      <div class="px-xs pb-ms">
        <UiBookLine
          :title="fileTitle(asked.record.metadata) ?? asked.record.name"
          :authors="fileAuthors(asked.record.metadata)"
          :src="ebooks.coverOf(asked.record)"
          whole
        />
      </div>
      <p class="mx-xs mb-ms text-caption text-ink-faint">{{ t('ebooks.editionSheet.hint') }}</p>
      <UiRowGroup role="radiogroup" :aria-label="t('ebooks.editionSheet.title')">
        <button
          v-for="row in rows"
          :key="row.answer"
          type="button"
          role="radio"
          :aria-checked="answer === row.answer"
          :disabled="ebooks.editionBusy"
          class="option relative flex w-full items-center gap-ms px-inset py-sm text-left active:bg-fill-strong disabled:opacity-50"
          :data-testid="`ebookEdition.${row.answer}`"
          @click="answer = row.answer"
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
            eager
          />
          <span class="flex min-w-0 flex-1 flex-col gap-xxs">
            <span class="eyebrow">{{ row.label }}</span>
            <span class="book-title title-wrap text-callout text-ink">{{ row.book.title }}</span>
            <span class="truncate text-caption text-ink-faint">{{ formatAuthors(row.book.authors, t('common.etAl')) }}</span>
            <span v-if="facts(row.book).length" class="figures truncate text-meta text-ink-faint">{{ facts(row.book).join(' · ') }}</span>
            <span class="text-footnote text-ink-muted">{{ row.action }}</span>
            <span
              v-if="row.answer === 'switch' && answer === 'switch' && ebooks.editionError"
              class="text-footnote whitespace-normal text-error"
              role="alert"
              data-testid="ebookEdition.error"
            >
              {{ t(`library.error.${ebooks.editionError}`) }}
            </span>
          </span>
          <span class="check flex size-(--size-star-lg) shrink-0 items-center justify-center rounded-pill" :class="answer === row.answer && 'on'" aria-hidden="true">
            <UiIcon v-if="answer === row.answer" name="check" :size="14" bold />
          </span>
        </button>
      </UiRowGroup>
      <div class="h-(--spacing-lg)" />
    </template>
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

/* D's check, as in Change edition: a hairline ring; picked, a lamp-lit disc with the tick in it. */
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
