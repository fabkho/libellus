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
import { PAGE_CEILING, ownTotal, pageCountOf } from '~/data/progress'
import { useHistoryStore } from '~/stores/history'

// Direct, as this screen asked before own covers: only the Library's row and the reel go through `/cover` (docs/plans/owned-covers.md §5).
const coverHosts = { ...useCoverHosts(), proxy: false }

const { t } = useI18n()
const { relativeDay } = useDays()
const history = useHistoryStore()
// Saving works offline too: it waits to sync (#93). Deleting a read changes
// which read decides the Status, from reads the device may not all hold:
// offline it says so instead (#15).
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

// ---------------------------------------------------- Her own page count (issue #60)
//
// A finished read's count is hers to correct here as its dates are: the count that counts for the entry
// (`pageCountOf`: her override, else the edition's) fills the field, so the sheet opens on "144" and she
// edits it. It is NOT the shared edition's (`books.page_count` is never written) and it is NOT part of
// `SessionEdit`: `update_session` has no page count, so an edit that changes it makes a second call,
// `stats.setTotal` → `set_read_total`, once the read's own edit has landed. Empty is no override, which
// the database stores as the edition's count again. An abandoned read has no total to speak of and an
// open one sets it through Update progress, so the field is the finished read's.
// The field's text, always: a `type="number"` input hands its model a number (Vue casts it), and what the
// sheet compares and sends is the text as typed.
const pageCountText = ref('')
function typedPageCount(value: string | number | null | undefined) {
  pageCountText.value = value === null || value === undefined ? '' : String(value)
}
const pageCountError = ref<string | null>(null)

/** Fills the field from the count that counts for this entry (once the sheet opens on a read). */
watch(
  [open, target],
  ([isOpen]) => {
    if (!isOpen) return
    const count = entry.value && outcome.value === 'finished' ? pageCountOf(entry.value) : null
    pageCountText.value = count === null ? '' : String(count)
    pageCountError.value = null
  },
  { immediate: true },
)

/** The edition's own count: what she is overriding, never what she writes. */
const editionCount = computed(() => entry.value?.book.pageCount ?? null)
/** What the field holds, as the number to send: empty (or unreadable) is null, the edition's count again. */
const pageCountTyped = computed(() => {
  const text = pageCountText.value.trim()
  if (text === '') return null
  const count = Number(text)
  return Number.isInteger(count) && count >= 1 && count <= PAGE_CEILING ? count : NaN
})
/** The quiet line under the field: what an empty one leaves, and which edition it is following. */
const pageCountHint = computed(() => {
  const edition = editionCount.value
  if (edition) return t('editSession.pageCountHint', { count: edition })
  return t('editSession.pageCountHintNone')
})

/** What the edit would store of her count, as the database keeps it (a total that only repeats the edition's is none). */
const pageCountNext = computed(() => ownTotal(pageCountTyped.value, editionCount.value))

/**
 * Save: the read's own edit first (its failure is the authoritative one), then her page count — only when it
 * would store something else than what is there now (`page_count_override`), so an edit of the dates alone
 * never writes the count, and clearing a field that had no override writes nothing either.
 */
function save() {
  pageCountError.value = null
  const typed = pageCountTyped.value
  if (Number.isNaN(typed)) {
    pageCountError.value = t('editSession.pageCountInvalid')
    return
  }
  const changed = outcome.value === 'finished' && pageCountNext.value !== (entry.value?.pageCountOverride ?? null)
  void history.confirmEdit(changed ? { pageCount: pageCountNext.value } : undefined)
}

const today = computed(() => (open.value ? isoDay() : ''))
const dateError = computed(() =>
  ['date_invalid', 'date_in_future', 'ended_before_started'].includes(history.editError ?? ''),
)
const label = computed(() =>
  history.editBusy ? t('editSession.busy') : history.editError ? t('editSession.retry') : t('editSession.action'),
)
const reviewId = useId()
const reasonId = useId()
const pageCountId = useId()

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
        v-bind="coverImage(entry.book, 'xs', coverHosts)"
        :thumbhash="entry.book.coverThumbhash"
        :colors="entry.book.coverColors"
      />

      <UiRowGroup>
        <UiDateRow
          v-model="history.draft.startedOn"
          :text="history.draft.startedOn ? relativeDay(history.draft.startedOn) : undefined"
          :label="t('editSession.startedOn')"
          :placeholder="outcome ? t('editSession.notSet') : t('common.chooseDay')"
          :max="(outcome ? history.draft.endedOn : '') || today"
          :invalid="dateError"
          testid="editSession.started"
        />
        <UiDateRow
          v-if="outcome"
          v-model="history.draft.endedOn"
          :text="history.draft.endedOn ? relativeDay(history.draft.endedOn) : undefined"
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
          class="min-h-(--size-touch) text-caption text-accent-ink"
          data-testid="editSession.clearStarted"
          @click="history.draft.startedOn = ''"
        >
          {{ t('editSession.clearStarted') }}
        </button>
      </div>

      <template v-if="outcome === 'finished'">
        <!-- Her own page count for this read (issue #60), under the days it ran: it belongs with what the
             read was, not with its Rating. The edition's own count is the shared Book's and is never
             written; a count equal to it is stored as none, which the database does. -->
        <div class="mt-lg">
          <UiField
            :id="pageCountId"
            :model-value="pageCountText"
            type="number"
            inputmode="numeric"
            min="1"
            max="99999"
            autocomplete="off"
            :label="t('editSession.pageCount')"
            :hint="pageCountHint"
            :error="pageCountError"
            error-testid="editSession.pageCountError"
            :disabled="history.editBusy"
            class="figures"
            data-testid="editSession.pageCount"
            @update:model-value="typedPageCount"
          />
        </div>

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
          >
            <template #footer>
              <BookSpoilerSwitch v-model="history.draft.reviewSpoilers" :disabled="history.editBusy" testid="editSession.spoilers" />
            </template>
          </UiTextArea>
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
      <!-- The read was saved and her page count was not (a refusal, or no connection to queue it): said plainly,
           because the dates, the Rating and the review are kept and only the count is not. -->
      <p v-else-if="history.totalFailed" class="mt-ms px-xs text-caption text-error" role="alert" data-testid="editSession.totalError">
        {{ t('editSession.pageCountFailed') }}
      </p>

      <div class="mt-lg">
        <UiButton block :disabled="history.editBusy" :aria-busy="history.editBusy" data-testid="editSession.submit" @click="save()">
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
