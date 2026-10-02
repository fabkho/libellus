<script setup lang="ts">
// collections: every Collection with a mosaic of its first covers, its size,
// and a way to create a new one.
import { useProto } from '../../../contract'
import Cover from '../kit/Cover.vue'
import Icon from '../kit/Icon.vue'
import NavBar from '../kit/NavBar.vue'
import TabBar from '../kit/TabBar.vue'

const proto = useProto()
</script>

<template>
  <div class="relative flex h-full flex-col bg-white">
    <NavBar title="Collections" back="Library">
      <template #trailing><Icon name="plus" class="text-neutral-700" /></template>
    </NavBar>

    <div class="flex flex-col px-5">
      <div
        v-for="collection in proto.data.collections"
        :key="collection.id"
        class="flex items-center gap-4 border-b border-neutral-200 py-3"
      >
        <!-- Mosaic: the first four covers, 2 × 2; fewer books leave grey cells. -->
        <div class="grid w-[92px] shrink-0 grid-cols-2 gap-[3px] rounded-lg bg-neutral-100 p-[3px]">
          <template v-for="i in 4" :key="i">
            <Cover
              v-if="proto.data.collectionEntries(collection)[i - 1]"
              :book="proto.data.collectionEntries(collection)[i - 1]!.book"
              :width="41"
            />
            <span v-else class="h-[62px] w-[41px] rounded-[3px] bg-neutral-200" />
          </template>
        </div>
        <div class="flex flex-1 flex-col">
          <span class="text-[17px] font-semibold">{{ collection.name }}</span>
          <span class="text-[14px] text-neutral-500">{{ collection.entryIds.length }} books</span>
        </div>
        <Icon name="chevron" :size="18" class="text-neutral-400" />
      </div>

      <div class="flex items-center gap-4 py-3 text-neutral-600">
        <span
          class="flex h-[134px] w-[92px] items-center justify-center rounded-lg border-2 border-dashed border-neutral-300"
          ><Icon name="plus"
        /></span>
        <span class="text-[16px]">New collection</span>
      </div>
    </div>

    <TabBar active="library" />
  </div>
</template>
