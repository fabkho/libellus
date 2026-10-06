<script setup lang="ts">
// Define (#131 phase 2): the word as a dictionary heads it (serif), then each
// part of speech as an eyebrow with its senses numbered in mono, an example in
// the serif italic under a sense where there is one. Wiktionary's licence asks
// for the credit at the foot. Translate is a tap away for the same word.
import type { Definition, LookupError } from '~/data/reader/lookup'
import { useReaderStore } from '~/stores/reader'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ text: string; language: string; online: boolean }>()
defineEmits<{ translate: [] }>()

const { t } = useI18n()
const reader = useReaderStore()

const result = ref<Definition | null>(null)
const error = ref<LookupError | null>(null)
const none = ref(false)
const busy = ref(false)
let controller: AbortController | null = null

async function run() {
  controller?.abort()
  controller = new AbortController()
  result.value = null
  error.value = null
  none.value = false
  busy.value = true
  try {
    const answer = await reader.define(props.text, props.language, controller.signal)
    result.value = answer.data
    error.value = answer.error
    none.value = !answer.data && !answer.error
  } catch (e) {
    if ((e as Error).name !== 'AbortError') error.value = 'failed'
  } finally {
    busy.value = false
  }
}
watch([open, () => props.text], ([isOpen]) => isOpen && run(), { immediate: true })
</script>

<template>
  <UiSheet v-model:open="open" :title="t('reader.define.title')" testid="readerDefine">
    <p class="book-title text-headline" data-testid="readerDefine.word">{{ result?.word ?? text }}</p>
    <p v-if="busy" class="mt-md text-subhead text-ink-faint">{{ t('reader.define.busy') }}</p>
    <p v-else-if="error" class="mt-md text-subhead text-ink-muted">{{ t(`reader.define.error.${error}`) }}</p>
    <p v-else-if="none" class="mt-md text-subhead text-ink-muted" data-testid="readerDefine.none">{{ t('reader.define.none') }}</p>
    <template v-else-if="result">
      <section v-for="(entry, i) in result.entries" :key="i" class="mt-lg">
        <h3 class="eyebrow mb-sm">{{ entry.partOfSpeech }}</h3>
        <ol class="grid gap-ms">
          <li v-for="(sense, j) in entry.senses.slice(0, 5)" :key="j" class="grid grid-cols-[auto_1fr] gap-x-ms">
            <span class="figures pt-xxs text-meta text-ink-faint">{{ j + 1 }}</span>
            <span>
              <span class="block text-subhead text-ink">{{ sense.definition }}</span>
              <span v-for="(example, k) in sense.examples" :key="k" class="book-title mt-xxs block text-caption text-ink-muted italic">{{ example }}</span>
            </span>
          </li>
        </ol>
      </section>
    </template>
    <p class="mt-lg mb-xs flex items-center justify-between px-xs text-meta text-ink-faint">
      <span>{{ t('reader.define.credit') }}</span>
      <button type="button" class="min-h-(--size-touch) text-caption font-medium text-accent" data-testid="readerDefine.translate" @click="$emit('translate')">
        {{ t('reader.define.translate') }}
      </button>
    </p>
  </UiSheet>
</template>
