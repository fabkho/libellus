<script setup lang="ts">
// search-typing / search-results / search-empty: one search field, results
// from three sources merged into one list (own Catalogue first, then Apple
// Books, then OpenLibrary), each hit marked when it is already in the Library.
import { computed } from 'vue'
import type { SearchSource } from '../../../data'
import { useProto } from '../../../contract'
import BookRow from '../kit/BookRow.vue'
import Button from '../kit/Button.vue'
import Icon from '../kit/Icon.vue'
import Keyboard from '../kit/Keyboard.vue'
import Note from '../kit/Note.vue'
import StatusBadge from '../kit/StatusBadge.vue'
import TabBar from '../kit/TabBar.vue'

const props = defineProps<{ state: 'typing' | 'results' | 'empty' }>()
const proto = useProto()

const search = computed(() => proto.value.data.search)
const query = computed(() =>
  props.state === 'typing'
    ? search.value.typingQuery
    : props.state === 'empty'
      ? search.value.emptyQuery
      : search.value.query,
)
const results = computed(() =>
  props.state === 'typing' ? search.value.typingResults : props.state === 'results' ? search.value.results : [],
)

const sourceLabel: Record<SearchSource, string> = {
  catalogue: 'Libellus',
  apple: 'Apple Books',
  openlibrary: 'Open Library',
}
</script>

<template>
  <div class="relative flex h-full flex-col bg-white">
    <header class="shrink-0 px-5 pt-[var(--safe-top)]">
      <h1 v-if="state !== 'typing'" class="pt-11 pb-2 text-[30px] leading-tight font-bold tracking-tight">Search</h1>
      <div class="flex items-center gap-3 py-2">
        <span
          class="flex h-10 flex-1 items-center gap-2 rounded-lg border px-3 text-[16px]"
          :class="state === 'typing' ? 'border-neutral-800' : 'border-neutral-300'"
        >
          <Icon name="search" :size="18" class="text-neutral-500" />
          <span class="flex-1"
            >{{ query
            }}<span
              v-if="state === 'typing'"
              class="ml-[1px] inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-neutral-900"
          /></span>
          <Icon name="close" :size="16" class="text-neutral-400" />
        </span>
        <span v-if="state === 'typing'" class="text-[16px] text-neutral-600">Cancel</span>
      </div>
      <p v-if="state !== 'empty'" class="pb-1 text-[12px] text-neutral-500">Title, author or ISBN</p>
    </header>

    <div v-if="state === 'empty'" class="flex flex-col items-center gap-3 px-10 pt-20 text-center">
      <p class="text-[20px] font-semibold">No books found</p>
      <p class="text-[15px] text-neutral-600">
        Nothing for “{{ query }}” in Libellus, Apple Books or Open Library. Check the spelling, or add the book by
        hand.
      </p>
      <div class="mt-3 w-52"><Button tone="secondary">Add manually</Button></div>
    </div>

    <div v-else class="flex flex-col px-5">
      <BookRow v-for="result in results" :key="result.id" :book="result">
        <template #meta>
          <span class="text-[12px] text-neutral-500">{{ result.year }} · {{ sourceLabel[result.source] }}</span>
        </template>
        <template #trailing>
          <StatusBadge v-if="result.libraryStatus" :status="result.libraryStatus" />
          <span
            v-else
            class="flex size-9 items-center justify-center rounded-full border border-neutral-400 text-neutral-700"
            ><Icon name="plus" :size="18"
          /></span>
        </template>
      </BookRow>

      <template v-if="state === 'typing'">
        <!-- The source still on its way: skeleton rows and its name. -->
        <div v-for="n in 2" :key="n" class="flex items-center gap-3 border-b border-neutral-200 py-[10px]">
          <span class="h-[66px] w-[44px] rounded-[3px] bg-neutral-200" />
          <span class="flex flex-1 flex-col gap-2">
            <span class="h-3 w-2/3 rounded bg-neutral-200" />
            <span class="h-3 w-1/3 rounded bg-neutral-200" />
          </span>
        </div>
        <p class="pt-2 text-[12px] text-neutral-500">Searching {{ search.typingLoading.map((s) => sourceLabel[s]).join(', ') }}…</p>
      </template>
      <div v-else class="pt-3">
        <Note>Tap a row → book detail. “+” adds straight away (opens the Add sheet).</Note>
      </div>
    </div>

    <Keyboard v-if="state === 'typing'" />
    <TabBar v-else active="search" />
  </div>
</template>
