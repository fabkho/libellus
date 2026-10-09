<script setup lang="ts">
// Her review under a finished Book (social v1, U4): serif and quiet, folded at four lines; More opens the
// rest, and shows only when there is a rest. Plain text, as it was written.
defineProps<{ text: string }>()

const { t } = useI18n()
const open = ref(false)
const folded = ref(false)
const body = useTemplateRef<HTMLElement>('body')

function measure() {
  const el = body.value
  if (el && !open.value) folded.value = el.scrollHeight > el.clientHeight + 1
}
/** More goes away once it is pressed: focus moves to the review it opened, so it is not lost (a11y). */
async function unfold() {
  open.value = true
  await nextTick()
  body.value?.focus()
}
onMounted(measure)
watch(() => body.value?.textContent, () => nextTick(measure))
</script>

<template>
  <div class="mt-xs flex flex-col items-start gap-xs">
    <p ref="body" tabindex="-1" class="book-title whitespace-pre-line text-subhead text-ink-muted italic" :class="{ 'line-clamp-4': !open }" data-testid="member.finishedReview">{{ text }}</p>
    <button
      v-if="folded && !open"
      type="button"
      class="more text-caption font-medium text-accent-ink"
      data-testid="member.finishedMore"
      @click="unfold"
    >
      {{ t('feed.more') }}
    </button>
  </div>
</template>

<style scoped>
/* A 44 px target around a small word, as every text button. */
.more {
  min-height: var(--size-touch);
  margin-block: calc((var(--size-touch) - 1.25rem) / -2);
}
</style>
