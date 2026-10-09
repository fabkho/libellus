<script setup lang="ts">
// Her follow link (social v1, U1; Profile → Friends → Your follow link): the only way in for now. What it
// does depends on her account (they ask, or they follow at once), then the link in mono, Share link (the
// platform's share sheet, the clipboard where there is none), Copy, and New link behind a Confirm (the
// old one dies at once). The link exists from the first time she opens Friends, private or public.
import { followLink } from '~/data/social'
import { useSocialStore } from '~/stores/social'
import { copyLink, shareLink, type ShareOutcome } from '~/utils/shareLink'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const social = useSocialStore()
const online = useOnline()

watch(open, (isOpen) => {
  if (!isOpen) return
  social.clearError('link')
  outcome.value = null
  void social.load()
})

const url = computed(() => (social.mine && import.meta.client ? followLink(window.location.origin, social.mine.link) : null))
const disabled = computed(() => !online.value || social.busy || !social.mine)

/** What the last Share or Copy did, said politely ("Copied."). */
const outcome = ref<ShareOutcome | null>(null)

async function share() {
  if (!url.value) return
  outcome.value = await shareLink({ url: url.value, text: t('followLink.shareText') }, navigator)
}
async function copy() {
  if (!url.value) return
  outcome.value = await copyLink(url.value, navigator)
}

const renewing = ref(false)
async function renew() {
  if (await social.renewLink()) {
    renewing.value = false
    outcome.value = null
  }
}
const error = computed(() => (social.errors.link && social.errors.link !== 'offline' ? t('privacy.error') : null))
</script>

<template>
  <UiSheet v-model:open="open" :title="t('followLink.title')" :action="t('privacy.done')" testid="followLink" @action="open = false">
    <div class="flex flex-col gap-md pt-xs pb-lg">
      <p class="text-body text-ink">{{ social.mine?.private === false ? t('followLink.textPublic') : t('followLink.textPrivate') }}</p>

      <p class="figures min-h-(--size-touch) rounded-md bg-fill px-md py-sm text-caption break-all text-ink-muted" data-testid="followLink.value">{{ url }}</p>

      <UiButton block tone="primary" :disabled="!url" data-testid="followLink.share" @click="share">
        <UiIcon name="share" :size="18" />{{ t('followLink.share') }}
      </UiButton>
      <div class="grid grid-cols-2 gap-sm">
        <UiButton block tone="secondary" size="md" :disabled="!url" data-testid="followLink.copy" @click="copy">
          <UiIcon name="copy" :size="16" />{{ t('followLink.copy') }}
        </UiButton>
        <UiButton
          block
          tone="secondary"
          size="md"
          :disabled="disabled"
          :offline="!online"
          data-testid="followLink.renew"
          @click="renewing = true"
        >
          {{ t('followLink.renew') }}
        </UiButton>
      </div>

      <p class="min-h-(--text-footnote--line-height) text-footnote text-ink-muted" role="status" data-testid="followLink.outcome">
        {{ outcome === 'copied' ? t('followLink.copied') : '' }}
      </p>
      <p v-if="error && !renewing" class="text-footnote text-error" role="alert" data-testid="followLink.error">{{ error }}</p>
      <p class="text-footnote text-ink-faint">{{ t('followLink.renewHint') }}</p>
    </div>
  </UiSheet>

  <UiConfirm
    v-model:open="renewing"
    :title="t('followLink.renewTitle')"
    :text="t('followLink.renewText')"
    :action="t('followLink.renewConfirm')"
    :busy="social.busy"
    :offline="!online"
    :error="error"
    testid="renewFollowLink"
    @confirm="renew"
  />
</template>
