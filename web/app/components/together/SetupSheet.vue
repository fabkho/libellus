<script setup lang="ts">
// Starting a buddy read (docs/plans/buddy-read-shared.md, W3): one sheet of three steps, Book → Sections → Invite, then the
// result. Opened from a Book of her Library (the entry points are the Book page's row, components/together/BookRow.vue, and the Currently reading card's menu on Home, components/home/TogetherMenu.vue; nothing opens it with buddy reads off).
//
// 1. Book: the Book (her Library entry's: a read is of a Catalogue Book she holds), the day it starts, and what a buddy read is.
// 2. Sections: how the Book is divided: by a number of parts (grouped 2 or 3 at a time above 30) or by pages, the arithmetic of the
//    chat layer's `chapters.ts` (utils/buddySetup.ts), with a preview of the rows (`UiThreadRow`) the room will show. The Sections
//    are stored text: they are worded here, in the host's language, and "The whole book" is always the last.
// 3. Invite: the people she follows (`UiCheckList`, at most 11) and the link, on or off. Nothing leaves her account before "Start".
// Result: the read exists; the link (Share, Copy), who could not be invited, and the way into the room (`open`).
//
// The sheet is a step of steps (`UiSheet`'s `back`): Cancel on the first, Back after; focus goes to the step's heading on each step
// and the step is announced politely; every control is 44 px and the sheet scrolls at 200 % text. Start is refused offline
// (`offline`), a refusal stays in the sheet worded under `buddyRead.error.<code>`, and the same click tries again with the same
// client id (the database answers the read it made). A read she already has for the Book is offered to open (`buddy_read_exists`).
//
// Props: `entry` (her Library entry, null while none is chosen). v-model:open. Emits `open(id)` once she chooses the room, and goes there.
// Test ids: `buddySetup` (+ `.cancel`, `.back`), `buddySetup.next`, `.start`, `.starts`, `.mode.*`, `.count`, `.per.*`, `.pages`,
// `.perPart`, `.preview`, `.summary`, `.picker`, `.linkOn`, `.error`, `.open`, and the result's `.result`, `.link.*`.
import type { LibraryEntry } from '~/data/library'
import { pageCountOf } from '~/data/progress'
import { buddyErrorKey } from '~/utils/buddyRead'
import { roomPath } from '~/utils/buddyRoute'
import { useBuddyReadStore } from '~/stores/buddyRead'
import type { BuddyErrorCode, CreatedBuddyRead } from '~/data/buddyReads'
import {
  buddyLink,
  DEFAULT_SECTION_COUNT,
  groupingsOf,
  MAX_INVITES,
  partsIn,
  planIssue,
  previewOf,
  SETUP_STEPS,
  sectionsOf,
  setupProblem,
  stepReady,
  type SetupPlan,
  type SetupStep,
} from '~/utils/buddySetup'
import { DEFAULT_PAGES_PER_PART, type ChapterRange } from '#layers/chat/app/utils/chapters'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{ entry: LibraryEntry | null }>()
const emit = defineEmits<{ open: [id: string] }>()

const { t } = useI18n()
const { relativeDay } = useDays()
const store = useBuddyReadStore()
const online = useOnline()
const allowed = useBuddyReadsOn()
const coverHosts = { ...useCoverHosts(), proxy: false }

/** Kept while the sheet slides away, so it does not empty mid-exit. */
const entry = ref<LibraryEntry | null>(props.entry)
watch(
  () => props.entry,
  (value) => {
    if (value) entry.value = value
  },
)

// ------------------------------------------------------------------ the draft

const step = ref<SetupStep>('book')
const stepAt = computed(() => SETUP_STEPS.indexOf(step.value))
const today = computed(() => (open.value ? isoDay() : ''))
const startsOn = ref('')
const mode = ref<'count' | 'pages'>('count')
const countText = ref(String(DEFAULT_SECTION_COUNT))
const per = ref(1)
const pagesText = ref('')
const perPartText = ref(String(DEFAULT_PAGES_PER_PART))
const invite = ref<string[]>([])
const link = ref(true)

const created = ref<CreatedBuddyRead | null>(null)
const busy = ref(false)
const error = ref<BuddyErrorCode | null>(null)
const existing = ref<string | null>(null)
/** The call's own id: the same one again answers the read it made (a retry after a lost answer). */
let clientId = ''

const wholeNumber = (text: string): number | null => (/^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null)

watch(open, (isOpen) => {
  if (!isOpen) return
  step.value = 'book'
  startsOn.value = isoDay()
  mode.value = 'count'
  countText.value = String(DEFAULT_SECTION_COUNT)
  per.value = 1
  pagesText.value = String((entry.value && pageCountOf(entry.value)) ?? '')
  perPartText.value = String(DEFAULT_PAGES_PER_PART)
  invite.value = []
  link.value = true
  created.value = null
  busy.value = false
  error.value = null
  existing.value = null
  clientId = globalThis.crypto.randomUUID()
})

const count = computed(() => wholeNumber(countText.value))
const plan = computed<SetupPlan>(() =>
  mode.value === 'count'
    ? { from: 'count', count: count.value, per: groupingsOf(count.value).includes(per.value) ? per.value : 1 }
    : { from: 'pages', pageCount: wholeNumber(pagesText.value), perPart: wholeNumber(perPartText.value) },
)
const draft = computed(() => ({ bookId: entry.value?.book.id ?? null, plan: plan.value, invite: invite.value, startsOn: startsOn.value || null }))
const ready = computed(() => stepReady(step.value, draft.value, today.value || isoDay()))
const groupings = computed(() => groupingsOf(count.value))

// ------------------------------------------------------------------ the Sections

const rangeLabel = (range: ChapterRange) => t('together.setup.sections.label', { n: range.from === range.to ? String(range.from) : `${range.from}–${range.to}` })
const built = computed(() => sectionsOf(plan.value, rangeLabel, t('together.sections.whole')))
const issue = computed(() => planIssue(plan.value))
const parts = computed(() => partsIn(plan.value))

/** The rows the preview draws: the first parts, how many more there are, and the Section after them, "The whole book". */
const preview = computed(() => previewOf(parts.value, 4))
const wholeNumberRow = computed(() => parts.value.length + 1)
const pagesOf = (range: ChapterRange) => (range.startPage ? t('together.setup.sections.pageRange', { from: range.startPage, to: range.endPage }) : undefined)
const numberOf = (range: ChapterRange) => (range.from === range.to ? range.from : `${range.from}–${range.to}`)

const summary = computed(() => (built.value ? t('together.setup.sections.summary', { count: parts.value.length }, parts.value.length) : ''))
const problemText = computed(() => {
  if (!issue.value) return null
  if (issue.value === 'count') return t('together.setup.sections.problemCount')
  return plan.value.from === 'pages' && plan.value.pageCount === null ? t('together.setup.sections.problemNoPages') : t('together.setup.sections.problemPages')
})

const modes = computed(() => [
  { value: 'count' as const, label: t('together.setup.sections.byCount') },
  { value: 'pages' as const, label: t('together.setup.sections.byPages') },
])
const perOptions = computed(() => groupings.value.map((value) => ({ value, label: t('together.setup.sections.per', { count: value }, value) })))
const startsInvalid = computed(() => !!startsOn.value && !stepReady('book', draft.value, today.value || isoDay()))

// ------------------------------------------------------------------ steps

const heading = useTemplateRef<HTMLElement>('heading')
async function go(to: SetupStep) {
  step.value = to
  error.value = null
  await nextTick()
  heading.value?.focus()
}
const next = () => {
  if (ready.value && stepAt.value < SETUP_STEPS.length - 1) void go(SETUP_STEPS[stepAt.value + 1]!)
}
const back = () => {
  if (stepAt.value > 0) void go(SETUP_STEPS[stepAt.value - 1]!)
}

const stepTitle = computed(() => t(`together.setup.steps.${step.value}`))
const stepLine = computed(() => t('together.setup.stepOf', { step: stepAt.value + 1, total: SETUP_STEPS.length }))

// ------------------------------------------------------------------ starting

async function start() {
  const book = entry.value
  const made = built.value
  if (!book || !made || busy.value || !allowed.value || setupProblem(draft.value, isoDay())) return
  busy.value = true
  error.value = null
  existing.value = null
  const answer = await store.create({
    bookId: book.book.id,
    clientId,
    sections: made.sections,
    from: made.from,
    pageCount: made.pageCount,
    invite: invite.value,
    link: link.value,
    startsOn: startsOn.value && startsOn.value !== isoDay() ? startsOn.value : null,
  })
  busy.value = false
  if (answer.error) {
    error.value = answer.error
    existing.value = answer.existing ?? null
    return
  }
  created.value = answer.data
  await nextTick()
  resultHeading.value?.focus()
}

const resultHeading = useTemplateRef<HTMLElement>('resultHeading')
const url = computed(() => (created.value?.linkToken && import.meta.client ? buddyLink(window.location.origin, created.value.linkToken) : null))
/** The room of the read (W4's `/together/<id>`): the sheet goes there itself and tells its owner. */
function openRoom(id: string) {
  open.value = false
  emit('open', id)
  void navigateTo(roomPath(id))
}

const actionLabel = computed(() => (busy.value ? t('together.setup.starting') : error.value ? t('together.setup.retry') : t('together.setup.start')))
</script>

<template>
  <UiSheet
    v-if="allowed"
    v-model:open="open"
    :title="t('together.title')"
    :back="!created && stepAt > 0 ? t('together.setup.back') : undefined"
    :cancel="!(created || stepAt > 0)"
    :action="created ? t('together.setup.done') : undefined"
    testid="buddySetup"
    @back="back"
    @action="open = false"
  >
    <div v-if="entry" class="flex flex-col gap-md pt-xs pb-lg">
      <!-- The result: it exists. -->
      <template v-if="created">
        <h2 ref="resultHeading" tabindex="-1" class="book-title text-title outline-none" data-testid="buddySetup.result">{{ t('together.setup.startedTitle') }}</h2>
        <p class="text-body text-ink-muted">{{ t('together.setup.startedText', { title: entry.book.title }) }}</p>
        <p v-if="created.invited.length" class="text-subhead text-ink-muted" role="status" data-testid="buddySetup.invited">
          {{ t('together.setup.invitedCount', { count: created.invited.length }, created.invited.length) }}
        </p>
        <p v-if="created.skipped.length" class="text-subhead text-ink-muted" role="status" data-testid="buddySetup.skipped">
          {{ t('together.setup.skippedCount', { count: created.skipped.length }, created.skipped.length) }}
        </p>
        <template v-if="url">
          <p class="text-subhead text-ink-muted">{{ t('together.setup.linkText') }}</p>
          <TogetherLink :url="url" :text="t('together.link.shareText', { title: entry.book.title })" testid="buddySetup.link" />
        </template>
        <UiButton block data-testid="buddySetup.open" @click="openRoom(created.id)">{{ t('together.setup.openRoom') }}</UiButton>
      </template>

      <template v-else>
        <UiBookLine
          :title="entry.book.title"
          :authors="entry.book.authors"
          v-bind="coverImage(entry.book, 'xs', coverHosts)"
          :thumbhash="entry.book.coverThumbhash"
          :colors="entry.book.coverColors"
        />

        <p class="eyebrow" aria-hidden="true" data-testid="buddySetup.step">{{ stepLine }}</p>
        <p class="sr-only" role="status">{{ stepLine }}</p>
        <h2 ref="heading" tabindex="-1" class="book-title text-title outline-none" data-testid="buddySetup.heading">{{ stepTitle }}</h2>

        <!-- 1 · Book -->
        <template v-if="step === 'book'">
          <p class="text-body text-ink-muted">{{ t('together.setup.book.intro') }}</p>
          <UiRowGroup>
            <UiDateRow
              v-model="startsOn"
              :text="startsOn ? relativeDay(startsOn) : undefined"
              :placeholder="t('common.chooseDay')"
              :label="t('together.setup.book.starts')"
              :invalid="startsInvalid"
              testid="buddySetup.starts"
            />
          </UiRowGroup>
          <p v-if="startsInvalid" class="px-xs text-caption text-error" role="alert" data-testid="buddySetup.startsError">{{ t('buddyRead.error.buddy_starts_invalid') }}</p>
          <p v-else class="px-xs text-footnote text-ink-faint">{{ t('together.setup.book.startsHint') }}</p>
          <p class="px-xs text-footnote text-ink-faint">{{ t('together.hint') }}</p>
        </template>

        <!-- 2 · Sections -->
        <template v-else-if="step === 'sections'">
          <p class="text-body text-ink-muted">{{ t('together.setup.sections.intro') }}</p>
          <UiSegmented v-model="mode" :options="modes" :label="t('together.setup.sections.from')" testid="buddySetup.mode" />

          <template v-if="mode === 'count'">
            <UiField
              id="buddy-setup-count"
              v-model="countText"
              :label="t('together.setup.sections.howMany')"
              :hint="t('together.setup.sections.howManyHint')"
              :error="issue === 'count' ? problemText : null"
              inputmode="numeric"
              autocomplete="off"
              data-testid="buddySetup.count"
            />
            <UiSegmented v-if="perOptions.length > 1" v-model="per" :options="perOptions" :label="t('together.setup.sections.grouping')" testid="buddySetup.per" />
          </template>
          <template v-else>
            <UiField
              id="buddy-setup-pages"
              v-model="pagesText"
              :label="t('together.setup.sections.pagesInBook')"
              :error="issue === 'pages' && plan.from === 'pages' && plan.pageCount === null ? problemText : null"
              inputmode="numeric"
              autocomplete="off"
              data-testid="buddySetup.pages"
            />
            <UiField
              id="buddy-setup-per-part"
              v-model="perPartText"
              :label="t('together.setup.sections.perPart')"
              :error="issue === 'pages' && !(plan.from === 'pages' && plan.pageCount === null) ? problemText : null"
              inputmode="numeric"
              autocomplete="off"
              data-testid="buddySetup.perPart"
            />
          </template>

          <p class="min-h-(--text-subhead--line-height) text-subhead text-ink" role="status" data-testid="buddySetup.summary">{{ summary }}</p>

          <!-- What the room will list. A picture of the result, not controls: the summary above says it in words, so the rows are out of the tab order and the reading order. -->
          <div v-if="built" class="flex flex-col divide-y divide-hairline" inert aria-hidden="true" data-testid="buddySetup.preview">
            <UiThreadRow v-for="range in preview.head" :key="range.from" :number="numberOf(range)" :title="pagesOf(range)" :label="rangeLabel(range)" testid="buddySetup.row" />
            <p v-if="preview.more" class="py-sm text-footnote text-ink-faint">{{ t('together.setup.sections.more', { count: preview.more }, preview.more) }}</p>
            <UiThreadRow
              v-if="preview.tail"
              :number="wholeNumberRow"
              :title="t('together.sections.whole')"
              :label="t('together.sections.whole')"
              testid="buddySetup.row"
            />
          </div>
        </template>

        <!-- 3 · Invite -->
        <template v-else>
          <p class="text-body text-ink-muted">{{ t('together.setup.invite.intro') }}</p>
          <TogetherPicker v-model="invite" :label="t('together.setup.invite.label')" :max="MAX_INVITES" testid="buddySetup.picker" />
          <UiRowGroup>
            <UiSwitchRow v-model="link" icon="link" :label="t('together.setup.invite.link')" testid="buddySetup.linkOn" />
          </UiRowGroup>
          <p class="px-xs text-footnote text-ink-faint">{{ link ? t('together.setup.invite.linkOn') : t('together.setup.invite.linkOff') }}</p>
        </template>

        <p v-if="error" class="text-caption text-error" role="alert" data-testid="buddySetup.error">{{ t(buddyErrorKey(error)) }}</p>
        <UiButton v-if="existing" tone="secondary" block data-testid="buddySetup.existing" @click="openRoom(existing)">{{ t('together.setup.openExisting') }}</UiButton>

        <UiButton v-if="step !== 'invite'" block :disabled="!ready" data-testid="buddySetup.next" @click="next">{{ t('together.setup.next') }}</UiButton>
        <UiButton v-else block :disabled="busy || !ready" :offline="!online" :aria-busy="busy" data-testid="buddySetup.start" @click="start">
          {{ actionLabel }}
        </UiButton>
      </template>
    </div>
  </UiSheet>
</template>
