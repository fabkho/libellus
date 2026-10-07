<script setup lang="ts">
// "My edition isn't listed" (stores/ownEdition.ts), the step after Change
// edition's list (and the import's Choose edition). Three steps in one sheet:
//
// - ISBN: her copy's ISBN, typed (ISBN-10 or -13, hyphens and spaces as she
//   likes; the check digit must add up) or scanned (the camera button, the
//   app's barcode scanner, #92). "Look up" asks every source. Nothing found:
//   it says so and offers her own edition; no source answering: "Try again".
//   Without an ISBN she can go straight to her own edition.
// - Found: the edition with its cover, title, author and facts, the format it
//   is (hers to correct on the Book page), "Use this edition".
// - Her own: the format (required), ISBN, year, publisher, pages, language and
//   a cover (an https link to an image) under a preview of the cover; "Save".
//   Its title and author are the book's. Only she sees it.
//
// The action at the top right is the step's (Look up · Use · Save), as is the
// button at the bottom. Writes need the connection on the Book page (#15);
// the import writes nothing here. `changed` fires with the entry once it has
// the new edition (the Book page moves to its address).
import { editionFacts } from '~/data/editions'
import type { BookFormat } from '~/data/books'
import type { LibraryEntry } from '~/data/library'
import { isCoverUrl, OWN_EDITION_LANGUAGES, type OwnEditionField } from '~/data/ownEdition'
import { useOwnEditionStore } from '~/stores/ownEdition'

const emit = defineEmits<{ changed: [entry: LibraryEntry] }>()

const { t, te, locale } = useI18n()
const own = useOwnEditionStore()
const online = useOnline()
const scanSupported = useBarcodeSupport()
const scanning = ref(false)

const open = computed({
  get: () => own.target !== null,
  set: (value) => {
    if (!value) own.close()
  },
})

/** On the Book page every step that writes needs the connection; the import's only the lookup does. */
const writes = computed(() => own.target?.kind === 'entry')
const isbnId = useId()

const title = computed(() => t(`ownEdition.title.${own.step}`))
const action = computed(() => {
  if (own.step === 'isbn') return online.value ? (own.looking ? t('ownEdition.looking') : t('ownEdition.lookUp')) : t('common.offline')
  if (writes.value && !online.value) return t('common.offline')
  if (own.busy) return t('ownEdition.busy')
  return own.step === 'found' ? t('ownEdition.use') : t('ownEdition.save')
})
const actionDisabled = computed(() => {
  if (own.busy) return true
  if (own.step === 'isbn') return !online.value || own.looking || !own.isbn.trim()
  return writes.value && !online.value
})

async function act() {
  if (own.step === 'isbn') return own.lookup()
  const done = own.step === 'found' ? await own.useFound() : await own.saveOwn()
  if (done && done !== true) emit('changed', done)
}

function scanned(isbn13: string) {
  void own.lookup(isbn13)
}

// --------------------------------------------------------------- found

const found = computed(() => own.found)
const facts = computed(() =>
  found.value
    ? editionFacts(
        found.value,
        { locale: locale.value, pages: (count) => t('book.pages', { count }), format: (format: BookFormat) => t(`book.formatFact.${format}`) },
        own.foundFormat,
      )
    : [],
)

// ----------------------------------------------------------------- own

const FIELDS = [
  { key: 'isbn', attrs: { autocapitalize: 'characters', autocomplete: 'off', inputmode: 'text', spellcheck: 'false', enterkeyhint: 'next' } },
  { key: 'year', attrs: { autocomplete: 'off', inputmode: 'numeric', enterkeyhint: 'next' } },
  { key: 'publisher', attrs: { autocapitalize: 'words', autocomplete: 'off', enterkeyhint: 'next' } },
  { key: 'pageCount', attrs: { autocomplete: 'off', inputmode: 'numeric', enterkeyhint: 'next' } },
] as const

const languageId = useId()
const coverId = useId()
const languages = computed(() =>
  OWN_EDITION_LANGUAGES.map((code) => ({ code, name: new Intl.DisplayNames([locale.value], { type: 'language' }).of(code) ?? code })).sort(
    (a, b) => a.name.localeCompare(b.name, locale.value),
  ),
)

const preview = computed(() => (isCoverUrl(own.draft.coverUrl) ? own.draft.coverUrl.trim() : null))

/** The first thing wrong, in the order the form draws it. */
const reason = computed(() => {
  const order: OwnEditionField[] = ['format', 'isbn', 'year', 'publisher', 'pageCount', 'coverUrl']
  for (const field of order) if (own.invalid[field]) return t(`ownEdition.invalid.${field}`)
  return null
})

const errorText = computed(() => {
  const code = own.error
  if (!code) return ''
  return te(`ownEdition.error.${code}`) ? t(`ownEdition.error.${code}`) : t(`library.error.${code}`)
})
</script>

<template>
  <UiSheet v-model:open="open" :title="title" testid="ownEdition" :action="action" :action-disabled="actionDisabled" @action="act">
    <!-- ISBN -->
    <form v-if="own.step === 'isbn'" novalidate data-testid="ownEdition.isbnStep" @submit.prevent="own.lookup()">
      <p class="mx-xs mb-ms text-caption text-ink-faint">{{ t('ownEdition.isbnHint') }}</p>
      <UiRowGroup>
        <div class="field flex h-(--size-row) items-center gap-ms pl-inset text-body focus-within:bg-accent-soft" :class="!scanSupported && 'pr-inset'">
          <label :for="isbnId" class="shrink-0" :class="own.isbnInvalid ? 'text-error' : 'text-ink-muted'">{{ t('ownEdition.field.isbn') }}</label>
          <input
            :id="isbnId"
            v-model="own.isbn"
            type="text"
            autocapitalize="characters"
            autocomplete="off"
            inputmode="text"
            spellcheck="false"
            enterkeyhint="search"
            data-autofocus
            :placeholder="t('ownEdition.isbnPlaceholder')"
            :aria-invalid="own.isbnInvalid ? true : undefined"
            class="figures min-w-0 flex-1 bg-transparent text-right text-caption text-ink caret-accent outline-none placeholder:text-ink-faint"
            :class="own.isbnInvalid && 'text-error'"
            data-testid="ownEdition.isbn"
          />
          <button
            v-if="scanSupported"
            type="button"
            :aria-label="t('ownEdition.scan')"
            class="flex size-(--size-touch) shrink-0 items-center justify-center text-ink-muted"
            data-testid="ownEdition.scan"
            @click="scanning = true"
          >
            <UiIcon name="camera" :size="20" />
          </button>
        </div>
      </UiRowGroup>

      <div class="mt-ms min-h-(--size-touch) px-xs" role="status">
        <p v-if="own.looking" class="text-caption text-ink-faint" data-testid="ownEdition.looking">{{ t('ownEdition.lookingFor') }}</p>
        <p v-else-if="own.isbnInvalid" class="text-caption text-error" data-testid="ownEdition.isbnInvalid">{{ t('ownEdition.invalid.isbn') }}</p>
        <p v-else-if="own.notFound" class="text-caption text-ink-muted" data-testid="ownEdition.notFound">{{ t('ownEdition.notFound') }}</p>
        <p v-else-if="own.lookFailed" class="text-caption text-ink-muted" data-testid="ownEdition.failed">{{ t('ownEdition.failed') }}</p>
        <p v-else-if="!online" class="text-caption text-ink-faint" data-testid="ownEdition.offline">{{ t('ownEdition.offline') }}</p>
      </div>

      <UiButton block type="submit" :disabled="actionDisabled" :offline="!online" data-testid="ownEdition.lookUp">
        <UiIcon name="search" :size="18" />{{ own.looking ? t('ownEdition.looking') : own.lookFailed ? t('ownEdition.retry') : t('ownEdition.lookUp') }}
      </UiButton>
      <UiButton
        class="mt-sm mb-lg"
        :tone="own.notFound ? 'secondary' : 'plain'"
        block
        :disabled="own.busy"
        data-testid="ownEdition.startOwn"
        @click="own.startOwn()"
      >
        <UiIcon name="pencil" :size="18" />{{ own.notFound ? t('ownEdition.makeOwn') : t('ownEdition.noIsbn') }}
      </UiButton>

      <ShellBarcodeScanner v-if="scanSupported" v-model:open="scanning" :pick="scanned" />
    </form>

    <!-- Found -->
    <div v-else-if="own.step === 'found' && found" data-testid="ownEdition.foundStep">
      <div class="flex flex-col items-center gap-sm pt-xs pb-ml text-center" data-testid="ownEdition.found">
        <UiCover
          decorative
          :title="found.title"
          :authors="found.authors"
          :src="coverSrc(found.coverUrl, 'md')"
          :fallbacks="coverFallbacks(found, 'md')"
          :thumbhash="found.coverThumbhash"
          :colors="found.coverColors"
          size="md"
          eager
        />
        <p class="book-title mt-xs text-headline text-balance" data-testid="ownEdition.foundTitle">{{ found.title }}</p>
        <p class="text-body text-ink-muted">{{ formatAuthors(found.authors, t('common.etAl')) }}</p>
        <p v-if="facts.length" class="figures text-meta text-ink-faint" data-testid="ownEdition.foundFacts">{{ facts.join(' · ') }}</p>
        <p class="figures text-meta text-ink-faint">{{ t('ownEdition.isbnIs', { isbn: found.isbn13 }) }}</p>
      </div>

      <BookFormatChoice
        v-if="writes"
        :value="own.foundFormat"
        :label="t('book.edition.formatLabel')"
        testid="ownEdition.foundFormat"
        :disabled="own.busy"
        @choose="own.chooseFormat"
      />

      <p v-if="own.error" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="ownEdition.error">{{ errorText }}</p>

      <UiButton class="mt-ml" block :disabled="actionDisabled" :offline="writes && !online" data-testid="ownEdition.use" @click="act">
        <UiIcon name="check" :size="18" bold />{{ own.busy ? t('ownEdition.busy') : t('ownEdition.useLong') }}
      </UiButton>
      <UiButton class="mt-sm mb-lg" tone="plain" block :disabled="own.busy" data-testid="ownEdition.back" @click="own.back()">
        {{ t('ownEdition.notThis') }}
      </UiButton>
    </div>

    <!-- Her own -->
    <form v-else-if="own.step === 'own'" novalidate data-testid="ownEdition.ownStep" @submit.prevent="act">
      <div class="flex flex-col items-center gap-ms pt-xs pb-lg">
        <UiCover :title="own.book?.title ?? ''" :authors="own.book?.authors ?? []" :src="preview" size="md" eager decorative data-testid="ownEdition.cover" />
        <span class="text-center text-footnote text-ink-faint">{{ t('ownEdition.ownHint') }}</span>
      </div>

      <BookFormatChoice
        :value="own.draft.format"
        :label="t('ownEdition.field.format')"
        testid="ownEdition.format"
        required
        :invalid="Boolean(own.invalid.format)"
        :disabled="own.busy"
        @choose="own.chooseDraftFormat"
      />

      <UiRowGroup class="mt-ml">
        <label
          v-for="field in FIELDS"
          :key="field.key"
          class="field relative flex h-(--size-row) items-center gap-ms px-inset text-body transition-colors duration-(--duration-quick) ease-standard focus-within:bg-accent-soft"
        >
          <span class="shrink-0" :class="own.invalid[field.key] ? 'text-error' : 'text-ink-muted'">{{ t(`ownEdition.field.${field.key}`) }}</span>
          <input
            v-model="own.draft[field.key]"
            v-bind="field.attrs"
            type="text"
            :placeholder="t('manual.optional')"
            :aria-invalid="own.invalid[field.key] ? true : undefined"
            class="min-w-0 flex-1 bg-transparent text-right text-ink caret-accent outline-none placeholder:text-ink-faint"
            :class="[field.key !== 'publisher' && 'figures text-caption', own.invalid[field.key] && 'text-error']"
            :data-testid="`ownEdition.${field.key}`"
          />
        </label>
        <div class="field relative flex h-(--size-row) items-center gap-ms px-inset text-body focus-within:bg-accent-soft">
          <label :for="languageId" class="shrink-0 text-ink-muted">{{ t('ownEdition.field.language') }}</label>
          <select
            :id="languageId"
            v-model="own.draft.language"
            class="min-w-0 flex-1 appearance-none bg-transparent text-right text-ink outline-none"
            :class="!own.draft.language && 'text-ink-faint'"
            dir="rtl"
            data-testid="ownEdition.language"
          >
            <option value="">{{ t('manual.optional') }}</option>
            <option v-for="language in languages" :key="language.code" :value="language.code">{{ language.name }}</option>
          </select>
          <UiIcon name="down" :size="14" class="shrink-0 text-ink-faint" />
        </div>
        <div class="field relative flex h-(--size-row) items-center gap-ms px-inset text-body focus-within:bg-accent-soft">
          <label :for="coverId" class="shrink-0" :class="own.invalid.coverUrl ? 'text-error' : 'text-ink-muted'">{{ t('ownEdition.field.coverUrl') }}</label>
          <input
            :id="coverId"
            v-model="own.draft.coverUrl"
            type="url"
            inputmode="url"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            enterkeyhint="done"
            :placeholder="t('ownEdition.coverPlaceholder')"
            :aria-invalid="own.invalid.coverUrl ? true : undefined"
            class="min-w-0 flex-1 bg-transparent text-right text-caption text-ink caret-accent outline-none placeholder:text-ink-faint"
            :class="own.invalid.coverUrl && 'text-error'"
            data-testid="ownEdition.coverUrl"
          />
        </div>
      </UiRowGroup>

      <p v-if="reason" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="ownEdition.invalid">{{ reason }}</p>
      <p v-else-if="own.error" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="ownEdition.error">{{ errorText }}</p>

      <p class="mx-xs mt-ml flex items-start gap-sm text-footnote text-ink-faint" data-testid="ownEdition.private">
        <UiIcon name="lock" :size="15" class="mt-xxs shrink-0" />{{ t('ownEdition.private') }}
      </p>

      <UiButton class="mt-ml" block type="submit" :disabled="actionDisabled" :offline="writes && !online" data-testid="ownEdition.submit">
        <UiIcon name="check" :size="18" bold />{{ own.busy ? t('ownEdition.busy') : t('ownEdition.saveLong') }}
      </UiButton>
      <UiButton class="mt-sm mb-lg" tone="plain" block :disabled="own.busy" data-testid="ownEdition.back" @click="own.back()">
        {{ t('ownEdition.backToIsbn') }}
      </UiButton>
    </form>
  </UiSheet>
</template>

<style scoped>
.field + .field::before {
  position: absolute;
  top: 0;
  right: 0;
  left: var(--spacing-inset);
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}
</style>
