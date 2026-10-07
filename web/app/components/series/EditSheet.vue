<script setup lang="ts">
// Correcting a Book's series (#167), from the series sheet's "Correct series"
// or the Book's options: the series' name and the Book's place in it ("2",
// "2.5" for a novella between two, or empty), Save at the top right. A name
// the Catalogue knows joins that series; a new one is hers alone. Under the
// fields: "Not in a series", and, once she has corrected it, "Use the
// suggested series" (back to what the sources say). Her correction is per
// Library entry and needs a connection: offline Save says so.
import { useSeriesStore } from '~/stores/series'
import { SERIES_NAME_MAX } from '~/data/enrich'

const { t } = useI18n()
const series = useSeriesStore()
const online = useOnline()

const open = computed({
  get: () => series.editing !== null,
  set: (value) => {
    if (!value && !series.busy) series.editing = null
  },
})

const name = ref('')
const position = ref('')
const invalidPosition = ref(false)
/** What the Book is in now (the most specific series), to tell a new name from the same one. */
const current = computed(() => (series.editing ? series.ofBook(series.editing.bookId) : undefined))
const overridden = computed(() => current.value?.overridden ?? false)

watch(
  () => series.editing,
  (editing) => {
    if (!editing) return
    const place = current.value?.series[0]
    name.value = place?.name ?? ''
    position.value = positionText(place?.position) ?? ''
    invalidPosition.value = false
  },
)
watch(position, () => (invalidPosition.value = false))

const errorText = computed(() => {
  if (invalidPosition.value) return t('series.error.position')
  return series.error ? t(`series.error.${series.error}`) : null
})

async function save() {
  const parsed = parsePosition(position.value)
  if (parsed === 'invalid') {
    invalidPosition.value = true
    return
  }
  const typed = name.value.trim()
  const place = current.value?.series[0]
  const correction = place && typed === place.name ? { seriesId: place.id, position: parsed } : { name: typed, position: parsed }
  if (await series.correct({ set: correction })) series.editing = null
}

async function clear() {
  if (await series.correct({ clear: true })) series.editing = null
}

async function useSuggested() {
  if (await series.correct({ reset: true })) series.editing = null
}
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('series.editTitle')"
    testid="seriesEdit"
    :action="online ? t('series.save') : t('common.offline')"
    :action-disabled="series.busy || !name.trim() || !online"
    @action="save"
  >
    <form novalidate class="pt-xs pb-sm" @submit.prevent="save">
      <UiRowGroup>
        <label class="relative flex h-(--size-row) items-center gap-ms px-inset text-body transition-colors duration-(--duration-quick) ease-standard focus-within:bg-accent-soft">
          <span class="shrink-0 text-ink-muted">{{ t('series.nameLabel') }}</span>
          <input
            v-model="name"
            data-autofocus
            type="text"
            :maxlength="SERIES_NAME_MAX"
            autocapitalize="words"
            autocomplete="off"
            enterkeyhint="next"
            :placeholder="t('series.namePlaceholder')"
            class="min-w-0 flex-1 bg-transparent text-right text-ink caret-accent outline-none placeholder:text-ink-faint"
            data-testid="seriesEdit.name"
          />
        </label>
        <label class="relative flex h-(--size-row) items-center gap-ms px-inset text-body transition-colors duration-(--duration-quick) ease-standard focus-within:bg-accent-soft">
          <span class="shrink-0" :class="invalidPosition ? 'text-error' : 'text-ink-muted'">{{ t('series.positionLabel') }}</span>
          <input
            v-model="position"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            enterkeyhint="done"
            :placeholder="t('series.positionPlaceholder')"
            :aria-invalid="invalidPosition ? true : undefined"
            class="figures min-w-0 flex-1 bg-transparent text-right text-ink caret-accent outline-none placeholder:text-ink-faint"
            data-testid="seriesEdit.position"
          />
        </label>
      </UiRowGroup>
      <p class="mt-ms px-xs text-caption text-ink-faint">{{ t('series.editHint') }}</p>
      <p v-if="errorText" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="seriesEdit.error">{{ errorText }}</p>
      <UiRowGroup class="mt-lg">
        <UiRow as="button" icon="slash" :label="t('series.none')" :disabled="series.busy || !online" class="disabled:opacity-50" data-testid="seriesEdit.none" @click="clear" />
        <UiRow
          v-if="overridden"
          as="button"
          icon="repeat"
          :label="t('series.suggested')"
          :disabled="series.busy || !online"
          class="disabled:opacity-50"
          data-testid="seriesEdit.reset"
          @click="useSuggested"
        />
      </UiRowGroup>
    </form>
  </UiSheet>
</template>
