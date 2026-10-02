<script setup lang="ts">
// library-want / library-reading / library-finished: the Library tab. A way
// into Collections, the three Status segments with counts, then the entries.
// Finished has the *Not finished* filter (abandoned sessions).
import { computed } from 'vue'
import type { Status } from '../../../data'
import { formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import BookRow from '../kit/BookRow.vue'
import Chip from '../kit/Chip.vue'
import Icon from '../kit/Icon.vue'
import NavBar from '../kit/NavBar.vue'
import Segmented from '../kit/Segmented.vue'
import Stars from '../kit/Stars.vue'
import TabBar from '../kit/TabBar.vue'

const props = defineProps<{ status: Status }>()
const proto = useProto()

const data = computed(() => proto.value.data)
const entries = computed(() =>
  props.status === 'want_to_read'
    ? data.value.wantToRead
    : props.status === 'reading'
      ? data.value.reading
      : data.value.finished,
)
const segments = computed(() => [
  { value: 'want_to_read', label: 'Want to read', count: data.value.wantToRead.length },
  { value: 'reading', label: 'Reading', count: data.value.reading.length },
  { value: 'finished', label: 'Finished', count: data.value.finished.length },
])
</script>

<template>
  <div class="relative flex h-full flex-col bg-white">
    <NavBar title="Library" avatar />

    <div class="flex flex-col gap-3 px-5">
      <div class="flex h-12 items-center justify-between rounded-xl border border-neutral-300 px-4 text-[16px]">
        <span class="font-semibold">Collections</span>
        <span class="flex items-center gap-1 text-neutral-500"
          >{{ data.collections.length }}<Icon name="chevron" :size="18"
        /></span>
      </div>

      <Segmented :options="segments" :value="status" />

      <div v-if="status === 'finished'" class="flex gap-2">
        <Chip selected>All</Chip>
        <Chip>Not finished · {{ data.notFinished.length }}</Chip>
      </div>
    </div>

    <div class="flex flex-col px-5">
      <BookRow v-for="entry in entries" :key="entry.id" :book="entry.book">
        <template #meta>
          <span v-if="status === 'want_to_read'" class="text-[12px] text-neutral-500"
            >Added {{ formatDate(entry.addedOn) }}</span
          >
          <span v-else-if="status === 'reading'" class="text-[12px] text-neutral-500"
            >Started {{ formatDate(latestSession(entry)?.startedOn ?? null) }}</span
          >
          <span v-else class="flex items-center gap-2 text-[12px] text-neutral-500">
            <template v-if="latestSession(entry)?.outcome === 'abandoned'">
              Not finished · {{ formatDate(latestSession(entry)?.endedOn ?? null) }}
            </template>
            <template v-else>
              <Stars v-if="latestSession(entry)?.rating" :rating="latestSession(entry)!.rating" :size="11" />
              {{ formatDate(latestSession(entry)?.endedOn ?? null) }}
              <span v-if="entry.sessions.length > 1">· read {{ entry.sessions.length }}×</span>
            </template>
          </span>
        </template>
      </BookRow>
    </div>

    <TabBar active="library" />
  </div>
</template>
