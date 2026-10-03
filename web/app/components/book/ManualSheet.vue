<script setup lang="ts">
// The manual-book sheet (D's manual-book): "Add manually" over the empty
// search. Title and author required, ISBN and pages optional. The Placeholder
// cover on top previews what the shelf will show; it follows the title as it is
// typed. The one action is Add (top right, like every sheet) or the button at
// the bottom. Below the fields, the Status to add it with and the dates that
// go with it (AddStatusFields.vue, shared with the Add sheet). A wrong field
// is marked in the error colour with its reason right under the group; a
// failed call stays in the sheet. After the add the search is over and the
// Book's page opens.
import { useManualStore } from '~/stores/manual'

const { t, te } = useI18n()
const manual = useManualStore()
// Adding, starting, finishing writes: offline the action says so instead (#15).
const online = useOnline()
const router = useRouter()

const open = computed({
  get: () => manual.isOpen,
  set: (value) => {
    if (!value) manual.close()
  },
})

const FIELDS = [
  { key: 'title', group: 0, required: true, attrs: { autocapitalize: 'words', autocomplete: 'off', enterkeyhint: 'next' } },
  { key: 'author', group: 0, required: true, attrs: { autocapitalize: 'words', autocomplete: 'off', enterkeyhint: 'next' } },
  { key: 'isbn', group: 1, required: false, attrs: { autocapitalize: 'characters', autocomplete: 'off', inputmode: 'text', enterkeyhint: 'next', spellcheck: 'false' } },
  { key: 'pageCount', group: 1, required: false, attrs: { autocomplete: 'off', inputmode: 'numeric', enterkeyhint: 'done' } },
] as const

const model = {
  title: toRef(manual, 'title'),
  author: toRef(manual, 'author'),
  isbn: toRef(manual, 'isbn'),
  pageCount: toRef(manual, 'pageCount'),
}

const previewTitle = computed(() => manual.title.trim() || t('manual.field.title'))
const previewAuthors = computed(() => [manual.author.trim() || t('manual.field.author')])

/** The first thing wrong, in the order the fields are drawn. */
const reason = computed(() => {
  for (const field of FIELDS) if (manual.invalid[field.key]) return t(`manual.invalid.${field.key}`)
  return null
})

/** The call's own reasons are worded here; the Status part's (days, Rating) are the Library's. */
const errorText = computed(() => {
  const code = manual.error
  if (!code) return ''
  return te(`manual.error.${code}`) ? t(`manual.error.${code}`) : t(`library.error.${code}`)
})

async function submit() {
  const entry = await manual.submit()
  if (entry) await router.push(`/book/${entry.book.id}`)
}
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('manual.title')"
    testid="manual"
    :action="t('manual.action')"
    :action-disabled="manual.busy"
    @action="submit"
  >
    <form novalidate @submit.prevent="submit">
      <div class="flex flex-col items-center gap-ms pt-xs pb-lg">
        <UiCover :title="previewTitle" :authors="previewAuthors" size="md" data-testid="manual.cover" />
        <span class="text-footnote text-ink-faint">{{ t('manual.coverNote') }}</span>
      </div>

      <template v-for="group in [0, 1]" :key="group">
        <UiRowGroup :class="group === 1 && 'mt-ms'">
          <label
            v-for="field in FIELDS.filter((f) => f.group === group)"
            :key="field.key"
            class="field relative flex h-(--size-row) items-center gap-ms px-inset text-body transition-colors duration-(--duration-quick) ease-standard focus-within:bg-accent-soft"
          >
            <span class="shrink-0" :class="manual.invalid[field.key] ? 'text-error' : 'text-ink-muted'"
              >{{ t(`manual.field.${field.key}`)
              }}<span v-if="field.required" class="ml-xxs text-accent" aria-hidden="true">*</span></span
            >
            <input
              v-model="model[field.key].value"
              v-bind="field.attrs"
              type="text"
              :required="field.required"
              :placeholder="field.required ? undefined : t('manual.optional')"
              :aria-invalid="manual.invalid[field.key] ? true : undefined"
              class="min-w-0 flex-1 bg-transparent text-right text-ink caret-accent outline-none placeholder:text-ink-ghost"
              :class="[(field.key === 'isbn' || field.key === 'pageCount') && 'figures text-caption', manual.invalid[field.key] && 'text-error']"
              :data-testid="`manual.${field.key}`"
            />
          </label>
        </UiRowGroup>
      </template>

      <p v-if="reason" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="manual.invalid">{{ reason }}</p>

      <div class="mt-ms">
        <BookAddStatusFields v-model="manual.draft" testid="manual" :error="manual.error" :busy="manual.busy" />
      </div>

      <p v-if="!reason && manual.error" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="manual.error">
        {{ errorText }}
      </p>

      <p class="mx-xs mt-ml mb-lg flex items-start gap-sm text-footnote text-ink-faint" data-testid="manual.private">
        <UiIcon name="lock" :size="15" class="mt-xxs shrink-0" />{{ t('manual.private') }}
      </p>

      <div class="mb-sm">
        <UiButton block type="submit" :disabled="manual.busy" :offline="!online" data-testid="manual.submit">
          <UiIcon name="plus" :size="18" bold />{{ manual.busy ? t('manual.busy') : t('manual.submit') }}
        </UiButton>
      </div>
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
