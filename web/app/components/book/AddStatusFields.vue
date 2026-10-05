<script setup lang="ts">
// The status part of both Add sheets (D's add-sheet; issue #9): the Status to
// add the Book with, and the dates that Status needs below the choice. Want to
// read: none. Currently reading: the start day (today unless picked). Finished:
// when it was started (optional: a read from years ago may have no start), when
// it was finished (today unless picked), then the quarter-star Rating and a
// review, both optional. Days are the member's own and never in the future;
// the end is never before the start. `v-model` is the sheet's `AddDraft`
// (data/library.ts); `testid` is the sheet's name (`add`, `manual`), so the
// controls are `<testid>.status.<status>`, `.started`, `.ended`, `.rating`,
// `.review`, `.clearStarted`. The sheet shows the error and runs the action.
import { REVIEW_MAX_LENGTH, chooseAddStatus, type AddDraft } from '~/data/library'
import { ADDABLE_STATUSES } from '~/stores/library'

const draft = defineModel<AddDraft>({ required: true })
const props = defineProps<{ testid: string; error?: string | null; busy?: boolean }>()

const { t } = useI18n()

// The member's today, asked when drawn: a sheet left open past midnight moves on.
const today = () => isoDay()
const dayError = computed(() =>
  ['date_invalid', 'date_in_future', 'ended_before_started'].includes(props.error ?? ''),
)
const reviewId = useId()

function choose(status: AddDraft['status']) {
  chooseAddStatus(draft.value, status, isoDay())
}
</script>

<template>
  <p class="eyebrow mx-xs mt-sm mb-ms">{{ t('add.statusLabel') }}</p>
  <UiRowGroup role="radiogroup" :aria-label="t('add.statusLabel')">
    <button
      v-for="status in ADDABLE_STATUSES"
      :key="status"
      type="button"
      role="radio"
      :aria-checked="draft.status === status"
      class="option relative flex h-(--size-button) w-full items-center gap-ms px-inset text-left text-body"
      :class="draft.status === status ? 'text-ink' : 'text-ink-muted'"
      :data-testid="`${testid}.status.${status}`"
      @click="choose(status)"
    >
      <span class="radio" :class="draft.status === status && 'on'" aria-hidden="true" />
      <span class="flex-1">{{ t(`status.${status}`) }}</span>
      <span class="text-caption text-ink-faint">{{ t(`add.needs.${status}`) }}</span>
    </button>
  </UiRowGroup>

  <Transition name="fields" mode="out-in">
    <div v-if="draft.status === 'reading'" key="reading" :data-testid="`${testid}.reading`">
      <p class="eyebrow mx-xs mt-lg mb-ms">{{ t('add.datesLabel') }}</p>
      <UiRowGroup>
        <UiDateRow
          v-model="draft.startedOn"
          :label="t('add.startedOn')"
          :max="today()"
          :invalid="dayError"
          :testid="`${testid}.started`"
        />
      </UiRowGroup>
    </div>

    <div v-else-if="draft.status === 'finished'" key="finished" :data-testid="`${testid}.finished`">
      <p class="eyebrow mx-xs mt-lg mb-ms">{{ t('add.datesLabel') }}</p>
      <UiRowGroup>
        <UiDateRow
          v-model="draft.startedOn"
          :label="t('add.startedOn')"
          :placeholder="t('add.notSet')"
          :max="draft.endedOn || today()"
          :invalid="dayError"
          :testid="`${testid}.started`"
        />
        <UiDateRow
          v-model="draft.endedOn"
          :label="t('add.endedOn')"
          :min="draft.startedOn || undefined"
          :max="today()"
          :invalid="dayError"
          :testid="`${testid}.ended`"
        />
      </UiRowGroup>
      <div v-if="draft.startedOn" class="mt-sm flex justify-end px-xs">
        <button
          type="button"
          class="min-h-(--size-touch) text-caption text-accent"
          :data-testid="`${testid}.clearStarted`"
          @click="draft.startedOn = ''"
        >
          {{ t('add.clearStarted') }}
        </button>
      </div>

      <UiRatingInput v-model="draft.rating" class="mt-md" :disabled="busy" :testid="`${testid}.rating`" />

      <div class="mt-lg">
        <UiTextArea
          :id="reviewId"
          v-model="draft.review"
          :label="t('add.review')"
          :hint="t('add.optional')"
          :placeholder="t('add.reviewPlaceholder')"
          :maxlength="REVIEW_MAX_LENGTH"
          :disabled="busy"
          :data-testid="`${testid}.review`"
        />
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.option + .option::before {
  position: absolute;
  top: 0;
  right: 0;
  left: calc(var(--spacing-inset) + var(--size-star) + var(--spacing-ms));
  height: var(--stroke-hairline);
  content: '';
  background: var(--color-hairline-strong);
}

/* D's radio: a hairline ring; chosen, a lamp-lit dot in a lamp ring. */
.radio {
  width: var(--size-star);
  height: var(--size-star);
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  box-shadow: inset 0 0 0 var(--stroke-rule) var(--color-ink-faint);
  transition: box-shadow var(--duration-quick) var(--ease-standard);
}

.radio.on {
  background: radial-gradient(circle, var(--color-accent) 0 28%, transparent 32%);
  box-shadow:
    inset 0 0 0 var(--stroke-focus) var(--color-accent),
    0 0 var(--spacing-ms) var(--color-accent-soft);
}

/* The dates that go with a Status arrive with it; the sheet is already open. */
.fields-enter-active {
  transition: opacity var(--duration-standard) var(--ease-standard);
}

.fields-leave-active {
  transition: opacity var(--duration-quick) var(--ease-exit);
}

.fields-enter-from,
.fields-leave-to {
  opacity: 0;
}
</style>
