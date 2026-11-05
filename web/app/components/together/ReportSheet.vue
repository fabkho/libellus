<script setup lang="ts">
// Report a message (docs/plans/buddy-read-shared.md part 4.3, D3): one reason and an optional note go to the instance's owner as a
// `report` in the Feedback inbox (`report_buddy_message`: the database keeps the message's id, its Section and a short excerpt, and
// refuses a report of one's own message, a second report of the same message is no new row). Reasons are a radio group (APG). The
// answer stays in the sheet: sent ("Thanks, I'll look at it"), or refused with the reason worded (`buddyRead.error.<code>`, a rate
// limit says so). Nothing is sent without a reason, and nothing while she is offline (the button says Offline).
import { REPORT_REASONS, type BuddyErrorCode } from '~/data/buddyReads'
import { buddyErrorKey } from '~/utils/buddyRead'
import { REPORT_NOTE_MAX, reportInput } from '~/utils/buddyThread'
import { useBuddyReadStore } from '~/stores/buddyRead'

const props = defineProps<{ messageId: string | null }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const store = useBuddyReadStore()
const online = useOnline()

const reason = ref<string | null>(null)
const note = ref('')
const busy = ref(false)
const error = ref<BuddyErrorCode | null>(null)
const sent = ref(false)

watch(open, (now) => {
  if (!now) return
  reason.value = null
  note.value = ''
  busy.value = false
  error.value = null
  sent.value = false
})

const input = computed(() => reportInput(reason.value, note.value))

async function send() {
  if (!props.messageId || !input.value || busy.value) return
  busy.value = true
  error.value = null
  const answer = await store.report(props.messageId, input.value.reason, input.value.note)
  busy.value = false
  if (answer.error) error.value = answer.error
  else sent.value = true
}
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t('together.report.title')"
    :action="sent ? undefined : busy ? t('together.report.sending') : t('together.report.send')"
    :action-disabled="!input || busy || !online"
    testid="together.report"
    @action="send"
  >
    <div v-if="sent" class="flex flex-col items-center gap-sm px-xl pt-md pb-xl text-center" data-testid="together.report.done">
      <p class="book-title text-callout">{{ t('together.report.doneTitle') }}</p>
      <p class="text-subhead text-ink-muted" role="status">{{ t('together.report.doneText') }}</p>
      <UiButton tone="secondary" size="md" class="mt-ms" data-testid="together.report.close" @click="open = false">{{ t('together.done') }}</UiButton>
    </div>

    <div v-else class="flex flex-col gap-md pt-xs pb-lg">
      <p class="text-subhead text-ink-muted">{{ t('together.report.intro') }}</p>

      <UiRowGroup>
        <div role="radiogroup" :aria-label="t('together.report.reasonLabel')">
          <button
            v-for="r in REPORT_REASONS"
            :key="r"
            type="button"
            role="radio"
            :aria-checked="reason === r"
            class="flex min-h-(--size-row) w-full items-center gap-ms border-hairline px-inset text-left text-body not-first:border-t active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            :data-testid="`together.report.reason.${r}`"
            @click="reason = r"
          >
            <span class="min-w-0 flex-1">{{ t(`together.report.reason.${r}`) }}</span>
            <UiIcon v-if="reason === r" name="check" :size="18" class="text-accent-ink" />
          </button>
        </div>
      </UiRowGroup>

      <UiTextArea id="together-report-note" v-model="note" :label="t('together.report.noteLabel')" :hint="t('together.report.optional')" :maxlength="REPORT_NOTE_MAX" data-testid="together.report.note" />

      <p v-if="!online" class="text-footnote text-ink-faint" data-testid="together.report.offline">{{ t('common.offline') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" data-testid="together.report.error">{{ t(buddyErrorKey(error)) }}</p>
    </div>
  </UiSheet>
</template>
