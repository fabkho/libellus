<script setup lang="ts">
// Report a message of a room, buddy read or notes (docs/plans/buddy-read-shared.md part 4.3, D3; docs/plans/book-notes.md part 5.1): one reason and an optional note go to the instance's owner as a
// `report` in the Feedback inbox (`report_buddy_message`: the database keeps the message's id, its Section and a short excerpt, and
// refuses a report of one's own message, a second report of the same message is no new row). Reasons are a radio group (APG). The
// answer stays in the sheet: sent ("Thanks, I'll look at it"), or refused with the reason worded (`buddyRead.error.<code>`, a rate
// limit says so). Nothing is sent without a reason, and nothing while she is offline (the button says Offline).
// The call itself is the page's: `send` hands the report to the buddy store or the notes store and answers the refusal's code (null: sent);
// `errorKey` says which message-file key words a code (`buddyRead.error.<code>`, `notes.error.<code>`).
import { REPORT_REASONS, type ReportReason } from '~/data/buddyReads'
import { REPORT_NOTE_MAX, reportInput } from '~/utils/roomThread'

// `prefix` names the message keys the words are under (`together.report`: a buddy read's messages; `notes.report`: a Book's notes), which is also the test id.
const props = withDefaults(defineProps<{
  prefix?: string
  messageId: string | null
  send: (messageId: string, reason: ReportReason, note: string | null) => Promise<string | null>
  errorKey: (code: string) => string
}>(), { prefix: 'together.report' })
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const online = useOnline()

const reason = ref<string | null>(null)
const note = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
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

async function submit() {
  if (!props.messageId || !input.value || busy.value) return
  busy.value = true
  error.value = null
  const failed = await props.send(props.messageId, input.value.reason, input.value.note)
  busy.value = false
  if (failed) error.value = failed
  else sent.value = true
}
</script>

<template>
  <UiSheet
    v-model:open="open"
    :title="t(`${prefix}.title`)"
    :action="sent ? undefined : busy ? t(`${prefix}.sending`) : t(`${prefix}.send`)"
    :action-disabled="!input || busy || !online"
    :testid="prefix"
    @action="submit"
  >
    <div v-if="sent" class="flex flex-col items-center gap-sm px-xl pt-md pb-xl text-center" :data-testid="`${prefix}.done`">
      <p class="book-title text-callout">{{ t(`${prefix}.doneTitle`) }}</p>
      <p class="text-subhead text-ink-muted" role="status">{{ t(`${prefix}.doneText`) }}</p>
      <UiButton tone="secondary" size="md" class="mt-ms" :data-testid="`${prefix}.close`" @click="open = false">{{ t('together.done') }}</UiButton>
    </div>

    <div v-else class="flex flex-col gap-md pt-xs pb-lg">
      <p class="text-subhead text-ink-muted">{{ t(`${prefix}.intro`) }}</p>

      <UiRowGroup>
        <div role="radiogroup" :aria-label="t(`${prefix}.reasonLabel`)">
          <button
            v-for="r in REPORT_REASONS"
            :key="r"
            type="button"
            role="radio"
            :aria-checked="reason === r"
            class="flex min-h-(--size-row) w-full items-center gap-ms border-hairline px-inset text-left text-body not-first:border-t active:bg-fill-strong focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            :data-testid="`${prefix}.reason.${r}`"
            @click="reason = r"
          >
            <span class="min-w-0 flex-1">{{ t(`${prefix}.reason.${r}`) }}</span>
            <UiIcon v-if="reason === r" name="check" :size="18" class="text-accent-ink" />
          </button>
        </div>
      </UiRowGroup>

      <UiTextArea :id="`${prefix.replace(/\./g, '-')}-note`" v-model="note" :label="t(`${prefix}.noteLabel`)" :hint="t(`${prefix}.optional`)" :maxlength="REPORT_NOTE_MAX" :data-testid="`${prefix}.note`" />

      <p v-if="!online" class="text-footnote text-ink-faint" :data-testid="`${prefix}.offline`">{{ t('common.offline') }}</p>
      <p v-if="error" class="text-footnote text-error" role="alert" :data-testid="`${prefix}.error`">{{ t(errorKey(error)) }}</p>
    </div>
  </UiSheet>
</template>
