<script setup lang="ts">
// finish-sheet: over the reading Book's detail. End date (today by default),
// a quarter-star Rating shown mid-drag, an optional review being typed.
import { useProto } from '../../../contract'
import { formatDate } from '../../../data'
import Button from '../kit/Button.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Sheet from '../kit/Sheet.vue'
import Stars from '../kit/Stars.vue'
import BookDetail from './BookDetail.vue'

const proto = useProto()
</script>

<template>
  <div class="relative h-full">
    <BookDetail state="reading" />
    <Sheet title="Finish">
      <div class="flex flex-col gap-4 pt-2">
        <p class="text-center text-[14px] text-neutral-500">{{ proto.data.readingEntry.book.title }}</p>
        <Field label="Finished on" :value="`Today, ${formatDate(proto.data.finishDraft.endedOn)}`">
          <template #trailing><Icon name="calendar" :size="18" class="ml-auto text-neutral-500" /></template>
        </Field>
        <div class="flex flex-col gap-2">
          <span class="text-[13px] font-medium text-neutral-600">Rating</span>
          <div class="flex justify-center pt-8 pb-1">
            <Stars :rating="proto.data.finishDraft.rating" :size="40" :dragging="proto.data.finishDraft.dragging" />
          </div>
          <span class="text-center text-[12px] text-neutral-500">Drag across the stars, in quarter stars. Optional.</span>
        </div>
        <Field label="Review (optional)" :value="proto.data.finishDraft.review" multiline focus />
        <Button>Finish</Button>
      </div>
    </Sheet>
  </div>
</template>
