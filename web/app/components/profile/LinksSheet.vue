<script setup lang="ts">
// Book links (issue #116; the Profile's Book links row, components/profile/Account.vue): the member's
// own list of links a Book's page offers her, each a label and an address with placeholders
// ({isbn}, {isbn10}, {title}, {author}) filled from the Book. In her order: the first is the
// page's link, the rest wait behind More (components/book/Links.vue). Up and Down move a link,
// Remove takes it out, Add link puts an empty one at the end; Save at the top right writes the
// whole list (stores/linkTemplates.ts), empty rows left out, and is refused with the reason
// under the field that is wrong. Hers alone: nobody else sees them. Offline Save says so.
import {
  LINK_LABEL_MAX,
  LINK_PLACEHOLDERS,
  LINK_TEMPLATES_MAX,
  LINK_URL_MAX,
  linkTemplateProblem,
  type LinkTemplate,
  type LinkTemplateProblem,
} from '~/data/linkTemplates'
import { useLinkTemplatesStore } from '~/stores/linkTemplates'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const links = useLinkTemplatesStore()
const online = useOnline()

type Draft = LinkTemplate & { key: number; problem: LinkTemplateProblem | null }
let nextKey = 0
const drafts = ref<Draft[]>([])

const draftOf = (template: LinkTemplate): Draft => ({ ...template, key: nextKey++, problem: null })

function fill() {
  drafts.value = (links.own ?? []).map(draftOf)
}

watch(open, async (isOpen) => {
  if (!isOpen) return
  links.clearSaveError()
  fill()
  await links.load()
  // Her list arrived while the sheet opened, and nothing was typed yet: show it.
  if (open.value && drafts.value.every((d) => !d.label && !d.url)) fill()
})

const filled = (draft: Draft) => draft.label.trim() !== '' || draft.url.trim() !== ''

function add() {
  if (drafts.value.length >= LINK_TEMPLATES_MAX) return
  drafts.value.push(draftOf({ label: '', url: '' }))
}

function move(index: number, by: -1 | 1) {
  const to = index + by
  if (to < 0 || to >= drafts.value.length) return
  const list = [...drafts.value]
  const [draft] = list.splice(index, 1)
  list.splice(to, 0, draft!)
  drafts.value = list
}

function remove(index: number) {
  drafts.value = drafts.value.filter((_, i) => i !== index)
}

const changed = computed(() => {
  const now = drafts.value.filter(filled).map(({ label, url }) => ({ label: label.trim(), url: url.trim() }))
  return JSON.stringify(now) !== JSON.stringify(links.own ?? [])
})

async function save() {
  if (links.saving || !online.value) return
  let wrong = false
  for (const draft of drafts.value) {
    draft.problem = filled(draft) ? linkTemplateProblem(draft) : null
    if (draft.problem) wrong = true
  }
  if (wrong) return
  if (await links.save(drafts.value.filter(filled))) open.value = false
}

const saveError = computed(() => {
  const code = links.saveError
  if (!code) return null
  return t(`links.error.${code === 'offline' || code === 'link_templates_invalid' ? code : 'unknown'}`)
})

const placeholders = LINK_PLACEHOLDERS.map((name) => `{${name}}`)
const baseId = useId()
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('links.title')"
    testid="links"
    :action="online ? t('links.save') : t('common.offline')"
    :action-disabled="links.saving || !changed || !online"
    @action="save()"
  >
    <form novalidate class="flex flex-col gap-md pt-xs pb-lg" @submit.prevent="save()">
      <p class="text-footnote text-ink-faint">{{ t('links.intro') }}</p>
      <p class="text-footnote text-ink-faint">
        {{ t('links.placeholders') }}
        <span class="figures text-ink-muted">{{ placeholders.join(' ') }}</span>
      </p>

      <ol class="flex flex-col gap-lg" data-testid="links.list">
        <li v-for="(draft, index) in drafts" :key="draft.key" class="flex flex-col gap-sm" data-testid="links.item">
          <div class="flex items-center justify-between gap-sm">
            <span class="eyebrow">{{ index === 0 ? t('links.first') : t('links.position', { n: index + 1 }) }}</span>
            <span class="flex items-center">
              <button
                type="button"
                class="control flex size-(--size-touch) items-center justify-center rounded-pill text-ink-muted disabled:opacity-50"
                :aria-label="t('links.up', { label: draft.label || index + 1 })"
                :disabled="index === 0"
                data-testid="links.up"
                @click="move(index, -1)"
              >
                <UiIcon name="down" :size="18" class="up" />
              </button>
              <button
                type="button"
                class="control flex size-(--size-touch) items-center justify-center rounded-pill text-ink-muted disabled:opacity-50"
                :aria-label="t('links.down', { label: draft.label || index + 1 })"
                :disabled="index === drafts.length - 1"
                data-testid="links.down"
                @click="move(index, 1)"
              >
                <UiIcon name="down" :size="18" />
              </button>
              <button
                type="button"
                class="control flex size-(--size-touch) items-center justify-center rounded-pill text-ink-muted"
                :aria-label="t('links.remove', { label: draft.label || index + 1 })"
                data-testid="links.remove"
                @click="remove(index)"
              >
                <UiIcon name="close" :size="18" />
              </button>
            </span>
          </div>
          <UiField
            :id="`${baseId}-label-${draft.key}`"
            v-model="draft.label"
            :label="t('links.labelLabel')"
            :error="draft.problem === 'label_missing' || draft.problem === 'label_long' ? t(`links.error.${draft.problem}`, { max: LINK_LABEL_MAX }) : null"
            error-testid="links.labelError"
            type="text"
            autocapitalize="words"
            :maxlength="LINK_LABEL_MAX"
            :placeholder="t('links.labelPlaceholder')"
            data-testid="links.label"
          />
          <UiField
            :id="`${baseId}-url-${draft.key}`"
            v-model="draft.url"
            :label="t('links.urlLabel')"
            :error="draft.problem && draft.problem !== 'label_missing' && draft.problem !== 'label_long' ? t(`links.error.${draft.problem}`, { max: LINK_URL_MAX }) : null"
            error-testid="links.urlError"
            type="url"
            inputmode="url"
            autocapitalize="off"
            autocomplete="off"
            spellcheck="false"
            :maxlength="LINK_URL_MAX"
            :placeholder="t('links.urlExample', { isbn: '{isbn}' })"
            data-testid="links.url"
          />
        </li>
      </ol>

      <p v-if="!drafts.length" class="text-subhead text-ink-muted" data-testid="links.empty">{{ t('links.empty') }}</p>

      <UiButton
        tone="secondary"
        size="md"
        class="self-start"
        :disabled="drafts.length >= LINK_TEMPLATES_MAX"
        data-testid="links.add"
        @click="add()"
      >
        <UiIcon name="plus" :size="18" />{{ t('links.add') }}
      </UiButton>

      <p v-if="saveError" class="text-footnote text-error" role="alert" data-testid="links.error">{{ saveError }}</p>
    </form>
  </UiSheet>
</template>

<style scoped>
.up {
  transform: rotate(180deg);
}
.control:not(:disabled):active {
  background: var(--color-fill-strong);
}
</style>
