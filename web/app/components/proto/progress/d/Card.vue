<script setup lang="ts">
// Direction D on Home (B's flow, C's chart): the card reads like C — the last
// two weeks as a sparkline and the pace under the author, the bar and where
// you are at the bottom — but nothing on it edits. "Update" opens B's wheel
// sheet; after a save the line says what changed, with Undo. At the last
// page the card turns into the finish, with how the read went.
import { dayIndex, daysLeftOf, fractionOf, maxOf, n, paceOf, positionOf, setPosition, usesPages, valueWords, type ProtoRead } from '../model'

const props = defineProps<{ read: ProtoRead; undoFrom?: number | null }>()
const emit = defineEmits<{ book: []; update: []; finish: [summary: string] }>()

const { t } = useI18n()
const authorLine = computed(() => formatAuthors(props.read.book.authors, t('common.etAl')))

const pages = computed(() => usesPages(props.read))
const unit = computed(() => (pages.value ? '' : ' %'))
const pace = computed(() => paceOf(props.read))
const days = computed(() => daysLeftOf(props.read))
const atEnd = computed(() => positionOf(props.read) >= maxOf(props.read))
const span = computed(() => dayIndex(props.read.startedOn) + 1)
const perDay = computed(() => Math.round(maxOf(props.read) / span.value))

// The page's last save on this card, for a moment.
const undo = ref<number | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.undoFrom,
  (from) => {
    if (from == null) return
    undo.value = from
    clearTimeout(timer)
    timer = setTimeout(() => (undo.value = null), 5000)
  },
  { immediate: true },
)
function revert() {
  if (undo.value === null) return
  setPosition(props.read, undo.value)
  undo.value = null
}
const gain = computed(() => (undo.value === null ? 0 : positionOf(props.read) - undo.value))
</script>

<template>
  <article class="relative overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" data-testid="d.card">
    <UiAmbient :colors="read.book.coverColors" shape="card" />
    <div class="relative flex gap-md">
      <button type="button" class="relative" tabindex="-1" aria-hidden="true" @click="emit('book')">
        <UiCover
          :title="read.book.title"
          :authors="read.book.authors"
          :src="coverSrc(read.book.coverUrl, 'lg')"
          :thumbhash="read.book.coverThumbhash"
          :colors="read.book.coverColors"
          size="lg"
          glow
          eager
        />
      </button>
      <div class="flex min-w-0 flex-1 flex-col pt-xxs">
        <button type="button" class="flex flex-col gap-xs text-left" @click="emit('book')">
          <span class="book-title line-clamp-2 text-book-title">{{ read.book.title }}</span>
          <span class="truncate text-body text-ink-muted">{{ authorLine }}</span>
        </button>
        <div class="mt-sm flex items-end gap-sm">
          <ProtoProgressCSpark :read="read" />
          <span class="figures truncate text-meta text-ink-faint">
            <template v-if="atEnd">{{ span }} days · {{ n(perDay) }}{{ unit }} a day</template>
            <template v-else-if="pace">{{ pace }}{{ unit }} a day<template v-if="days"> · {{ days }} {{ days === 1 ? 'day' : 'days' }}</template></template>
          </span>
        </div>
        <div class="mt-auto pt-md">
          <UiProgress :fraction="fractionOf(read)" label="Reading progress" :value-text="valueWords(read)" />
        </div>
        <div class="flex items-center justify-between gap-ms pt-xs">
          <span class="min-w-0 truncate text-meta text-ink-muted" data-testid="d.value">
            <span v-if="atEnd" class="text-body text-ink">The end.</span>
            <template v-else>
              <span class="figures">{{ valueWords(read) }}</span>
              <span v-if="gain" class="figures text-accent"> · {{ gain > 0 ? '+' : '−' }}{{ n(Math.abs(gain)) }}{{ unit }}</span>
            </template>
          </span>
          <UiButton
            v-if="atEnd"
            size="sm"
            data-testid="d.finish"
            @click="emit('finish', `Read in ${span} days · ${n(perDay)}${pages ? ' pages' : ' %'} a day`)"
          >
            <UiIcon name="check" :size="15" bold />{{ t('book.finish') }}
          </UiButton>
          <UiButton v-else-if="gain" tone="plain" size="sm" class="-mr-sm" data-testid="d.undo" @click="revert">Undo</UiButton>
          <UiButton v-else tone="quiet" size="sm" data-testid="d.update" @click="emit('update')">Update</UiButton>
        </div>
      </div>
    </div>
  </article>
</template>
