<script setup lang="ts">
// The name sheet: a new Collection, or a new name for one. One field with the
// keyboard up; Create / Save at the top right, like every sheet, and Enter
// does the same. A name she already uses (in any case) or a blank one is
// named under the field; the sheet stays open.
import { NAME_MAX } from '~/data/collections'
import { useCollectionsStore } from '~/stores/collections'

const emit = defineEmits<{ saved: [id: string, mode: 'create' | 'rename'] }>()

const { t } = useI18n()
const collections = useCollectionsStore()
// Saving writes: offline the action says so instead (#15).
const online = useOnline()

const open = computed({
  get: () => collections.naming !== null,
  set: (value) => {
    if (!value) collections.closeNaming()
  },
})

// Kept while the sheet slides away, so its title does not flip mid-exit.
const mode = ref<'create' | 'rename'>('create')
watch(
  () => collections.naming,
  async (naming) => {
    if (!naming) return
    mode.value = naming.mode
    await nextTick()
    // After the sheet took focus for itself: the keyboard comes up in the field.
    setTimeout(() => input.value?.focus(), 0)
  },
)

const input = useTemplateRef<HTMLInputElement>('input')
const name = toRef(collections, 'name')

async function save() {
  const naming = collections.naming
  const id = await collections.submitName()
  if (id && naming) emit('saved', id, naming.mode)
}
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t(mode === 'create' ? 'collections.new' : 'collections.rename')"
    testid="collectionName"
    :action="online ? t(mode === 'create' ? 'collections.create' : 'collections.save') : t('common.offline')"
    :action-disabled="collections.nameBusy || !name.trim() || !online"
    @action="save"
  >
    <form novalidate class="pt-xs pb-lg" @submit.prevent="save">
      <UiRowGroup>
        <label class="relative flex h-(--size-row) items-center gap-ms px-inset text-body transition-colors duration-(--duration-quick) ease-standard focus-within:bg-accent-soft">
          <span class="shrink-0" :class="collections.nameError ? 'text-error' : 'text-ink-muted'">{{ t('collections.nameLabel') }}</span>
          <input
            ref="input"
            v-model="name"
            type="text"
            :maxlength="NAME_MAX"
            autocapitalize="sentences"
            autocomplete="off"
            enterkeyhint="done"
            :placeholder="t('collections.namePlaceholder')"
            :aria-invalid="collections.nameError ? true : undefined"
            class="min-w-0 flex-1 bg-transparent text-right text-ink caret-accent outline-none placeholder:text-ink-ghost"
            data-testid="collectionName.input"
          />
        </label>
      </UiRowGroup>
      <p v-if="collections.nameError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="collectionName.error">
        {{ t(`collections.error.${collections.nameError}`) }}
      </p>
    </form>
  </UiSheet>
</template>
