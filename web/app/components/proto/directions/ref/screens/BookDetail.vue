<script setup lang="ts">
// book-new / book-reading / book-finished: cover and metadata, the primary
// action for the entry's Status, the reading history (newest first, each
// session editable), the Collections it is in, and the description.
import { computed } from 'vue'
import type { Book, LibraryEntry } from '../../../data'
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Chip from '../kit/Chip.vue'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import NavBar from '../kit/NavBar.vue'
import Section from '../kit/Section.vue'
import Stars from '../kit/Stars.vue'
import StatusBadge from '../kit/StatusBadge.vue'

const props = defineProps<{ state: 'new' | 'reading' | 'finished' }>()
const proto = useProto()

const entry = computed<LibraryEntry | null>(() =>
  props.state === 'reading'
    ? proto.value.data.readingEntry
    : props.state === 'finished'
      ? proto.value.data.finishedEntry
      : null,
)
const book = computed<Book>(() => entry.value?.book ?? proto.value.data.newBook)
const latest = computed(() => (entry.value ? latestSession(entry.value) : null))
const history = computed(() => [...(entry.value?.sessions ?? [])].reverse())
const collections = computed(() => (entry.value ? proto.value.data.collectionsOf(entry.value) : []))
const meta = computed(() =>
  [book.value.year, book.value.pageCount && `${book.value.pageCount} pages`, book.value.publisher]
    .filter(Boolean)
    .join(' · '),
)
</script>

<template>
  <div class="relative flex h-full flex-col bg-white">
    <NavBar :back="state === 'new' ? 'Search' : 'Library'">
      <template #trailing>
        <Icon v-if="entry" name="more" class="text-neutral-600" />
        <span v-else />
      </template>
    </NavBar>

    <div class="flex flex-col gap-5 px-5 pt-2">
      <div class="flex gap-4">
        <Cover :book="book" :width="112" />
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <h1 class="text-[22px] leading-tight font-bold">{{ book.title }}</h1>
          <p class="text-[15px] text-neutral-700">{{ formatAuthors(book.authors) }}</p>
          <p class="text-[13px] text-neutral-500">{{ meta }}</p>
          <div v-if="entry" class="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge :status="entry.status" />
            <Stars v-if="latest?.rating" :rating="latest.rating" />
          </div>
          <p v-if="state === 'reading'" class="text-[13px] text-neutral-500">
            Since {{ formatDate(latest?.startedOn ?? null) }}
          </p>
        </div>
      </div>

      <Button v-if="state === 'new'"><Icon name="plus" :size="18" />Add to Library</Button>
      <div v-else-if="state === 'reading'" class="flex gap-3">
        <Button>Finish</Button>
        <div class="w-36 shrink-0"><Button tone="secondary">Abandon</Button></div>
      </div>
      <Button v-else tone="secondary">Read again</Button>

      <Section v-if="entry" title="Reading history">
        <template #trailing
          ><span class="text-[13px] text-neutral-500"
            >{{ entry.sessions.length }} {{ entry.sessions.length === 1 ? 'session' : 'sessions' }}</span
          ></template
        >
        <div class="flex flex-col divide-y divide-neutral-200 rounded-xl border border-neutral-300">
          <div v-for="(session, i) in history" :key="session.id" class="flex flex-col gap-1 px-3 py-[10px]">
            <div class="flex items-baseline justify-between">
              <span class="text-[14px] font-semibold">
                {{ history.length > 1 ? `Read ${history.length - i}` : 'This read' }}
                <span class="font-normal text-neutral-500">
                  ·
                  {{
                    session.outcome
                      ? `${formatDate(session.startedOn, 'short')} – ${formatDate(session.endedOn)}`
                      : `Started ${formatDate(session.startedOn)}, reading now`
                  }}
                </span>
              </span>
              <span class="text-[13px] text-neutral-500">Edit</span>
            </div>
            <Stars v-if="session.rating" :rating="session.rating" :size="13" />
            <p v-if="session.review" class="text-[14px] leading-snug text-neutral-700">“{{ session.review }}”</p>
          </div>
        </div>
      </Section>

      <Section title="Collections">
        <div class="flex flex-wrap gap-2">
          <Chip v-for="collection in collections" :key="collection.id">{{ collection.name }}</Chip>
          <Chip><Icon name="plus" :size="14" />Add to collection</Chip>
        </div>
      </Section>

      <Section v-if="book.description" title="About">
        <p class="line-clamp-4 text-[14px] leading-snug text-neutral-700">{{ book.description }}</p>
      </Section>
    </div>
  </div>
</template>
