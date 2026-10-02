<script setup lang="ts">
// add-sheet: over the new Book's detail. Status first; the date fields follow
// the choice (Currently reading → start date, Finished → start optional + end,
// then Rating and review). Shown with Currently reading picked.
import { useProto } from '../../../contract'
import { formatDate } from '../../../data'
import Button from '../kit/Button.vue'
import Field from '../kit/Field.vue'
import Icon from '../kit/Icon.vue'
import Note from '../kit/Note.vue'
import Sheet from '../kit/Sheet.vue'
import BookDetail from './BookDetail.vue'

const proto = useProto()
</script>

<template>
  <div class="relative h-full">
    <BookDetail state="new" />
    <Sheet title="Add to Library">
      <div class="flex flex-col gap-4 pt-2">
        <div class="flex flex-col rounded-xl border border-neutral-300">
          <div
            v-for="option in proto.data.addDraft.statuses"
            :key="option.value"
            class="flex h-12 items-center justify-between border-b border-neutral-200 px-4 text-[16px] last:border-0"
            :class="option.value === proto.data.addDraft.status ? 'font-semibold' : 'text-neutral-700'"
          >
            {{ option.label }}
            <Icon v-if="option.value === proto.data.addDraft.status" name="check" :size="20" />
          </div>
        </div>
        <Field label="Started" :value="`Today, ${formatDate(proto.data.addDraft.startedOn)}`">
          <template #trailing><Icon name="calendar" :size="18" class="ml-auto text-neutral-500" /></template>
        </Field>
        <Note>Finished: start date (optional), end date, then Rating and review. Want to read: no dates.</Note>
        <Button>Add to Library</Button>
      </div>
    </Sheet>
  </div>
</template>
