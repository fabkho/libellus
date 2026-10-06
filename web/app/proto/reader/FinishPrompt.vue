<script setup lang="ts">
// The Finish sheet, as the reader opens it at the end of the book: the same
// sheet as on the book page (FinishSheet: the day, the Rating, a review), with
// the read in one line under the Book. Local state only in the prototype.
import type { CoverColors } from '~/utils/cover'

const open = defineModel<boolean>('open', { required: true })
defineProps<{ book: { title: string; authors: string[]; cover: string | null; colors: CoverColors | null; thumbhash: string | null; pages: number } }>()
defineEmits<{ finish: [] }>()

const endedOn = ref(isoDay())
const rating = ref<number | null>(null)
const review = ref('')
const reviewId = useId()
</script>

<template>
  <UiSheet v-model:open="open" :title="$t('finish.title')" testid="readerFinish">
    <UiBookLine :title="book.title" :authors="book.authors" :src="book.cover" :thumbhash="book.thumbhash" :colors="book.colors" />
    <p class="figures mb-md text-meta text-ink-faint">Read in 4 days · {{ Math.round(book.pages / 4) }} pages a day</p>
    <UiRowGroup>
      <UiDateRow v-model="endedOn" :label="$t('finish.endedOn')" :max="isoDay()" testid="readerFinish.date" />
    </UiRowGroup>
    <UiRatingInput v-model="rating" class="mt-md" testid="readerFinish.rating" />
    <div class="mt-lg">
      <UiTextArea :id="reviewId" v-model="review" :label="$t('finish.review')" :hint="$t('finish.optional')" :placeholder="$t('finish.reviewPlaceholder')" data-testid="readerFinish.review" />
    </div>
    <div class="mt-lg mb-sm">
      <UiButton block data-testid="readerFinish.submit" @click="$emit('finish')">
        <UiIcon name="check" :size="18" bold />{{ $t('finish.action') }}
      </UiButton>
    </div>
  </UiSheet>
</template>
