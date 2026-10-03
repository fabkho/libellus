<script setup lang="ts">
// Edit a read (issue #11; the Edit link on the book page's history): the same
// rows as creating it — the day rows, the rating control, the review box —
// filled with what the read has, and which of them show follows from how it
// ended. Still being read: the start day. Finished: start (optional: a read
// logged later may have none), end, Rating and review, all as when finishing.
// Not finished: start, the day it stopped and the reason. Days are never in
// the future, the end never before the start. Save is the one action; Delete
// this read asks first (UiConfirm) and, if it was the only read, the Book goes
// back to Want to read. A failure stays in the sheet with its reason and Save
// tries again.
import { ABANDON_REASON_MAX_LENGTH, REVIEW_MAX_LENGTH } from '~/data/library'
import { useHistoryStore } from '~/stores/history'

const { t } = useI18n()
const history = useHistoryStore()
// Saving and deleting write: offline they say so instead (#15).
const online = useOnline()

const open = computed({
  get: () => history.editing !== null,
  set: (value) => {
    if (!value) history.closeEdit()
  },
})

// Kept while the sheet slides away, so it does not empty mid-exit.
const target = ref(history.editing)
watch(
  () => history.editing,
  (value) => {
    if (value) target.value = value
  },
)
const entry = computed(() => target.value?.entry ?? null)
const outcome = computed(() => target.value?.session.outcome ?? null)

const today = computed(() => (open.value ? isoDay() : ''))
const dateError = computed(() =>
  ['date_invalid', 'date_in_future', 'ended_before_started'].includes(history.editError ?? ''),
)
const label = computed(() =>
  history.editBusy ? t('editSession.busy') : history.editError ? t('editSession.retry') : t('editSession.action'),
)
const reviewId = useId()
const reasonId = useId()

// Deleting a read: the question, and what it costs when it is the only read.
const confirming = computed({
  get: () => history.deleting !== null,
  set: (value) => {
    if (!value) history.cancelDelete()
  },
})
// What deleting costs: the Book goes back to Want to read when it is the only
// read. Kept while the question slides away, so the words do not change mid-exit.
const deleteText = ref(t('deleteSession.text'))
watch(
  () => history.deleting,
  (asked) => {
    if (!asked) return
    const only = history.sessions.get(asked.entry.id)?.length === 1
    deleteText.value = only ? `${t('deleteSession.text')} ${t('deleteSession.only')}` : t('deleteSession.text')
  },
)
</script>

<template>
  <UiSheet v-model:open="open" :title="t('editSession.title')" testid="editSession">
    <template v-if="entry">
      <UiBookLine
        :title="entry.book.title"
        :authors="entry.book.authors"
        :src="coverSrc(entry.book.coverUrl, 'xs')"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
      />

      <UiRowGroup>
        <UiDateRow
          v-model="history.draft.startedOn"
          :label="t('editSession.startedOn')"
          :placeholder="outcome ? t('editSession.notSet') : undefined"
          :max="(outcome ? history.draft.endedOn : '') || today"
          :invalid="dateError"
          testid="editSession.started"
        />
        <UiDateRow
          v-if="outcome"
          v-model="history.draft.endedOn"
          :label="t(outcome === 'finished' ? 'editSession.finishedOn' : 'editSession.stoppedOn')"
          :placeholder="t('editSession.notSet')"
          :min="history.draft.startedOn || undefined"
          :max="today"
          :invalid="dateError"
          testid="editSession.ended"
        />
      </UiRowGroup>
      <div v-if="outcome && history.draft.startedOn" class="mt-sm flex justify-end px-xs">
        <button
          type="button"
          class="min-h-(--size-touch) text-caption text-accent"
          data-testid="editSession.clearStarted"
          @click="history.draft.startedOn = ''"
        >
          {{ t('editSession.clearStarted') }}
        </button>
      </div>

      <template v-if="outcome === 'finished'">
        <UiRatingInput v-model="history.draft.rating" class="mt-md" :disabled="history.editBusy" testid="editSession.rating" />

        <div class="mt-lg">
          <UiTextArea
            :id="reviewId"
            v-model="history.draft.review"
            :label="t('editSession.review')"
            :hint="t('editSession.optional')"
            :placeholder="t('editSession.reviewPlaceholder')"
            :maxlength="REVIEW_MAX_LENGTH"
            :disabled="history.editBusy"
            data-testid="editSession.review"
          />
        </div>
      </template>

      <div v-else-if="outcome === 'abandoned'" class="mt-lg">
        <UiTextArea
          :id="reasonId"
          v-model="history.draft.abandonReason"
          :label="t('editSession.reason')"
          :hint="t('editSession.optional')"
          :placeholder="t('editSession.reasonPlaceholder')"
          :maxlength="ABANDON_REASON_MAX_LENGTH"
          :disabled="history.editBusy"
          data-testid="editSession.reason"
        />
      </div>

      <p v-if="history.editError" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="editSession.error">
        {{ t(`library.error.${history.editError}`) }}
      </p>

      <div class="mt-lg">
        <UiButton block :disabled="history.editBusy" :offline="!online" :aria-busy="history.editBusy" data-testid="editSession.submit" @click="history.confirmEdit()">
          <UiIcon name="check" :size="18" bold />{{ label }}
        </UiButton>
      </div>
      <div class="mt-sm mb-sm">
        <UiButton block tone="danger" :disabled="history.editBusy" :offline="!online" data-testid="editSession.delete" @click="history.askDelete()">
          {{ t('editSession.delete') }}
        </UiButton>
      </div>
    </template>
  </UiSheet>

  <UiConfirm
    v-model:open="confirming"
    :title="t('deleteSession.title')"
    :text="deleteText"
    :action="history.deleteBusy ? t('deleteSession.busy') : t('deleteSession.action')"
    :busy="history.deleteBusy"
    :offline="!online"
    :error="history.deleteError ? t(`library.error.${history.deleteError}`) : null"
    testid="deleteSession"
    @confirm="history.confirmDelete()"
  />
</template>
