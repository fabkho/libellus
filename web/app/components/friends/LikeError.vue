<script setup lang="ts">
// The row's line when a like was refused (social v2a): the heart is back as it was (stores/likes.ts), and this
// says so, quietly, under the row's text. Nothing otherwise. Props: `row` (`sessionId`); `testid` (default `feed.like`),
// the line's test id is `<testid>.error`.
import { useLikesStore } from '~/stores/likes'

const props = withDefaults(defineProps<{ row: { sessionId?: string | null }; testid?: string }>(), { testid: 'feed.like' })
const likes = useLikesStore()
const { t } = useI18n()
const failed = computed(() => !!props.row.sessionId && likes.failed[props.row.sessionId] === true)
</script>

<template>
  <p v-if="failed" class="text-caption text-error" role="alert" :data-testid="`${testid}.error`">{{ t('social.like.error') }}</p>
</template>
