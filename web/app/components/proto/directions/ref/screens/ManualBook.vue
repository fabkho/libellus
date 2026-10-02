<script setup lang="ts">
// manual-book: the "Add manually" sheet over the empty search. Title and
// author required, ISBN and pages optional; the Placeholder cover previews
// what the shelf will show.
import { useProto } from '../../../contract'
import Button from '../kit/Button.vue'
import Cover from '../kit/Cover.vue'
import Field from '../kit/Field.vue'
import Sheet from '../kit/Sheet.vue'
import Search from './Search.vue'

const proto = useProto()
</script>

<template>
  <div class="relative h-full">
    <Search state="empty" />
    <Sheet title="Add manually" action="Add">
      <div class="flex flex-col gap-4 pt-2">
        <div class="flex flex-col items-center gap-1">
          <Cover
            :book="{ title: proto.data.manualDraft.title, authors: proto.data.manualDraft.authors, coverUrl: null }"
            :width="96"
          />
          <span class="text-[12px] text-neutral-500">Generated cover</span>
        </div>
        <Field label="Title" :value="proto.data.manualDraft.title" />
        <Field label="Author" :value="proto.data.manualDraft.authors[0]" focus />
        <div class="flex gap-3">
          <div class="flex-1"><Field label="ISBN" placeholder="Optional" /></div>
          <div class="w-28"><Field label="Pages" :value="proto.data.manualDraft.pageCount" /></div>
        </div>
        <p class="text-[13px] text-neutral-500">Only you can see books you add by hand.</p>
        <Button>Add to Library</Button>
      </div>
    </Sheet>
  </div>
</template>
