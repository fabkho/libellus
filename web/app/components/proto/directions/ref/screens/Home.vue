<script setup lang="ts">
// home: Currently reading (large cards with start date), the "Read in <year>"
// counter, Up next (the first Want to read entries).
import { formatAuthors, formatDate, latestSession } from '../../../data'
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import NavBar from '../kit/NavBar.vue'
import Section from '../kit/Section.vue'
import TabBar from '../kit/TabBar.vue'

const proto = useProto()
</script>

<template>
  <div class="relative flex h-full flex-col bg-white">
    <NavBar title="Home" avatar />

    <div class="flex flex-col gap-6 px-5 pt-2">
      <Section title="Currently reading">
        <div
          v-for="entry in proto.data.reading"
          :key="entry.id"
          class="flex gap-4 rounded-xl border border-neutral-300 p-3"
        >
          <Cover :book="entry.book" :width="72" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="text-[17px] leading-snug font-semibold">{{ entry.book.title }}</span>
            <span class="text-[14px] text-neutral-600">{{ formatAuthors(entry.book.authors) }}</span>
            <span class="mt-1 text-[13px] text-neutral-500"
              >Started {{ formatDate(latestSession(entry)?.startedOn ?? null) }}</span
            >
            <div class="mt-auto w-28"><Button tone="secondary">Finish</Button></div>
          </div>
        </div>
      </Section>

      <div class="flex items-baseline justify-between rounded-xl bg-neutral-100 px-4 py-3">
        <span class="text-[15px] text-neutral-600">Read in {{ proto.data.readInYear.year }}</span>
        <span class="text-[28px] font-bold tabular-nums">{{ proto.data.readInYear.count }}</span>
      </div>

      <Section title="Up next">
        <template #trailing><span class="text-[14px] text-neutral-500">See all</span></template>
        <div class="-mr-5 flex gap-3 overflow-hidden">
          <Cover v-for="entry in proto.data.upNext" :key="entry.id" :book="entry.book" :width="76" />
        </div>
      </Section>
    </div>

    <TabBar active="home" />
  </div>
</template>
