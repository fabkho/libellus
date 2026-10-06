<script setup lang="ts">
// Define: the word as a dictionary heads it (serif), then each part of speech
// as an eyebrow with its senses numbered in mono, an example in the serif
// italic under a sense when Wiktionary has one. Wiktionary's licence asks for
// the credit at the foot. Translate is a tap away for the same word.
import { define, type Definition } from './lookup'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ text: string; language: string }>()
defineEmits<{ translate: [] }>()

const result = ref<Definition | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)
let controller: AbortController | null = null

async function run() {
  controller?.abort()
  controller = new AbortController()
  result.value = null
  error.value = null
  loading.value = true
  try {
    result.value = await define(fetch, props.text, props.language, controller.signal)
    if (!result.value) error.value = 'No definition found for this word.'
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    error.value = navigator.onLine ? 'The dictionary could not be reached just now.' : 'Looking words up needs a connection.'
  } finally {
    loading.value = false
  }
}
watch([open, () => props.text], ([isOpen]) => isOpen && run(), { immediate: true })
</script>

<template>
  <UiSheet v-model:open="open" title="Define" testid="readerDefine">
    <p class="book-title text-headline" data-testid="readerDefine.word">{{ result?.word ?? text }}</p>
    <p v-if="loading" class="mt-md text-subhead text-ink-faint">Looking it up…</p>
    <p v-else-if="error" class="mt-md text-subhead text-ink-muted">{{ error }}</p>
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
      <span>From Wiktionary · CC BY-SA</span>
      <button type="button" class="min-h-(--size-touch) text-caption font-medium text-accent" @click="$emit('translate')">Translate</button>
    </p>
  </UiSheet>
</template>
