<script setup lang="ts">
// Translate (#131 phase 2; Google Books' way: a sheet, the page stays under
// it). The words as selected, in the serif italic; the two languages in one
// row — the target a tap away (a native select), kept on this device; the
// translation in the serif, large enough to read at a glance. Who translated
// (the browser itself, or the service) in the smallest type at the foot. A
// word offers Define.
import { TARGET_LANGUAGES, defaultTarget, isDefinable, type LookupError, type Translation } from '~/data/reader/lookup'
import { useReaderStore } from '~/stores/reader'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ text: string; from: string; online: boolean }>()
defineEmits<{ define: [] }>()

const { t, locale } = useI18n()
const reader = useReaderStore()

const target = computed({
  get: () => reader.settings.translateTo ?? defaultTarget(navigator.language, props.from),
  set: (value: string) => (reader.settings.translateTo = value),
})
const languageName = (code: string) => new Intl.DisplayNames([code, locale.value], { type: 'language' }).of(code) ?? code
const choices = computed(() => TARGET_LANGUAGES.map((code) => ({ code, name: languageName(code) })))

const result = ref<Translation | null>(null)
const error = ref<LookupError | null>(null)
const busy = ref(false)
let controller: AbortController | null = null

async function run() {
  controller?.abort()
  controller = new AbortController()
  result.value = null
  error.value = null
  if (!props.text) return
  busy.value = true
  try {
    const answer = await reader.translate(props.text, props.from, target.value, controller.signal)
    result.value = answer.data
    error.value = answer.error
  } catch (e) {
    if ((e as Error).name !== 'AbortError') error.value = 'failed'
  } finally {
    busy.value = false
  }
}
watch([open, target, () => props.text], ([isOpen]) => isOpen && run(), { immediate: true })
</script>

<template>
  <UiSheet v-model:open="open" :title="t('reader.translate.title')" testid="readerTranslate">
    <p class="source book-title text-callout text-ink-muted italic" data-testid="readerTranslate.source">“{{ text }}”</p>

    <div class="mt-md flex items-center gap-sm text-caption">
      <span class="text-ink-faint">{{ languageName(from) }}</span>
      <UiIcon name="arrow" :size="14" class="text-ink-ghost" />
      <label class="relative flex items-center gap-xxs font-medium text-accent-ink">
        {{ languageName(target) }}<UiIcon name="down" :size="13" />
        <select v-model="target" class="absolute inset-0 opacity-0" :aria-label="t('reader.translate.into')" data-testid="readerTranslate.target">
          <option v-for="l in choices" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
      </label>
    </div>

    <div class="mt-sm min-h-(--size-query) rounded-md bg-fill p-inset edge-faint" aria-live="polite" data-testid="readerTranslate.result">
      <p v-if="busy" class="text-subhead text-ink-faint">{{ t('reader.translate.busy') }}</p>
      <p v-else-if="error" class="text-subhead text-error">{{ t(`reader.translate.error.${error}`) }}</p>
      <p v-else-if="result" class="book-title text-input text-ink">{{ result.text }}</p>
    </div>

    <p class="mt-md mb-xs flex items-center justify-between px-xs text-meta text-ink-faint">
      <span>{{ result ? t(result.provider === 'device' ? 'reader.translate.device' : 'reader.translate.service') : '' }}</span>
      <button v-if="isDefinable(text)" type="button" class="min-h-(--size-touch) text-caption font-medium text-accent-ink" data-testid="readerTranslate.define" @click="$emit('define')">
        {{ t('reader.translate.define') }}
      </button>
    </p>
  </UiSheet>
</template>

<style scoped>
.source {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 6;
}
</style>
