<script setup lang="ts">
// Contact (the Profile's Contact row, components/profile/ContactRow.vue): a bug, a feature request or
// something else, written to the owner from inside the app, no e-mail. The kind is a segmented choice
// (Bug by default), the text one box with a counter (2,000 characters at most; 10 at least, blanks around
// it do not count), and under it one line that says what the app attaches on its own. Send is disabled
// while the text is too short, while it goes (it says so) and while the device is offline (the box says
// "You're offline", and the text stays: online only, nothing is queued). A refusal stays in the sheet
// with its reason and the button says Try again; the text is kept, also when the sheet is closed and
// opened again. A message that went through turns the sheet into its thanks, and the next opening is
// empty. The textarea takes the keyboard once the sheet has risen (`data-autofocus`, UiSheet). What is
// sent: stores/feedback.ts, data/feedback.ts.
import { FEEDBACK_KINDS, FEEDBACK_MAX, FEEDBACK_MIN } from '~/data/feedback'
import { useFeedbackStore } from '~/stores/feedback'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useFeedbackStore()
const online = useOnline()
const context = useFeedbackContext()

watch(open, (isOpen) => isOpen && store.begin())

const kinds = computed(() => FEEDBACK_KINDS.map((value) => ({ value, label: t(`contact.kind.${value}`) })))
const length = computed(() => [...store.text].length)
const label = computed(() => (store.sending ? t('contact.sending') : store.sendError ? t('contact.retry') : t('contact.send')))

async function submit() {
  if (!online.value || !store.canSend) return
  await store.send(context())
}

const areaId = useId()
const hintId = useId()
</script>

<template>
  <UiSheet v-model:open="open" :title="t('contact.title')" testid="contact">
    <div v-if="store.sent" class="flex flex-col items-center gap-sm pt-md pb-sm text-center" role="status" data-testid="contact.done">
      <UiIcon name="check" :size="28" class="text-accent-ink" />
      <p class="book-title text-callout" data-testid="contact.doneTitle">{{ t('contact.done.title') }}</p>
      <p class="text-subhead text-ink-muted">{{ t('contact.done.text') }}</p>
      <UiButton block tone="secondary" class="mt-md" data-testid="contact.doneAction" @click="open = false">{{ t('contact.done.action') }}</UiButton>
    </div>

    <form v-else novalidate class="flex flex-col gap-md pt-xs pb-sm" data-testid="contact.form" @submit.prevent="submit()">
      <UiSegmented v-model="store.kind" :options="kinds" :label="t('contact.kindLabel')" testid="contact.kind" />

      <UiTextArea
        :id="areaId"
        v-model="store.text"
        :label="t('contact.label')"
        :hint="t('contact.hint', { min: FEEDBACK_MIN })"
        :placeholder="t(`contact.placeholder.${store.kind}`)"
        :maxlength="FEEDBACK_MAX"
        :disabled="store.sending"
        :aria-describedby="hintId"
        autocapitalize="sentences"
        data-autofocus
        data-testid="contact.text"
      />

      <div :id="hintId" class="flex items-start justify-between gap-md text-footnote text-ink-faint">
        <p data-testid="contact.context">{{ t('contact.context') }}</p>
        <p class="figures shrink-0" :aria-label="t('contact.countLabel', { count: length, max: FEEDBACK_MAX })" data-testid="contact.count">
          {{ t('contact.count', { count: length, max: FEEDBACK_MAX }) }}
        </p>
      </div>

      <p v-if="store.sendError" class="text-footnote text-error" role="alert" data-testid="contact.error">
        {{ t(`contact.error.${store.sendError === 'offline' ? 'unknown' : store.sendError}`) }}
      </p>

      <UiButton type="submit" block :disabled="!store.canSend || !online" :aria-busy="store.sending" data-testid="contact.send">
        {{ label }}
      </UiButton>
      <p v-if="!online" class="-mt-xs text-center text-footnote text-ink-muted" role="status" data-testid="contact.offline">{{ t('contact.offline') }}</p>
    </form>
  </UiSheet>
</template>
