<script setup lang="ts">
// Design round #65: the Finish sheet as it is (BookFinishSheet), on the stub
// read: the day, the Rating, the review, Finish. `summary` is a line a
// direction may put over it (C: how the read went).
import { haptic, isoDay, setPosition, maxOf, type ProtoRead } from './model'

const props = defineProps<{ read: ProtoRead | null; summary?: string | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ finished: [read: ProtoRead] }>()

const { t } = useI18n()
const kept = ref<ProtoRead | null>(props.read)
watch(
  () => props.read,
  (value) => value && (kept.value = value),
)
const endedOn = ref(isoDay())
const rating = ref<number | null>(null)
const review = ref('')
watch(open, (value) => {
  if (value) {
    endedOn.value = isoDay()
    rating.value = null
    review.value = ''
  }
})

function finish() {
  const read = kept.value
  if (!read) return
  setPosition(read, maxOf(read))
  read.rating = rating.value
  read.finished = true
  haptic('done', { fromClick: true })
  open.value = false
  emit('finished', read)
}
</script>

<template>
  <UiSheet v-model:open="open" :title="t('finish.title')" testid="protoFinish">
    <template v-if="kept">
      <UiBookLine
        :title="kept.book.title"
        :authors="kept.book.authors"
        :src="coverSrc(kept.book.coverUrl, 'xs')"
        :thumbhash="kept.book.coverThumbhash"
        :colors="kept.book.coverColors"
      />
      <p v-if="summary" class="figures mb-md text-meta text-ink-faint">{{ summary }}</p>
      <UiRowGroup>
        <UiDateRow v-model="endedOn" :label="t('finish.endedOn')" :min="kept.startedOn" :max="isoDay()" testid="protoFinish.date" />
      </UiRowGroup>
      <UiRatingInput v-model="rating" class="mt-md" testid="protoFinish.rating" />
      <div class="mt-lg">
        <UiTextArea
          id="proto-review"
          v-model="review"
          :label="t('finish.review')"
          :hint="t('finish.optional')"
          :placeholder="t('finish.reviewPlaceholder')"
          data-testid="protoFinish.review"
        />
      </div>
      <div class="mt-lg mb-sm">
        <UiButton block data-testid="protoFinish.submit" @click="finish">
          <UiIcon name="check" :size="18" bold />{{ t('finish.action') }}
        </UiButton>
      </div>
    </template>
  </UiSheet>
</template>
