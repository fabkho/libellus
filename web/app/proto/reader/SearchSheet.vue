<script setup lang="ts">
// Search in the book (a first version; the full search can come later): one
// field, opened with the selected words in it (or from the chrome, empty);
// the places as they are found, chapter by chapter, each a line of the book
// with the words lit. A tap goes there and leaves the places outlined on the
// page until the next search.
import type { ReaderEngine, SearchHit } from './engine'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ engine: ReaderEngine | null; initial: string }>()
const emit = defineEmits<{ go: [cfi: string] }>()

const query = ref('')
const hits = ref<SearchHit[]>([])
const progress = ref<number | null>(null)
const searched = ref('')
let run = 0

async function search() {
  const engine = props.engine
  const q = query.value.trim()
  if (!engine || q.length < 2) return
  const id = ++run
  hits.value = []
  progress.value = 0
  searched.value = q
  engine.clearSearch()
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() || '#b8782a'
  for await (const step of engine.search(q, accent)) {
    if (id !== run) return
    if ('hits' in step) hits.value = [...hits.value, ...step.hits]
    else progress.value = step.progress
  }
  if (id === run) progress.value = null
}

watch(open, (isOpen) => {
  if (!isOpen) {
    run++
    return
  }
  if (props.initial && props.initial !== searched.value) {
    query.value = props.initial
    void search()
  }
})
const fieldId = useId()
</script>

<template>
  <UiSheet v-model:open="open" title="Search" testid="readerSearch">
    <form class="flex items-end gap-sm" @submit.prevent="search">
      <UiField :id="fieldId" v-model="query" label="In this book" class="flex-1" enterkeyhint="search" autocomplete="off" data-autofocus data-testid="readerSearch.query" />
      <UiButton type="submit" size="md" tone="secondary" :disabled="query.trim().length < 2">Search</UiButton>
    </form>
    <p class="figures mt-ms mb-sm text-meta text-ink-faint" aria-live="polite">
      <template v-if="progress !== null">Searching… {{ Math.round(progress * 100) }} % · {{ hits.length }} found</template>
      <template v-else-if="searched">{{ hits.length === 0 ? 'Nowhere in this book.' : `${hits.length} ${hits.length === 1 ? 'place' : 'places'}` }}</template>
    </p>
    <ol class="-mx-ml" data-testid="readerSearch.results">
      <li v-for="(hit, i) in hits.slice(0, 200)" :key="hit.cfi + i">
        <button type="button" class="block w-full px-ml py-ms text-left hover:bg-fill active:bg-fill-strong" :data-testid="`readerSearch.hit.${i}`" @click="emit('go', hit.cfi)">
          <span class="eyebrow block">{{ hit.chapter }}</span>
          <span class="book-title mt-xxs block text-subhead text-ink-muted">{{ hit.pre }}<mark class="hit">{{ hit.match }}</mark>{{ hit.post }}</span>
        </button>
      </li>
    </ol>
  </UiSheet>
</template>

<style scoped>
.hit {
  color: var(--color-ink);
  background: var(--color-accent-soft);
  border-radius: var(--radius-cover-sm);
}
</style>
