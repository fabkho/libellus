<script setup lang="ts">
// A buddy read's link (`/t/<token>`), as the host hands it out: the address in mono, Share link (the platform's share sheet, the
// clipboard where there is none) and Copy, and a polite line that says what happened ("Copied."). Drawing only: the sheet that holds it
// owns the token (the setup's result, the invite sheet). The twin of the follow link's own block (components/friends/LinkSheet.vue).
//
// Props: `url` (null while there is no link or none can be shown), `text` (what the share sheet says with the link), `testid` (the prefix of
// the test ids: `<testid>.value`, `.share`, `.copy`, `.outcome`). Needs the window for `navigator`: client only.
import { copyLink, shareLink, type ShareOutcome } from '~/utils/shareLink'

const props = withDefaults(defineProps<{ url: string | null; text: string; testid?: string }>(), { testid: 'buddyLink' })

const { t } = useI18n()
const outcome = ref<ShareOutcome | null>(null)

// A link that changed (a new one) is a new sentence: the old "Copied." is gone.
watch(
  () => props.url,
  () => (outcome.value = null),
)

async function share() {
  if (!props.url) return
  outcome.value = await shareLink({ url: props.url, text: props.text }, navigator)
}
async function copy() {
  if (!props.url) return
  outcome.value = await copyLink(props.url, navigator)
}
</script>

<template>
  <div class="flex flex-col gap-md">
    <p class="figures min-h-(--size-touch) rounded-md bg-fill px-md py-sm text-caption break-all text-ink-muted" :data-testid="`${testid}.value`">{{ url ?? '' }}</p>
    <div class="grid grid-cols-2 gap-sm">
      <UiButton block tone="primary" size="md" :disabled="!url" :data-testid="`${testid}.share`" @click="share">
        <UiIcon name="share" :size="16" />{{ t('together.link.share') }}
      </UiButton>
      <UiButton block tone="secondary" size="md" :disabled="!url" :data-testid="`${testid}.copy`" @click="copy">
        <UiIcon name="copy" :size="16" />{{ t('together.link.copy') }}
      </UiButton>
    </div>
    <p class="min-h-(--text-footnote--line-height) text-footnote text-ink-muted" role="status" :data-testid="`${testid}.outcome`">
      {{ outcome === 'copied' ? t('together.link.copied') : outcome === 'failed' ? t('together.link.failed') : '' }}
    </p>
  </div>
</template>
