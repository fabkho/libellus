<script setup lang="ts">
// collection: one Collection's books in the Member's order (drag to reorder),
// with rename / delete in the menu and a way to add books.
import { computed } from 'vue'
import { formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import BookRow from '../kit/BookRow.vue'
import Icon from '../kit/Icon.vue'
import NavBar from '../kit/NavBar.vue'
import StatusBadge from '../kit/StatusBadge.vue'
import TabBar from '../kit/TabBar.vue'

const proto = useProto()
const collection = computed(() => proto.value.data.openCollection)
const entries = computed(() => proto.value.data.collectionEntries(collection.value))
</script>

<template>
  <div class="relative flex h-full flex-col bg-white">
    <NavBar :title="collection.name" back="Collections">
      <template #trailing>
        <span class="flex items-center gap-4 text-neutral-700"><Icon name="plus" /><Icon name="more" /></span>
      </template>
    </NavBar>

    <p class="-mt-1 px-5 pb-2 text-[14px] text-neutral-500">{{ entries.length }} books · drag to reorder</p>

    <div class="flex flex-col px-5">
      <BookRow v-for="entry in entries" :key="entry.id" :book="entry.book" :cover-width="40">
        <template #meta>
          <span class="flex items-center gap-2 text-[12px] text-neutral-500">
            <StatusBadge :status="entry.status" />
            <span v-if="entry.status === 'finished'">{{ formatDate(latestSession(entry)?.endedOn ?? null, 'month') }}</span>
          </span>
        </template>
        <template #trailing><Icon name="drag" class="text-neutral-400" /></template>
      </BookRow>
    </div>

    <TabBar active="library" />
  </div>
</template>
