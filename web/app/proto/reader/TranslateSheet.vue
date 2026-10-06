<script setup lang="ts">
// Translate (Google Books' way: a sheet, the page stays under it). The words
// as selected, in the serif italic; under them the translation in the serif,
// large enough to read at a glance; the two languages in one row — the
// target is a tap away (a native select) and kept on this device. Which
// service answered is said in the smallest type at the foot.
import { LANGUAGES, languageName, translate, type Translation } from './lookup'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ text: string; from: string }>()
defineEmits<{ define: [] }>()

const KEY = 'libellus-reader-proto-target'
const defaultTarget = () => {
  const device = (navigator.language || 'de').split('-')[0]!
  return device !== props.from ? device : props.from === 'de' ? 'en' : 'de'
}
const target = ref(localStorage.getItem(KEY) ?? defaultTarget())
watch(target, (value) => localStorage.setItem(KEY, value))

const result = ref<Translation | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
let controller: AbortController | null = null

async function run() {
  controller?.abort()
  controller = new AbortController()
  result.value = null
  error.value = null
  if (!props.text) return
  if (target.value === props.from) {
    result.value = { text: props.text, provider: 'device' }
    return
  }
  loading.value = true
  try {
    result.value = await translate(fetch, props.text, props.from, target.value, controller.signal)
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    error.value = !navigator.onLine ? 'Translating needs a connection.' : (e as Error).message === 'translate_quota' ? 'The free translations for today are used up.' : 'This could not be translated just now.'
  } finally {
    loading.value = false
  }
}
watch([open, target, () => props.text], ([isOpen]) => isOpen && run(), { immediate: true })
</script>

<template>
  <UiSheet v-model:open="open" title="Translate" testid="readerTranslate">
    <p class="source book-title text-callout text-ink-muted italic">“{{ text }}”</p>

    <div class="mt-md flex items-center gap-sm text-caption">
      <span class="text-ink-faint">{{ languageName(from) }}</span>
      <UiIcon name="arrow" :size="14" class="text-ink-ghost" />
      <label class="relative flex items-center gap-xxs font-medium text-accent">
        {{ languageName(target) }}<UiIcon name="down" :size="13" />
        <select v-model="target" class="absolute inset-0 opacity-0" aria-label="Translate into" data-testid="readerTranslate.target">
          <option v-for="l in LANGUAGES" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
      </label>
    </div>

    <div class="mt-sm min-h-(--size-query) rounded-md bg-fill p-inset edge-faint" aria-live="polite" data-testid="readerTranslate.result">
      <p v-if="loading" class="text-subhead text-ink-faint">Translating…</p>
      <p v-else-if="error" class="text-subhead text-error">{{ error }}</p>
      <p v-else-if="result" class="book-title text-input text-ink">{{ result.text }}</p>
    </div>

    <p class="mt-md mb-xs flex items-center justify-between px-xs text-meta text-ink-faint">
      <span>{{ result?.provider === 'device' ? 'Translated on this device' : 'Machine translation · MyMemory (prototype)' }}</span>
      <button v-if="!text.includes(' ')" type="button" class="min-h-(--size-touch) text-caption font-medium text-accent" @click="$emit('define')">Define</button>
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
