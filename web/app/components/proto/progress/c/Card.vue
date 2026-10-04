<script setup lang="ts">
// Direction C on Home: the card leads with the habit. Under the author, the
// last two weeks as a sparkline and the pace ("26 a day · 15 days to go");
// the bar and where you are at the bottom, and "Today" — tapped, the card
// opens in place to log what you read today (no sheet). Logged, the
// sparkline's last bar grows in the lamp colour and Undo stays a moment.
// Reaching the end turns the card into the finish: how the read went, and
// Finish.
import {
  dayIndex,
  daysLeftOf,
  fractionOf,
  haptic,
  maxOf,
  n,
  paceOf,
  positionOf,
  setPosition,
  todayOf,
  usesPages,
  valueWords,
  type ProtoRead,
} from '../model'

const props = defineProps<{ read: ProtoRead; open?: boolean; preset?: number | null; saved?: boolean }>()
const emit = defineEmits<{ book: []; finish: [summary: string] }>()

const { t } = useI18n()
const authorLine = computed(() => formatAuthors(props.read.book.authors, t('common.etAl')))

const logging = ref(Boolean(props.open))
const amount = ref(props.preset ?? 0)
const undo = ref<{ from: number } | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

const pages = computed(() => usesPages(props.read))
const unit = computed(() => (pages.value ? '' : ' %'))
const pace = computed(() => paceOf(props.read))
const days = computed(() => daysLeftOf(props.read))
const today = computed(() => todayOf(props.read))
const todayAmount = computed(() => (today.value ? today.value.to - today.value.from : 0))
const atEnd = computed(() => positionOf(props.read) >= maxOf(props.read))
const summary = computed(() => {
  const span = dayIndex(props.read.startedOn) + 1
  const total = maxOf(props.read)
  return `${span} days · ${n(Math.round(total / span))}${pages.value ? '' : ' %'} a day`
})

function openLog() {
  amount.value = props.preset ?? Math.max(5, Math.round((pace.value ?? 20) / 5) * 5)
  amount.value = Math.min(amount.value, maxOf(props.read) - positionOf(props.read))
  logging.value = true
  haptic('tick', { fromClick: true })
}
function log(to: number) {
  const from = positionOf(props.read)
  setPosition(props.read, to)
  logging.value = false
  haptic(to >= maxOf(props.read) ? 'done' : 'step', { fromClick: true })
  undo.value = { from }
  clearTimeout(timer)
  timer = setTimeout(() => (undo.value = null), 5000)
}
function revert() {
  if (!undo.value) return
  setPosition(props.read, undo.value.from)
  undo.value = null
}
onMounted(() => {
  if (props.saved) {
    const from = positionOf(props.read)
    setPosition(props.read, from + 30)
    undo.value = { from }
  }
})
</script>

<template>
  <article class="relative overflow-hidden rounded-lg bg-surface-raised p-inset shadow-raised edge-faint" data-testid="c.card">
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
          <ProtoProgressCSpark :read="read" :pending="logging ? amount : 0" />
          <span class="figures truncate text-meta text-ink-faint">
            <template v-if="atEnd">{{ summary }}</template>
            <template v-else-if="pace">{{ pace }}{{ unit }} a day<template v-if="days"> · {{ days }} {{ days === 1 ? 'day' : 'days' }}</template></template>
          </span>
        </div>
        <div class="mt-auto pt-md">
          <UiProgress :fraction="fractionOf(read)" label="Reading progress" :value-text="valueWords(read)" />
        </div>
        <div class="flex items-center justify-between gap-ms pt-xs">
          <span class="min-w-0 truncate text-meta text-ink-muted" data-testid="c.value">
            <template v-if="atEnd"><span class="text-body text-ink">The end.</span></template>
            <template v-else>
              <span class="figures">{{ valueWords(read) }}</span><span v-if="undo" class="figures text-accent"> · +{{ n(positionOf(read) - undo.from) }}{{ unit }}</span>
            </template>
          </span>
          <UiButton v-if="atEnd" size="sm" data-testid="c.finish" @click="emit('finish', `Read in ${summary.replace(' a day', pages ? ' pages a day' : ' a day')}`)">
            <UiIcon name="check" :size="15" bold />{{ t('book.finish') }}
          </UiButton>
          <UiButton v-else-if="undo" tone="plain" size="sm" class="-mr-sm" data-testid="c.undo" @click="revert">Undo</UiButton>
          <UiButton v-else-if="!logging" tone="quiet" size="sm" data-testid="c.today" @click="openLog">
            <UiIcon name="plus" :size="14" bold />{{ todayAmount ? `Today +${n(todayAmount)}${unit}` : 'Today' }}
          </UiButton>
        </div>
      </div>
    </div>

    <div class="drawer" :class="logging && 'open'" :inert="!logging">
      <div class="min-h-0">
        <div class="relative mt-ms border-t-(length:--stroke-hairline) border-hairline pt-ms">
          <ProtoProgressCLog v-model:amount="amount" :read="read" @log="log" @cancel="logging = false" />
        </div>
      </div>
    </div>
  </article>
</template>

<style scoped>
/* Opens in place: the card's room grows over `standard`. */
.drawer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-standard) var(--ease-standard);
}
.drawer > div {
  overflow: hidden;
}
.drawer.open {
  grid-template-rows: 1fr;
}
</style>
